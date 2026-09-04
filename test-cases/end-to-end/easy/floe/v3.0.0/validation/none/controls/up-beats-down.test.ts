// Floe — controls/up-beats-down: an up edge and a down edge on one tick move the
// highlight up.
//
// `specs/ui.md`: "Where several of a menu's edges arrive on one tick, up is
// applied before down and movement before confirm, so a tick carrying both an up
// edge and a down edge moves up only." This point is the first half of that
// sentence.
//
// THE RULE IS A REQUIREMENT RATHER THAN A CONVENIENCE. A player pressing two
// directions inside one tick is a rare thing to do on purpose, which is why this
// item's cap is the softest one — the standard flow of play is untouched by the
// ordering. What the rule buys is a build that resolves the tie the same way
// every time instead of by whichever branch its input read happens to run last,
// and that is a property a validator can decide and a reviewer cannot.
//
// THE START IS THE MIDDLE ENTRY, so both readings are available: up reaches the
// first entry and down would reach the last, and neither is a wrap. A build that
// applied both in turn lands back on the middle one, which is a third distinct
// answer this check names.
//
// THE TWO EDGES REALLY LAND ON ONE TICK. Both keys are put down with no tick
// between them and exactly one tick is driven, so the build reads two armed edges
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

afterEach(async () => {
  await h.dispose();
});

it("moves up when an up edge and a down edge arrive on one tick", async () => {
  await startCrossing(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(POSED_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[POSED_INDEX]}, the middle of the three`,
  );

  // Both keys down with no tick between them, then exactly one tick: two armed
  // edges in one input read.
  await h.hold(UP_KEY);
  await h.hold(DOWN_KEY);
  try {
    await h.advance(1);
  } finally {
    await h.release(UP_KEY);
    await h.release(DOWN_KEY);
  }
  await captureStill(h, "menu");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    UP_INDEX,
    `${PAUSE_ITEMS[UP_INDEX]}: up is applied before down, so a tick carrying ` +
      `both moves up only rather than to ${PAUSE_ITEMS[DOWN_INDEX]} or back to ` +
      `${PAUSE_ITEMS[POSED_INDEX]} (specs/ui.md)`,
  );
  assertEqual(
    after.screen,
    "paused",
    "and moves the highlight rather than leaving the screen",
  );
});
