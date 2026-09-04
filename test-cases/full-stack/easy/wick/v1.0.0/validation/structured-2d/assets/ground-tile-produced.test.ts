// assets/ground-tile-produced — the ground tile is a committed sprite on its
// stated square, carrying paint.
//
// WHAT THIS DECIDES. One file: `assets/sprites/ground.png` is committed,
// decodes, sits on exactly `64 x 64`, and carries non-transparent paint.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): the row
// "Ground tile" puts it at "`assets/sprites/ground.png`", produced with
// `draw`, `1` frame, on `64 x 64`, and the paragraph above it fixes the
// canvas exactly. `GROUND_TILE_PATH` and `GROUND_TILE_SIZE` in
// `src/constants.ts` are that path and that square.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the tile "sits flush against
// itself on all four sides" is a property of the picture a person judges, and
// the presentation domain rates it; that the game repeats the tile in world
// space, so the ground scrolls under the lamplighter rather than with the
// camera, is the lamplighter's own ground point.
//
// WHY NO WORLD IS POSED. This point is about a FILE rather than about a
// frame, so the game is never driven. A harness is opened only to own the
// canvas the evidence picture is painted on.
//
// THE TOLERANCE. The canvas is exact, because the specification states it
// exactly. The paint floor is `PAINT_MIN_SHARE`, one pixel in a thousand;
// a tile of ground is opaque across its whole face, so a conformant file
// clears the floor a thousandfold.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  GROUND_TILE,
  readSprites,
  showSprites,
} from "./produced";

const FILES = [GROUND_TILE];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits the ground tile as a painted 64 x 64 sprite", async () => {
  const reads = await readSprites(FILES);
  await showSprites(h, FILES);
  captureStill(h, "ground");

  assertProduced(reads);
});
