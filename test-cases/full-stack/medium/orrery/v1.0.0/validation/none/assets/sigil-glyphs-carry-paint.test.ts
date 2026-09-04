// assets/sigil-glyphs-carry-paint — every sigil glyph carries paint.
//
// THE RULE. The Sigil glyphs row of `specs/assets.md` (The sprites) names a glyph
// per transforming sigil, drawn on the sigil's anchor hex, and Genuinely produced
// says what such a file is for: "Every mote, filament, glyph, hub, gripper, mount,
// and aperture on screen is a produced sprite". The art bar adds what it must do:
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." A glyph that carries no paint leaves its anchor hex showing only the
// footprint the build draws in code, so the sigil placed there is unreadable.
//
// WHAT IT READS. Each of the twelve files decodes, and the share of its canvas
// carrying paint — any pixel whose alpha is above zero — clears `PAINT_MIN_SHARE`.
// `specs/assets.md` fixes no coverage figure, so that floor is one hundredth of the
// canvas: an order of magnitude below the thinnest engraving a glyph could legibly
// be drawn as, which makes it a reading about a canvas that was drawn on at all
// rather than a second art bar. Whether the twelve are TOLD APART at `48` units is
// the art bar itself, and the reviewer's judgement.
//
// THE EVIDENCE is the produced files magnified over a checkerboard: wherever the
// checker shows through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { TRANSFORMING_SIGILS } from "../constants";
import { SIGIL_SPRITES } from "./files";
import {
  PAINT_MIN_SHARE,
  decodeProduced,
  paintShare,
  showSprites,
} from "./sprites";

it("decodes each of the twelve sigil glyphs as a canvas carrying paint", async () => {
  await showSprites("coverage", SIGIL_SPRITES);

  assertLength(
    SIGIL_SPRITES,
    TRANSFORMING_SIGILS.length,
    "one path per transforming sigil of PARTS, so the reading below is twelve files rather than none",
  );
  const readings = await decodeProduced(SIGIL_SPRITES);
  for (const [index, row] of SIGIL_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      paintShare(read.sprite),
      PAINT_MIN_SHARE,
      `${row.label}: the share of its canvas carrying paint`,
    );
  }
});
