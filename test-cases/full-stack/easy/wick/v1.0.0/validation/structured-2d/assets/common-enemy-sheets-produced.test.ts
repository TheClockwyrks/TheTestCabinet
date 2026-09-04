// assets/common-enemy-sheets-produced — every common enemy ships a
// four-frame walk cycle on the square its radius fixes, each frame painted.
//
// WHAT THIS DECIDES. Forty files: for each of the ten common ids,
// `assets/sprites/enemies/<id>/0.png` through `3.png` are committed, decode,
// sit on exactly the square the id's row states, and each carries
// non-transparent paint.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the row
// "Each common enemy, a walk cycle" puts them at
// "`assets/sprites/enemies/<id>/0.png` to `3.png`, for each of the ten common
// ids in `ENEMY_IDS`", produced with `draw-sheet`, `4` frames, on a canvas of
// "twice its radius in `ENEMIES`, square: `20` for `moth`, `20` for `bat`,
// `24` for `rat`, `16` for `gnat`, `28` for `beetle`, `20` for `wisp`, `28`
// for `spider`, `24` for `crow`, `32` for `shade`, `36` for `hound`". The
// paragraph above fixes the canvas as exact, and the frames as separate PNG
// files numbered from `0`. `ENEMY_SHEET_DIR`, `ENEMY_FRAMES` and the radii in
// `ENEMIES` are those same figures in `src/constants.ts`.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each sheet's four frames differ is
// `assets/common-enemy-frames-distinct`; that the ten differ from each other
// and from the elites is `assets/enemy-sheets-distinct`; the three big
// enemies have sheets and points of their own; and that the game draws an
// enemy from its sheet belongs to the enemies' presentation points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the forty files
// themselves.
//
// THE TOLERANCE. Each canvas is exact, because the specification states it
// exactly. The paint floor is `PAINT_MIN_SHARE`, one pixel in a thousand.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  COMMON_ENEMY_SHEETS,
  readSprites,
  showSprites,
} from "./produced";

const FILES = COMMON_ENEMY_SHEETS.flatMap((sheet) => sheet.frames);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits four painted frames for each of the ten common enemies", async () => {
  const reads = await readSprites(FILES);
  await showSprites(h, FILES);
  captureStill(h, "sheets");

  assertProduced(reads);
});
