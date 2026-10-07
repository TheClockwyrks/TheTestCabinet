// Wireworm — controls/pause-p-resumes: KeyP leaves the pause screen again.
//
// specs/controls.md gives the `pause` action both directions in one row: it
// "Pauses live play, opening the pause screen, and resumes play from that
// screen", and specs/ui.md says the same from the screens' side — "`back` and
// `pause` on this screen each do what `RESUME` does". So the key a player paused
// with is the key that unpauses, and this is that half.
//
// `controls/pause-p` DECIDES THE OTHER HALF, and the two are separate points
// because a build can wire the open and not the close: the pause menu it opens
// is then a menu `KeyP` cannot leave, and it must grade differently from one
// that wired neither.
//
// KeyP RATHER THAN Escape. `Escape` drives `back` as well, and `back` already
// resumes from this screen, so a build that never read `pause` on `paused` would
// still pass an Escape-driven check. `KeyP` drives nothing else, so what it
// resumes with is the `pause` action itself.
//
// THE PAUSE SCREEN IS POSED, not pressed into: `screens/pause-screen` and
// `controls/pause-p` decide the way in, and a build that cannot open the pause
// menu must not fail this point twice over. The worm posed before it is the
// board's marker — `specs/ui.md` has the resume hand back "the board and the run
// exactly as they were" — and its step is gated off with `setWormStepping`, so
// the tile it holds is a reading of the resume rather than of a step clock.
//
// THE KEY IS HELD FOR ONE FRAME rather than tapped between frames: one frame
// with the key down arms the edge AND raises the value for exactly one frame, so
// a build reading either sees exactly one press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  holdFor,
  poseWorm,
  resetTo,
  startPlaying,
  wormById,
  type Harness,
  type Tile,
  type WirewormSnapshot,
} from "../harness";

/** The posed worm's head tile, failing where the worm or its head is gone. */
function headTile(snapshot: WirewormSnapshot, id: number): Tile {
  const worm = wormById(snapshot, id);
  if (worm === undefined) {
    fail("the paused worm still on the board", "no worm carries its id");
  }
  const head = headOf(worm);
  if (head === undefined) {
    fail("the paused worm's head segment", "the worm carries no segments");
  }
  return head;
}

/** `pause`'s own first bound key; `KeyP` drives nothing else (specs/controls.md). */
const KEY = "KeyP";

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

it("returns the game to playing on KeyP from the pause screen", async () => {
  resetTo(h);
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
    `the screen ${KEY} moves the pause screen to (specs/controls.md, ` +
      "specs/ui.md)",
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
