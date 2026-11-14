"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, idemKey } from "@/lib/api";
import { formatUsd } from "@/lib/money";
import { formatRes } from "@/game/v4/rules";
import { BLUEPRINTS, BUILDABLE, STAGE_NAMES, stageOf, type Plot } from "@/game/v4/town";
import type { Interactable, TownGame, TownProject } from "@/game/v4/TownGame";
import type { Mascot } from "@/game/world/mascots";
import { MiniGameOverlay, type SessionView } from "./MiniGameOverlay";
import { GameHud } from "@/components/journey/GameMenu";
import { CauseInfoModal, TitleBoard } from "./TownBoard";
import { WelcomeGuide } from "@/components/journey/WelcomeGuide";
import { ArrivalTutorial } from "./ArrivalTutorial";
import { MoneyFlow } from "@/components/journey/MoneyFlow";
import { BackgroundMusic } from "@/components/BackgroundMusic";

type Notice = { id: string; title: string; body: string; category: string; mediaUrl: string | null; linkUrl: string | null; createdAt: string; provenance: "organisation_reported" | "verified_by_hugshire" };
type Golden = { allocationId: string; period: string; simulated: boolean; amountMicro: string; status: string; choices: { causeId: string; bps: number; title: string }[]; choiceSource: string | null; canChoose: boolean; choiceDeadline: string | null };
type Tree = { red: { accruingMicro: string; eligibleMicro: string; pendingMicro: string; deliveredMicro: string; fruits: string[]; buds: number }; golden: Golden[] };
type Me = {
  userId: string;
  mascot: Mascot;
  nickname: string;
  game: { eligible: boolean; canPlay: boolean; freePlay: boolean; freeLeftMicro: string | null; freeDailyCapMicro: string; principalMicro: string; baseRewardMicro: string; autoPerHourMicro: string; cooldowns: { wood: number | null; stone: number | null }; ownProject: (TownProject & { causeTitle: string; cityName: string }) | null; openSessionId: string | null };
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

export function TownView({ slug, welcome: welcomeParam = false }: { slug: string; welcome?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const game = useRef<TownGame | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [near, setNear] = useState<Interactable | null>(null);
  const [open, setOpen] = useState<Interactable | null>(null);
  const [others, setOthers] = useState(0);
  const [session, setSession] = useState<{ s: SessionView; building: string; project: TownProject } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [towns, setTowns] = useState<WorldTown[]>([]);
  const [now, setNow] = useState(Date.now());
  const [welcome, setWelcome] = useState(false);
  const [info, setInfo] = useState(false); // "about this cause" modal
  const [guide, setGuide] = useState({ tree: false, work: false, deliver: false });
  // first arrival from the journey (?welcome=1): helper drops in, town UI stays hidden until the tutorial ends
  // read from the server-side page props: after a client-side navigation window.location may still be the old page
  const arrivalParam = useRef(welcomeParam);
  const [tutorial, setTutorial] = useState(false);
  const ui = !tutorial; // show the HUD, menu and prompts
  // ?welcome=1 (arriving from the journey) shows the guide; ?open=tree opens the Heart Tree on arrival
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (welcomeParam || q.get("welcome") === "1") setWelcome(true);
    if (q.get("open") === "tree") setOpen({ kind: "tree" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open?.kind === "tree") setGuide((g) => ({ ...g, tree: true }));
  }, [open]);
  useEffect(() => {
    if (session) setGuide((g) => ({ ...g, work: true }));
  }, [session]);

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
      const arrival = arrivalParam.current && !!snap?.me;
      g = new TownGame(seed, mascot as Mascot, nickname, { onNear: setNear, onInteract: setOpen }, { arrival });
      if (arrival) {
        setTutorial(true);
        arrivalParam.current = false; // play once
        window.history.replaceState(null, "", window.location.pathname); // a refresh won't replay it
      }
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
  }, [seed, mascot, nickname]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // label the highlighted object in the world: "[E] Visit your Heart Tree"
  useEffect(() => {
    const p = near?.kind === "plot" ? snap?.projects.find((x) => x.plotKey === near.plot.key) : undefined;
    const label =
      near?.kind === "board" ? "Read the Notice Board" : near?.kind === "tree" ? "Visit your Heart Tree" : near?.kind === "plot" ? (p ? (p.status === "completed" ? "Admire the building" : "Help build here") : "Start a building here") : null;
    game.current?.setNearLabel(!tutorial && !open && !session ? label : null);
  }, [near, snap?.projects, tutorial, open, session, ready]);

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
        setSession({ s: r.session, building: name, project: p });
      } else if (r.kind === "wait") flash(`Your helper is resting: Wood chopping is back in ${Math.max(1, Math.ceil((r.untilMs - Date.now()) / 1000))} s.`);
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
          {/* arriving from the journey: plain meadow green, continuing the zoom-in, until the drop starts */}
          {!welcomeParam && (
            <>
              <img src="/brand/logo.png" alt="" className="h-20 w-20 animate-bounce rounded-[22px]" />
              <div className="font-extrabold">Walking into town…</div>
            </>
          )}
        </div>
      )}

      {snap && ui && <TitleBoard className="hs-fade absolute inset-x-0 top-[58px] z-20 xl:-top-3" title={snap.town.cityName} subtitle={`${snap.town.title} · ${snap.town.org}`} onInfo={() => setInfo(true)} />}
      {info && snap && <CauseInfoModal town={snap.town} onClose={() => setInfo(false)} />}

      {ui && ready && near && prompt && !open && !session && !tutorial && game.current && <ActionPrompt key={prompt} label={prompt} game={game.current} onPress={() => setOpen(near)} />}

      {open && snap && (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-[#3A2A22]/30 p-3 sm:items-center" onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className={`${card} max-h-[90vh] w-full ${open.kind === "tree" ? "max-w-4xl" : "max-w-lg"} overflow-y-auto p-5`}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setOpen(null)} aria-label="Close" className="rounded-full px-2 text-xl font-black text-[#7B6A5C] hover:bg-[#F6EDE2]">×</button>
            </div>
            {open.kind === "plot" && <PlotPanel plot={open.plot} snap={snap} onStarted={async () => { await load(); flash("Building started! Press Work to help."); }} onWork={work} flash={flash} />}
            {open.kind === "board" && <BoardPanel notices={snap.notices} slug={slug} signedIn={!!me} onSeen={() => { if (snap.notices[0]) lsSet(`hs-board-${slug}`, snap.notices[0].createdAt); game.current?.setBoardNew(false); }} flash={flash} />}
            {open.kind === "tree" && (me ? <TreePanel tree={me.tree} town={snap.town} towns={towns} onChanged={load} flash={flash} /> : <p className="text-sm font-semibold">Sign in to see your Heart Tree.</p>)}
          </div>
        </div>
      )}

      {snap && ui && !session && <GameHud where="town" onOpenTree={() => setOpen({ kind: "tree" })} onChanged={() => void load()} />}
      {tutorial && ready && game.current && snap?.me && (
        <ArrivalTutorial
          game={game.current}
          town={snap.town.cityName}
          org={snap.town.org}
          helper={snap.me.nickname}
          mascot={snap.me.mascot}
          planted={snap.me.game.eligible}
          onDone={() => setTutorial(false)}
        />
      )}
      {ui && welcome && snap?.me && !session && (
        <WelcomeGuide
          town={snap.town.cityName}
          helper={snap.me.nickname}
          done={{ ...guide, deliver: guide.deliver || BigInt(snap.me.tree.red.pendingMicro) > 0n || BigInt(snap.me.tree.red.deliveredMicro) > 0n }}
          ripe={snap.me.tree.red.fruits.length > 0}
          onClose={() => setWelcome(false)}
        />
      )}
      {!session && <BackgroundMusic />}
      {session && (
        <MiniGameOverlay
          key={session.s.id}
          session={session.s}
          mascot={mascot as Mascot}
          buildingName={session.building}
          project={session.project}
          onClose={async (s) => {
            setSession(null);
            await load();
            if (BigInt(s.earnedMicro) > 0n) flash(`Thanks! ${formatRes(s.earnedMicro)} ${s.resource} went into ${session.building}.`);
          }}
          onPlayAgain={async () => {
            // fresh building progress, then straight into a new session for the same building
            const p = session.project;
            setSession(null);
            const fresh = (await load())?.projects.find((x) => x.id === p.id) ?? p;
            await work(fresh, session.building);
          }}
        />
      )}

      {toast && <div className="pointer-events-none absolute left-1/2 top-24 z-50 w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl border-[2.5px] border-[#8A6448] bg-[#FFF9F0] px-4 py-2.5 text-center text-sm font-bold shadow-lg">{toast}</div>}
    </div>
  );
}

