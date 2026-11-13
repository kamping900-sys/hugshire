-- building costs went up 100× (Wood now pays out 50× more): scale existing projects so their progress % stays the same
UPDATE "construction_projects" SET "wood_required" = "wood_required" * 100, "wood_contributed" = "wood_contributed" * 100;
