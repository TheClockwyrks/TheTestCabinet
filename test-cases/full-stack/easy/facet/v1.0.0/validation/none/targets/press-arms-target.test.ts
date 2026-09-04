// Facet — targets/press-arms-target: a press inside a target arms it, moves the
// highlight, and takes nothing.
//
// The second row of specs/controls.md's table of what the pointer does to a
// screen: "Presses within a target — The highlight moves as the row above
// describes, and that target is armed." specs/state.md keeps the armed target on
// the state as `armedTarget`, "the id of the pointer target the held press
// armed, or `null`", and specs/instrumentation.md reports it.
//
// THE SCREEN STANDING IS THE DISCRIMINATING HALF. It is the third row of that
// table that takes a target — "Releases within the armed target" — so the press
// itself must take nothing. A build that acts on the press has a menu that works
// well enough under a mouse and gives a player no way to slide off a control they
// pressed by mistake; it leaves the title screen here, and fails this point and
// `targets/release-outside-takes-nothing` together, which is the pair that names
// the fault.
//
// THE HIGHLIGHT MOVING IS THE OTHER HALF, and it is asserted with the arming
// because specs/controls.md makes the press do both in one row. It is also what
// the model exists for: "The highlight moving on a press is what makes a
// touchscreen behave as a mouse does: a finger has no hover, so the press is what
// tells the player which item their release will take." A build that armed
// without highlighting leaves a player with a finger pressing blind.
//
// `menu-1` RATHER THAN `menu-0`, so the highlight has somewhere to move to: the
// title screen opens at `0`, and a press that armed correctly and moved nothing
// would be indistinguishable from a press on the item already highlighted.
//
// THE PRESS IS AT THE RECTANGLE THE BUILD REPORTED, at its center, which
// specs/instrumentation.md guarantees is inside the rectangle the game
// hit-tests — so the check asserts nothing at all about the build's layout.

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

afterEach(async () => {
  await h.dispose();
});

it("arms the pressed target and moves the highlight onto it, taking nothing", async () => {
  await h.debug.reset();
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen the press is made on");
  assertEqual(opened.menuIndex, 0, "the highlighted item before the press");
  assertEqual(opened.armedTarget, null, "the armed target before the press");

  const second = targetById(opened, WANTED);
  const armed = await pressTarget(h, second);

  // The frame that draws the item held under the press, and the picture of it.
  await h.advance(1);
  await captureStill(h, "armed");

  assertEqual(armed.armedTarget, WANTED, "the target the press armed");
  assertEqual(
    armed.menuIndex,
    WANTED_INDEX,
    "the highlighted item the press moved onto",
  );
  assertEqual(
    armed.screen,
    "title",
    "the screen, which the press arms rather than leaves",
  );
});
