-- NEAR testnet transactions behind each game action (demo onchain mode).
CREATE TABLE IF NOT EXISTS "chain_txs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "ref_type" text NOT NULL,
  "ref_id" uuid NOT NULL,
  "step" text NOT NULL,
  "tx_hash" text NOT NULL,
  "account" text,
  "note" text,
  "amount_micro" numeric(38, 0),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chain_tx_ref_step" ON "chain_txs" ("ref_type", "ref_id", "step");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chain_tx_user_idx" ON "chain_txs" ("user_id");
