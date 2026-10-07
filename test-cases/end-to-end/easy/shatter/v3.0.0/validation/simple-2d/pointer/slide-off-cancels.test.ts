// Shatter — pointer/slide-off-cancels: a press and a release in different regions
// confirm nothing.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm requires both of its edges
// inside one entry's region: the press and its release for a pointer... Two edges
// that fall in different regions, and an edge that falls outside every region,
// confirm no entry." This is the slide-off a player uses to change their mind
// mid-press, and it is the one behaviour of the mouse a build gets wrong by
// confirming on the press alone.
//
// WHY THE SLIDE READS AS A FAILURE WHEN IT IS WRONG. The press comes down on
// `HOW TO PLAY` and the release lands on `PLAY`. A build that confirmed on the
// press is on `howto`; a build that confirmed on the release wherever it fell has
// started a game and is on `playing`. Both are away from the title, and the
// failure names which mistake was made.
//
// EVERY EDGE IS A REAL ONE, at the middles of the two regions `menuItemRect`
// reports.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a press and release in ONE region confirms
// (`pointer/click-confirms`), or that travelling onto an entry highlights it
// (`pointer/hover-selects`), though the highlight is read back here because
// `specs/ui.md` has the travel select even when the gesture confirms nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  dragBetweenItems,
  type Harness,
} from "../harness";

/** The title's entries, by index (`specs/ui.md`, `TITLE_ITEMS`). */
const PLAY = 0;
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms nothing when the press and the release fall in different regions", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(PLAY);
  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the gesture was made on",
  );

  await dragBetweenItems(h, HOW_TO_PLAY, PLAY);
  captureStill(h, "cancelled");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen a press on one entry and a release on another left showing — " +
      "two edges in different regions confirm no entry (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    PLAY,
    "the entry the pointer came to rest on, which travelling onto it selects " +
      "(specs/ui.md)",
  );
});
