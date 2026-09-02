// assets/hub-sprites-canvas — each hub sprite is 40 x 40.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Arm hubs row states `40 x 40`,
// drawn "centered on the part's anchor hex and turned to its first spoke". Scale
// says why the canvas is fixed: "Every sprite is authored at the canvas its table
// row states and drawn at that size in logical units, centered on the thing it
// depicts, so nothing is scaled at draw time." A hub authored at another size
// covers the wrong share of the hex its part is anchored on.
//
// WHAT IT READS. The decoded pixel dimensions of both files, against
// `HUB_SPRITE_SIZE`, which is the figure `specs/assets.md` fixes.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be
// read is not a canvas of `40 x 40`.
//
// THE EVIDENCE is the two produced files over a checkerboard, at the canvas their
// row states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { HUB_SPRITE_SIZE } from "../constants";
import { HUB_SPRITES } from "./files";
import { decodeProduced, showSprites } from "./sprites";

it("decodes both arm hubs at 40 x 40", async () => {
  await showSprites("canvases", HUB_SPRITES);

  assertLength(
    HUB_SPRITES,
    2,
    "the arm hub and the piston hub, so the reading below is two files rather than none",
  );
  const readings = await decodeProduced(HUB_SPRITES);
  for (const [index, row] of HUB_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      read.sprite.width,
      HUB_SPRITE_SIZE,
      `${row.label}: the width of the canvas it was produced on`,
    );
    assertEqual(
      read.sprite.height,
      HUB_SPRITE_SIZE,
      `${row.label}: the height of the canvas it was produced on`,
    );
  }
});
