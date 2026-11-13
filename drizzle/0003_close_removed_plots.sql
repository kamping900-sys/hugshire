-- The town map was made smaller (16 plots → 10). Unfinished buildings on the removed plots
-- (p11–p16) can no longer be reached, and they would block their starter from beginning a new one.
UPDATE "construction_projects" SET "status" = 'expired'
WHERE "status" IN ('reserved', 'active') AND "plot_key" IN ('p11', 'p12', 'p13', 'p14', 'p15', 'p16');
