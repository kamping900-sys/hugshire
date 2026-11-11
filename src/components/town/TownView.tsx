"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, idemKey } from "@/lib/api";
import { formatUsd } from "@/lib/money";
import { formatRes } from "@/game/v4/rules";
import { BLUEPRINTS, STAGE_NAMES, stageOf, type Plot } from "@/game/v4/town";
import type { Interactable, TownGame, TownProject } from "@/game/v4/TownGame";
import type { Mascot } from "@/game/world/mascots";
import { MiniGameOverlay, type SessionView } from "./MiniGameOverlay";

type Notice = { id: string; title: string; body: string; category: string; mediaUrl: string | null; linkUrl: string | null; createdAt: string; provenance: "organisation_reported" | "verified_by_hugshire" };
type Golden = { allocationId: string; period: string; simulated: boolean; amountMicro: string; status: string; choices: { causeId: string; bps: number; title: string }[]; choiceSource: string | null; canChoose: boolean; choiceDeadline: string | null };
type Tree = { red: { accruingMicro: string; eligibleMicro: string; pendingMicro: string; deliveredMicro: string; fruits: string[]; buds: number }; golden: Golden[] };
type Me = {
  userId: string;
  mascot: Mascot;
  nickname: string;
  game: { eligible: boolean; principalMicro: string; baseRewardMicro: string; autoPerHourMicro: string; cooldowns: { wood: number | null; stone: number | null }; ownProject: (TownProject & { causeTitle: string; cityName: string }) | null; openSessionId: string | null };
  tree: Tree;
};
type Snapshot = { town: { id: string; slug: string; title: string; summary: string; category: string; cityName: string; seed: number; org: string; isSample: boolean; deliverable: boolean }; projects: (TownProject & { initiatorId: string | null })[]; notices: Notice[]; me: Me | null };
type WorldTown = { id: string; slug: string; title: string; cityName: string };

const card = "rounded-[22px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0]/95 shadow-[0_4px_0_#8A644833,0_10px_30px_-12px_#3A2A2266] backdrop-blur";
const btnBase = "rounded-2xl border-[2.5px] border-[#8A6448] font-extrabold text-[#3A2A22] shadow-[0_3px_0_#8A6448] active:translate-y-[2px] active:shadow-[0_1px_0_#8A6448] transition disabled:opacity-50";
const btn = `${btnBase} bg-[#FFF9F0]`;
const btnP = `${btnBase} bg-[#F58A3C] text-white`;
const usd = (m: string | bigint) => formatUsd(typeof m === "string" ? BigInt(m) : m, { precise: true });
const lsGet = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

