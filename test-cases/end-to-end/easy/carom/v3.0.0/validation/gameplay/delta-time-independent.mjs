// Automated validation for the Gameplay sub-item `delta-time-independent`: the
// simulation advances on the elapsed time it is handed, not on a count of frames.
// One scenario is driven three times — under a steady 120 Hz step, under an uneven
// repeating pattern of steps, and under a seeded jitter — and the three runs must
// agree.
//
// WHY THIS ITEM IS ENGINE-ONLY. The schedule behind the clock is the engine's
// (components/core/engines.md): the host interface hands a driver the manual clock
// and lets it install the delta pattern that clock walks, so the same scenario can
// be replayed at a different step size without touching the build. Under `none`
// there is no such seam — the build owns its own clock and the case's specification
// pins it to a fixed 120 Hz timestep — so the scenario cannot be constructed at all
// and this item records an unmet precondition rather than a failure. That is the
// honest outcome: the check is not applicable, and a `none` run is not worse for it.
//
// WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT. Only outcomes that survive a
// legitimate change in step size: whether the ball struck the paddle, whether it
// banked off a wall, which side scored, roughly which way the ball was travelling
// when the point landed, the speed it was travelling at, and how much GAME TIME the
// whole scenario took. Never a position, never an exact velocity, never a frame
// count. Numerical integration of a nonlinear system diverges across step sizes even
// when every step of it is correct — two runs of a correct build land the ball a few
// pixels apart, and an item that compared positions would fail honest builds while
// telling a reviewer nothing. What must NOT change is the shape of what happened.
//
// WHY GAME TIME IS THE SHARPEST OF THOSE FACTS. The spatial outcome alone cannot
// separate a build that integrates against `dt` from one that ignores `dt` entirely:
// a build advancing by a fixed amount per frame traces the very same path through
// the field whatever the step size, and would agree with itself on every fact above.
// What it cannot do is take the same amount of SIMULATED TIME to trace it — 430
// frames is 3.6 s at 120 Hz and 1.9 s at 222 Hz. So the elapsed time of each drive is
// read from the engine's own frame clock, which is engine code no build can
// misreport, and compared across the three schedules. A build integrating against
// `dt` covers the same ground in the same game time however that time arrived.

import {
  ball0,
  engineHost,
  hostCall,
  pinObstaclesUpright,
  startPlaying,
} from "../_helpers.mjs";

// The three clocks the one scenario is driven under. The steady 120 Hz step is the
// reference, because it is the rate the case instruments at and the rate the host's
// manual clock uses by default, so the reference drive is the drive every other
// validation item in this case already performs.
//
// The two alternatives differ from it in BOTH ways that matter, deliberately. Their
// steps are uneven, which is what a real display delivers and what a build that
// assumes a constant step gets wrong. And their MEAN steps are far from the
// reference's — 4.5 ms and 13 ms against 8.33 ms — which is what makes the elapsed
// game time discriminating: a build advancing per frame rather than per second
// finishes the same scenario in 54% and 156% of the reference's game time, while a
// build integrating against `dt` finishes in the same time to within a per cent.
//
// The steps stay inside 2–16 ms (62–500 Hz), which is the range of real frame rates
// and no wider. The point is to change the step size legitimately, not to hunt for
// chaos: a 40 ms step would move the ball 27 px between frames and start deciding
// which side of an obstacle it passes, which says nothing about the build.
const SCHEDULES = [
  {
    id: "fixed",
    name: "a steady 120 Hz step",
    schedule: { kind: "fixed", stepMs: 1000 / 120 },
  },
  {
    id: "sequence",
    name: "an uneven repeating step",
    schedule: { kind: "sequence", stepsMs: [2, 8, 3, 5] },
  },
  {
    id: "jitter",
    name: "a seeded jitter",
    schedule: { kind: "jitter", minMs: 10, maxMs: 16, seed: 20250819 },
  },
];

