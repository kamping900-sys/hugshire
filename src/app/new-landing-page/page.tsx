import { redirect } from "next/navigation";

/** The new landing page is now the homepage; keep old links working. */
export default async function NewLandingPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  redirect(start === "1" ? "/?start=1" : "/");
}
