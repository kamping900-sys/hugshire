"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CityScene, CitySceneData } from "@/game/CityScene";
import { parcelCount, type HelperRow, type MapType } from "@/game/sim";
import { api, ApiError, idemKey } from "@/lib/api";
import { formatUsd } from "@/lib/money";
import { Badge, Button, cx } from "@/components/ui";

type Control = { mode: "manual" | "auto"; reason: string; idleSeconds: number | null };
type HelperState = { id: string; causeId: string; nickname: string; controlPreference: "manual" | "auto"; control: Control };
export type DeliveryStateDTO = {
  eligibleMicro: string;
  settlingMicro: string;
  parcelSizeMicro: string;
  prefs: { inactivityTimeoutSeconds: number; autoEnabled: boolean };
  helpers: HelperState[];
};

export function CityPlay(props: {
  cause: { id: string; title: string; slug: string };
  cityName: string;
  seed: number;
  mapType: MapType;
  stage: number;
  helpers: HelperRow[];
  totalHelpers: number;
  renderCap: number;
  signedIn: boolean;
  deliverable: boolean;
  initialState: DeliveryStateDTO | null;
  otherCauses: { id: string; title: string; cityName: string }[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const scene = useRef<CityScene | null>(null);
  const [state, setState] = useState<DeliveryStateDTO | null>(props.initialState);
  const [stats, setStats] = useState<{ fps: number; visible: number; total: number } | null>(null);
  const [modal, setModal] = useState(false);
  const [dest, setDest] = useState(props.cause.id);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [carrying, setCarrying] = useState(false);
  const [localIdle, setLocalIdle] = useState(false);
  const lastBeat = useRef(0);
  const lastInput = useRef(Date.now());
  const pendingKey = useRef<string | null>(null);

  const myHelper = state?.helpers.find((h) => h.causeId === props.cause.id) ?? null;
  const serverMode: "manual" | "auto" = myHelper?.control.mode ?? "auto";
  const mode: "manual" | "auto" = localIdle ? "auto" : serverMode;
  const eligible = BigInt(state?.eligibleMicro ?? "0");
  const parcels = state ? parcelCount(eligible, BigInt(state.parcelSizeMicro)) : 0;

  const sceneData = useCallback(
    (): CitySceneData => ({
      seed: props.seed,
      mapType: props.mapType,
      stage: props.stage,
      helpers: props.helpers,
      myHelperId: myHelper?.id ?? null,
      parcels: eligible > 0n ? Math.max(1, parcels) : 0,
      mode,
      renderCap: props.renderCap,
    }),
    [props.seed, props.mapType, props.stage, props.helpers, props.renderCap, myHelper?.id, eligible, parcels, mode],
  );

  const heartbeat = useCallback(async () => {
    lastInput.current = Date.now();
    setLocalIdle(false);
    if (!myHelper || Date.now() - lastBeat.current < 30_000) return;
    lastBeat.current = Date.now();
    try {
      setState(await api<DeliveryStateDTO>(`/api/helpers/${myHelper.id}/activity`, "POST"));
    } catch {
      /* heartbeat is best-effort */
    }
  }, [myHelper]);

  // mount scene once
  useEffect(() => {
    let s: CityScene | null = null;
    let cancelled = false;
    (async () => {
      const { CityScene } = await import("@/game/CityScene");
      if (cancelled || !el.current) return;
      s = new CityScene({
        onPlayerAction: () => void heartbeatRef.current(),
        onArriveAtHall: () => setModal(true),
        onPickup: () => setCarrying(true),
        onStats: setStats,
      });
      scene.current = s;
      await s.mount(el.current, sceneDataRef.current());
    })();
    return () => {
      cancelled = true;
      s?.destroy();
      scene.current = null;
    };
  }, []);

  const heartbeatRef = useRef(heartbeat);
  heartbeatRef.current = heartbeat;
  const sceneDataRef = useRef(sceneData);
  sceneDataRef.current = sceneData;

  useEffect(() => {
    scene.current?.update(sceneData());
  }, [sceneData]);

  // refresh eligible yield every 30 s; local idle detection mirrors the server rule
  useEffect(() => {
    if (!props.signedIn) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        setState(await api<DeliveryStateDTO>("/api/me"));
      } catch {
        /* ignore */
      }
      const timeout = (state?.prefs.inactivityTimeoutSeconds ?? 3600) * 1000;
      if (Date.now() - lastInput.current > timeout) setLocalIdle(true);
    }, 30_000);
    return () => clearInterval(t);
  }, [props.signedIn, state?.prefs.inactivityTimeoutSeconds]);

  async function deliver() {
    if (!myHelper && !props.signedIn) return;
    setBusy(true);
    pendingKey.current ??= idemKey("drop");
    try {
      const r = await api<{ delivery: { amountMicro: string } }>("/api/deliveries", "POST", { causeId: dest, helperId: myHelper?.id, idempotencyKey: pendingKey.current });
      pendingKey.current = null;
      scene.current?.deliveryResolved(true);
      setCarrying(false);
      setModal(false);
      setToast({ tone: "ok", text: `Delivery recorded: ${formatUsd(r.delivery.amountMicro, { precise: true })} of earned yield is queued for the next payout.` });
      setState(await api<DeliveryStateDTO>("/api/me"));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Delivery failed. Your parcels are still with you.";
      if (e instanceof ApiError && e.status < 500) pendingKey.current = null;
      setToast({ tone: "err", text: msg });
      scene.current?.deliveryResolved(false);
    } finally {
      setBusy(false);
    }
  }

  async function setPreference(pref: "manual" | "auto") {
    if (!myHelper) return;
    await api(`/api/helpers/${myHelper.id}`, "PATCH", { controlPreference: pref });
    lastBeat.current = 0;
    setLocalIdle(false);
    setState(await api<DeliveryStateDTO>("/api/me"));
    if (pref === "manual") scene.current?.takeControl();
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-[28px] border border-line bg-[#CFE6B8]" style={{ aspectRatio: "26 / 18" }}>
        <div ref={el} className="absolute inset-0" tabIndex={0} aria-label={`${props.cityName}, a top-down town. Tap the ground to walk your helper; use arrow keys or WASD.`} role="application" />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {myHelper ? (
            <Badge tone={mode === "manual" ? "orange" : "sky"}>{mode === "manual" ? "You're steering" : localIdle || myHelper.control.reason === "inactive" ? "Auto mode (you were away)" : "Auto mode"}</Badge>
          ) : (
            <Badge tone="ink">Watching</Badge>
          )}
          {carrying && <Badge tone="butter">Carrying parcels → Cause Hall</Badge>}
        </div>
        {stats && (
          <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-paper/85 px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
            showing {stats.visible} of {props.totalHelpers} helpers
          </div>
        )}
      </div>

      {toast && (
        <div role="status" className={cx("mt-3 rounded-2xl px-4 py-3 text-sm font-semibold", toast.tone === "ok" ? "bg-leaf-soft text-[#2f6b4a]" : "bg-berry-soft text-[#9c3a32]")}>
          {toast.text}
        </div>
      )}

      {props.signedIn && myHelper && (
        <div className="mt-4 grid gap-3 rounded-2xl border border-line bg-paper p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="text-sm">
            <div className="font-bold">
              {formatUsd(eligible, { precise: true })} of earned yield ready to deliver
              {BigInt(state?.settlingMicro ?? "0") > 0n && <span className="font-semibold text-ink-soft"> · {formatUsd(state!.settlingMicro, { precise: true })} still settling</span>}
            </div>
            <div className="text-ink-soft">
              {mode === "manual"
                ? "Walk to the reward depot to pick up parcels, then carry them to the Cause Hall. Playing never changes how much you earn."
                : `Your helper works on its own. Deliveries follow your auto rules. Inactive for ${(state?.prefs.inactivityTimeoutSeconds ?? 3600) / 60} minutes switches you to auto.`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === "auto" ? (
              <Button variant="secondary" sz="sm" onClick={() => setPreference("manual")}>
                Take control
              </Button>
            ) : (
              <Button variant="secondary" sz="sm" onClick={() => setPreference("auto")}>
                Let my helper auto-deliver
              </Button>
            )}
            <Button sz="sm" disabled={eligible <= 0n || !props.deliverable} onClick={() => setModal(true)}>
              Deliver now
            </Button>
          </div>
        </div>
      )}
      {props.signedIn && !myHelper && (
        <div className="mt-4 text-sm text-ink-soft">You don&apos;t have a helper in this town yet. Support it to get one.</div>
      )}
      {!props.signedIn && (
        <div className="mt-4 text-sm text-ink-soft">
          <Link href={`/login?next=/city/${props.cause.slug}`} className="font-bold text-orange-deep hover:underline">
            Sign in
          </Link>{" "}
          to bring your own helper.
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="deliver-title">
          <div className="w-full max-w-md rounded-3xl bg-paper p-6 shadow-[var(--shadow-lift)]">
            <div id="deliver-title" className="text-xl font-extrabold">
              Deliver your earned yield
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">
              This assigns <span className="num font-bold text-ink">{formatUsd(eligible, { precise: true })}</span> of yield your money has already earned. It joins the cause&apos;s next payout, which is
              sent on chain and shown with its transaction. Your principal is not touched.
            </p>
            <label className="label mt-4" htmlFor="dest">
              Deliver to
            </label>
            <select id="dest" className="field" value={dest} onChange={(e) => setDest(e.target.value)}>
              {props.deliverable && <option value={props.cause.id}>{props.cause.title} (this town)</option>}
              {props.otherCauses
                .filter((c) => c.id !== props.cause.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.cityName}
                  </option>
                ))}
            </select>
            {!props.deliverable && <p className="mt-2 text-xs text-ink-soft">This town&apos;s receiving account is still being verified, so choose another cause or keep your parcels for later.</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModal(false)}>
                Keep for later
              </Button>
              <Button onClick={deliver} disabled={busy || eligible <= 0n || (!props.deliverable && dest === props.cause.id)}>
                {busy ? "Recording…" : "Deliver"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
