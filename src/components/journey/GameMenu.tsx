"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/money";
import { MASCOT, btn, btnP, card } from "./shared";
import { JourneyWizard, type WizardMode } from "./JourneyWizard";

type HelperInfo = { id: string; animal: string; mascot: string; nickname: string; active: boolean; plantedMicro: string; town: { id: string; slug: string; title: string; cityName: string } | null };
export type JourneyState = {
  signedIn: boolean;
  onboarded?: boolean;
  sandbox?: boolean;
  helper?: { id: string | null; animal: string; mascot: string; nickname: string; count: number };
  helpers?: HelperInfo[];
  home?: { id: string; slug: string; title: string; cityName: string } | null;
  bank?: { principalMicro: string; withdrawingMicro: string; earnedMicro: string; ripeMicro: string; settlingMicro: string; pendingMicro: string; deliveredMicro: string; freePlay: boolean; dailyMicro?: string; aprBps?: number };
  golden?: { open: number; total: number };
  autoDelivery?: { authorised: boolean; schedule: string };
};

const money = (m?: string | bigint) => formatUsd(typeof m === "bigint" ? m : BigInt(m ?? "0"));
const sprite = (mascot: string) => `/game/sprites/mascots/${mascot}_front.png`;

/** A menu icon: the painted art if it exists (public/game/sprites/ui/<key>.png), else the emoji. */
function MenuIcon({ k, emoji, className = "" }: { k: string; emoji: string; className?: string }) {
  const [ok, setOk] = useState(true);
  return ok ? <img src={`/game/sprites/ui/${k}.png`} alt="" onError={() => setOk(false)} className={`object-contain ${className}`} /> : <span className={`flex items-center justify-center leading-none ${className}`}>{emoji}</span>;
}

/**
 * The game HUD shared by the town and the world map:
 *  · top right: your helper (tap to switch), what you've planted (+ to plant more) and what you've given
 *  · town only: three big buttons at the bottom: World map · Heart Tree · Helper
 */
