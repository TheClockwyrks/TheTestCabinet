// Meltdown — controls/pause-key: KeyP opens the pause screen from live play, and
// closes it again.
//
// specs/controls.md binds `pause` to `KeyP` and gives it the effect "Opens the
// pause screen from live play, and returns to play from it." specs/screens.md
// names the two screens: `playing`, "The floor and the build panel", and `paused`,
// "The pause menu, over the frozen floor". specs/instrumentation.md reports which
// one the game is on as `screen`.
//
// BOTH DIRECTIONS, BECAUSE THE ACTION IS ONE TOGGLE. specs/controls.md gives
// `pause` a single row covering both, and the failure the second press catches is
// a real and common one: a build that opens the pause screen and leaves the player
// stranded there, with the key that got them in doing nothing to get them out.
// That is why this point caps at `broken` — a run that cannot be resumed is a run
// that cannot be finished. The item's own description names both halves.
//
// THIS POINT IS ABOUT THE KEY, NOT ABOUT THE FREEZE. That the floor actually stops
// while the screen is `paused` is `waves.pause-freezes-the-floor`, and it is
// measured there ON THE BUILD'S OWN CLOCK, because "the simulation does not
// advance" (specs/waves.md) is a claim about the clock the player's game runs on
// and not about where a build put its gate. Nothing here reads motion, so nothing
// here needs that clock: `screen` is a field, and a field is read the same way
// whoever is driving. What the pause screen DRAWS is `screens.pause-screen`, and
// what its three rows do belongs to `screens.pause-resume`,
// `screens.pause-restart` and `screens.pause-quit`.
//
// `Escape` IS A SEPARATE POINT. specs/controls.md gives `Escape` the `back` action,
// whose own resolution order reaches the pause screen only as its third case, so a
// build can answer one key and not the other and can resolve `back` in the wrong
// order while `KeyP` works perfectly. `controls.esc-pauses` reads that half.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN, with nothing armed and nothing selected.
// `startRun` empties both rosters and shuts the world gate, so no leak, no wave
// clear and no arriving unit can move the screen on its own: the only thing that
// can change it is the key under test.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds `pause` to, and the only one. */
const KEY = BINDINGS.pause;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the pause screen on a KeyP press and returns to play on the next", async () => {
  await startRun(h);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen the scenario is posed on",
  );

  await h.tap(KEY);
  await h.advance(1);
  const once = (await h.snapshot()).screen;
  await captureStill(h, "paused");

  await h.tap(KEY);
  await h.advance(1);
  const twice = (await h.snapshot()).screen;

  assertEqual(
    once,
    "paused",
    `${KEY}: the screen one press from live play leaves the game on`,
  );
  assertEqual(
    twice,
    "playing",
    `${KEY}: the screen a second press leaves the game on, from paused`,
  );
});
