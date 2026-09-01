// instrumentation/launching-gate — `setLaunching(false)` keeps the cards on the
// foundations, and turning it back on lets them go.
//
// specs/instrumentation.md: `setLaunching(enabled)` "gates the cascade's launch
// clock and the launching of the next card. Off, no further card leaves the
// foundations. Every card already in flight keeps flying, bouncing, painting, and
// retiring."
//
// WHY THE SUITE RESTS ON IT. specs/victory.md launches a card every
// `LAUNCH_INTERVAL` (`0.18` s), so a second of the won screen puts six cards in the
// air. Every single-flyer check in the `cascade` group turns this gate off so it
// reads one parabola instead of fifty-two, and a gate that did nothing would fill
// each of those scenarios with cards it never posed.
//
// THE FLYER IN FLIGHT IS THE CONTROL, and it is what makes the gate's narrowness
// readable: it says the second of game time really elapsed, and it says the gate
// held the LAUNCHING alone rather than stopping the cascade's frame outright. A
// build that froze everything fails on the card that should still have been
// travelling.
//
// THE FLYER IS READ ON `x` ALONE, at a velocity that carries it a long way inside
// both side edges over the second, so nothing about gravity, the floor or the
// retirement rule enters the reading; those are the `cascade` group's points. What
// is asserted is only that it moved.
//
// TWO CHECKS, because the two failures are different builds: one whose gate does
// nothing passes the second and fails the first, and one that never launches
// anything passes the first and fails the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  flyerOf,
  framesFor,
  lastFlyer,
  openTable,
  poseFoundation,
  seconds,
  type Harness,
} from "../harness";

/** The foundation the cascade would launch from, built its whole Ace to King. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_UP_TO = 13;

/**
 * The card posed in flight, as its top-left and velocity in logical units.
 *
 * `240` units per second to the right from `x` `200` carries it to `440` over the
 * second, so it stays far inside both side edges and never retires
 * (specs/victory.md). Its `y` is read by nothing here.
 */
const FLYER = { x: 200, y: 200, vx: 240, vy: -600 };

/** The second of game time the item names. */
const HOLD_FRAMES = framesFor(1);

/**
 * How far the card in flight must have traveled along `x` for the second to count
 * as having elapsed, in logical units.
 *
 * A tenth of what `240` units per second covers in a second. It is a floor on
 * "moved at all" rather than a reading of the speed, which is `cascade.advance-x`'s
 * point.
 */
const MIN_TRAVEL = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open the won screen with a full foundation, one card in flight, and the gate as given. */
function openCascade(launching: boolean): number {
  openTable(h);
  h.debug.setScreen("won");
  h.debug.setLaunching(launching);
  // The painted layer is not this point's subject, and a full-screen stamp on
  // every one of the second's frames would bury the card the still is of.
  h.debug.setTrailPainting(false);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  h.debug.addFlyer("hearts", 13, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
  return lastFlyer(h.snapshot()).id;
}

it("lets no card leave the foundations over a second with launching off", async () => {
  const id = openCascade(false);
  const before = h.snapshot();

  await h.advance(HOLD_FRAMES);
  const after = h.snapshot();

  // The foundations holding their cards with launching off.
  captureStill(h, "gated");

  assertDeepEqual(
    after.foundations.map((pile) => pile.length),
    before.foundations.map((pile) => pile.length),
    `the cards on each foundation after ${seconds(HOLD_FRAMES)} s with ` +
      "setLaunching(false) (specs/instrumentation.md)",
  );
  assertEqual(
    after.launched,
    before.launched,
    "the cards the cascade has launched, which stands still with the gate off",
  );
  assertEqual(after.launching, false, "the gate is still off at the end");

  // And the card already in flight kept going, so the second really elapsed and
  // the gate held the launching alone.
  assertGreaterThan(
    Math.abs(flyerOf(after, id).x - flyerOf(before, id).x),
    MIN_TRAVEL,
    "the distance the card already in flight traveled along x, which the " +
      "gate leaves alone (specs/instrumentation.md)",
  );
});

it("lets the cascade launch with the gate on", async () => {
  openCascade(true);
  const before = h.snapshot();

  const swept = await h.until((s) => s.launched > before.launched, {
    maxFrames: HOLD_FRAMES,
  });

  assertEqual(
    swept.hit,
    true,
    "with launching on, a card leaves the foundations within " +
      `${seconds(HOLD_FRAMES)} s of the won screen (specs/victory.md)`,
  );
  assertGreaterThan(
    before.foundations[FOUNDATION].length,
    swept.snapshot.foundations[FOUNDATION].length,
    "the cards left on the foundation the cascade launched from",
  );
});
