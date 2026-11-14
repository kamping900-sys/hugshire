/**
 * Trailer V2 edit decision list (2:16). Scenes follow script/timeline-v2.json, fitted to the V2 narration.
 *   at = timeline start, src = in-point in footage/<clip>.mp4 (the shot runs until the next one starts),
 *   fade = crossfade from the previous shot, look = colour treatment, cap = caption position over this shot
 *   ("high" when the game's bottom menu or map strip is on screen).
 */
const shots = [
  // problem statement (typography, no game footage)
  { clip: "v2_opening", at: 0.0, src: 0.0 },
  // homepage reveal
  { clip: "v2_home", at: 17.6, src: 0.0, fade: 0.5 },
  // deposit → yield → Heart Tree → cause
  { clip: "s3_onboard", at: 28.3, src: 6.4, fade: 0.4 },          // helper picker
  { clip: "s3_onboard", at: 29.9, src: 10.4 },                    // choose Fernhollow
  { clip: "s3_onboard", at: 31.3, src: 13.4 },                    // $100
  { clip: "s3_onboard", at: 32.5, src: 15.7 },                    // test checkout: the route
  { clip: "s3_onboard", at: 35.3, src: 22.9, fade: 0.3 },         // glow → evolve → ta-da
  { clip: "s3_tree", at: 37.9, src: 0.9, fade: 0.4 },             // the Heart Tree with fruit
  { clip: "s3_tree", at: 40.4, src: 2.7 },                        // pick fruit
  { clip: "s3_tree", at: 42.5, src: 5.6 },                        // send it to Fernhollow
  // world map
  { clip: "s4_map", at: 44.5, src: 0.9, fade: 0.5, cap: "high" }, // out to the map
  { clip: "s4_map", at: 46.4, src: 3.4, cap: "high" },            // slow drive past the towns
  { clip: "s4_map", at: 51.6, src: 11.95, cap: "high" },          // into Pawsbury
  // play, contribute, build together
  { clip: "s6_board", at: 55.0, src: 0.0, fade: 0.5, cap: "high" }, // the unfinished cottage
  { clip: "s5_build", at: 56.8, src: 1.0 },                       // its build panel: 99%
  { clip: "s5_build", at: 58.6, src: 7.7 },                       // a few real PERFECT chops
  { clip: "s5_build", at: 61.2, src: 19.6 },                      // Building complete!
  { clip: "s5_build", at: 63.0, src: 34.0, cap: "high" },         // the finished cottage in town
  { clip: "v2_life_wide", at: 66.4, src: 0.0, fade: 0.6, look: "glow" }, // the whole town, busy
  // optional ads → Community Heart Pool
  { clip: "s5_build", at: 71.3, src: 21.0, fade: 0.5 },           // results: Watch an ad
  { clip: "s5_build", at: 72.9, src: 23.1 },                      // Simulating ads… (about a second)
  { clip: "s5_build", at: 74.2, src: 25.7 },                      // where the ad money goes
  { clip: "v2_life_wide", at: 80.0, src: 2.0, fade: 0.4, look: "soft" }, // + equal-split overlay
  { clip: "s7_gift", at: 84.4, src: 5.4, fade: 0.4 },             // your golden share: pick a town
  { clip: "v2_tree", at: 88.6, src: 0.0, fade: 0.5, look: "glow" },
  // Notice Board: the payoff
  { clip: "v2_life", at: 90.3, src: 0.0, fade: 0.6, look: "glow" }, // the lively town
  { clip: "v2_board", at: 93.6, src: 2.4, cap: "high" },          // walk to the board
  { clip: "v2_board", at: 96.5, src: 5.3 },                       // the organisation's posts and photos
  { clip: "v2_board", at: 104.0, src: 13.0, cap: "high" },        // back out to the town
  // withdrawal
  { clip: "s8_withdraw", at: 106.6, src: 1.5, fade: 0.5 },
  { clip: "s8_withdraw", at: 108.4, src: 4.6 },
  { clip: "s8_withdraw", at: 112.1, src: 10.4 },
  // accessible + the intended architecture
  { clip: "s3_onboard", at: 114.5, src: 6.3, fade: 0.4 },
  { clip: "s9_how", at: 116.6, src: 6.9, fade: 0.4, look: "soft" },
  // finale
  { clip: "v2_tree", at: 122.6, src: 0.3, fade: 0.7, look: "glow" },
  { clip: "s10_after_wide", at: 125.6, src: 0.0, fade: 0.8, look: "glow" },
];

const overlays = [
  { name: "flowDeposit2", type: "mov", at: 35.4 },
  { name: "poolSplit", type: "mov", at: 80.0 },
  { name: "flowTech", type: "mov", at: 116.7, y: -300 },
  { name: "endcard", type: "mov", at: 127.8, hold: true },
  { name: "badge", type: "png", at: 30.8, to: 44.4 },
  { name: "badge", type: "png", at: 71.3, to: 90.2 },
  { name: "badgeSample", type: "png", at: 96.6, to: 104.0 },
  { name: "badge", type: "png", at: 106.6, to: 114.4 },
  { name: "badge", type: "png", at: 116.6, to: 122.4 },
];

module.exports = { shots, overlays, duration: 136.1, timeline: "timeline-v2.json" };
