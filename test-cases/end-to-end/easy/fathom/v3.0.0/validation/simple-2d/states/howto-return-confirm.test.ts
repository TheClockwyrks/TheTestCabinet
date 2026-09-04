// states/howto-return-confirm — `confirm` leaves the how-to screen.
//
// specs/ui.md's transition table gives `"howto"` two ways out — `confirm` and
// `back` — and they are two points because a build that wired only one of them
// must fail exactly the one it missed. An item covering both would score the same
// for a build with one route out as for a build with neither, and a player who
// only ever presses Enter would be stuck on a screen a `back`-only build never
// leaves.
//
// The screen is posed straight through `setScreen`, because reaching it is
// `states.howto-reachable`'s point. Nothing advances on `"howto"` or on
// `"title"` (specs/ui.md), so no bystander can move under the press.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key specs/movement.md binds `confirm` to first. */
const KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when confirm is pressed on the how-to screen", async () => {
  h.debug.setScreen("howto");
  assertEqual(h.snapshot().screen, "howto", "the screen the press is made on");

  await h.tap(KEY);
  // Before the assertion, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen `confirm` pressed on the how-to screen reaches (specs/ui.md)",
  );
});
