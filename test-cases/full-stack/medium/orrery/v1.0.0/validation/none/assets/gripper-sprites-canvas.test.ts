// assets/gripper-sprites-canvas — each gripper sprite is 32 x 32.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Grippers row states `32 x 32`,
// drawn "centered on each gripper's live position and turned to that spoke's live
// angle". Scale says why the canvas is fixed: "Every sprite is authored at the
// canvas its table row states and drawn at that size in logical units, centered on
// the thing it depicts, so nothing is scaled at draw time." A gripper authored at
// another size covers the wrong share of the hex its spoke reaches, and there is
// no draw-time scale to bring it back.
//
// WHAT IT READS. The decoded pixel dimensions of both files, against
// `GRIPPER_SPRITE_SIZE`, which is the figure `specs/assets.md` fixes.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be
// read is not a canvas of `32 x 32`.
//
// THE EVIDENCE is the two produced files over a checkerboard, at the canvas their
// row states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIPPER_SPRITE_SIZE } from "../constants";
import { GRIPPER_SPRITES } from "./files";
import { decodeProduced, showSprites } from "./sprites";

it("decodes both grippers at 32 x 32", async () => {
  await showSprites("canvases", GRIPPER_SPRITES);

  assertLength(
    GRIPPER_SPRITES,
    2,
    "the open gripper and the closed one, so the reading below is two files rather than none",
  );
  const readings = await decodeProduced(GRIPPER_SPRITES);
  for (const [index, row] of GRIPPER_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      read.sprite.width,
      GRIPPER_SPRITE_SIZE,
      `${row.label}: the width of the canvas it was produced on`,
    );
    assertEqual(
      read.sprite.height,
      GRIPPER_SPRITE_SIZE,
      `${row.label}: the height of the canvas it was produced on`,
    );
  }
});
