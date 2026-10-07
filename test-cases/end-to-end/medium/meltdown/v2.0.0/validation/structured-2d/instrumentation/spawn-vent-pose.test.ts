// Meltdown — instrumentation/spawn-vent-pose: `setSpawnVent` enters every unit
// the run releases at the posed vent.
//
// `specs/instrumentation.md`: "`setSpawnVent(vent)` poses the vent the run's own
// release enters units at ... While `spawnVent` holds a vent, every unit the
// spawner releases enters at that vent in place of the draw `specs/waves.md`
// states", and the pose "is reported as `spawnVent`".
//
// WHY THE POSE EXISTS. `specs/waves.md` draws each unit's vent at random, so a
// check about what one vent RELEASES — which tile a unit appears on when three of
// the opening's four are walled — has no way to arrange it except this pose. A
// build whose pose is reported but not obeyed sends half its units through the
// other vent, and every such check reads a draw instead of a scenario.
//
// BOTH VENTS ARE POSED, ON TWO FRESH WAVES, because a build that ignores the pose
// and always enters at the left vent passes a left-only leg outright. Each leg
// hands the spawner a short wave and reads the vent of every unit it released,
// each held where it arrived so none leaks and takes lives with it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  type Harness,
  type VentName,
} from "../harness";
import { poseWavePhase, watchReleases } from "../surge/scenario";

/** The wave the units are released for; its type is nothing to do with this point. */
const WAVE = 1;

/**
 * How many units the spawner is handed on each leg, and read.
 *
 * A precondition on the sample, not a threshold on the build: eight releases is
 * enough that a build honouring the pose on some releases and drawing on others
 * is caught, and the leg costs seconds.
 */
const UNITS_READ = 8;

/**
 * Seconds of game time each leg is watched for: the cadence of the units read
 * with two seconds over, for a build whose release clock runs a little slow.
 */
const WATCH_TICKS = driveFrames(UNITS_READ * WAVE_SPAWN_INTERVAL + 2);

/** Frames between two samples: two of the long-drive clock's. */
const POLL_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open a wave with `vent` posed, and hand back the vent of every unit released. */
async function ventsReleasedUnder(vent: VentName): Promise<VentName[]> {
  poseWavePhase(h, WAVE, UNITS_READ, "containment", "medium");
  h.debug.setSpawnVent(vent);
  assertEqual(
    h.snapshot().spawnVent,
    vent,
    "the vent pose, read back off the snapshot as spawnVent",
  );
  const watch = await watchReleases(h, WATCH_TICKS, {
    poll: POLL_FRAMES,
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  return watch.releases.map((release) => release.vent);
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
