/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { formatUsd } from "@/lib/money";
import { defaultCtx } from "@/server/services/context";
import { worldTowns } from "@/server/services/towns";
import { currentUser } from "@/server/http";
import { SceneBackdrop } from "@/components/journey/shared";

export const dynamic = "force-dynamic";

const btnBase = "inline-flex items-center justify-center rounded-2xl border-[3px] border-[#8A6448] font-black shadow-[0_4px_0_#8A6448] transition active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448]";
const MASCOTS = ["cat", "rabbit", "otter", "fox", "panda", "dog", "raccoon", "bird"];
const CAT_EMOJI: Record<string, string> = { animals: "🐾", education: "📚", nature: "🌿", health: "🩺", food: "🥕", community: "🤝" };

/** Title screen: the game is the product. "Start helping" begins the journey; "Look around" drives the road as a guest. */
export const metadata = { title: "Old landing" };

/** The previous title-screen homepage, kept at /old-landing for reference. */
export default async function OldLanding() {
  const ctx = await defaultCtx();
  const user = await currentUser();
  const towns = await worldTowns(ctx);
  return (
    <div>
      {/* Title screen */}
      <section className="relative h-[calc(100svh-64px)] min-h-[560px] overflow-hidden">
        <SceneBackdrop>
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 pb-[18vh] text-center">
            <img src="/brand/logo.png" alt="" className="h-24 w-24 rounded-[28px] border-[3px] border-[#8A6448] shadow-[0_6px_0_#8A644866] sm:h-28 sm:w-28" />
            <h1 className="mt-4 text-5xl font-black tracking-tight text-[#3A2A22] drop-shadow-[0_3px_0_#FFF9F0] sm:text-7xl">Hugshire</h1>
            <p className="mt-1 text-xl font-black text-[#C7601F] drop-shadow-[0_2px_0_#FFF9F0] sm:text-2xl">Where kindness takes shape.</p>
            <p className="mt-3 max-w-xl rounded-2xl bg-[#FFF9F0]/85 px-4 py-2 text-sm font-bold text-[#5C4A3D] sm:text-base">
              Plant money that stays yours. Its interest grows fruit for real causes, and together we build their towns.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href={user ? "/start" : "/login?next=/start"} className={`${btnBase} bg-[#F58A3C] px-8 py-4 text-xl text-white`}>
                🌱 Start helping
              </Link>
              <Link href="/worldmap" className={`${btnBase} bg-[#FFF9F0] px-8 py-4 text-xl text-[#3A2A22]`}>
                🚐 Just look around
              </Link>
            </div>
            <div className="mt-6 flex -space-x-3">
              {MASCOTS.map((m, i) => (
                <img key={m} src={`/mascots/${m}.png`} alt="" className="h-12 w-12 rounded-full border-[3px] border-[#FFF9F0] bg-white object-cover shadow sm:h-14 sm:w-14" style={{ transform: `translateY(${i % 2 ? 4 : -2}px)` }} />
              ))}
            </div>
          </div>
        </SceneBackdrop>
      </section>

      {/* How it works, in three cozy steps */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-center text-3xl font-black text-[#3A2A22] sm:text-4xl">How kindness takes shape</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["💛", "Plant a Heart Tree", "Add money (from $5). It stays yours: lent out through RHEA on NEAR, and you can withdraw your principal any time."],
            ["🍎", "Interest grows fruit", "The real interest it earns appears as fruit on your tree, to the exact cent. Playing never creates money."],
            ["🏡", "Fruit helps, towns grow", "Deliver fruit to real causes. Chop Wood together in a quick timing game to build each cause's town."],
          ].map(([e, t, d], i) => (
            <div key={t} className="rounded-[24px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0] p-6 shadow-[0_4px_0_#8A644833]">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDE6D4] text-2xl">{e}</span>
                <span className="text-sm font-black text-[#E46F3E]">Step {i + 1}</span>
              </div>
              <div className="mt-3 text-xl font-black text-[#3A2A22]">{t}</div>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-[#7B6A5C]">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-[24px] border-2 border-dashed border-[#E2C9AE] bg-[#FFF4E8] p-5 text-sm font-semibold text-[#5C4A3D]">
          <b>✨ Community Heart Pool:</b> a published share of the ad revenue Hugshire actually receives is shared <b>equally</b> between supporters each month, as golden fruit you send to the causes you choose. <Link href="/pool" className="font-black underline">How it works</Link>
        </div>
      </section>

      {/* Towns */}
      <section className="bg-[#F6EDE2]/70 py-14">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-3xl font-black text-[#3A2A22]">Towns waiting for helpers</h2>
            <Link href="/worldmap" className="text-sm font-black text-[#C7601F] underline">Drive the road →</Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {towns.map((t) => (
              <Link key={t.id} href={`/worldmap/town/${t.slug}`} className="rounded-[22px] border-[2.5px] border-[#8A6448] bg-[#FFF9F0] p-5 shadow-[0_4px_0_#8A644833] transition hover:-translate-y-1">
                <div className="text-3xl">{CAT_EMOJI[t.category] ?? "🏡"}</div>
                <div className="mt-2 text-lg font-black text-[#3A2A22]">{t.cityName}</div>
                <div className="text-xs font-black text-[#E46F3E]">{t.title}</div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#7B6A5C]">{t.summary}</p>
                <div className="mt-3 text-[11px] font-bold text-[#9A887A]">
                  {t.helpers} helpers · {t.completed} built · {formatUsd(BigInt(t.deliveredMicro))} delivered
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Honesty */}
      <section className="mx-auto max-w-4xl px-4 py-12 text-center">
        <h2 className="text-2xl font-black text-[#3A2A22]">Honest by design</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm font-semibold leading-relaxed text-[#7B6A5C]">
          Hugshire is not a bank. Lending carries risk, including possible loss. Only interest goes to charity; the game never creates money; Wood has no cash value; buildings are virtual and are not proof of real-world impact. Real updates come from each organisation&apos;s Notice Board.
        </p>
        <div className="mt-5 flex justify-center gap-4 text-sm font-black">
          <Link href="/how-it-works" className="text-[#C7601F] underline">How money works</Link>
          <Link href="/org" className="text-[#C7601F] underline">For organisations</Link>
        </div>
      </section>
    </div>
  );
}
