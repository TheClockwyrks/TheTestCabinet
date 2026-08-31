// scoring/victory-bonus — winning the run pays two hundred and fifty points for
// every life still in hand.
//
// `specs/scoring.md`: "Victory | `SCORE_VICTORY_LIFE` (`250`) per remaining life |
// The run is won", and "Winning the run pays `SCORE_VICTORY_LIFE * lives` after
// the level award." `specs/progression.md` fixes when that is: "At
// `TOTAL_LEVELS`: the run is won on that hop".
//
// SO THE HOP READ HERE IS THE ONE THAT FILLS THE LAST OPEN BAY OF LEVEL 8, taken
// with the run's full `START_LIVES` (3) still in hand. What it pays is the whole
// stack the specification lists for that one hop, and it is asserted as one
// number because every part of it is a figure the specification fixes:
//
//     SCORE_ROW           10     the bay row, newly reached
//     SCORE_BAY           50     the bay filled
//     SCORE_TIME_BONUS *  0      the timer is posed empty
//     SCORE_LEVEL * 8    800     the level cleared
//     SCORE_VICTORY_LIFE * 3   750     the three lives in hand
//                       ----
//                       1610
//
// THREE LIVES IS THE DISTINGUISHING VALUE, and 8 the distinguishing level: 750 is
// not 250, so a build paying a flat victory bonus reads 860; 800 is not 100, so a
// build paying a flat level award reads 910; and a build paying no victory at all
// reads 860 as well but fails on a different summand than a build that pays it
// per level. The two per-something awards cannot be confused with each other
// either, since 3 lives and 8 levels are different multipliers of different
// figures.
//
// THE TIMER IS POSED EMPTY so the time bonus is worth nothing and the total is
// four figures rather than five. The screen is read alongside the score because
// "the run is won" is the condition the award is paid under: a build that merely
// cleared level 8 like any other level owes 860 and has not won.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BAY_COUNT,
  SCORE_BAY,
  SCORE_LEVEL,
  SCORE_ROW,
  SCORE_VICTORY_LIFE,
  START_LIVES,
  TOTAL_LEVELS,
} from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { completingHop } from "./crossing";

/** The level the run is won on. */
const LEVEL = TOTAL_LEVELS;

/** The bay the winning hop ends in — the middle one, the other four posed filled. */
const BAY = 2;

/** The seconds posed on the crossing timer: none, so no time bonus is in the total. */
const TIMER = 0;

/** The whole stack the winning hop pays: crossing, level, and a life at a time. */
const EXPECTED_AWARD =
  SCORE_ROW +
  SCORE_BAY +
  SCORE_LEVEL * LEVEL +
  SCORE_VICTORY_LIFE * START_LIVES;

/** Ticks recorded after the winning hop, for the replay alone. */
const AFTER_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("pays two hundred and fifty a life for a run won with three in hand", async () => {
  await startCrossing(harness, LEVEL);
  await harness.debug.setTimer(TIMER);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (bay !== BAY) await harness.debug.setBay(bay, true);
  }

  const posed = await harness.snapshot();
  assertEqual(posed.level, LEVEL, "the last level of the run");
  assertEqual(posed.lives, START_LIVES, "the lives still in hand");
  assertEqual(posed.score, 0, "a fresh run's score");

  const won = await captureReplay(harness, "score", async () => {
    const hop = await completingHop(harness, BAY);
    await harness.advance(AFTER_TICKS);
    return hop;
  });

  // The run has to have been WON by that hop for a victory award to be due at
  // all; a build still playing owes the level award alone.
  assertEqual(won.landed.screen, "victory", "the run won by that hop");

  assertEqual(
    won.paid,
    EXPECTED_AWARD,
    `SCORE_VICTORY_LIFE * ${START_LIVES} on top of the level-8 clear`,
  );
});
