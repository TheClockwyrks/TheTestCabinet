// controls/space-pulses-not-confirms — Space fires the sonar in play and
// confirms nothing.
//
// The other half of specs/movement.md's `Space` boundary: its "Where each action
// is read" table gives `"playing"` `a` and not `confirm`. So the same key that
// takes a menu item on a menu spends the pulse in live play, and the `confirm` it
// also raises reaches no menu and opens no screen.
//
// BOTH HALVES ARE READ ON THE ONE PRESS. The pulse in flight says the press did
// its job; the screen read again a stretch later says the `confirm` the same
// press raised did nothing. A build that acted on both would have left live play,
// and would pass an item that only looked at the pulse.
//
// THE WORLD IS POSED DOWN TO ONE CORRIDOR. `poseStraightRun` empties the board of
// every predator, drifter and plankton before placing the forager, so nothing on
// it can end live play under the watch: what the screen reads a stretch later is
// the press's own doing.
//
// The cooldown is posed to `0` before the press, so the pulse is available to be
// spent (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import { BINDINGS, TICK_HZ } from "../constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `a` AND `confirm` to. */
const KEY = BINDINGS.a[0];

/** How much corridor the pulse is cast down, in tiles. */
const RUN_TILES = 14;

/**
 * How long live play is watched after the press, in ticks.
 *
 * One second. Long enough that a build which acted on the `confirm` a frame or
 * two later has shown it, and long enough for the wavefront to be worth watching.
 */
const WATCH_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts a pulse in flight on Space and stays in live play", async () => {
  await startPlaying(h);
  await poseStraightRun(h, RUN_TILES);
  await h.debug.setSonarCooldown(0);
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the press is made on");
  assertEqual(
    before.sonar.ready,
    true,
    "the pulse is ready before the press (specs/instrumentation.md)",
  );

  const watched = await captureReplay(h, "pulsed", async () => {
    await h.tap(KEY);
    const fired = await h.snapshot();
    await h.advance(WATCH_TICKS);
    return { fired, settled: await h.snapshot() };
  });

  assertGreaterThan(
    watched.fired.pulses.length,
    0,
    `wavefronts in flight after ${KEY} was pressed in live play, where ` +
      "specs/movement.md has the screen read `a`",
  );
  assertEqual(
    watched.fired.screen,
    "playing",
    `the screen on the step ${KEY} was pressed in live play, where ` +
      "specs/movement.md has the screen read `a` and not `confirm`",
  );
  assertEqual(
    watched.settled.screen,
    "playing",
    `the screen ${String(WATCH_TICKS)} ticks after that press, with nothing ` +
      "further pressed (specs/movement.md)",
  );
});
