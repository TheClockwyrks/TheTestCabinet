// Floe — controls/up-beats-down: an up edge and a down edge on one frame move the
// highlight up.
//
// `specs/ui.md`: "Where several of a menu's edges arrive on one frame, up is
// applied before down and movement before confirm, so a frame carrying both an up
// edge and a down edge moves up only." This point is the first half of that
// sentence.
//
// THE RULE IS A REQUIREMENT RATHER THAN A CONVENIENCE. A player pressing two
// directions inside one frame is a rare thing to do on purpose, which is why this
// item's cap is the softest one — the standard flow of play is untouched by the
// ordering. What the rule buys is a stated order for the tie instead of
// whichever branch its input read happens to run last, and that is a property a
// validator can decide and a reviewer cannot.
//
// THE START IS THE MIDDLE ENTRY, so both readings are available: up reaches the
// first entry and down would reach the last, and neither is a wrap. A build that
// applied both in turn lands back on the middle one, which is a third distinct
// answer this check names.
//
// THE TWO EDGES REALLY LAND ON ONE FRAME. Both keys are put down with no frame
// between them and exactly one frame is driven, so the build reads two armed edges
// in one input read — which is the situation the rule is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The highlight the menu is posed with: the middle of the three. */
const POSED_INDEX = 1;

/** The entry up reaches, and the entry down would have reached. */
const UP_INDEX = 0;
const DOWN_INDEX = 2;

/** The two keys pressed together, from the case's own binding table. */
const UP_KEY = BINDINGS.up[0];
const DOWN_KEY = BINDINGS.down[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves up when an up edge and a down edge arrive on one frame", async () => {
  startCrossing(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(POSED_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[POSED_INDEX]}, the middle of the three`,
  );

  // Both keys down with no frame between them, then exactly one frame: two armed
  // edges in one input read.
  h.hold(UP_KEY);
  h.hold(DOWN_KEY);
  try {
    await h.advance(1);
  } finally {
    h.release(UP_KEY);
    h.release(DOWN_KEY);
  }
  captureStill(h, "menu");

  const after = h.snapshot();
  assertEqual(
    after.menuIndex,
    UP_INDEX,
    `${PAUSE_ITEMS[UP_INDEX]}: up is applied before down, so a frame carrying ` +
      `both moves up only rather than to ${PAUSE_ITEMS[DOWN_INDEX]} or back to ` +
      `${PAUSE_ITEMS[POSED_INDEX]} (specs/ui.md)`,
  );
  assertEqual(
    after.screen,
    "paused",
    "and moves the highlight rather than leaving the screen",
  );
});
