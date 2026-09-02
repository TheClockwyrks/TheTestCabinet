// scoring/stage-clear-bonus — clearing a standard stage pays its bonus.
//
// THE RULE. specs/scoring.md's bonus table: `SCORE_STAGE_CLEAR` (`1000`) is paid
// "When a standard stage is cleared". specs/stages.md fixes the moment: "A
// standard stage clears in the moment the last drone of its wave is destroyed."
// So the reading is what the LAST kill of a wave paid over what an identical kill
// paid a moment earlier.
//
// THE BONUS IS A DIFFERENCE OF TWO IDENTICAL KILLS, WHICH IS WHY NOTHING ELSE
// LEAKS INTO IT. Two Shards of the wave are held back while every other drone is
// destroyed. The first of the two is then destroyed with the other still
// standing, and what it paid is the build's OWN figure for a Shard in that phase.
// The second — same kind, same phase, same spot, same shot — is the last drone of
// the wave, and what it paid is that figure again plus whatever clearing the
// stage is worth. Subtracting the first from the second leaves the bonus alone. A
// build whose Shard figure is wrong loses `scoring.shard-diving` and keeps this
// point, and no figure from specs/scoring.md's first table has to be assumed here
// at all.
//
// THE WAVE IS THE GAME'S OWN, AND EVERY ONE OF ITS DRONES IS DESTROYED. A stage
// clears on "the last drone of ITS wave", and a wave nothing built has no last
// drone — so {@link openWave} runs stage 1 out of its intro and holds every drone
// of the wave the build laid out still, and {@link destroyDrone} empties it one
// drone at a time.
// Nothing is removed by the surface and nothing is left standing, so the two ways
// a build can read "its wave" — the drones the stage built, or the drones on the
// field — agree, and the clear this point reads is the build's own rule firing.
//
// STAGE 1 IS A STANDARD STAGE, which is what the rule is about: `isChallengeStage`
// is `stage % CHALLENGE_EVERY === 0` (specs/stages.md) and `1` is not, as the
// precondition below reads back. What a CHALLENGE stage's end pays is
// `scoring.challenge-pays-no-stage-bonus`, the opposite direction.
//
// WHAT THIS DOES NOT DECIDE. Which moment clears a stage is
// `stages.clears-on-last-drone`; the figures the two kills themselves paid are
// `scoring.shard-diving`'s and its neighbours'; that the interstitial reports the
// stage is `screens`'s.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_STAGE_CLEAR } from "../constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { destroyAllBut, destroyDrone, ofKind, openWave } from "./wave";

/** A standard stage: `1 % CHALLENGE_EVERY` is not `0` (specs/stages.md). */
const STANDARD_STAGE = 1;

/** How many Shards the check holds back: one to price a kill, one to clear on. */
const HELD_BACK = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds SCORE_STAGE_CLEAR when the last drone of a standard wave is destroyed", async () => {
  const opened = await openWave(h, STANDARD_STAGE);

  assertEqual(
    opened.isChallenge,
    false,
    `precondition: stage ${STANDARD_STAGE} is a standard stage, not a ` +
      `challenge one (specs/stages.md)`,
  );
  assertEqual(opened.score, 0, "precondition: the run opens with a score of 0");

  const shards = ofKind(opened, "shard");
  assertGreaterThanOrEqual(
    shards.length,
    HELD_BACK,
    `precondition: the wave holds at least ${HELD_BACK} Shards to price a ` +
      `kill against (specs/swarm.md: Shards of both bands as the bulk of it)`,
  );
  const priced = shards[0].id;
  const last = shards[1].id;
  assertEqual(
    shards[0].phase,
    shards[1].phase,
    "precondition: the two held-back Shards are in the same phase, so they " +
      "pay the same figure (specs/scoring.md)",
  );

  // Everything but the two Shards, so the wave is one kill from its last drone.
  const paidForRest = await destroyAllBut(h, [priced, last]);

  // The first of the two, with the other still standing: the wave is not
  // cleared, so what this paid is the build's own figure for such a kill.
  const afterPriced = await destroyDrone(h, priced);
  assertLength(
    afterPriced.drones,
    1,
    "precondition: one drone of the wave is still standing after this kill",
  );
  assertEqual(
    afterPriced.screen,
    "inWave",
    "precondition: the wave is still live, so this kill paid no clear bonus",
  );
  const perKill = afterPriced.score - paidForRest;

  // The last drone of the wave, which is the moment specs/stages.md clears a
  // standard stage on.
  const afterLast = await destroyDrone(h, last);

  // The score the cleared wave left, on the interstitial it opened.
  captureStill(h, "bonus");

  assertLength(
    afterLast.drones,
    0,
    "precondition: the wave's last drone was destroyed",
  );
  assertEqual(
    afterLast.screen,
    "stageCleared",
    "precondition: the stage cleared in the moment its last drone was " +
      "destroyed (specs/stages.md)",
  );

  const bonus = afterLast.score - afterPriced.score - perKill;
  assertEqual(
    bonus,
    SCORE_STAGE_CLEAR,
    `what the last drone of a standard wave paid ABOVE what an identical ` +
      `earlier kill paid (${perKill}) (specs/scoring.md: SCORE_STAGE_CLEAR, ` +
      `${SCORE_STAGE_CLEAR}, is paid when a standard stage is cleared)`,
  );
});
