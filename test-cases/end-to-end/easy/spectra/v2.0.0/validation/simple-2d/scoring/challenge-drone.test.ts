// scoring/challenge-drone — a challenge drone pays its figure.
//
// THE RULE. specs/scoring.md's first table: "One drone of a challenge stage" pays
// `SCORE_CHALLENGE_DRONE` (`100`). This point decides that one figure, read as the
// whole change one kill made to the score of a challenge stage.
//
// THE DRONE IS A REAL CHALLENGE DRONE, NOT A POSED STAND-IN. The figure is the one
// a drone "of a challenge stage" pays, and only the game can build such a flyover:
// specs/stages.md says a challenge stage holds `CHALLENGE_GROUPS` (`5`) groups of
// `CHALLENGE_PER_GROUP` (`8`), `CHALLENGE_TOTAL` (`40`) in all. So {@link openWave}
// runs stage `CHALLENGE_EVERY` (`3`) — the first stage `isChallengeStage` is true
// of — out of its intro and holds the flyover still, and the shot is fired at one
// of the forty drones the build itself laid out. A drone the surface added would
// be a Shard of this check's own making, and a build free to key the figure off
// the drone rather than off the stage would be graded on something this point is
// not about.
//
// WHAT THE FIGURE CAN AND CANNOT TELL APART. `100` separates a build that pays a
// challenge kill nothing (`0`), one that pays the formation figure
// `SCORE_SHARD_FORM` (`50`), and one that pays some flat rate of its own. It
// CANNOT separate a build that ignores the challenge rule and pays the ordinary
// phase figure, because specs/scoring.md sets `SCORE_CHALLENGE_DRONE` and
// `SCORE_SHARD_DIVE` at the same `100` and specs/stages.md holds every challenge
// drone in phase `entering`, which is one of the three phases that figure covers.
// The two readings are numerically the same rule here, so no scenario could tell
// them apart and this point does not pretend to.
//
// THE FLYOVER IS HELD STILL. {@link openWave} shuts the three world gates and every
// drone's three faculties, so the other thirty-nine hold their starting points and
// take no part while one is brought to the kill spot and shot. That leaves
// thirty-nine drones on the field, so the stage does not end under this kill and no
// bonus of any kind lands in the number this check reads —
// `scoring/perfect-bonus` is where a whole flyover is paid for.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a drone is
// `bands/match-destroys`. That the composition really is forty drones in five
// groups is `stages`'s, and it is read here only as the precondition of a
// challenge stage.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_TOTAL,
  SCORE_CHALLENGE_DRONE,
} from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { destroyDrone, openWave } from "./wave";

/**
 * The stage the flyover is opened on: the first stage `isChallengeStage(stage)` —
 * `stage % CHALLENGE_EVERY === 0` (specs/stages.md) — is true of.
 */
const CHALLENGE_STAGE = CHALLENGE_EVERY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly SCORE_CHALLENGE_DRONE when one challenge drone is destroyed", async () => {
  const opened = await openWave(h, CHALLENGE_STAGE);

  assertEqual(
    opened.isChallenge,
    true,
    `precondition: stage ${CHALLENGE_STAGE} is a challenge stage ` +
      "(specs/stages.md: stage % CHALLENGE_EVERY === 0)",
  );
  assertEqual(opened.score, 0, "precondition: the run opens with a score of 0");
  assertLength(
    opened.drones,
    CHALLENGE_TOTAL,
    "precondition: the flyover holds CHALLENGE_TOTAL drones (specs/stages.md: " +
      "CHALLENGE_GROUPS groups of CHALLENGE_PER_GROUP)",
  );

  const after = await destroyDrone(h, opened.drones[0].id);

  // The score the one destroyed challenge drone paid.
  captureStill(h, "paid");

  assertLength(
    after.drones,
    CHALLENGE_TOTAL - 1,
    "precondition: exactly one drone of the flyover was destroyed, so the " +
      "stage has not ended and no bonus could have been paid",
  );
  assertEqual(
    after.score,
    SCORE_CHALLENGE_DRONE,
    "the score after one drone of a challenge stage was destroyed " +
      "(specs/scoring.md: one drone of a challenge stage pays " +
      `SCORE_CHALLENGE_DRONE, ${SCORE_CHALLENGE_DRONE})`,
  );
});
