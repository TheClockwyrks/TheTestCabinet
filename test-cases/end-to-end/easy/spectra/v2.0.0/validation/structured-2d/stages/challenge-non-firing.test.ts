// stages/challenge-non-firing — a challenge stage puts no bullet in the air.
//
// specs/stages.md, Challenge stages: "A challenge stage is a non-firing flyover…
// No drone fires. No enemy bullet appears anywhere in a challenge stage." It is
// what makes the flyover a scoring opportunity rather than another assault, and it
// is stated over the WHOLE stage rather than over any one moment, so the whole
// stage is what is watched.
//
// WHAT IS DRIVEN. The game builds its own challenge wave, through `startStage` at
// stage `CHALLENGE_EVERY`, and the stage is then left entirely alone until it ends.
// Nothing is posed on the field and no key is pressed: whether a drone fires is the
// question, so the drones are the build's own, flying the build's own paths, with
// the build's own fire gate untouched. The ship stands where a reset left it and
// fires nothing, so every bullet the roster could hold would be one a drone made.
//
// WHY THE ENTIRE STAGE. A build that fires from one group in five, or only once a
// drone crosses some line of its own, would pass a check that looked at a single
// instant or at the opening seconds. The sweep runs until the stage itself ends and
// reports the first bullet it ever saw.
//
// THE PICTURE IS KEPT PART-WAY THROUGH, while the flyover is crossing, because a
// still of the stage-cleared screen the stage ends on would show a reviewer nothing
// about the field being clear of fire. The watch is run in two legs for that reason
// alone, and what it saw in each is added together.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  ENTER_GROUP_GAP,
} from "../../src/constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import { watchFlyover } from "./flyover";

/** The stage the flyover is opened on: the first the challenge schedule names. */
const STAGE = CHALLENGE_EVERY;

/**
 * Frames between two samples of the sweep.
 *
 * Five, a twentieth of a second. An enemy bullet falls at `ENEMY_BULLET_SPEED`
 * (320) units a second and the play field is 592 units deep, so the shortest life
 * one can have is nearly two seconds — some forty samples — and no bullet can be
 * born and gone between two of them.
 */
const SAMPLE_FRAMES = 5;

/**
 * How far a drone must move between two samples to count as released. Unused by
 * this point's assertions, but the watch reads it; half a unit against the
 * `ENTER_SPEED` (260) units a second a released drone covers.
 */
const MOVED_EPSILON = 0.5;

/**
 * Frames the first leg runs before the picture is kept.
 *
 * Four `ENTER_GROUP_GAP`s, 2.4 s, which is the moment the last of five groups is
 * released on the stated schedule: every group that has been let go is on the
 * field, and the picture shows the flyover at its fullest.
 */
const SHOWN_AFTER = ticksFor(ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1));

/**
 * Frames the second leg may run before it gives up.
 *
 * `specs/stages.md` gives each group eight seconds from its release to leave the
 * field, and the last of five is released 2.4 s in, so a conformant stage is over
 * by 10.4 s; half as much again is allowed on top. A stage that has not ended by
 * then is reported as not having ended, and what it fired up to that point is still
 * the verdict.
 */
const SWEEP_FRAMES = ticksFor(
  (ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1) + 8) * 1.5,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts no enemy bullet on the field anywhere in a challenge stage", async () => {
  await startStage(h, STAGE);

  const opened = h.snapshot();
  assertEqual(
    opened.isChallenge,
    true,
    `stage ${STAGE} to be a challenge stage (specs/stages.md)`,
  );

  const crossing = await watchFlyover(h, {
    maxFrames: SHOWN_AFTER,
    poll: SAMPLE_FRAMES,
    movedEpsilon: MOVED_EPSILON,
  });
  captureStill(h, "silent");

  const rest = await watchFlyover(h, {
    maxFrames: SWEEP_FRAMES,
    poll: SAMPLE_FRAMES,
    movedEpsilon: MOVED_EPSILON,
  });

  assertLength(
    [...crossing.fire, ...rest.fire],
    0,
    "the enemy bullets seen anywhere in a challenge stage (specs/stages.md)",
  );
  assertTrue(
    rest.endedAt !== null,
    "the challenge stage to end, so the whole of it was watched (specs/stages.md)",
  );
});
