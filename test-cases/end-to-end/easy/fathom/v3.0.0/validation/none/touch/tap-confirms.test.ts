// touch/tap-confirms — a contact that lifts where it landed confirms that item.
//
// specs/ui.md, "Pointer and touch": "A touch contact lands and lifts inside one
// item's region" makes that item the selected one AND confirms it, and the effect
// of the confirm is the one the transition table gives that item — on the title,
// `HOW TO PLAY` sets `screen = howto`.
//
// THE TAP IS ON THE SECOND ENTRY from a title `reset` leaves selected on the
// first, so the screen that follows says which item the gesture confirmed: a
// build that confirmed the item already at `menuIndex` would open a dive's
// countdown, and a build that never read the contact would still be on the title.
// That is what makes `screen` the whole reading here — arriving at the how-to
// screen leaves no menu to read a selection off (specs/state.md), so the
// selection is `touch/landing-selects`'s point instead.
//
// Both edges are real touch events, landed and lifted at the region the build
// reports for the item, and NO KEY IS PRESSED — so a build whose keyboard confirm
// is broken still has its finger graded here, and a build whose finger is broken
// fails this and keeps `states.howto-reachable`.
//
// Nothing advances on `"title"` or on `"howto"` (specs/ui.md), so the gesture
// runs over a world that cannot move under it.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  tapItem,
  type Harness,
} from "../harness";

/** The title entry the contact taps: not the one `reset` leaves selected. */
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms the item a touch contact lands and lifts in", async () => {
  await openTitle(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the contact lands on");
  assertEqual(posed.menuIndex, 0, "the selection a reset leaves the title on");

  await tapItem(h, HOWTO);
  // Before the assertion, so a failing check still leaves the screen it read.
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen a contact landed and lifted inside HOW TO PLAY's own region " +
      "confirms to (specs/ui.md)",
  );
});
