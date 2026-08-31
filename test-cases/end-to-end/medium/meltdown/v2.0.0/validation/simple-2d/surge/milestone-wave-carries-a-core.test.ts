// surge/milestone-wave-carries-a-core — the halfway wave and the last wave field a
// Core, whatever the list or the cycle would have given.
//
// THE RULE. specs/waves.md, What a wave carries:
//
//   milestoneWaves(n) = [round(n / 2), n]
//   waveType(w, n) = "core" if w = n or w = round(n / 2) ...
//
// and, in prose: "The two milestone waves, `round(n / 2)` and `n`, are Core waves
// whatever the opening list or the cycle would otherwise give." `round` rounds a
// half upward, so the milestones are `8` and `15` in a 15-wave run, `10` and `20`
// in a 20-wave run, and `13` and `26` in a 26-wave run.
//
// ALL THREE DIFFICULTIES, BECAUSE THE RULE IS ABOUT `n` AND NOT ABOUT A WAVE
// NUMBER. specs/modes.md gives Containment 15, 20 and 26 waves at Easy, Medium and
// Hard, so the halfway milestone lands on 8, 10 and 13 — one of which is inside the
// opening list's range and two of which are inside the cycle's. A build that hard
// coded the pair for the 20-wave run reads a Core on the right waves at Medium and
// on the wrong ones at either end; one that rounded `n / 2` down reads wave 7 at
// Easy and wave 13 at Hard, of which only the second is right.
//
// EACH OF THE SIX IS ALSO A WAVE THE LIST OR THE CYCLE WOULD HAVE GIVEN SOMETHING
// ELSE, which is what makes the reading a reading of the OVERRIDE. Easy's wave 8 is
// the opening list's Hulk; Easy's 15, Medium's 10 and Medium's 20 are all the
// cycle's Sprint; Hard's 13 is the cycle's Hulk and Hard's 26 its Swarm. Not one is
// a wave whose ordinary type is already a Core, so a build with no override at all
// fails every one of the six, and the check states that expectation for itself
// rather than trusting it: the type the un-overridden rule would give is computed
// beside each reading and required to differ.
//
// THE TYPE IS READ OFF THE UNIT THE RUN RELEASED (surge/release.ts), with the world
// gate on and the wave begun by the send key, and only the first arrival is read
// because a milestone wave releases exactly one unit anyway — `wave-size` is the
// point that says so.
//
// WHAT EVERY WRONG MODEL READS. A build with no milestone rule reads the list's or
// the cycle's type on all six; one that made only the LAST wave a Core reads a Core
// on three of the six and the cycle's type on the other three; one that rounded the
// halfway wave down reads a Core one wave early at Easy and at Medium.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_CYCLE, WAVE_OPENING, milestoneWaves } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type DifficultyName,
  type Harness,
  type SurgeType,
} from "../harness";
import { poseWaveReady, watchRelease, wavesIn } from "./release";

/** The three Containment difficulties, whose wave counts are 15, 20 and 26. */
const DIFFICULTIES: readonly DifficultyName[] = ["easy", "medium", "hard"];

/** The type this milestone wave carries, whatever else it would have. */
const MILESTONE_TYPE: SurgeType = "core";

/**
 * How long a milestone wave is watched: four seconds of game time.
 *
 * Geometry rather than a tolerance. A milestone wave releases one unit, on the
 * frame the wave begins (specs/waves.md), so a correct build has already released
 * it when the send's own frame closes; four seconds carries a build several cadence
 * intervals late.
 */
const WATCH_SECONDS = 4;

/**
 * How long the last of the six drives is left running for the RECORDING: two
 * seconds of game time.
 *
 * Evidence rather than a reading, and nothing is asserted across it. A milestone
 * wave is one unit released on one frame, so a recording armed around the send
 * alone would be a single frame; two seconds of the Core walking out of its vent
 * is what a reviewer can actually look at. Two hundred and forty frames of this
 * suite's clock sits inside the recorder's own frame cap, so the section is written
 * whole.
 */
const CROSSING_TICKS = ticksFor(2);

/**
 * What `specs/waves.md`'s opening list and cycle would give wave `w`, with the
 * milestone override left out.
 *
 * Computed here rather than taken from `waveType`, because what this point needs is
 * exactly the branch the override replaces: it is how the check states, for itself,
 * that each of the six waves it drives is a wave where the override CHANGES
 * something.
 */
function unoverriddenType(w: number): SurgeType {
  return w <= WAVE_OPENING.length
    ? WAVE_OPENING[w - 1]
    : WAVE_CYCLE[(w - 9) % WAVE_CYCLE.length];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fields a Core on round(N / 2) and on N at every difficulty", async () => {
  const fielded: {
    difficulty: DifficultyName;
    waves: number;
    wave: number;
    type: SurgeType;
  }[] = [];

  const targets: { difficulty: DifficultyName; waves: number; wave: number }[] =
    [];
  for (const difficulty of DIFFICULTIES) {
    const waves = wavesIn("containment", difficulty);
    for (const wave of milestoneWaves(waves)) {
      targets.push({ difficulty, waves, wave });
    }
  }

  for (const [index, target] of targets.entries()) {
    // The recording is armed around the LAST of the six and no wider: the section a
    // reviewer wants is one milestone wave releasing its Core and that Core
    // crossing the floor, not six sends back to back.
    const last = index === targets.length - 1;
    const drive = async (): Promise<string> => {
      poseWaveReady(h, target.wave, "containment", target.difficulty);
      const released = await watchRelease(h, {
        stopAfter: 1,
        seconds: WATCH_SECONDS,
      });
      assertGreaterThanOrEqual(
        released.length,
        1,
        `precondition: ${target.difficulty} wave ${target.wave} released a ` +
          `unit once it was sent`,
      );
      if (last) await h.advance(CROSSING_TICKS);
      return released[0].type;
    };
    const type = last ? await captureReplay(h, "core", drive) : await drive();
    fielded.push({ ...target, type: type as SurgeType });
  }

  for (const entry of fielded) {
    const otherwise = unoverriddenType(entry.wave);
    assertNotEqual(
      otherwise,
      MILESTONE_TYPE,
      `precondition: ${entry.difficulty} wave ${entry.wave} is a wave the ` +
        `list or the cycle would have given something other than a Core, so ` +
        `the reading is a reading of the override`,
    );
    assertEqual(
      entry.type,
      MILESTONE_TYPE,
      `the type wave ${entry.wave} of the ${entry.waves}-wave ` +
        `${entry.difficulty} run fielded, where the cycle would have given ` +
        `${otherwise}`,
    );
  }
});
