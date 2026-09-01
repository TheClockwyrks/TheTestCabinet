// stages/challenge-drones-exit — a challenge group sweeps across and leaves.
//
// specs/stages.md, Challenge stages: "Each group sweeps across the play field
// along a path of your design and leaves it within eight seconds of the group's
// release. A challenge drone never settles into a formation slot, and one that
// leaves the field is removed." The same section states the phase side of it: "A
// challenge drone holds phase `entering` for the whole flyover. It never reaches
// `formation`." A flyover whose drones settled would be a second standard wave
// with no fire, which is a different stage entirely.
//
// WHAT IS DRIVEN. The game builds its own challenge wave, and the stage is then
// left alone. Nothing is posed and nothing is shot, so the group under test is
// UNDESTROYED throughout and every drone that leaves the roster left it by
// sweeping off the field.
//
// WHICH GROUP. The first — the one released as the wave opens — so the whole eight
// seconds the specification allows it fits inside the stage rather than running
// past the end of it. It is read through the same release-order reading its three
// sibling points use; `stages/flyover.ts` carries the note on why a group is read
// by its release rather than by where its drones are.
//
// WHAT IS ASSERTED. Two readings of the one requirement, each named separately so
// a failure says which half went wrong: no drone of the group was ever seen in a
// settled phase, and every drone of it was off the roster within eight seconds of
// its own release.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  ENTER_GROUP_GAP,
} from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
  fail,
} from "../assert";
import {
  captureReplay,
  createHarness,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import { releaseGroups, watchFlyover, type DroneTrack } from "./flyover";

/** The stage the flyover is opened on: the first the challenge schedule names. */
const STAGE = CHALLENGE_EVERY;

/** Frames between two samples of the sweep. */
const SAMPLE_FRAMES = 2;

/**
 * How far a drone must move between two samples to count as released.
 *
 * Half a unit, against the `ENTER_SPEED` (`260`) units a second a released drone
 * covers and the exact standstill specs/swarm.md gives an unreleased one.
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

/** The window specs/stages.md gives a group to leave the field, in seconds. */
const LEAVES_WITHIN = 8;

/**
 * Slack added to that window, in frames.
 *
 * Two samples. The frame a drone is recorded as leaving on is the first sample at
 * which it was missing, so it can be up to one sample late, and its release can be
 * up to one sample early for the same reason. Nothing else is allowed: the eight
 * seconds are the specification's own figure and are not softened.
 */
const SAMPLING_SLACK = 2 * SAMPLE_FRAMES;

/**
 * Frames the sweep may run before it gives up.
 *
 * The last group is released 2.4 s in on the stated schedule and has eight seconds
 * to leave, so a conformant stage is over by 10.4 s; half as much again is allowed
 * on top. The sweep stops on its own when the stage ends.
 */
const SWEEP_FRAMES = ticksFor(
  (ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1) + LEAVES_WITHIN) * 1.5,
);

/** The phases a challenge drone must never be seen in (specs/stages.md). */
const SETTLED_PHASES = ["formation", "diving", "returning"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sweeps the first challenge group off the field rather than settling it", async () => {
  await startStage(h, STAGE);

  assertEqual(
    h.snapshot().isChallenge,
    true,
    `stage ${String(STAGE)} to be a challenge stage (specs/stages.md)`,
  );

  const flown = await captureReplay(h, "swept", () =>
    watchFlyover(h, {
      maxFrames: SWEEP_FRAMES,
      poll: SAMPLE_FRAMES,
      movedEpsilon: MOVED_EPSILON,
    }),
  );

  const groups = releaseGroups(flown.tracks, GROUP_GAP_FRAMES);
  const first = groups[0];
  if (first === undefined) {
    fail(
      "a challenge stage to release a group of drones (specs/stages.md)",
      "no drone of the flyover ever left its starting point",
    );
  }
  assertGreaterThanOrEqual(
    first.ids.length,
    1,
    "drones in the first challenge group, to follow across the field " +
      "(specs/stages.md)",
  );

  const tracks = new Map(flown.tracks.map((track) => [track.id, track]));
  for (const id of first.ids) {
    const track = tracks.get(id) as DroneTrack;
    for (const phase of SETTLED_PHASES) {
      assertTrue(
        !track.phases.includes(phase),
        `challenge drone ${String(id)} never to reach phase ${phase}, having ` +
          `been seen in ${JSON.stringify(track.phases)} (specs/stages.md)`,
      );
    }
    assertTrue(
      track.leftAt !== null,
      `challenge drone ${String(id)} to leave the field and be removed ` +
        "(specs/stages.md)",
    );
    assertLessThanOrEqual(
      (track.leftAt ?? SWEEP_FRAMES) - (track.releasedAt ?? 0),
      ticksFor(LEAVES_WITHIN) + SAMPLING_SLACK,
      `the frames challenge drone ${String(id)} took from its release to ` +
        `leaving the field, against the ${String(LEAVES_WITHIN)} s allowed ` +
        "(specs/stages.md)",
    );
  }
});
