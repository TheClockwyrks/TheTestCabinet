// Facet — targets/press-moves-the-highlight: a press inside a target moves the
// highlight onto it.
//
// The second row of specs/controls.md's table of what the pointer does to a
// screen: "Presses within a target — The highlight moves as the row above
// describes, and that target is armed."
//
// `menu-1` RATHER THAN `menu-0`, so the highlight has somewhere to move to: the
// title screen opens at `0`, and a press that moved nothing would be
// indistinguishable from a press on the item already highlighted.
//
// THE PRESS IS AT THE RECTANGLE THE BUILD REPORTED, at its center, which
// specs/instrumentation.md guarantees is inside the rectangle the game
// hit-tests — so the check asserts nothing at all about the build's layout.
//
// "The highlight moves as the row above describes" — the row above being a
// pointer moved within a target, which "selects that item". So a press selects
// the item it lands on, exactly as a move over it would.
//
// WHY IT IS ITS OWN POINT, AND WHAT IT IS FOR. specs/controls.md makes the press
// arm AND highlight in one row, and a build can do one and not the other:
// `targets/press-arms-target` decides the arming. The highlight is the half a
// touchscreen needs — "The highlight moving on a press is what makes a
// touchscreen behave as a mouse does: a finger has no hover, so the press is
// what tells the player which item their release will take." A build that armed
// without highlighting leaves a player with a finger pressing blind, and it
// passes the arming point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressTarget,
  targetById,
  type Harness,
} from "../harness";

/** The target the press lands in: the second item, so the highlight has to move. */
const WANTED = "menu-1";

/** The index `menu-1` names, which is the `i` of its id. */
const WANTED_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the highlight onto the item the press landed in", async () => {
  h.debug.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen the press is made on");
  assertEqual(opened.menuIndex, 0, "the highlighted item before the press");

  const second = targetById(opened, WANTED);
  const armed = pressTarget(h, second);

  // The frame that draws the item held under the press, and the picture of it.
  await h.advance(1);
  captureStill(h, "highlighted");

  assertEqual(
    armed.menuIndex,
    WANTED_INDEX,
    "the highlighted item the press moved onto",
  );
  assertEqual(
    armed.screen,
    "title",
    "the screen, which the press highlights on rather than leaves",
  );
});
