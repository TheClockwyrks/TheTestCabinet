// assets/lamplighter-walk-frames-distinct — the walk sheet is six poses of a
// stride rather than one frame shipped six times.
//
// WHAT THIS DECIDES. That no two of the six committed walk frames are the
// same picture.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The tools"): `draw-sheet`
// produces "everything that moves on its own: the walk cycles, the death
// puff, and the animated effects", and ("Animation") the lamplighter's cycle
// "advances one frame per `WALK_FRAME_TIME` seconds of movement and wraps".
// A cycle that advances through six identical pictures moves nothing, so the
// six being six different pictures is what the sheet's own description
// requires. Whether they read as one continuous stride is the art bar and the
// presentation domain's aesthetic rating, which is a person's to make.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the six frames side by
// side.
//
// THE TOLERANCE. `PIXEL_CHANNEL_EPS`, eight levels of 255 per channel. A PNG
// carries its pixels losslessly, so a file shipped twice differs by exactly
// nothing and fails here; eight levels sits far below any difference a player
// could see, so a build that re-encoded a frame through another colour
// profile is still the same picture. That each of the six exists, is
// `24 x 32`, and carries paint is `assets/lamplighter-walk-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNoTwoIdentical,
  LAMPLIGHTER_WALK,
  readSprites,
  requireImages,
  showSprites,
} from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws each of the six walk frames differently from the rest", async () => {
  const reads = await readSprites(LAMPLIGHTER_WALK);
  await showSprites(h, LAMPLIGHTER_WALK);
  captureStill(h, "distinct");

  const frames = requireImages(reads);
  assertNoTwoIdentical(
    frames,
    LAMPLIGHTER_WALK.map((sprite) => sprite.path),
  );
});
