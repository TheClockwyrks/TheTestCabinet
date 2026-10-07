// assets/mote-sprites-canvas — every mote sprite is 44 x 44.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Motes row states `44 x 44`.
// Scale says why the canvas is fixed rather than merely suggested: "Every sprite
// is authored at the canvas its table row states and drawn at that size in
// logical units, centered on the thing it depicts, so nothing is scaled at draw
// time." A sprite authored at another size is either scaled at draw time or drawn
// at the wrong size on the field.
//
// WHAT IT READS. The decoded pixel dimensions of each of the fifteen files, which
// is the canvas the file was produced on. `MOTE_SPRITE_SIZE` is the figure
// `specs/assets.md` fixes, so the pair a reviewer reads is the case's `44` beside
// the build's.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be
// read is not a canvas of `44 x 44`.
//
// THE EVIDENCE is the produced files over a checkerboard, at the canvas their row
// states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { MOTES, MOTE_SPRITE_SIZE } from "../constants";
import { MOTE_SPRITES } from "./files";
import { decodeProduced, showSprites } from "./sprites";

it("decodes each of the fifteen mote sprites at 44 x 44", async () => {
  await showSprites("canvases", MOTE_SPRITES);

  assertLength(
    MOTE_SPRITES,
    MOTES.length,
    "one path per name in MOTES, so the reading below is fifteen files rather than none",
  );
  const readings = await decodeProduced(MOTE_SPRITES);
  for (const [index, row] of MOTE_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      read.sprite.width,
      MOTE_SPRITE_SIZE,
      `${row.label}: the width of the canvas it was produced on`,
    );
    assertEqual(
      read.sprite.height,
      MOTE_SPRITE_SIZE,
      `${row.label}: the height of the canvas it was produced on`,
    );
  }
});
