// Meltdown — instrumentation/spawn-vent-pose-cleared: `setSpawnVent(null)`
// returns the release to its own draw.
//
// `specs/instrumentation.md`: "while it holds `null` the spawner draws as it
// does in play", and `specs/waves.md`: "Each unit's vent is drawn at random as
// it is released, the two vents equally likely."
//
// TWO LEGS OF ONE WAVE. The wave opens with the left vent posed, and the first
// few releases are read as the precondition that the pose held. The pose is then
// cleared MID-RELEASE, and the rest of the wave is watched: a draw at "equally
// likely" over the thirty-odd units left puts both vents on the floor with a
// probability short of certainty by less than one part in a thousand million, so
// a build whose clear does nothing — every later unit still entering on the left
// — is named, and so is a build that treats `null` as a vent.
//
// EVERY UNIT IS HELD WHERE IT ARRIVED, so the whole wave is released: a wave left
// to walk would be leaking before it had finished arriving, and a run whose lives
// ran out would stop releasing (`specs/waves.md`).

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

/** How many units the spawner is handed in all. */
const UNITS = 40;

/** How many units are released under the pose before it is cleared. */
const POSED_UNITS = 4;

/**
 * The fewest units the second leg must read for the draw to be decidable.
 *
 * A precondition on the sample: over thirty draws at "equally likely", both vents
 * appear with all but a thousand-millionth of certainty.
 */
const MIN_DRAWN = 30;

/**
 * Seconds of game time each leg is watched for: the cadence of the units it
 * expects with slack over, for a build whose release clock runs a little slow.
 * A posed `wave` phase "runs no entry effect" (`specs/instrumentation.md`), so
 * the first release may land a whole interval in; the first leg therefore runs
 * half an interval past the fourth release's latest frame and reads whatever the
 * pose released by then, and the second runs the wave out.
 */
const POSED_TICKS = driveFrames((POSED_UNITS + 0.5) * WAVE_SPAWN_INTERVAL);
const DRAWN_TICKS = driveFrames(
  (UNITS - POSED_UNITS) * WAVE_SPAWN_INTERVAL + 3,
);

/** Frames between two samples: two of the long-drive clock's. */
const POLL_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws both vents again once the pose is cleared", async () => {
  poseWavePhase(h, WAVE, UNITS, "containment", "medium");
  h.debug.setSpawnVent("left");
  const posed = await watchReleases(h, POSED_TICKS, {
    poll: POLL_FRAMES,
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
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  captureStill(h, "resumed");
  const vents = drawn.releases
    .filter((release) => !already.has(release.id))
    .map((release) => release.vent);

  assertGreaterThanOrEqual(
    vents.length,
    MIN_DRAWN,
    "precondition: units released after the pose was cleared",
  );
  assertContains(
    vents,
    "left",
    `the vents of ${vents.length} units released after the pose was cleared ` +
      "(specs/instrumentation.md: the spawner draws as it does in play)",
  );
  assertContains(
    vents,
    "top",
    `the vents of ${vents.length} units released after the pose was cleared ` +
      "(specs/instrumentation.md: the spawner draws as it does in play)",
  );
});
