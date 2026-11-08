# World engine (`/worldmap`)

A full-screen, grid-based world that can hold thousands of causes. Code is in `src/game/world/`.
The HUD is in `src/components/worldmap/`.

> The world map currently runs on **demo data** (`demo.ts`): 64 fictional causes and browser-simulated
> balances. It is labelled as demo in the UI. The engine takes the real `WorldCause[]` shape
> unchanged.

## How the world is built

- **Grid of tiles.** Each tile is 20×20 cells of 32 px (640 px). Every cause owns exactly one tile.
  Roads run along the tile edges, so towns always connect.
- **Deterministic.** `generateTile(world, tx, ty)` produces the ground, roads, buildings and props
  from the coordinates and the cause (category, stage). Nothing about the world is stored or
  downloaded. Only the list of causes and their tile coordinates is needed.
- **Grows without limit.**
  - New causes take the next slot on a spiral around the Town Square (`causeSlots`).
  - Empty plots next to towns show "+ New cause".
  - Beyond the towns, wilderness (forest, meadow, lake, grove, hills) continues forever.
- **Stages are real.** A cause's tile shows ruins, then foundations, then buildings as its *real
  delivered yield* grows (stage 0–5). Gameplay cannot change this.

## Why it stays fast

| Technique | Effect |
|---|---|
| Stream only tiles near the camera; free the rest | GPU memory is flat no matter how big the world is |
| Bake each tile's ground (with decals) into **one texture** | 1 draw per tile for the floor |
| Tall props are pooled sprites in one y-sorted layer | trees and buildings sort correctly with walkers, with no allocations |
| Time-sliced building: 1 tile per frame, nearest first | no frame spikes while exploring (a full bake is about 11 ms) |
| Two levels of detail: zoomed out shows one tiny baked thumbnail per tile, with no characters or props | the whole map costs about 40–150 sprites |
| Characters exist only for active tiles, plus a global draw cap with your own helpers first | thousands of supporters stay in data; about 100 are animated |
| Bounded A* with a per-frame path budget | walking across the world plans in about 5 ms; a truck route between towns in about 2 ms |
| LRU caches for generated tiles, ground textures and thumbnails | bounded memory |
| Ticker stops when the tab is hidden; adaptive DPR and draw cap on weak devices | battery friendly |
| The HUD receives state at 4 Hz, not every frame | React never re-renders per frame |

Measured on 2026-11-08 (CPU logic only):

- **Close-up view:** 0.67 ms per frame with 20 tiles, 618 sprites and 121 characters.
- **Map view:** 0.15 ms per frame, 42 tiles.
- **One tile:** 0.65 ms to generate.

## Moving support between causes

In Hugshire, a supporter's money sits in **one pooled Vault position** on RHEA. "Supporting a cause"
means choosing where that position's *yield* goes. So moving support from Care Hill to Hope Fields:

- is **instant and free**: no withdrawal, no bridge, no on-chain transaction;
- is a ledger and preferences change on the server (which cause the helper calls home, and where auto
  mode delivers);
- yield already earned stays with whoever it was delivered to. Only future deliveries change.

The truck that drives between the two towns is a visual of that change. In the real app the order
is: `POST /api/preferences` (or a dedicated "move support" endpoint), the helper's `cause_id` is
updated, and then the animation plays.

## Serving many real causes (next step)

1. When admin approves a cause, assign it the next free slot: `tile_x`, `tile_y` columns on `cities`,
   filled from `causeSlots`.
2. Add `GET /api/world/causes?x0&y0&x1&y1`, a bounding-box query on `(tile_x, tile_y)` with an index.
   The client asks only for causes in and around the view, so 10,000 causes never load at once.
3. The minimap uses a coarse per-region summary instead of every tile.

## Art

Sprites come from `public/game/sprites/manifest.json`, built by `node scripts/build-manifest.cjs`. The
engine draws a code placeholder for any key without a file, so the art can be replaced piece by piece.

Current art was generated with ChatGPT on 2026-11-08. The original sheets are in `art/sheets/` and
were cut with:

```bash
node scripts/slice-sheet.cjs <sheet.png> <outDir> name1,name2,…
```

Ground textures were made tileable with `scripts/make-seamless.cjs`.
