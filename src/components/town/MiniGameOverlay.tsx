"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatRes, TIER_NAMES, type StoneRound, type WoodRound } from "@/game/v4/rules";
import type { Mascot } from "@/game/world/mascots";
import type { StoneScene, WoodScene } from "@/game/v4/scenes";
import { isMuted, setMuted, sfx } from "@/game/v4/sfx";

export type SessionView = {
  id: string;
  resource: "wood" | "stone";
  status: "open" | "ended";
  endReason: string | null;
  hearts: number;
  combo: number;
  bestCombo: number;
  round: number;
  earnedMicro: string;
  baseRewardMicro: string;
  capMicro: string;
  stats: { perfect: number; hit: number; miss: number; fakeouts: number; flags: string[] };
  chart: WoodRound | StoneRound | null;
};

const END_TEXT: Record<string, string> = {
  hearts: "Out of hearts",
  cap: "Session cap reached (1,000)",
  quit: "You stopped",
  timeout: "Time's up",
  building_done: "This resource is complete for the building!",
  invalid: "Session flagged by anti-automation checks; nothing was committed",
  ineligible: "No active deposit",
};

const card = "rounded-[22px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0] shadow-[0_4px_0_#8A644833]";
const btnBase = "rounded-2xl border-[2.5px] border-[#8A6448] font-extrabold text-[#3A2A22] shadow-[0_3px_0_#8A6448] active:translate-y-[2px] active:shadow-[0_1px_0_#8A6448] transition disabled:opacity-50";
const btn = `${btnBase} bg-[#FFF9F0]`;
const btnP = `${btnBase} bg-[#F58A3C] text-white`;

