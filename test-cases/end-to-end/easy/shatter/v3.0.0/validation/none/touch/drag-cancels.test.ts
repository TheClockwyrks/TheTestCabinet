// Shatter — touch/drag-cancels: a contact lifted on a different entry confirms
// nothing.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm takes both of its edges
// inside one entry's region... Two edges that fall in different regions, and an
// edge that falls outside every region, confirm no entry." On a touchscreen that
// is the whole of how a player takes a press back: slide the finger off the thing
// you meant not to take.
//
// WHY IT READS AS A FAILURE WHEN IT IS WRONG. The contact lands on `HOW TO PLAY`
// and lifts on `PLAY`. A build that confirmed on the landing is on `howto`; a
// build that confirmed on the lift wherever it fell has started a game and is on
// `playing`. Both are away from the title, and the failure names which.
//
// THE PAGE REPORTS A TOUCHSCREEN, asked for by this check alone, and the landing,
// the travel and the lift are real events at the middles of the two regions
// `menuItemRect` reports.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a tap in ONE region confirms
// (`touch/tap-confirms`), though the highlight is read back here because
// `specs/ui.md` has a contact travelling onto an entry select it even when the
// gesture confirms nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  touchBetweenItems,
  type Harness,
} from "../harness";
import { SETTLE_TICKS } from "../screens/screens";

/** The title's entries, by index (`specs/ui.md`, `TITLE_ITEMS`). */
const PLAY = 0;
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the contact lifts on a different entry", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(PLAY);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the gesture was made on",
  );

  await touchBetweenItems(h, HOW_TO_PLAY, PLAY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "cancelled");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen a landing on one entry and a lift on another left showing — " +
      "two edges in different regions confirm no entry (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    PLAY,
    "the entry the contact came to rest on, which travelling onto it selects " +
      "(specs/ui.md)",
  );
});
