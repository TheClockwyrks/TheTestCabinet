// navigation/pause-back — Escape resumes a paused dive, and once only.
//
// specs/ui.md's transition table gives `"paused"` + `back` -> `"playing"`, and
// the paragraph under it says how that is read: "`Escape` raises `back` and
// `pause` together on one frame, so `"paused"` reads `pause` and `back` before
// the menu's own edges, and a frame carrying either resumes once and does
// nothing else."
//
// SO THE POINT HAS TWO HALVES, and the second is the one a build fails. A build
// that read `back` to resume and then read `pause` on the same frame to open the
// menu again lands back on `"paused"`, and a build that resumed and then let the
// menu's own edges run acts on an item nobody chose. Both are caught by reading
// the screen ON the step the press lands and again a stretch later with nothing
// pressed in between.
//
// The pause menu is reached through `setScreen`, because opening it is
// `controls.pause-esc`'s point rather than this one's. Nothing advances on
// `"paused"` (specs/ui.md), so no bystander can move under the press, and the
// board is emptied of hunters first, so nothing can reach the forager inside the
// window the steps after it run in either.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `back` to. */
const KEY = BINDINGS.back[0];

/**
 * How long the dive is watched after the press, in ticks.
 *
 * Half a second. Long enough that a build which pauses again on a later frame —
 * a second edge read from the one press — has shown it, and short enough that the
 * den's first release (`DEN_RELEASE_GAP`, `5 s`) is still far off.
 */
const SETTLE_TICKS = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the dive on one Escape and leaves it running", async () => {
  await startPlaying(h);
  // The board is emptied of hunters: what this decides is a screen, and a
  // release that came early would end the dive under the reading
  // (specs/instrumentation.md).
  h.debug.clearPredators();
  h.debug.setScreen("paused");
  assertEqual(h.snapshot().screen, "paused", "the screen the press is made on");

  await h.tap(KEY);
  const resumed = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "resumed");

  await h.advance(SETTLE_TICKS);
  const settled = h.snapshot();

  assertEqual(
    resumed.screen,
    "playing",
    "the screen Escape pressed on the pause menu reaches (specs/ui.md)",
  );
  assertEqual(
    settled.screen,
    "playing",
    `the screen ${String(SETTLE_TICKS)} ticks after that one press, with ` +
      "nothing further pressed — a frame carrying either of the two actions " +
      "Escape raises resumes ONCE and does nothing else (specs/ui.md)",
  );
});
