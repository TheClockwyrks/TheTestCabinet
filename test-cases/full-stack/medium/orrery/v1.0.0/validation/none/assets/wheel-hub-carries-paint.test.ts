// assets/wheel-hub-carries-paint — the wheel hub carries paint.
//
// THE RULE. The Wheel hub row of `specs/assets.md` (The sprites) names a sprite
// drawn on the anchor hex of every wheel on the field, and Genuinely produced says
// what such a file is for: "Every mote, filament, glyph, hub, gripper, mount, and
// aperture on screen is a produced sprite". The art bar adds what it must do:
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." A hub that carries no paint leaves a wheel's center unmarked, so
// where the wheel turns about reads off nothing but the spokes What stays drawn in
// code hands to the build.
//
// WHAT IT READS. The file decodes, and the share of its canvas carrying paint
// is above zero: some pixel of it carries an alpha above zero.
// `specs/assets.md` fixes no coverage figure, so what is read is that the
// canvas was drawn on at all rather than a second art bar.
//
// THE EVIDENCE is the file magnified over a checkerboard: wherever the checker
// shows through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import { WHEEL_HUB_PATH } from "../constants";
import { WHEEL_SPRITES, assetFile } from "./files";
import { decodeProduced, paintShare, showSprites } from "./sprites";

const HUB = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(WHEEL_HUB_PATH),
);

it("decodes the wheel hub as a canvas carrying paint", async () => {
  await showSprites("coverage", HUB);

  assertLength(
    HUB,
    1,
    "the wheel hub's row of the produced table, so the reading below is a file rather than none",
  );
  const [read] = await decodeProduced(HUB);
  if (read.sprite === null) fail(`a decoded ${HUB[0].label}`, read.reason);
  assertGreaterThan(
    paintShare(read.sprite),
    0,
    "the wheel hub: the share of its canvas carrying paint",
  );
});
