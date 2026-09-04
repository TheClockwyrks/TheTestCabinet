// waves/clearing-advances-the-wave — the wave number rises on the clear, and not
// on the release.
//
// specs/waves.md, Wave numbering: "The number rises by one when a wave clears,
// never when one is released." The same file states the consequence: "the current
// wave number is the wave being prepared for or fought."
//
// TWO LEGS, BECAUSE THE RULE HAS TWO HALVES AND ONE READING CANNOT SEE BOTH.
//
// THE CLEAR LEG poses the end of wave `7` and leaks its last unit away, then reads
// the number across that transition. It must rise by exactly `1`. Wave `7` rather
// than wave `1` so a build that reports a constant, or that numbers from `0`,
// lands on a different figure than a build that adds one: `8` is what the rule
// gives, `1` and `2` are what a build numbering the clear itself gives, and `14`
// is what a build doubling gives.
//
// THE RELEASE LEG lets a build timer run out with the world gate open, so the run
// releases a wave through its own spawner, and reads the number across THAT
// transition. It must not move. This is the half the rule spends a clause on, and
// the defect it names is the common one: a build that numbers the wave it is
// fighting from the moment it starts fighting it reads `2` on a floor that is
// still fighting Wave 1.
//
// THE RELEASE LEG IS STOPPED TWO SECONDS IN, well inside the wave. specs/waves.md
// releases a wave's units "one every `WAVE_SPAWN_INTERVAL` (`0.6`) seconds", so a
// wave of any size still has units pending two seconds after it began and cannot
// have cleared underneath the reading — which is what keeps the leg about the
// release alone.
//
// EACH LEG OPENS FROM `startRun`, which resets first, so neither stands on what the
// other left behind.
//
// WHAT EVERY WRONG MODEL READS. A build that never advances reads `7` after the
// clear; one that advances on the release reads `2` in the release leg; one that
// advances on both reads `2` there as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilGone } from "./run";

/** The wave cleared: a distinguishing number, neither the first nor the last. */
const WAVE = 7;

/** What a clear must add to the wave number (specs/waves.md). */
const RISE = 1;

/** The countdown posed on the release leg's build phase, in seconds. */
const COUNTDOWN = 0.5;

/**
 * The game time the release leg watches after its wave began: two seconds.
 *
 * More than three `WAVE_SPAWN_INTERVAL`s, so the release is plainly under way, and
 * far short of the time any wave takes to clear, so the number cannot move for the
 * other reason while the leg is reading it.
 */
const RELEASE_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds one to the wave number on the clear and nothing on the release", async () => {
  startRun(h);
  poseWaveEnd(h, WAVE);
  poseLeaker(h);

  const beforeClear = h.snapshot().wave;
  const cleared = await runUntilGone(h);
  const afterClear = h.snapshot().wave;
  captureStill(h, "advanced");

  startRun(h);
  h.debug.setPhase("building");
  h.debug.setBuildTimer(COUNTDOWN);
  h.debug.setWaveSpawning(true);
  const beforeRelease = h.snapshot().wave;
  await h.advance(ticksFor(COUNTDOWN) + RELEASE_TICKS);
  const released = h.snapshot();

  assertTrue(cleared, "precondition: the wave's last unit left the floor");
  assertEqual(
    afterClear - beforeClear,
    RISE,
    `the wave number's rise across the clear of wave ${WAVE}`,
  );

  assertEqual(
    released.phase,
    "wave",
    "precondition: the countdown released a wave",
  );
  assertEqual(
    released.wave,
    beforeRelease,
    "the wave number two seconds after a wave was released",
  );
});
