// progression/game-over-at-zero — the death that takes the last life ends the
// run, and ends it when the hold expires rather than on the tick of the death.
//
// specs/progression.md, on what the death hold expires into: "`lives` at `0`: the
// run is over and the screen becomes `gameover`, reporting `reachedLevel`."
//
// THE LAST LIFE IS POSED, NOT SPENT. `setLives` "ends no run, so `setLives(0)`
// leaves the game playing and the next death ends it" (specs/instrumentation.md),
// so posing `POSED_LIVES` (`1`) and taking one death is the shortest route to the
// requirement — two deaths would grade `catch-costs-life`'s rule twice on the way
// to grading this one. That posing `0` on its own ends nothing is
// `progression/posed-zero-lives-does-not-end`; this point is about the DEATH.
//
// THE READING IS TAKEN TWICE, EITHER SIDE OF THE HOLD, because "the run is over"
// and "when the hold expires" are one sentence. A build that jumped to `gameover`
// on the tick the life was lost is wrong in a way a single late reading cannot
// see: it would show the same screen at the same moment as a build that held. So
// `EARLY` reads a tenth of a second short of `DEATH_PAUSE`, where a build that
// held is still `dying` and has NOT ended the run, and `LATE` reads a tenth past
// it, where it has. The tenth of a second is twelve whole ticks at the `TICK_HZ`
// (`120`) `specs/overview.md` fixes, so neither reading turns on rounding.
//
// THE DEATH IS THE CHEAPEST ONE TO REACH: the critter is posed on the emptied
// water band and falls in on the very next tick (specs/water.md). That each of
// the five deaths reaches `dying` at all is each of their own items' requirement,
// and the hold is the same one whatever began it.
//
// The emptied counter is read as the SITUATION rather than as the requirement: a
// build that lost the life without spending it has not reached the state this
// point is about, and would otherwise be graded for a screen it changed for
// another reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { DEATH_PAUSE, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The lives the run is posed with: one, so a single death empties them. */
const POSED_LIVES = 1;

/** The water tile the death is taken on. */
const DEATH_COL = START_COL;
const DEATH_ROW = 5;

/** The one tick the fall needs. */
const FALL_TICKS = 1;

/**
 * How far either side of `DEATH_PAUSE` the two readings are taken, in seconds.
 *
 * A tenth of a second, twelve whole ticks at the `TICK_HZ` (`120`)
 * `specs/overview.md` fixes, so neither reading can be decided by the rounding of
 * a hundred and eight subtractions of a hundred-and-twentieth.
 */
const TOLERANCE = 0.1;

/** The two readings, in ticks after the tick the life was lost on. */
const EARLY = ticksFor(DEATH_PAUSE - TOLERANCE);
const LATE = ticksFor(DEATH_PAUSE + TOLERANCE) - EARLY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run on the death that empties the lives, once the hold expires", async () => {
  await startCrossing(h);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setCritterTile(DEATH_COL, DEATH_ROW);

  const posed = await h.snapshot();
  assertEqual(posed.lives, POSED_LIVES, "the last life, posed");
  assertEqual(
    posed.screen,
    "playing",
    "a run still under way before the death",
  );

  const { struck, held, over } = await captureReplay(
    h,
    "gameover",
    async () => {
      await h.advance(FALL_TICKS);
      const lost = await h.snapshot();
      await h.advance(EARLY);
      const inside = await h.snapshot();
      await h.advance(LATE);
      return { struck: lost, held: inside, over: await h.snapshot() };
    },
  );

  // The situation both readings were taken in: the death really did spend the
  // last life, and the hold it began really was running at the first reading.
  assertEqual(struck.phase, "dying", "a life lost on the emptied water band");
  assertEqual(struck.lives, 0, "the counter the death emptied");
  assertEqual(
    held.phase,
    "dying",
    `still holding a tenth of a second short of DEATH_PAUSE (${DEATH_PAUSE} s)`,
  );

  assertNotEqual(
    held.screen,
    "gameover",
    "a run that is still holding has not ended yet (specs/progression.md)",
  );
  assertEqual(
    over.screen,
    "gameover",
    `the run over once DEATH_PAUSE (${DEATH_PAUSE} s) expired on an empty counter`,
  );
});
