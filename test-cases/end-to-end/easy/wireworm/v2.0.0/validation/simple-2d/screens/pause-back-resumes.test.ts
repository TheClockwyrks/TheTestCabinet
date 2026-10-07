// Wireworm — screens/pause-back-resumes: the back binding leaves the pause
// screen again.
//
// specs/ui.md's `paused` screen: "`back` and `pause` on this screen each do what
// `RESUME` does. They are read before the menu edges, and a frame carrying
// either resumes and does nothing else." `back` is bound to `Escape`
// (specs/controls.md), which also drives `pause`, and that file resolves the
// collision in as many words: "a single `Escape` press on `paused` resumes
// once".
//
// THIS IS THE `back` HALF, and it is the exit a player reaches for most often,
// since `Escape` is what opened the menu. `screens/pause-resume` decides the
// `RESUME` item and `controls/pause-p-resumes` decides the `pause` action's own
// key; the three are separate points because a build can wire any one of them
// and leave the others dead.
//
// THE PAUSE SCREEN IS POSED, not pressed into: `screens/pause-screen` and
// `controls/pause-escape` decide the way in, and a build that cannot open the
// pause menu must not fail this point twice over. The worm posed before it is
// the board's marker — `specs/ui.md` has a resume hand back "the board and the
// run exactly as they were" — and its step is gated off with `setWormStepping`,
// so the tile it holds is a reading of the resume rather than of a step clock.
//
// THE KEY IS HELD FOR ONE FRAME rather than tapped between frames: one frame
// with the key down arms the edge AND raises the value for exactly one frame, so
// a build reading either sees exactly one press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  holdFor,
  poseWorm,
  startPlaying,
  wormOf,
  type Harness,
  type TileSnapshot,
  type WirewormSnapshot,
} from "../harness";

/** The posed worm's head tile. */
function headTile(snapshot: WirewormSnapshot, id: number): TileSnapshot {
  return headOf(wormOf(snapshot, id));
}

/** `back`'s own bound key (specs/controls.md). */
const KEY = "Escape";

/** Frames the key is down: one, which is one press. */
const PRESS_TICKS = 1;

/**
 * Frames between the press and the reading.
 *
 * A beat, not a measurement: a build may take the transition in the frame that
 * delivers the key or at the top of the next, and both conform.
 */
const BEAT_TICKS = 4;

/** The worm posed as the board's marker: clear of every edge. */
const WORM_C = 12;
const WORM_R = 7;
const WORM_LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the game to playing on the back binding from the pause screen", async () => {
  startPlaying(h);
  const worm = poseWorm(h, WORM_C, WORM_R, WORM_LENGTH);
  h.debug.setWormStepping(worm, false);
  h.debug.setScreen("paused");
  assertEqual(
    h.snapshot().screen,
    "paused",
    "setScreen poses the pause screen (specs/instrumentation.md)",
  );
  const pausedOn = headTile(h.snapshot(), worm);

  await holdFor(h, KEY, PRESS_TICKS);
  await h.advance(BEAT_TICKS);
  const resumed = h.snapshot();
  captureStill(h, "resumed");

  assertEqual(
    resumed.screen,
    "playing",
    `the screen ${KEY} moves the pause screen to (specs/ui.md)`,
  );
  const resumedOn = headTile(resumed, worm);
  assertEqual(
    resumedOn.c,
    pausedOn.c,
    "the resumed worm's head is in the column it was paused in (specs/ui.md)",
  );
  assertEqual(
    resumedOn.r,
    pausedOn.r,
    "the resumed worm's head is on the row it was paused on (specs/ui.md)",
  );
});
