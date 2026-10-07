// assets/set-frames-canvas — every set frame is 48 x 48.
//
// THE RULE. The sheets of `specs/assets.md`: each frame is emitted "on a
// transparent, straight-alpha canvas of exactly the size its row states", and the
// Set aperture row states `48 x 48` — one hex across, since a filament "spans
// exactly `HEX_PITCH` (`48`) at every moment". Scale says why the canvas is fixed:
// "Every sprite is authored at the canvas its table row states and drawn at that
// size in logical units, centered on the thing it depicts, so nothing is scaled at
// draw time." A frame authored at another size covers the wrong share of the anchor
// hex the aperture is centered on, and nothing scales it back.
//
// EVERY FRAME, NOT THE FIRST. The six are drawn one after another on the same hex,
// so a sheet whose frames disagree on their canvas jumps in size as it turns.
//
// WHAT IT READS. The decoded pixel dimensions of all six files, against
// `APERTURE_SPRITE_SIZE`, which is the figure `specs/assets.md` fixes.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a canvas that cannot be read
// is not a canvas of `48 x 48`.
//
// THE EVIDENCE is the six produced files over a checkerboard, at the canvas their row
// states.

import { it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { APERTURE_FRAMES, APERTURE_SPRITE_SIZE } from "../constants";
import { SET_SPRITES } from "./files";
import { decodeProduced, showSprites } from "./sprites";

it("decodes all six set aperture frames at 48 x 48", async () => {
  await showSprites("canvases", SET_SPRITES);

  assertLength(
    SET_SPRITES,
    APERTURE_FRAMES,
    "one path per frame the Set aperture row states, so the reading below is six files rather than none",
  );
  const readings = await decodeProduced(SET_SPRITES);
  for (const [index, row] of SET_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertEqual(
      read.sprite.width,
      APERTURE_SPRITE_SIZE,
      `${row.label}: the width of the canvas it was produced on`,
    );
    assertEqual(
      read.sprite.height,
      APERTURE_SPRITE_SIZE,
      `${row.label}: the height of the canvas it was produced on`,
    );
  }
});
