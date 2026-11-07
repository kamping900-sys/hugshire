/**
 * In sandbox development the job scheduler runs inside the Next.js server so a single
 * `npm run dev` is enough. Live deployments run `npm run worker` as a separate process.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const mode = process.env.HUGSHIRE_MODE ?? "sandbox";
  if (mode !== "sandbox" || process.env.HUGSHIRE_INPROCESS_WORKER === "0") return;
  const { startScheduler } = await import("./server/jobs");
  const { defaultCtx } = await import("./server/services/context");
  startScheduler(defaultCtx, (m) => console.log(m));
  console.log("[hugshire] sandbox scheduler running in-process");
}
