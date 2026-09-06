// Meltdown — surge/vent-drawn-at-random: the release draws each unit's vent, so
// a wave uses both vents.
//
// THE RULE. `specs/waves.md`: "Each unit's vent is drawn at random as it is
// released, the two vents equally likely."
//
// WHAT IS READ. Forty units are released with no vent posed, and the vent of
// every one is recorded the frame it first appears. Both vents must appear: a
// build that sends every unit through one vent is a completely different game,
// with one corridor to defend rather than two, and over forty draws at "equally
// likely" a draw that ever chose the other vent would have to be extraordinarily
// unlucky to hide it, one run in five hundred thousand million. Whether the two
// come up in the stated proportion is `surge/vents-equally-likely`'s item,
// decided on the draw alone.
//
// EVERY UNIT IS HELD WHERE IT ARRIVED, so all forty draws happen: a wave left to
// walk would be leaking before it had finished arriving, and a run whose lives
// ran out would stop releasing (`specs/waves.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertGreaterThanOrEqual } from "../assert";
import { WAVE_SPAWN_INTERVAL } from "../constants";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  type Harness,
} from "../harness";
import { poseWavePhase, watchReleases } from "./scenario";

/** How many draws the reading is taken over. */
const DRAWS = 40;

/** The wave the units are released for; its type is nothing to do with this point. */
const WAVE = 1;

/**
 * Seconds of game time the release is watched for: the cadence of forty units
 * with three seconds over, for a build whose release clock runs a little slow.
 */
const WATCH_TICKS = driveFrames(DRAWS * WAVE_SPAWN_INTERVAL + 3);

/** Frames between two samples: two of the long-drive clock's. */
const POLL_FRAMES = 2;

/**
 * The fewest draws the reading is taken over.
 *
 * A precondition on the sample: over thirty draws, a fair draw shows both vents
 * with all but a thousand-millionth of certainty.
 */
const MIN_DRAWS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("uses both vents across a wave with no vent posed", async () => {
  poseWavePhase(h, WAVE, DRAWS, "containment", "medium");
  const watch = await watchReleases(h, WATCH_TICKS, {
    poll: POLL_FRAMES,
    onRelease: (release) => h.debug.setUnitMotion(release.id, false),
  });
  captureStill(h, "vents");
  const vents = watch.releases.map((release) => release.vent);

  assertGreaterThanOrEqual(
    vents.length,
    MIN_DRAWS,
    "precondition: the units the run released, each of which is one draw",
  );
  assertContains(
    vents,
    "left",
    `the left vent among the vents drawn over ${vents.length} units ` +
      "(specs/waves.md: the two vents equally likely)",
  );
  assertContains(
    vents,
    "top",
    `the top vent among the vents drawn over ${vents.length} units ` +
      "(specs/waves.md: the two vents equally likely)",
  );
});
