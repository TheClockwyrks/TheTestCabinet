// gameplay/delta-time-independent — the simulation advances on elapsed time, not
// on a count of frames.
//
// One scenario is driven three times — under a steady step, under an uneven
// repeating pattern, and under a seeded jitter — and the three runs must agree.
// The surface's `advance(seconds, frames)` takes the length of a frame as an
// argument (specs/instrumentation.md), so the same posed situation can be
// replayed at a different step size without touching the build.
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
// time of each drive is the time the harness ASKED for — the sum of the deltas it
// handed `advance` — rather than anything the build reported, so a build cannot
// answer this one by misreporting its own clock.

import { afterEach, expect, it } from "vitest";
import { FIELD_CY, FIELD_H } from "../constants";
import {
  ball0,
  captureReplay,
  ConstantClock,
  createHarness,
  JitterClock,
  PARKED_CY,
  SequenceClock,
  startPlaying,
  TICK_MS,
  type BallView,
  type Clock,
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
 * deciding which side of an obstacle it passes, which says nothing about a build.
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
 * into the left paddle's face, arriving in the mid-field lane that clears both
 * obstacles. The paddle waits there, still and centred on that arrival, so the
 * ball is returned down the same clear lane and out the right goal.
 *
 * The approach is shallow on purpose. Every quantity compared here traces back to
 * WHERE on the paddle the ball landed, and that contact point is the one thing a
 * bigger step really moves: a step lands the ball up to `vy * dt` further down
 * its approach than a smaller one would. Keeping the approach's vertical speed
 * low (205 px/s against 600 across) holds that spread to about three pixels even
 * at the coarsest schedule — a return angle within a few degrees of straight, on
 * a flight that stays comfortably inside the clear lane.
 */
const BALL_START = { x: 1150, y: FIELD_H - 30, vx: -600, vy: 205, spin: 0 };

/** How far a drive may run, and how often it is sampled. */
const MAX_FRAMES = 1400;
const POLL_FRAMES = 3;

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
 * Speed only ever changes at a paddle hit, and walls and obstacles preserve it
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

afterEach(async () => {
  while (live.length > 0) await live.pop()?.dispose();
});

/**
 * Pose the scenario on a fresh page driven by `clock`, and play it out.
 *
 * `replay` names the review item's output when this is the drive whose frames are
 * kept as evidence, and is absent for the drives that are only compared against.
 */
async function driveOnce(clock: Clock, replay?: string): Promise<Outcome> {
  const harness = await createHarness({ clock });
  live.push(harness);

  await startPlaying(harness);
  await harness.debug.setScore(0, 0);
  await harness.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
  await harness.debug.setPaddle("right", { cy: PARKED_CY, vy: 0 });
  await harness.debug.setBall(0, BALL_START);

  const opening = await harness.snapshot();
  const startScore = opening.score;
  const startMs = harness.timeMs();

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
    elapsedMs: harness.timeMs() - startMs,
    resolved: swept.hit,
  };
}

it("reaches the same outcome however the elapsed time is divided into frames", async () => {
  // Driven one after another rather than together, so each page has the browser
  // to itself and a failure names one schedule.
  const drives: Outcome[] = [];
  for (const schedule of SCHEDULES)
    drives.push(await driveOnce(schedule.clock(), schedule.replay));
  const [reference, ...compared] = drives;

  // The comparison is only worth making if the reference drive did what the
  // scenario intends, so those two facts are asserted before anything is compared.
  expect(reference.resolved).toBe(true);
  expect(reference.scorer).not.toBeNull();
  expect(reference.contacted).toBe(true);

  for (const [index, run] of compared.entries()) {
    const { name } = SCHEDULES[index + 1];

    expect(run.contacted, `${name}: comes off the paddle`).toBe(
      reference.contacted,
    );
    expect(run.banked, `${name}: banks off a wall`).toBe(reference.banked);
    expect(run.scorer, `${name}: the same side scores`).toBe(reference.scorer);
    expect(run.heading, `${name}: ends travelling the same way`).toBe(
      reference.heading,
    );
    expect(
      Math.abs(run.speed - reference.speed),
      `${name}: ends at the same speed`,
    ).toBeLessThanOrEqual(SPEED_TOLERANCE);
    // The one fact a build that ignores the delta time it is given cannot fake.
    expect(
      Math.abs(run.elapsedMs - reference.elapsedMs),
      `${name}: takes the same game time`,
    ).toBeLessThanOrEqual(reference.elapsedMs * ELAPSED_TOLERANCE);
  }
});
