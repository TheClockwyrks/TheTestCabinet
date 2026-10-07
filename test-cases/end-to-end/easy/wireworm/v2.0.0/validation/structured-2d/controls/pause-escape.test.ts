// controls/pause-escape — `Escape` pauses live play.
//
// specs/controls.md binds the `pause` action to `KeyP` and `Escape` and gives it
// one effect — "Pauses live play, opening the pause screen" — and reads it as a
// press edge, "once per press". specs/ui.md states the same move from the
// screens' side: `paused` is "Reached by `pause` during live play". So: pose
// live play, press the key once, and read the screen.
//
// `Escape` DRIVES TWO ACTIONS, and this is the pause half. specs/controls.md
// binds it to both `pause` and `back`, and settles which applies where: "`Escape`
// pauses while the game is being played and leaves the screen otherwise." Live
// play is the screen where it pauses, and that is the only screen this point
// presses it on; what it does elsewhere is screens/howto-back's.
//
// It is also the SECOND of the two keys the `pause` row binds. `KeyP` is
// controls/pause-p's, and the two are separate points because a build that wired
// one and not the other must grade differently from one that wired neither.
//
// WHAT THIS DOES NOT DECIDE. What the paused screen SHOWS — its three items over
// the board — which is screens/pause-screen's; that the board FREEZES behind it,
// which is the four screens/pause-freezes-* points'; and what `RESUME`,
// `RESTART` and `QUIT TO MENU` then do, which are screens/pause-resume's,
// screens/pause-restart's and screens/pause-quit's. This point asks only that
// the key moves the game there.
//
// THE KEY IS HELD FOR ONE FRAME rather than tapped between frames. The engine
// reports an action's press edge and its held value, and a build may read either
// (specs/controls.md names `pause` an edge, and a build that reads the value
// once per frame reaches the same screen from one frame of it): one frame with
// the key down arms the edge AND raises the value for exactly one frame, so both
// readings pause exactly once.
//
// THE SCREEN IS READ A BEAT AFTER THE PRESS, because a build may take the
// transition in the frame that delivers the key or at the top of the next, and
// both conform.
//
// THE WORLD IS EMPTY AND QUIET. `startPlaying` clears every node, worm, foe and
// bolt and shuts the three world gates, so nothing on the board can move the
// screen for a reason that is not this key's — no worm reaches the band, no foe
// arrives, and no contact costs the life that would open a respawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The second key specs/controls.md binds the `pause` action to. */
const KEY = "Escape";

/** Frames the key is down: one, which is one press. */
const PRESS_TICKS = 1;

/**
 * Frames between the press and the reading.
 *
 * A beat, not a measurement: `holdFor` runs the frame that delivers the key, and
 * these follow it so a build that takes the transition at the top of the next
 * frame reads the same as one that takes it in the frame itself. Nothing
 * advances on `paused` (specs/ui.md), so a conforming build sits exactly where
 * the transition left it however many of these run.
 */
const BEAT_TICKS = 4;

/** Frames held on the pause screen, so the still is drawn from a settled frame. */
const SETTLE_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pauses live play on Escape", async () => {
  startPlaying(h);

  const live = h.snapshot();
  await holdFor(h, KEY, PRESS_TICKS);
  await h.advance(BEAT_TICKS);
  const pressed = h.snapshot();
  await h.advance(SETTLE_TICKS);
  // Before the assertions, so a check that fails still leaves the picture of
  // the screen the key actually opened.
  captureStill(h, "paused");

  assertEqual(
    live.screen,
    "playing",
    "the game is in live play before the key, which is the screen this " +
      "point's claim is about (specs/ui.md)",
  );
  assertEqual(
    pressed.screen,
    "paused",
    `the screen ${KEY} moves live play to (specs/controls.md, specs/ui.md)`,
  );
});
