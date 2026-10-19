// Carom — controls-versus/p: pressing `P` during a Versus match pauses it.
//
// `KeyP` is bound to the runtime's `pause` action (specs/modes/versus.md).
//
// The match is posed straight into live play — past the pre-serve hold, so what
// is paused is a match in flight rather than its countdown, which is the
// `gameplay/pause-during-countdown` item's separate point. The menus are the
// navigation checks' surface, not this item's: a build with a broken menu and a
// working pause must fail those checks, not this one. Nothing is taken from the
// player — neither paddle is driven — so the pause key reaches the build exactly
// as it does in a match nobody posed. The key event is dispatched at the target
// the runtime listens on, so the action is raised by the binding the case
// declares rather than by anything this check reaches into.
//
// The field holds one ball and nothing else: both obstacles are removed, and the
// ball is aimed level down the mid-field lane so the rally recorded before the
// press is a ball simply crossing an empty court. What is under test is a key
// press, and a bounce off anything would only be something else for a reviewer to
// wonder about.

import { afterEach, beforeEach, it } from "vitest";
import { SERVE_SPEED } from "../constants";
import { assertEqual } from "../assert";
import {
  aimBall,
  captureReplay,
  createHarness,
  enterPlaying,
  poseWorld,
  type Harness,
} from "../harness";

/**
 * The stretch of live rally recorded before the key goes down.
 *
 * The clip opens on a match IN MOTION: this point is about the transition into
 * the pause, and a recording that began at the key press would hold nothing but
 * the screen it ended on.
 */
const LIVE_TICKS = 48; // 0.4 s

/** Frames held after the press, long enough that a blink would show. */
const PAUSED_TICKS = 84; // 0.7 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pauses a live Versus match when KeyP is pressed", async () => {
  enterPlaying(h, "versus");
  poseWorld(h);
  aimBall(h, -SERVE_SPEED, 0);

  await captureReplay(h, "pause", async () => {
    await h.advance(LIVE_TICKS);
    assertEqual(h.snapshot().screen, "playing");

    await h.tap("KeyP");
    assertEqual(h.snapshot().screen, "paused");

    // And it stays paused: the press opened a screen, it did not blink one.
    await h.advance(PAUSED_TICKS);
  });
  assertEqual(h.snapshot().screen, "paused");
});
