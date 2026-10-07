// controls/escape-pauses-once — one Escape opens the pause menu and leaves it
// open.
//
// specs/movement.md binds `Escape` to TWO actions, `back` and `pause`, and
// settles them by screen: its "Where each action is read" table gives
// `"playing"` `pause` and not `back`. specs/ui.md says what follows in as many
// words — "A single `Escape` press on `"playing"` therefore opens the pause menu
// and leaves it open".
//
// SO THE POINT IS THE SECOND READING, and it is the one a build fails. A build
// that opened the menu and then read `back` on the same frame lands back in live
// play, and one that read the two on consecutive frames flickers through the
// menu; either way the player who pressed Escape gets no pause. Reading the
// screen ON the step the press lands and again a stretch later, with nothing
// pressed in between, is what separates that from a build that paused and stayed
// paused.
//
// THAT `Escape` PAUSES AT ALL is `controls.pause-esc`'s point, and this one does
// not assert it again: the reading here is the screen a STRETCH after the press,
// so what it decides is that the pause stayed. A build with no Escape pause at
// all fails `controls.pause-esc` and is failed here too, because the state this
// point reads is one it could not reach — but the requirement each verdict names
// is its own. Escape RESUMING a paused dive is `navigation.pause-back`.
//
// Nothing advances on `"paused"` (specs/ui.md), so once the menu is open no
// bystander can move under the watch, and the board is emptied of hunters before
// the press, so nothing can reach the forager before it.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `back` AND `pause` to. */
const KEY = BINDINGS.back[0];

/**
 * How long the paused dive is watched after the press, in ticks.
 *
 * One second, which is far longer than any frame a build could read the second
 * of the two edges on.
 */
const SETTLE_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the pause menu on one Escape and leaves it open", async () => {
  await startPlaying(h);
  // The board is emptied of hunters: what this decides is a screen, and a
  // release that came early would end the dive under the reading
  // (specs/instrumentation.md).
  await h.debug.clearPredators();
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen the press is made on",
  );

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  const settled = await h.snapshot();
  // Before the assertion, so a failing check still leaves the screen it read.
  await captureStill(h, "paused");

  assertEqual(
    settled.screen,
    "paused",
    `the screen ${String(SETTLE_TICKS)} ticks after that one press, with ` +
      "nothing further pressed — a single Escape on live play opens the pause " +
      "menu and leaves it open (specs/ui.md)",
  );
});