export function GameHud({ where, onOpenTree, onChanged, hidden = false, leftSlot }: { where: "map" | "town"; onOpenTree?: () => void; onChanged?: () => void; hidden?: boolean; leftSlot?: React.ReactNode }) {
  const router = useRouter();
  const [j, setJ] = useState<JourneyState | null>(null);
  const [panel, setPanel] = useState<"none" | "helper">("none");
  const [wizard, setWizard] = useState<{ mode: WizardMode; causeId?: string } | null>(null);
  const [explain, setExplain] = useState(false); // "what do these numbers mean?"
  const load = useCallback(() => api<JourneyState>("/api/journey").then(setJ).catch(() => setJ({ signedIn: false })), []);
  useEffect(() => {
    void load();
  }, [load]);
  // "Plant more" from anywhere (e.g. the Heart Tree panel): window.dispatchEvent(new CustomEvent("hs:plant-more", { detail: causeId }))
  useEffect(() => {
    const on = (e: Event) => setWizard({ mode: "more", causeId: (e as CustomEvent<string | undefined>).detail });
    window.addEventListener("hs:plant-more", on);
    return () => window.removeEventListener("hs:plant-more", on);
  }, []);

  if (!j || hidden) return null;
  if (!j.signedIn || !j.onboarded) {
    return (
      <div className="pointer-events-auto absolute right-3 top-3 z-30 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        {leftSlot && <div className="fixed left-3 top-3 sm:left-4 sm:top-4">{leftSlot}</div>}
        <Link href={j.signedIn ? "/start" : "/login?next=/start"} className={`${btnP} flex items-center gap-2 px-4 py-3 text-sm`}>
          <span className="text-lg">🌱</span> Start helping
        </Link>
      </div>
    );
  }

  const b = j.bank!;
  const given = BigInt(b.deliveredMicro) + BigInt(b.pendingMicro);
  const active = j.helpers?.find((h) => h.active) ?? j.helpers?.[0];
  const plantMore = (causeId?: string) => setWizard({ mode: "more", causeId: causeId ?? active?.town?.id ?? j.home?.id });
  const done = async () => {
    setWizard(null);
    await load();
    onChanged?.();
  };
  const ripe = BigInt(b.ripeMicro) > 0n || (j.golden?.open ?? 0) > 0;

  return (
    <>
      {/* your helper: top right on the world map, top left in towns */}
      <div className={`pointer-events-auto absolute top-3 z-30 flex items-stretch gap-2 sm:top-4 ${where === "town" ? "left-3 sm:left-4" : "right-3 sm:right-4"}`}>
        <button onClick={() => { void load(); setPanel("helper"); }} title="Your helpers" className={`${card} flex items-center gap-2 py-1.5 pl-1.5 pr-3 transition hover:-translate-y-0.5`}>
          <span className="flex h-11 w-11 items-end justify-center overflow-hidden rounded-2xl border-2 border-[#8A6448] bg-[#FDE6D4]">
            <img src={sprite(j.helper?.mascot ?? "cat")} alt="" className="h-12 w-auto translate-y-1 object-contain" />
          </span>
          <span className="max-w-[110px] text-left leading-tight">
            <span className="block truncate text-sm font-black text-[#3A2A22]">{j.helper?.nickname}</span>
            <span className="block text-[10px] font-black text-[#C7601F]">{(j.helpers?.length ?? 0) > 1 ? "Switch helper ▾" : "My helper ▾"}</span>
          </span>
        </button>
      </div>

      {/* your money at work: top left on the world map (under Back), top right in towns */}
      <div className={`pointer-events-auto absolute top-3 z-30 flex flex-col gap-2 sm:top-4 ${where === "town" ? "right-3 items-end sm:right-4" : "left-3 items-start sm:left-4"}`}>
        {leftSlot}
        <div className={`${card} flex items-center gap-1 px-2 py-1.5`}>
          <button onClick={() => plantMore()} title="Plant more" className="flex items-center gap-1.5 rounded-xl px-2 py-1 transition hover:bg-[#FDE6D4]">
            <span className="text-lg">🌱</span>
            <span className="text-left leading-tight">
              <span className="num block text-sm font-black text-[#3A2A22]">{money(b.principalMicro)}</span>
              <span className="block text-[10px] font-bold text-[#7B6A5C]">my deposit</span>
            </span>
            <span className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#8A6448] bg-[#F58A3C] text-sm font-black leading-none text-white shadow-[0_2px_0_#8A6448]">+</span>
          </button>
          <div className="mx-0.5 h-8 w-px bg-[#E4D3BE]" />
          <div className="flex items-center gap-1.5 px-2 py-1" title="Delivered to causes (including parcels on the way)">
            <span className="text-lg">💛</span>
            <span className="leading-tight">
              <span className="num block text-sm font-black text-[#3A2A22]">{formatUsd(given, { precise: given > 0n && given < 1_000_000n })}</span>
              <span className="block text-[10px] font-bold text-[#7B6A5C]">donated</span>
            </span>
          </div>
          <div className="mx-0.5 h-8 w-px bg-[#E4D3BE]" />
          <div className="flex items-center gap-1.5 px-2 py-1" title={b.aprBps ? `Today's lending rate: ${(b.aprBps / 100).toFixed(2)}% a year` : "Interest your deposit earns for causes per day"}>
            <span className="text-lg">📈</span>
            <span className="leading-tight">
              <span className="num block text-sm font-black text-[#3F9B5B]">+{formatUsd(BigInt(b.dailyMicro ?? "0"), { precise: true })}</span>
              <span className="block text-[10px] font-bold text-[#7B6A5C]">donates / day</span>
            </span>
          </div>
          <button onClick={() => setExplain((x) => !x)} aria-label="What do these numbers mean?" className={`ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-black transition ${explain ? "border-[#8A6448] bg-[#8A6448] text-white" : "border-[#C9B39C] bg-white text-[#8A6448] hover:border-[#8A6448]"}`}>
            ?
          </button>
        </div>
        {explain && (
          <div className={`${card} hs-card-in w-[min(320px,calc(100vw-24px))] space-y-2 p-3 text-left`}>
            {[
              ["🌱", "My deposit", "The money you put in. It stays yours, and you can take it back any time."],
              ["📈", "Donates / day", `About how much interest your deposit earns for causes each day${b.aprBps ? ` (today's rate: ${(b.aprBps / 100).toFixed(2)}% a year)` : ""}. It grows as fruit on your Heart Tree.`],
              ["💛", "Donated", "Interest you've sent to causes so far, including fruit still being delivered."],
            ].map(([i, k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-lg leading-none">{i}</span>
                <span>
                  <span className="block text-xs font-black text-[#3A2A22]">{k}</span>
                  <span className="block text-[11px] font-semibold leading-snug text-[#7B6A5C]">{v}</span>
                </span>
              </div>
            ))}
            <div className="rounded-xl bg-[#F6EDE2] px-2.5 py-1.5 text-[11px] font-bold text-[#5C4A3D]">Tap <b>+</b> to add more. More deposit = more fruit for causes.</div>
          </div>
        )}
      </div>

      {/* town only: three big game buttons at the bottom centre */}
      {where === "town" && (
        <nav aria-label="Game menu" className="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 gap-2.5 sm:bottom-5 sm:gap-4">
          {[
            { k: "menu_map", emoji: "🗺️", label: "World map", on: () => {
              // start the road at the town you're standing in (not your home town)
              const here = window.location.pathname.match(/\/worldmap\/town\/([^/?#]+)/)?.[1] ?? j.home?.slug;
              router.push(here ? `/worldmap?from=${here}` : "/worldmap");
            } },
            { k: "menu_tree", emoji: "🌳", label: "Heart Tree", on: () => onOpenTree?.(), badge: ripe },
            { k: "menu_helper", emoji: "🐾", label: "Helper", on: () => { void load(); setPanel("helper"); } },
          ].map((it) => (
            <button key={it.k} onClick={it.on} aria-label={it.label} className="group relative flex flex-col items-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-[22px] border-[3px] border-[#8A6448] bg-gradient-to-b from-[#FFF4E2] to-[#F6D9B5] shadow-[0_5px_0_#8A6448,0_10px_18px_rgba(0,0,0,0.25)] transition group-hover:-translate-y-1 group-active:translate-y-[3px] group-active:shadow-[0_2px_0_#8A6448] sm:h-[76px] sm:w-[76px]">
                <MenuIcon k={it.k} emoji={it.emoji} className="h-11 w-11 text-4xl sm:h-[52px] sm:w-[52px]" />
              </span>
              <span className="mt-1.5 rounded-full border-2 border-[#8A6448] bg-[#FFF9F0] px-2.5 py-0.5 text-[11px] font-black text-[#3A2A22] shadow-[0_2px_0_#8A6448] sm:text-xs">{it.label}</span>
              {it.badge && <span className="absolute -right-1 -top-1 flex h-5 w-5 animate-bounce items-center justify-center rounded-full border-2 border-white bg-[#E2523F] text-[10px] font-black text-white">!</span>}
            </button>
          ))}
        </nav>
      )}

      {panel === "helper" && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-[#3A2A22]/35 p-3 sm:items-center" onClick={(e) => e.target === e.currentTarget && setPanel("none")}>
          <div className={`${card} hs-card-in max-h-[88vh] w-full max-w-lg overflow-y-auto p-5`}>
            <div className="mb-1 flex justify-end">
              <button onClick={() => setPanel("none")} aria-label="Close" className="rounded-full px-2 text-xl font-black text-[#7B6A5C] hover:bg-[#F6EDE2]">×</button>
            </div>
            <HelperPanel
              j={j}
              reload={async () => {
                await load();
                onChanged?.();
              }}
              onPlantMore={(causeId) => {
                setPanel("none");
                plantMore(causeId);
              }}
              onAdd={() => {
                setPanel("none");
                setWizard({ mode: "add" });
              }}
            />
          </div>
        </div>
      )}

      {wizard && (
        <div className="fixed inset-0 z-[70]">
          <JourneyWizard key={wizard.mode + (wizard.causeId ?? "")} mode={wizard.mode} causeId={wizard.causeId ?? active?.town?.id ?? j.home?.id} startStep={wizard.mode === "more" ? 2 : 0} sandbox={!!j.sandbox} onClose={() => setWizard(null)} onDone={done} />
        </div>
      )}
    </>
  );
}

/** Back-compat name. */
export const GameMenu = GameHud;

function HelperPanel({ j, reload, onPlantMore, onAdd }: { j: JourneyState; reload: () => Promise<unknown>; onPlantMore: (causeId?: string) => void; onAdd: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [animal, setAnimal] = useState("cat");
  const [nickname, setNickname] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = j.helpers ?? [];

  async function playAs(id: string) {
    setBusy(true);
    try {
      await api("/api/journey", "POST", { action: "activeHelper", helperId: id });
      await reload();
      setMsg("Switched! Your helper is on the way.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not switch.");
    } finally {
      setBusy(false);
    }
  }
  async function save(id: string) {
    setBusy(true);
    try {
      await api("/api/journey", "POST", { action: "renameHelper", helperId: id, animal, nickname: nickname.trim() || MASCOT[animal].label });
      await reload();
      setEditing(null);
      setMsg("Saved!");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Your team</div>
      <div className="text-2xl font-black text-[#3A2A22]">Helpers</div>
      <p className="text-xs font-semibold text-[#7B6A5C]">Each helper looks after one town. What you plant for a town grows fruit for it.</p>

      <div className="mt-3 space-y-2.5">
        {list.map((h) => (
          <div key={h.id} className={`rounded-2xl border-[2.5px] p-3 ${h.active ? "border-[#F58A3C] bg-[#FFF1E6] shadow-[0_3px_0_#E46F3E]" : "border-[#E4D3BE] bg-white"}`}>
            <div className="flex items-center gap-3">
              <span className="flex h-16 w-16 shrink-0 items-end justify-center overflow-hidden rounded-2xl border-2 border-[#8A6448] bg-[#FDE6D4]">
                <img src={sprite(h.mascot)} alt="" className="h-[68px] w-auto translate-y-1.5 object-contain" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-lg font-black text-[#3A2A22]">{h.nickname}</span>
                  {h.active && <span className="rounded-full bg-[#F58A3C] px-2 py-0.5 text-[10px] font-black text-white">PLAYING</span>}
                </div>
                <div className="truncate text-xs font-bold text-[#7B6A5C]">📍 {h.town ? `${h.town.cityName} · ${h.town.title}` : "No town yet"}</div>
                <div className="mt-0.5 text-xs font-black text-[#3F9B5B]">🌱 {BigInt(h.plantedMicro) > 0n ? `${money(h.plantedMicro)} planted` : "Nothing planted yet"}</div>
              </div>
            </div>
            {editing === h.id ? (
              <div className="mt-3">
                <div className="grid grid-cols-8 gap-1">
                  {Object.keys(MASCOT).map((a) => (
                    <button key={a} onClick={() => setAnimal(a)} className={`rounded-lg border-2 p-0.5 ${animal === a ? "border-[#F58A3C] bg-[#FDE6D4]" : "border-[#E2D3C2] bg-white"}`} aria-label={MASCOT[a].label}>
                      <img src={`/mascots/${MASCOT[a].img}.png`} alt="" className="mx-auto h-8 w-8 object-contain" />
                    </button>
                  ))}
                </div>
                <input value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} aria-label="Helper name" className="mt-2 w-full rounded-xl border-2 border-[#E2D3C2] bg-white px-3 py-2 font-bold outline-none focus:border-[#F58A3C]" />
                <div className="mt-2 flex gap-2">
                  <button disabled={busy} onClick={() => save(h.id)} className={`${btnP} flex-1 py-2 text-sm`}>Save</button>
                  <button onClick={() => setEditing(null)} className={`${btn} px-4 py-2 text-sm`}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {!h.active && <button disabled={busy} onClick={() => playAs(h.id)} className={`${btnP} px-3 py-1.5 text-xs`}>▶ Play as {h.nickname}</button>}
                <button onClick={() => onPlantMore(h.town?.id)} className={`${btn} px-3 py-1.5 text-xs`}>🌱 Plant more</button>
                <button onClick={() => { setEditing(h.id); setAnimal(h.animal); setNickname(h.nickname); }} className={`${btn} px-3 py-1.5 text-xs`}>✏️ Rename</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="mt-2 text-center text-sm font-bold text-[#3F9B5B]">{msg}</p>}

      <button onClick={onAdd} className={`${btnP} mt-4 w-full py-3 text-base`}>
        + Add a helper for another town
      </button>
      <div className="mt-3 rounded-2xl bg-[#F6EDE2] p-3 text-[11px] font-semibold text-[#5C4A3D]">
        <b>🚚 Auto-send daily is {j.autoDelivery?.authorised ? "on" : "off"}.</b> {j.autoDelivery?.authorised ? "Your helpers send ripe fruit to your home town every day." : "Fruit waits on your tree until you send it."} Change it on your Heart Tree.
      </div>
    </div>
  );
}
