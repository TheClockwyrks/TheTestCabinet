// assets/hub-sprites-carry-paint — each hub sprite carries paint.
//
// THE RULE. The Arm hubs row of `specs/assets.md` (The sprites) names a hub drawn
// on the anchor hex of every arm and piston on the field, and Genuinely produced
// says what such a file is for: "Every mote, filament, glyph, hub, gripper, mount,
// and aperture on screen is a produced sprite". The art bar adds what it must do:
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." A hub that carries no paint leaves an arm's base unmarked, so where
// the arm is anchored reads off nothing but the spokes drawn in code.
//
// WHAT IT READS. Both files decode, and the share of each canvas carrying paint
// is above zero: some pixel of it carries an alpha above zero.
// `specs/assets.md` fixes no coverage figure, so what is read is that the
// canvas was drawn on at all rather than a second art bar. Whether the piston
// hub READS APART from the arm hub is the art bar itself, and the reviewer's
// judgement.
//
// THE EVIDENCE is the two files magnified over a checkerboard: wherever the checker
// shows through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import { HUB_SPRITES } from "./files";
import { decodeProduced, paintShare, showSprites } from "./sprites";

it("decodes both arm hubs as canvases carrying paint", async () => {
  await showSprites("coverage", HUB_SPRITES);

  assertLength(
    HUB_SPRITES,
    2,
    "the arm hub and the piston hub, so the reading below is two files rather than none",
  );
  const readings = await decodeProduced(HUB_SPRITES);
  for (const [index, row] of HUB_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThan(
      paintShare(read.sprite),
      0,
      `${row.label}: the share of its canvas carrying paint`,
    );
  }
});
