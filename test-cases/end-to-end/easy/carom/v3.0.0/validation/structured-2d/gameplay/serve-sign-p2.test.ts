// gameplay/serve-sign-p2 — the serve's vertical sign is drawn afresh on every serve
// toward player two.
//
// specs/balls.md: the serve leaves at `SERVE_SPEED` at `SERVE_ANGLE` (12
// degrees) from horizontal, `vy = s * SERVE_SPEED * sin(SERVE_ANGLE)`, and `s`
// is drawn from the seeded generator on every serve with `+1` and `-1` each
// equally likely. One serve cannot show a draw — any one serve has some sign —
// so a run of them is read: a real point is driven out the right goal, so the
// build's own scoring makes player two the receiver, and each serve is then
// staged by returning the ball to its home point held, reopening the countdown,
// and cutting the hold to zero. Not one of those three touches `receiver`, so
// every serve of the run is toward the player the point named, and not one of
// them touches the velocity, so each launch is entirely the build's own. Each
// launch is held to the serve itself (toward player two, at the serve angle), and
// the run as a whole to the draw: both signs appear.
//
// THE FIELD HOLDS THE ONE BALL AND NOTHING ELSE. `arrangeGoal` clears it before
// the point, with both paddles held out of the lane, so the flight that decides
// the receiver is a straight line and the short flight recorded after each launch
// is the serve travelling rather than a bank; the readings themselves are taken
// on the launch frame, on which the ball has not been advanced at all.
//
// The bar is deliberately the one a fixed sign cannot clear and a draw cannot
// miss: sixteen serves all of one sign come up one time in 32,768 from a fair
// draw. A build that always serves upward, or always downward, fails it every
// time.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { SERVE_ANGLE } from "../constants";
import {
  angleDeg,
  arrangeGoal,
  ball0,
  captureReplay,
  createHarness,
  driveGoal,
  reachPlay,
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
 * Stage one serve, read the launch frame, and let the ball fly a little.
 *
 * The ball is returned to its home point BEFORE the countdown is reopened, so the
 * hold the reopened screen counts down is a full one whichever frame the screen
 * change lands on — a countdown reopened over a spent hold would serve on the
 * frame it opened, and the launch swept for below would be that stray one.
 */
async function nextServe(): Promise<{ vx: number; vy: number }> {
  stageServe(harness);
  harness.debug.setScreen("countdown");
  await harness.advance(1);
  assertEqual(harness.snapshot().screen, "countdown");

  // The hold is cut to zero; the LAUNCH is the build's own, on the frame after.
  const launched = await reachPlay(harness);
  assertEqual(launched.hit, true);
  await harness.advance(FLIGHT_TICKS);
  const ball = ball0(launched.snapshot);
  return { vx: ball.vx, vy: ball.vy };
}

it("draws the serve's vertical sign afresh on every serve toward player two", async () => {
  // Opening a match sets both scores to zero (specs/ui.md), so the point below
  // is the first of the match.
  await arrangeGoal(harness, "right");

  const serves = await captureReplay(harness, "serves", async () => {
    // The point that decides the receiver, and then the serves that answer it.
    const point = await driveGoal(harness);
    assertEqual(point.hit, true);
    assertEqual(point.snapshot.score.p1, 1);
    assertEqual(point.snapshot.screen, "countdown");
    const launches: { vx: number; vy: number }[] = [];
    for (let i = 0; i < SERVES; i += 1) launches.push(await nextServe());
    return launches;
  });

  assertEqual(serves.length, SERVES);
  for (const serve of serves) {
    // Every one of them is the serve: toward player two, at the serve angle.
    assertGreaterThan(serve.vx, 0);
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
