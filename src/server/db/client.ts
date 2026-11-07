import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import path from "node:path";
import fs from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

type Holder = { db?: Db; ready?: Promise<Db>; close?: () => Promise<void> };
const g = globalThis as unknown as { __hugshireDb?: Holder };
const holder: Holder = (g.__hugshireDb ??= {});

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/**
 * Opens the database named by DATABASE_URL:
 *   pglite:memory          in-memory embedded Postgres (tests)
 *   pglite:<dir>           embedded Postgres on disk (local dev without Docker)
 *   postgres://...         real PostgreSQL (staging / production)
 * Migrations are applied on open so a fresh checkout works without extra steps.
 */
export async function openDb(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const target = url.slice("pglite:".length);
    let client;
    if (target === "memory") client = new PGlite();
    else {
      fs.mkdirSync(path.resolve(target), { recursive: true });
      client = new PGlite(path.resolve(target));
    }
    const db = drizzle(client, { schema }) as unknown as Db;
    await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS });
    return { db, close: () => client.close() };
  }
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({ connectionString: url, max: 10 });
  const pdb = drizzle(pool, { schema });
  await migrate(pdb, { migrationsFolder: MIGRATIONS });
  return { db: pdb as unknown as Db, close: () => pool.end() };
}

export async function getDb(): Promise<Db> {
  if (holder.db) return holder.db;
  if (!holder.ready) {
    const { env } = await import("../env");
    holder.ready = openDb(env().DATABASE_URL).then(({ db, close }) => {
      holder.db = db;
      holder.close = close;
      return db;
    });
  }
  return holder.ready;
}

/** Tests: install a specific database instance. */
export function setDbForTests(db: Db | undefined) {
  holder.db = db;
  holder.ready = db ? Promise.resolve(db) : undefined;
}

export { schema };
