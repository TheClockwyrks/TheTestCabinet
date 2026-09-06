// Meltdown — surge/single-type-waves: the units a Containment wave releases are
// all one type.
//
// THE RULE. `specs/waves.md`: "Each wave fields a single type, given by the wave
// number `w` and the run's wave count `n`." The one exception the specification
// names is The Hundred, "the one mode whose single wave is mixed", and that mode
// is not in scope here — `modes/hundred-releases-one-hundred` is where its
// onslaught is read.
//
// WHY THIS IS A SEPARATE ITEM FROM THE TYPE TABLE. `surge/wave-type-opening`,
// `surge/wave-type-cycle` and `surge/milestone-wave-carries-a-core` each read ONE
// unit per wave, so between them they decide which type a wave is and say nothing
// at all about the units behind it. A build that opened each wave with the right
// type and then drew the rest from the whole roster — a very natural way to write
// "the waves get more varied" and a completely different game to defend against —
// passes all three of them and is caught only here. That division is deliberate:
// this item reads several units of a wave, and those three read a whole
// progression.
//
// TWO WAVES, THE FRONT OF EACH. Wave 1 is a Mote wave and Wave 4 a Swarm wave
// (`specs/waves.md`), one from either end of the opening list, and the first
// eight units of each are read. A build that cycles the types one unit at a time
// shows a second type by its second unit, and eight units cover the five-type
// roster with room over; the Swarm is not the type a wave-1 build would default
// to, so a build that released the run's opening type throughout is named here
// as well. The watch stops as soon as it has its eight, so the reading costs the
// same whatever size the build gives the wave and never waits on a forty-unit
// release.
//
// EVERY UNIT READ IS COUNTED, INCLUDING ONE ALREADY GONE. The sweep records each
// unit the first time it is seen and never forgets it (`surge/roster.ts`), so a
// unit of another type that leaked before the reading closed is read exactly as
// one still on the floor.
//
// THE LIVES ARE POSED PAST EVERY LEAK, so the run cannot end half way through the
// wave being read; and how MANY units a wave releases is `surge/wave-size`'s, so
// the only count asserted here is the one that makes the claim non-vacuous.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { waveType } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openWave, releaseSeconds, watchRelease } from "./roster";

/** The run and the waves read: a Mote wave and a Swarm wave of a twenty-wave run. */
const WAVE_COUNT = 20;
const WAVES = [1, 4] as const;

/**
 * How many units of each wave are read: eight.
 *
 * More than the five types the roster holds, so a build that cycled the roster
 * per unit shows every type inside the reading, and fewer than either wave
 * releases (`specs/waves.md` gives Wave 1 twelve units and Wave 4 forty), so the
 * reading never runs a wave out.
 */
const UNITS_READ = 8;

/**
 * The fewest units that make "every unit is the same type" mean anything: two.
 *
 * A wave that released one unit satisfies the claim vacuously, so the reading
 * would say nothing about the build. This is not an assertion about how many the
 * wave releases — that figure is `surge/wave-size`'s — only the floor below which
 * this item could not have decided anything.
 */
const MIN_UNITS_READ = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("fields one type across the front of a Mote wave and of a Swarm wave", async () => {
  const read: { wave: number; expected: string; arrivals: { type: string }[] }[] =
    [];
  for (const wave of WAVES) {
    await openWave(h, wave);
    const arrivals = await watchRelease(
      h,
      releaseSeconds(UNITS_READ),
      UNITS_READ,
    );
    read.push({ wave, expected: waveType(wave, WAVE_COUNT), arrivals });
  }
  await captureStill(h, "single");

  for (const { wave, expected, arrivals } of read) {
    assertGreaterThan(
      arrivals.length,
      MIN_UNITS_READ - 1,
      `precondition: units wave ${wave} released, over which the single type ` +
        "is read",
    );
    const types = [...new Set(arrivals.map((arrival) => arrival.type))];
    for (const [index, arrival] of arrivals.entries()) {
      assertEqual(
        arrival.type,
        expected,
        `unit ${index + 1} of ${arrivals.length} read on wave ${wave}, which ` +
          `fields the single type ${expected} (specs/waves.md); the types the ` +
          `build released were ${JSON.stringify(types)}`,
      );
    }
  }
});
