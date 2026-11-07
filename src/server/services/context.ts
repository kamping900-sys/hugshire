import type { Db } from "../db/client";
import type { Environment } from "../core";
import type { Providers } from "../providers/types";

export type Ctx = {
  db: Db;
  environment: Environment;
  now: () => Date;
  p: Providers;
};

export async function defaultCtx(): Promise<Ctx> {
  const { getDb } = await import("../db/client");
  const { environmentTag } = await import("../env");
  const { providers } = await import("../providers");
  const db = await getDb();
  return { db, environment: environmentTag(), now: () => new Date(), p: providers(db) };
}

/** Run `fn` in a DB transaction, giving it a ctx bound to the transaction. */
export async function inTx<T>(ctx: Ctx, fn: (tx: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => fn({ ...ctx, db: tx as unknown as Db }));
}

/** Allowed state transitions; anything else is a bug and is refused. */
export function assertTransition<S extends string>(machine: Record<S, readonly S[]>, from: S, to: S, what: string) {
  if (!(machine[from] ?? []).includes(to)) throw new Error(`Illegal ${what} transition ${from} -> ${to}`);
}
