// controls/pause-esc — Escape pauses a live dive.
//
// specs/movement.md binds the `pause` action to `Escape` and `KeyP` and gives it
// one job — "Pauses live play" — and it names `"playing"` as one of the screens
// that reads it. specs/ui.md's transition table states the same move: from
// `"playing"`, on "The pause control", to `"paused"`.
//
// `Escape` also drives `back`, and that is exactly why the reading is worth a
// point of its own: "Each screen reads the actions in its own row and leaves the
// rest alone, so one key does one thing on any given screen"
// (specs/movement.md). On `"playing"` the row holds `pause` and not `back`, so a
// build that routed the key to `back` here leaves live play for somewhere else
// and fails on the screen it landed on. `KeyP` is `controls/pause-p`'s.
//
// WHAT THIS DOES NOT DECIDE. What the paused screen SHOWS — the menu, its items,
// the frozen maze behind it — which is `states/paused`'s, and what `RESUME`,
// `RESTART` and `QUIT TO MENU` then do, which is that point's and the transition
// table's. This one asks only that the key moves the game there.
//
// THE SCENE IS SET FOR THE CAMERA. The point's evidence is a still, and Fathom
// draws only what the forager's light falls on, so a frame taken wherever a dive
// happens to open is a black rectangle with a speck in it. The forager is parked
// at the head of a posed corridor with its brightness turned right up, so the
// picture a reviewer gets is a lit pocket of maze with the pause menu over it.
//
// THE SCREEN IS READ A BEAT AFTER THE PRESS. A build may take the transition in
// the tick that delivers the key or at the top of the next, and both conform.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { poseStraightRun } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager } from "../scene";
import { BRIGHT_HOLD } from "../constants";

/** The first key specs/movement.md binds the `pause` action to. */
const KEY = "Escape";

/**
 * The corridor posed under the forager, in tiles.
 *
 * Long enough that the still reads as maze, and long enough that the forager —
 * which the poser rests on the run's first tile — stands well left of the middle
 * of the stage, so its lit pocket is not hidden behind whatever a build draws
 * over the centre of a paused screen. Nothing this point asserts reads the
 * corridor.
 */
const RUN_TILES = 26;

/**
 * Brightness posed for the picture alone.
 *
 * `G = 1` puts the light radius `V` at its widest, `160` units
 * (specs/sensing.md), so the still shows five tiles of corridor rather than
 * three. Nothing this point asserts reads brightness.
 */
const LIT = 1;

/**
 * Ticks between the press and the reading.
 *
 * A beat, not a measurement: `tap` runs the one tick that delivers the key, and
 * these follow it. Nothing advances on `"paused"` (specs/ui.md), so a conforming
 * build sits exactly where the transition left it however many of these run.
 */
const BEAT_TICKS = 4;

/** Ticks held on the pause menu, so the still is drawn from a settled frame. */
const HELD_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pauses a live dive on Escape", async () => {
  startPlaying(h);
  await poseStraightRun(h, RUN_TILES);
  await parkForager(h);
  h.debug.setBrightness(LIT);
  h.debug.setBrightHold(BRIGHT_HOLD);

  const live = h.snapshot();
  assertEqual(
    live.screen,
    "playing",
    "the dive is in live play before the key, which is the screen this point's " +
      "claim is about",
  );

  await h.tap(KEY);
  await h.advance(BEAT_TICKS);
  const pressed = h.snapshot();
  await h.advance(HELD_TICKS);
  // Before the assertions, so a check that fails still leaves the picture that
  // shows why.
  captureStill(h, "pause");

  assertEqual(
    pressed.lives,
    live.lives,
    "the forager was not caught mid-measurement, which would have moved the " +
      "screen for a reason that is not this key's",
  );
  assertEqual(
    pressed.screen,
    "paused",
    "the screen the pause control moves live play to (specs/ui.md)",
  );
});