export function TownView({ slug }: { slug: string }) {
  const el = useRef<HTMLDivElement>(null);
  const game = useRef<TownGame | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [near, setNear] = useState<Interactable | null>(null);
  const [open, setOpen] = useState<Interactable | null>(null);
  const [others, setOthers] = useState(0);
  const [session, setSession] = useState<{ s: SessionView; building: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [towns, setTowns] = useState<WorldTown[]>([]);
  const [now, setNow] = useState(Date.now());

  const flash = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 4500);
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api<Snapshot>(`/api/town/${slug}`);
      setSnap(s);
      return s;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load this town.");
      return null;
    }
  }, [slug]);

  useEffect(() => {
    void load();
    fetch("/api/world").then((r) => r.json()).then((j) => setTowns(j.towns ?? [])).catch(() => {});
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [load]);

  // mount the engine once
  const seed = snap?.town.seed;
  const mascot = snap?.me?.mascot ?? "cat";
  const nickname = snap?.me?.nickname ?? "Visitor";
  useEffect(() => {
    if (seed === undefined) return;
    let g: TownGame | null = null;
    let dead = false;
    (async () => {
      const { TownGame } = await import("@/game/v4/TownGame");
      if (dead || !el.current) return;
      g = new TownGame(seed, mascot as Mascot, nickname, { onNear: setNear, onInteract: setOpen });
      game.current = g;
      if (process.env.NODE_ENV === "development") (window as unknown as { __hsTown?: unknown }).__hsTown = g; // dev-only debugging handle
      await g.mount(el.current);
      if (!dead) setReady(true);
    })();
    return () => {
      dead = true;
      g?.destroy();
      game.current = null;
      setReady(false);
    };
  }, [seed, mascot, nickname]);

  // push shared state into the engine
  useEffect(() => {
    if (!ready || !snap) return;
    game.current?.setProjects(snap.projects);
    const t = snap.me?.tree;
    const goldenRipe = t?.golden.filter((g) => g.canChoose && g.status === "allocated").length ?? 0;
    game.current?.setTree({ fruits: t?.red.fruits.length ?? 0, buds: t?.red.buds ?? 0, golden: goldenRipe });
    const latest = snap.notices[0]?.createdAt;
    game.current?.setBoardNew(!!latest && lsGet(`hs-board-${slug}`) !== latest);
  }, [ready, snap, slug]);

  // presence + shared building state, every 2 s (signed in), or a slower refresh for visitors
  useEffect(() => {
    if (!ready || !snap) return;
    const signedIn = !!snap.me;
    const t = window.setInterval(async () => {
      if (document.hidden) return;
      const p = game.current?.position();
      if (signedIn && p) {
        try {
          const r = await api<{ others: Parameters<TownGame["setOthers"]>[0]; projects: Snapshot["projects"] }>(`/api/town/${slug}/presence`, "POST", { ...p, working: !!session });
          game.current?.setOthers(r.others);
          game.current?.setProjects(r.projects);
          setOthers(r.others.length);
          setSnap((s) => (s ? { ...s, projects: r.projects } : s));
        } catch {
          /* transient */
        }
      } else void load();
    }, signedIn ? 2000 : 6000);
    const slow = window.setInterval(() => !document.hidden && void load(), 15000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(slow);
    };
  }, [ready, snap?.me, slug, session, load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    game.current?.setPaused(!!session || !!open);
  }, [session, open]);

  if (err) {
    return (
      <div className="flex h-full items-center justify-center bg-[#BFE0A6] p-6">
        <div className={`${card} max-w-sm p-6 text-center`}>
          <div className="text-xl font-black">{err}</div>
          <Link href="/worldmap" className={`${btn} mt-4 inline-block px-4 py-2`}>Back to the world map</Link>
        </div>
      </div>
    );
  }

  const me = snap?.me ?? null;
  const projectAt = (key: string) => snap?.projects.find((p) => p.plotKey === key);
  const prompt =
    near?.kind === "board" ? "Read the Notice Board" : near?.kind === "tree" ? "Visit your Heart Tree" : near?.kind === "plot" ? (projectAt(near.plot.key) ? (projectAt(near.plot.key)!.status === "completed" ? "Admire the building" : "Help build here") : "Start a building here") : null;

  async function work(p: TownProject, name: string) {
    try {
      const r = await api<{ kind: "play"; session: SessionView } | { kind: "wait"; untilMs: number } | { kind: "done" }>("/api/minigame/start", "POST", { projectId: p.id });
      if (r.kind === "play") {
        setOpen(null);
        setSession({ s: r.session, building: name });
      } else if (r.kind === "wait") flash(`Your helpers are resting. Wood and Stone are both cooling down: back in ${Math.max(1, Math.ceil((r.untilMs - Date.now()) / 1000))} s.`);
      else flash("This building is complete!");
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "Could not start.");
    }
  }

  return (
    <div className="absolute inset-0 select-none font-sans text-[#3A2A22]">
      <div ref={el} className="absolute inset-0" role="application" aria-label="Town. WASD or arrow keys to walk, click to move, E to interact." />
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#BFE0A6]">
          <img src="/brand/logo.png" alt="" className="h-20 w-20 animate-bounce rounded-[22px]" />
          <div className="font-extrabold">Walking into town…</div>
        </div>
      )}

      {snap && (
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100vw-24px)] flex-col gap-2 sm:left-4 sm:top-4">
          <div className={`${card} pointer-events-auto flex items-center gap-3 py-2 pl-2 pr-4`}>
            <Link href="/worldmap" className={`${btn} px-2.5 py-1.5 text-sm`} aria-label="Back to the world map">← Map</Link>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-lg font-black">{snap.town.cityName}</div>
              <div className="truncate text-xs font-bold text-[#7B6A5C]">{snap.town.title} · {snap.town.org}{snap.town.isSample ? " (sample)" : ""}</div>
            </div>
          </div>
          <div className={`${card} pointer-events-auto px-3 py-2 text-xs font-bold text-[#7B6A5C]`}>
            {others > 0 ? `${others} other ${others === 1 ? "helper is" : "helpers are"} here` : "You're the only visitor right now"} · {snap.projects.filter((p) => p.status === "completed").length} built · {snap.projects.filter((p) => p.status !== "completed").length} under construction
          </div>
        </div>
      )}

      {me ? (
        <div className={`${card} pointer-events-auto absolute right-3 top-3 w-[min(320px,calc(100vw-24px))] p-3 sm:right-4 sm:top-4`}>
          <div className="flex items-center gap-3">
            <img src={`/mascots/${me.mascot}.png`} alt="" className="h-12 w-12 rounded-2xl border-2 border-[#8A6448] bg-white object-cover" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-black">{me.nickname}</div>
              <div className="text-[11px] font-bold text-[#7B6A5C]">
                {me.game.eligible ? `Active deposit ${usd(me.game.principalMicro)} · ${formatRes(me.game.baseRewardMicro)} per Hit` : "No active deposit: support a cause to build"}
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-center text-[11px] font-bold">
            {(["wood", "stone"] as const).map((r) => {
              const cd = me.game.cooldowns[r];
              const left = cd ? Math.max(0, Math.ceil((cd - now) / 1000)) : 0;
              return (
                <div key={r} className={`rounded-xl p-1.5 ${left ? "bg-[#EEE6DA] text-[#7B6A5C]" : r === "wood" ? "bg-[#F6E1C6]" : "bg-[#E3E7EC]"}`}>
                  {r === "wood" ? "🪵 Wood" : "🪨 Stone"} · {left ? `rest ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "ready"}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl bg-[#FDE6D4] px-2.5 py-1.5 text-[11px] font-black text-[#C7601F]">
            <span>❤ Heart Tree: {me.tree.red.fruits.length} ripe · {usd(me.tree.red.eligibleMicro)}</span>
            <button onClick={() => setOpen({ kind: "tree" })} className="underline">open</button>
          </div>
          {me.game.ownProject && <div className="mt-1.5 text-[11px] font-bold text-[#7B6A5C]">Your building: {BLUEPRINTS.find((b) => b.key === me.game.ownProject!.blueprintKey)?.name} in {me.game.ownProject.cityName}</div>}
          <div className="mt-1 text-[10px] font-semibold text-[#9A887A]">Workers add ~{formatRes(me.game.autoPerHourMicro)} per hour while you&apos;re away (no bonuses).</div>
        </div>
      ) : (
        snap && (
          <div className={`${card} absolute right-3 top-3 w-[min(300px,calc(100vw-24px))] p-4 text-sm sm:right-4 sm:top-4`}>
            <div className="font-black">Visiting as a guest</div>
            <p className="mt-1 text-xs font-semibold text-[#7B6A5C]">Sign in to build, play the Wood and Stone games and grow your Heart Tree.</p>
            <Link href={`/login?next=/worldmap/town/${slug}`} className={`${btnP} mt-3 inline-block px-4 py-2 text-sm`}>Sign in</Link>
          </div>
        )
      )}

      {near && prompt && !open && !session && (
        <button onClick={() => setOpen(near)} className={`${btn} absolute bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 text-sm`}>
          {prompt} <kbd className="ml-1 rounded-md border border-[#C9B39C] bg-white px-1.5 text-xs">E</kbd>
        </button>
      )}
      {!near && ready && !open && !session && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 hidden -translate-x-1/2 rounded-full bg-[#3A2A22]/70 px-4 py-1.5 text-xs font-bold text-[#FFF9F0] sm:block">WASD / arrows or click to walk · E to interact · scroll to zoom</div>
      )}

      {open && snap && (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-[#3A2A22]/30 p-3 sm:items-center" onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className={`${card} max-h-[86vh] w-full max-w-lg overflow-y-auto p-5`}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setOpen(null)} aria-label="Close" className="rounded-full px-2 text-xl font-black text-[#7B6A5C] hover:bg-[#F6EDE2]">×</button>
            </div>
            {open.kind === "plot" && <PlotPanel plot={open.plot} snap={snap} onStarted={async () => { await load(); flash("Building started! Press Work to help."); }} onWork={work} flash={flash} />}
            {open.kind === "board" && <BoardPanel notices={snap.notices} slug={slug} signedIn={!!me} onSeen={() => { if (snap.notices[0]) lsSet(`hs-board-${slug}`, snap.notices[0].createdAt); game.current?.setBoardNew(false); }} flash={flash} />}
            {open.kind === "tree" && (me ? <TreePanel tree={me.tree} town={snap.town} towns={towns} onChanged={load} flash={flash} /> : <p className="text-sm font-semibold">Sign in to see your Heart Tree.</p>)}
          </div>
        </div>
      )}

      {session && (
        <MiniGameOverlay
          session={session.s}
          mascot={mascot as Mascot}
          buildingName={session.building}
          onClose={async (s) => {
            setSession(null);
            await load();
            if (BigInt(s.earnedMicro) > 0n) flash(`Thanks! ${formatRes(s.earnedMicro)} ${s.resource} went into ${session.building}.`);
          }}
        />
      )}

      {toast && <div className="pointer-events-none absolute left-1/2 top-24 z-50 w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl border-[2.5px] border-[#8A6448] bg-[#FFF9F0] px-4 py-2.5 text-center text-sm font-bold shadow-lg">{toast}</div>}
    </div>
  );
}

// ───────────────────────────── panels ─────────────────────────────

function Bar({ have, need, color, label }: { have: string | bigint; need: string | bigint; color: string; label: string }) {
  const h = BigInt(have), n = BigInt(need) || 1n;
  const pct = Number((h * 1000n) / n) / 10;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-black"><span>{label}</span><span className="num">{formatRes(h, 2)} / {formatRes(n, 0)}</span></div>
      <div className="h-3 rounded-full bg-[#EADCC8]"><div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} /></div>
    </div>
  );
}

function PlotPanel({ plot, snap, onStarted, onWork, flash }: { plot: Plot; snap: Snapshot; onStarted: () => void; onWork: (p: TownProject, name: string) => void; flash: (t: string) => void }) {
  const p = snap.projects.find((q) => q.plotKey === plot.key);
  const me = snap.me;
  const options = BLUEPRINTS.filter((b) => b.size === plot.size);
  const [pick, setPick] = useState(options[0]?.key);
  const [busy, setBusy] = useState(false);
  const sizeName = plot.size === "S" ? "Small" : plot.size === "M" ? "Medium" : "Large";
  if (!p) {
    const blocked = !me ? "Sign in to start a building." : !me.game.eligible ? "An active deposit is needed to start building." : me.game.ownProject ? "You already started a building that isn't finished. You can still help on others!" : null;
    return (
      <div>
        <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{sizeName} plot</div>
        <div className="text-2xl font-black">Start a community building</div>
        <p className="mt-1 text-sm font-semibold text-[#7B6A5C]">Pick a blueprint. Everyone in town can then help gather Wood and Stone for it.</p>
        <div className="mt-3 grid gap-2">
          {options.map((b) => (
            <label key={b.key} className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 p-3 ${pick === b.key ? "border-[#F58A3C] bg-[#FDE6D4]/60" : "border-[#E2D3C2]"}`}>
              <input type="radio" name="bp" className="sr-only" checked={pick === b.key} onChange={() => setPick(b.key)} />
              <span><span className="block font-black">{b.name}</span><span className="text-xs font-semibold text-[#7B6A5C]">{b.blurb}</span></span>
              <span className="num shrink-0 text-right text-xs font-black">🪵 {b.wood.toLocaleString()}<br />🪨 {b.stone.toLocaleString()}</span>
            </label>
          ))}
        </div>
        {blocked && <p className="mt-3 text-sm font-bold text-[#C8463A]">{blocked}</p>}
        <button
          disabled={!!blocked || busy || !pick}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/api/construction", "POST", { causeId: snap.town.id, plotKey: plot.key, blueprintKey: pick });
              onStarted();
            } catch (e) {
              flash(e instanceof ApiError ? e.message : "Could not start.");
            } finally {
              setBusy(false);
            }
          }}
          className={`${btnP} mt-4 w-full py-3`}
        >
          Start building
        </button>
        <p className="mt-2 text-[11px] font-semibold text-[#7B6A5C]">Unused reservations are released after 24 hours. Once work starts, the building stays open until it&apos;s finished, even if you go away.</p>
      </div>
    );
  }
  const bp = BLUEPRINTS.find((b) => b.key === p.blueprintKey);
  const prog = Number(((BigInt(p.woodContributed) + BigInt(p.stoneContributed)) * 10000n) / (BigInt(p.woodRequired) + BigInt(p.stoneRequired) || 1n)) / 10000;
  const stage = stageOf(prog, p.status);
  const mine = me && p.initiatorId === me.userId;
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{STAGE_NAMES[stage]}{mine ? " · started by you" : ""}</div>
      <div className="text-2xl font-black">{bp?.name ?? "Building"}</div>
      <p className="text-sm font-semibold text-[#7B6A5C]">{bp?.blurb} · {p.contributors} {p.contributors === 1 ? "helper" : "helpers"} so far</p>
      <div className="mt-4 space-y-3">
        <Bar label="🪵 Wood" have={p.woodContributed} need={p.woodRequired} color="#C98A4A" />
        <Bar label="🪨 Stone" have={p.stoneContributed} need={p.stoneRequired} color="#9AA3AD" />
      </div>
      {p.status === "completed" ? (
        <p className="mt-4 rounded-2xl bg-[#E4F4E6] p-3 text-sm font-bold text-[#2E6B45]">Finished together! This is a virtual building that celebrates community effort. Real-world impact is reported on the Notice Board.</p>
      ) : (
        <>
          <button disabled={!me || !me.game.eligible} onClick={() => onWork(p, bp?.name ?? "the building")} className={`${btnP} mt-4 w-full py-3 text-lg`}>
            Work 🔨
          </button>
          <p className="mt-2 text-[11px] font-semibold text-[#7B6A5C]">
            {!me ? "Sign in to help build." : !me.game.eligible ? "An active deposit is needed to produce building resources." : "The game picks Wood or Stone for you, depending on what this building still needs and your cooldowns."}
          </p>
        </>
      )}
    </div>
  );
}

