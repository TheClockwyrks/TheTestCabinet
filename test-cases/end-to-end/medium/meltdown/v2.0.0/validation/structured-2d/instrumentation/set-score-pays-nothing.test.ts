// Meltdown — instrumentation/set-score-pays-nothing: posing the score pays
// nothing.
//
// `specs/instrumentation.md`: "`setScore` pays no bonus and grants nothing,
// whatever boundary it carries the score across." It is the sentence that makes
// the score a PRECONDITION rather than an event: every scoring figure in the game
// is paid by the transition that earns it, and a pose is not a transition.
//
// THE BOUNDARIES ARE THE SCORE'S OWN, out of `specs/economy.md`'s score table:
// zero, a kill's bounty, a wave clear's `100 * w` at the first wave and at the
// last of a full run, a victory's `250` per life at full lives, the sum of a whole
// run's clears and its victory, and a figure past anything a run reaches. Each is
// posed in turn, and each is a value some real event WOULD have produced — which
// is the point: a build that reached for its scoring path to write the field would
// pay the line that goes with the figure.
//
// THE THREE FIGURES READ BESIDE IT ARE THE THREE A SCORING EVENT MOVES.
// `specs/economy.md` pays money on a kill, on a wave clear, on interest and on a
// send; `specs/waves.md` takes a life on a leak and raises the wave on a clear. So
// money, lives and the wave are exactly the fields a build that confused a pose
// for an event would disturb, and all three are posed to figures no event would
// land on, so a disturbance reads as a number that belongs to a different rule.
//
// A FRAME IS RUN AFTER EVERY POSE, so a build that queues its award for the next
// update is caught at the boundary that produced it rather than at whichever one
// happened to be last.
//
// THE FLOOR IS EMPTY AND THE WORLD GATE IS OFF, so nothing else on it can pay
// anything: no tower to kill a unit, no unit to leak, and no release to start a
// wave underneath the reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIFFICULTY_TABLE,
  SCORE_VICTORY_PER_LIFE,
  SCORE_WAVE_CLEAR,
  START_LIVES,
  SURGE_DEFS,
} from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The waves of a Containment run at Medium, which the clear terms are read over. */
const WAVES = DIFFICULTY_TABLE.medium.waves;

/**
 * Every boundary the score is carried across, out of `specs/economy.md`'s three
 * score terms.
 */
const BOUNDARIES: readonly number[] = [
  0,
  SURGE_DEFS.core.bounty,
  SCORE_WAVE_CLEAR,
  SCORE_WAVE_CLEAR * WAVES,
  SCORE_VICTORY_PER_LIFE * START_LIVES,
  SCORE_VICTORY_PER_LIFE * START_LIVES + SCORE_WAVE_CLEAR * WAVES,
  999_999,
];

/** The figures posed beside it, none of them a value any event lands on. */
const POSED_MONEY = 4321;
const POSED_LIVES = 17;
const POSED_WAVE = 13;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves neither money, lives nor the wave across any scoring boundary", async () => {
  startRun(h);
  h.debug.setMoney(POSED_MONEY);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);

  assertLength(
    h.snapshot().towers,
    0,
    "precondition: nothing on the floor could pay a bounty",
  );
  assertLength(
    h.snapshot().surge,
    0,
    "precondition: nothing on the floor could leak",
  );
  assertEqual(
    h.snapshot().waveSpawning,
    false,
    "precondition: the run releases nothing underneath the reading",
  );

  for (const score of BOUNDARIES) {
    h.debug.setScore(score);
    // A frame, so an award queued for the next update lands inside the reading.
    await h.advance(1);
    const after = h.snapshot();
    const where = `with the score posed at ${score}`;

    assertEqual(after.score, score, `the score read back ${where}`);
    assertEqual(after.money, POSED_MONEY, `the money ${where}`);
    assertEqual(after.lives, POSED_LIVES, `the lives ${where}`);
    assertEqual(after.wave, POSED_WAVE, `the wave ${where}`);
  }

  captureStill(h, "score");
});
