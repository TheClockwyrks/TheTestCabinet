// Meltdown — instrumentation/spawn-vent-pose-cleared: `setSpawnVent(null)`
// returns the release to its own draw.
//
// `specs/instrumentation.md`: "while it holds `null` the spawner draws as it
// does in play", and `specs/waves.md`: "Each unit's vent is drawn at random as
// it is released, the two vents equally likely."
//
// TWO LEGS OF ONE WAVE. The wave opens with the left vent posed, and the first
// few releases are read as the precondition that the pose held. The pose is then
// cleared MID-RELEASE, `spawnVent` is read back as `null`, and a handful more
// units are released: each of them enters at a vent the specification names, so
// a build that treats `null` as a vent, or that stops releasing once the pose is
// gone, is named. Which vent each draw lands on is the draw's own; that the draw
// varies at all is `surge/vent-drawn-at-random`, decided on the draw alone.
//
// EVERY UNIT IS HELD WHERE IT ARRIVED, so a unit is counted where it entered and
// none walks far enough to leak. The spawner is handed exactly the units the two
// legs read, and each watch stops as soon as it has its units.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
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
} from "../harness";
import { poseWavePhase, watchReleases } from "../surge/scenario";

/** The wave the units are released for; its type is nothing to do with this point. */
const WAVE = 1;

/** The two vents the specification allows a released unit. */
const VENTS = ["left", "top"] as const;

/** How many units are released under the pose before it is cleared. */
const POSED_UNITS = 4;

/** How many units are read after the pose is cleared. */
const DRAWN_UNITS = 6;

/** How many units the spawner is handed in all: the two legs' worth. */
const UNITS = POSED_UNITS + DRAWN_UNITS;

/**
 * Seconds of game time each leg may run for: the cadence of the units it
 * expects with a whole interval over, for a build whose release clock runs a
 * little slow. A posed `wave` phase "runs no entry effect"
 * (`specs/instrumentation.md`), so the first release may land a whole interval
 * in. Each watch stops as soon as it has read its units, so the ceiling is what a
 * build that stopped releasing runs out.
 */
const POSED_TICKS = driveFrames((POSED_UNITS + 1) * WAVE_SPAWN_INTERVAL);
const DRAWN_TICKS = driveFrames((DRAWN_UNITS + 1) * WAVE_SPAWN_INTERVAL);

/** Frames between two samples: two of the long-drive clock's. */
const POLL_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each unit's vent again once the pose is cleared", async () => {
  poseWavePhase(h, WAVE, UNITS, "containment", "medium");
  h.debug.setSpawnVent("left");
  const posed = await watchReleases(h, POSED_TICKS, {
    poll: POLL_FRAMES,
    stopAfter: POSED_UNITS,
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  assertGreaterThanOrEqual(
    posed.releases.length,
    POSED_UNITS,
    "precondition: units released while the left vent was posed",
  );
  assertDeepEqual(
    [...new Set(posed.releases.map((release) => release.vent))],
    ["left"],
    "precondition: the vents of the units released under the pose",
  );

  h.debug.setSpawnVent(null);
  assertEqual(
    h.snapshot().spawnVent,
    null,
    "the vent pose, read back as spawnVent after setSpawnVent(null)",
  );
  // A fresh watch counts everything standing as an arrival, so the units the
  // posed leg released are set aside by id.
  const already = new Set(posed.releases.map((release) => release.id));
  const drawn = await watchReleases(h, DRAWN_TICKS, {
    poll: POLL_FRAMES,
    stopAfter: already.size + DRAWN_UNITS,
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  captureStill(h, "resumed");
  const vents = drawn.releases
    .filter((release) => !already.has(release.id))
    .map((release) => release.vent);

  assertGreaterThanOrEqual(
    vents.length,
    DRAWN_UNITS,
    "the units released after the pose was cleared " +
      "(specs/instrumentation.md: the spawner draws as it does in play)",
  );
  for (const [index, vent] of vents.entries()) {
    assertContains(
      VENTS,
      vent,
      `unit ${index + 1} after the pose was cleared: the vent it entered at ` +
        "(specs/instrumentation.md: the spawner draws as it does in play)",
    );
  }
});