// The posed approach: the ball starts low on the right travelling down and left, so
// it banks off the bottom wall almost immediately and then climbs the length of the
// field into the left paddle's face, arriving at y ≈ 360 — the mid-field lane that
// clears both obstacles. The paddle waits there, still and centred on that arrival,
// so the ball is returned down the same clear lane and out the right goal.
//
// The approach is shallow on purpose. Every quantity this item compares eventually
// traces back to WHERE on the paddle the ball landed, and that contact point is the
// one thing a bigger step really does move: a step lands the ball up to `vy * dt`
// further down its approach than a smaller one would. Keeping the approach's
// vertical speed low (205 px/s, against 600 px/s across) keeps that spread to about
// three pixels even at the coarsest schedule, which is a return angle within a few
// degrees of straight and a flight that stays comfortably inside the clear lane.
const BALL_START = { x: 1150, y: 690, vx: -600, vy: 205, spin: 0 };
// Where that approach reaches the left paddle's face, and so where the paddle is
// centred: a near-centre contact, returning the ball straight back down the lane.
const PADDLE_CY = 360;
// The other paddle, parked well clear of both the approach and the return.
const PARKED_CY = 150;

// How far a drive may run, in frames, and how often it is sampled. The scenario is
// about 3.6 s of game time, which is ~430 frames at 120 Hz but ~800 under the 4.5 ms
// sequence, so the cap is generous. Sampling every third frame is fine here: nothing
// this item reads is an instant — a bounce reverses a velocity and leaves it
// reversed, and a scored point holds the ball for a full second afterwards.
const MAX_FRAMES = 1400;
const POLL_FRAMES = 3;

// Vertical speeds below this count as travelling level rather than up or down, in
// px/s. A near-centre paddle contact returns the ball almost flat, so its vertical
// speed is small and its SIGN is meaningless — a few pixels of contact-point spread
// flips it. The band is wide enough (about 10 degrees of the return) that the sign is
// never what decides this check, and narrow enough that a genuinely different return
// still reads as up or down.
const LEVEL_VY = 120;

// How far apart two drives' elapsed game times may be, as a fraction of the
// reference's. A drive's game time varies a little for honest reasons — the point is
// detected up to one poll late, and the return angle varies by a degree or two — but
// that is under 2%. A build that advances per frame rather than per second is out by
// 46% or more (see the header), so this separates the two with room to spare.
const ELAPSED_TOLERANCE = 0.08;

/**
 * Mark an unmet precondition — the build answered every call correctly, but the
 * scenario could not be posed against it, so there is nothing to grade. A plain
 * property rather than a shared class because this file is loaded by path and cannot
 * import the runtime's (see `PRECONDITION_UNMET` in
 * `packages/browser-driver/validation.mjs`).
 */
function unmetPrecondition(reason) {
  const err = new Error(reason);
  err.ttcPreconditionUnmet = true;
  return err;
}

/**
 * Pose the scenario: a live match at 0-0 with the obstacles upright, any extra balls
 * of a multi build parked, the left paddle still and centred on the arrival, the
 * right paddle out of the way, and the ball on its approach. Control ops only, so it
 * consumes no time and is callable from either phase.
 */
async function poseScenario(api) {
  await startPlaying(api);
  await api.call("setScore", 0, 0);
  // In gyre the obstacles sway and rotate into the lane this drive rides; pin them
  // upright so all three schedules face the same field (a no-op in base and multi).
  await pinObstaclesUpright(api);
  await api.call("setPaddle", "left", { cy: PADDLE_CY, vy: 0 });
  await api.call("setPaddle", "right", { cy: PARKED_CY, vy: 0 });
  await api.call("setBall", 0, BALL_START);
}

/** Which way a ball is travelling, coarsely, as a phrase an assertion can compare. */
function headingOf(ball) {
  const across =
    ball.vx > 0 ? "rightward" : ball.vx < 0 ? "leftward" : "stalled";
  const vertical =
    Math.abs(ball.vy) < LEVEL_VY ? "level" : ball.vy < 0 ? "rising" : "falling";
  return `${across} and ${vertical}`;
}

/**
 * Pose the scenario, install `schedule` on the engine's manual clock, and run the
 * real physics until the point resolves. Returns what happened, in facts that a
 * change of step size must not change.
 *
 * Installing a schedule restarts it at its first step, so each drive walks the same
 * pattern from the same place. It never touches the clock MODE: the validation
 * runtime owns that (manual to decide the verdict, the build's own to record the
 * clip), and a schedule is simply inert while the wall clock is driving.
 */
