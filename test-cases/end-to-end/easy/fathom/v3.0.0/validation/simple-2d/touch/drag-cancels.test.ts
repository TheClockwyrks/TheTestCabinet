// touch/drag-cancels — a contact that lifts on another item confirms nothing.
//
// specs/ui.md: a confirm takes both of its edges inside ONE item's region, and
// "two edges that fall in different regions ... confirm no item". So the gesture
// this point fixes is a finger that lands on one entry, slides onto another and
// lifts: the selection follows to where it lifted, and nothing is confirmed. That
// is the affordance that lets a player who touched the wrong entry slide off it
// rather than be committed by the landing.
//
// BOTH READINGS ARE THE ONE BEHAVIOR, and each carries the other. `screen` is the
// requirement — still `"title"`, because no item was confirmed. `menuIndex` is
// what makes that reading mean something: a build that ignored the contact
// altogether would also have left the screen alone, and the selection at the
// entry the finger lifted over is the evidence the gesture was read at all.
//
// The slide runs from `DIVE` to `HOW TO PLAY`, so the confirm this must not make
// is the loudest one on the screen — a dive's countdown opening — and the
// selection it must make is one the landing did not already hold.
//
// Three real touch events over the regions the build reports through
// `menuItemRect`. Nothing advances on `"title"` (specs/ui.md), so no bystander
// can move under the gesture.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  touchBetweenItems,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DIVE = TITLE_ITEMS.indexOf("DIVE");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the contact lifts on a different item", async () => {
  openTitle(h);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the contact lands on");
  assertEqual(
    posed.menuIndex,
    DIVE,
    "the selection a reset leaves the title on",
  );

  await touchBetweenItems(h, DIVE, HOWTO);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen after a contact landed in DIVE's region and lifted in HOW TO " +
      "PLAY's, which confirms neither item (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO,
    "the title's selection where the contact lifted, which says the gesture " +
      "was read at all (specs/ui.md)",
  );
});
