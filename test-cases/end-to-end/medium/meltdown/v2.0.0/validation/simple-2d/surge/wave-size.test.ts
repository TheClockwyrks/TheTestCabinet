// surge/wave-size — a wave releases the count its closed form gives it, and a
// milestone wave releases exactly one Core.
//
// THE RULE. specs/waves.md, What a wave carries:
//
//   waveSize(w, n) =
//     1                                                if waveType(w, n) = "core"
//     ceil(WAVE_BASE_COUNT[waveType(w, n)] * (1 + WAVE_GROWTH * (w - 1)))  otherwise
//
// with `WAVE_GROWTH` `0.22` and `WAVE_BASE_COUNT` `12` for the Mote, `10` for the
// Sprint, `24` for the Swarm, `8` for the Drift, `5` for the Hulk. So "Wave 1
// releases 12 Motes and a milestone wave releases exactly one Core".
//
// THE COUNT IS THE UNITS THE RUN ACTUALLY RELEASED, not `wavePending` and not
// `nextWave.count`. Those are what the build SAYS about the wave, and a build whose
// bookkeeping is right and whose spawner stops early would read correctly on either
// of them. So the world gate goes on, the wave is begun with the send key, and
// every unit that comes out of a vent is recorded the first time it is seen
// (surge/release.ts) — counted by identity, so a unit that leaks before the wave has
// finished releasing is still counted once and never twice.
//
// THREE WAVES, WHICH IS WHAT PINS ALL THREE TERMS OF THE FORM.
//
//   - Wave 1 is a Mote wave and `hpScale`-style growth is exactly `1` there, so it
//     reads `WAVE_BASE_COUNT` for the Mote back unscaled: `12`.
//   - Wave 3 is a Sprint wave, a different base with the growth engaged:
//     `ceil(10 * 1.44)` is `15`. A build that used one base count for every type
//     reads `12`-ish here, and one that dropped the growth reads `10`. The ceiling
//     is doing real work — `14.4` rounds UP — so a build that truncated reads `14`.
//   - Wave 10 is the halfway milestone of this 20-wave run, and the Core branch
//     replaces the whole formula: `1`. A build that applied the growth to the Core
//     wave as well reads three units where the rule says one.
//
// THE LIVES ARE POSED OUT OF REACH (surge/release.ts): a wave of fifteen Sprints
// released against an empty floor leaks most of itself, and lives running out would
// end the run and stop the release before it had finished.
//
// WHAT EVERY WRONG MODEL READS. A build with no growth reads `12`, `10`, `1`; one
// that truncated instead of taking the ceiling reads `12`, `14`, `1`; one with one
// base count for every type reads a Sprint wave the size of a Mote wave; one with no
// milestone branch reads `ceil(1 * 2.98)` — three — where the rule says one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  poseWaveReady,
  sizeOfWave,
  typeOfWave,
  watchRelease,
  watchSecondsFor,
  wavesIn,
} from "./release";

/**
 * The waves read: the unscaled base, a different base with the growth engaged, and
 * the halfway milestone.
 */
const WAVES = [1, 3, 10] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases 12 on wave 1, 15 on wave 3 and exactly one Core on the milestone", async () => {
  const waves = wavesIn();
  const released: { wave: number; count: number }[] = [];

  for (const wave of WAVES) {
    poseWaveReady(h, wave);
    const units = await watchRelease(h, {
      seconds: watchSecondsFor(sizeOfWave(wave, waves)),
    });
    released.push({ wave, count: units.length });
  }

  captureStill(h, "size");

  for (const entry of released) {
    assertEqual(
      entry.count,
      sizeOfWave(entry.wave, waves),
      `the units wave ${entry.wave} of a ${waves}-wave run released, which is ` +
        `a ${typeOfWave(entry.wave, waves)} wave`,
    );
  }
});
