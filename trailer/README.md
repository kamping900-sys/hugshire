# Hugshire trailer (video production)

This folder produces the Hugshire trailer from real app footage. It is separate from the app: it has its own `package.json`, and nothing in `src/` was changed for it.

**Output (`out/`)**
- `hugshire-trailer.mp4`
- `hugshire-trailer-subtitled.mp4`
- `hugshire-trailer.srt`
- `hugshire-trailer-notes.md`: scene timings, sources, rights, and what is simulated.

## Pipeline

1. **Filming server.** From the repo root: `npm run build`, then copy `.data/hugshire` to `.data/trailer`. Start it with the "trailer" preview config (`node trailer/scripts/serve.cjs`, port 3300, test mode, its own database).
2. **Stage the story** (filming database only, server stopped): `node scripts/stage-db.cjs before | nearly | after`.
3. **Footage.** Frame-stepped Chromium capture to `footage/*.mp4`, plus step marks in `footage/*.json`:
   - `capture/s1s2.cjs [s1|s2|logo|s10]`
   - `capture/s3_onboard.cjs`
   - `capture/town_shots.cjs s2walk s3tree s4map s6board s7gift s8withdraw`
   - `capture/s5_build.cjs` (needs the `nearly` stage)
   - `capture/s9_how.cjs`
4. **Overlays.** `node capture/overlays.cjs` builds the statistics, flow strips, demo badge and end card from `overlays/overlay.html` (Manrope, brand colours).
5. **Voice.** `node scripts/gen-voice.cjs` voices each line with Kokoro `af_heart` (local, Apache-2.0). Then `node scripts/layout-voice.cjs` places the lines on the timeline (`script/narration.json`, `script/timeline.json`).
6. **Music.** `node scripts/music.cjs` writes the original score to `build/music.wav`.
7. **Mix.** `node scripts/mix.cjs` combines voice, ducked music and synthesised effects, placed from `script/edl.cjs` and the capture marks.
8. **Render.** `node scripts/render.cjs --subs`. Use `--preview` for a quick 540p check.

**Dependencies:** `ffmpeg-static` and `kokoro-js` (this folder), plus Playwright and sharp from the app's own `node_modules`.
