// surge/wave-type-cycle — from wave 9 the five types repeat on a cycle of five.
//
// THE RULE. specs/waves.md, What a wave carries:
//
//   waveType(w, n) = ... WAVE_CYCLE[(w - 9) mod 5]   otherwise
//   WAVE_CYCLE = [mote, sprint, swarm, drift, hulk]
//
// so wave 9 is a Mote wave, wave 10 a Sprint wave, and so on, repeating every five
// waves for as long as the run lasts. specs/waves.md spells the consequence out for
// the run this point drives: in a 20-wave run "Waves 11 through 19 read Swarm,
// Drift, Hulk, Mote, Sprint, Swarm, Drift, Hulk, Mote."
//
// THE MILESTONE WAVES ARE LEFT OUT, ON PURPOSE. specs/waves.md overrides the cycle
// on `round(n / 2)` and `n` — wave 10 and wave 20 of this run — with a Core, and
// `milestone-wave-carries-a-core` is the point that decides the override. Reading
// wave 10 here would be reading the override, and a build that got the cycle right
// and the override wrong would fail both points for the same defect. So the waves
// read are 9 and 11 through 19: ten waves, two full turns of the cycle and the
// start of a third.
//
// TWO FULL TURNS IS WHAT MAKES IT A CYCLE. One turn is satisfied by any list of
// five; a build that read the cycle from a list of ten, or that reset the index at
// each milestone, or that indexed on `w mod 5` rather than `(w - 9) mod 5`, all
// agree with a correct build somewhere in the first turn and part company inside
// the second. Every wave is read separately, so a failure names the wave.
//
// THE TYPE IS READ OFF THE UNIT THE RUN RELEASED (surge/release.ts), not off any
// field that reports a wave's composition, and only the first arrival is read
// because "each wave fields a single type" is `single-type-waves`.
//
// WHAT EVERY WRONG MODEL READS. A build that kept running the opening list past
// wave 8 reads whatever an eight-entry list gives on index nine and beyond; one
// that cycled on `w mod 5` reads the cycle rotated by four and fails on every wave;
// one that restarted the cycle after the halfway milestone reads Mote on wave 11
// where the rule says Swarm.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseWaveReady, typeOfWave, watchRelease, wavesIn } from "./release";
import { milestoneWaves } from "../constants";

/**
 * The waves the cycle governs in a 20-wave run: 9 through 19, less the milestone.
 *
 * The upper end is 19 rather than 20 because wave 20 is the run's last and the
 * second milestone; the lower end is 9 because that is where specs/waves.md hands
 * the progression from the opening list to the cycle.
 */
const CYCLE_WAVES = [9, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;

/**
 * How long one wave's first arrival is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance. specs/waves.md releases the first unit "on the
 * frame the wave begins", so three seconds carries a build several cadence
 * intervals late.
 */
const FIRST_ARRIVAL_SECONDS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("repeats Mote, Sprint, Swarm, Drift, Hulk from wave 9 on", async () => {
  const waves = wavesIn();
  const milestones = milestoneWaves(waves);
  const fielded: { wave: number; type: string }[] = [];

  for (const wave of CYCLE_WAVES) {
    // The list above is written for a 20-wave run; if the run this suite opens is
    // not that run, a milestone could fall inside it, and the override is another
    // point's. Guarded rather than assumed.
    if (milestones.includes(wave)) continue;
    poseWaveReady(h, wave);
    const released = await watchRelease(h, {
      stopAfter: 1,
      seconds: FIRST_ARRIVAL_SECONDS,
    });
    assertGreaterThanOrEqual(
      released.length,
      1,
      `precondition: wave ${wave} released a unit once it was sent`,
    );
    fielded.push({ wave, type: released[0].type });
  }

  captureStill(h, "cycle");

  for (const { wave, type } of fielded) {
    assertEqual(
      type,
      typeOfWave(wave, waves),
      `the type wave ${wave} of a ${waves}-wave run fielded`,
    );
  }
});
