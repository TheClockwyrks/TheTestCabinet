// Meltdown — instrumentation/set-score-pays-nothing: posing the score pays nothing.
//
// specs/instrumentation.md, The screen and the run: "`setScore` pays no bonus and
// grants nothing, whatever boundary it carries the score across." The whole of that
// sentence is the point: not merely that the operation does not pay, but that no
// value it is handed makes it pay.
//
// THE BOUNDARIES ARE THE FIGURES THE SCORE IS ACTUALLY PAID IN. specs/economy.md
// scores three events: `SCORE_WAVE_CLEAR` (`100`) per wave on a clear,
// `SCORE_VICTORY_PER_LIFE` (`250`) per life left on a victory, and a kill's bounty.
// So the scores posed here are exactly the totals a run would carry as it crossed
// each of them — one clear, a whole run's worth of clears, one life's victory
// bonus, a full twenty lives' worth, the two together, and one Core's bounty — which
// is where a build that reaches for the awarding path on a score CHANGE would fire.
//
// THREE FIGURES ARE WATCHED, one per thing an award moves. specs/economy.md pays the
// clear bonus and the victory bonus into the MONEY, specs/waves.md advances the WAVE
// on a clear, and specs/surge.md takes LIVES on the leak path — so a build whose
// `setScore` runs the wave-clear transition is caught on the money and on the wave,
// and one that runs an ending is caught on the lives.
//
// EACH POSE IS FOLLOWED BY A FRAME. An award raised on the frame after the pose is
// the same defect as one raised inside it, and a check that read the state without
// running an update would miss it. The floor is otherwise empty and the world gate is
// shut, so that frame has nothing of its own to do.
//
// AND EVERY WATCHED FIGURE IS POSED AWAY FROM THE VALUE AN AWARD WOULD LEAVE. `4321`
// money is no bonus's multiple, `46` lives is neither `0` nor the mode's starting
// lives, and Wave `7` is neither the first nor the last of a twenty-wave run, so a
// build that pays, that ends the run, or that advances the wave reads something other
// than what it was handed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  SCORE_VICTORY_PER_LIFE,
  SCORE_WAVE_CLEAR,
  START_LIVES,
  SURGE_DEFS,
} from "../../src/constants";
import {
  captureStill,
  createHarness,
  startRun,
  waveCountOf,
  type Harness,
} from "../harness";

/** The run the poses are made on, every figure away from an award's value. */
const MONEY = 4321;
const LIVES = 46;
const WAVE = 7;

/** The waves a Containment Medium run fights, for the run-long clear total. */
const WAVES = waveCountOf("containment", "medium");

/**
 * Every boundary the score is carried across: the figures specs/economy.md scores
 * each of its three events in, at one event and at a whole run of them.
 */
const BOUNDARIES: readonly number[] = [
  0,
  SURGE_DEFS.core.bounty,
  SCORE_WAVE_CLEAR,
  SCORE_WAVE_CLEAR * WAVES,
  SCORE_VICTORY_PER_LIFE,
  SCORE_VICTORY_PER_LIFE * START_LIVES,
  SCORE_WAVE_CLEAR * WAVES + SCORE_VICTORY_PER_LIFE * START_LIVES,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves money, lives and the wave exactly as they were at every scoring boundary", async () => {
  startRun(h);
  h.debug.setMoney(MONEY);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);

  for (const score of BOUNDARIES) {
    h.debug.setScore(score);
    await h.advance(1);

    const s = h.snapshot();
    assertEqual(s.score, score, `the score posed at ${score}`);
    assertEqual(s.money, MONEY, `the money, with the score at ${score}`);
    assertEqual(s.lives, LIVES, `the lives, with the score at ${score}`);
    assertEqual(s.wave, WAVE, `the wave, with the score at ${score}`);
  }

  captureStill(h, "score");
});
