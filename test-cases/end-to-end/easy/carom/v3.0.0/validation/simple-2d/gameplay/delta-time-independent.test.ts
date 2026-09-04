// gameplay/delta-time-independent — the simulation advances on elapsed time, not
// on a count of frames.
//
// One scenario is driven three times — under a steady step, under an uneven
// repeating pattern, and under a seeded jitter — and the three runs must agree.
// The runtime's clock is replaceable, so the same posed situation can be replayed
// at a different step size without touching the build.
//
// WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT. Only outcomes that survive a
// legitimate change in step size: whether the ball came off the paddle, whether
// it banked off a wall, which side scored, roughly which way it was travelling
// when the point landed, the speed it was travelling at, and how much GAME TIME
// the whole scenario took. Never a position, never an exact velocity, never a
// frame count. Numerical integration of a nonlinear system diverges across step
// sizes even when every step of it is correct, so two correct runs land the ball
// a few pixels apart; a check comparing positions would fail honest builds while
// telling a reviewer nothing.
//
// WHY GAME TIME IS THE SHARPEST OF THOSE FACTS. The spatial outcome alone cannot
// separate a build that integrates against `dt` from one that ignores it: a build
// advancing a fixed amount per frame traces the very same path through the field
// whatever the step size, and would agree with itself on every fact above. What
// it cannot do is take the same amount of SIMULATED TIME to trace it. The elapsed
// time of each drive is read from the runtime's own frame clock — runtime code no
// build can misreport — and compared across the three schedules.

import { afterEach, it } from "vitest";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  type Clock,
} from "@test-cabinet/simple-2d";
import { FIELD_CY, FIELD_H } from "../constants";
import { assertEqual, assertLessThanOrEqual, assertNotNull } from "../assert";
import {
  aimBall,
  ball0,
  captureReplay,
  createHarness,
  drivePaddleAt,
  enterPlaying,
  parkPaddle,
  placeBall,
  poseWorld,
  spinBall,
  TICK_MS,
  type BallView,
  type Harness,
  type UntilResult,
} from "../harness";

/**
 * The three clocks the one scenario is driven under.
 *
 * The steady step is the reference: it is the cadence every other check in this
 * suite runs at. The two alternatives differ from it in both ways that matter.
 * Their steps are UNEVEN, which is what a real display delivers and what a build
 * assuming a constant step gets wrong. And their MEAN steps are far from the
 * reference's — 4.5 ms and 13 ms against 8.33 ms — which is what makes the
 * elapsed game time discriminating: a build advancing per frame rather than per
 * second finishes the same scenario in about half and about half again as much
 * game time, while a build integrating against `dt` finishes in the same time to
 * within a per cent.
 *
 * Every step stays inside 2–16 ms (62–500 Hz), the range of real frame rates and
 * no wider. The point is to change the step size legitimately, not to hunt for
 * chaos: a 40 ms step would move the ball far enough between frames to start
 * deciding which side of a paddle's end cap it passes, which says nothing about a
 * build.
 */
const SCHEDULES: { name: string; clock: () => Clock; replay?: string }[] = [
  { name: "a steady step", clock: () => new ConstantClock(TICK_MS) },
  {
    name: "an uneven repeating step",
    clock: () => new SequenceClock([2, 8, 3, 5]),
  },
  // The recorded drive is the jittered one, and only it: the three differ solely
  // in their clocks, so three recordings under the one declared output would
  // leave whichever happened to run last, and the point this evidence is for is
  // that the scenario plays out the same way under a clock that is not steady.
  {
    name: "a seeded jitter",
    clock: () => new JitterClock(10, 16, 20250819),
    replay: "drive",
  },
];

/**
 * The posed approach: the ball starts low on the right travelling down and left,
 * banks off the bottom wall almost at once, then climbs the length of the field
 * into the left paddle's face, arriving level with the field centre. The paddle
 * waits there, still and centred on that arrival, so the ball is returned down
 * the same lane and out the right goal.
 *
 * The field holds that one ball: both obstacles are REMOVED rather than dodged,
 * which is what keeps the comparison honest across step sizes — a coarse step
 * that carried the ball a few pixels wider past an obstacle than a fine one would
 * report a divergence that belongs to the obstacle rule's own checks. The left
 * paddle is the one the requirement needs driven, because it has to be standing
 * exactly there when the ball arrives under every schedule; the right is driven
 * out of the lane, since a paddle cannot be removed.
 *
 * The approach is shallow on purpose. Every quantity compared here traces back to
 * WHERE on the paddle the ball landed, and that contact point is the one thing a
 * bigger step really moves: a step lands the ball up to `vy * dt` further down
 * its approach than a smaller one would. Keeping the approach's vertical speed
 * low (205 px/s against 600 across) holds that spread to about three pixels even
 * at the coarsest schedule — a return angle within a few degrees of straight, on
 * a flight that stays comfortably clear of the walls on its way out.
 */
const BALL_START = { x: 1150, y: FIELD_H - 30, vx: -600, vy: 205, spin: 0 };

/** How far a drive may run. */
const MAX_FRAMES = 1400;
/**
 * Frames between samples.
 *
 * A sample is what detects the point, so it is also what sets how late a drive's
 * elapsed game time can be read: at most one poll of it, which is 78 ms at the
 * coarsest schedule below. The scenario is the ball crossing the field and coming
 * back, several seconds of game time, so that is a couple of per cent of what
 * {@link ELAPSED_TOLERANCE} allows eight of. A sweep sampling twice as often buys
 * one more per cent of that margin and costs twice as much to decide the same
 * things.
 */
const POLL_FRAMES = 6;

