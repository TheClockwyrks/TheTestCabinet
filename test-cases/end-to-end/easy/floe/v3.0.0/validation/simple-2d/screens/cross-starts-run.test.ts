// Floe — screens/cross-starts-run: confirming the first title item opens a live
// crossing, and the run it opens is a NEW one.
//
// `specs/ui.md`, the title row of the transitions table: "Confirm — `CROSS` starts
// a run and opens `playing`", and, under it, "Starting a run is what
// `specs/progression.md` fixes". That file fixes it in full: "A run opens at level
// `1` with `lives` at `START_LIVES` (`3`), the score at `0`, `reachedLevel` at
// `1`, the strait laid out for level `1`, all five bays open, no bonus catch out,
// and a fresh crossing under way", and a fresh crossing "puts the critter on the
// near shore at column `START_COL` (`20`) ... The crossing timer goes back to
// `timerMax`".
//
// NO POSE CAN PRODUCE ANY OF THIS. That is the whole reason this point exists
// beside `controls.confirm-enter`, which grades only that `Enter` accepted the
// item. `setLevel` starts no run, `setScore` grants nothing, `setTimer` kills
// nothing: the surface is atomic by design (`specs/instrumentation.md`), so the
// only thing that can open a run is the build's own start-a-run path, and this
// check drives it the way a player does — one confirm at a title screen `reset`
// restored, with the first entry highlighted.
//
// THE READINGS ARE THE FIVE THE ITEM NAMES, which are five faces of one thing: a
// run that has just begun. A build that opens `playing` with the previous run's
// score still on it has not started a run; a build that opens it with two lives
// has not either. `reachedLevel` and the laid-out strait are the two the item
// leaves to `progression`, and the bonus catch to `bays`.
//
// THE TIMER IS READ WITH A TICK OF SLACK. `timer` drains while `phase` is
// `crossing` (specs/progression.md), and the confirm's own tick and the settling
// tick are both crossing ticks, so a full timer at the moment it is read is
// `timerMax` less at most the couple of ticks that have run since — never
// `timerMax` less a whole second, which is what a build that started the clock
// early or set the wrong `timerMax` would show.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  BAY_COUNT,
  BINDINGS,
  ROW_NEAR,
  START_COL,
  START_LIVES,
  TICK_DT,
  crossingTimer,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The title entry this transition belongs to: `CROSS`, the first. */
const CROSS_INDEX = 0;

/** One frame after the press, so the still shows the crossing rather than the title. */
const SETTLE_TICKS = 1;

/** The level a new run opens at (specs/progression.md). */
const START_LEVEL = 1;

/** Five open bays, the state a new run opens with (specs/progression.md). */
const OPEN_BAYS: readonly boolean[] = Array.from(
  { length: BAY_COUNT },
  () => false,
);

/**
 * How far below `timerMax` a full timer may already have drained, in seconds.
 *
 * Three ticks: the tick `tap` runs to deliver the press, the settling tick after
 * it, and one more so a build that opens the run on the tick AFTER the edge is not
 * marked down for it. At `TICK_DT` of a second each that is a fortieth of a second
 * against a level-1 timer of thirty, so the nearest wrong reading a build could
 * hold — a timer left where the previous run's stood, or a `timerMax` from another
 * level, both whole seconds away — is far outside it.
 */
const TIMER_SLACK = 3 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh level-1 crossing when CROSS is confirmed", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(CROSS_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(posed.menuIndex, CROSS_INDEX, "the pose highlighted CROSS");

  await h.tap(BINDINGS.confirm[0]);
  await h.advance(SETTLE_TICKS);
  captureStill(h, "game");

  const run = h.snapshot();
  assertEqual(
    run.screen,
    "playing",
    "confirming CROSS opens the playing screen (specs/ui.md)",
  );
  assertEqual(
    run.level,
    START_LEVEL,
    "a run opens at level 1 (specs/progression.md)",
  );
  assertEqual(
    run.lives,
    START_LIVES,
    "with START_LIVES lives (specs/progression.md)",
  );
  assertEqual(
    run.timerMax,
    crossingTimer(START_LEVEL),
    "and timerMax at crossingTimer(1) (specs/progression.md)",
  );
  assertBetween(
    run.timer,
    crossingTimer(START_LEVEL) - TIMER_SLACK,
    crossingTimer(START_LEVEL),
    "a full crossing timer (specs/progression.md)",
  );
  assertDeepEqual(
    run.bays,
    OPEN_BAYS,
    "all five bays open (specs/progression.md)",
  );
  assertEqual(
    run.critter.present,
    true,
    "a critter on the strait (specs/progression.md: a fresh crossing under way)",
  );
  assertEqual(
    run.critter.col,
    START_COL,
    "the critter on the near shore at START_COL (specs/progression.md)",
  );
  assertEqual(
    run.critter.row,
    ROW_NEAR,
    "and on ROW_NEAR (specs/progression.md)",
  );

  // The strait laid out for level 1, which is what makes the opened screen a
  // crossing rather than an empty stage: `specs/ice.md` and `specs/water.md` give
  // every one of the sixteen lanes items.
  assertGreaterThan(
    run.vehicles.length,
    0,
    "the ice band laid out for the new run (specs/progression.md)",
  );
  assertGreaterThan(
    run.floes.length,
    0,
    "the water band laid out for the new run (specs/progression.md)",
  );
});
