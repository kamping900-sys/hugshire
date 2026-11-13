"use client";
import { useEffect, useState } from "react";
import { musicEnabled, setMusicEnabled, startMusic } from "@/game/v4/music";

/**
 * Cozy background music + a small toggle. Browsers only allow sound after the player interacts, so
 * the music starts on the first click or key press. It keeps playing across game screens.
 */
export function BackgroundMusic({ className = "" }: { className?: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(musicEnabled());
    const go = () => {
      startMusic();
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", go);
    return () => {
      window.removeEventListener("pointerdown", go);
      window.removeEventListener("keydown", go);
    };
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const v = !on;
        setOn(v);
        setMusicEnabled(v);
      }}
      aria-label={on ? "Turn music off" : "Turn music on"}
      title={on ? "Music on" : "Music off"}
      className={`pointer-events-auto absolute bottom-3 left-16 z-40 flex h-10 w-10 items-center justify-center rounded-full border-[2.5px] border-[#8A6448] bg-[#FFF9F0]/90 text-lg shadow-[0_3px_0_#8A6448] transition hover:-translate-y-0.5 sm:bottom-4 ${on ? "" : "opacity-60"} ${className}`}
    >
      {on ? "🎵" : "🔇"}
    </button>
  );
}
