// Facet — targets/touch-takes-a-menu-item: a finger takes a menu item, and the
// game says it was a finger.
//
// specs/controls.md opens its pointer section with the sentence: "A mouse, a pen,
// and a finger on a touchscreen all drive the pointer, and the game reads them
// the same way. Everything the pointer does below is done by all three."
// specs/instrumentation.md gives the posed press and release a trailing
// `device` — "`mouse`, `pen`, or `touch`" — and says the three "drive the same
// input path a real pointer drives, so a posed touch and a posed mouse differ
// only in the `device` the state reports".
//
// SO IT IS `targets/release-takes-target`'s GESTURE, RUN AGAIN AS A FINGER: press
// and release at the reported `menu-0` target's center, both calls naming
// `touch`. `menu-0` is `PLAY`, so what the take does is read as the screen it
// reaches.
//
// A FINGER IS THE WHOLE REASON THE MODEL IS SHAPED THIS WAY. specs/controls.md
// says so where it explains the press: "The highlight moving on a press is what
// makes a touchscreen behave as a mouse does: a finger has no hover, so the press
// is what tells the player which item their release will take." A build whose
// menus answer a mouse and not a finger has missed the point of the arm-and-take
// model and is unusable on the device it was designed for — and no other point in
// this category can see that, because every one of them drives a mouse.
//
// BOTH HALVES ARE ASSERTED, because either alone passes a build that is wrong in
// the other direction: one that ignores touch takes nothing and stays on the
// title, and one that takes the item while reporting `mouse` has not read the
// device at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  takeTarget,
  targetById,
  type Harness,
} from "../harness";

/** The target the finger takes: the first title item, which specs/ui.md makes `PLAY`. */
const WANTED = "menu-0";

/** The device both calls of the gesture name. */
const FINGER = "touch";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the menu item with a finger, and reports the device as touch", async () => {
  h.debug.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen the gesture is made on");

  const first = targetById(opened, WANTED);
  const taken = takeTarget(h, first, FINGER);

  // The frame the round's first board is drawn on, and the picture of it.
  await h.advance(1);
  captureStill(h, "touch");

  // Half one: the item was taken.
  assertEqual(
    taken.screen,
    "playing",
    `the screen taking ${WANTED} with a finger reached, which is where PLAY leads`,
  );
  assertGreaterThan(
    taken.board.cells.length,
    0,
    "the cells of the board the round began on",
  );
  assertEqual(taken.armedTarget, null, "the armed target the release disarmed");

  // Half two: the game read what drove it.
  assertEqual(
    taken.pointer.device,
    FINGER,
    "the device the snapshot reports for the gesture that took the item",
  );
});