function BoardPanel({ notices, slug, signedIn, onSeen, flash }: { notices: Notice[]; slug: string; signedIn: boolean; onSeen: () => void; flash: (t: string) => void }) {
  useEffect(() => onSeen(), []); // eslint-disable-line react-hooks/exhaustive-deps
  void slug;
  const CAT: Record<string, string> = { news: "News", story: "Story", progress: "Progress report", impact: "Impact evidence" };
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Notice Board</div>
      <div className="text-2xl font-black">News from the organisation</div>
      <p className="mt-1 text-xs font-semibold text-[#7B6A5C]">Posts are written by the organisation. Hugshire marks a post &ldquo;Verified&rdquo; only after checking evidence. A finished building in the game is not proof of real-world impact.</p>
      {!notices.length && <p className="mt-4 rounded-2xl bg-[#F6EDE2] p-4 text-sm font-bold">No posts yet.</p>}
      <ul className="mt-4 space-y-3">
        {notices.map((n) => (
          <li key={n.id} className="rounded-2xl border-2 border-[#E2D3C2] bg-white/70 p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
              <span className="rounded-full bg-[#DCEFF9] px-2 py-0.5 text-[#2F6E92]">{CAT[n.category] ?? n.category}</span>
              {n.provenance === "verified_by_hugshire" ? <span className="rounded-full bg-[#E4F4E6] px-2 py-0.5 text-[#2E6B45]">Verified by Hugshire</span> : <span className="rounded-full bg-[#F6EDE2] px-2 py-0.5 text-[#7B6A5C]">Reported by the organisation</span>}
              <span className="text-[#9A887A]">{new Date(n.createdAt).toLocaleDateString("en-US")}</span>
            </div>
            <div className="mt-1 font-black">{n.title}</div>
            <p className="whitespace-pre-line text-sm font-semibold text-[#5C4A3D]">{n.body}</p>
            {n.mediaUrl && (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(n.mediaUrl) ? <img src={n.mediaUrl} alt="" className="mt-2 max-h-56 rounded-xl border-2 border-[#E2D3C2] object-cover" /> : <a href={n.mediaUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block text-sm font-bold text-[#C7601F] underline">Watch / view media</a>)}
            {n.linkUrl && <a href={n.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block text-sm font-bold text-[#C7601F] underline">Read more</a>}
            {signedIn && (
              <button
                onClick={async () => {
                  const reason = window.prompt("What's wrong with this post? (spam, misleading, inappropriate…)");
                  if (!reason || reason.trim().length < 3) return;
                  try {
                    await api(`/api/stories/${n.id}/report`, "POST", { reason });
                    flash("Thanks. Hugshire will review it.");
                  } catch (e) {
                    flash(e instanceof ApiError ? e.message : "Could not report.");
                  }
                }}
                className="mt-2 text-[11px] font-bold text-[#9A887A] underline"
              >
                Report
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TreePanel({ tree, town, towns, onChanged, flash }: { tree: Tree; town: Snapshot["town"]; towns: WorldTown[]; onChanged: () => Promise<unknown>; flash: (t: string) => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [parcel, setParcel] = useState<bigint>(0n);
  const [dest, setDest] = useState<string>(town.deliverable ? town.id : towns[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const fruits = tree.red.fruits.map((f) => BigInt(f));
  const ripe = useMemo(() => fruits.filter((_, i) => !picked.has(i)), [fruits, picked]);
  void ripe;
  const harvest = (all: boolean) => {
    const idx = all ? fruits.map((_, i) => i).filter((i) => !picked.has(i)) : [];
    const n = new Set(picked);
    let add = 0n;
    for (const i of idx) {
      n.add(i);
      add += fruits[i];
    }
    setPicked(n);
    setParcel((p) => p + add);
  };
  const pickOne = (i: number) => {
    if (picked.has(i)) return;
    setPicked(new Set([...picked, i]));
    setParcel((p) => p + fruits[i]);
  };
  async function deliver() {
    if (!dest || parcel <= 0n) return;
    setBusy(true);
    try {
      await api("/api/deliveries", "POST", { causeId: dest, idempotencyKey: idemKey("parcel"), capMicro: parcel.toString() });
      flash(`Heart Parcel of ${usd(parcel)} is on its way. It shows as pending until the payout is confirmed.`);
      setParcel(0n);
      setPicked(new Set());
      await onChanged();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "Could not deliver.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Your Heart Tree</div>
      <div className="text-2xl font-black">Fruit from real yield</div>
      <p className="mt-1 text-xs font-semibold text-[#7B6A5C]">Red fruit grows from the interest your deposit really earned on RHEA. Each fruit shows its exact value. Playing games never makes more fruit grow.</p>

      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-[11px] font-bold">
        <div className="rounded-xl bg-[#F6EDE2] p-2">Accruing<div className="num text-sm font-black">{usd(tree.red.accruingMicro)}</div></div>
        <div className="rounded-xl bg-[#FDE6D4] p-2">Ripe<div className="num text-sm font-black text-[#C7601F]">{usd(tree.red.eligibleMicro)}</div></div>
        <div className="rounded-xl bg-[#DCEFF9] p-2">Pending<div className="num text-sm font-black">{usd(tree.red.pendingMicro)}</div></div>
        <div className="rounded-xl bg-[#E4F4E6] p-2">Delivered<div className="num text-sm font-black">{usd(tree.red.deliveredMicro)}</div></div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/70 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-black">From your deposit</div>
          <button disabled={!fruits.length || picked.size === fruits.length} onClick={() => harvest(true)} className={`${btn} px-3 py-1 text-xs`}>Harvest all</button>
        </div>
        {fruits.length ? (
          <div className="flex flex-wrap gap-2">
            {fruits.map((f, i) => (
              <button key={i} disabled={picked.has(i)} onClick={() => pickOne(i)} className={`rounded-2xl border-2 px-2.5 py-1.5 text-xs font-black ${picked.has(i) ? "border-dashed border-[#D9CBBB] text-[#B5A596]" : "border-[#E2523F] bg-[#FDE2DC] text-[#9E2E22]"}`} title="Pick this fruit">
                ❤ {usd(f)}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs font-semibold text-[#7B6A5C]">No ripe fruit yet. New yield first appears as small buds while it settles.</p>
        )}
        {parcel > 0n && (
          <div className="mt-3 rounded-xl border-2 border-[#F6C76C] bg-[#FFF4D6] p-3">
            <div className="text-sm font-black">🎁 Heart Parcel: {usd(parcel)}</div>
            <label className="mt-2 block text-xs font-black">Deliver to an approved cause</label>
            <select value={dest} onChange={(e) => setDest(e.target.value)} className="mt-1 w-full rounded-xl border-2 border-[#E2D3C2] bg-white px-3 py-2 text-sm font-semibold">
              {towns.map((t) => (
                <option key={t.id} value={t.id}>{t.cityName}: {t.title}</option>
              ))}
            </select>
            <div className="mt-2 flex gap-2">
              <button disabled={busy} onClick={deliver} className={`${btnP} flex-1 py-2 text-sm`}>Deliver parcel</button>
              <button onClick={() => { setParcel(0n); setPicked(new Set()); }} className={`${btn} px-3 py-2 text-sm`}>Put back</button>
            </div>
          </div>
        )}
        <p className="mt-2 text-[11px] font-semibold text-[#7B6A5C]">
          Rather wait? Unpicked fruit stays on the tree. To let your workers deliver for you, <Link href="/deliveries" className="font-black underline">authorise automatic delivery</Link> (off unless you turn it on).
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-[#FFF7DC] p-3">
        <div className="text-sm font-black">✨ From our community</div>
        <p className="text-[11px] font-semibold text-[#7B6A5C]">Golden fruit is your equal share of the Community Heart Pool, funded by a published share of received ad revenue. It appears only after a month is finalized and funded. It isn&apos;t your money to withdraw: you choose which cause receives it.</p>
        {!tree.golden.length && <p className="mt-2 text-xs font-bold text-[#7B6A5C]">No golden fruit yet. <Link href="/pool" className="underline">How the pool works</Link></p>}
        {tree.golden.map((g) => (
          <GoldenRow key={g.allocationId} g={g} towns={towns} onChanged={onChanged} flash={flash} />
        ))}
      </div>
    </div>
  );
}

function GoldenRow({ g, towns, onChanged, flash }: { g: Golden; towns: WorldTown[]; onChanged: () => Promise<unknown>; flash: (t: string) => void }) {
  const [a, setA] = useState(g.choices[0]?.causeId ?? towns[0]?.id ?? "");
  const [b, setB] = useState<string>("");
  const [pct, setPct] = useState(50);
  async function save() {
    const choices = b && b !== a ? [{ causeId: a, bps: pct * 100 }, { causeId: b, bps: 10000 - pct * 100 }] : [{ causeId: a, bps: 10000 }];
    try {
      await api("/api/pool/choice", "POST", { allocationId: g.allocationId, choices });
      flash("Saved. Your golden fruit will go there when the treasury pays out.");
      await onChanged();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "Could not save.");
    }
  }
  return (
    <div className="mt-2 rounded-xl border-2 border-[#F6C445] bg-white/80 p-2.5 text-xs">
      <div className="flex items-center justify-between font-black">
        <span>✨ {g.period} · {usd(g.amountMicro)}</span>
        <span className="text-[10px] uppercase text-[#B88A1E]">{g.status.replace("_", " ")}</span>
      </div>
      {g.simulated && <div className="mt-1 rounded bg-[#3A2A22] px-2 py-0.5 text-[10px] font-black text-[#FFF9F0]">SIMULATED revenue · test treasury assets</div>}
      {g.choices.length > 0 && <div className="mt-1 font-semibold text-[#5C4A3D]">Going to: {g.choices.map((c) => `${c.title} (${c.bps / 100}%)`).join(", ")}{g.choiceSource === "default_beneficiary" ? " · your default" : ""}</div>}
      {g.canChoose && (
        <div className="mt-2 space-y-1.5">
          <select value={a} onChange={(e) => setA(e.target.value)} className="w-full rounded-lg border-2 border-[#E2D3C2] bg-white px-2 py-1 font-semibold">
            {towns.map((t) => <option key={t.id} value={t.id}>{t.cityName}: {t.title}</option>)}
          </select>
          <select value={b} onChange={(e) => setB(e.target.value)} className="w-full rounded-lg border-2 border-[#E2D3C2] bg-white px-2 py-1 font-semibold">
            <option value="">No split</option>
            {towns.filter((t) => t.id !== a).map((t) => <option key={t.id} value={t.id}>Split with {t.cityName}</option>)}
          </select>
          {b && <input type="range" min={10} max={90} step={10} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-[#F6C445]" aria-label="Split percentage" />}
          {b && <div className="font-bold">{pct}% / {100 - pct}%</div>}
          <button onClick={save} className={`${btn} w-full py-1.5 text-xs`}>Choose</button>
          {g.choiceDeadline && <div className="text-[10px] font-semibold text-[#7B6A5C]">Choose by {new Date(g.choiceDeadline).toLocaleDateString("en-US")}. If you don&apos;t, the disclosed default applies.</div>}
        </div>
      )}
    </div>
  );
}
