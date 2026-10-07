// stages/challenge-alternates — consecutive challenge groups change band.
//
// specs/stages.md, Challenge stages: "consecutive groups carry opposite bands, so
// the bands alternate from the first group to the last." That alternation is the
// whole rhythm of a challenge flyover: the player flips between raking one group
// and the next, and a flyover that sends every group on one band asks for no flip
// at all.
//
// This point grades that ONE direction. `stages/challenge-single-band-groups`
// grades that a group is one band and `stages/challenge-groups` how many groups
// there are, so a build whose groups alternate but hold two bands each passes here
// and fails there.
//
// HOW A GROUP IS READ. By its RELEASE, exactly as its two siblings read it, and
// never by where a drone is — `stages/flyover.ts` carries the note on why the
// position reading interleaves the bands of consecutive groups on a conformant
// build. The groups are NOT merged by band before comparing: a merge that joined
// adjacent same-band groups would make alternation true by construction and grade
// nothing at all.
//
// WHAT IS ASSERTED, AND WHY IT IS EACH PAIR RATHER THAN A COUNT. Every consecutive
// pair is compared, so a failure names the pair that repeated a band rather than
// reporting that some group somewhere did. A build that alternates all the way and
// then repeats once at the end fails on that one pair.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  CHALLENGE_TOTAL,
  ENTER_GROUP_GAP,
} from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotEqual,
} from "../assert";
import {
  captureReplay,
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
 * Half a unit, against the `ENTER_SPEED` (260) units a second a released drone
 * covers and the exact standstill `specs/swarm.md` gives an unreleased one.
 */
const MOVED_EPSILON = 0.5;

/**
 * How far apart two releases must be to belong to different groups, in frames.
 *
 * A quarter of `ENTER_GROUP_GAP`, 0.15 s: far below the 0.6 s the schedule leaves
 * between two groups and far above the frame or two a build might spread one
 * group's release over.
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
 * Two, since alternation is a statement about a pair and one group makes no pair.
 * How many groups there should be is `stages/challenge-groups`.
 */
const LEAST_GROUPS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives each challenge group the band the group before it did not carry", async () => {
  await startStage(h, STAGE);

  const opened = h.snapshot();
  assertEqual(
    opened.isChallenge,
    true,
    `stage ${STAGE} to be a challenge stage (specs/stages.md)`,
  );

  const flown = await captureReplay(h, "alternating", () =>
    watchFlyover(h, {
      maxFrames: SWEEP_FRAMES,
      poll: SAMPLE_FRAMES,
      movedEpsilon: MOVED_EPSILON,
      stopWhen: (watch) =>
        watch.tracks.filter((track) => track.releasedAt !== null).length >=
        CHALLENGE_TOTAL,
    }),
  );

  const groups = releaseGroups(flown.tracks, GROUP_GAP_FRAMES);
  assertGreaterThanOrEqual(
    groups.length,
    LEAST_GROUPS,
    "challenge groups released apart from one another, to compare one band with the next (specs/stages.md)",
  );
  for (let index = 1; index < groups.length; index += 1) {
    assertNotEqual(
      groups[index].bands[0],
      groups[index - 1].bands[0],
      `the band challenge group ${index + 1} of ${groups.length} carries, against the band group ${index} carried (specs/stages.md)`,
    );
  }
});
