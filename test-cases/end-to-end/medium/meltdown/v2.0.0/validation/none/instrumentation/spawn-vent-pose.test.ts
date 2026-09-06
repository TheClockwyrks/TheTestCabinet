// Meltdown — instrumentation/spawn-vent-pose: `setSpawnVent` enters every unit
// the run releases at the posed vent.
//
// THE RULE. `specs/instrumentation.md`: "`setSpawnVent(vent)` poses the vent the
// run's own release enters units at ... While `spawnVent` holds a vent, every
// unit the spawner releases enters at that vent in place of the draw
// `specs/waves.md` states", and the pose "is reported as `spawnVent`".
//
// WHY THE POSE EXISTS. `specs/waves.md` draws each unit's vent at random, so a
// check about what one vent RELEASES — which tile a unit appears on when three
// of the opening's four are walled — has no way to arrange it except this pose.
// A build whose pose is reported but not obeyed sends half its units through the
// other vent, and every such check reads a draw instead of a scenario.
//
// BOTH VENTS ARE POSED, ON TWO FRESH WAVES, because a build that ignores the
// pose and always enters at the left vent passes a left-only leg outright. Each
// leg reads the vent of every unit the release put on the floor inside a fixed
// stretch of the wave, gathered as they arrive so a unit that leaks part way
// through is still counted where it entered.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { type Vent } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openWave, releaseSeconds, watchRelease } from "../surge/roster";

/** The wave released: wave 1 of a twenty-wave run, twelve Motes. */
const WAVE = 1;

/**
 * How many of the wave's units are read on each leg.
 *
 * A precondition on the sample, not a threshold on the build: eight releases is
 * enough that a build honouring the pose on some releases and drawing on others
 * is caught, and it is well short of the whole wave so the leg costs seconds.
 */
const UNITS_READ = 8;

/** How long the release is watched: the cadence of the units read, with slack. */
const WATCH_SECONDS = releaseSeconds(UNITS_READ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Open a wave with `vent` posed, and hand back the vent of every unit released. */
async function ventsReleasedUnder(vent: Vent): Promise<Vent[]> {
  await openWave(h, WAVE, "medium", async () => {
    await h.debug.setSpawnVent(vent);
  });
  assertEqual(
    (await h.snapshot()).spawnVent,
    vent,
    "the vent pose, read back off the snapshot as spawnVent",
  );
  const arrivals = await watchRelease(h, WATCH_SECONDS);
  return arrivals.map((arrival) => arrival.vent);
}

it("enters every released unit at the posed vent, left and top alike", async () => {
  const left = await ventsReleasedUnder("left");
  await captureStill(h, "posed-left");
  assertGreaterThanOrEqual(
    left.length,
    UNITS_READ,
    `precondition: units wave ${WAVE} released while "left" was posed`,
  );
  assertDeepEqual(
    [...new Set(left)],
    ["left"],
    `the vents of ${left.length} units released while "left" was posed ` +
      "(specs/instrumentation.md: every unit the spawner releases enters at " +
      "that vent)",
  );

  const top = await ventsReleasedUnder("top");
  await captureStill(h, "posed-top");
  assertGreaterThanOrEqual(
    top.length,
    UNITS_READ,
    `precondition: units wave ${WAVE} released while "top" was posed`,
  );
  assertDeepEqual(
    [...new Set(top)],
    ["top"],
    `the vents of ${top.length} units released while "top" was posed ` +
      "(specs/instrumentation.md: every unit the spawner releases enters at " +
      "that vent)",
  );
});
