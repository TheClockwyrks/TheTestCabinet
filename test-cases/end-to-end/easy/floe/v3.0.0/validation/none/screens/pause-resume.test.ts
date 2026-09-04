// Floe — screens/pause-resume: confirming RESUME gives the crossing back exactly
// as pausing left it.
//
// `specs/ui.md`, the `paused` row of the transitions table: "Confirm — `RESUME`
// returns to `playing`", and under the table: "Resuming from `paused` returns the
// crossing exactly as pausing left it, with the score, lives, level, timer, bays,
// critter, and bears untouched." `specs/progression.md` owns the suspension
// itself: "Leaving `paused` resumes from exactly the state pausing left."
//
// THE COMPARISON IS AGAINST WHAT PAUSING LEFT, NOT AGAINST A LIST OF NUMBERS.
// Every field below is read once on the paused screen and once on the tick the
// confirm was delivered, and the two readings must agree. That is the requirement
// as stated, and it is also the only reading that cannot be satisfied by
// accident: a build that answered RESUME by starting a fresh run would report a
// level of `1`, three lives, a score of `0` and five open bays, and this
// scenario poses none of those.
//
// THE CROSSING IS POSED SO EVERY FIELD IS DISTINGUISHING. A run three levels in,
// two lives left, a score on the board, two bays filled, the critter off its
// start tile and a bear on the strait: each of the seven fields the sentence
// names is somewhere a fresh run is not, so a build that restarted rather than
// resumed reads wrong on all seven rather than on none, and a build that dropped
// just the bear roster reads wrong on exactly that one.
//
// THE THINGS THAT WOULD MOVE ON THEIR OWN ARE POSED STILL, because this point is
// about what SURVIVES the transition and not about what runs after it. The bear
// is posed with all three faculties off, so its tile is the tile it was given;
// the crossing timer's gate is shut by `startCrossing`, so `timer` is the number
// this check set rather than that number less the ticks the confirm cost; and the
// strait carries no lane items. That the strait runs again after a resume is not
// this item — it is `screens.pause-freezes` read the other way, and the build's
// own crossing.
//
// THE CRITTER STANDS ON THE MEDIAN. `startCrossing` empties both bands, so every
// water row is open water and would drown a critter on the first tick after the
// resume (`specs/water.md`). The median is solid, so the two ticks this check
// drives past the confirm cost the critter nothing and the reading is of the
// resume rather than of a death.
//
// THE SCREEN IS POSED, NOT PAUSED WITH A KEY, and `Enter` is a real key through
// Chromium's own input pipeline. A build whose pause key is dead loses
// `controls.pause-p` and keeps this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { PAUSE_ITEMS, START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  type Harness,
} from "../harness";

/** The pause entry this transition belongs to: `RESUME`, the first. */
const RESUME_INDEX = 0;

/** The run the crossing is posed as, every figure away from a fresh run's. */
const LEVEL = 3;
const LIVES = 2;
const SCORE = 437;
const TIMER = 12.5;
const FILLED_BAYS = [0, 2] as const;

/** Where the critter stands: the median, which is solid and carries no lane. */
const CRITTER_COL = 7;
const CRITTER_ROW = 10;

/** Where the bear stands: an ice row of its own, emptied of traffic. */
const BEAR_COL = 25;
const BEAR_ROW = 14;

/** A stretch of the paused screen before the confirm, so the clip reads as a pause. */
const PAUSED_TICKS = 24; // 0.2 s

/** A stretch of the resumed crossing after it. Nothing is measured across it. */
const RESUMED_TICKS = 24; // 0.2 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the crossing with every field pausing left it", async () => {
  await startCrossing(h, LEVEL);
  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setTimer(TIMER);
  for (const bay of FILLED_BAYS) await h.debug.setBay(bay, true);
  await h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const bear = await poseBear(h, BEAR_COL, BEAR_ROW, {
    sense: false,
    routing: false,
    travel: false,
    target: { col: BEAR_COL, row: BEAR_ROW },
  });
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(RESUME_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    RESUME_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[RESUME_INDEX]}, the first entry`,
  );
  // The crossing is somewhere a fresh run is not, in every field the rule names,
  // so a build that restarted instead of resuming fails all of them.
  assertNotEqual(posed.level, 1, "a crossing several levels into the run");
  assertNotEqual(posed.lives, START_LIVES, "a run that has lost a life");
  assertNotEqual(posed.score, 0, "a score already on the board");
  assertEqual(
    posed.bays.some((filled) => filled),
    true,
    "bays already filled",
  );
  assertEqual(posed.bears.length, 1, "a bear on the strait to be given back");

  const { before, after } = await captureReplay(h, "resume", async () => {
    await h.advance(PAUSED_TICKS);
    const paused = await h.snapshot();
    await h.tap("Enter");
    const resumed = await h.snapshot();
    await h.advance(RESUMED_TICKS);
    return { before: paused, after: resumed };
  });

  assertEqual(
    after.screen,
    "playing",
    `confirming ${PAUSE_ITEMS[RESUME_INDEX]} returns to the crossing (specs/ui.md)`,
  );
  assertEqual(after.score, before.score, "with the score as it stood");
  assertEqual(after.lives, before.lives, "the lives as they stood");
  assertEqual(after.level, before.level, "the level as it stood");
  assertEqual(after.timer, before.timer, "the crossing timer as it stood");
  assertDeepEqual(after.bays, before.bays, "the bays as they stood");
  assertEqual(
    after.critter.present,
    before.critter.present,
    "the critter still on the strait",
  );
  assertDeepEqual(
    { col: after.critter.col, row: after.critter.row },
    { col: before.critter.col, row: before.critter.row },
    "the critter on the tile it was paused on",
  );
  assertDeepEqual(
    after.bears.map((entry) => ({
      id: entry.id,
      col: entry.col,
      row: entry.row,
    })),
    before.bears.map((entry) => ({
      id: entry.id,
      col: entry.col,
      row: entry.row,
    })),
    `the bear roster as it stood, bear ${bear} included`,
  );
});
