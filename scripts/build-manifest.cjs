/**
 * Writes public/game/sprites/manifest.json: which engine sprite key uses which PNG, and how wide it is
 * in world pixels (1 cell = 32 px). Only files that exist are listed, so missing art falls back to the
 * code-drawn placeholder. Re-run after adding or regenerating art:  node scripts/build-manifest.cjs
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "public", "game", "sprites");

// key → [file, worldWidth, anchorY?]
const MAP = {
  // buildings (footprint widths from gen.ts)
  "prop:townHall": ["buildings/townHall.png", 290],
  "prop:barn": ["buildings/barn.png", 210],
  "prop:greenhouse": ["buildings/greenhouse.png", 205],
  "prop:windmill": ["buildings/windmill.png", 160],
  "prop:clinic": ["buildings/clinic.png", 205],
  "prop:school": ["buildings/school.png", 250],
  "prop:bookshop": ["buildings/bookshop.png", 150],
  "prop:studio": ["buildings/studio.png", 205],
  "prop:tent": ["buildings/tent.png", 205],
  "prop:lighthouse": ["buildings/lighthouse.png", 120],
  "prop:gazebo": ["buildings/gazebo.png", 150],
  "prop:cottage": ["buildings/cottage.png", 175],
  "prop:house:0": ["houses/house0.png", 108],
  "prop:house:1": ["houses/house1.png", 108],
  "prop:house:2": ["houses/house2.png", 108],
  "prop:house:3": ["houses/house3.png", 108],
  "prop:kennel": ["houses/kennel.png", 62],
  "prop:ruin": ["houses/ruin.png", 150],
  // nature & props
  "prop:tree:0": ["props/tree.png", 78],
  "prop:tree:1": ["props/tree.png", 70],
  "prop:tree:2": ["props/tree.png", 84],
  "prop:tree:3": ["props/autumn.png", 78],
  "prop:pine": ["props/pine.png", 60],
  "prop:blossom": ["props/blossom.png", 80],
  "prop:bush:0": ["props/bush.png", 46],
  "prop:bush:1": ["props/bushFlower.png", 50],
  "prop:bush:2": ["props/bush.png", 40],
  "prop:bush:3": ["props/bushFlower.png", 46],
  "prop:rockBig": ["props/rockBig.png", 72],
  "prop:rock": ["props/rock.png", 44],
  "prop:stump": ["props/stump.png", 44],
  "prop:flowers": ["props/flowers.png", 40],
  "prop:mushroom": ["props/mushroom.png", 30],
  "prop:reeds": ["props/reeds.png", 38],
  "prop:fountain": ["props/fountain.png", 150],
  "prop:lamp": ["props/lamp.png", 22],
  "prop:bench": ["props/bench.png", 62],
  "prop:fenceH": ["props/fence.png", 40],
  "prop:fenceV": ["props/fence.png", 36],
  "prop:hay": ["props/hay.png", 48],
  "prop:scarecrow": ["props/scarecrow.png", 46],
  "prop:easel": ["props/easel.png", 42],
  "prop:boxes": ["props/boxes.png", 44],
  "prop:well": ["props/well.png", 60],
  "prop:stall": ["props/stall.png", 78],
  "prop:signNew": ["props/signpost.png", 54],
  "prop:signCause": ["props/signpost.png", 50],
  "prop:foundation": ["props/foundation.png", 160],
  // seamless ground textures (tiled by the engine)
  "ground:grass": ["ground/grass.png", 0],
  "ground:path": ["ground/path.png", 0],
  "ground:plaza": ["ground/plaza.png", 0],
  "ground:water": ["ground/water.png", 0],
  "ground:asphalt": ["ground/asphalt.png", 0],
  "ground:sidewalk": ["ground/sidewalk.png", 0],
  "ground:soil": ["ground/soil.png", 0],
  // vehicles & animals
  "vehicle:truck": ["extras/truck.png", 104],
  "animal:sheep": ["extras/sheep.png", 38],
};
// helpers: standing pose + 4-frame walk cycle per direction, all scaled to the same height
const HEIGHTS = {};
for (const m of ["cat", "dog", "rabbit", "otter", "panda", "fox", "raccoon", "bird"])
  for (const pose of ["front", "side", "back"]) {
    MAP[`mascot:${m}:${pose}`] = [`mascots/${m}_${pose}.png`, 0];
    HEIGHTS[`mascot:${m}:${pose}`] = 60;
    for (let i = 0; i < 4; i++) {
      MAP[`mascot:${m}:${pose}:${i}`] = [`mascots/walk/${m}_${pose}_${i}.png`, 0];
      HEIGHTS[`mascot:${m}:${pose}:${i}`] = 60;
    }
  }

const out = {};
for (const [k, [file, width, ay]] of Object.entries(MAP)) {
  if (!fs.existsSync(path.join(root, file))) continue;
  out[k] = HEIGHTS[k] ? { file, height: HEIGHTS[k], ax: 0.5, ay: ay ?? 0.97 } : { file, width, ax: 0.5, ay: ay ?? 0.95 };
}
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`manifest: ${Object.keys(out).length} sprites (${Object.keys(MAP).length - Object.keys(out).length} still using placeholders)`);
