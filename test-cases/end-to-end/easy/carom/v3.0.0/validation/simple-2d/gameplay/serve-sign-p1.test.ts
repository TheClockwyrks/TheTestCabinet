// gameplay/serve-sign-p1 — the serve's vertical sign is drawn afresh on every serve
// toward player one.
//
// specs/balls.md: the serve leaves at `SERVE_SPEED` at `SERVE_ANGLE` (12
// degrees) from horizontal, `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)`, and `s`
// is drawn from the seeded generator on every serve with `+1` and `-1` each
// equally likely. One serve cannot show a draw — any one serve has some sign —
// so a run of them is read: a fresh match is opened, whose first serve is toward
// player one;
// the hold is cut short, the launch frame is read, and `serve()` is called
// again from the live rally, which re-parks the ball and reopens the countdown
// without touching `receiver`, so every serve of the run is toward the same
// player. Each launch is held to the serve itself (toward player one,
// at the serve angle), and the run as a whole to the draw: both signs appear.
//
// The bar is deliberately the one a fixed sign cannot clear and a draw cannot
// miss: sixteen serves all of one sign come up one time in 32,768 from a fair
// draw. A build that always serves upward, or always downward, fails it every
// time.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { SERVE_ANGLE } from "../../src/constants";
import {
  angleDeg,
  ball0,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** How many serves the run reads. */
const SERVES = 16;

const SERVE_ANGLE_DEG = (SERVE_ANGLE * 180) / Math.PI;
/** The `serve-angle` margin, in degrees. */
const ANGLE_TOLERANCE_DEG = 2;

/** Frames of each served flight recorded before the next serve, for the replay. */
const FLIGHT_TICKS = 24; // 0.2 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

/** Cut the hold short, read the launch frame, and let the ball fly a little. */
async function nextServe(): Promise<{ vx: number; vy: number }> {
  harness.debug.serve();
  // A serve from a live rally re-parks the ball and reopens the countdown first,
  // so what the sweep below finds is a fresh launch and never the old flight.
  // (`held` is not read here: it reports a countdown still RUNNING, and this
  // one has just been cut to zero.)
  const reopened = harness.snapshot();
  assertEqual(reopened.screen, "countdown");

  const launched = await harness.until((s) => s.screen === "playing", {
    maxFrames: 60,
    poll: 1,
  });
  assertEqual(launched.hit, true);
  await harness.advance(FLIGHT_TICKS);
  const ball = ball0(launched.snapshot);
  return { vx: ball.vx, vy: ball.vy };
}

it("draws the serve's vertical sign afresh on every serve toward player one", async () => {
  harness.debug.reset();
  harness.debug.startMatch("versus");

  const serves = await captureReplay(harness, "serves", async () => {
    const launches: { vx: number; vy: number }[] = [];
    for (let i = 0; i < SERVES; i += 1) launches.push(await nextServe());
    return launches;
  });

  assertEqual(serves.length, SERVES);
  for (const serve of serves) {
    // Every one of them is the serve: toward player one, at the serve angle.
    assertLessThan(serve.vx, 0);
    assertLessThanOrEqual(
      Math.abs(Math.abs(angleDeg(serve)) - SERVE_ANGLE_DEG),
      ANGLE_TOLERANCE_DEG,
    );
  }
  // And the sign was drawn: over the run, the ball left upward on some serves
  // and downward on others.
  const upward = serves.filter((serve) => serve.vy < 0).length;
  const downward = serves.filter((serve) => serve.vy > 0).length;
  assertEqual(
    upward + downward,
    SERVES,
    "every serve leaves with a non-zero vertical component",
  );
  assertGreaterThanOrEqual(upward, 1, `${SERVES} serves and none went upward`);
  assertGreaterThanOrEqual(
    downward,
    1,
    `${SERVES} serves and none went downward`,
  );
  // And the build loaded every asset it asked the runtime for while this
  // harness was driving it.
  assertDeepEqual(harness.assetFailures, []);
});
