// screens/howto-confirm-returns — confirming on the how-to screen returns to the
// title.
//
// THE RULE. `specs/ui.md`, on `howto`: the screen "shows no menu of its own", and
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
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` reaches the scenario
// directly, so what is graded is the way OFF the screen and not the way onto it,
// which is `screens/howto-reachable`'s point.
//
// WHAT THIS ITEM DOES NOT DECIDE. Which keys raise `confirm`
// (`controls/confirm-enter`, `controls/confirm-space`), that `back` leaves the
// screen too (`screens/howto-returns`), which entry the return highlights
// (`screens/howto-returns-to-its-entry`), or what the how-to draws
// (`screens/howto-shows-the-controls`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when the how-to screen is confirmed", async () => {
  h.debug.reset();
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen the confirm press was made on",
  );

  await tapAction(h, "confirm");
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen confirming on the how-to returns to (specs/ui.md)",
  );
});
