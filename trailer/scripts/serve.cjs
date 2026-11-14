/**
 * Runs the built Hugshire app for filming, on port 3300, against its own database copy
 * (.data/trailer), always in test mode. Never touches the main dev database.
 */
const { spawn } = require("child_process");
const path = require("path");
const APP = path.join(__dirname, "..", "..");
const env = {
  ...process.env,
  HUGSHIRE_MODE: "sandbox",
  DATABASE_URL: "pglite:.data/trailer",
  SESSION_SECRET: "trailer-only-session-secret-0123456789abcdef0123456789abcdef",
  APP_URL: "http://localhost:3300",
  AUTH_PROVIDER: "dev",
  HUGSHIRE_INPROCESS_WORKER: "1",
  NODE_ENV: "production",
};
const p = spawn(process.execPath, [path.join(APP, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3300"], { cwd: APP, env, stdio: "inherit" });
p.on("exit", (c) => process.exit(c ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => p.kill(s));
