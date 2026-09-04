// swarm/entry-group-gap — the wave releases its groups ENTER_GROUP_GAP apart.
//
// specs/swarm.md, "The wave and its entrance": "The wave releases them in groups.
// It carries a clock that starts at zero when the wave opens and advances with
// game time while the wave's entry runs. A drone's group is released when that
// clock reaches `ENTER_GROUP_GAP` (`0.6`) seconds times the group's index,
// counted from `0`, so the first group is released as the wave opens and each
// later group `ENTER_GROUP_GAP` after the one before it. A drone that has not
// been released holds its starting point."
//
// HOW A RELEASE IS SEEN FROM OUTSIDE. A group is not a field of the snapshot, and
// it should not be: the specification leaves "how many drones a group holds, and
// which slot each takes" to the build. What IS observable is the rule's own
// consequence — an unreleased drone holds its starting point, and a released one
// starts travelling — so this reads the first frame each drone leaves the point
// it opened the wave on, and takes the moments those first motions fall on as the
// releases. Drones released together read the same moment, so the distinct
// moments are the groups and the gaps between them are what the specification
// fixes.
//
// WHY THE SAMPLES ARE MERGED, AND WHY THE MERGE CANNOT DECIDE THE VERDICT. A
// group is released inside one frame, so its drones' first motions land on the
// same frame or the one after it. Anything further apart than MERGE_WINDOW is
// therefore a different release — and MERGE_WINDOW is a small fraction of the
// smallest gap this point can pass, so no merge can turn a wrong cadence into a
// right one.
//
// It asserts the CADENCE alone. That drones arrive at all is
// `swarm/drones-enter`, how fast one travels is `swarm/entrance-speed`, and that
// the wave releases between two and eight groups is not graded anywhere — what
// this point needs of that rule is only that a wave which released everything at
// once has no stagger to measure, which is the failure it reports.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { ENTER_GROUP_GAP } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  startStage,
  type Harness,
} from "../harness";
import { firstMotion, watchDrones } from "./flight";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/**
 * The most groups a wave may release its drones in (`specs/swarm.md`), which
 * fixes how long the watch has to run: the last group is released
 * `ENTER_GROUP_GAP` times one less than this after the wave opened.
 */
const MAX_GROUPS = 8;

/** A margin of one whole gap past the last release a conformant wave can make. */
const WATCH = ENTER_GROUP_GAP * MAX_GROUPS;

/**
 * How far a drone must have left its starting point to count as released, in
 * logical units.
 *
 * Not a tolerance on the rule: a released drone travels `ENTER_SPEED` (260)
 * times `droneSpeedScale(1)` (1) per second, so it covers this inside a fifth of
 * one 0.01 s frame, and an unreleased one holds its point exactly. Half a unit
 * is small enough that the release is seen on the first frame it happens and
 * large enough that nothing but travel trips it.
 */
const RELEASED = 0.5;

/**
 * How close two first motions must be to count as the same release, in seconds.
 *
 * A group is released inside a single frame, so its drones' first motions land
 * within a frame or two of each other; a tenth of a second is ten frames. The
 * smallest gap this point can pass is `ENTER_GROUP_GAP * 0.8` (0.48 s), nearly
 * five times this, so merging can never join two releases the assertion would
 * have failed.
 */
const MERGE_WINDOW = 0.1;

/** How far a gap may sit from ENTER_GROUP_GAP: the item's own 20%. */
const GAP_TOLERANCE = ENTER_GROUP_GAP * 0.2;

/** The releases needed before a gap exists to measure at all. */
const MIN_GROUPS = 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("releases each entry group ENTER_GROUP_GAP after the one before it", async () => {
  await harness.debug.setDiveLaunching(false);
  await harness.debug.setShipContact(false);
  await startStage(harness, STAGE);

  const watch = await captureReplay(harness, "stagger", () =>
    watchDrones(harness, { frames: framesFor(WATCH) }),
  );

  // The moment each drone first left the point it opened the wave on. A drone
  // whose group was never released inside the watch has none, and is left out
  // rather than counted as a release at the end of the sweep.
  const motions: number[] = [];
  for (const track of watch.tracks) {
    const index = firstMotion(track.samples, RELEASED);
    if (index >= 0) motions.push(track.samples[index].t);
  }
  motions.sort((a, b) => a - b);

  // The distinct releases: a run of first motions inside MERGE_WINDOW is one
  // group leaving, and the moment it left is the first of them.
  const releases: number[] = [];
  for (const moment of motions) {
    const last = releases[releases.length - 1];
    if (last === undefined || moment - last > MERGE_WINDOW)
      releases.push(moment);
  }

  assertGreaterThanOrEqual(
    releases.length,
    MIN_GROUPS,
    `the entry groups the wave released over its first ${WATCH}s, read as the ` +
      `distinct moments its drones started moving — a wave that released every ` +
      `drone at once is not staggered (specs/swarm.md)`,
  );

  for (let i = 1; i < releases.length; i += 1) {
    const gap = releases[i] - releases[i - 1];
    assertLessThanOrEqual(
      Math.abs(gap - ENTER_GROUP_GAP),
      GAP_TOLERANCE,
      `how far the gap between entry group ${i - 1} (released at ` +
        `${releases[i - 1].toFixed(2)}s) and group ${i} (at ` +
        `${releases[i].toFixed(2)}s) sat from ENTER_GROUP_GAP ` +
        `(${ENTER_GROUP_GAP}) (specs/swarm.md)`,
    );
  }
});
