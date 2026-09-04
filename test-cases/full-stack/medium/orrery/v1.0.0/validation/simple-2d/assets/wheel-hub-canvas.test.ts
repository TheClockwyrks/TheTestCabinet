// assets/wheel-hub-canvas — the wheel hub is 48 x 48.
//
// THE RULE. "Each of these is one sprite, produced with `draw` on a transparent,
// straight-alpha canvas of exactly the size its row states, and drawn at native
// size" (`specs/assets.md`, The sprites), and the Wheel hub row states `48 x 48` —
// one hex across, since a filament "spans exactly `HEX_PITCH` (`48`) at every
// moment". Scale says why the canvas is fixed: "Every sprite is authored at the
// canvas its table row states and drawn at that size in logical units, centered on
// the thing it depicts, so nothing is scaled at draw time." A hub authored at
// another size covers the wrong share of the anchor hex it is centered on, and
// nothing scales it back.
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
import { WHEEL_HUB_PATH, WHEEL_SPRITE_SIZE } from "../constants";
import { WHEEL_SPRITES, assetFile } from "./files";
import { decodeProduced, showSprites } from "./sprites";

const HUB = WHEEL_SPRITES.filter(
  (row) => row.file === assetFile(WHEEL_HUB_PATH),
);

it("decodes the wheel hub at 48 x 48", async () => {
  await showSprites("canvas", HUB);

  assertLength(
    HUB,
    1,
    "the wheel hub's row of the produced table, so the reading below is a file rather than none",
  );
  const [read] = await decodeProduced(HUB);
  if (read.sprite === null) fail(`a decoded ${HUB[0].label}`, read.reason);
  assertEqual(
    read.sprite.width,
    WHEEL_SPRITE_SIZE,
    "the wheel hub: the width of the canvas it was produced on",
  );
  assertEqual(
    read.sprite.height,
    WHEEL_SPRITE_SIZE,
    "the wheel hub: the height of the canvas it was produced on",
  );
});
