"use client";
import { useRouter } from "next/navigation";

/** Goes back to wherever the player came from (or `fallback` when opened directly). */
export function BackButton({ fallback = "/", className = "" }: { fallback?: string; className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className={`inline-flex items-center gap-1.5 rounded-2xl border-[3px] border-[#8A6448] bg-[#FFF9F0] px-4 py-2 font-black text-[#3A2A22] shadow-[0_4px_0_#8A6448] transition hover:-translate-y-0.5 active:translate-y-[2px] active:shadow-[0_2px_0_#8A6448] ${className}`}
    >
      ← Back
    </button>
  );
}
