// surge/single-type-waves — every unit a Containment wave releases is the same
// type.
//
// THE RULE. specs/waves.md, What a wave carries: "Each wave fields a single type,
// given by the wave number `w` and the run's wave count `n`." The exception is
// named in the same sentence and is not this point's: "`specs/modes.md` names the
// one mode whose single wave is mixed", which is The Hundred, and the `modes` group
// decides it.
//
// WHY THE WAVE IS READ WITH THE RUN'S OWN SPAWNER ON. `addUnit` takes the type as
// an argument, so a floor posed unit by unit could only ever field the types the
// check asked for. The one way to find out what a wave fields is to let the run
// release it: the world gate goes on, the wave is begun with the send key, and
// every unit that comes out of a vent is recorded the first time it is seen
// (surge/release.ts).
//
// TWO WAVES, THE FRONT OF EACH. Wave 1 is a Mote wave and Wave 4 a Swarm wave
// (specs/waves.md), one from either end of the opening list, and the first eight
// units of each are read. A build that cycles the types one unit at a time — the
// shape The Hundred has, applied where it does not belong — shows a second type by
// its second unit, and eight units cover the five-type roster with room over. The
// watch stops as soon as it has its eight, so the reading costs the same whatever
// size the build gives the wave and never waits on a forty-unit release.
//
// WHAT THIS POINT DOES NOT DECIDE. Not WHICH type a wave fields — that is
// `wave-type-opening`, `wave-type-cycle` and `milestone-wave-carries-a-core` — and
// not how many it releases, which is `wave-size`. What is read here is the count of
// DISTINCT types among the units read of one wave, which the specification puts at
// exactly one.
//
// THE LIVES ARE POSED OUT OF REACH (surge/release.ts), so no leak can end the run
// and stop the release mid-reading.
//
// WHAT EVERY WRONG MODEL READS. A build that cycles the roster per unit reads five
// distinct types in eight units; one that released a wave of Cores alongside its
// own type reads two.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseWaveReady, watchRelease, watchSecondsFor } from "./release";

/**
 * The waves read: the run's first, and the first of another type.
 *
 * Wave 1 is a Mote wave and Wave 4 a Swarm wave in the 20-wave Containment run
 * `startRun` opens (specs/waves.md), so between them two types of the roster are
 * read as the single type of their wave.
 */
const WAVES = [1, 4] as const;

/**
 * How many units of each wave are read: eight.
 *
 * More than the five types the roster holds, so a build that cycled the roster
 * per unit shows every type inside the reading, and fewer than either wave
 * releases (specs/waves.md gives Wave 1 twelve units and Wave 4 forty), so the
 * reading never runs a wave out.
 */
const UNITS_READ = 8;

/**
 * The fewest units a reading is taken across.
 *
 * A wave that released one unit trivially fields one type, so a reading taken on it
 * would say nothing. This is the precondition that the wave actually released
 * something to be uniform ACROSS; how many it should have released is `wave-size`.
 */
const MIN_UNITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fields exactly one type in each wave it releases", async () => {
  const fielded: { wave: number; types: string[]; count: number }[] = [];

  for (const wave of WAVES) {
    poseWaveReady(h, wave);
    const released = await watchRelease(h, {
      stopAfter: UNITS_READ,
      seconds: watchSecondsFor(UNITS_READ),
    });
    fielded.push({
      wave,
      types: [...new Set(released.map((unit) => unit.type))].sort(),
      count: released.length,
    });
  }

  captureStill(h, "single");

  for (const entry of fielded) {
    assertGreaterThanOrEqual(
      entry.count,
      MIN_UNITS,
      `precondition: the units wave ${entry.wave} released, which must be more ` +
        `than one for uniformity to mean anything`,
    );
    assertLength(
      entry.types,
      1,
      `the distinct types among the ${entry.count} units wave ${entry.wave} ` +
        `released, which were ${entry.types.join(", ")}`,
    );
  }
});
