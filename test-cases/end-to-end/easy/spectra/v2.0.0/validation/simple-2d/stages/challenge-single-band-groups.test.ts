// stages/challenge-single-band-groups — a challenge group carries one band.
//
// specs/stages.md, Challenge stages: "Every drone in a group carries the same
// band". That is what makes a challenge flyover the thing it is designed to be — a
// player pre-flips to the band of the group about to cross and rakes it — and a
// group that mixes the two bands asks something else of the player entirely.
//
// This point grades that ONE direction. `stages/challenge-alternates` grades that
// consecutive groups differ, and `stages/challenge-groups` how many groups there
// are and how big they are, so a build whose groups are single-band but never
// change band passes here and fails there.
//
// HOW A GROUP IS READ. By its RELEASE — the moment its drones stop holding their
// starting point, which specs/swarm.md makes the observable definition of a group
// — and never by where a drone is. `stages/flyover.ts` carries the whole note on
// why: reading arrival as "inside the play field" interleaves the bands of
// consecutive groups on a build whose flyover is exactly on the stated schedule,
// because a group sweeping in from off the side edge crosses that edge strung out
// over more than the `ENTER_GROUP_GAP` between two releases.
//
// WHY THE BAND READ IS `effectiveBand`. specs/bands.md defines that as the band an
// entity "currently reads and counts as", which is what a player has to match. No
// inversion runs during this scenario, so it is the drone's stored band either
// way; reading the effective one keeps this point agreeing with every other band
// check in the project.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  CHALLENGE_TOTAL,
  ENTER_GROUP_GAP,
} from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import { releaseGroups, watchFlyover } from "./flyover";

/** The stage the flyover is opened on: the first the challenge schedule names. */
const STAGE = CHALLENGE_EVERY;

/** Frames between two samples of the sweep. */
const SAMPLE_FRAMES = 2;

/**
 * How far a drone must move between two samples to count as released.
 *
 * Half a unit. specs/swarm.md has an unreleased drone HOLD its starting point, so
 * anything above the noise of a stationary reading is enough; a released drone
 * covers `ENTER_SPEED` (`260`) units a second, more than four units between two
 * samples at this rate.
 */
const MOVED_EPSILON = 0.5;

/**
 * How far apart two releases must be to belong to different groups, in frames.
 *
 * A quarter of `ENTER_GROUP_GAP`, 0.15 s: far below the 0.6 s the schedule leaves
 * between two groups, so no two scheduled groups are merged into one and read as
 * mixed, and far above the frame or two a build might spread one group's release
 * over, so no group is split into two halves that each look pure.
 */
const GROUP_GAP_FRAMES = ticksFor(ENTER_GROUP_GAP / 4);

/**
 * Frames the sweep may run before it gives up: five times the 2.4 s the stated
 * schedule needs to let all five groups go.
 */
const SWEEP_FRAMES = ticksFor(ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1) * 5);

/**
 * The fewest groups the reading may rest on.
 *
 * Two. A flyover that let every drone go at one instant offers nothing to grade —
 * there is no second group for a band to differ from — and the check says so
 * rather than passing on a single pure group. How many groups there SHOULD be is
 * `stages/challenge-groups`.
 */
const LEAST_GROUPS = 2;

/** Frames run before the picture is kept, so the canvas carries a crossing group. */
const SHOWN_AFTER = ticksFor(ENTER_GROUP_GAP * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every drone of a challenge group the same band", async () => {
  await startStage(h, STAGE);

  assertEqual(
    h.snapshot().isChallenge,
    true,
    `stage ${String(STAGE)} to be a challenge stage (specs/stages.md)`,
  );

  const flown = await watchFlyover(h, {
    maxFrames: SWEEP_FRAMES,
    poll: SAMPLE_FRAMES,
    movedEpsilon: MOVED_EPSILON,
    stopWhen: (watch) =>
      watch.tracks.filter((track) => track.releasedAt !== null).length >=
      CHALLENGE_TOTAL,
  });
  await h.advance(SHOWN_AFTER);
  captureStill(h, "bands");

  const groups = releaseGroups(flown.tracks, GROUP_GAP_FRAMES);
  assertGreaterThanOrEqual(
    groups.length,
    LEAST_GROUPS,
    "challenge groups released apart from one another, to read a band off each " +
      "(specs/stages.md)",
  );
  groups.forEach((group, index) => {
    assertLength(
      [...new Set(group.bands)],
      1,
      `the bands worn by challenge group ${String(index + 1)} of ` +
        `${String(groups.length)}, released together as ` +
        `${JSON.stringify(group.bands)} (specs/stages.md)`,
    );
  });
});
