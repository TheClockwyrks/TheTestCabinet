// screens/howto-confirm-returns — confirming on the how-to screen returns to the
// title.
//
// `specs/ui.md`, on `howto`: the screen "shows no menu of its own", and
// "Confirming leaves the screen as leaving it does, and both return to `title`".
// `specs/controls.md` gives `confirm` the meaning "Confirm the selection" on a
// menu screen and reads it as a press edge, "once per press".
//
// WHY IT IS A SEPARATE ITEM FROM `screens/howto-returns`. Confirming and leaving
// are two actions reaching one destination, wired in two places in a build.
// `howto` is the one screen with no entries to confirm, so it is exactly the
// screen a build is likeliest to leave with a dead confirm — and a player who
// finishes reading and presses the key every other screen accepts with is then
// stuck. One item for both would let a build lose two points, or none, for one
// mistake.
//
// THE SCREEN IS POSED DIRECTLY, so what is graded is the way OFF the screen and
// not the way onto it, which is `screens/howto-reachable`'s point.
//
// AND THE RETURN IS THE PRESS'S DOING. A quarter second runs on the how-to screen
// with nothing down and the screen is read at the end of it, so a build whose
// how-to screen times out on its own is caught before the press.
//
// WHAT THIS DOES NOT DECIDE. Which keys raise `confirm`
// (`controls/confirm-enter`, `controls/confirm-space`), that `back` leaves the
// screen too (`screens/howto-returns`), which entry the return highlights
// (`screens/howto-returns-to-its-entry`), or what the how-to says
// (`screens/howto-shows-the-controls`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The quiet stretch driven on the how-to screen before the press, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when confirm is pressed on the howto screen", async () => {
  resetTo(h);
  h.debug.setScreen("howto");

  await h.advance(QUIET_TICKS);
  const before = h.snapshot().screen;

  await tapAction(h, "confirm");
  const after = h.snapshot().screen;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "title");

  assertEqual(
    before,
    "howto",
    `the screen after ${String(QUIET_TICKS)} ticks on the posed howto screen ` +
      "with no key down — a screen is left on a press, not on a timer " +
      "(specs/ui.md, specs/controls.md)",
  );
  assertEqual(
    after,
    "title",
    "the screen on the tick confirm was pressed on the howto screen — " +
      "confirming leaves it as leaving it does (specs/ui.md)",
  );
});
