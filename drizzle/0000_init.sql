CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"data" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridge_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deposit_id" uuid,
	"withdrawal_id" uuid,
	"direction" text NOT NULL,
	"provider" text NOT NULL,
	"deposit_address" text,
	"quote" jsonb,
	"amount_in_micro" numeric(38,0) NOT NULL,
	"amount_out_micro" numeric(38,0),
	"status" text NOT NULL,
	"tx_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cause_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cause_id" uuid NOT NULL,
	"author_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "causes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_note" text,
	"cover_image_url" text,
	"goal_micro" numeric(38,0) DEFAULT 1000000000 NOT NULL,
	"payout_ready_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "causes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "charity_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cause_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"destination_account" text NOT NULL,
	"batch_key" text NOT NULL,
	"tx_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charity_payouts_batch_key_unique" UNIQUE("batch_key"),
	CONSTRAINT "payout_positive" CHECK ("charity_payouts"."amount_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cause_id" uuid NOT NULL,
	"name" text NOT NULL,
	"map_type" text NOT NULL,
	"world_x" integer NOT NULL,
	"world_y" integer NOT NULL,
	"seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_cause_id_unique" UNIQUE("cause_id")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"helper_id" uuid,
	"cause_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payout_id" uuid,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_positive" CHECK ("deliveries"."amount_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_allocations" (
	"delivery_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	CONSTRAINT "delivery_allocations_delivery_id_allocation_id_pk" PRIMARY KEY("delivery_id","allocation_id"),
	CONSTRAINT "da_positive" CHECK ("delivery_allocations"."amount_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cause_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"requested_micro" numeric(38,0) NOT NULL,
	"principal_micro" numeric(38,0),
	"fees_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"idempotency_key" text NOT NULL,
	"animal" text NOT NULL,
	"helper_nickname" text NOT NULL,
	"failure_reason" text,
	"vault_tx_hash" text,
	"supplied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_positive" CHECK ("deposits"."requested_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "helper_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"delivery_rule" text DEFAULT 'last_selected' NOT NULL,
	"default_cause_id" uuid,
	"favorite_cause_id" uuid,
	"last_selected_cause_id" uuid,
	"split" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_enabled" boolean DEFAULT true NOT NULL,
	"auto_threshold_micro" numeric(38,0) DEFAULT 1000000 NOT NULL,
	"inactivity_timeout_seconds" integer DEFAULT 3600 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helpers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cause_id" uuid NOT NULL,
	"deposit_id" uuid,
	"animal" text NOT NULL,
	"nickname" text NOT NULL,
	"control_preference" text DEFAULT 'manual' NOT NULL,
	"last_player_action_at" timestamp with time zone,
	"environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helpers_deposit_id_unique" UNIQUE("deposit_id")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"run_key" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account" text NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lending_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"protocol" text DEFAULT 'rhea' NOT NULL,
	"vault_account" text NOT NULL,
	"observed_assets_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"onchain_principal_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"supply_apr_wad" text DEFAULT '0' NOT NULL,
	"last_observed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lending_positions_environment_unique" UNIQUE("environment")
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onramp_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deposit_id" uuid,
	"withdrawal_id" uuid,
	"direction" text NOT NULL,
	"provider" text NOT NULL,
	"partner_user_ref" text NOT NULL,
	"provider_tx_id" text,
	"status" text NOT NULL,
	"amount_micro" numeric(38,0),
	"fee_micro" numeric(38,0),
	"network" text DEFAULT 'base' NOT NULL,
	"wallet_address" text,
	"tx_hash" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organization_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"website" text,
	"contact_email" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"tax_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payout_near_account" text,
	"payout_verified_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_positions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"principal_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"withdrawing_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"total_deposited_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"total_withdrawn_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"severity" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"dedupe_key" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"favorite_animal" text DEFAULT 'cat' NOT NULL,
	"near_account_id" text,
	"base_address" text,
	"risk_acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"auth_provider" text NOT NULL,
	"auth_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"requested_micro" numeric(38,0) NOT NULL,
	"redeemed_micro" numeric(38,0),
	"fees_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"received_micro" numeric(38,0),
	"status" text DEFAULT 'requested' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"vault_tx_hash" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wd_positive" CHECK ("withdrawals"."requested_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "yield_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"consumed_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"weight" text NOT NULL,
	"eligible_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "yield_alloc_consumed_le_amount" CHECK ("yield_allocations"."consumed_micro" <= "yield_allocations"."amount_micro" AND "yield_allocations"."consumed_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "yield_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"observed_assets_micro" numeric(38,0) NOT NULL,
	"ledger_assets_before_micro" numeric(38,0) NOT NULL,
	"yield_micro" numeric(38,0) NOT NULL,
	"supply_apr_wad" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_transactions" ADD CONSTRAINT "bridge_transactions_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD CONSTRAINT "cause_updates_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD CONSTRAINT "cause_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD CONSTRAINT "cause_updates_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "causes" ADD CONSTRAINT "causes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charity_payouts" ADD CONSTRAINT "charity_payouts_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_helper_id_helpers_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helpers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_allocations" ADD CONSTRAINT "delivery_allocations_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_allocations" ADD CONSTRAINT "delivery_allocations_allocation_id_yield_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."yield_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD CONSTRAINT "helper_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD CONSTRAINT "helper_preferences_default_cause_id_causes_id_fk" FOREIGN KEY ("default_cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD CONSTRAINT "helper_preferences_favorite_cause_id_causes_id_fk" FOREIGN KEY ("favorite_cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD CONSTRAINT "helper_preferences_last_selected_cause_id_causes_id_fk" FOREIGN KEY ("last_selected_cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onramp_transactions" ADD CONSTRAINT "onramp_transactions_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_verifications" ADD CONSTRAINT "organization_verifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_verifications" ADD CONSTRAINT "organization_verifications_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_positions" ADD CONSTRAINT "support_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_allocations" ADD CONSTRAINT "yield_allocations_snapshot_id_yield_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."yield_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yield_allocations" ADD CONSTRAINT "yield_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_idem" ON "deliveries" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "deliveries_cause_status" ON "deliveries" USING btree ("cause_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_idem" ON "deposits" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "helpers_cause_idx" ON "helpers" USING btree ("cause_id");--> statement-breakpoint
CREATE INDEX "helpers_user_idx" ON "helpers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_once" ON "job_runs" USING btree ("name","run_key");--> statement-breakpoint
CREATE INDEX "ledger_account_idx" ON "ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE INDEX "ledger_journal_idx" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_once" ON "ledger_journals" USING btree ("environment","kind","ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_once" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_idem" ON "withdrawals" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "yield_alloc_unique" ON "yield_allocations" USING btree ("snapshot_id","user_id");--> statement-breakpoint
CREATE INDEX "yield_alloc_user" ON "yield_allocations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "yield_snapshots_period" ON "yield_snapshots" USING btree ("environment","period_end");