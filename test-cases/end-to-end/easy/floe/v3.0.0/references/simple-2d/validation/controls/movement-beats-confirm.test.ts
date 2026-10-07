// Floe — controls/movement-beats-confirm: a movement edge and a confirm edge on
// one frame move the highlight and confirm nothing.
//
// `specs/ui.md`: "Where several of a menu's edges arrive on one frame, up is
// applied before down and movement before confirm, so ... a frame carrying a
// movement edge and a confirm edge moves only." This point is the second half of
// that sentence.
//
// THE SCREEN IS THE TITLE, and that is deliberate: `CROSS` opens a live crossing,
// so a confirm that should not have happened is loud here rather than silent. A
// build that applied both in turn confirms whichever entry the move landed on and
// ends up on `howto`; a build that confirmed first opens a crossing. Each of the
// three answers is a different screen, so the failure names which model the build
// implemented.
//
// THE TWO EDGES REALLY LAND ON ONE FRAME. Both keys are put down with no frame
// between them and exactly one frame is driven, so the build reads two armed edges
// in one input read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The highlight the title is posed with: `CROSS`, whose confirm opens a crossing. */
const CROSS_ITEM = TITLE_ITEMS.indexOf("CROSS");

/** The entry the movement edge reaches: `HOW TO PLAY`. */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The two keys pressed together, from the case's own binding table. */
const DOWN_KEY = BINDINGS.down[0];
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves only when a movement edge and a confirm edge arrive on one frame", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(CROSS_ITEM);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(
    posed.menuIndex,
    CROSS_ITEM,
    `the pose highlighted ${TITLE_ITEMS[CROSS_ITEM]}, whose confirm opens a crossing`,
  );

  // Both keys down with no frame between them, then exactly one frame: two armed
  // edges in one input read.
  h.hold(DOWN_KEY);
  h.hold(CONFIRM_KEY);
  try {
    await h.advance(1);
  } finally {
    h.release(DOWN_KEY);
    h.release(CONFIRM_KEY);
  }
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "still the title: movement is applied before confirm and a frame that moves " +
      "confirms nothing, so neither a crossing nor the how-to screen was " +
      "opened (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO_ITEM,
    `and the highlight moved to ${TITLE_ITEMS[HOWTO_ITEM]}`,
  );
});
