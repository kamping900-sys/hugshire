import type { Metadata, Viewport } from "next";
import { WorldMapGame } from "@/components/worldmap/WorldMapGame";

export const metadata: Metadata = { title: "World map" };
export const viewport: Viewport = { themeColor: "#BFE0A6", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

/** Full-screen game view. Covers the site chrome; the HUD has its own way home. */
export default function WorldMapPage() {
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-[#BFE0A6]">
      <WorldMapGame />
    </div>
  );
}
