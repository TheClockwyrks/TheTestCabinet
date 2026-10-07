// assets/common-enemy-frames-distinct — each common enemy's sheet is four
// poses of a cycle rather than one frame shipped four times.
//
// WHAT THIS DECIDES. For each of the ten common sheets, that no two of its
// four frames are the same picture. Each sheet is read on its own, so a
// failure names the enemy whose cycle stands still.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The tools"): `draw-sheet`
// produces "everything that moves on its own: the walk cycles, the death
// puff, and the animated effects", and ("Animation") "An enemy draws frame
// `floor(age / WALK_FRAME_TIME) mod 4` of its sheet for as long as it lives."
// A cycle stepped through four identical pictures moves nothing, so four
// different pictures is what the cycle's own description requires. Whether
// the four read as one convincing movement is the art bar and the
// presentation domain's aesthetic rating.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on.
//
// THE TOLERANCE. `PIXEL_CHANNEL_EPS`, eight levels of 255 per channel: a PNG
// carries its pixels losslessly, so a frame shipped twice differs by exactly
// nothing, and eight levels sits far below any difference a player could see.
// That each frame exists at its square and carries paint is
// `assets/common-enemy-sheets-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertNoTwoIdentical,
  COMMON_ENEMY_SHEETS,
  readSprites,
  requireImages,
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

it("draws each common enemy's four frames differently from one another", async () => {
  await showSprites(h, FILES);
  captureStill(h, "distinct");

  for (const sheet of COMMON_ENEMY_SHEETS) {
    const frames = requireImages(await readSprites(sheet.frames));
    assertNoTwoIdentical(
      frames,
      sheet.frames.map((sprite) => sprite.path),
    );
  }
});
