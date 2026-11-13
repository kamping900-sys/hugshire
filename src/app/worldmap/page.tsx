import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { RoadWorldMap } from "@/components/worldmap/RoadWorldMap";

export const metadata: Metadata = { title: "World map" };
export const viewport: Viewport = { themeColor: "#BFE3F2", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

/** Level 1: side-scrolling road. Drive the van between towns; each town opens its detailed map. */
export default function WorldMapPage() {
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-[#BFE3F2]">
      <Suspense>
        <RoadWorldMap />
      </Suspense>
    </div>
  );
}
