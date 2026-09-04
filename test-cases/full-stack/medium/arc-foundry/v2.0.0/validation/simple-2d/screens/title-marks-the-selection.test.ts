// screens/title-marks-the-selection — the entry at the current index is drawn
// distinctly from the others.
//
// THE REQUIREMENT. `specs/ui.md`: "The item at the current menu index is
// highlighted and drawn distinctly from the others."
//
// HOW IT IS DECIDED. The title's first frame is drawn twice, in two engines, with
// the highlight posed on the first entry in one and on the last in the other, and
// the two frames must differ. Two fresh engines at the same frame number is what
// makes that comparison fair: a build that animates its title off the frame counter
// draws the same thing on frame one of both, so the only thing that can separate
// them is the highlight — and a build that draws the two entries identically
// whichever is current draws no highlight at all.
//
// WHAT THE TITLE SAYS is the separate point `screens/title-draws-its-copy` decides.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertNotEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;
let other: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
  if (other !== null) other.dispose();
  other = null;
});

it("draws the entry at the current index distinctly from the others", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(0);
  const first = await h.frameCalls();
  captureStill(h, "title");

  // A second engine, so the comparison is between frame one of one title and
  // frame one of another: anything the build draws off its own frame counter is
  // identical in both, and the highlight is the only thing left that differs.
  other = await createHarness();
  other.debug.reset();
  other.debug.setMenuIndex(TITLE_ITEMS.length - 1);
  const last = await other.frameCalls();

  assertNotEqual(
    JSON.stringify(first),
    JSON.stringify(last),
    "the title's frame to change when the highlight moves from the first " +
      "entry to the last, because the item at the current menu index is drawn " +
      "distinctly from the others (specs/ui.md)",
  );
});
