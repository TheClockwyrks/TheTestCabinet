// gameplay/serve-sign-p1 — the serve's vertical sign is drawn afresh on every serve
// toward player one.
//
// specs/balls.md: the serve leaves at `SERVE_SPEED` at `SERVE_ANGLE` (12
// degrees) from horizontal, `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)`, and `s`
// is drawn from the seeded generator on every serve with `+1` and `-1` each
// equally likely. One serve cannot show a draw — any one serve has some sign —
// so a run of them is read: a fresh match is opened, whose first serve is toward
// player one, the field is cut down to that one ball, and sixteen serves are
// taken from it in a row. Each launch is held to the serve itself (toward player
// one, at the serve angle), and the run as a whole to the draw: both signs
// appear.
//
// RE-SERVING IS TWO POSES, NOT ONE VERB. The surface is atomic
// (specs/instrumentation.md), so a serve is staged the way the game stages one
// after a point: the ball is returned to its home point held with a full timer
// (`spawnBall`), the screen is set back to `countdown`, and the timer is then run
// out. Neither pose touches `receiver`, and no ball is ever let near a goal edge,
// so every serve of the run is toward the same player and the build's own launch
// rule produces every one of them.
//
// The bar is deliberately the one a fixed sign cannot clear and a draw cannot
// miss: sixteen serves all of one sign come up one time in 32,768 from a fair
// draw. A build that always serves upward, or always downward, fails it every
// time.

import { afterEach, beforeEach, it } from "vitest";
import {
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
  isolateBall,
  openCountdown,
  type BoundBallOps,
  type Harness,
} from "../harness";

/** How many serves the run reads. */
const SERVES = 16;

const SERVE_ANGLE_DEG = (SERVE_ANGLE * 180) / Math.PI;
/** The `serve-angle` margin, in degrees. */
const ANGLE_TOLERANCE_DEG = 2;

/**
 * Frames of each served flight recorded before the next serve, for the replay.
 *
 * Short on purpose. At the serve speed a fifth of a second carries the ball about
 * a hundred units off its home point — far enough to see it leave and nowhere
 * near far enough to reach a goal edge, which would score a point and hand the
 * serve to the other player.
 */
const FLIGHT_TICKS = 24; // 0.2 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** Stage a serve, run the hold out, read the launch, and let the ball fly a little. */
async function nextServe(ball: BoundBallOps): Promise<{
  vx: number;
  vy: number;
}> {
  // Back to a staged serve: the ball at its home point, held, with a full timer
  // and an empty trail, and the countdown showing over it.
  await ball.spawn();
  await harness.debug.setScreen("countdown");
  const reopened = await harness.snapshot();
  assertEqual(reopened.screen, "countdown");

  await ball.setHoldTimer(0);
  const launched = await harness.until((s) => s.screen === "playing", {
    maxFrames: 60,
    poll: 1,
  });
  assertEqual(launched.hit, true);
  await harness.advance(FLIGHT_TICKS);
  const flying = ball0(launched.snapshot);
  return { vx: flying.vx, vy: flying.vy };
}

it("draws the serve's vertical sign afresh on every serve toward player one", async () => {
  await openCountdown(harness, "versus");
  const ball = await isolateBall(harness);

  const serves = await captureReplay(harness, "serves", async () => {
    const launches: { vx: number; vy: number }[] = [];
    for (let i = 0; i < SERVES; i += 1) launches.push(await nextServe(ball));
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
});
