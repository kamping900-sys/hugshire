import type { Metadata, Viewport } from "next";
import { TownView } from "@/components/town/TownView";

export const metadata: Metadata = { title: "Town" };
export const viewport: Viewport = { themeColor: "#A9D18E", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

/** Level 2: a detailed, shared organisation town. Full-screen like the overworld. */
export default async function TownPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-[#A9D18E]">
      <TownView slug={slug} />
    </div>
  );
}
