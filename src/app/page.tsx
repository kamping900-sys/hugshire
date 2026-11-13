import type { Metadata, Viewport } from "next";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { LandingScene } from "@/components/landing/LandingScene";

export const metadata: Metadata = { title: { absolute: "Hugshire — where kindness takes shape" } };
export const viewport: Viewport = { themeColor: "#FFDDB5", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };
export const dynamic = "force-dynamic";

/** Homepage: the live world map as the background, title + CTA on top. */
export default async function Home({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const user = await currentUser();
  const { start } = await searchParams;
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      <LandingScene signedIn={!!user} sandbox={env().HUGSHIRE_MODE === "sandbox"} autoStart={start === "1"} />
    </div>
  );
}
