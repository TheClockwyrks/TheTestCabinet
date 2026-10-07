// Floe — screens/pause-holds-phase-timer: a running hold does not advance while
// the pause menu is showing.
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
// THE HOLD IS A DEATH PAUSE. `specs/progression.md` gives a lost life a
// `DEATH_PAUSE` hold on the `dying` phase, and `phaseTimer` is the seconds left
// in it (`specs/instrumentation.md`). The pose puts the game part-way through
// one, which is exactly the state a player who paused mid-death is in.
//
// NO WORLD GATE IS TOUCHED. `startCrossing` leaves all four shut and this point
// wants them shut: a hold is the run's own clock rather than a faculty of the
// world, so nothing here has to be turned back on for the reading to mean
// something.

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

/** The seconds left in the hold the game is posed part-way through. */
const POSED_HOLD = 0.6;

/** The stretch the paused screen is held for: long past the hold. */
const HELD_SECONDS = 3;

/**
 * How far a suspended hold may move: float noise and nothing else.
 *
 * A suspended hold does not integrate, so what a check reads is the number that
 * was stored, and three seconds of a running one would have spent it entirely.
 */
const STILL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a death pause across three paused seconds, and spends it after", async () => {
  await startCrossing(h);
  await h.debug.setPhase("dying");
  await h.debug.setPhaseTimer(POSED_HOLD);
  await h.debug.setScreen("paused");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(posed.phase, "dying", "part-way through a death's hold");
  assertEqual(posed.phaseTimer, POSED_HOLD, `with ${POSED_HOLD} s left in it`);
  assertLessThan(
    POSED_HOLD,
    HELD_SECONDS,
    "the held span longer than the hold, so a hold that advanced at all would " +
      "have been spent by the end of it",
  );

  const { paused, resumed } = await captureReplay(h, "pause", async () => {
    await h.advance(ticksFor(HELD_SECONDS));
    const held = await h.snapshot();
    await h.debug.setScreen("playing");
    await h.advance(ticksFor(HELD_SECONDS));
    return { paused: held, resumed: await h.snapshot() };
  });

  assertBetween(
    paused.phaseTimer,
    POSED_HOLD - STILL,
    POSED_HOLD + STILL,
    `the hold still at ${POSED_HOLD} s after ${HELD_SECONDS} s of the pause ` +
      "menu: pausing suspends it (specs/progression.md)",
  );
  assertEqual(
    paused.phase,
    "dying",
    "and the phase still the one the hold belongs to",
  );
  assertBetween(
    paused.simTime - posed.simTime,
    HELD_SECONDS - TICK_DT,
    HELD_SECONDS + TICK_DT,
    `${HELD_SECONDS} s of ticks to have run while it held (specs/instrumentation.md)`,
  );
  assertEqual(
    resumed.phase,
    "crossing",
    "the same span on `playing` spending the hold, so what held it was the " +
      "pause rather than a hold that never advances (specs/progression.md)",
  );
});
