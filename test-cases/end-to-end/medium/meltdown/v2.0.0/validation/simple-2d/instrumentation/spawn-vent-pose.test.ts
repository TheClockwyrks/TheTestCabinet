// Meltdown — instrumentation/spawn-vent-pose: `setSpawnVent` enters every unit
// the run releases at the posed vent.
//
// specs/instrumentation.md: "`setSpawnVent(vent)` poses the vent the run's own
// release enters units at ... While `spawnVent` holds a vent, every unit the
// spawner releases enters at that vent in place of the draw `specs/waves.md`
// states", and the pose "is reported as `spawnVent`".
//
// WHY THE POSE EXISTS. specs/waves.md draws each unit's vent at random, so a
// check about what one vent RELEASES — which tile a unit appears on when three of
// the opening's four are walled — has no way to arrange it except this pose. A
// build whose pose is reported but not obeyed sends half its units through the
// other vent, and every such check reads a draw instead of a scenario.
//
// BOTH VENTS ARE POSED, ON TWO FRESH WAVES, because a build that ignores the pose
// and always enters at the left vent passes a left-only leg outright. Each leg
// sends the wave (surge/release.ts) and reads the vent of the first units the
// release put on the floor, recorded the first time each is seen.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  type VentName,
} from "../harness";
import { poseWaveReady, watchRelease, watchSecondsFor } from "../surge/release";

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open a wave with `vent` posed, and hand back the vent of every unit read. */
async function ventsReleasedUnder(vent: VentName): Promise<VentName[]> {
  poseWaveReady(h, WAVE);
  h.debug.setSpawnVent(vent);
  assertEqual(
    h.snapshot().spawnVent,
    vent,
    "the vent pose, read back off the snapshot as spawnVent",
  );
  const released = await watchRelease(h, {
    stopAfter: UNITS_READ,
    seconds: watchSecondsFor(UNITS_READ),
  });
  return released.map((unit) => unit.vent);
}

it("enters every released unit at the posed vent, left and top alike", async () => {
  const left = await ventsReleasedUnder("left");
  captureStill(h, "posed-left");
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
  captureStill(h, "posed-top");
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
