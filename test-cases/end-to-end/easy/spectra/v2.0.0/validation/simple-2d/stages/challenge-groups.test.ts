// stages/challenge-groups — a challenge stage sends five groups of eight.
//
// specs/stages.md, Challenge stages: a challenge stage "holds `CHALLENGE_GROUPS`
// (`5`) groups of `CHALLENGE_PER_GROUP` (`8`) drones, `CHALLENGE_TOTAL` (`40`) in
// all, released on the same schedule a wave's entry groups run on." specs/swarm.md
// states that schedule: "A drone's group is released when that clock reaches
// `ENTER_GROUP_GAP` (`0.6`) seconds times the group's index, counted from `0`", and
// "A drone that has not been released holds its starting point."
//
// This point grades the COUNTS alone — how many drones, how many groups, how many
// in a group. `stages/challenge-single-band-groups` grades that a group is one
// band and `stages/challenge-alternates` that consecutive groups differ, and both
// read the same release order this does, so a build with the counts right and the
// bands wrong is named by those two and passes here.
//
// HOW A GROUP IS READ. By its RELEASE, which is the observable the specification
// itself defines a group by, and never by where a drone is: see the note at the
// top of `stages/flyover.ts` for why the two other readings — first sighting on
// the roster, and first inside the play field — each fail, one of them on a
// perfectly conformant build.
//
// WHAT IS DRIVEN. The game builds its own challenge wave, through `startStage` at
// stage `CHALLENGE_EVERY`, and then the stage is left alone to fly. Nothing is
// posed on the field: how many drones a challenge stage sends and when it lets
// them go is the whole question.
//
// WHY THE FORTY ARE COUNTED OVER THE WHOLE SWEEP RATHER THAN AT THE OPENING FRAME.
// specs/stages.md says a challenge stage HOLDS forty drones and says nothing about
// when they come into being — the roster rule specs/swarm.md states ("the drone
// roster holds every drone of the wave from that moment") is written for a
// standard wave. A build that spawns each group as it is released is therefore
// conformant, and it is exactly the build `stages/flyover.ts` is written to read,
// so counting the roster on the opening frame would fail it. What is counted
// instead is every distinct drone the sweep ever saw, which is the same forty on a
// build that puts them all out at once and the honest count on a build that does
// not.
//
// THE SWEEP IS NOT STOPPED AT FORTY RELEASES, for the other direction: a build
// that sends a SIXTH group lets its fortieth drone go with that sixth group still
// to come, so a sweep that stopped on the count would never see it. It runs its
// whole span instead, and stops early only when the stage itself ends.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  ENTER_GROUP_GAP,
} from "../constants";
import { assertEqual, assertLength } from "../assert";
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
 * Half a unit. specs/swarm.md has an unreleased drone HOLD its starting point, so
 * anything above the noise of a stationary reading is enough; a released drone
 * covers `ENTER_SPEED` (`260`) units a second, which is more than four units
 * between two samples at this rate. The gap between the two is three orders of
 * magnitude, so nothing about the verdict rests on where inside it this sits.
 */
const MOVED_EPSILON = 0.5;

/**
 * How far apart two releases must be to belong to different groups, in frames.
 *
 * A quarter of `ENTER_GROUP_GAP`, 0.15 s. A group is released at one instant and
 * the next `ENTER_GROUP_GAP` (`0.6` s) later, so this is far below the schedule's
 * own spacing — no two scheduled groups can be merged by it — and far above the
 * frame or two a build might spread one group's release over. It is deliberately
 * NOT the full gap: the point does not require the gap to be 0.6 s, only that the
 * drones of a group go together, and `swarm/entry-group-gap` is where the
 * schedule's spacing is graded.
 */
const GROUP_GAP_FRAMES = ticksFor(ENTER_GROUP_GAP / 4);

/**
 * Frames the sweep runs.
 *
 * Long enough for every group on the stated schedule to be let go — the last of
 * five is released `4 * ENTER_GROUP_GAP` = 2.4 s in — with four times that again
 * for a build whose schedule is slower, and for the group after a fifth that a
 * build sending too many would let go. The sweep runs the whole span unless the
 * stage ends inside it, so a build that has not released all forty by then is
 * reported for the drones it did send rather than hanging.
 */
const SWEEP_FRAMES = ticksFor(ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1) * 5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends CHALLENGE_TOTAL drones as CHALLENGE_GROUPS groups of CHALLENGE_PER_GROUP", async () => {
  await startStage(h, STAGE);

  assertEqual(
    h.snapshot().isChallenge,
    true,
    `stage ${String(STAGE)} to be a challenge stage (specs/stages.md)`,
  );

  const flown = await captureReplay(h, "groups", () =>
    watchFlyover(h, {
      maxFrames: SWEEP_FRAMES,
      poll: SAMPLE_FRAMES,
      movedEpsilon: MOVED_EPSILON,
    }),
  );

  assertLength(
    flown.tracks,
    CHALLENGE_TOTAL,
    "the drones a challenge stage puts on the field over the whole flyover, " +
      "CHALLENGE_TOTAL (specs/stages.md)",
  );

  const groups = releaseGroups(flown.tracks, GROUP_GAP_FRAMES);
  assertLength(
    groups,
    CHALLENGE_GROUPS,
    "the groups a challenge stage releases its drones in, CHALLENGE_GROUPS " +
      "(specs/stages.md)",
  );
  groups.forEach((group, index) => {
    assertLength(
      group.ids,
      CHALLENGE_PER_GROUP,
      `the drones released together as challenge group ${String(index + 1)} of ` +
        `${String(groups.length)}, CHALLENGE_PER_GROUP (specs/stages.md)`,
    );
  });
});
