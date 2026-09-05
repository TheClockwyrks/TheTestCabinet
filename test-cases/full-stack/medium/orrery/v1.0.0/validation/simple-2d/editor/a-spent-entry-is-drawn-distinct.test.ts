// editor/a-spent-entry-is-drawn-distinct — a spent entry is drawn differently from
// the way the same entry was drawn unspent.
//
// THE RULE. "A rise or set entry is spent once its part is on the field: it is
// drawn visibly distinct from an unspent entry, and a press on it does nothing
// until the placed part is deleted" (`specs/editor.md`, The tray). The entry's
// rectangle is the same section's: "Entry `k`, counted from `0`, occupies the
// rectangle from `(TRAY_X0, TRAY_Y0 + k * TRAY_SLOT_H)` to `(TRAY_X0 + TRAY_W,
// TRAY_Y0 + (k + 1) * TRAY_SLOT_H)`". How the distinction is drawn is the build's
// — "how it is arranged inside its rectangle is yours" — so what is read is that
// the rectangle changed, not what changed in it.
//
// THE CONFIGURATION. `BARE` opened in the editor, whose tray is `arm`, one rise
// and one set. One frame is drawn with an empty machine and the rise entry's
// rectangle read off it. The rise is then put on the field through the surface, at
// a hex nothing else reaches, another frame is drawn, and the SAME rectangle is
// read again. Nothing is pressed, so no drag's ghost is on the stage either side,
// and the only thing that changed between the two frames is that the rise is now
// on the field.
//
// THE VERDICT. The entry's rectangle is drawn differently once the entry is
// spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { traySlot } from "../field";
import { BARE, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  openChallengeDocument,
  partIds,
  placeRise,
  type Harness,
  type PixelRect,
} from "../harness";

/** `BARE`'s tray: `arm`, then the one rise, then the one set. */
const RISE_SLOT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function readEntry(): Promise<PixelRect> {
  const rectangle = traySlot(RISE_SLOT);
  return h.pixelRect(rectangle.x, rectangle.y, rectangle.w, rectangle.h);
}

it("draws the rise entry differently once its rise is on the field", async () => {
  await openChallengeDocument(h, BARE);
  assertEqual(
    (await partIds(h)).length,
    0,
    "the machine is empty, so the rise entry is unspent in the first frame",
  );
  const unspent = await readEntry();

  await placeRise(h, 0, WEST);
  await h.advance(1);
  await captureStill(h, "before-after");
  const spent = await readEntry();

  assertEqual(
    (await partIds(h)).length,
    1,
    "the rise is on the field, so its entry is spent in the second frame",
  );
  assertGreaterThan(
    differingShare(unspent, spent),
    0,
    `entry ${RISE_SLOT} is drawn visibly distinct once its rise is on the field`,
  );
});
