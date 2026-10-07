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
// so the tiles it holds are a reading of the resume rather than of a step clock.
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
import { BACK_KEY } from "./screens";

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

it("returns the game to playing when the back binding is pressed on the pause screen", async () => {
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

  await h.tap(BACK_KEY);
  await h.advance(1);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "the screen the back binding leaves the pause screen for (specs/ui.md)",
  );
  assertDeepEqual(
    requireWorm(resumed, wormId).segments,
    atPause.segments,
    "the worm's tiles after the resume",
  );
});
