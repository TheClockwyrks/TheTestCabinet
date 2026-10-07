// assets/filament-sprites-canvas — each filament strip is 48 x 16.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Filaments row states `48 x 16`.
// The section closes with why that width is what it is: "A filament joins motes on
// adjacent hexes and a constellation is rigid, so the strip spans exactly
// `HEX_PITCH` (`48`) at every moment and is drawn at native size." A strip
// authored at another width either falls short of the gap between two mote centers
// or overshoots it, because nothing scales it at draw time — Scale: "Every sprite
// is authored at the canvas its table row states and drawn at that size in logical
// units."
//
// WHAT IT READS. The decoded pixel dimensions of both files, against
// `FILAMENT_SPRITE_W` and `FILAMENT_SPRITE_H`, which are the figures
// `specs/assets.md` fixes.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be
// read is not a canvas of `48 x 16`.
//
// THE EVIDENCE is the two produced files over a checkerboard, at the canvas their
// row states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { FILAMENT_SPRITE_H, FILAMENT_SPRITE_W } from "../constants";
import { FILAMENT_SPRITES } from "./files";
import { decodeProduced, showSprites } from "./sprites";

it("decodes both filament strips at 48 x 16", async () => {
  await showSprites("canvases", FILAMENT_SPRITES);

  assertLength(
    FILAMENT_SPRITES,
    2,
    "the plain strip and the triune strip, so the reading below is two files rather than none",
  );
  const readings = await decodeProduced(FILAMENT_SPRITES);
  for (const [index, row] of FILAMENT_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      read.sprite.width,
      FILAMENT_SPRITE_W,
      `${row.label}: the width of the canvas it was produced on, which spans HEX_PITCH`,
    );
    assertEqual(
      read.sprite.height,
      FILAMENT_SPRITE_H,
      `${row.label}: the height of the canvas it was produced on`,
    );
  }
});
