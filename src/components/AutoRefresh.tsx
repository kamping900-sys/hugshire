"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server page every few seconds while something is in flight. */
export function AutoRefresh({ active, ms = 4000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
