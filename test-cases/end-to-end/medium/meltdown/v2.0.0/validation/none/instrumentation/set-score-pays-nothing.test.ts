// Meltdown — instrumentation/set-score-pays-nothing: posing the score is a
// precondition, not an award.
//
// THE RULE. `specs/instrumentation.md`: "`setScore` pays no bonus and grants
// nothing, whatever boundary it carries the score across." The score's three
// terms all belong elsewhere — `specs/economy.md` pays a kill's bounty into money
// and score together, a wave clear's `100 * w` on the frame the wave clears, and
// victory's `250` per remaining life on the frame the run is won.
//
// WHY THE BOUNDARIES ARE WHAT IS POSED. A build that implemented `setScore` by
// running its own scoring path would settle whatever that path settles: the
// bounty's money, or the wave-clear bonus, or the victory award, each of which
// moves the money, the lives or the wave alongside the score. So the score is
// carried ACROSS every figure the economy attaches an award to — a kill's bounty,
// a wave clear at Wave 1 and at the run's last wave, victory at one life and at a
// full twenty — and every one of them leaves the other three fields exactly where
// the run posed them.
//
// THE POSED FIGURES ARE DISTINGUISHING. The money, the lives and the wave are set
// to numbers no starting value, no bonus and no award produces, so a build that
// re-derived any of them from its own start, or that added an award to one, reads
// as a different number rather than as coincidentally right.
//
// AND A FRAME IS RUN AT THE END. A build that queued its award rather than paying
// it at the call would pass every reading taken between two poses; the frame is
// where a queued payment lands, and the three fields are read once more after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  SCORE_VICTORY_PER_LIFE,
  SCORE_WAVE_CLEAR,
  START_LIVES,
  SURGE_DEFS,
} from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** Money, lives and a wave posed to figures no award or starting value produces. */
const POSED_MONEY = 4137;
const POSED_LIVES = 13;
const POSED_WAVE = 7;

/**
 * The scores posed, each one a figure `specs/economy.md` attaches an award to.
 *
 * Zero, a Core's bounty, one wave clear, a twenty-wave run's last wave clear, one
 * life's victory bonus, and a full twenty lives' worth — so a build routing the
 * pose through any of its three scoring paths settles that path's account here.
 */
const BOUNDARIES: readonly number[] = [
  0,
  SURGE_DEFS.core.bounty,
  SCORE_WAVE_CLEAR,
  SCORE_WAVE_CLEAR * 20,
  SCORE_VICTORY_PER_LIFE,
  SCORE_VICTORY_PER_LIFE * START_LIVES,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the score across every scoring boundary and pays nothing", async () => {
  await startRun(h);
  await h.debug.setMoney(POSED_MONEY);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setWave(POSED_WAVE);

  for (const score of BOUNDARIES) {
    await h.debug.setScore(score);
    const s = await h.snapshot();
    assertEqual(s.score, score, `the score setScore(${score}) posed`);
    assertEqual(s.money, POSED_MONEY, `the money after setScore(${score})`);
    assertEqual(s.lives, POSED_LIVES, `the lives after setScore(${score})`);
    assertEqual(s.wave, POSED_WAVE, `the wave after setScore(${score})`);
  }

  // And a frame, which is where a queued award would land.
  await h.advance(1);
  await captureStill(h, "score");

  const settled = await h.snapshot();
  assertEqual(
    settled.score,
    BOUNDARIES[BOUNDARIES.length - 1],
    "the score a frame after the last pose",
  );
  assertEqual(
    settled.money,
    POSED_MONEY,
    "the money a frame after the last pose",
  );
  assertEqual(
    settled.lives,
    POSED_LIVES,
    "the lives a frame after the last pose",
  );
  assertEqual(settled.wave, POSED_WAVE, "the wave a frame after the last pose");
});
