// Meltdown — surge/single-type-waves: every unit a Containment wave releases is
// the same type.
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
// at all about the other thirty-nine units behind it. A build that opened each
// wave with the right type and then drew the rest from the whole roster — a very
// natural way to write "the waves get more varied" and a completely different
// game to defend against — passes all three of them and is caught only here.
// That division is deliberate: this item reads a whole wave, and those three read
// a whole progression.
//
// WAVE 4 IS THE ONE READ. `specs/waves.md` makes it a Swarm wave of
// `ceil(24 * 1.66)` — forty units, the largest release in the opening eight and
// the largest sample of one type the game offers before the milestone. Forty
// readings is what makes "every unit" a real claim rather than a coincidence, and
// the Swarm is not the type a wave-1 build would default to, so a build that
// released the run's opening type throughout is named here as well.
//
// EVERY UNIT IS COUNTED, INCLUDING THE ONES ALREADY GONE. The wave takes
// `39 * 0.6` seconds to release and a Swarm crosses an undefended floor in some
// fourteen, so the earliest are leaking while the last are still arriving. The
// sweep records each unit the first time it is seen and never forgets it
// (`surge/roster.ts`), so a wave that slipped one unit of another type in at the
// end is read exactly as one that opened with it.
//
// THE LIVES ARE POSED PAST EVERY LEAK, so the run cannot end half way through the
// wave being read; and how MANY units arrived is `surge/wave-size`'s, so the only
// count asserted here is the one that makes the claim non-vacuous.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { waveSize, waveType } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openWave, releaseSeconds, watchRelease } from "./roster";

/** The run and the wave read: a forty-unit Swarm wave of a twenty-wave run. */
const WAVE_COUNT = 20;
const WAVE = 4;

/** The single type `specs/waves.md` gives that wave. */
const EXPECTED_TYPE = waveType(WAVE, WAVE_COUNT);

/**
 * The fewest units that make "every unit is the same type" mean anything: two.
 *
 * A wave that released one unit satisfies the claim vacuously, so the reading
 * would say nothing about the build. This is not an assertion about how many the
 * wave releases — that figure is `surge/wave-size`'s — only the floor below which
 * this item could not have decided anything.
 */
const MIN_UNITS_READ = 2;

/** How far into the release the picture is taken, in seconds of game time. */
const PICTURE_SECONDS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("fields one type for the whole of a forty-unit Swarm wave", async () => {
  await openWave(h, WAVE);

  const early = await watchRelease(h, PICTURE_SECONDS);
  await captureStill(h, "single");
  const late = await watchRelease(
    h,
    releaseSeconds(waveSize(WAVE, WAVE_COUNT)) - PICTURE_SECONDS,
  );
  const arrivals = [...early, ...late];

  assertGreaterThan(
    arrivals.length,
    MIN_UNITS_READ - 1,
    `precondition: units wave ${WAVE} released, over which the single type is ` +
      "read",
  );
  for (const [index, arrival] of arrivals.entries()) {
    assertEqual(
      arrival.type,
      EXPECTED_TYPE,
      `unit ${index + 1} of ${arrivals.length} on wave ${WAVE}, which fields ` +
        `the single type ${EXPECTED_TYPE} (specs/waves.md); the types the ` +
        `build released were ` +
        `${JSON.stringify([...new Set(arrivals.map((a) => a.type))])}`,
    );
  }
});
