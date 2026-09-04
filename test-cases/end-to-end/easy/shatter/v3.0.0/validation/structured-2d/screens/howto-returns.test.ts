// screens/howto-returns — leaving the how-to screen returns to the title.
//
// `specs/ui.md`, on the `howto` screen: "Confirming leaves the screen as leaving
// it does, and both return to `title`."
// `specs/controls.md` says what leaving is — the `back` action, whose meaning on
// a screen showing no live play is "Leave the screen" — and reads it as a press
// edge, "once per press".
//
// THE SCREEN IS POSED DIRECTLY. `setScreen("howto")` is the operation
// `specs/instrumentation.md` provides for exactly this, and it "spawns nothing
// and clears nothing". Walking in through the title menu instead would fold
// `screens/howto-reachable`'s requirement into this one, so a build that could
// not OPEN the how-to screen would lose this point as well as that one.
//
// THE ACTION IS DRIVEN, NOT THE KEY, because which key leaves a screen is
// `controls/back-escape`'s point. What is under this one is where leaving GOES.
//
// AND THE RETURN IS THE PRESS'S DOING. A quarter second runs on the how-to
// screen with nothing down and the screen is read at the end of it, so a build
// whose how-to screen times out on its own — which would pass a check that read
// only the screen after the press — is caught before the press is taken.
//
// WHAT THIS DOES NOT DECIDE. That the how-to screen is reachable
// (`screens/howto-reachable`), what it says
// (`screens/howto-shows-the-controls`), and which key leaves it
// (`controls/back-escape`).

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

it("returns to the title when back is pressed on the howto screen", async () => {
  // The how-to screen, posed directly.
  resetTo(h);
  h.debug.setScreen("howto");

  await h.advance(QUIET_TICKS);
  const before = h.snapshot().screen;

  await tapAction(h, "back");
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
    "the screen on the tick back was pressed on the howto screen — leaving " +
      "the how-to screen returns to title (specs/ui.md)",
  );
});
