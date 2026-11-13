INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p3', 'bookshop', 'active', 2000000000, 0, 840000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'pawsbury' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p3' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p8', 'house', 'active', 400000000, 0, 220000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'pawsbury' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p8' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p1', 'school', 'active', 12000000000, 0, 1440000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'pawsbury' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p1' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p4', 'bookshop', 'active', 2000000000, 0, 700000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'inkwell-hollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p4' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p6', 'cottage', 'active', 300000000, 0, 204000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'inkwell-hollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p6' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p2', 'school', 'active', 12000000000, 0, 2160000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'inkwell-hollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p2' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p7', 'barn', 'active', 2200000000, 0, 1012000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'fernhollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p7' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p5', 'cottage', 'active', 300000000, 0, 90000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'fernhollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p5' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p8', 'house', 'active', 400000000, 0, 288000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'fernhollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p8' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p9', 'barn', 'active', 2200000000, 0, 616000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'ladle-lane' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p9' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p10', 'house', 'active', 400000000, 0, 240000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'ladle-lane' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p10' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
--> statement-breakpoint
INSERT INTO "construction_projects" ("cause_id", "environment", "plot_key", "blueprint_key", "status", "wood_required", "stone_required", "wood_contributed", "stone_contributed")
SELECT c."id", 'sandbox', 'p1', 'townHall', 'active', 50000000000, 0, 4000000000, 0
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'ladle-lane' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."plot_key" = 'p1' AND p."status" IN ('reserved','active','completed'))
AND (SELECT count(*) FROM "construction_projects" p WHERE p."cause_id" = c."id" AND p."status" IN ('reserved','active')) < 3;