export function MiniGameOverlay({ session: initial, mascot, buildingName, onClose }: { session: SessionView; mascot: Mascot; buildingName: string; onClose: (s: SessionView) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const scene = useRef<WoodScene | StoneScene | null>(null);
  const [s, setS] = useState(initial);
  const [predHearts, setPredHearts] = useState(initial.hearts);
  const [predCombo, setPredCombo] = useState(initial.combo);
  const [phase, setPhase] = useState<"intro" | "play" | "judging" | "done">("intro");
  const [err, setErr] = useState<string | null>(null);
  const [roundSummary, setRoundSummary] = useState<string | null>(null);
  const [muted, setMute] = useState(isMuted());
  const live = useRef(true);
  const isWood = s.resource === "wood";

  useEffect(() => {
    live.current = true;
    let sc: WoodScene | StoneScene | null = null;
    (async () => {
      const mod = await import("@/game/v4/scenes");
      const onLocal = (r: string) => {
        if (r === "miss") {
          setPredHearts((h) => Math.max(0, h - 1));
          setPredCombo(0);
        } else if (r === "perfect" || r === "hit") setPredCombo((c) => c + 1);
      };
      sc = initial.resource === "wood" ? new mod.WoodScene(mascot, onLocal) : new mod.StoneScene(mascot, onLocal);
      scene.current = sc;
      if (process.env.NODE_ENV === "development") (window as unknown as { __hsScene?: unknown }).__hsScene = sc; // dev-only debugging handle
      if (el.current) await sc.mount(el.current);
    })();
    return () => {
      live.current = false;
      sc?.destroy();
      scene.current = null;
    };
  }, [initial.resource, mascot]);

  async function run(first: SessionView) {
    setPhase("play");
    let cur = first;
    while (live.current && cur.status === "open" && cur.chart) {
      const sc = scene.current;
      if (!sc) break;
      setPredHearts(cur.hearts);
      setPredCombo(cur.combo);
      let body: Record<string, unknown>;
      if (cur.chart.game === "wood") body = { action: "round", round: cur.round, swings: await (sc as WoodScene).play(cur.chart) };
      else body = { action: "round", round: cur.round, strikes: await (sc as StoneScene).play(cur.chart) };
      if (!live.current) return;
      setPhase("judging");
      try {
        const r = await api<{ session: SessionView; applied: { result: string; rewardMicro: string }[] }>(`/api/minigame/${cur.id}`, "POST", body);
        cur = r.session;
        setS(cur);
        const p = r.applied.filter((a) => a.result === "perfect").length, h = r.applied.filter((a) => a.result === "hit").length, m = r.applied.filter((a) => a.result === "miss").length;
        const gained = r.applied.reduce((a, x) => a + BigInt(x.rewardMicro), 0n);
        setRoundSummary(`Server check: ${p} perfect · ${h} hit · ${m} miss · +${formatRes(gained)} ${cur.resource}`);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Connection problem. Your progress so far is saved.");
        try {
          cur = (await api<{ session: SessionView }>(`/api/minigame/${cur.id}`, "POST", { action: "quit" })).session;
          setS(cur);
        } catch {
          /* the server ends idle sessions on its own */
        }
        break;
      }
      if (cur.status === "open") {
        setPhase("play");
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    if (cur.status === "ended") {
      if (cur.endReason === "hearts" || cur.endReason === "invalid") sfx.over();
      else sfx.win();
    }
    setPhase("done");
  }

  async function quit() {
    live.current = false;
    try {
      const r = await api<{ session: SessionView }>(`/api/minigame/${s.id}`, "POST", { action: "quit" });
      setS(r.session);
    } catch {
      /* ignore */
    }
    setPhase("done");
  }

  const hearts = phase === "done" ? s.hearts : Math.min(s.hearts, predHearts);
  const tier = s.chart ? TIER_NAMES[s.chart.tier] : "";
  const stoneButtons = s.chart && s.chart.game === "stone" ? s.chart.buttons : 0;

  return (
    <div className="fixed inset-0 z-50 bg-[#3A2A22]/60" role="dialog" aria-modal="true" aria-label={isWood ? "Wood chopping mini-game" : "Stone mining mini-game"}>
      <div ref={el} className="absolute inset-0" />
      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 sm:p-4">
        <div className={`${card} pointer-events-auto flex items-center gap-3 px-3 py-2`}>
          <span className="text-2xl" aria-hidden>{isWood ? "🪓" : "⛏️"}</span>
          <div className="leading-tight">
            <div className="text-sm font-black">{isWood ? "Wood · Rhythm Chopping" : "Stone · Rhythm Memory"}</div>
            <div className="text-[11px] font-bold text-[#7B6A5C]">for {buildingName} · {tier} · round {s.round + 1}</div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className={`${card} flex items-center gap-3 px-3 py-2`}>
            <div className="text-xl tracking-wider text-[#E2523F]" aria-label={`${hearts} hearts`}>{"♥".repeat(hearts)}<span className="text-[#D9CBBB]">{"♥".repeat(Math.max(0, 3 - hearts))}</span></div>
            <div className="text-center leading-tight"><div className="num text-lg font-black">×{phase === "done" ? s.combo : predCombo}</div><div className="text-[10px] font-bold text-[#7B6A5C]">combo</div></div>
            <div className="text-right leading-tight"><div className="num text-lg font-black">{formatRes(s.earnedMicro)}</div><div className="text-[10px] font-bold text-[#7B6A5C]">of 1,000 {s.resource}</div></div>
          </div>
          <button onClick={() => { setMuted(!muted); setMute(!muted); }} className={`${btn} pointer-events-auto h-11 w-11`} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
          {phase !== "done" && <button onClick={quit} className={`${btn} pointer-events-auto px-3 py-2 text-sm`}>Quit</button>}
        </div>
      </div>
      {roundSummary && phase !== "intro" && phase !== "done" && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-[#3A2A22]/80 px-4 py-1.5 text-xs font-bold text-[#FFF9F0]">{roundSummary}</div>
      )}
      {phase === "judging" && <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-[#FFF9F0] px-4 py-1.5 text-sm font-black">Checking with the server…</div>}

      {/* Stone touch buttons */}
      {!isWood && phase !== "done" && phase !== "intro" && (
        <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3 px-4">
          {[0, 1, 2, 3].map((b) => (
            <button
              key={b}
              disabled={b >= stoneButtons}
              onPointerDown={(e) => { e.preventDefault(); (scene.current as StoneScene | null)?.press(b); }}
              className={`${btn} h-16 w-16 text-lg sm:h-14 sm:w-20`}
              style={{ background: b < stoneButtons ? ["#F2A65A", "#E27396", "#4FB3A9", "#9C7CD4"][b] : undefined, color: "#3A2A22" }}
            >
              {["D", "F", "J", "K"][b]}
            </button>
          ))}
        </div>
      )}

      {phase === "intro" && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className={`${card} w-full max-w-md p-6 text-center`}>
            <div className="text-4xl">{isWood ? "🪓" : "⛏️"}</div>
            <div className="mt-2 text-2xl font-black">{isWood ? "Rhythm Chopping" : "Rhythm Memory Mining"}</div>
            <p className="mt-2 text-sm font-semibold text-[#5C4A3D]">
              {isWood
                ? "Your friend sets logs on the stump. Swing (Space, click or tap) the moment each log lands in the green. If they pull a log back, don't swing!"
                : "The miner plays a rhythm on the rocks. Watch and listen, then repeat it: the right rock (D F J K or the buttons) at the right time."}
            </p>
            <ul className="mt-3 space-y-1 text-left text-xs font-bold text-[#7B6A5C]">
              <li>♥ 3 hearts · a Miss costs one · Perfect = 2× · combos add up to 2× more</li>
              <li>Up to 1,000 {s.resource} per session, then a 5-minute {s.resource} cooldown</li>
              <li>The server picked {s.resource} for this building. You earn {formatRes(s.baseRewardMicro)} per Hit, based on your active deposit</li>
              <li>Everything you earn goes straight into the building, even if you run out of hearts</li>
            </ul>
            <button onClick={() => { sfx.tick(true); void run(s); }} className={`${btnP} mt-5 w-full py-3`}>Start</button>
          </div>
        </div>
      )}

      {phase === "done" && <EndCard s={s} err={err} buildingName={buildingName} onClose={() => onClose(s)} />}
    </div>
  );
}

function EndCard({ s, err, buildingName, onClose }: { s: SessionView; err: string | null; buildingName: string; onClose: () => void }) {
  const [ad, setAd] = useState<"ask" | "loading" | "showing" | "thanks" | "later">("ask");
  const [adMsg, setAdMsg] = useState<string | null>(null);
  const [left, setLeft] = useState(5);
  const [view, setView] = useState<{ viewId: string; simulated: boolean; creative: { title: string; body: string } } | null>(null);
  useEffect(() => {
    if (ad !== "showing") return;
    const t = window.setInterval(() => setLeft((x) => x - 1), 1000);
    return () => window.clearInterval(t);
  }, [ad]);
  useEffect(() => {
    if (ad === "showing" && left <= 0 && view) {
      void api("/api/ads", "POST", { action: "complete", viewId: view.viewId }).catch(() => {});
      setAd("thanks");
    }
  }, [ad, left, view]);
  async function watch() {
    setAd("loading");
    try {
      const r = await api<{ ad: typeof view }>("/api/ads", "POST", { action: "request", placement: "after_minigame" });
      if (!r.ad) {
        setAdMsg("No ad available right now. Thank you anyway!");
        setAd("later");
        return;
      }
      setView(r.ad);
      setLeft(5);
      setAd("showing");
    } catch (e) {
      setAdMsg(e instanceof ApiError ? e.message : "No ad right now.");
      setAd("later");
    }
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className={`${card} w-full max-w-md p-6`}>
        <div className="text-center">
          <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{END_TEXT[s.endReason ?? ""] ?? "Session over"}</div>
          <div className="mt-1 text-3xl font-black">+{formatRes(s.earnedMicro)} {s.resource === "wood" ? "Wood" : "Stone"}</div>
          <div className="text-sm font-bold text-[#7B6A5C]">added to {buildingName} for everyone</div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-bold">
            <div className="rounded-xl bg-[#E4F4E6] p-2"><div className="num text-lg font-black text-[#3F9B5B]">{s.stats.perfect}</div>perfect</div>
            <div className="rounded-xl bg-[#FBF0CF] p-2"><div className="num text-lg font-black text-[#B98A12]">{s.stats.hit}</div>hit</div>
            <div className="rounded-xl bg-[#FBE1DD] p-2"><div className="num text-lg font-black text-[#C8463A]">{s.stats.miss}</div>miss</div>
            <div className="rounded-xl bg-[#DCEFF9] p-2"><div className="num text-lg font-black text-[#2F6E92]">{s.resource === "wood" ? s.stats.fakeouts : s.bestCombo}</div>{s.resource === "wood" ? "reads" : "best combo"}</div>
          </div>
          <p className="mt-3 text-[11px] font-semibold text-[#7B6A5C]">{s.resource === "wood" ? "Wood" : "Stone"} cools down for 5 minutes. Wood and Stone are virtual building materials with no money value. Playing never changes your real yield.</p>
          {err && <p className="mt-2 text-xs font-bold text-[#C8463A]">{err}</p>}
        </div>

        {/* optional ad: never rewards, never required */}
        <div className="mt-4 rounded-2xl border-2 border-dashed border-[#E2C9AE] bg-[#FFF4E8] p-4">
          {ad === "ask" && (
            <>
              <div className="font-black">Help Hugshire Grow ❤️</div>
              <p className="text-xs font-semibold text-[#5C4A3D]">Optional ads help fund the Community Heart Pool. Watching gives you nothing extra, and skipping costs you nothing.</p>
              <div className="mt-3 flex gap-2">
                <button onClick={watch} className={`${btn} flex-1 py-2 text-sm`}>Watch Ad</button>
                <button onClick={() => setAd("later")} className={`${btn} flex-1 py-2 text-sm`}>Maybe Later</button>
              </div>
            </>
          )}
          {ad === "loading" && <div className="text-sm font-bold">Loading…</div>}
          {ad === "showing" && view && (
            <div className="text-center">
              <div className="mx-auto mb-2 w-fit rounded-full bg-[#3A2A22] px-3 py-0.5 text-[10px] font-black text-[#FFF9F0]">{view.simulated ? "SIMULATED AD · NO ADVERTISER · NO REVENUE" : "AD"}</div>
              <div className="font-black">{view.creative.title}</div>
              <p className="text-xs font-semibold text-[#5C4A3D]">{view.creative.body}</p>
              <div className="num mt-2 text-sm font-black">{Math.max(0, left)}s</div>
            </div>
          )}
          {ad === "thanks" && <div className="text-sm font-bold">Thank you! {view?.simulated ? "(This was a simulated ad, so no revenue was created.)" : ""}</div>}
          {ad === "later" && <div className="text-sm font-bold text-[#7B6A5C]">{adMsg ?? "No problem. Enjoy the town!"}</div>}
        </div>
        <button onClick={onClose} className={`${btnP} mt-4 w-full py-3`}>Back to town</button>
      </div>
    </div>
  );
}
