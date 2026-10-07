// Floe — screens/pause-resumes-escape: the back action closes the pause menu and
// gives the crossing back exactly as pausing left it.
//
// `specs/ui.md` gives the `paused` screen two inputs that return to `playing`:
// the `paused` row's "Back — Returns to `playing`, resuming the crossing as it
// stood", and the row beneath it, "Pause — Returns to `playing`, resuming the
// crossing as it stood". `specs/controls.md` says the same thing from the keys'
// side: "Pause — Open the pause menu from the `playing` screen, and close it from
// the `paused` screen, resuming the crossing as it stood."
//
// THE TWO ARE TWO POINTS BECAUSE THEY ARE TWO KEYS. `Escape` drives both pause
// and back, so a build that wired only its BACK path still closes the menu with
// `Escape` and leaves a player pressing `KeyP` stuck on it. Grading them together
// would let that build keep the point.
//
// THE COMPARISON IS AGAINST WHAT PAUSING LEFT, NOT AGAINST A LIST OF NUMBERS.
// Every field below is read once on the paused screen and once on the frame the
// press was delivered, and the two readings must agree. A build that answered by
// starting a fresh run would report a level of `1`, three lives, a score of `0`
// and five open bays, and this scenario poses none of those.
//
// THE THINGS THAT WOULD MOVE ON THEIR OWN ARE POSED STILL, because this point is
// about what SURVIVES the transition. The bear is posed with all three faculties
// off, the crossing timer's gate is shut by `startCrossing`, and the strait
// carries no lane items. That the strait runs again after a resume is
// `screens.pause-freezes` read the other way.
//
// THE CRITTER STANDS ON THE MEDIAN. `startCrossing` empties both bands, so every
// water row is open water and would drown a critter on the first frame after the
// resume (`specs/water.md`). The median is solid, so what is read is the resume
// rather than a death.
//
// THE SCREEN IS POSED, NOT PAUSED WITH A KEY. A build whose pause key never
// OPENS the menu loses `controls.pause-escape` and keeps this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  tapAction,
  type Harness,
} from "../harness";

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

/** A stretch of the paused screen before the press, so the clip reads as a pause. */
const PAUSED_TICKS = 24; // 0.2 s

/** A stretch of the resumed crossing after it. Nothing is measured across it. */
const RESUMED_TICKS = 24; // 0.2 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the crossing with every field pausing left it", async () => {
  startCrossing(h, LEVEL);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setTimer(TIMER);
  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);
  const bear = poseBear(h, BEAR_COL, BEAR_ROW, {
    sense: false,
    routing: false,
    travel: false,
  });
  h.debug.setScreen("paused");

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
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
    const paused = h.snapshot();
    await tapAction(h, "back");
    const resumed = h.snapshot();
    await h.advance(RESUMED_TICKS);
    return { before: paused, after: resumed };
  });

  assertEqual(
    after.screen,
    "playing",
    "the back action on the pause menu returns to the crossing (specs/ui.md)",
  );
  assertEqual(after.score, before.score, "with the score as it stood");
  assertEqual(after.lives, before.lives, "the lives as they stood");
  assertEqual(after.level, before.level, "the level as it stood");
  assertEqual(after.timer, before.timer, "the crossing timer as it stood");
  assertDeepEqual(after.bays, before.bays, "the bays as they stood");
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
