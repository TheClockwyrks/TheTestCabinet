// Floe — screens/pause-holds-timer: the crossing timer does not drain while the
// pause menu is showing.
//
// `specs/progression.md` owns the rule, under "What pausing suspends": "The
// `paused` screen suspends the simulation. While it is showing, no lane item,
// critter, bear, or bonus catch moves, the crossing timer does not drain, and no
// hold advances." `screens.pause-freezes` reads the three BODIES that sentence
// names; the three clocks it names are three points of their own, because a build
// can suspend the strait's motion and go on draining a clock, and a player who
// paused to think about a crossing would come back to a life already lost.
//
// THE TICKS REALLY RAN, AND THE CHECK PROVES IT. A build that answered `advance`
// with nothing at all while paused would hold this reading and deserve none of
// it, so `simTime` is read across the same span: `specs/instrumentation.md` makes
// it add `TICK_DT` on every tick whatever the screen and calls it "the one
// quantity that keeps accumulating while the screen is `paused`".
//
// AND THE CLOCK IS SHOWN TO RUN AGAIN. A build that simply never runs this clock
// at all would hold the paused reading too, so the same span is driven once more
// on `playing` and the clock has to move there. The two halves together are the
// requirement: suspended while paused, running while playing.
//
// THE SCREEN IS POSED, NOT PAUSED WITH A KEY, so a build whose pause key is dead
// loses `controls.pause-p` and still has the suspension graded here.
//
// THE TIMER'S GATE IS TURNED BACK ON, AND THAT IS THE WHOLE POINT OF THE ITEM.
// `startCrossing` shuts all four world gates so no scenario is disturbed by one,
// and `setTimerRunning(true)` is what makes this reading mean anything: a check
// that read a stopped clock holding still would pass every build ever written.
// This is one of exactly two points in the pause set that turns a gate back on,
// because the gate IS the requirement here.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThan } from "../assert";
import { TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The seconds the crossing timer is posed with: well clear of zero. */
const POSED_TIMER = 20;

/** The stretch the paused screen is held for, and the one play runs for after. */
const HELD_SECONDS = 3;

/**
 * How far a suspended clock may move: float noise and nothing else.
 *
 * A suspended timer does not integrate, so what a check reads is the number that
 * was stored. Three seconds of a running timer is three whole units away from it.
 */
const STILL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the crossing timer across three paused seconds, and drains after", async () => {
  await startCrossing(h);
  // The one gate this item's requirement IS (specs/instrumentation.md).
  await h.debug.setTimerRunning(true);
  await h.debug.setTimer(POSED_TIMER);
  await h.debug.setScreen("paused");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(posed.timerRunning, true, "with the crossing timer's gate open");
  assertEqual(posed.timer, POSED_TIMER, `and the timer at ${POSED_TIMER} s`);

  const { paused, resumed } = await captureReplay(h, "pause", async () => {
    await h.advance(ticksFor(HELD_SECONDS));
    const held = await h.snapshot();
    await h.debug.setScreen("playing");
    await h.advance(ticksFor(HELD_SECONDS));
    return { paused: held, resumed: await h.snapshot() };
  });

  assertBetween(
    paused.timer,
    POSED_TIMER - STILL,
    POSED_TIMER + STILL,
    `the crossing timer still at ${POSED_TIMER} s after ${HELD_SECONDS} s of ` +
      "the pause menu: pausing suspends it (specs/progression.md)",
  );
  assertBetween(
    paused.simTime - posed.simTime,
    HELD_SECONDS - TICK_DT,
    HELD_SECONDS + TICK_DT,
    `${HELD_SECONDS} s of ticks to have run while it held (specs/instrumentation.md)`,
  );
  assertLessThan(
    resumed.timer,
    POSED_TIMER - 1,
    "the same span on `playing` draining the timer, so what held it was the " +
      "pause rather than a clock that never runs (specs/progression.md)",
  );
});
