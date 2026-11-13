INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'Two kennels are warm tonight 🐾', 'Thanks to your fruit deliveries, the first insulated kennel panels went in on Saturday. Biscuit, our 12-year-old beagle, slept stretched out for the first time this autumn. Four more kennels to go before the frost.', 'note', 'progress', '/game/sprites/stages/cottage_4.png', 'published', now() - interval '2 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'pawsbury' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'Two kennels are warm tonight 🐾');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'Meet Juniper', 'Juniper arrived in September, too shy to leave her bed. Six weeks of patient volunteers later, she greets everyone at the door. She''s ready for a quiet home with a sunny windowsill.', 'note', 'story', '/game/sprites/mascots/cat_front.png', 'published', now() - interval '9 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'pawsbury' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'Meet Juniper');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'Cold snap plan is ready', 'Our volunteers mapped every draught in the building. Heat lamps go to the puppy room and the senior dogs first. Thank you to everyone who has sent fruit to Pawsbury!', 'note', 'news', '/game/sprites/stages/cottage_2.png', 'published', now() - interval '17 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'pawsbury' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'Cold snap plan is ready');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'Reading corner #14 is open 📚', 'Ms Okafor''s Year 2 class picked dinosaurs and space for their first box of books. 28 children now have a cosy corner to read in every day.', 'note', 'impact', '/game/sprites/stages/bookshop_4.png', 'published', now() - interval '3 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'inkwell-hollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'Reading corner #14 is open 📚');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'Reading buddies are back', 'Our volunteers are reading one-to-one again on Tuesday and Thursday mornings. Last term, children in the programme gained a whole reading level.', 'note', 'news', '/game/sprites/mascots/rabbit_front.png', 'published', now() - interval '11 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'inkwell-hollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'Reading buddies are back');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'New shelves for three schools', 'Low shelves and book boxes arrived for three more classrooms. They''re low enough for the youngest readers to choose their own books.', 'note', 'progress', '/game/sprites/stages/bookshop_2.png', 'published', now() - interval '20 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'inkwell-hollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'New shelves for three schools');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'Bed 18 is planted 🌱', 'Garlic and winter onions went in this weekend, well above the spring flood line. Twelve children helped plant the first row.', 'note', 'progress', '/game/sprites/stages/barn_3.png', 'published', now() - interval '2 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'fernhollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'Bed 18 is planted 🌱');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'The new tool shed is up', 'The shed now stands on its new concrete base. Every family plot can borrow tools again, seven days a week.', 'note', 'news', '/game/sprites/stages/barn_4.png', 'published', now() - interval '12 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'fernhollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'The new tool shed is up');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", '400 packets of seeds swapped', 'Families swapped seeds saved from the plots that survived the flood. Next spring''s garden will grow from this one.', 'note', 'story', '/game/sprites/howto/heart_pool.png', 'published', now() - interval '26 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'fernhollow' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = '400 packets of seeds swapped');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", '210 weekend kits packed 🍲', 'Volunteers packed 210 weekend meal kits on Thursday night in under two hours. This week''s kits include our lentil and carrot soup, the children''s favourite.', 'note', 'impact', '/game/sprites/stages/house_4.png', 'published', now() - interval '1 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'ladle-lane' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = '210 weekend kits packed 🍲');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'A sixth school joins', 'Brookside Primary now sends 28 children home with a kit every Friday. That''s six partner schools and more than 200 kits a week.', 'note', 'news', '/game/sprites/stages/school_4.png', 'published', now() - interval '10 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'ladle-lane' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'A sixth school joins');
--> statement-breakpoint
INSERT INTO "cause_updates" ("cause_id", "title", "body", "kind", "category", "media_url", "visibility", "created_at")
SELECT c."id", 'Thank you, Thursday team', 'Our Thursday packing team has packed every single week since 2012. Come and join us, 6–8pm, aprons provided!', 'note', 'story', '/game/sprites/mascots/dog_front.png', 'published', now() - interval '22 days'
FROM "causes" c JOIN "organizations" o ON o."id" = c."org_id"
WHERE c."slug" = 'ladle-lane' AND o."is_sample" = true
AND NOT EXISTS (SELECT 1 FROM "cause_updates" u WHERE u."cause_id" = c."id" AND u."title" = 'Thank you, Thursday team');
