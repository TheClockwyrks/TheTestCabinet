// Meltdown — surge/wave-type-opening: the first eight waves field the types the
// opening list names.
//
// THE RULE. `specs/waves.md`: `waveType(w, n)` is `WAVE_OPENING[w - 1]` for
// `w <= 8`, with `WAVE_OPENING = [mote, mote, sprint, swarm, mote, drift, mote,
// hulk]`. In a twenty-wave Containment run neither milestone — `round(20 / 2)` and
// `20` — falls inside that range, so all eight waves read straight off the list.
//
// EVERY ONE OF THE EIGHT IS READ, AND EACH IS ITS OWN READING. The list is not a
// formula: there is nothing to interpolate and no arithmetic that gets seven of
// them right by accident. A build that ordered them differently, that started the
// list at Wave 0, that repeated the first entry, or that reached for the cycle
// from the start is named by exactly the waves it got wrong — and the failure
// message says which wave and which type.
//
// WHY THE WAVE IS RELEASED FOR REAL AND NOT READ OFF `nextWave`. `nextWave` is a
// diagnostic the panel draws from; what a wave CARRIES is the unit that comes out
// of the vent. So the run's own release is turned back on and the wave is begun
// with a send (`surge/roster.ts`), which is what makes this one of the items the
// world gate belongs to, and the type read is the type of the first unit the
// spawner actually released.
//
// ONE UNIT PER WAVE IS ENOUGH, because `surge/single-type-waves` decides
// separately that every unit a wave releases is the same type. Between the two,
// the whole of `waveType` is covered without eight full releases: this item says
// which type the wave is, that one says the wave is only one type.
//
// THE SWEEP STOPS AT THE FIRST UNIT, sampling every frame, so what is read is the
// unit that entered rather than whatever is on the floor a second later — and
// nothing here depends on WHEN it entered, which is `surge/spawn-cadence`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WAVE_OPENING, waveType } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { firstRelease, openWave } from "./roster";

/** The waves the opening list covers: 1 through 8 (`specs/waves.md`). */
const OPENING_WAVES: readonly number[] = WAVE_OPENING.map(
  (_, index) => index + 1,
);

/** The run the list is read in: twenty waves, so no milestone lands inside it. */
const WAVE_COUNT = 20;

/** Which of the eight the picture is taken on: the first that is not a Mote. */
const PICTURE_WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("releases Mote, Mote, Sprint, Swarm, Mote, Drift, Mote, Hulk on waves 1 to 8", async () => {
  const released: { wave: number; type: string }[] = [];

  for (const wave of OPENING_WAVES) {
    await openWave(h, wave);
    const { unit } = await firstRelease(h);
    released.push({ wave, type: unit.type });
    if (wave === PICTURE_WAVE) await captureStill(h, "opening");
  }

  for (const { wave, type } of released) {
    assertEqual(
      type,
      waveType(wave, WAVE_COUNT),
      `the type wave ${wave} of a ${WAVE_COUNT}-wave run releases, which ` +
        `WAVE_OPENING[${wave - 1}] fixes (specs/waves.md); the whole list the ` +
        `build released was ${JSON.stringify(released.map((r) => r.type))}`,
    );
  }
});
