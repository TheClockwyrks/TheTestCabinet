// waves/lives-never-regenerate — nothing a run does gives a life back.
//
// `specs/waves.md`, Victory and loss: "Lives never regenerate."
//
// A NEGATIVE CLAIM IS READ WHERE THE TEMPTATION IS. A build phase is where a
// tower-defense game hands the player something: `specs/economy.md` pays a
// wave-clear bonus and interest on that very transition, and a build that reads
// "the wave is over" as an occasion to be generous puts a life in the same
// envelope. So the window watched here is a wave cleared WITHOUT a leak and the
// whole build phase that clear opens — the one moment in a run when a life could
// plausibly arrive.
//
// THE COUNT IS POSED BELOW THE STARTING FIGURE, and that is what makes this
// reading distinguishing rather than vacuous. `specs/modes.md` starts a
// Containment run with twenty lives; the run is stood at FOUR. A build that tops
// the count back up to its starting figure between waves reads `20`, a build that
// grants one life per wave cleared reads `5`, and a run posed at the full twenty
// would have shown neither.
//
// THE CLEAR IS A KILL, NOT A LEAK, because the item's window is a wave cleared
// "without a leak": a leak COSTS a life, and a count that fell and then came back
// would read as no rise at all across a before-and-after pair. `poseKill` stands a
// pinned Arc over a one-hp Mote whose motion is off, so the mark cannot reach an
// exhaust and the wave is cleared by the death alone.
//
// THE COUNT IS SAMPLED THROUGHOUT, not just at the ends: through the kill and the
// clear at a two-frame poll, and through the build phase after it every half
// second, so a life granted and quietly taken back again is still caught.
//
// THE ASSERTION RUNS ONE WAY. It is that the count never ROSE; a build that spends
// lives it should not is broken in `specs/surge.md`'s leak values, which
// `surge.*` reads, and failing it here as well would blur the grade.
//
// WHAT EVERY WRONG MODEL READS. A build that restores the starting lives on a
// clear reads `20`; one that pays a life per wave reads `5`; one that pays a life
// for a wave cleared without a leak reads `5`. Each is above the `4` posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertTrue } from "../assert";
import { BUILD_PHASE_TIME, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  DRIVE_HZ,
  startRun,
  type Harness,
} from "../harness";
import { KILL_FRAMES, poseKill, poseWaveEnd } from "./run";

/** The wave cleared: an ordinary one, well short of the run's last. */
const WAVE = 3;

/**
 * The lives the run is stood at: an ordinary count well below `START_LIVES`
 * (`20`) and well above the `0` that would end the run.
 */
const LIVES = 4;

/**
 * How long the build phase the clear opens is watched: a second past
 * `BUILD_PHASE_TIME`.
 *
 * Geometry rather than a tolerance. It covers the whole of the phase in which a
 * build pays what a clear owes, including the instant its countdown reaches `0`.
 */
const WATCH_SECONDS = BUILD_PHASE_TIME + 1;

/** How often the count is sampled inside that window, in seconds of game time. */
const SAMPLE_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("never raises the lives across a wave cleared and the build phase after it", async () => {
  await startRun(h);
  await poseWaveEnd(h, WAVE);
  await h.debug.setLives(LIVES);
  await poseKill(h);

  // Through the kill and the clear it opens.
  const killed = await h.until(
    (snapshot) => snapshot.surge.length === 0 || snapshot.lives > LIVES,
    { maxFrames: KILL_FRAMES, poll: 2 },
  );
  const cleared = await h.snapshot();
  // And through the whole build phase that clear opened.
  const held = await h.coastUntil((snapshot) => snapshot.lives > LIVES, {
    maxSeconds: WATCH_SECONDS,
    pollSeconds: SAMPLE_SECONDS,
    // Diced on the long-drive clock (`harness.ts`, The long-drive clock).
    hz: DRIVE_HZ,
  });

  await captureStill(h, "lives");

  assertTrue(
    cleared.surge.length === 0,
    `precondition: Wave ${WAVE}'s last unit was killed and left the floor`,
  );
  assertEqual(
    cleared.phase,
    "building",
    `precondition: the kill cleared Wave ${WAVE} and opened a build phase`,
  );
  assertLessThanOrEqual(
    killed.snapshot.lives,
    LIVES,
    `the lives across the clear of Wave ${WAVE}, posed at ${LIVES} against a run's starting ${START_LIVES}`,
  );
  assertLessThanOrEqual(
    held.snapshot.lives,
    LIVES,
    `the lives ${held.elapsed} seconds into the build phase the clear opened`,
  );
});
