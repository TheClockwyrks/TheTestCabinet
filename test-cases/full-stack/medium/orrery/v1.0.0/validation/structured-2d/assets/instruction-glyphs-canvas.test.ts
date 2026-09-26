// assets/instruction-glyphs-canvas — every instruction glyph is 24 x 24.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Instruction glyphs row states
// `24 x 24`, drawn "centered in its tape cell". Scale says why the canvas is
// fixed: "Every sprite is authored at the canvas its table row states and drawn at
// that size in logical units, centered on the thing it depicts, so nothing is
// scaled at draw time." A glyph authored at another size is either scaled into the
// cell or drawn over its neighbours.
//
// WHAT IT READS. The decoded pixel dimensions of each of the ten files, against
// `INSTRUCTION_GLYPH_SIZE`, which is the figure `specs/assets.md` fixes.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be
// read is not a canvas of `24 x 24`.
//
// THE EVIDENCE is the produced files over a checkerboard, at the canvas their row
// states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { INSTRUCTIONS, INSTRUCTION_GLYPH_SIZE } from "../constants";
import { INSTRUCTION_SPRITES } from "./files";
import { decodeProduced, showSprites } from "./sprites";

it("decodes each of the ten instruction glyphs at 24 x 24", async () => {
  await showSprites("canvases", INSTRUCTION_SPRITES);

  assertLength(
    INSTRUCTION_SPRITES,
    INSTRUCTIONS.length,
    "one path per name in INSTRUCTIONS, so the reading below is ten files rather than none",
  );
  const readings = await decodeProduced(INSTRUCTION_SPRITES);
  for (const [index, row] of INSTRUCTION_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      read.sprite.width,
      INSTRUCTION_GLYPH_SIZE,
      `${row.label}: the width of the canvas it was produced on`,
    );
    assertEqual(
      read.sprite.height,
      INSTRUCTION_GLYPH_SIZE,
      `${row.label}: the height of the canvas it was produced on`,
    );
  }
});
