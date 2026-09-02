// assets/instruction-glyphs-carry-paint — every instruction glyph carries paint.
//
// THE RULE. The Instruction glyphs row of `specs/assets.md` (The sprites) names a
// glyph per instruction, drawn centered in its tape cell, and Genuinely produced
// says what such a file is for: "Every mote, filament, glyph, hub, gripper, mount,
// and aperture on screen is a produced sprite". The art bar adds what it must do:
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." A glyph that carries no paint leaves its tape cell blank, and a
// blank cell is what a tape holds where there is NO instruction.
//
// WHAT IT READS. Each of the ten files decodes, and the share of its canvas
// carrying paint — any pixel whose alpha is above zero — clears `PAINT_MIN_SHARE`.
// `specs/assets.md` fixes no coverage figure, so that floor is one hundredth of the
// canvas: six pixels of a `24`-unit cell, an order of magnitude below the thinnest
// mark an instruction could legibly be drawn as, which makes it a reading about a
// canvas that was drawn on at all rather than a second art bar. Whether the ten are
// TOLD APART in a `24`-unit tape cell is the art bar itself, and the reviewer's
// judgement.
//
// THE EVIDENCE is the produced files magnified over a checkerboard: wherever the
// checker shows through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { INSTRUCTIONS } from "../constants";
import { INSTRUCTION_SPRITES } from "./files";
import {
  PAINT_MIN_SHARE,
  decodeProduced,
  paintShare,
  showSprites,
} from "./sprites";

it("decodes each of the ten instruction glyphs as a canvas carrying paint", async () => {
  await showSprites("coverage", INSTRUCTION_SPRITES);

  assertLength(
    INSTRUCTION_SPRITES,
    INSTRUCTIONS.length,
    "one path per name in INSTRUCTIONS, so the reading below is ten files rather than none",
  );
  const readings = await decodeProduced(INSTRUCTION_SPRITES);
  for (const [index, row] of INSTRUCTION_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      paintShare(read.sprite),
      PAINT_MIN_SHARE,
      `${row.label}: the share of its canvas carrying paint`,
    );
  }
});
