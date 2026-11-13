-- Stone mini-game removed: buildings are built from Wood only.
-- Unfinished buildings no longer need more Stone than they already have.
UPDATE "construction_projects" SET "stone_required" = "stone_contributed" WHERE "status" IN ('reserved', 'active');
--> statement-breakpoint
-- Any building that already had all its Wood is now complete.
UPDATE "construction_projects" SET "status" = 'completed', "completed_at" = now()
WHERE "status" = 'active' AND "wood_contributed" >= "wood_required" AND "stone_contributed" >= "stone_required";
