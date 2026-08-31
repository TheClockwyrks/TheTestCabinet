// progression/timer-resets-on-bay — the crossing that follows a filled bay starts on
// a full clock.
//
// specs/progression.md, on a fresh crossing: "The crossing timer goes back to
// `timerMax`". specs/bays.md sends the crossing that follows a filled bay through
// exactly that door: "When open bays remain, a fresh crossing then begins from the
// near shore after the hold `specs/progression.md` fixes."
//
// THE CLOCK IS POSED AWAY FROM ITS FULL VALUE FIRST, which is the whole design of
// this point. Left at `timerMax` it would read `timerMax` afterwards whether the
// build reset it or never touched it, and this check would pass on a build with no
// reset at all. Posed at `POSED_TIMER` the two models read different numbers, and
// both are named: the clock is back at whatever the snapshot reports as `timerMax`,
// and it is no longer the number this check left it at.
//
// `timerMax` IS READ FROM THE BUILD RATHER THAN COMPUTED HERE. What a level-1
// crossing's clock is worth is `progression/timer-length-level-1`'s requirement, and
// a build that got that figure wrong should fail there and nowhere else.
//
// THE DRAIN STAYS GATED OFF, as `startCrossing` leaves it. With it running the
// reading would be `timerMax` less however much of the hold had elapsed, and this
// point would be grading the drain rather than the reset. specs/instrumentation.md
// is explicit that the gate does not touch the reset — "It still resets on a filled
// bay" — so the thing under test runs exactly as it does in play.
//
// THE BAY IS FILLED BY A REAL HOP rather than by `setBay`, because `setBay` "scores
// nothing and clears no level" (specs/instrumentation.md) and starts no crossing
// either: only the hop that ends a crossing does. One bay is filled and four stay
// open, so a crossing follows rather than the level clearing.

import { afterEach, beforeEach, it } from "vitest";
import { BAYFILL_PAUSE } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth, requestHop } from "./crossing";

/** The bay this point fills. Four stay open, so a crossing follows rather than a clear. */
const BAY = 1;

/**
 * The clock the crossing is posed with.
 *
 * Any value the level's own `timerMax` is not. Seven seconds is well inside a
 * level-1 crossing's thirty (specs/progression.md), so the pose is a crossing
 * part-way through rather than an impossible one.
 */
const POSED_TIMER = 7;

/**
 * The bay-fill hold, driven out: `BAYFILL_PAUSE` (`0.5` s) is `60` whole ticks at the
 * `TICK_HZ` (`120`) specs/overview.md fixes.
 */
const HOLD_TICKS = ticksFor(BAYFILL_PAUSE);

/**
 * Two ticks of room past the hold.
 *
 * The hold's own length belongs to specs/progression.md's phase table and is not
 * what this point reads; all it needs is to be standing on the far side of it. The
 * two ticks cover a build that tests its hold before subtracting the tick rather
 * than after, and the rounding of sixty subtractions of a hundred-and-twentieth.
 */
const TOLERANCE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the crossing that follows a filled bay back on a full clock", async () => {
  startCrossing(h);
  poseAtBayMouth(h, BAY);
  h.debug.setTimer(POSED_TIMER);

  const before = h.snapshot();
  assertEqual(
    before.timer,
    POSED_TIMER,
    "the clock the crossing was posed with",
  );
  assertEqual(before.timerRunning, false, "the drain left gated off");
  assertNotEqual(
    before.timerMax,
    POSED_TIMER,
    "a pose the level's own full clock is not",
  );

  const { filled, fresh } = await captureReplay(h, "reset", async () => {
    await requestHop(h, "up");
    const landed = h.snapshot();
    await h.advance(HOLD_TICKS + TOLERANCE_TICKS);
    return { filled: landed, fresh: h.snapshot() };
  });

  // The situation the reading was taken in: that hop really did end the crossing in
  // the bay, and the hold it began really did give a fresh crossing back.
  assertEqual(filled.bays[BAY], true, `bay ${BAY} filled by that hop`);
  assertEqual(fresh.critter.present, true, "a critter back on the strait");

  assertEqual(
    fresh.timer,
    fresh.timerMax,
    "the crossing timer, back at timerMax (specs/progression.md)",
  );
  assertNotEqual(
    fresh.timer,
    POSED_TIMER,
    "the clock the completed crossing was left on",
  );
});
