/**
 * Edit decision list for the trailer. Times in seconds.
 *   at   = where the shot starts on the trailer timeline
 *   src  = [in, out] in the footage clip (footage/<clip>.mp4)
 *   fade = crossfade-in length from the previous shot (0 = hard cut)
 *   hold = extra seconds to hold the last frame (gentle freeze at the end of a take)
 *   look = colour treatment
 * Overlays reference build/overlays/<name>.mov|png.
 */
const shots = [
  // S1 — the problem: the quiet, nearly empty village (wide, HUD hidden), warming at the end
  { scene: "s1", clip: "s1_before_wide", at: 0.0, src: [0.0, 24.5], fade: 0, look: "quiet" },

  // S2 — welcome: Maple trots to the Heart Tree, its ring lights up; the real title animation
  { scene: "s2", clip: "s2_walk_to_tree", at: 24.5, src: [0.0, 7.5], fade: 0.9 },
  { scene: "s2", clip: "s2_landing_logo", at: 31.6, src: [0.25, 6.0], fade: 0.8, hold: 1.2 },

  // S3 — plant a deposit, grow kindness (real onboarding with a fresh test account, then Maple's tree)
  { scene: "s3", clip: "s3_onboard", at: 38.5, src: [6.6, 8.8], fade: 0.35 },
  { scene: "s3", clip: "s3_onboard", at: 40.7, src: [10.2, 11.7], fade: 0 },
  { scene: "s3", clip: "s3_onboard", at: 42.2, src: [13.1, 14.8], fade: 0 },
  { scene: "s3", clip: "s3_onboard", at: 43.9, src: [15.6, 19.3], fade: 0 },
  { scene: "s3", clip: "s3_onboard", at: 47.6, src: [21.6, 26.4], fade: 0.4 },
  { scene: "s3", clip: "s3_onboard", at: 52.4, src: [31.0, 33.6], fade: 0.5 },
  { scene: "s3", clip: "s3_tree", at: 55.0, src: [0.9, 3.2], fade: 0.5 },
  { scene: "s3", clip: "s3_tree", at: 57.3, src: [3.2, 7.4], fade: 0 },
  { scene: "s3", clip: "s3_tree", at: 61.5, src: [8.4, 11.7], fade: 0 },

  // S4 — explore: out to the world map, slow drive past Inkwell Hollow, into Pawsbury
  { scene: "s4", clip: "s4_map", at: 64.5, src: [0.6, 3.4], fade: 0.7 },
  { scene: "s4", clip: "s4_map", at: 67.3, src: [3.4, 11.9], fade: 0 },
  { scene: "s4", clip: "s4_map", at: 75.8, src: [11.9, 15.6], fade: 0 },

  // S5 — play and build: the cottage at 99%, the guide, real PERFECT chops, ON FIRE, complete
  { scene: "s5", clip: "s5_build", at: 79.5, src: [0.0, 3.5], fade: 0.7 },
  { scene: "s5", clip: "s5_build", at: 83.0, src: [3.7, 5.6], fade: 0 },
  { scene: "s5", clip: "s5_build", at: 84.9, src: [6.12, 13.0], fade: 0 },
  { scene: "s5", clip: "s5_build", at: 91.78, src: [16.3, 19.45], fade: 0 },
  { scene: "s5", clip: "s5_build", at: 94.93, src: [19.6, 21.3], fade: 0 },
  { scene: "s5", clip: "s5_build", at: 96.63, src: [33.9, 38.5], fade: 0.4 },
  { scene: "s5", clip: "s4_map", at: 101.23, src: [15.6, 18.0], fade: 0.4 },

  // S6 — real stories: walk to the Notice Board and read the organisation's posts
  { scene: "s6", clip: "s6_board", at: 103.5, src: [1.6, 5.1], fade: 0.8 },
  { scene: "s6", clip: "s6_board", at: 107.0, src: [5.1, 15.7], fade: 0, hold: 1.9 },

  // S7 — Community Heart Pool: results → optional simulated ad → where the ad money goes → golden fruit
  { scene: "s7", clip: "s5_build", at: 119.5, src: [19.6, 23.0], fade: 0.8 },
  { scene: "s7", clip: "s5_build", at: 122.9, src: [23.0, 26.3], fade: 0 },
  { scene: "s7", clip: "s5_build", at: 126.2, src: [26.3, 32.0], fade: 0.3 },
  { scene: "s7", clip: "s7_gift", at: 131.9, src: [1.6, 11.2], fade: 0.5 },

  // S8 — your money, your choice: deposit tab → withdraw options → "on its way, 1–3 business days"
  { scene: "s8", clip: "s8_withdraw", at: 141.5, src: [0.3, 15.8], fade: 0.7 },

  // S9 — simple experience, transparent technology: a short montage, then the intended route over a soft-focus shot
  { scene: "s9", clip: "s3_onboard", at: 157.0, src: [3.3, 5.0], fade: 0.6 },
  { scene: "s9", clip: "s3_onboard", at: 158.7, src: [6.3, 8.2], fade: 0 },
  { scene: "s9", clip: "s9_how", at: 160.6, src: [6.9, 11.9], fade: 0.4, look: "soft" },
  { scene: "s9", clip: "s9_how", at: 165.6, src: [12.9, 16.9], fade: 0.4, look: "soft" },

  // S10 — the same village, now thriving; the camera eases back and the logo arrives
  { scene: "s10", clip: "s10_after_wide", at: 169.5, src: [0.0, 10.5], fade: 0.9, look: "glow" },
];

const overlays = [
  { name: "stat41", type: "mov", at: 6.8 },
  { name: "stat48", type: "mov", at: 13.0 },
  { name: "flowDeposit", type: "mov", at: 47.4 },
  { name: "flowPool", type: "mov", at: 124.0 },
  { name: "flowTech", type: "mov", at: 160.5, y: -300 },
  { name: "endcard", type: "mov", at: 173.4, hold: true },
  // the disclosure, wherever a money flow is on screen
  { name: "badge", type: "png", at: 43.9, to: 64.4 },
  { name: "badge", type: "png", at: 119.5, to: 157.0 },
  { name: "badge", type: "png", at: 157.0, to: 169.4 },
];

module.exports = { shots, overlays, duration: 180 };
