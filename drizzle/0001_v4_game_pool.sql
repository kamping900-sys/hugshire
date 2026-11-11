CREATE TABLE "ad_revenue_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"source" text NOT NULL,
	"external_ref" text NOT NULL,
	"gross_micro" numeric(38,0) NOT NULL,
	"status" text DEFAULT 'reported' NOT NULL,
	"received_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"simulated" boolean NOT NULL,
	"placement" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cause_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"plot_key" text NOT NULL,
	"blueprint_key" text NOT NULL,
	"initiator_id" uuid,
	"status" text DEFAULT 'reserved' NOT NULL,
	"wood_required" numeric(38,0) NOT NULL,
	"stone_required" numeric(38,0) NOT NULL,
	"wood_contributed" numeric(38,0) DEFAULT 0 NOT NULL,
	"stone_contributed" numeric(38,0) DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_wood_le" CHECK ("construction_projects"."wood_contributed" <= "construction_projects"."wood_required" AND "construction_projects"."wood_contributed" >= 0),
	CONSTRAINT "project_stone_le" CHECK ("construction_projects"."stone_contributed" <= "construction_projects"."stone_required" AND "construction_projects"."stone_contributed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"project_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"end_reason" text,
	"seed" integer NOT NULL,
	"base_reward_micro" numeric(38,0) NOT NULL,
	"principal_micro" numeric(38,0) NOT NULL,
	"hearts" integer DEFAULT 3 NOT NULL,
	"combo" integer DEFAULT 0 NOT NULL,
	"best_combo" integer DEFAULT 0 NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"round_revealed_at" timestamp with time zone NOT NULL,
	"earned_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"stats" jsonb DEFAULT '{"perfect":0,"hit":0,"miss":0,"fakeouts":0,"flags":[]}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_attestations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"subject_hash" text NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"choices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"choice_source" text,
	"status" text DEFAULT 'allocated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_alloc_positive" CHECK ("pool_allocations"."amount_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "pool_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'revenue_reported' NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"charity_bps" integer NOT NULL,
	"revenue_finalized_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"charity_budget_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"carry_in_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"treasury_funded_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"funding_tx_hash" text,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"per_tree_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"remainder_micro" numeric(38,0) DEFAULT 0 NOT NULL,
	"snapshot_hash" text,
	"snapshot_at" timestamp with time zone,
	"choice_deadline" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_eligibility" (
	"cycle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"eligible" boolean NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uniqueness_key" text,
	"override_by" uuid,
	"override_note" text,
	CONSTRAINT "pool_eligibility_cycle_id_user_id_pk" PRIMARY KEY("cycle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "pool_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"cause_id" uuid NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"destination_account" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"proposal_id" text,
	"tx_hash" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	CONSTRAINT "pool_payout_positive" CHECK ("pool_payouts"."amount_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "resource_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"resource" text NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"source" text NOT NULL,
	"ref_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_positive" CHECK ("resource_contributions"."amount_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "story_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"update_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"receiver" text NOT NULL,
	"amount_micro" numeric(38,0) NOT NULL,
	"payout_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"threshold" integer NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_proposals_payout_id_unique" UNIQUE("payout_id")
);
--> statement-breakpoint
ALTER TABLE "helper_preferences" ALTER COLUMN "auto_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "helper_preferences" ALTER COLUMN "inactivity_timeout_seconds" SET DEFAULT 604800;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD COLUMN "category" text DEFAULT 'news' NOT NULL;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD COLUMN "media_url" text;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD COLUMN "link_url" text;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD COLUMN "visibility" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "cause_updates" ADD COLUMN "moderation_note" text;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD COLUMN "auto_authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD COLUMN "auto_schedule" text DEFAULT 'inactivity' NOT NULL;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD COLUMN "auto_interval_seconds" integer DEFAULT 604800 NOT NULL;--> statement-breakpoint
ALTER TABLE "helper_preferences" ADD COLUMN "last_auto_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_revenue_reports" ADD CONSTRAINT "ad_revenue_reports_cycle_id_pool_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."pool_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_views" ADD CONSTRAINT "ad_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_project_id_construction_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."construction_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_attestations" ADD CONSTRAINT "identity_attestations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_allocations" ADD CONSTRAINT "pool_allocations_cycle_id_pool_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."pool_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_allocations" ADD CONSTRAINT "pool_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_eligibility" ADD CONSTRAINT "pool_eligibility_cycle_id_pool_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."pool_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_eligibility" ADD CONSTRAINT "pool_eligibility_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_payouts" ADD CONSTRAINT "pool_payouts_cycle_id_pool_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."pool_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_payouts" ADD CONSTRAINT "pool_payouts_cause_id_causes_id_fk" FOREIGN KEY ("cause_id") REFERENCES "public"."causes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_contributions" ADD CONSTRAINT "resource_contributions_project_id_construction_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."construction_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_contributions" ADD CONSTRAINT "resource_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_reports" ADD CONSTRAINT "story_reports_update_id_cause_updates_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."cause_updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_reports" ADD CONSTRAINT "story_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_report_once" ON "ad_revenue_reports" USING btree ("provider","external_ref");--> statement-breakpoint
CREATE INDEX "ad_views_user_time" ON "ad_views" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_plot_open" ON "construction_projects" USING btree ("environment","cause_id","plot_key") WHERE status in ('reserved','active','completed');--> statement-breakpoint
CREATE UNIQUE INDEX "project_initiator_open" ON "construction_projects" USING btree ("environment","initiator_id") WHERE status in ('reserved','active');--> statement-breakpoint
CREATE INDEX "project_cause_idx" ON "construction_projects" USING btree ("cause_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_session_one_open" ON "game_sessions" USING btree ("user_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "game_session_user_res" ON "game_sessions" USING btree ("user_id","resource","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attestation_subject_once" ON "identity_attestations" USING btree ("provider","subject_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_alloc_once" ON "pool_allocations" USING btree ("cycle_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_cycle_period" ON "pool_cycles" USING btree ("environment","period");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_elig_unique_person" ON "pool_eligibility" USING btree ("cycle_id","uniqueness_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_payout_once" ON "pool_payouts" USING btree ("cycle_id","cause_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_once" ON "resource_contributions" USING btree ("source","ref_key");--> statement-breakpoint
CREATE INDEX "contribution_user_day" ON "resource_contributions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "story_report_once" ON "story_reports" USING btree ("update_id","reporter_id");