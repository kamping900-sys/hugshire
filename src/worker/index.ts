/**
 * Hugshire background worker. Run one (or more) next to the web app:
 *   npm run worker
 * Jobs are idempotent and claimed per time bucket, so running two workers is safe.
 */
import { defaultCtx } from "../server/services/context";
import { startScheduler } from "../server/jobs";
import { env } from "../server/env";

const e = env(); // validates config; live mode refuses to start without credentials
console.log(`[worker] starting in ${e.HUGSHIRE_MODE} mode`);
const stop = startScheduler(defaultCtx, (m) => console.log(m));
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig}, stopping`);
    stop();
    setTimeout(() => process.exit(0), 500);
  });
}
