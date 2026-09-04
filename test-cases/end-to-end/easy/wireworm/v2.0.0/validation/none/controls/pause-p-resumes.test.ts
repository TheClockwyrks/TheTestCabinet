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
// board's marker — `specs/ui.md` has RESUME hand back "the board and the run
// exactly as they were" — and its step is gated off with `setWormStepping`, so
// the tile it holds is a reading of the resume rather than of a step clock.
//
// THE WORLD IS AN EMPTY LIVE BOARD but for that worm. `startPlaying` shuts the
// three world gates, so nothing can move the screen for a reason that is not the
// key under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  requireWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** `pause`'s own first bound key; `KeyP` drives nothing else (specs/controls.md). */
const KEY = "KeyP";

/** The worm posed as the board's marker: clear of every edge. */
const WORM_C = 12;
const WORM_R = 7;
const WORM_LENGTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns the game to playing when KeyP is pressed on the pause screen", async () => {
  await startPlaying(h);
  const wormId = await poseWorm(h, {
    c: WORM_C,
    r: WORM_R,
    length: WORM_LENGTH,
    stepping: false,
  });
  await h.debug.setScreen("paused");
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "setScreen poses the pause screen (specs/instrumentation.md)",
  );
  const atPause = requireWorm(await h.snapshot(), wormId);

  await h.tap(KEY);
  await h.advance(1);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen a KeyP press on the pause screen leaves the game on",
  );
  assertDeepEqual(
    requireWorm(resumed, wormId).segments,
    atPause.segments,
    "the worm's tiles after the resume",
  );
});
