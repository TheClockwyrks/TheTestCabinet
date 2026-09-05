// instrumentation/wave-count-matches-the-spawner — the units a wave counts are
// the units it releases.
//
// specs/instrumentation.md, of the `waveCount` reading: "waveCount reports the
// live wave's OWN schedule — the sequence of releases the spawner is working
// through ... The count is that schedule rather than a figure kept beside it: the
// units a wave releases are exactly the ones it counts, so a wave whose schedule
// holds six Motes reads `6` for `mote` from the frame it launched to the frame it
// cleared." specs/enemies.md settles that schedule when the wave begins.
//
// WHY THIS CHECK EXISTS. Five composition points of specs/enemies.md — the air
// cadence, the milestone Dynamos, the opening waves, the Cluster and Slug unlock,
// and the growth floor — and `difficulty/milestones-by-difficulty` beside them
// all read their verdict off `waveCount` rather than off tens of seconds of units
// walking the yard. That is only sound if the count and the behaviour agree, so
// the expensive mapping is driven HERE, once, over one wave, instead of once per
// composition rule. A build whose spawner releases something other than what it
// counts fails this point and nothing else, which is where that defect belongs.
//
// ONE WAVE EXERCISES EVERY COUNTABLE TYPE. Wave `20` of the `40`-wave Easy run is
// simultaneously a milestone (specs/enemies.md: one Dynamo), a multiple of four
// (Filaments), and well past the wave-`5` Cluster and Slug unlock, so a single
// wave can carry all six roster types.
//
// WHAT IS ASSERTED, in both directions. Every type counted at launch arrives that
// many times, and every unit that arrives was counted — so neither a build that
// counts a Dynamo it never releases nor one that releases a Dynamo it never
// counted passes. The count is also read again at every sample while the wave
// runs and held to the launch reading, which is the "from the frame it launched to
// the frame it cleared" half of the sentence: a build that counts down as it
// spawns, or that recomposes mid-wave, fails there.
//
// HOW THE WAVE IS READ is `load/waves.ts`'s own drive: poll, record every unit by
// id, sweep the yard with `clearUnits` — which kills nothing and leaks nothing —
// and stop when the wave goes inactive.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTruthy } from "../assert";
import { captureReplay, type Harness } from "../harness";
import { LOAD_TYPES } from "../constants";
import {
  composition,
  countOf,
  createWaveHarness,
  launchWave,
  openWave,
  readReleased,
  type Composition,
} from "../load/waves";

/** The run the wave is read on. */
const DIFFICULTY = "easy";

/**
 * The one wave driven: a milestone, a multiple of four, and past the Cluster and
 * Slug unlock, so its schedule can hold every one of the six roster types.
 */
const WAVE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("releases exactly the units the live wave counts", async () => {
  await openWave(h, WAVE, DIFFICULTY);

  const across: Composition[] = [];
  const { counted, released } = await captureReplay(h, "arrives", async () => {
    await launchWave(h, WAVE);
    const atLaunch = await composition(h);
    const arrived = await readReleased(h, WAVE, async (s) => {
      if (s.waveActive) across.push(await composition(h));
    });
    return { counted: atLaunch, released: arrived };
  });

  // The count never moved while the wave was live.
  for (const reading of across) {
    for (const type of LOAD_TYPES) {
      assertEqual(
        reading[type],
        counted[type],
        `waveCount("${type}") to read the same figure across the whole of ` +
          `wave ${WAVE}, as it did on the frame the wave launched`,
      );
    }
  }

  // Nothing counted failed to arrive, and nothing arrived that was not counted.
  for (const type of LOAD_TYPES) {
    assertEqual(
      countOf(released, type),
      counted[type],
      `the ${type}s wave ${WAVE} released against the ${counted[type]} its ` +
        `own schedule counts (specs/instrumentation.md)`,
    );
  }
  assertEqual(
    countOf(released, "overload"),
    0,
    `wave ${WAVE} to release no Overload Dynamo: the finale's unit is not a ` +
      "unit a wave releases (specs/enemies.md)",
  );
  assertEqual(
    await h.debug.waveCount("overload"),
    0,
    'waveCount("overload") off the cleared wave (specs/instrumentation.md)',
  );

  assertTruthy(
    across.length > 0,
    `wave ${WAVE} to still be running on the reading after its launch, so the ` +
      "count is read at least once mid-wave",
  );
});
