// assets/fixture-mount-canvas — the fixture mount is 48 x 48.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Fixture mount row states
// `48 x 48` — the canvas it shares with the wheel hub, which `WHEEL_SPRITE_SIZE`
// holds for both. Scale says why the canvas is fixed: "Every sprite is authored at
// the canvas its table row states and drawn at that size in logical units, centered
// on the thing it depicts, so nothing is scaled at draw time." The mount is drawn
// "centered on each fixture's hex, beneath its mote sprite", so a canvas of another
// size sits wrong under the mote it carries.
//
// WHAT IT READS. The decoded pixel dimensions of the file, against
// `WHEEL_SPRITE_SIZE`, which is the figure `specs/assets.md` fixes.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be
// read is not a canvas of `48 x 48`.
//
// THE EVIDENCE is the produced file over a checkerboard, at the canvas its row
// states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { FIXTURE_MOUNT_PATH, WHEEL_SPRITE_SIZE } from "../constants";
import { WHEEL_SPRITES, assetFile } from "./files";
import { decodeProduced, showSprites } from "./sprites";

const MOUNT = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(FIXTURE_MOUNT_PATH),
);

it("decodes the fixture mount at 48 x 48", async () => {
  await showSprites("canvas", MOUNT);

  assertLength(
    MOUNT,
    1,
    "the fixture mount's row of the produced table, so the reading below is a file rather than none",
  );
  const [read] = await decodeProduced(MOUNT);
  if (read.sprite === null) fail(`a decoded ${MOUNT[0].label}`, read.reason);
  assertEqual(
    read.sprite.width,
    WHEEL_SPRITE_SIZE,
    "the fixture mount: the width of the canvas it was produced on",
  );
  assertEqual(
    read.sprite.height,
    WHEEL_SPRITE_SIZE,
    "the fixture mount: the height of the canvas it was produced on",
  );
});
