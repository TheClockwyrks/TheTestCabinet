// Meltdown — surge/spawn-cadence: one unit every 0.6 seconds, from the first.
//
// THE RULE. `specs/waves.md`, The release: "A wave releases its units one at a
// time, one every `WAVE_SPAWN_INTERVAL` (`0.6`) seconds of game time, the first on
// the frame the wave begins. There is no variation in that cadence." That is two
// claims and this point reads both: WHERE the sequence starts, and HOW FAR APART
// its members are.
//
// WHICH CLOCK THE CADENCE IS MEASURED ON. `specs/waves.md` says "of game time",
// and it says what game time is: "Every rate in this specification is per second
// and is integrated against that game time, and `simTime` accumulates it." So each
// arrival is stamped with the `simTime` of the frame it was first seen on, and the
// intervals are differences of those stamps. Nothing here is counted in frames or
// in wall-clock seconds.
//
// WHY THE RUN ENTERS ITS OWN WAVE. "The first on the frame the wave begins" is a
// claim about a transition, and a posed phase has no beginning to speak of —
// `setPhase` "runs no entry effect" (`specs/instrumentation.md`). So the run is
// armed instead, a build phase for Wave 1 with its timer at `0` and the world gate
// open, and `specs/waves.md`'s "Reaching `0` starts the wave" supplies the
// transition. The frame on which the phase first reads `wave` and the frame the
// first unit is first seen on are read off the SAME frame-by-frame sweep, so the
// two stamps are on one clock and the comparison between them is not a comparison
// of two round trips.
//
// WHY EVERY FRAME IS SAMPLED. An arrival is stamped with the frame it was noticed
// on, so a sweep that looked once every six frames would blur every stamp by up to
// six frames and could not tell an opening delay of one frame from one of five.
// Sampling every frame makes the blur one frame, which is what the tolerances
// below are derived from.
//
// WHY WAVE 1, AND WHY EACH ARRIVAL IS HELD STILL. Wave 1 of a 20-wave Containment
// run releases twelve Motes (`specs/waves.md`), which is eleven intervals — enough
// that a build whose cadence drifts rather than repeats is caught, and enough that
// a single mis-stamped arrival cannot carry the reading. Each arrival is held where
// it arrived, so none of the twelve walks off the floor and takes lives with it
// while the rest are still being released.
//
// WHAT EVERY WRONG MODEL READS. A build that releases its first unit one interval
// in reads an opening gap of `0.6` rather than nothing; one that releases per FRAME
// rather than per second reads intervals of `0.008`; one that spaces its units by a
// figure it invented reads an interval that is not `0.6`; one that releases the
// whole wave at once reads eleven intervals of `0`; one that varies the cadence
// reads intervals that are not all the same, and the failure names the pair.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  seconds,
  ticksFor,
  type Harness,
} from "../harness";
import { armWave, watchReleases } from "./scenario";

/** The run this point is stated against: Containment on Medium, 20 waves. */
const WAVE_COUNT = 20;

/** The wave read: the twelve-Mote opening wave (`specs/waves.md`). */
const WAVE = 1;

/** Seconds of game time the wave is watched for: twelve, nearly twice what it needs. */
const WATCH_TICKS = ticksFor(12);

/** Frames between two samples: every one, because each arrival is being stamped. */
const POLL_FRAMES = 1;

/** The fewest intervals the reading is taken over, so a short wave cannot pass it. */
const MIN_INTERVALS = 8;

/**
 * How late the first unit may be, in seconds of game time: two frames' worth.
 *
 * `specs/waves.md` puts the first unit on the frame the wave begins, so the
 * stated gap is nothing at all. Two frames of the suite's 120 Hz clock is
 * `0.0167` seconds, which admits a build whose frame resolves its spawner before
 * its build timer and therefore delivers the first unit on the frame after the
 * transition, and admits the one frame of blur that stamping an arrival on the
 * frame it was noticed costs. It is a thirty-sixth of the `0.6`-second interval,
 * so a build that made the player wait a whole interval for the first unit is
 * nowhere near it.
 */
const OPENING_TOLERANCE = seconds(2);

/**
 * How far one interval may sit from `0.6` seconds of game time: three frames' worth.
 *
 * Each end of an interval is stamped on the frame the arrival was noticed, so each
 * is late by at most one frame and the difference between two of them is uncertain
 * by two; the third frame is for a build that accumulates its release clock in
 * floating point across a hundred and forty frames rather than comparing against a
 * multiple. `0.025` seconds is a twenty-fourth of the interval, far tighter than
 * any wrong cadence a build could plausibly have chosen.
 */
const INTERVAL_TOLERANCE = seconds(3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases the first unit as the wave begins and one every 0.6s after", async () => {
  armWave(h, WAVE, "containment", "medium");
  assertEqual(
    h.snapshot().waveCount,
    WAVE_COUNT,
    `precondition: Containment on Medium runs ${WAVE_COUNT} waves ` +
      `(specs/modes.md)`,
  );

  const watch = await watchReleases(h, WATCH_TICKS, {
    poll: POLL_FRAMES,
    // Held where it arrived: this point is about when a unit was released, and a
    // unit that walked off the floor would take lives with it mid-reading.
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  captureStill(h, "cadence");

  assertTrue(
    watch.waveBegan !== null,
    `precondition: the build phase for wave ${WAVE}, with its timer at 0 and ` +
      `the world gate open, started its wave (specs/waves.md)`,
  );
  assertGreaterThanOrEqual(
    watch.releases.length,
    MIN_INTERVALS + 1,
    `precondition: the wave released enough units to read ${MIN_INTERVALS} ` +
      `intervals off`,
  );

  // The first, on the frame the wave begins.
  const began = watch.waveBegan as number;
  assertLessThanOrEqual(
    watch.releases[0].at - began,
    OPENING_TOLERANCE,
    `the game time between the wave beginning at simTime ${began} and its ` +
      `first unit appearing, which specs/waves.md puts at 0 (measured on a ` +
      `${TICK_HZ} Hz sweep)`,
  );

  // And one every interval after it.
  for (let index = 1; index < watch.releases.length; index += 1) {
    const gap = watch.releases[index].at - watch.releases[index - 1].at;
    assertBetween(
      gap,
      WAVE_SPAWN_INTERVAL - INTERVAL_TOLERANCE,
      WAVE_SPAWN_INTERVAL + INTERVAL_TOLERANCE,
      `the game time between unit ${index} and unit ${index + 1} of wave ` +
        `${WAVE}, against the WAVE_SPAWN_INTERVAL of ${WAVE_SPAWN_INTERVAL}s ` +
        `specs/waves.md states`,
    );
  }
});
