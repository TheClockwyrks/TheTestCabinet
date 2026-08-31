// screens/start-begins-session — confirming START begins a fresh session.
//
// specs/screens.md, on `title`: "`confirm` on `START` starts a fresh session
// and sets `screen` to `playing`, with wave 1 laid out as `specs/rings.md`
// states and a ball parked on the deflector as `specs/deflector-and-ball.md`
// states." A fresh session's figures are the boot figures specs/instrumentation.md
// fixes: score `0`, `3` lives, wave `1`.
//
// START is entry `0`, highlighted at boot, so the one key pressed is the
// `confirm` edge itself — `Enter`, deliberately, since `Space` also carries
// `launch` and this point is about which screen confirm sets, not which key.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS, START_LIVES } from "../constants";
import { captureStill, openHarness, tap, type Harness } from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = KEYS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirm on START enters playing as a fresh session", async () => {
  h.reset();
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen confirm is pressed on");
  assertEqual(posed.menu.index, 0, "the highlighted entry, START");

  await tap(h, CONFIRM);
  captureStill(h, "fresh-session");

  const after = h.snapshot();
  assertEqual(after.screen, "playing", "the screen confirm on START set");
  assertEqual(after.wave, 1, "the fresh session's wave");
  assertEqual(after.score, 0, "the fresh session's score");
  assertEqual(after.lives, START_LIVES, "the fresh session's lives");
  assertEqual(after.balls.length, 1, "the balls a fresh session holds");
  assertEqual(
    after.balls[0]?.parked,
    true,
    "the one ball is parked on the deflector",
  );
});
