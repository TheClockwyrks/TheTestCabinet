// assets/filament-sprites-carry-paint — each filament strip carries paint.
//
// THE RULE. The Filaments row of `specs/assets.md` (The sprites) names a strip
// drawn between the two motes a filament joins, and Genuinely produced says what
// such a file is for: "Every mote, filament, glyph, hub, gripper, mount, and
// aperture on screen is a produced sprite". The art bar adds what it must do:
// "Every sprite reads on the dark sky, and none of them relies on a background
// behind it." A strip that carries no paint draws no join between two motes, so a
// constellation would read as two motes that happen to sit side by side.
//
// WHAT IT READS. Both files decode, and the share of each canvas carrying paint —
// any pixel whose alpha is above zero — clears `PAINT_MIN_SHARE`.
// `specs/assets.md` fixes no coverage figure, so that floor is one hundredth of the
// canvas: an order of magnitude below the thinnest line a strip could legibly be
// drawn as, which makes it a reading about a canvas that was drawn on at all
// rather than a second art bar. Whether the triune strip reads as CLEARLY HEAVIER
// than the plain one is the art bar itself, and the reviewer's judgement.
//
// THE EVIDENCE is the two files magnified over a checkerboard: wherever the checker
// shows through, the canvas carried nothing there.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { FILAMENT_SPRITES } from "./files";
import {
  PAINT_MIN_SHARE,
  decodeProduced,
  paintShare,
  showSprites,
} from "./sprites";

it("decodes both filament strips as canvases carrying paint", async () => {
  await showSprites("coverage", FILAMENT_SPRITES);

  assertLength(
    FILAMENT_SPRITES,
    2,
    "the plain strip and the triune strip, so the reading below is two files rather than none",
  );
  const readings = await decodeProduced(FILAMENT_SPRITES);
  for (const [index, row] of FILAMENT_SPRITES.entries()) {
    const read = readings[index];
    if (read.sprite === null) fail(`a decoded ${row.label}`, read.reason);
    assertGreaterThanOrEqual(
      paintShare(read.sprite),
      PAINT_MIN_SHARE,
      `${row.label}: the share of its canvas carrying paint`,
    );
  }
});
