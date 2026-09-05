// assets/lamplighter-walk-produced — the lamplighter's walk sheet ships six
// separate frame files, each on its stated canvas, each carrying paint.
//
// WHAT THIS DECIDES. Six files: `assets/sprites/lamplighter/walk/0.png`
// through `5.png` are committed, decode, sit on exactly `24 x 32`, and each
// carries non-transparent paint.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the table
// puts "Lamplighter, walk" at "`assets/sprites/lamplighter/walk/0.png` to
// `5.png`", produced with `draw-sheet`, `6` frames, on `24 x 32`, and the
// paragraph above it states how a sheet lands — "A sheet's frames are
// separate PNG files, numbered from `0`, each on a canvas of the sheet's
// size." `LAMPLIGHTER_WALK_SHEET` in `src/constants.ts` carries that
// directory and that frame count.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the six differ from one another is
// `assets/lamplighter-walk-frames-distinct`; that the game plays them at
// `WALK_FRAME_TIME` while the lamplighter moves belongs to the lamplighter's
// own presentation points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven: the committed bytes are read off disk and
// decoded by the canvas this project already runs the engine on. A harness is
// opened only to own the canvas the evidence picture is painted on, and the
// picture is the six files themselves, magnified.
//
// THE TOLERANCE. The canvas is exact, because the specification states it
// exactly. The paint reading is presence: at least one pixel not clear.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  LAMPLIGHTER_WALK,
  readSprites,
  showSprites,
} from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits six painted 24 x 32 walk frames as separate files", async () => {
  const reads = await readSprites(LAMPLIGHTER_WALK);
  await showSprites(h, LAMPLIGHTER_WALK);
  captureStill(h, "walk");

  assertProduced(reads);
});
