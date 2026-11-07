/** Applies pending migrations to DATABASE_URL (opening the DB runs them). */
import { openDb } from "../src/server/db/client";
import { env } from "../src/server/env";

openDb(env().DATABASE_URL)
  .then(async ({ close }) => {
    console.log("Migrations applied.");
    await close();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