/**
 * Vertical speeds below this count as travelling level rather than up or down, in
 * px/s. A near-centre contact returns the ball almost flat, so its vertical speed
 * is small and its SIGN is meaningless — a few pixels of contact-point spread
 * flips it. The band is about ten degrees of the return: wide enough that the
 * sign never decides this check, narrow enough that a genuinely different return
 * still reads as up or down.
 */
const LEVEL_VY = 120;

/**
 * Speed only ever changes at a paddle hit, and a wall bounce preserves it
 * exactly, so the speed the ball ends at is really a count of how many times it
 * was struck — a whole-number fact, compared far tighter than one hit and far
 * looser than integration noise.
 */
const SPEED_TOLERANCE = 10;

/**
 * How far apart two drives' elapsed game times may be, as a fraction of the
 * reference's. A drive's game time varies a little for honest reasons — the point
 * is detected up to one poll late, and the return angle varies by a degree or two
 * — but that is under 2%. A build that advances per frame rather than per second
 * is out by tens of per cent, so this separates the two with room to spare.
 */
const ELAPSED_TOLERANCE = 0.08;

interface Outcome {
  contacted: boolean;
  banked: boolean;
  scorer: "p1" | "p2" | null;
  heading: string;
  speed: number;
  elapsedMs: number;
  resolved: boolean;
}

/** Which way a ball is travelling, coarsely, as a phrase an assertion compares. */
function headingOf(ball: BallView): string {
  const across =
    ball.vx > 0 ? "rightward" : ball.vx < 0 ? "leftward" : "stalled";
  const vertical =
    Math.abs(ball.vy) < LEVEL_VY ? "level" : ball.vy < 0 ? "rising" : "falling";
  return `${across} and ${vertical}`;
}

const live: Harness[] = [];

afterEach(() => {
  while (live.length > 0) live.pop()?.dispose();
});

/**
 * Pose the scenario on a fresh runtime driven by `clock`, and play it out.
 *
 * `replay` names the review item's output when this is the drive whose frames are
 * kept as evidence, and is absent for the drives that are only compared against.
 */
async function driveOnce(clock: Clock, replay?: string): Promise<Outcome> {
  const harness = await createHarness({ clock });
  live.push(harness);

  enterPlaying(harness);
  poseWorld(harness);
  drivePaddleAt(harness, "left", FIELD_CY, 0);
  parkPaddle(harness, "right");
  placeBall(harness, BALL_START.x, BALL_START.y);
  aimBall(harness, BALL_START.vx, BALL_START.vy);
  spinBall(harness, BALL_START.spin);

  const opening = harness.snapshot();
  const startScore = opening.score;
  const startMs = harness.engine.frame().timeMs;

  let contacted = false;
  let banked = false;
  let verticalSign = Math.sign(ball0(opening).vy);
  let lastInFlight = ball0(opening);
  let scorer: "p1" | "p2" | null = null;

  /** The drive itself, so the recorded section is exactly this and no more. */
  const play = (): Promise<UntilResult> =>
    harness.until(
      (s) => {
        // The score is read first: the sample carrying the point is also the one
        // where the ball has been taken back to the centre for the next serve,
        // so the flight is described from the sample before it.
        if (s.score.p1 > startScore.p1) {
          scorer = "p1";
          return true;
        }
        if (s.score.p2 > startScore.p2) {
          scorer = "p2";
          return true;
        }
        // The ball is posed travelling left, so travelling right means the left
        // paddle sent it back.
        if (ball0(s).vx > 0) contacted = true;
        const sign = Math.sign(ball0(s).vy);
        if (sign !== 0) {
          if (verticalSign !== 0 && sign !== verticalSign) banked = true;
          verticalSign = sign;
        }
        lastInFlight = ball0(s);
        return false;
      },
      { maxFrames: MAX_FRAMES, poll: POLL_FRAMES },
    );

  const swept =
    replay === undefined
      ? await play()
      : await captureReplay(harness, replay, play);

  return {
    contacted,
    banked,
    scorer,
    heading: headingOf(lastInFlight),
    speed: lastInFlight.speed,
    elapsedMs: harness.engine.frame().timeMs - startMs,
    resolved: swept.hit,
  };
}

it("reaches the same outcome however the elapsed time is divided into frames", async () => {
  // Driven one after another rather than together, so each runtime has the
  // process to itself and a failure names one schedule.
  const drives: Outcome[] = [];
  for (const schedule of SCHEDULES)
    drives.push(await driveOnce(schedule.clock(), schedule.replay));
  const [reference, ...compared] = drives;

  // The comparison is only worth making if the reference drive did what the
  // scenario intends, so those two facts are asserted before anything is compared.
  assertEqual(reference.resolved, true);
  assertNotNull(reference.scorer);
  assertEqual(reference.contacted, true);

  for (const [index, run] of compared.entries()) {
    const { name } = SCHEDULES[index + 1];

    assertEqual(
      run.contacted,
      reference.contacted,
      `${name}: comes off the paddle`,
    );
    assertEqual(run.banked, reference.banked, `${name}: banks off a wall`);
    assertEqual(run.scorer, reference.scorer, `${name}: the same side scores`);
    assertEqual(
      run.heading,
      reference.heading,
      `${name}: ends travelling the same way`,
    );
    assertLessThanOrEqual(
      Math.abs(run.speed - reference.speed),
      SPEED_TOLERANCE,
      `${name}: ends at the same speed`,
    );
    // The one fact a build that ignores the delta time it is given cannot fake.
    assertLessThanOrEqual(
      Math.abs(run.elapsedMs - reference.elapsedMs),
      reference.elapsedMs * ELAPSED_TOLERANCE,
      `${name}: takes the same game time`,
    );
  }
});
