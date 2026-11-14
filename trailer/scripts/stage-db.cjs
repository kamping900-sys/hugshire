/**
 * Stages Fernhollow's buildings in the FILMING database only (.data/trailer, test mode) for the
 * before/after story. Run while the filming server is stopped (PGlite allows one process).
 *   node scripts/stage-db.cjs before   one cottage at its foundation, nothing else built
 *   node scripts/stage-db.cjs nearly   that cottage a few chops from done
 *   node scripts/stage-db.cjs after    every plot finished
 *   node scripts/stage-db.cjs show     print Fernhollow's projects
 */
const path = require("path");
const APP = path.join(__dirname, "..", "..");
const mode = process.argv[2] || "show";
const COTTAGE_PLOT = process.env.COTTAGE_PLOT || "p10";
const M = 1_000_000n;
const BP = { cottage: 30000n, house: 40000n, bookshop: 200000n, barn: 220000n, school: 1200000n, townHall: 5000000n };
const AFTER = { p1: "school", p2: "townHall", p3: "bookshop", p4: "barn", p5: "cottage", p6: "house", p7: "bookshop", p8: "house", p9: "barn", p10: "cottage" };

(async () => {
  const { PGlite } = require(path.join(APP, "node_modules", "@electric-sql", "pglite"));
  const db = new PGlite(path.join(APP, ".data", "trailer"));
  const q = (s, p) => db.query(s, p);
  const town = (await q(`select c.id from causes c join cities ci on ci.cause_id = c.id where ci.name = 'Fernhollow'`)).rows[0];
  if (!town) throw new Error("Fernhollow not found");
  const cid = town.id;
  // free every plot (history rows point at old projects, so they are retired rather than deleted)
  if (mode === "before" || mode === "after") await q(`update construction_projects set status = 'expired' where cause_id = $1 and status <> 'expired'`, [cid]);
  if (mode === "before") {
    const req = BP.cottage * M;
    await q(`insert into construction_projects (cause_id, environment, plot_key, blueprint_key, status, wood_required, stone_required, wood_contributed, stone_contributed) values ($1,'sandbox',$2,'cottage','active',$3,0,$4,0)`, [cid, COTTAGE_PLOT, req.toString(), ((req * 30n) / 100n).toString()]);
  }
  if (mode === "nearly") {
    const r = await q(`update construction_projects set wood_contributed = wood_required - $3, status = 'active', completed_at = null, last_activity_at = now() where cause_id = $1 and plot_key = $2 and status <> 'expired' returning id`, [cid, COTTAGE_PLOT, (180n * M).toString()]);
    if (!r.rows.length) throw new Error("no cottage on " + COTTAGE_PLOT + "; run 'before' first");
  }
  if (mode === "after") {
    for (const [plot, bp] of Object.entries(AFTER)) {
      const req = BP[bp] * M;
      await q(`insert into construction_projects (cause_id, environment, plot_key, blueprint_key, status, wood_required, stone_required, wood_contributed, stone_contributed, completed_at) values ($1,'sandbox',$2,$3,'completed',$4,0,$4,0, now())`, [cid, plot, bp, req.toString()]);
    }
  }
  const rows = (await q(`select plot_key, blueprint_key, status, (wood_contributed*100/nullif(wood_required,0))::int as pct from construction_projects where cause_id = $1 and status <> 'expired' order by plot_key`, [cid])).rows;
  console.log(mode, JSON.stringify(rows));
  await db.close();
})();
