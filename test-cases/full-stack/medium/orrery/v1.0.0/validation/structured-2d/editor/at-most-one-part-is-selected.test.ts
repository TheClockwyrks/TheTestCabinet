// editor/at-most-one-part-is-selected — selecting a second part deselects the
// first, in the state and on the stage.
//
// THE RULE. "At most one part is selected, and the selected part is drawn visibly
// distinct" (`specs/editor.md`, Selection on the field), reached by the press rule
// above it: "The press selects that part". So a press on a second part leaves the
// second selected and the first not — and because the distinction is drawn, the
// first goes back to looking like a part that is not selected.
//
// THE CONFIGURATION. `BARE` opened in the editor with two arms far apart, at
// `(-3, 0)` and `(3, 0)`, and nothing else on the field. Their drawn extents
// cannot overlap: the west arm reaches from its base at `(-3, 0)` to its gripper
// hex at `(-2, 0)`, and the east arm from `(3, 0)` to `(4, 0)`, six hexes away.
// The selection is cleared to begin with, so the first frame shows the west arm
// UNSELECTED; the west arm is then pressed and a frame drawn with it SELECTED; then
// the east arm is pressed and a third frame drawn. Every press is released on the
// hex it began on, which "commits no move", so the only thing that changes between
// the three frames is which part is selected.
//
// HOW THE PICTURE IS READ. A window around the west arm — the four hexes from
// `(-4, 0)` to `(-1, 0)`, a row deep enough to hold whatever is drawn on them — is
// read off each of the three frames. The verdict is not that the third frame is
// the first pixel for pixel, which would forbid a build any drifting of its own,
// but that the third frame stands NEARER the unselected picture than the selected
// one: the west arm was put back the way an unselected part is drawn.
//
// THE VERDICT. `editor.selected` names the east arm alone, the selected picture
// really did differ from the unselected one, and the west arm's window after the
// second press is nearer its unselected picture than its selected one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNull,
} from "../assert";
import { hexX, hexY } from "../field";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  pixelsDiffering,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
  type PixelRect,
} from "../harness";

/**
 * The window read around the west arm: the four hexes `(-4, 0)` to `(-1, 0)`,
 * which hold its base `(-3, 0)` and its gripper hex `(-2, 0)` with a hex of margin
 * on each side, and a row deep enough for whatever is drawn on them.
 */
const WINDOW = {
  x: hexX(-4, 0),
  y: hexY(0, 0) - 36,
  w: hexX(-1, 0) - hexX(-4, 0),
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

async function pressHexCenter(q: number, r: number): Promise<void> {
  await pressAt(h, { x: hexX(q, r), y: hexY(q, r) });
  await releasePointer(h);
  await h.advance(1);
}

it("leaves the second part selected and draws the first as unselected again", async () => {
  await openChallengeDocument(h, BARE);
  const west = await placePart(h, "arm", WEST);
  const east = await placePart(h, "arm", EAST);
  await h.debug.setSelected(null);
  await h.advance(1);

  const unselected = await readWindow();
  const nothingSelected = (await h.snapshot()).editor.selected;

  await pressHexCenter(WEST.q, WEST.r);
  const selected = await readWindow();
  const first = (await h.snapshot()).editor.selected;

  await pressHexCenter(EAST.q, EAST.r);
  await captureStill(h, "single");
  const after = await readWindow();
  const second = (await h.snapshot()).editor.selected;

  assertNull(
    nothingSelected,
    "nothing is selected in the first frame, so it shows the west arm unselected",
  );
  assertEqual(
    first,
    west,
    "the first press selects the west arm, so the second frame shows it selected",
  );
  assertEqual(
    second,
    east,
    "the press on the second part leaves editor.selected naming the east arm alone",
  );

  assertGreaterThan(
    pixelsDiffering(unselected, selected),
    0,
    "the selected part is drawn visibly distinct, so there is a difference to put back",
  );
  assertLessThan(
    pixelsDiffering(after, unselected),
    pixelsDiffering(after, selected),
    "after the second press the west arm is drawn as an unselected part again, nearer its unselected picture than its selected one",
  );
});
