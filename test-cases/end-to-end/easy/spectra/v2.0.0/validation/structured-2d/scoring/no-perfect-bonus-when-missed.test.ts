// scoring/no-perfect-bonus-when-missed — a missed drone pays no bonus.
//
// THE RULE. specs/scoring.md, under the bonus table: "A challenge stage that left
// one drone alive pays the per-drone total alone and no `SCORE_PERFECT_BONUS`."
// The bonus is owed only "When every one of a challenge stage's
// `CHALLENGE_TOTAL` drones was destroyed", and specs/stages.md ends the stage "in
// the moment the last of its drones has left the field or been destroyed" — the
// two ways a flyover can empty. This point is the second of them: thirty-nine
// destroyed, one flown off, and no bonus.
//
// THE EDGE CASE IS ONE DRONE SHORT, WHICH IS THE POINT. Thirty-nine of the forty
// are destroyed at the kill spot; the fortieth is never shot at all. Its travel
// gate is then opened and it flies its own sweep off the field, which
// specs/stages.md says removes it — so the stage ends with the roster empty and
// exactly one drone unaccounted for. A build that counts drones GONE rather than
// drones DESTROYED cannot tell that stage from a perfect one, and it is the build
// this point catches.
//
// THE READING IS ONE-DIRECTIONAL: THAT THE BONUS WAS NOT PAID. The first kill's
// score is kept as the build's own per-drone figure, and what the final score
// holds above thirty-nine of it must fall short of `SCORE_PERFECT_BONUS`
// (`10000`). Measuring it that way keeps the per-drone figure —
// `scoring.challenge-drone`'s point — out of this one, and leaves a stray
// `SCORE_STAGE_CLEAR` (`1000`) to `scoring.challenge-pays-no-stage-bonus` rather
// than failing it twice.
//
// WHY THE WAVE'S ENTRY GATE STAYS OPEN. It is the one world gate {@link openWave}
// can be asked to leave on, and this is the check that needs it: a drone is
// released by the wave's own clock on the `ENTER_GROUP_GAP` schedule
// (specs/swarm.md), and a drone that was never released has no sweep to fly. The
// gate releases drones; it moves none, because every drone's travel gate is shut
// until this check opens the survivor's.
//
// THE STAGE HAVING ENDED IS ASSERTED AS A PRECONDITION, because a bonus paid at a
// stage's end cannot be read from a stage that never ended. specs/stages.md states
// that end outright, and `stages` grades it; here it is the ground the reading
// stands on.
//
// WHAT THIS DOES NOT DECIDE. That a PERFECT flyover pays the bonus is
// `scoring.perfect-bonus` — the opposite direction, and the reason a build that
// simply never pays a bonus fails there and passes here.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  CHALLENGE_TOTAL,
  SCORE_PERFECT_BONUS,
} from "../../src/constants";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { destroyDrone, openWave } from "./wave";

/**
 * The stage the flyover is opened on: the first stage `isChallengeStage(stage)`
 * — `stage % CHALLENGE_EVERY === 0` (specs/stages.md) — is true of.
 */
const CHALLENGE_STAGE = CHALLENGE_EVERY;

/** How many of the forty are destroyed: all but the one left alive. */
const DESTROYED = CHALLENGE_TOTAL - 1;

/**
 * Frames of game time the survivor is given to fly off the field.
 *
 * specs/stages.md says each group "sweeps across the play field ... and leaves it
 * within eight seconds of the group's release", and the last group is released
 * `ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1)` (`2.4`) seconds into the flyover —
 * both of which are long past by the time thirty-nine kills have run. Sixteen
 * seconds is twice that eight-second bound, so a build that flies the longest
 * conforming sweep still finishes inside it. It is a budget, not a threshold:
 * nothing is read from how long the sweep took.
 */
const DEPARTURE_FRAMES = ticksFor(16);

/**
 * How often the sweep looks, in frames.
 *
 * An emptied field stays empty, so a coarse sample finds it just as surely as a
 * per-frame one. Nothing is read from WHEN it was found.
 */
const POLL_FRAMES = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays no SCORE_PERFECT_BONUS when one challenge drone was never destroyed", async () => {
  // The wave's own entry runs, so every group — the survivor's included — is
  // released on the schedule specs/swarm.md states.
  const opened = await openWave(h, CHALLENGE_STAGE, { waveEntry: true });

  assertEqual(
    opened.isChallenge,
    true,
    `precondition: stage ${CHALLENGE_STAGE} is a challenge stage ` +
      `(specs/stages.md: stage % CHALLENGE_EVERY === 0)`,
  );
  assertEqual(opened.score, 0, "precondition: the run opens with a score of 0");
  assertLength(
    opened.drones,
    CHALLENGE_TOTAL,
    `precondition: the flyover holds CHALLENGE_TOTAL drones (specs/stages.md: ` +
      `CHALLENGE_GROUPS groups of CHALLENGE_PER_GROUP)`,
  );

  const ids = opened.drones.map((drone) => drone.id);
  const survivor = ids[ids.length - 1];

  // The first kill on its own, so what the build pays for ONE challenge drone is
  // known before the other thirty-eight are added to it.
  const afterFirst = await destroyDrone(h, ids[0]);
  const perDrone = afterFirst.score;
  for (const id of ids.slice(1, DESTROYED)) await destroyDrone(h, id);

  const shortOne = h.snapshot();
  assertLength(
    shortOne.drones,
    1,
    `precondition: ${DESTROYED} of the ${CHALLENGE_TOTAL} were destroyed and ` +
      `one is still alive`,
  );
  const paidForKills = shortOne.score;

  // The survivor flies its own sweep off the field, which is the second of the
  // two ways specs/stages.md ends a stage.
  h.debug.setDroneTravel(survivor, true);
  const departed = await h.until((snapshot) => snapshot.drones.length === 0, {
    maxFrames: DEPARTURE_FRAMES,
    poll: POLL_FRAMES,
  });

  // The score the flyover left, once the drone that was never shot had gone.
  captureStill(h, "missed");

  assertTrue(
    departed.hit,
    `precondition: the surviving challenge drone left the field within ` +
      `${DEPARTURE_FRAMES} frames of its travel resuming (specs/stages.md: ` +
      `each group leaves the field within eight seconds of its release)`,
  );

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "stageCleared",
    "precondition: the stage ended once the last of its drones had left the " +
      "field (specs/stages.md)",
  );
  assertEqual(
    after.score,
    paidForKills,
    "precondition: a drone that leaves the field pays nothing itself, so the " +
      "only thing that could have moved the score is the stage's end",
  );

  const bonus = after.score - DESTROYED * perDrone;
  assertLessThan(
    bonus,
    SCORE_PERFECT_BONUS,
    `the score above the per-drone total once a challenge stage ended with ` +
      `one of its ${CHALLENGE_TOTAL} drones never destroyed (specs/scoring.md: ` +
      `a challenge stage that left one drone alive pays the per-drone total ` +
      `alone and no SCORE_PERFECT_BONUS, ${SCORE_PERFECT_BONUS}); the build ` +
      `paid ${perDrone} per drone and finished on ${after.score}`,
  );
});
