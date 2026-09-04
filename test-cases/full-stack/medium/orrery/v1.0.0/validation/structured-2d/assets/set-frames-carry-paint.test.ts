// assets/set-frames-carry-paint — every set frame carries paint.
//
// THE RULE. The Set aperture row of `specs/assets.md` (The sheets) names six
// frames drawn in turn on every set's anchor hex, and Genuinely produced says what
// such a file is for: "Every mote, filament, glyph, hub, gripper, mount, and
// aperture on screen is a produced sprite". The art bar adds what they must do:
// "The rise aperture reads as an entrance and the set aperture as an exit", and
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." A frame that carries no paint is a frame the aperture blinks out on,
// since each of the six is shown in its turn — `APERTURE_FRAME_TIME` (`0.12`)
// seconds of every turn of the sheet.
//
// WHAT IT READS. All six files decode, and the share of each canvas carrying paint —
// any pixel whose alpha is above zero — clears `PAINT_MIN_SHARE`. `specs/assets.md`
// fixes no coverage figure, so that floor is one hundredth of the canvas: an order of
// magnitude below the thinnest mark an aperture could legibly be drawn as, which
// makes it a reading about a canvas that was drawn on at all rather than a second art
// bar. Whether the six read as ONE CONTINUOUS TURN is the art bar itself, and the
// reviewer's judgement.
//
// THE EVIDENCE is the six files magnified over a checkerboard: wherever the checker
// shows through, that frame carried nothing there.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { APERTURE_FRAMES } from "../constants";
import { SET_SPRITES } from "./files";
import {
  PAINT_MIN_SHARE,
  decodeProduced,
  paintShare,
  showSprites,
} from "./sprites";

it("decodes all six set aperture frames as canvases carrying paint", async () => {
  await showSprites("coverage", SET_SPRITES);

  assertLength(
    SET_SPRITES,
    APERTURE_FRAMES,
    "one path per frame the Set aperture row states, so the reading below is six files rather than none",
  );
  const readings = await decodeProduced(SET_SPRITES);
  for (const [index, row] of SET_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      paintShare(read.sprite),
      PAINT_MIN_SHARE,
      `${row.label}: the share of its canvas carrying paint`,
    );
  }
});
