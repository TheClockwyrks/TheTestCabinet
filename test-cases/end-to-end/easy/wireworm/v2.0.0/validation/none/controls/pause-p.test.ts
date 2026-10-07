// Wireworm — controls/pause-p: KeyP reaches the pause action.
//
// specs/controls.md binds `pause` to `KeyP` and `Escape`, states that `pause`
// "pauses live play, opening the pause screen", and reads it as a press edge,
// "once per press". specs/ui.md names the screen it opens: `paused`, "reached by
// `pause` during live play".
//
// THIS POINT IS ABOUT THE KEY, not about the screen it opens. What the pause
// screen SHOWS is `screens.pause-screen`'s reading, that the board behind it
// stops is the four `screens.pause-freezes-*` points', and what each of its
// three items does belongs to `screens.pause-resume`, `screens.pause-restart`
// and `screens.pause-quit`. So the one thing read here is where the game stands
// after the press.
//
// `KeyP` AND `Escape` ARE SEPARATE POINTS because a build can bind one and not the
// other, and `Escape` carries a second action — specs/controls.md gives it `back`
// as well — so a build that resolved the two the wrong way round answers on `KeyP`
// and not on `Escape`. `controls.pause-escape` reads that half.
//
// THE PRESS IS ONE FRAME LONG. `Harness.tap` puts the key down, runs exactly one
// frame, and lifts it, which is the shape a press edge is seen in however the
// build reads its keyboard. One more frame runs afterwards, so a build that opens
// the screen at the top of the update following the press is read fairly.
//
// THE WORLD IS AN EMPTY LIVE BOARD. `startPlaying` empties the four rosters and
// shuts the three world gates, so nothing on the board can end the level, cost a
// life or move the game off `playing` on its own: the only thing that can change
// the screen is the key under test.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this point is about, the first of the two `pause` is bound to. */
const KEY = "KeyP";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the game on the pause screen when KeyP is pressed during play", async () => {
  await startPlaying(h);
  await h.advance(1);

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "paused");

  assertEqual(
    after.screen,
    "paused",
    "the screen a KeyP press during live play leaves the game on",
  );
});