// ───────────────────────────── panels ─────────────────────────────

/**
 * The "press E" prompt over the object you're next to: a big 3D key, the action, and a bobbing tail
 * pointing down at the object. It follows the object but never slides under the board, profile or menu.
 */
function ActionPrompt({ label, game, onPress }: { label: string; game: TownGame; onPress: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = () => {
      const a = game.actionAnchor();
      const el = box.current;
      if (!el) return;
      if (!a) {
        el.style.visibility = "hidden";
        return;
      }
      const vw = window.innerWidth, vh = window.innerHeight;
      // stay clear of the real HUD: below the title board, above the bottom menu
      const board = document.querySelector("[data-title-board]")?.getBoundingClientRect();
      const menu = document.querySelector('nav[aria-label="Game menu"]')?.getBoundingClientRect();
      const h = el.offsetHeight || 60;
      const topSafe = (board ? board.bottom : 120) + h + 10;
      const bottomSafe = menu ? menu.top - 12 : vh - 150;
      el.style.visibility = "visible";
      el.style.left = `${Math.max(150, Math.min(vw - 150, a.x))}px`;
      el.style.top = `${Math.max(topSafe, Math.min(bottomSafe, a.y - 18))}px`;
    };
    let raf = 0;
    const loop = () => {
      place();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const iv = window.setInterval(place, 200); // backup if animation frames are throttled
    place();
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(iv);
    };
  }, [game]);
  return (
    <div ref={box} className="pointer-events-none absolute z-30" style={{ visibility: "hidden", transform: "translate(-50%, -100%)" }}>
      <button onClick={onPress} className="hs-pop hs-prompt-bob pointer-events-auto flex flex-col items-center">
        <span className="flex items-center gap-2 rounded-full border-[3px] border-[#8A6448] bg-[#FFF9F0] py-1.5 pl-1.5 pr-4 shadow-[0_4px_0_#8A6448,0_10px_22px_rgba(0,0,0,0.3)]">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl border-[3px] border-[#8A2A1F] bg-gradient-to-b from-[#FF9A4D] to-[#F0702A] text-xl font-black text-white shadow-[0_3px_0_#8A2A1F]">
            E
            <span aria-hidden className="hs-key-ring absolute -inset-1.5 rounded-2xl border-[3px] border-[#FFD34D]" />
          </span>
          <span className="whitespace-nowrap text-[15px] font-black text-[#3A2A22]">{label}</span>
        </span>
        <span aria-hidden className="-mt-[3px] h-0 w-0 border-x-[11px] border-t-[13px] border-x-transparent border-t-[#8A6448]" />
      </button>
    </div>
  );
}

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

/** Stage picture for a building (retired buildings borrow a same-size building's art). */
const STAGE_ART = new Set(["cottage", "house", "bookshop", "barn", "school", "townHall"]);
const stageImg = (key: string, size: string, n: number) => `/game/sprites/stages/${STAGE_ART.has(key) ? key : ({ S: "cottage", M: "bookshop", L: "school" } as Record<string, string>)[size] ?? "cottage"}_${Math.min(4, Math.max(1, n))}.png`;

