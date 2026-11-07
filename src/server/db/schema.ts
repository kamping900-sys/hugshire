import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  customType,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

/** Exact integer money column: numeric(38,0) <-> bigint (micro-USDC). */
export const micro = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(38,0)",
  toDriver: (v) => v.toString(),
  fromDriver: (v) => BigInt(v),
});

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const environment = () => text("environment", { enum: ["sandbox", "live"] }).notNull();

// ───────────────────────────── identity ─────────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  authProvider: text("auth_provider", { enum: ["dev", "privy"] }).notNull(),
  authSubject: text("auth_subject"),
  createdAt: createdAt(),
});

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  favoriteAnimal: text("favorite_animal").notNull().default("cat"),
  /** User-controlled NEAR implicit account (Privy embedded wallet). Owner of their Vault principal. */
  nearAccountId: text("near_account_id"),
  /** User-controlled Base address (Privy embedded wallet). Coinbase Onramp destination. */
  baseAddress: text("base_address"),
  riskAcknowledgedAt: timestamp("risk_acknowledged_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const loginCodes = pgTable("login_codes", {
  id: id(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ───────────────────────────── organisations & causes ─────────────────────────────

export const organizations = pgTable("organizations", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  website: text("website"),
  contactEmail: text("contact_email").notNull(),
  country: text("country").notNull().default("US"),
  taxId: text("tax_id"), // EIN; shown only to admins
  status: text("status", { enum: ["pending", "approved", "rejected", "suspended"] }).notNull().default("pending"),
  /** Receiving account for yield payouts (an org-controlled NEAR account). Must be verified by an admin. */
  payoutNearAccount: text("payout_near_account"),
  payoutVerifiedAt: timestamp("payout_verified_at", { withTimezone: true }),
  isSample: boolean("is_sample").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const organizationVerifications = pgTable("organization_verifications", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["registration", "payout_account"] }).notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  notes: text("notes"),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const CAUSE_CATEGORIES = ["education", "animals", "nature", "health", "food", "community"] as const;

export const causes = pgTable("causes", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  description: text("description").notNull().default(""),
  category: text("category", { enum: CAUSE_CATEGORIES }).notNull(),
  status: text("status", {
    enum: ["draft", "pending_review", "approved", "rejected", "suspended", "closed"],
  })
    .notNull()
    .default("draft"),
  reviewNote: text("review_note"),
  coverImageUrl: text("cover_image_url"),
  /** Symbolic goal used only to pace the city's visual stages. */
  goalMicro: micro("goal_micro").notNull().default(sql`1000000000`),
  /** Set when the cause's payout account is on the Vault allowlist (live) or approved (sandbox). */
  payoutReadyAt: timestamp("payout_ready_at", { withTimezone: true }),
  isSample: boolean("is_sample").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cities = pgTable("cities", {
  id: id(),
  causeId: uuid("cause_id").notNull().unique().references(() => causes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mapType: text("map_type", { enum: ["school", "shelter", "nature", "care", "food", "rebuild"] }).notNull(),
  worldX: integer("world_x").notNull(),
  worldY: integer("world_y").notNull(),
  seed: integer("seed").notNull(),
  createdAt: createdAt(),
});

export const causeUpdates = pgTable("cause_updates", {
  id: id(),
  causeId: uuid("cause_id").notNull().references(() => causes.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** "note" = organiser's words. "verified_progress" = admin checked real-world evidence. */
  kind: text("kind", { enum: ["note", "verified_progress"] }).notNull().default("note"),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ───────────────────────────── helpers (game identity) ─────────────────────────────

export const ANIMALS = ["cat", "bunny", "otter", "fox", "bear", "dog", "raccoon", "capybara"] as const;
export type Animal = (typeof ANIMALS)[number];

export const helpers = pgTable(
  "helpers",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    causeId: uuid("cause_id").notNull().references(() => causes.id),
    depositId: uuid("deposit_id").unique(),
    animal: text("animal", { enum: ANIMALS }).notNull(),
    nickname: text("nickname").notNull(),
    controlPreference: text("control_preference", { enum: ["manual", "auto"] }).notNull().default("manual"),
    lastPlayerActionAt: timestamp("last_player_action_at", { withTimezone: true }),
    environment: environment(),
    createdAt: createdAt(),
  },
  (t) => [index("helpers_cause_idx").on(t.causeId), index("helpers_user_idx").on(t.userId)],
);

export const helperPreferences = pgTable("helper_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  deliveryRule: text("delivery_rule", { enum: ["last_selected", "default_cause", "split", "favorite"] })
    .notNull()
    .default("last_selected"),
  defaultCauseId: uuid("default_cause_id").references(() => causes.id),
  favoriteCauseId: uuid("favorite_cause_id").references(() => causes.id),
  lastSelectedCauseId: uuid("last_selected_cause_id").references(() => causes.id),
  /** [{ causeId, bps }] summing to 10000 */
  split: jsonb("split").$type<{ causeId: string; bps: number }[]>().notNull().default([]),
  autoEnabled: boolean("auto_enabled").notNull().default(true),
  autoThresholdMicro: micro("auto_threshold_micro").notNull().default(sql`1000000`),
  inactivityTimeoutSeconds: integer("inactivity_timeout_seconds").notNull().default(3600),
  updatedAt: updatedAt(),
});

// ───────────────────────────── money in ─────────────────────────────

export const DEPOSIT_STATUSES = [
  "created",
  "onramp_pending",
  "onramp_completed",
  "bridging",
  "bridged",
  "vault_pending",
  "supplied",
  "failed",
  "refunded",
  "manual_review",
] as const;

export const deposits = pgTable(
  "deposits",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    causeId: uuid("cause_id").notNull().references(() => causes.id),
    environment: environment(),
    requestedMicro: micro("requested_micro").notNull(),
    /** Amount actually credited as principal once supplied. Null until then. */
    principalMicro: micro("principal_micro"),
    feesMicro: micro("fees_micro").notNull().default(sql`0`),
    status: text("status", { enum: DEPOSIT_STATUSES }).notNull().default("created"),
    idempotencyKey: text("idempotency_key").notNull(),
    animal: text("animal", { enum: ANIMALS }).notNull(),
    helperNickname: text("helper_nickname").notNull(),
    failureReason: text("failure_reason"),
    vaultTxHash: text("vault_tx_hash"),
    suppliedAt: timestamp("supplied_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deposits_idem").on(t.userId, t.idempotencyKey),
    check("deposits_positive", sql`${t.requestedMicro} > 0`),
  ],
);

export const supportPositions = pgTable("support_positions", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  environment: environment(),
  /** Cache of the ledger; reconciliation verifies it. */
  principalMicro: micro("principal_micro").notNull().default(sql`0`),
  withdrawingMicro: micro("withdrawing_micro").notNull().default(sql`0`),
  totalDepositedMicro: micro("total_deposited_micro").notNull().default(sql`0`),
  totalWithdrawnMicro: micro("total_withdrawn_micro").notNull().default(sql`0`),
  updatedAt: updatedAt(),
});

export const onrampTransactions = pgTable("onramp_transactions", {
  id: id(),
  depositId: uuid("deposit_id").references(() => deposits.id),
  withdrawalId: uuid("withdrawal_id"),
  direction: text("direction", { enum: ["buy", "sell"] }).notNull(),
  provider: text("provider", { enum: ["coinbase", "sandbox"] }).notNull(),
  partnerUserRef: text("partner_user_ref").notNull(),
  providerTxId: text("provider_tx_id"),
  status: text("status").notNull(),
  amountMicro: micro("amount_micro"),
  feeMicro: micro("fee_micro"),
  network: text("network").notNull().default("base"),
  walletAddress: text("wallet_address"),
  txHash: text("tx_hash"),
  raw: jsonb("raw"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const bridgeTransactions = pgTable("bridge_transactions", {
  id: id(),
  depositId: uuid("deposit_id").references(() => deposits.id),
  withdrawalId: uuid("withdrawal_id"),
  direction: text("direction", { enum: ["to_near", "to_base"] }).notNull(),
  provider: text("provider", { enum: ["oneclick", "sandbox"] }).notNull(),
  depositAddress: text("deposit_address"),
  quote: jsonb("quote"),
  amountInMicro: micro("amount_in_micro").notNull(),
  amountOutMicro: micro("amount_out_micro"),
  status: text("status").notNull(),
  txHashes: jsonb("tx_hashes").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const lendingPositions = pgTable("lending_positions", {
  id: id(),
  environment: environment().unique(),
  protocol: text("protocol").notNull().default("rhea"),
  vaultAccount: text("vault_account").notNull(),
  observedAssetsMicro: micro("observed_assets_micro").notNull().default(sql`0`),
  onchainPrincipalMicro: micro("onchain_principal_micro").notNull().default(sql`0`),
  supplyAprWad: text("supply_apr_wad").notNull().default("0"),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

// ───────────────────────────── yield ─────────────────────────────

export const yieldSnapshots = pgTable(
  "yield_snapshots",
  {
    id: id(),
    environment: environment(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    observedAssetsMicro: micro("observed_assets_micro").notNull(),
    ledgerAssetsBeforeMicro: micro("ledger_assets_before_micro").notNull(),
    yieldMicro: micro("yield_micro").notNull(),
    supplyAprWad: text("supply_apr_wad").notNull(),
    source: text("source", { enum: ["rhea_onchain", "sandbox_simulated_from_live_apr"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("yield_snapshots_period").on(t.environment, t.periodEnd)],
);

export const yieldAllocations = pgTable(
  "yield_allocations",
  {
    id: id(),
    snapshotId: uuid("snapshot_id").notNull().references(() => yieldSnapshots.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    amountMicro: micro("amount_micro").notNull(),
    consumedMicro: micro("consumed_micro").notNull().default(sql`0`),
    /** principal-seconds weight used for the split (audit trail) */
    weight: text("weight").notNull(),
    eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("yield_alloc_unique").on(t.snapshotId, t.userId),
    index("yield_alloc_user").on(t.userId),
    check("yield_alloc_consumed_le_amount", sql`${t.consumedMicro} <= ${t.amountMicro} AND ${t.consumedMicro} >= 0`),
  ],
);

// ───────────────────────────── deliveries & payouts ─────────────────────────────

export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    helperId: uuid("helper_id").references(() => helpers.id),
    causeId: uuid("cause_id").notNull().references(() => causes.id),
    environment: environment(),
    amountMicro: micro("amount_micro").notNull(),
    mode: text("mode", { enum: ["manual", "auto"] }).notNull(),
    status: text("status", { enum: ["pending", "queued", "paid", "failed", "cancelled"] }).notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    payoutId: uuid("payout_id"),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deliveries_idem").on(t.userId, t.idempotencyKey),
    index("deliveries_cause_status").on(t.causeId, t.status),
    check("deliveries_positive", sql`${t.amountMicro} > 0`),
  ],
);

export const deliveryAllocations = pgTable(
  "delivery_allocations",
  {
    deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id),
    allocationId: uuid("allocation_id").notNull().references(() => yieldAllocations.id),
    amountMicro: micro("amount_micro").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deliveryId, t.allocationId] }), check("da_positive", sql`${t.amountMicro} > 0`)],
);

export const charityPayouts = pgTable(
  "charity_payouts",
  {
    id: id(),
    causeId: uuid("cause_id").notNull().references(() => causes.id),
    environment: environment(),
    amountMicro: micro("amount_micro").notNull(),
    status: text("status", { enum: ["created", "submitted", "confirmed", "failed", "manual_review"] })
      .notNull()
      .default("created"),
    destinationAccount: text("destination_account").notNull(),
    batchKey: text("batch_key").notNull().unique(),
    txHash: text("tx_hash"),
    attempts: integer("attempts").notNull().default(0),
    failureReason: text("failure_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check("payout_positive", sql`${t.amountMicro} > 0`)],
);

// ───────────────────────────── money out ─────────────────────────────

export const WITHDRAWAL_STATUSES = [
  "requested",
  "pending_protocol_withdrawal",
  "bridging",
  "available_for_offramp",
  "offramp_processing",
  "completed",
  "failed",
  "manual_review",
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    environment: environment(),
    requestedMicro: micro("requested_micro").notNull(),
    /** What the Vault actually returned (may be lower than requested if the pool took a loss). */
    redeemedMicro: micro("redeemed_micro"),
    feesMicro: micro("fees_micro").notNull().default(sql`0`),
    receivedMicro: micro("received_micro"),
    status: text("status", { enum: WITHDRAWAL_STATUSES }).notNull().default("requested"),
    history: jsonb("history").$type<{ status: string; at: string; note?: string }[]>().notNull().default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    vaultTxHash: text("vault_tx_hash"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("withdrawals_idem").on(t.userId, t.idempotencyKey), check("wd_positive", sql`${t.requestedMicro} > 0`)],
);

// ───────────────────────────── ledger ─────────────────────────────

export const ledgerJournals = pgTable(
  "ledger_journals",
  {
    id: id(),
    environment: environment(),
    kind: text("kind").notNull(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    memo: text("memo"),
    createdAt: createdAt(),
  },
  // Posting the same business event twice is impossible: this is the idempotency backstop.
  (t) => [uniqueIndex("journal_once").on(t.environment, t.kind, t.refType, t.refId)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    journalId: uuid("journal_id").notNull().references(() => ledgerJournals.id),
    account: text("account").notNull(),
    /** Signed: positive = debit, negative = credit. Each journal sums to zero. */
    amountMicro: micro("amount_micro").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_account_idx").on(t.account), index("ledger_journal_idx").on(t.journalId)],
);

// ───────────────────────────── ops ─────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: uuid("actor_id"),
    actorType: text("actor_type", { enum: ["user", "admin", "system", "worker", "webhook"] }).notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_target_idx").on(t.targetType, t.targetId)],
);

export const adminActions = pgTable("admin_actions", {
  id: id(),
  adminId: uuid("admin_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason"),
  createdAt: createdAt(),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_once").on(t.provider, t.eventId)],
);

export const systemAlerts = pgTable("system_alerts", {
  id: id(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  data: jsonb("data"),
  /** Open alerts with the same key are not duplicated. */
  dedupeKey: text("dedupe_key").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    name: text("name").notNull(),
    /** e.g. "snapshot:2026-11-07T10" — a run key can only succeed once. */
    runKey: text("run_key").notNull(),
    status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
    detail: jsonb("detail"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("job_run_once").on(t.name, t.runKey)],
);
