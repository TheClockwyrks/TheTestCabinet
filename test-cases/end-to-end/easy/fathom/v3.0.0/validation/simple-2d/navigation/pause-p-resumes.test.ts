// navigation/pause-p-resumes — KeyP resumes a paused dive, as Escape does.
//
// specs/movement.md binds `pause` to `Escape` AND to `KeyP`, and specs/ui.md
// gives `"paused"` + the pause control -> `"playing"`. So the key that opened the
// pause menu closes it again, and this point is that round trip: a build that
// wired `KeyP` only on the way in leaves a player who paused with `KeyP` unable
// to resume with it.
//
// THE DIVE IS PAUSED WITH THE SAME KEY, which is what makes the round trip
// readable: the screen is `"paused"` because `KeyP` put it there, and `"playing"`
// again because `KeyP` took it back. That `KeyP` pauses at all is
// `controls.pause-p`'s point; what this adds is the second half.
//
// The dive is opened through the surface rather than through the title menu, so a
// build with a broken menu fails the menu points and passes this one. The roster
// is still in the den and unreleased at the top of live play, so nothing can
// reach the forager inside the two frames driven here.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The second key specs/movement.md binds `pause` to. */
const KEY = BINDINGS.pause[1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the pause menu with the key that opened it", async () => {
  await startPlaying(h);
  // The board is emptied of hunters: what this decides is a screen, and a
  // release that came early would end the dive under the reading
  // (specs/instrumentation.md).
  h.debug.clearPredators();

  await h.tap(KEY);
  const paused = h.snapshot();

  await h.tap(KEY);
  const resumed = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "resumed");

  assertEqual(
    paused.screen,
    "paused",
    `the screen ${KEY} opens from live play (specs/ui.md)`,
  );
  assertEqual(
    resumed.screen,
    "playing",
    `the screen ${KEY} reaches from the pause menu, which is the same key ` +
      "closing what it opened (specs/ui.md)",
  );
});
