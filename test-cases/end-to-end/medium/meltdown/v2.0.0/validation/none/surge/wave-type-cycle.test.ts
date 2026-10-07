// Meltdown — surge/wave-type-cycle: past the opening list the five types repeat
// on a five-wave cycle.
//
// THE RULE. `specs/waves.md`: `waveType(w, n)` is `WAVE_CYCLE[(w - 9) mod 5]`
// once `w` is past `8`, with `WAVE_CYCLE = [mote, sprint, swarm, drift, hulk]`.
// The spec then spells out the answer for the run read here: in a twenty-wave run
// "Waves 11 through 19 read Swarm, Drift, Hulk, Mote, Sprint, Swarm, Drift, Hulk,
// Mote."
//
// EVERY WAVE FROM 9 TO 19 IS READ EXCEPT THE MILESTONE. Wave `round(20 / 2)` is
// `10`, which the milestone rule overrides whatever the cycle would give
// (`surge/milestone-wave-carries-a-core` decides that), so the ten waves left are
// 9 and 11 through 19. Ten of them is two full turns of a five-long cycle, which
// is what makes this a reading of a CYCLE: a build that ran the list once and
// then repeated its last entry, or that reset the cycle after the milestone, or
// that carried on indexing the opening list, agrees with the rule for the first
// turn and diverges in the second.
//
// WHERE THE CYCLE IS ANCHORED IS THE WHOLE DIFFICULTY. `(w - 9) mod 5` starts the
// cycle at Wave 9, so Wave 9 is a Mote and Wave 14 is a Mote again. A build that
// anchored at Wave 8, or at Wave 1, or that let the milestone consume a place in
// the cycle, produces a rotation of the same five types — which is why the
// assertion names the wave and the expected type rather than checking that the
// five types all appear.
//
// WHY THE WAVE IS RELEASED FOR REAL. What a wave carries is the unit that comes
// out of the vent, not a field the panel previews, so the run's own release is
// turned back on and the wave is begun with a send (`surge/roster.ts`). One unit
// per wave is enough because `surge/single-type-waves` decides separately that a
// wave fields only one type.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { isMilestone, waveType } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { firstRelease, openWave } from "./roster";

/** The run the cycle is read in, and the span of it the cycle governs. */
const WAVE_COUNT = 20;
const FIRST_CYCLE_WAVE = 9;
const LAST_CYCLE_WAVE = 19;

/** Waves 9 through 19 with the milestone taken out: ten waves, two full turns. */
const CYCLE_WAVES: readonly number[] = Array.from(
  { length: LAST_CYCLE_WAVE - FIRST_CYCLE_WAVE + 1 },
  (_, index) => FIRST_CYCLE_WAVE + index,
).filter((wave) => !isMilestone(wave, WAVE_COUNT));

/** Which of them the picture is taken on: the first of the second turn. */
const PICTURE_WAVE = 14;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("cycles Mote, Sprint, Swarm, Drift, Hulk from wave 9 onward", async () => {
  const released: { wave: number; type: string }[] = [];

  for (const wave of CYCLE_WAVES) {
    await openWave(h, wave);
    const { unit } = await firstRelease(h);
    released.push({ wave, type: unit.type });
    if (wave === PICTURE_WAVE) await captureStill(h, "cycle");
  }

  for (const { wave, type } of released) {
    assertEqual(
      type,
      waveType(wave, WAVE_COUNT),
      `the type wave ${wave} of a ${WAVE_COUNT}-wave run releases, which ` +
        `WAVE_CYCLE[(${wave} - 9) mod 5] fixes (specs/waves.md); the whole ` +
        `run of waves the build released was ` +
        `${JSON.stringify(released.map((r) => `${r.wave}:${r.type}`))}`,
    );
  }
});
