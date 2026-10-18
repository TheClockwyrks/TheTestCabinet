// Carom — controls-versus/p: pressing `P` during a Versus match pauses it.
//
// `KeyP` is bound to the runtime's `pause` action (specs/modes/versus.md).
//
// The match is opened through the debug surface and run up to live play — past
// the pre-serve hold, so what is paused is a match in flight rather than its
// countdown, which is the `gameplay/pause-during-countdown` item's separate
// point. The menus are the navigation checks' surface, not this item's: a build
// with a broken menu and a working pause must fail those checks, not this one.
// The posed opening takes NOTHING from the player — only `setPaddleDriven` takes
// a paddle, and nothing here calls it (specs/instrumentation.md) — so the pause
// key reaches the build exactly as it would in a match nobody posed. The key is
// pressed through Chromium's own input pipeline, so what reaches the build is a
// browser-trusted DOM key event on the real page rather than a synthetic one
// posed at the event target a runtime listens on, and the action is raised by the
// binding the case declares rather than by anything this check reaches into. The
// keyboard that reads it is the build's own — `specs/instrumentation.md` puts it
// in the runtime layer an engineless build supplies, and gives the surface no
// keyboard operation at all — so the whole path from a physical key to a paused
// match is exercised, which makes this check stronger here rather than weaker.
//
// THE FIELD HOLDS ONE BALL. What makes the paused match a match IN FLIGHT is a
// ball travelling, so the field is emptied and that one ball is posed crossing
// it at a speed and a place that keep it well short of either goal for the whole
// recorded stretch — a point scored mid-clip would return the game to a
// countdown and pause the wrong screen. The obstacles come off with it: a pause
// is about a key and a screen, and nothing on the field takes any part in one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FIELD_CX, FIELD_CY } from "../constants";
import {
  arrangeLiveBall,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/**
 * The ball the live match is played with: posed level, mid-field, travelling
 * left at a speed that covers under a fifth of the field in the recorded stretch
 * before the key goes down. Nothing it could reach can end the point early.
 */
const BALL = { x: FIELD_CX, y: FIELD_CY, vx: -420, vy: 0 };

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

afterEach(async () => {
  await h.dispose();
});

it("pauses a live Versus match when KeyP is pressed", async () => {
  await arrangeLiveBall(h, BALL, "versus");

  await captureReplay(h, "pause", async () => {
    await h.advance(LIVE_TICKS);
    assertEqual((await h.snapshot()).screen, "playing");

    await h.tap("KeyP");
    assertEqual((await h.snapshot()).screen, "paused");

    // And it stays paused: the press opened a screen, it did not blink one.
    await h.advance(PAUSED_TICKS);
  });
  assertEqual((await h.snapshot()).screen, "paused");
});
