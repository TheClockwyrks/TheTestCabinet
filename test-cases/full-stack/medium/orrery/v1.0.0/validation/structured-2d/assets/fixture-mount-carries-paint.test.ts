// assets/fixture-mount-carries-paint — the fixture mount carries paint.
//
// THE RULE. The Fixture mount row of `specs/assets.md` (The sprites) names a sprite
// drawn under every fixture a wheel carries, and Genuinely produced says what such
// a file is for: "Every mote, filament, glyph, hub, gripper, mount, and aperture on
// screen is a produced sprite". The art bar adds what it must do: "A fixture reads
// as mounted on its wheel rather than as resting loose", and "Every sprite reads on
// the dark sky, and none of them relies on a background behind it." A mount that
// carries no paint leaves the mote on a fixture looking exactly like a mote resting
// on a hex, which is the one reading the mount exists to give.
//
// WHAT IT READS. The file decodes, and the share of its canvas carrying paint
// is above zero: some pixel of it carries an alpha above zero.
// `specs/assets.md` fixes no coverage figure, so what is read is that the
// canvas was drawn on at all rather than a second art bar. Whether a fixture
// READS AS MOUNTED is the art bar itself, and the reviewer's judgement.
//
// THE EVIDENCE is the file magnified over a checkerboard: wherever the checker shows
// through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import { FIXTURE_MOUNT_PATH } from "../constants";
import { WHEEL_SPRITES, assetFile } from "./files";
import { decodeProduced, paintShare, showSprites } from "./sprites";

const MOUNT = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(FIXTURE_MOUNT_PATH),
);

it("decodes the fixture mount as a canvas carrying paint", async () => {
  await showSprites("coverage", MOUNT);

  assertLength(
    MOUNT,
    1,
    "the fixture mount's row of the produced table, so the reading below is a file rather than none",
  );
  const [read] = await decodeProduced(MOUNT);
  if (read.sprite === null) fail(`a decoded ${MOUNT[0].label}`, read.reason);
  assertGreaterThan(
    paintShare(read.sprite),
    0,
    "the fixture mount: the share of its canvas carrying paint",
  );
});
