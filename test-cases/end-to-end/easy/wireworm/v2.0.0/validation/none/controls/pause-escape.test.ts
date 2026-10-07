// Wireworm — controls/pause-escape: Escape reaches the pause action during play.
//
// specs/controls.md binds `pause` to `KeyP` and `Escape`, states that `pause`
// "pauses live play, opening the pause screen", and reads it as a press edge,
// "once per press". specs/ui.md names the screen it opens: `paused`, "reached by
// `pause` during live play".
//
// ESCAPE IS THE KEY THAT CARRIES TWO ACTIONS. specs/controls.md binds it to both
// `back` and `pause` and settles the ambiguity by screen: "`Escape` pauses while
// the game is being played and leaves the screen otherwise". This point is the
// pause half, read from live play, where the specification says pause is what it
// means; the `back` half is read on the screens that have somewhere to go back to
// (`screens.howto-back`). A build that resolved the two the wrong way round
// answers `KeyP` and fails here, which is exactly the distinction the two pause
// points exist to draw.
//
// THIS POINT IS ABOUT THE KEY, not about the screen it opens. What the pause
// screen SHOWS is `screens.pause-screen`'s reading, that the board behind it
// stops is the four `screens.pause-freezes-*` points', and what its three items
// do belongs to the three `screens.pause-*` points. So the one thing read here
// is where the game stands after the press.
//
// THE PRESS IS ONE FRAME LONG. `Harness.tap` puts the key down, runs exactly one
// frame, and lifts it, which is the shape a press edge is seen in however the
// build reads its keyboard. One more frame runs afterwards, so a build that opens
// the screen at the top of the update following the press is read fairly.
//
// THE WORLD IS AN EMPTY LIVE BOARD. `startPlaying` empties the four rosters and
// shuts the three world gates, so nothing on the board can end the level, cost a
// life or move the game off `playing` on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this point is about, the second of the two `pause` is bound to. */
const KEY = "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the game on the pause screen when Escape is pressed during play", async () => {
  await startPlaying(h);
  await h.advance(1);

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "paused");

  assertEqual(
    after.screen,
    "paused",
    "the screen an Escape press during live play leaves the game on",
  );
});
