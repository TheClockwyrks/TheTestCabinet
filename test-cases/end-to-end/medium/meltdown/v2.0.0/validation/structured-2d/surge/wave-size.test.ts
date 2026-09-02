// Meltdown — surge/wave-size: a wave releases the count its form gives it.
//
// THE RULE. `specs/waves.md` fixes how many units a wave releases as a closed
// form: `1` when the wave is a Core wave, and otherwise
// `ceil(WAVE_BASE_COUNT[type] * (1 + WAVE_GROWTH * (w - 1)))` with `WAVE_GROWTH`
// `0.22`. It then states both readings this point takes in one sentence: "So Wave
// 1 releases 12 Motes and a milestone wave releases exactly one Core."
//
// FOUR WAVES, ONE FOR EACH WAY THE FORM CAN BE GOT WRONG. Wave 1 of a 20-wave
// Containment run is a Mote wave whose growth term is zero, so it reads the base
// count `12` straight — the intercept of the line. Wave 3 is a Sprint wave, base
// `10`, whose growth gives `10 * 1.44 = 14.4`: `ceil` makes that `15`, while
// rounding or flooring it makes `14`, so this is the wave that decides WHICH
// rounding the form uses. Wave 8 is a Hulk wave, base `5`, whose growth gives
// `5 * 2.54 = 12.7` and therefore `13` — nearly three times the base, so a build
// that dropped the growth term entirely cannot hide behind a rounding. And Wave 10
// is `round(20 / 2)`, a milestone, so the form's first branch replaces the count
// with `1` however large the growth would have made it.
//
// WHY THE RUN ENTERS ITS OWN WAVE. This is the one point in the group where the
// BUILD has to be the one that decides how many units are owed, so the wave cannot
// be posed: `setWavePending` would hand the build the very number under test. So
// the run is armed instead — a build phase for the wave with its timer at `0` and
// the world gate open — and `specs/waves.md`'s "Reaching `0` starts the wave" does
// the rest. That does mean a build whose timer never starts a wave fails here as
// well as at `waves/build-timer-auto-starts`; there is no other route to a wave
// the build sized itself, and the precondition below names the failure as a wave
// that never began rather than as a wrong count.
//
// HOW THE COUNT IS COUNTED. Every unit is recorded the first frame the roster
// holds its id, so the answer is the number of DISTINCT units the wave released
// and not the number standing on the floor at some chosen moment — a reading that
// would fall as units walked off. Each arrival is held where it arrived as well, so
// none of the twelve reaches an exhaust and takes lives with it.
//
// WHY THE WINDOW IS TWENTY-FOUR SECONDS. The largest of the four waves owes fifteen
// units, which at the stated `0.6`-second cadence are all out inside nine seconds.
// Twenty-four is geometry rather than a tolerance, and it is generous on purpose:
// it admits a build whose release clock runs at HALF the stated rate, so a wrong
// cadence is failed by `surge/spawn-cadence` and not by this point. A build that
// goes on releasing past its stated count is caught by the same window, because the
// extra units land inside it.
//
// WHAT EVERY WRONG MODEL READS. A build with no growth term reads `10` on wave 3
// and `5` on wave 8; one that rounded rather than took the ceiling reads `14` on
// wave 3; one that grew from `w` rather than from `w - 1` reads `15` on wave 1;
// one that forgot the Core override reads `31` on wave 10; one that used one base
// count for every type reads the same figure on waves 3 and 8 as it does on wave
// 1; one that released nothing fails the precondition. Each failure names the
// wave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { waveSize } from "../constants";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { armWave, watchReleases } from "./scenario";

/** The run this point is stated against: Containment on Medium, 20 waves. */
const WAVE_COUNT = 20;

/**
 * The waves read: the intercept, the rounding, the growth, and the override.
 *
 * `waveSize` gives them `12`, `15`, `13` and `1` in a 20-wave run, and no two of
 * the wrong models in the head land on all four.
 */
const WAVES = [1, 3, 8, 10] as const;

/**
 * Seconds of game time a wave is watched for: twenty-four.
 *
 * Geometry rather than a tolerance — how long the drive runs, not how far a build
 * may miss the count by. The largest wave read here owes fifteen units, which at
 * the stated `0.6`-second cadence are all out inside nine seconds; twenty-four
 * admits a build releasing at half that rate, so a wrong cadence is failed by
 * `surge/spawn-cadence` and not by this point. A build that goes on releasing past
 * its stated count is caught by the same window, because the extra units land
 * inside it.
 */
const WATCH_TICKS = ticksFor(24);

/** Frames between two samples: a twentieth of a second. */
const POLL_FRAMES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases waveSize(w, 20) units, and exactly one Core on a milestone", async () => {
  for (const wave of WAVES) {
    armWave(h, wave, "containment", "medium");
    assertEqual(
      h.snapshot().waveCount,
      WAVE_COUNT,
      `precondition: Containment on Medium runs ${WAVE_COUNT} waves ` +
        `(specs/modes.md)`,
    );

    const watch = await watchReleases(h, WATCH_TICKS, {
      poll: POLL_FRAMES,
      // Held where it arrived, so the count is of units released and not of
      // units that have not yet walked off the floor.
      onRelease: (release) => h.debug.setUnitMotion(release.id, false),
    });
    captureStill(h, "size");

    assertTrue(
      watch.waveBegan !== null,
      `precondition: the build phase for wave ${wave}, with its timer at 0 ` +
        `and the world gate open, started its wave (specs/waves.md)`,
    );
    assertEqual(
      watch.releases.length,
      waveSize(wave, WAVE_COUNT),
      `the units wave ${wave} of a ${WAVE_COUNT}-wave run released, against ` +
        `the waveSize(${wave}, ${WAVE_COUNT}) specs/waves.md states`,
    );
  }
});
