// gameplay/serve-sign-p1 — the serve's vertical sign is drawn afresh on every serve
// toward player one.
//
// specs/balls.md: the serve leaves at `SERVE_SPEED` at `SERVE_ANGLE` (12
// degrees) from horizontal, `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)`, and `s`
// is drawn from the seeded generator on every serve with `+1` and `-1` each
// equally likely. One serve cannot show a draw — any one serve has some sign —
// so a run of them is read: a fresh match is opened, whose first serve is toward
// player one;
// the hold is cut short, the launch frame is read, and the ball is then parked
// back at its home and the countdown reopened — two atomic poses, neither of
// which touches `receiver`, so every serve of the run is toward the same
// player. Each launch is held to the serve itself (toward player one,
// at the serve angle), and the run as a whole to the draw: both signs appear.
//
// The field holds that one ball and nothing else — both obstacles are removed —
// so each short recorded flight crosses an empty court, and nothing is taken from
// the player: no paddle is driven, and neither can reach the ball in the fifth of
// a second between one launch and the next.
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
import { SERVE_ANGLE } from "../constants";
import {
  angleDeg,
  ball0,
  captureReplay,
  createHarness,
  driveServe,
  openCountdown,
  poseWorld,
  spawnBall,
  stageServe,
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

/**
 * Park the ball back at its home and reopen the countdown, leaving `receiver`.
 *
 * The two atomic poses that stand in for the retired `serve` operation's first
 * half. `spawnBall` returns the ball to its home point HELD, with a full hold
 * timer, zero velocity, zero spin and an empty trail (specs/instrumentation.md),
 * and `setScreen` puts the game back on the countdown and touches nothing else —
 * `receiver` in particular, so every serve of the run below travels the same way.
 */
function reopenCountdown(h: Harness): void {
  spawnBall(h);
  h.debug.setScreen("countdown");
}

/** Reopen the countdown, cut the hold, read the launch frame, and let it fly. */
async function nextServe(): Promise<{ vx: number; vy: number }> {
  reopenCountdown(harness);
  // The ball really is back at its home and waiting, so what the sweep below
  // finds is a fresh launch and never the old flight.
  const reopened = harness.snapshot();
  assertEqual(reopened.screen, "countdown");
  assertEqual(ball0(reopened).held, true);

  stageServe(harness);
  const launched = await driveServe(harness);
  assertEqual(launched.hit, true);
  await harness.advance(FLIGHT_TICKS);
  const ball = ball0(launched.snapshot);
  return { vx: ball.vx, vy: ball.vy };
}

it("draws the serve's vertical sign afresh on every serve toward player one", async () => {
  openCountdown(harness, "versus");
  poseWorld(harness, { live: false });

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
