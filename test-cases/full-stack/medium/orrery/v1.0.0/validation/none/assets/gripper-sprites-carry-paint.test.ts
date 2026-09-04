// assets/gripper-sprites-carry-paint — each gripper sprite carries paint.
//
// THE RULE. The Grippers row of `specs/assets.md` (The sprites) names a sprite
// drawn on every gripper of every arm and piston on the field, and Genuinely
// produced says what such a file is for: "Every mote, filament, glyph, hub,
// gripper, mount, and aperture on screen is a produced sprite". The art bar adds
// what it must do: "Every sprite reads on the dark sky, and none of them relies on
// a background behind it." A gripper that carries no paint leaves the end of an
// arm's shaft unmarked, so where the arm's hand is — and, by the row, "whether a
// gripper is holding" — reads off nothing at all.
//
// WHAT IT READS. Both files decode, and the share of each canvas carrying paint —
// any pixel whose alpha is above zero — clears `PAINT_MIN_SHARE`.
// `specs/assets.md` fixes no coverage figure, so that floor is one hundredth of the
// canvas: an order of magnitude below the thinnest mark a gripper could legibly be
// drawn as, which makes it a reading about a canvas that was drawn on at all rather
// than a second art bar. Whether a closed gripper READS AS CLOSED is the art bar
// itself, and the reviewer's judgement.
//
// THE EVIDENCE is the two files magnified over a checkerboard: wherever the checker
// shows through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { GRIPPER_SPRITES } from "./files";
import {
  PAINT_MIN_SHARE,
  decodeProduced,
  paintShare,
  showSprites,
} from "./sprites";

it("decodes both grippers as canvases carrying paint", async () => {
  await showSprites("coverage", GRIPPER_SPRITES);

  assertLength(
    GRIPPER_SPRITES,
    2,
    "the open gripper and the closed one, so the reading below is two files rather than none",
  );
  const readings = await decodeProduced(GRIPPER_SPRITES);
  for (const [index, row] of GRIPPER_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      paintShare(read.sprite),
      PAINT_MIN_SHARE,
      `${row.label}: the share of its canvas carrying paint`,
    );
  }
});
