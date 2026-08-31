// instrumentation/clear-bays — `clearBays()` opens all five bays, and does nothing
// else.
//
// specs/instrumentation.md gives the operation exactly that scope: "Opens all five
// bays. It scores nothing and clears nothing." specs/bays.md says why the second
// half matters: "A level is cleared by the hop that fills its last open bay. The
// clear follows from that hop and from no other event", and specs/scoring.md gives
// every score to an event rather than to a pose.
//
// WITHOUT IT, EVERY SCENARIO IN THIS SUITE IS SUSPECT. `startCrossing` calls it on
// the way to posing an empty strait, so a `clearBays` that scored, or that carried
// the level on, would hand a point to a build under a heading about scoring or
// about progression rather than here.
//
// THE FIVE BAYS ARE POSED FILLED FIRST, WHICH IS THE ONLY POSE THAT DECIDES THIS.
// A clear over bays that were already open would pass on a build whose `clearBays`
// does nothing at all. Posing them rather than hopping into them is what
// `bays/posed-full-does-not-clear` grades and what makes the whole suite poseable:
// a strait whose bays stand filled without such a hop is a level still being
// played, so the reading below is of the clear alone.
//
// THE SCORE IS POSED AWAY FROM ZERO for the same reason: a build that reset the
// score rather than leaving it would read `0` either way if the scenario had never
// scored, and specs/scoring.md's smallest award is `SCORE_ROW` (`10`), so a score
// that moved at all by any amount the game can award is caught.
//
// AND THE FRAMES AFTER THE CLEAR ARE RUN. A clear deferred to the next update
// would pass a check that read the snapshot with no frame between, so the strait
// is driven on afterwards — empty and quiet, where nothing else can score and
// nothing else can end a level.

import { afterEach, beforeEach, it } from "vitest";
import { BAY_COUNT } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the clear is taken on, and the score posed before it. */
const LEVEL = 3;
const SCORE = 1470;

/** Five bays, none of them filled: what `clearBays` leaves behind. */
const ALL_OPEN: boolean[] = Array.from({ length: BAY_COUNT }, () => false);

/** Seconds of stepped game time run after the clear, so a deferred one fires. */
const SETTLE_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens all five bays without scoring and without clearing the level", async () => {
  startCrossing(h, LEVEL);
  h.debug.setScore(SCORE);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) h.debug.setBay(bay, true);

  const before = h.snapshot();
  assertEqual(
    before.bays.filter(Boolean).length,
    BAY_COUNT,
    "the bays standing filled before the clear, of which the pose filled five",
  );
  assertEqual(
    before.phase,
    "crossing",
    "the phase five posed bays left the crossing in (specs/bays.md)",
  );

  h.debug.clearBays();
  const opened = h.snapshot();

  await h.advance(ticksFor(SETTLE_SECONDS));
  const settled = h.snapshot();
  // Before the assertions, so a failing clear still leaves the picture of the far
  // shore it produced.
  captureStill(h, "open");

  assertDeepEqual(
    opened.bays,
    ALL_OPEN,
    "the five bays after clearBays(), which opens every one of them",
  );
  assertEqual(
    opened.score,
    SCORE,
    `the score after clearBays(), against the ${SCORE} posed before it — the ` +
      `operation scores nothing (specs/instrumentation.md)`,
  );
  assertEqual(
    opened.level,
    LEVEL,
    `the level after clearBays(), against the ${LEVEL} the crossing was posed ` +
      `on — the operation clears nothing`,
  );
  assertEqual(
    opened.screen,
    "playing",
    "the screen after clearBays() — a level cleared on the eighth would have " +
      "won the run (specs/progression.md)",
  );
  assertEqual(
    opened.phase,
    "crossing",
    'the phase after clearBays() — a cleared level holds in "clearing" ' +
      "(specs/progression.md)",
  );

  assertEqual(
    settled.score,
    SCORE,
    `the score ${SETTLE_SECONDS} s of game time after clearBays(), so an award ` +
      `deferred to an update is caught too`,
  );
  assertEqual(
    settled.level,
    LEVEL,
    `the level ${SETTLE_SECONDS} s of game time after clearBays()`,
  );
  assertEqual(
    settled.phase,
    "crossing",
    `the phase ${SETTLE_SECONDS} s of game time after clearBays()`,
  );
});
