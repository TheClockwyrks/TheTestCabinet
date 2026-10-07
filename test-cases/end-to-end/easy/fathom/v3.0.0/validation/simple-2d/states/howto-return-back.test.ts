// states/howto-return-back — `back` leaves the how-to screen.
//
// The other half of specs/ui.md's `"howto"` + `confirm` or `back` -> `"title"`
// row. The two are separate points so a build that wired only one route out fails
// exactly the one it missed: a player who reaches for Escape on a screen that
// only answers Enter is stuck on it.
//
// The screen is posed straight through `setScreen`, because reaching it is
// `states.howto-reachable`'s point. Nothing advances on `"howto"` or on
// `"title"` (specs/ui.md), so no bystander can move under the press.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key specs/movement.md binds `back` to. */
const KEY = BINDINGS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when back is pressed on the how-to screen", async () => {
  h.debug.setScreen("howto");
  assertEqual(h.snapshot().screen, "howto", "the screen the press is made on");

  await h.tap(KEY);
  // Before the assertion, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen `back` pressed on the how-to screen reaches (specs/ui.md)",
  );
});
