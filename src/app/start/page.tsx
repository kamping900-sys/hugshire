import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/http";
import { env } from "@/server/env";
import { JourneyWizard } from "@/components/journey/JourneyWizard";

export const metadata: Metadata = { title: "Start helping" };
export const viewport: Viewport = { themeColor: "#FFDDB5" };
export const dynamic = "force-dynamic";

/** First-time journey (also "Add funds" from the Heart Bank: /start?step=fund). */
export default async function StartPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const user = await currentUser();
  const sp = await searchParams;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/start${sp.step ? `?step=${sp.step}` : ""}`)}`);
  const startStep = sp.step === "fund" ? 2 : sp.step === "town" ? 1 : 0;
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      <JourneyWizard startStep={startStep} sandbox={env().HUGSHIRE_MODE === "sandbox"} />
    </div>
  );
}
