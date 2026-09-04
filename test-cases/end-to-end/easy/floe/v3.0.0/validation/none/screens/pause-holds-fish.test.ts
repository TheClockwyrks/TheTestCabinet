// Floe — screens/pause-holds-fish: the bonus catch keeps its bay while the pause
// menu is showing, and its linger runs out only once play resumes.
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
// THE CADENCE'S GATE IS TURNED BACK ON, AND THAT IS THE WHOLE POINT OF THE ITEM.
// `startCrossing` shuts all four world gates so no scenario is disturbed by one,
// and `setFishCadence(true)` is what makes this reading mean anything: a catch
// whose clock was never running would sit in its bay whatever the screen did.
// This is one of exactly two points in the pause set that turns a gate back on,
// because the gate IS the requirement here.
//
// THE HELD SPAN IS SHORTER THAN `FISH_LINGER`, so a build that suspended the
// cadence correctly still has the catch in its bay at the end of it, and the
// resumed span is long enough to carry the linger out — which is what separates
// "suspended" from "stopped forever".

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThan } from "../assert";
import { FISH_LINGER, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The bay the bonus catch is posed in. Any bay does; this one is not an end. */
const FISH_BAY = 2;

/** The stretch the paused screen is held for: well inside `FISH_LINGER`. */
const HELD_SECONDS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bonus catch in its bay across three paused seconds", async () => {
  await startCrossing(h);
  // The one gate this item's requirement IS (specs/instrumentation.md).
  await h.debug.setFishCadence(true);
  await h.debug.setFishBay(FISH_BAY);
  await h.debug.setScreen("paused");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(posed.fishCadence, true, "with the bonus catch's gate open");
  assertEqual(posed.fishBay, FISH_BAY, `and the catch in bay ${FISH_BAY}`);
  assertLessThan(
    HELD_SECONDS,
    FISH_LINGER,
    "the held span inside the linger, so a suspended cadence still has the " +
      "catch out at the end of it (specs/bays.md)",
  );

  await h.advance(ticksFor(HELD_SECONDS));
  const paused = await h.snapshot();
  await captureStill(h, "fish");

  assertEqual(
    paused.fishBay,
    FISH_BAY,
    `the bonus catch still in bay ${FISH_BAY} after ${HELD_SECONDS} s of the ` +
      "pause menu: pausing suspends its cadence (specs/progression.md)",
  );
  assertBetween(
    paused.simTime - posed.simTime,
    HELD_SECONDS - TICK_DT,
    HELD_SECONDS + TICK_DT,
    `${HELD_SECONDS} s of ticks to have run while it held (specs/instrumentation.md)`,
  );

  // Resumed, the linger runs out on its own, which is what says the cadence was
  // suspended rather than never running (specs/bays.md).
  await h.debug.setScreen("playing");
  const gone = await h.until((snapshot) => snapshot.fishBay === null, {
    maxTicks: ticksFor(FISH_LINGER) + ticksFor(1),
    poll: ticksFor(0.25),
  });
  assertEqual(
    gone.hit,
    true,
    "the linger running out once play resumes, so what held the catch was the " +
      "pause rather than a cadence that never runs (specs/bays.md)",
  );
});
