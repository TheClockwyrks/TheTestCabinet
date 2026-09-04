// assets/mote-sprites-carry-paint — every mote sprite carries paint.
//
// THE RULE. The Motes row of `specs/assets.md` (The sprites) names a sprite per
// mote type, and Genuinely produced says what a sprite is for: "Every mote,
// filament, glyph, hub, gripper, mount, and aperture on screen is a produced
// sprite ... Everything the game shows and plays traces to a file produced here or
// to the chrome drawn in code above." The art bar adds what such a file must do:
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." An empty canvas draws nothing on the dark sky, so a file that
// carries no paint is a file the game shows nothing from.
//
// WHAT IT READS. Each of the fifteen files decodes, and the share of its canvas
// carrying paint — any pixel whose alpha is above zero — clears `PAINT_MIN_SHARE`.
// `specs/assets.md` fixes no coverage figure, so that floor is one hundredth of
// the canvas: an order of magnitude below the thinnest mark a mote could legibly
// be drawn as, which is what makes it a reading about a canvas that was drawn on
// at all rather than a second art bar. Whether the mote reads WELL at `44` units
// is the reviewer's judgement, not this point's.
//
// THE EVIDENCE is the produced files magnified over a checkerboard: wherever the
// checker shows through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { MOTES } from "../constants";
import { MOTE_SPRITES } from "./files";
import {
  PAINT_MIN_SHARE,
  decodeProduced,
  paintShare,
  showSprites,
} from "./sprites";

it("decodes each of the fifteen mote sprites as a canvas carrying paint", async () => {
  await showSprites("coverage", MOTE_SPRITES);

  assertLength(
    MOTE_SPRITES,
    MOTES.length,
    "one path per name in MOTES, so the reading below is fifteen files rather than none",
  );
  const readings = await decodeProduced(MOTE_SPRITES);
  for (const [index, row] of MOTE_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      paintShare(read.sprite),
      PAINT_MIN_SHARE,
      `${row.label}: the share of its canvas carrying paint`,
    );
  }
});