function PlotPanel({ plot, snap, onStarted, onWork, flash }: { plot: Plot; snap: Snapshot; onStarted: () => void; onWork: (p: TownProject, name: string) => void; flash: (t: string) => void }) {
  const p = snap.projects.find((q) => q.plotKey === plot.key);
  const me = snap.me;
  const options = BUILDABLE.filter((b) => b.size === plot.size);
  const [pick, setPick] = useState(options[0]?.key);
  const [busy, setBusy] = useState(false);
  const sizeName = plot.size === "S" ? "Small" : plot.size === "M" ? "Medium" : "Large";
  if (!p) {
    const blocked = !me ? "Sign in to start a building." : !me.game.eligible ? "An active deposit is needed to start building." : me.game.ownProject ? "You already started a building that isn't finished. You can still help on others!" : null;
    return (
      <div>
        <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">{sizeName} plot · free</div>
        <div className="text-2xl font-black text-[#3A2A22]">What should we build here? 🏗️</div>
        <p className="mt-0.5 text-sm font-semibold text-[#7B6A5C]">Pick a building. Everyone in town can then chop Wood to raise it.</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {options.map((b) => (
            <button key={b.key} onClick={() => setPick(b.key)} className={`relative overflow-hidden rounded-2xl border-[3px] text-center transition ${pick === b.key ? "border-[#F58A3C] shadow-[0_4px_0_#E46F3E] -translate-y-0.5" : "border-[#E4D3BE] hover:-translate-y-0.5"}`}>
              <div className="flex h-24 items-end justify-center bg-gradient-to-b from-[#E9F6FB] to-[#DCEFC9] pb-1">
                <img src={stageImg(b.key, b.size, 4)} alt="" className="h-20 w-auto object-contain" />
              </div>
              <div className="bg-white px-2 py-2">
                <div className="text-sm font-black text-[#3A2A22]">{b.name}</div>
                <div className="num text-[11px] font-black text-[#8A6448]">🪵 {b.wood.toLocaleString()}</div>
              </div>
              {pick === b.key && <span className="hs-pop absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#F58A3C] text-xs font-black text-white">✓</span>}
            </button>
          ))}
        </div>
        {blocked && <p className="mt-3 rounded-xl bg-[#FBE1DD] px-3 py-2 text-sm font-bold text-[#C8463A]">{blocked}</p>}
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
          className={`${btnP} mt-4 w-full py-3.5 text-lg`}
        >
          🏗️ Start building!
        </button>
        <p className="mt-2 text-center text-[11px] font-semibold text-[#9A887A]">Once the first Wood arrives, the building stays open until it&apos;s finished.</p>
      </div>
    );
  }
  const bp = BLUEPRINTS.find((b) => b.key === p.blueprintKey);
  const have = BigInt(p.woodContributed) + BigInt(p.stoneContributed);
  const need = BigInt(p.woodRequired) + BigInt(p.stoneRequired) || 1n;
  const prog = Number((have * 10000n) / need) / 10000;
  const pct = Math.min(100, prog * 100);
  const stage = stageOf(prog, p.status);
  const mine = me && p.initiatorId === me.userId;
  const left = need > have ? need - have : 0n;
  const stageLabels = ["Foundation", "Frame", "Nearly done", "Done!"];
  const done = p.status === "completed";
  return (
    <div>
      {/* the building, big, in a little meadow */}
      <div className="relative -mx-1 overflow-hidden rounded-3xl border-[3px] border-[#E4D3BE]" style={{ background: "#CBE6B3 url(/game/sprites/howto/background.png) center 70% / cover no-repeat" }}>
        <div className="flex h-40 items-end justify-center pb-2">
          <img key={stage} src={stageImg(p.blueprintKey, bp?.size ?? plot.size, stage)} alt="" className="hs-pop h-36 w-auto object-contain drop-shadow-[0_6px_0_rgba(107,74,51,0.2)]" />
        </div>
        <span className="absolute left-3 top-3 rounded-full border-2 border-[#6B4A33] bg-[#FFD34D] px-3 py-0.5 text-xs font-black text-[#3A2A22] shadow-[0_2px_0_#6B4A33]">{done ? "🎉 Finished!" : `Stage ${Math.max(1, stage)}: ${stageLabels[Math.max(1, stage) - 1]}`}</span>
        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-black text-[#5C4A3D]">👥 {p.contributors} {p.contributors === 1 ? "helper" : "helpers"}</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-2xl font-black leading-tight text-[#3A2A22]">{bp?.name ?? "Building"}</div>
          <div className="text-xs font-semibold text-[#7B6A5C]">{bp?.blurb}{mine ? " · ⭐ started by you" : ""}</div>
        </div>
        <div className="num text-right text-4xl font-black leading-none text-[#F58A3C]" style={{ textShadow: "0 2px 0 #C7601F33" }}>
          {pct < 1 && pct > 0 ? pct.toFixed(1) : Math.floor(pct)}%
        </div>
      </div>

      {/* the big progress bar */}
      <div className="relative mt-2.5 h-8 rounded-full border-[3px] border-[#6B4A33] bg-[#EADCC8] shadow-[inset_0_3px_0_rgba(0,0,0,0.12)]">
        <div
          className="hs-bar-stripes relative h-full rounded-full transition-[width] duration-700"
          style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: done ? "#5BBF7A" : "#F2A23A", backgroundImage: "repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 10px, rgba(255,255,255,0) 10px 20px)" }}
        >
          {!done && <img src="/game/sprites/wood/log.png" alt="" className="absolute -right-4 -top-3 h-11 w-auto drop-shadow" />}
        </div>
        {[25, 50, 75].map((m) => (
          <span key={m} aria-hidden className={`absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full ${pct >= m ? "bg-white/70" : "bg-[#6B4A33]/30"}`} style={{ left: `${m}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs font-black">
        <span className="num text-[#5C4A3D]">🪵 {formatRes(have, 0)} / {formatRes(need, 0)}</span>
        <span className="text-[#C7601F]">{done ? "All done! 🎉" : `${formatRes(left, 0)} to go!`}</span>
      </div>

      {/* the stage journey */}
      <div className="mt-3 flex items-center justify-between gap-1 rounded-2xl bg-[#F6EDE2] px-2 py-2">
        {[1, 2, 3, 4].map((n) => {
          const reached = stage >= n;
          const current = !done && Math.max(1, stage) === n;
          return (
            <div key={n} className="flex flex-1 items-center">
              <div className={`relative flex flex-1 flex-col items-center rounded-xl py-1 ${current ? "bg-white shadow-[0_2px_0_#E4D3BE]" : ""}`}>
                <img src={stageImg(p.blueprintKey, bp?.size ?? plot.size, n)} alt="" className={`h-9 w-auto object-contain ${reached ? "" : "opacity-30 grayscale"}`} />
                <span className={`text-[9px] font-black ${current ? "text-[#C7601F]" : reached ? "text-[#3F9B5B]" : "text-[#9A887A]"}`}>{stageLabels[n - 1]}</span>
                {reached && !current && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#5BBF7A] text-[9px] font-black text-white">✓</span>}
              </div>
              {n < 4 && <span className={`mx-0.5 text-xs font-black ${stage > n ? "text-[#5BBF7A]" : "text-[#C9B39C]"}`}>›</span>}
            </div>
          );
        })}
      </div>

      {done ? (
        <p className="mt-4 rounded-2xl bg-[#E4F4E6] p-3 text-sm font-bold text-[#2E6B45]">Finished together! 🎉 This virtual building celebrates the town&apos;s effort. Real-world news is on the Notice Board.</p>
      ) : (
        <>
          <button disabled={!me || (me.game.freePlay && me.game.freeLeftMicro === "0")} onClick={() => onWork(p, bp?.name ?? "the building")} className={`${btnP} hs-glow mt-4 w-full py-3.5 text-xl`}>
            🪓 Chop Wood!
          </button>
          <p className="mt-2 text-center text-[11px] font-semibold text-[#7B6A5C]">
            {!me
              ? "Sign in to help build."
              : me.game.freePlay
                ? me.game.freeLeftMicro === "0"
                  ? "Today's free play is used up. Come back tomorrow, or plant a deposit to build much faster."
                  : `Free play: ${formatRes(me.game.baseRewardMicro)} Wood per Hit, up to ${formatRes(me.game.freeDailyCapMicro, 0)} a day.`
                : `You earn ${formatRes(me.game.baseRewardMicro)} Wood per Hit. Everything goes straight into this building.`}
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
            {n.mediaUrl && (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(n.mediaUrl) ? <img src={n.mediaUrl} alt="" className={`mt-2 h-48 w-full rounded-xl border-2 border-[#E2D3C2] ${/\.jpe?g(\?|$)/i.test(n.mediaUrl) ? "object-cover" : "bg-gradient-to-b from-[#E9F6FB] to-[#DCEFC9] object-contain p-2"}`} /> : <a href={n.mediaUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block text-sm font-bold text-[#C7601F] underline">Watch / view media</a>)}
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
                className="mt-2 hidden text-[11px] font-bold text-[#9A887A] underline"
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
  const [tab, setTab] = useState<"fruit" | "money" | "golden">("fruit");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [parcel, setParcel] = useState<bigint>(0n);
  const [dest, setDest] = useState<string>(town.deliverable ? town.id : towns[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [autoDaily, setAutoDaily] = useState<boolean | null>(null);
  const [homeName, setHomeName] = useState<string | null>(null);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [info, setInfo] = useState<"fruit" | "money" | "golden" | null>(null); // which tab's (i) is open
  const [wd, setWd] = useState<{ open: boolean; amount: string; busy: boolean; msg: string | null; done?: string | null }>({ open: false, amount: "", busy: false, msg: null, done: null });
  async function toggleAuto() {
    const on = !autoDaily;
    setAutoDaily(on);
    try {
      await api("/api/journey", "POST", { action: "autoDaily", on });
      flash(on ? `🚚 Auto-send is on: ripe fruit goes to ${homeName ?? "your home town"} every day.` : "Auto-send is off. Send fruit yourself whenever you like.");
    } catch (e) {
      setAutoDaily(!on);
      flash(e instanceof ApiError ? e.message : "Could not change auto-send.");
    }
  }
  async function withdraw() {
    setWd((w) => ({ ...w, busy: true, msg: null }));
    try {
      await api("/api/withdrawals", "POST", { amountUsd: wd.amount, idempotencyKey: idemKey("withdraw") });
      setWd({ open: true, amount: "", busy: false, msg: null, done: Number(wd.amount).toFixed(2) }); // keep the pop-up open on the success view
      const j = await api<{ bank?: typeof bank }>("/api/journey");
      setBank(j.bank ?? null);
    } catch (e) {
      setWd((w) => ({ ...w, busy: false, msg: e instanceof ApiError ? e.message : "Could not withdraw." }));
    }
  }
  const [bank, setBank] = useState<{ principalMicro: string; withdrawingMicro: string; earnedMicro: string; ripeMicro: string; settlingMicro: string; pendingMicro: string; deliveredMicro: string; freePlay: boolean } | null>(null);
  useEffect(() => {
    api<{ bank?: typeof bank; autoDelivery?: { daily?: boolean }; home?: { id: string; cityName: string } | null }>("/api/journey")
      .then((j) => {
        setBank(j.bank ?? null);
        setAutoDaily(!!j.autoDelivery?.daily);
        setHomeName(j.home?.cityName ?? null);
        setHomeId(j.home?.id ?? null);
      })
      .catch(() => {});
  }, []);
  const fruits = tree.red.fruits.map((f) => BigInt(f));
  const left = fruits.length - picked.size;
  const goldenOpen = tree.golden.filter((g) => g.canChoose).length;
  const given = BigInt(tree.red.deliveredMicro) + BigInt(tree.red.pendingMicro);
  const destTown = towns.find((t) => t.id === dest);
  const step = parcel > 0n ? 2 : 1;

  const pickAll = () => {
    const n = new Set(picked);
    let add = 0n;
    fruits.forEach((f, i) => {
      if (!n.has(i)) {
        n.add(i);
        add += f;
      }
    });
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
      flash(`🚚 ${usd(parcel)} of fruit is on its way to ${destTown?.cityName ?? "the town"}!`);
      setParcel(0n);
      setPicked(new Set());
      await onChanged();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "Could not deliver.");
    } finally {
      setBusy(false);
    }
  }

  const gifts = tree.golden.filter((g) => g.canChoose);
  const TABS = [
    { k: "fruit" as const, icon: "🍎", label: "My interest", info: "Your deposit earns interest. It grows on your tree as red fruit, and you send it to causes." },
    { k: "money" as const, icon: "🌱", label: "My deposit", info: "Your own money. It stays yours and you can take it back any time. Only its interest is given away." },
    { k: "golden" as const, icon: "🎁", label: "Community gift", info: "Money from ads goes into the Community Pool and is shared equally by everyone. It shows as golden fruit, and you choose which cause gets your share." },
  ];
  // where fruit hangs in the canopy (percent of the tree picture)
  const SPOTS = [
    [30, 22], [52, 14], [70, 24], [22, 38], [44, 32], [64, 40], [80, 36], [36, 48], [56, 52], [26, 54],
  ];

  return (
    <div className="md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-6">
      {/* LEFT: your tree, with the real fruit on it, and the three numbers */}
      <div className="md:self-start">
        <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">Your Heart Tree</div>
        <div className="text-2xl font-black leading-tight text-[#3A2A22]">{fruits.length ? `${fruits.length} fruit ready to give!` : "Your fruit is growing 🌱"}</div>
        <div className="relative mt-2 overflow-hidden rounded-3xl border-[3px] border-[#E4D3BE]" style={{ background: "#CBE6B3 url(/game/sprites/howto/background.png) center 75% / cover no-repeat" }}>
          <div className="relative mx-auto aspect-square w-full max-w-[340px]">
            <img src="/game/sprites/town/heart_tree.png" alt="" className="absolute inset-[4%] h-[92%] w-[92%] object-contain" />
            {fruits.slice(0, SPOTS.length).map((f, i) => (
              <button key={`r${i}`} onClick={() => { setTab("fruit"); pickOne(i); }} disabled={picked.has(i)} title={`Pick ${usd(f)}`} className={`absolute -translate-x-1/2 -translate-y-1/2 transition ${picked.has(i) ? "scale-50 opacity-0" : "hs-pop hover:scale-125"}`} style={{ left: `${SPOTS[i][0]}%`, top: `${SPOTS[i][1]}%`, "--d": `${100 + i * 70}ms` } as React.CSSProperties}>
                <img src={`/game/sprites/town/fruit_red_${(i % 3) + 1}.png`} alt="" className="h-9 w-auto drop-shadow-[0_2px_0_rgba(0,0,0,0.2)] sm:h-10" />
              </button>
            ))}
            {gifts.slice(0, 3).map((g, i) => {
              const spot = SPOTS[SPOTS.length - 1 - i];
              return (
                <button key={`g${g.allocationId}`} onClick={() => setTab("golden")} title="A community gift" className="hs-pop absolute -translate-x-1/2 -translate-y-1/2 transition hover:scale-125" style={{ left: `${spot[0]}%`, top: `${spot[1]}%` }}>
                  <img src="/game/sprites/town/fruit_gold_1.png" alt="" className="hs-jiggle h-10 w-auto drop-shadow-[0_0_8px_rgba(255,210,80,0.9)]" />
                </button>
              );
            })}
            {Array.from({ length: Math.min(4, tree.red.buds) }, (_, i) => (
              <span key={`b${i}`} aria-hidden className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#5E9550] bg-[#A8D88A]" style={{ left: `${[40, 60, 34, 50][i]}%`, top: `${[26, 30, 44, 42][i]}%` }} />
            ))}
          </div>
          {fruits.length > SPOTS.length && <span className="absolute right-3 top-3 rounded-full bg-[#E2523F] px-2 py-0.5 text-xs font-black text-white">+{fruits.length - SPOTS.length} more</span>}
          <div className="absolute inset-x-3 bottom-3 flex justify-center gap-3 text-[10px] font-black">
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[#9E2E22]">🍎 interest</span>
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[#8A6A1E]">✨ community gift</span>
            <span className="rounded-full bg-white/90 px-2 py-0.5 text-[#3F7A34]">🟢 growing</span>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] font-bold text-[#9A887A]">Tap a fruit on the tree to pick it.</p>
        <div className="mt-3 space-y-1.5">
          {[
            ["🌱", "My deposit", bank ? usd(bank.principalMicro) : "…", "Your money, always yours", "#FFF1E6"],
            ["🍎", "Ready to give", usd(tree.red.eligibleMicro), "Interest you can send now", "#FDE2DC"],
            ["💛", "Total donated", usd(given), "Sent to causes so far", "#E4F4E6"],
          ].map(([icon, label, value, hint, tone]) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl border-2 border-[#E4D3BE] px-3 py-2" style={{ background: tone }}>
              <span className="text-2xl">{icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black text-[#3A2A22]">{label}</span>
                <span className="block text-[10px] font-semibold text-[#7B6A5C]">{hint}</span>
              </span>
              <span className="num text-lg font-black text-[#3A2A22]">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT: what you can do */}
      <div className="mt-5 md:mt-0">
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#F6EDE2] p-1">
          {TABS.map((t) => (
            <div key={t.k} className={`relative flex items-center justify-center rounded-xl transition ${tab === t.k ? "bg-white shadow-[0_2px_0_#E4D3BE]" : ""}`}>
              <button onClick={() => setTab(t.k)} className={`flex flex-1 flex-col items-center py-2 text-[11px] font-black leading-tight sm:text-sm ${tab === t.k ? "text-[#3A2A22]" : "text-[#7B6A5C] hover:text-[#3A2A22]"}`}>
                <span className="text-lg leading-none">{t.icon}</span>
                <span className="mt-0.5">{t.label}{t.k === "golden" && gifts.length ? ` (${gifts.length})` : ""}</span>
              </button>
              <button onClick={() => setInfo(info === t.k ? null : t.k)} aria-label={`What is ${t.label}?`} className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-black italic ${info === t.k ? "border-[#8A6448] bg-[#8A6448] text-white" : "border-[#C9B39C] bg-white text-[#8A6448]"}`}>
                i
              </button>
            </div>
          ))}
        </div>
        {info && (
          <div className="hs-card-in mt-2 flex gap-2 rounded-2xl border-2 border-[#E4D3BE] bg-white px-3 py-2 text-[12px] font-semibold leading-snug text-[#5C4A3D]">
            <span className="text-lg leading-none">{TABS.find((t) => t.k === info)!.icon}</span>
            <span><b className="text-[#3A2A22]">{TABS.find((t) => t.k === info)!.label}:</b> {TABS.find((t) => t.k === info)!.info}</span>
          </div>
        )}

      {tab === "fruit" && (
        <div className="mt-3">
          <button onClick={toggleAuto} disabled={autoDaily === null} className={`mb-3 flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition ${autoDaily ? "border-[#3F9B5B] bg-[#E4F4E6]" : "border-[#E4D3BE] bg-white"}`}>
            <span className="text-2xl">🚚</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-[#3A2A22]">Auto-send my interest daily</span>
              <span className="block text-[11px] font-semibold leading-snug text-[#7B6A5C]">{autoDaily ? `Every day your helper sends ripe fruit to ${homeName ?? "your home town"} for you.` : "Off: fruit waits on your tree until you send it."}</span>
            </span>
            <span className={`relative h-7 w-12 shrink-0 rounded-full border-2 transition ${autoDaily ? "border-[#2F7A47] bg-[#5BBF7A]" : "border-[#C9B39C] bg-[#EADCC8]"}`} role="switch" aria-checked={!!autoDaily}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${autoDaily ? "left-[22px]" : "left-0.5"}`} />
            </span>
          </button>
          {/* how it works, as three game steps */}
          <div className="flex items-center justify-between gap-1 text-[11px] font-black">
            {["Pick fruit", "Choose a town", "Send it!"].map((t, k) => (
              <div key={t} className="flex flex-1 items-center gap-1">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${step > k + 1 ? "border-[#3F9B5B] bg-[#5BBF7A] text-white" : step === k + 1 ? "border-[#E46F3E] bg-[#F58A3C] text-white" : "border-[#D9CBBB] bg-white text-[#9A887A]"}`}>{step > k + 1 ? "✓" : k + 1}</span>
                <span className={step === k + 1 ? "text-[#3A2A22]" : "text-[#9A887A]"}>{t}</span>
                {k < 2 && <span className="mx-1 hidden h-0.5 flex-1 rounded bg-[#E4D3BE] sm:block" />}
              </div>
            ))}
          </div>

          {fruits.length ? (
            <>
              <div className="mt-3 flex flex-wrap justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#E9F6DD] to-[#D6EDC2] p-3">
                {fruits.map((f, i) => (
                  <button key={i} disabled={picked.has(i)} onClick={() => pickOne(i)} title="Pick this fruit" className={`flex flex-col items-center transition ${picked.has(i) ? "opacity-25" : "hover:-translate-y-1"}`}>
                    <img src={`/game/sprites/town/fruit_red_${(i % 3) + 1}.png`} alt="" className="h-10 w-auto" />
                    <span className="num mt-0.5 rounded-full bg-white/90 px-1.5 text-[10px] font-black text-[#9E2E22]">{usd(f)}</span>
                  </button>
                ))}
              </div>
              {left > 0 && (
                <button onClick={pickAll} className={`${btn} mt-2 w-full py-2 text-sm`}>
                  🧺 Pick all {left} fruit
                </button>
              )}
            </>
          ) : (
            <div className="mt-3 rounded-2xl bg-[#F6EDE2] p-4 text-center">
              <div className="text-3xl">🌱</div>
              <div className="mt-1 font-black text-[#3A2A22]">No interest fruit ready yet</div>
              <div className="text-xs font-semibold text-[#7B6A5C]">
                {tree.red.buds > 0 ? `${tree.red.buds} bud${tree.red.buds === 1 ? "" : "s"} growing` : "New interest appears as buds first"} · {usd(tree.red.accruingMicro)} ripening. Check back soon!
              </div>
            </div>
          )}

          {parcel > 0n && (
            <div className="hs-card-in mt-3 rounded-2xl border-[2.5px] border-[#F6C76C] bg-[#FFF7DC] p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-black text-[#3A2A22]">🧺 Your basket</div>
                <div className="num text-xl font-black text-[#C7601F]">{usd(parcel)}</div>
              </div>
              <div className="mt-2 text-xs font-black text-[#3A2A22]">Send it to…</div>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {towns.map((t) => (
                  <button key={t.id} onClick={() => setDest(t.id)} className={`rounded-xl border-2 px-2 py-1.5 text-left text-xs font-black ${dest === t.id ? "border-[#F58A3C] bg-white shadow-[0_2px_0_#E46F3E]" : "border-[#E4D3BE] bg-white/70"}`}>
                    {t.cityName}
                    {t.id === town.id && <span className="ml-1 text-[10px] text-[#C7601F]">(here)</span>}
                    <span className="block truncate text-[10px] font-bold text-[#7B6A5C]">{t.title}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2.5 flex gap-2">
                <button disabled={busy} onClick={deliver} className={`${btnP} flex-1 py-2.5 text-base`}>
                  🚚 Send to {destTown?.cityName ?? "town"}
                </button>
                <button onClick={() => { setParcel(0n); setPicked(new Set()); }} className={`${btn} px-3 py-2 text-xs`}>
                  Put back
                </button>
              </div>
            </div>
          )}
          <p className="mt-2 text-center text-[11px] font-semibold text-[#9A887A]">
            {autoDaily ? "Want to choose yourself? Pick fruit and send it to any town above." : "Unpicked fruit stays on the tree until you send it."}
          </p>
        </div>
      )}

      {tab === "money" && (
        <div className="mt-3 space-y-2">
          {bank ? (
            <>
              <MoneyRow icon="🌱" label="My deposit" hint="The money you put in. It stays yours; take it back any time." value={usd(bank.principalMicro)} tone="#FFF1E6" />
              {BigInt(bank.withdrawingMicro) > 0n && <MoneyRow icon="↩️" label="On its way back to you" value={usd(bank.withdrawingMicro)} />}
              <MoneyRow icon="📈" label="Interest earned" hint="What your deposit has earned so far. It grows as fruit on your tree." value={usd(bank.earnedMicro)} />
              <MoneyRow icon="🚚" label="Being delivered" hint="Fruit you sent that hasn't reached the cause yet." value={usd(bank.pendingMicro)} />
              <MoneyRow icon="💛" label="Donated" hint="Interest that has reached causes." value={usd(bank.deliveredMicro)} tone="#E4F4E6" />
              {bank.freePlay && <p className="rounded-2xl bg-[#FFF4D6] p-3 text-xs font-bold text-[#8A6A1E]">You&apos;re on free play. Plant a little to grow real fruit for your town.</p>}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={() => window.dispatchEvent(new CustomEvent("hs:plant-more"))} className={`${btnP} py-3`}>🌱 Plant more</button>
                <button onClick={() => setWd((w) => ({ ...w, open: !w.open, msg: null }))} className={`${btn} py-3`}>↩️ Withdraw</button>
              </div>
              <OnchainCard />
              {wd.open && (
                <div className="hs-fade fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(28,18,12,0.55)] p-4" onClick={(e) => e.target === e.currentTarget && setWd({ open: false, amount: "", busy: false, msg: null, done: null })}>
                  {wd.done ? (
                    <WithdrawSent amount={wd.done} onClose={() => setWd({ open: false, amount: "", busy: false, msg: null, done: null })} />
                  ) : (
                    <div className={`${card} hs-card-in w-full max-w-sm p-5`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-xs font-black uppercase tracking-wider text-[#E46F3E]">My deposit</div>
                          <div className="text-2xl font-black text-[#3A2A22]">Take money back</div>
                        </div>
                        <button onClick={() => setWd({ open: false, amount: "", busy: false, msg: null, done: null })} aria-label="Close" className="rounded-full px-2 text-xl font-black text-[#7B6A5C] hover:bg-[#F6EDE2]">×</button>
                      </div>
                      <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#FFF1E6] px-3 py-2.5">
                        <span className="text-sm font-black text-[#3A2A22]">🌱 Available</span>
                        <span className="num text-xl font-black text-[#3A2A22]">{usd(bank.principalMicro)}</span>
                      </div>
                      <div className="mt-3 flex gap-1.5">
                        {[25, 50, 100].map((pc) => (
                          <button key={pc} onClick={() => setWd((w) => ({ ...w, amount: ((Number(bank.principalMicro) / 1e6) * pc / 100).toFixed(2) }))} className={`${btn} flex-1 py-1.5 text-xs`}>
                            {pc === 100 ? "All" : `${pc}%`}
                          </button>
                        ))}
                      </div>
                      <input value={wd.amount} onChange={(e) => setWd((w) => ({ ...w, amount: e.target.value.replace(/[^\d.]/g, "") }))} inputMode="decimal" placeholder="Amount in $" aria-label="Amount to withdraw" className="mt-2 w-full rounded-2xl border-[2.5px] border-[#E2D3C2] px-3 py-2.5 text-lg font-black outline-none focus:border-[#F58A3C]" />
                      <p className="mt-2 text-[11px] font-semibold leading-snug text-[#7B6A5C]">The amount you take back stops growing fruit straight away and usually reaches your bank in 1–3 business days.</p>
                      <div className="mt-2">
                        <MoneyFlow direction="out" compact />
                      </div>
                      {wd.msg && <p className="mt-2 rounded-xl bg-[#FBE1DD] px-3 py-2 text-xs font-bold text-[#C8463A]">{wd.msg}</p>}
                      <button disabled={wd.busy || !Number(wd.amount)} onClick={withdraw} className={`${btnP} mt-3 w-full py-3 text-base`}>
                        {wd.busy ? "Sending…" : `↩️ Withdraw ${wd.amount ? `$${wd.amount}` : ""}`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="py-6 text-center text-sm font-bold text-[#7B6A5C]">Loading…</div>
          )}
        </div>
      )}

      {tab === "golden" && (
        <div className="mt-3">
          <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#FFF7DC] to-[#FFE9B0] p-3">
            <img src="/game/sprites/howto/heart_pool.png" alt="" className="h-14 w-14 shrink-0 object-contain" />
            <div className="text-[12px] font-semibold leading-snug text-[#5C4A3D]">
              <b className="text-[#3A2A22]">A gift from everyone.</b> Ad money fills the Community Pool and is shared equally. Your share grows as <b>golden fruit</b>. Choose where it goes.
            </div>
          </div>
          {!tree.golden.length && (
            <div className="mt-3 rounded-2xl bg-[#F6EDE2] p-4 text-center">
              <div className="text-3xl">🎁</div>
              <div className="font-black text-[#3A2A22]">No community gift yet</div>
              <div className="text-xs font-semibold text-[#7B6A5C]">Watch an ad after a game to fill the pool.</div>
            </div>
          )}
          {tree.golden.map((g) => (
            <GiftRow key={g.allocationId} g={g} towns={towns} homeId={homeId} homeName={homeName} onChanged={onChanged} flash={flash} />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

/** Adds business days (Mon–Fri) to a date. */
function addBusinessDays(from: Date, n: number) {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1;
  }
  return d;
}

/** "Your money is on its way back": amount, arrival estimate and the steps it goes through. */
function WithdrawSent({ amount, onClose }: { amount: string; onClose: () => void }) {
  const by = addBusinessDays(new Date(), 3).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="rounded-[26px] border-[3px] border-[#8A6448] bg-[#FFF9F0] p-5 text-center shadow-[0_5px_0_#8A6448,0_18px_40px_rgba(0,0,0,0.3)] hs-card-in w-full max-w-sm">
      <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
        <span aria-hidden className="hs-shock absolute inset-0 rounded-full border-[5px] border-[#5BBF7A]" />
        <span className="hs-pop flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-[#2F7A47] bg-[#5BBF7A] text-4xl shadow-[0_4px_0_#2F7A47]">↩️</span>
      </div>
      <div className="mt-3 text-xs font-black uppercase tracking-wider text-[#3F9B5B]">Withdrawal on its way</div>
      <div className="num text-4xl font-black text-[#3A2A22]">${amount}</div>
      <div className="mt-1 text-sm font-bold text-[#5C4A3D]">
        Arrives in <b>1–3 business days</b> (by {by})
      </div>
      <div className="mt-4 text-left">
        <div className="mb-1.5 text-xs font-black uppercase tracking-wider text-[#8A6448]">Its trip back to you</div>
        <MoneyFlow direction="out" active={0} />
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[10px] font-bold text-[#7B6A5C]">
          <div className="rounded-xl bg-[#F6EDE2] px-1 py-1.5">🌱🔐 RHEA + Vault<br /><b className="text-[#3A2A22]">minutes</b></div>
          <div className="rounded-xl bg-[#F6EDE2] px-1 py-1.5"><img src="/brand/near.svg" alt="" className="mr-1 inline h-4 w-4 rounded align-[-3px]" />NEAR Intents<br /><b className="text-[#3A2A22]">usually &lt; 1 hour</b></div>
          <div className="rounded-xl bg-[#F6EDE2] px-1 py-1.5"><img src="/brand/coinbase.svg" alt="" className="mr-1 inline h-4 w-4 rounded align-[-3px]" />Coinbase → 🏦 bank<br /><b className="text-[#3A2A22]">1–3 business days</b></div>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-semibold text-[#9A887A]">You can follow it under 🌱 My money as &quot;On its way back to you&quot;.</p>
      <button onClick={onClose} className="mt-3 w-full rounded-2xl border-[3px] border-[#8A6448] bg-[#F58A3C] py-3 text-base font-black text-white shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448]">
        Got it!
      </button>
    </div>
  );
}

function MoneyRow({ icon, label, hint, value, tone }: { icon: string; label: string; hint?: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5" style={{ background: tone ?? "#F6EDE2" }}>
      <span className="text-2xl">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-black text-[#3A2A22]">{label}</div>
        {hint && <div className="text-[11px] font-semibold text-[#7B6A5C]">{hint}</div>}
      </div>
      <div className="num text-lg font-black text-[#3A2A22]">{value}</div>
    </div>
  );
}

/** One community gift: send it to your home town automatically, or pick a town. */
function GiftRow({ g, towns, homeId, homeName, onChanged, flash }: { g: Golden; towns: WorldTown[]; homeId: string | null; homeName: string | null; onChanged: () => Promise<unknown>; flash: (t: string) => void }) {
  const current = g.choices[0]?.causeId ?? null;
  // Auto is the default: anything the player didn't pick themselves (empty, or pre-filled by the default rule)
  const isAuto = g.choiceSource !== "user" || !current || current === homeId;
  const autoName = (isAuto && current ? towns.find((t) => t.id === current)?.cityName ?? g.choices[0]?.title : null) ?? homeName ?? "your home town";
  const [mode, setMode] = useState<"auto" | "pick">(isAuto ? "auto" : "pick");
  const [pick, setPick] = useState<string>(current ?? homeId ?? towns[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const going = towns.find((t) => t.id === (current ?? homeId))?.cityName ?? g.choices[0]?.title ?? homeName ?? "your home town";
  async function save(causeId: string, how: "auto" | "pick") {
    setBusy(true);
    try {
      await api("/api/pool/choice", "POST", { allocationId: g.allocationId, choices: [{ causeId, bps: 10000 }] });
      flash(how === "auto" ? `🎁 Your gift goes to ${homeName ?? "your home town"}.` : `🎁 Your gift goes to ${towns.find((t) => t.id === causeId)?.cityName ?? "that town"}.`);
      await onChanged();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const sent = g.status === "paid";
  return (
    <div className="mt-3 rounded-2xl border-[2.5px] border-[#F6C445] bg-white p-3">
      <div className="flex items-center gap-3">
        <img src="/game/sprites/town/fruit_gold_1.png" alt="" className="h-10 w-auto" />
        <div className="min-w-0 flex-1">
          <div className="num text-xl font-black text-[#3A2A22]">{usd(g.amountMicro)}</div>
          <div className="text-[11px] font-bold text-[#7B6A5C]">{sent ? `Sent to ${going} ✓` : `Going to ${going}`}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${sent ? "bg-[#E4F4E6] text-[#2E6B45]" : "bg-[#FFF4D6] text-[#8A6A1E]"}`}>{sent ? "DELIVERED" : g.canChoose ? "YOUR CHOICE" : "ON ITS WAY"}</span>
      </div>
      {g.canChoose && (
        <div className="mt-3 space-y-2">
          <button disabled={busy} onClick={() => { setMode("auto"); if (homeId && !isAuto) void save(homeId, "auto"); }} className={`flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition ${mode === "auto" ? "border-[#3F9B5B] bg-[#E4F4E6]" : "border-[#E4D3BE] bg-white"}`}>
            <span className="text-xl">🚚</span>
            <span className="flex-1">
              <span className="block text-sm font-black text-[#3A2A22]">Auto delivery <span className="ml-1 rounded-full bg-[#3F9B5B] px-1.5 py-0.5 align-middle text-[9px] text-white">DEFAULT</span></span>
              <span className="block text-[11px] font-semibold text-[#7B6A5C]">Goes to {isAuto ? autoName : homeName ?? "your home town"} for you, no need to do anything</span>
            </span>
            {mode === "auto" && <span className="text-sm font-black text-[#3F9B5B]">✓</span>}
          </button>
          <button disabled={busy} onClick={() => setMode("pick")} className={`flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition ${mode === "pick" ? "border-[#F58A3C] bg-[#FFF1E6]" : "border-[#E4D3BE] bg-white"}`}>
            <span className="text-xl">👆</span>
            <span className="flex-1">
              <span className="block text-sm font-black text-[#3A2A22]">Pick a town</span>
              <span className="block text-[11px] font-semibold text-[#7B6A5C]">Choose any cause yourself</span>
            </span>
            {mode === "pick" && <span className="text-sm font-black text-[#C7601F]">✓</span>}
          </button>
          {mode === "pick" && (
            <div className="hs-card-in rounded-xl bg-[#F6EDE2] p-2">
              <div className="grid grid-cols-2 gap-1.5">
                {towns.map((t) => (
                  <button key={t.id} onClick={() => setPick(t.id)} className={`rounded-xl border-2 px-2 py-1.5 text-left text-xs font-black ${pick === t.id ? "border-[#F58A3C] bg-white shadow-[0_2px_0_#E46F3E]" : "border-[#E4D3BE] bg-white/70"}`}>
                    {t.cityName}
                    <span className="block truncate text-[10px] font-bold text-[#7B6A5C]">{t.title}</span>
                  </button>
                ))}
              </div>
              <button disabled={busy || !pick} onClick={() => void save(pick, "pick")} className={`${btnP} mt-2 w-full py-2 text-sm`}>
                🎁 Send my gift to {towns.find((t) => t.id === pick)?.cityName ?? "this town"}
              </button>
            </div>
          )}
        </div>
      )}
      {g.simulated && <div className="mt-2 text-[10px] font-bold text-[#9A887A]">Test mode: this gift is simulated.</div>}
    </div>
  );
}

type ChainView = {
  enabled: boolean;
  wallet?: { account: string; url: string; exists: boolean };
  vault?: { account: string; url: string };
  onchain?: { principalMicro: string; donatedMicro: string; walletUsdcMicro: string; yieldMicro: string } | null;
  txs?: { kind: string; step: string; note: string | null; amountMicro: string | null; hash: string; url: string; at: string }[];
};
const TX_LABEL: Record<string, string> = { mint: "Test USDC to your wallet", to_vault: "Deposit → Hugshire Vault", process: "Vault → RHEA lending (mock)", donate: "Donation → cause wallet", withdraw: "Withdrawal → your wallet" };
const TOWN: Record<string, string> = { pawsbury: "Pawsbury", "inkwell-hollow": "Inkwell Hollow", fernhollow: "Fernhollow", "ladle-lane": "Ladle Lane" };

/** Demo onchain mode: the player's real NEAR testnet position and transactions, with explorer links. */
function OnchainCard() {
  const [v, setV] = useState<ChainView | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/chain").then((r) => r.json()).then((j) => alive && setV(j)).catch(() => {});
    load();
    const t = window.setInterval(load, 8000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!v?.enabled) return null;
  const o = v.onchain;
  return (
    <div className="mt-2 rounded-2xl border-2 border-[#2B6FA8]/40 bg-[#EEF5FB] p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-black text-[#1F4E79]">⛓️ Onchain · NEAR testnet</div>
        <span className="rounded-full bg-[#2B6FA8] px-2 py-0.5 text-[10px] font-black text-white">LIVE TXS</span>
      </div>
      {o ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          {[["In the Vault", o.principalMicro], ["Donated onchain", o.donatedMicro], ["Back in wallet", o.walletUsdcMicro]].map(([l, m]) => (
            <div key={l} className="rounded-xl bg-white px-1 py-1.5">
              <div className="num text-sm font-black text-[#1F4E79]">{usd(m)}</div>
              <div className="text-[10px] font-bold text-[#5B7A96]">{l}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] font-bold text-[#5B7A96]">Your deposit is being written to the chain… (about half a minute)</p>
      )}
      {!!v.txs?.length && (
        <ul className="mt-2 space-y-1">
          {v.txs.slice(0, 5).map((t) => (
            <li key={t.hash + t.step} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1 text-[11px] font-bold text-[#3A4A5A]">
              <span className="truncate">{t.step === "donate" ? `Donation → ${TOWN[t.note ?? ""] ?? "cause"} wallet` : TX_LABEL[t.step] ?? t.step}{t.amountMicro ? ` · ${usd(t.amountMicro)}` : ""}</span>
              <a href={t.url} target="_blank" rel="noreferrer" className="shrink-0 font-black text-[#2B6FA8] underline">{t.hash.slice(0, 6)}… ↗</a>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-black">
        {v.wallet?.exists && <a href={v.wallet.url} target="_blank" rel="noreferrer" className="text-[#2B6FA8] underline">Your wallet ↗</a>}
        {v.vault && <a href={v.vault.url} target="_blank" rel="noreferrer" className="text-[#2B6FA8] underline">Vault contract ↗</a>}
      </div>
      <p className="mt-1.5 text-[10px] font-semibold leading-snug text-[#5B7A96]">Testnet with test USDC and a mock RHEA pool. Card payment, the bridge and bank payout are still simulated.</p>
    </div>
  );
}
