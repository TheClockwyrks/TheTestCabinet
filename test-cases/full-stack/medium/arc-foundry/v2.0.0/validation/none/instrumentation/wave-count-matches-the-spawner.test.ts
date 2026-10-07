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
// the expensive mapping is driven HERE, once, instead of once per composition
// rule. A build whose spawner releases something other than what it counts fails
// this point and nothing else, which is where that defect belongs.
//
// TWO WAVES ARE DRIVEN, AND BETWEEN THEM THEY REACH THE WHOLE ROSTER. What this
// point decides is that the count and the releases are one schedule, in both
// directions: a type the schedule holds has to arrive as many times as it is
// counted, and a type it does not hold has to be counted `0` and never arrive.
//
// Wave `1` alone would settle that over Motes and Sparks, because the opening
// rule of specs/enemies.md gives it nothing else, and the composition points that
// lean on `waveCount` are about the types it does NOT carry — the Filaments of
// the air cadence, the milestone Dynamos, the Clusters and Slugs of the unlock.
// So a milestone wave is driven beside it: specs/enemies.md puts a Dynamo on
// `round(N / 2)`, its number is a multiple of `4` so the air cadence puts
// Filaments there too, and it sits past the wave `5` the Cluster and the Slug
// unlock at. A build that counts a Dynamo it never releases fails there.
//
// Both waves are read to their clear through the emptying of `load/waves.ts`
// rather than by walking their units across the yard, so the cost is the length
// of the two schedules and not of the walk.
//
// WHAT IS ASSERTED, in both directions. Every type counted at launch arrives that
// many times, and every unit that arrives was counted — so neither a build that
// counts a Spark it never releases nor one that releases a Spark it never counted
// passes. The count is also read again at every sample while the wave runs and
// held to the launch reading, which is the "from the frame it launched to the
// frame it cleared" half of the sentence: a build that counts down as it spawns,
// or that recomposes mid-wave, fails there.
//
// HOW THE WAVE IS READ is `load/waves.ts`'s own drive: poll, record every unit by
// id, sweep the yard with `clearUnits` — which kills nothing and leaks nothing —
// and stop when the wave goes inactive.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTruthy } from "../assert";
import { captureReplay, type Harness } from "../harness";
import { difficultyById, LOAD_TYPES, milestoneWaves } from "../constants";
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
 * The two waves driven: the opening wave, and the middle milestone of the run.
 */
const WAVES: readonly number[] = [
  1,
  milestoneWaves(difficultyById(DIFFICULTY).waves)[0],
];

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("releases exactly the units each live wave counts", async () => {
  const drives = await captureReplay(h, "arrives", async () => {
    const read = [];
    for (const wave of WAVES) {
      await openWave(h, wave, DIFFICULTY);
      const across: Composition[] = [];
      await launchWave(h, wave);
      const counted = await composition(h);
      const released = await readReleased(h, wave, async (s) => {
        if (s.waveActive) across.push(await composition(h));
      });
      read.push({
        wave,
        counted,
        released,
        across,
        left: await h.debug.waveCount("overload"),
      });
    }
    return read;
  });

  for (const drive of drives) {
    // The count never moved while the wave was live.
    for (const reading of drive.across) {
      for (const type of LOAD_TYPES) {
        assertEqual(
          reading[type],
          drive.counted[type],
          `waveCount("${type}") to read the same figure across the whole of ` +
            `wave ${drive.wave}, as it did on the frame the wave launched`,
        );
      }
    }

    // Nothing counted failed to arrive, and nothing arrived that was not counted.
    for (const type of LOAD_TYPES) {
      assertEqual(
        countOf(drive.released, type),
        drive.counted[type],
        `the ${type}s wave ${drive.wave} released against the ` +
          `${drive.counted[type]} its own schedule counts ` +
          "(specs/instrumentation.md)",
      );
    }
    assertEqual(
      countOf(drive.released, "overload"),
      0,
      `wave ${drive.wave} to release no Overload Dynamo: the finale's unit is ` +
        "not a unit a wave releases (specs/enemies.md)",
    );
    assertEqual(
      drive.left,
      0,
      'waveCount("overload") off the cleared wave (specs/instrumentation.md)',
    );

    assertTruthy(
      drive.across.length > 0,
      `wave ${drive.wave} to still be running on the reading after its launch, ` +
        "so the count is read at least once mid-wave",
    );
  }
});
