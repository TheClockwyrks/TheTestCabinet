// screens/title-marks-the-selection — the entry at the current index is drawn
// distinctly from the others.
//
// THE REQUIREMENT. `specs/ui.md`: "The item at the current menu index is
// highlighted and drawn distinctly from the others, and the index is `0` on
// arriving at the title." What the highlight LOOKS like is the build's, so what
// is decided is that the two entries are not drawn the same way whichever one is
// current.
//
// HOW IT IS DECIDED. The title's first frame is drawn with the index on the first
// entry, and drawn again in a SECOND browser page with the index on the last, and
// the two frames must differ. Two fresh pages at the same frame number is what
// makes that comparison fair: a build that animates its title off the frame
// counter draws the same thing on frame one of both, so the only thing that can
// separate them is the highlight — and a build that draws the two entries
// identically whichever is current draws no highlight at all.
//
// What the title's copy says is a second requirement, and
// `screens/title-draws-its-copy` decides that.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;
let other: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  if (other !== null) await other.dispose();
  other = null;
});

it("draws the entry at the current index distinctly from the others", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(0);
  const first = await h.frameCalls();
  await captureStill(h, "title");

  // A second page, so the comparison is between frame one of one title and frame
  // one of another: anything the build draws off its own frame counter is
  // identical in both, and the highlight is the only thing left that differs.
  other = await createHarness();
  await other.debug.reset();
  await other.debug.setMenuIndex(TITLE_ITEMS.length - 1);
  const last = await other.frameCalls();

  assertNotEqual(
    JSON.stringify(first),
    JSON.stringify(last),
    "the title's frame to change when the highlight moves from the first " +
      "entry to the last, because the item at the current menu index is drawn " +
      "distinctly from the others (specs/ui.md)",
  );
});