async function driveOnce(api, schedule) {
  await hostCall(api, "setSchedule", schedule);
  await poseScenario(api);

  const opening = await api.snapshot();
  const startScore = opening.score;
  const startMs = (await hostCall(api, "frame")).timeMs;

  let contacted = false;
  let banked = false;
  let verticalSign = Math.sign(ball0(opening).vy);
  let lastInFlight = ball0(opening);
  let scorer = null;

  const swept = await api.until(
    (s) => {
      // The score is read first: the sample that carries the point is also the one
      // where the ball has already been taken back to the centre for the next serve,
      // so the flight is described from the sample before it.
      if (s.score.p1 > startScore.p1) {
        scorer = "p1";
        return true;
      }
      if (s.score.p2 > startScore.p2) {
        scorer = "p2";
        return true;
      }
      const ball = ball0(s);
      // The ball is posed travelling left, so travelling right means the left paddle
      // sent it back.
      if (ball.vx > 0) contacted = true;
      const sign = Math.sign(ball.vy);
      if (sign !== 0) {
        if (verticalSign !== 0 && sign !== verticalSign) banked = true;
        verticalSign = sign;
      }
      lastInFlight = ball;
      return false;
    },
    { max: MAX_FRAMES, poll: POLL_FRAMES },
  );

  const elapsedMs = (await hostCall(api, "frame")).timeMs - startMs;
  return {
    contacted,
    banked,
    scorer,
    heading: headingOf(lastInFlight),
    speed: lastInFlight.speed,
    elapsedMs,
    resolved: swept.hit,
  };
}

export default function item() {
  // The reference drive and the two to compare against it, filled in by `act`.
  let reference;
  const compared = [];

  return {
    id: "gameplay.delta-time-independent",

    // Confirm there is an engine to vary the clock of, and pose the scenario so the
    // recorded clip opens on it. Control ops only; no time passes.
    async arrange(api) {
      const host = await engineHost(api);
      if (!host.present) {
        throw unmetPrecondition(
          "no engine host is installed, so this run has no replaceable clock and the " +
            "same scenario cannot be driven under a second schedule",
        );
      }
      await poseScenario(api);
    },

    // Drive the one scenario three times, once per schedule. This IS the clip: the
    // record pass replays it on the build's own clock, where a schedule means
    // nothing, so a reviewer watches the scenario the comparison was made from.
    async act(api) {
      for (const entry of SCHEDULES) {
        const outcome = await driveOnce(api, entry.schedule);
        if (reference === undefined) reference = { ...entry, outcome };
        else compared.push({ ...entry, outcome });
      }
    },

    async assert(api, check) {
      // The comparison is only worth making if the reference drive did what the
      // scenario intends. It failing to is not a frame-rate fault — it is this item
      // being unable to pose its scenario against this build, which the paddle and
      // scoring items grade in their own right — so it is reported as an unmet
      // precondition rather than as a failure here.
      if (!reference.outcome.resolved || reference.outcome.scorer === null) {
        throw unmetPrecondition(
          `under ${reference.name} the posed point did not resolve within ` +
            `${MAX_FRAMES} frames, so there is no outcome to compare against`,
        );
      }
      if (!reference.outcome.contacted) {
        throw unmetPrecondition(
          `under ${reference.name} the ball never came off the left paddle, so the ` +
            "scenario this item compares — a paddle contact and the flight after it — " +
            "did not happen",
        );
      }

      for (const run of compared) {
        check.expectEq(
          `under ${run.name}, the ball still comes off the paddle`,
          run.outcome.contacted,
          reference.outcome.contacted,
        );
        check.expectEq(
          `under ${run.name}, the ball still banks off a wall`,
          run.outcome.banked,
          reference.outcome.banked,
        );
        check.expectEq(
          `under ${run.name}, the same side scores`,
          run.outcome.scorer,
          reference.outcome.scorer,
        );
        check.expectEq(
          `under ${run.name}, the ball ends travelling the same way`,
          run.outcome.heading,
          reference.outcome.heading,
        );
        // Speed only ever changes at a paddle hit (x1.04, to a cap), and walls and
        // obstacles preserve it exactly, so the speed the ball ends at is really a
        // count of how many times it was struck — a whole-number fact, compared with
        // a tolerance far tighter than one hit and far looser than integration noise.
        check.expectClose(
          `under ${run.name}, the ball ends at the same speed (px/s)`,
          run.outcome.speed,
          reference.outcome.speed,
          10,
        );
        // The one fact a build that ignores the delta time it is given cannot fake.
        check.expectClose(
          `under ${run.name}, the scenario takes the same game time (ms)`,
          run.outcome.elapsedMs,
          reference.outcome.elapsedMs,
          reference.outcome.elapsedMs * ELAPSED_TOLERANCE,
        );
      }
    },
  };
}
