// editor/the-selected-part-is-drawn-distinct — the field is drawn differently
// where the selected part stands than it is with the selection cleared.
//
// THE RULE. "At most one part is selected, and THE SELECTED PART IS DRAWN VISIBLY
// DISTINCT" (`specs/editor.md`, Selection on the field). The distinction is what
// tells a player which part the field-focus verbs of the same section — "`part-cw`
// and `part-ccw` turn an arm, a wheel, or a sigil one rotation step … and
// `part-delete` removes any part" — are about to act on, so it has to be visible
// where THAT PART stands rather than anywhere on the stage.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE arm
// on the field, anchored on `(0, 0)` at rotation `0` and length `1`. Nothing else
// is placed, so whatever changes inside the window read below is that arm's
// drawing and not a neighbour's. The selection is posed through the surface's
// `setSelected`, which "Selects that part" and does nothing else
// (`specs/instrumentation.md`), so the two frames compared differ in the selection
// and in nothing else: no press moved the pointer, no drag opened, no focus moved.
//
// HOW THE PICTURE IS READ. A window around the arm — the hexes `(-1, 0)` through
// `(2, 0)`, which hold its base `(0, 0)` and its gripper hex `(1, 0)` with a hex of
// margin on each side, and a band deep enough for whatever is drawn on them — is
// read off the frame with the selection CLEARED and off the frame with the arm
// SELECTED. The verdict is that the two differ: how a build draws the distinction
// is its own affair, and this asks only that the region the part occupies is drawn
// differently at all.
//
// THE VERDICT. `editor.selected` really is `null` in the first frame and really
// does name the arm in the second, and the window around the arm differs between
// the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { hexX, hexY } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  pixelsDiffering,
  placePart,
  type Harness,
  type PixelRect,
} from "../harness";

/**
 * The window read around the arm: the four hexes `(-1, 0)` to `(2, 0)`, which hold
 * its base `(0, 0)` and its gripper hex `(1, 0)` with a hex of margin on each
 * side, and a band deep enough for whatever is drawn on them.
 */
const WINDOW = {
  x: hexX(-1, 0),
  y: hexY(0, 0) - 36,
  w: hexX(2, 0) - hexX(-1, 0),
  h: 72,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function readWindow(): Promise<PixelRect> {
  return h.pixelRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h);
}

it("draws the region the selected part occupies differently from the unselected one", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);

  await h.debug.setSelected(null);
  await h.advance(1);
  const cleared = await readWindow();
  const nothingSelected = (await h.snapshot()).editor.selected;

  await h.debug.setSelected(arm);
  await h.advance(1);
  await captureStill(h, "selected");
  const selected = await readWindow();
  const armSelected = (await h.snapshot()).editor.selected;

  assertNull(
    nothingSelected,
    "the first frame is drawn with the selection cleared",
  );
  assertEqual(
    armSelected,
    arm,
    "the second frame is drawn with that one arm selected",
  );
  assertGreaterThan(
    pixelsDiffering(cleared, selected),
    0,
    "the selected part is drawn visibly distinct, so the region the arm occupies is drawn differently once it is selected",
  );
});
