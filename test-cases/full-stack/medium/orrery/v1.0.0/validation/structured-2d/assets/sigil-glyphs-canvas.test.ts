// assets/sigil-glyphs-canvas — every sigil glyph is 48 x 48.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Sigil glyphs row states
// `48 x 48` — one `HEX_PITCH` across, which is the hex the glyph is "upright and
// centered on". Scale says why the canvas is fixed: "Every sprite is authored at
// the canvas its table row states and drawn at that size in logical units,
// centered on the thing it depicts, so nothing is scaled at draw time." A glyph
// authored at another size covers the wrong share of its anchor hex.
//
// WHAT IT READS. The decoded pixel dimensions of each of the twelve files, against
// `SIGIL_GLYPH_SIZE`, which is the figure `specs/assets.md` fixes.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be
// read is not a canvas of `48 x 48`.
//
// THE EVIDENCE is the produced files over a checkerboard, at the canvas their row
// states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { SIGIL_GLYPH_SIZE, TRANSFORMING_SIGILS } from "../constants";
import { SIGIL_SPRITES } from "./files";
import { decodeProduced, showSprites } from "./sprites";

it("decodes each of the twelve sigil glyphs at 48 x 48", async () => {
  await showSprites("canvases", SIGIL_SPRITES);

  assertLength(
    SIGIL_SPRITES,
    TRANSFORMING_SIGILS.length,
    "one path per transforming sigil of PARTS, so the reading below is twelve files rather than none",
  );
  const readings = await decodeProduced(SIGIL_SPRITES);
  for (const [index, row] of SIGIL_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      read.sprite.width,
      SIGIL_GLYPH_SIZE,
      `${row.label}: the width of the canvas it was produced on`,
    );
    assertEqual(
      read.sprite.height,
      SIGIL_GLYPH_SIZE,
      `${row.label}: the height of the canvas it was produced on`,
    );
  }
});
