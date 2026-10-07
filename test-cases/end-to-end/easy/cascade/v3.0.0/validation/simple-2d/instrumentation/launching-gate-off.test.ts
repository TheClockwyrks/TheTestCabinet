// instrumentation/launching-gate-off — with the cascade's launching gated off,
// the gate reads back off, no further card leaves the foundations, and a card
// already in flight goes on flying.
//
// THE RULE. specs/instrumentation.md, The faculty gates: `setLaunching(enabled)`
// gates "The cascade's launch clock and the launching of the next card. Off, no
// further card leaves the foundations. Every card already in flight keeps flying,
// bouncing, painting, and retiring."
//
// WHY THE OFF DIRECTION IS ITS OWN POINT. A switch that never turns the faculty
// off makes one parabola unreadable among fifty-two: every check in the `cascade`
// group that poses a single card in flight and reads where it went depends on the
// foundations staying put while it does, and a build that ignores the gate fills
// those scenarios with fifty-one cards nobody asked for. That is a different cost
// from a switch that never turns launching back on, which is
// `instrumentation/launching-gate-on`.
//
// BOTH HALVES ARE IN ONE READING, and the second half is what makes the first
// mean anything. A build that froze the whole cascade — or that never ran it at
// all — would hold the foundations perfectly still and be indistinguishable from
// a build with a working gate, so the posed card is the control: it must have
// moved over the same second, which is what says the second was spent on a
// cascade rather than on a stopped game.
//
// THE CONTROL IS READ AS `x` ALONE, and loosely. specs/victory.md integrates
// `x` against a constant `vx`, so a second at the posed speed is a distance the
// specification fixes exactly — but nothing here asserts that distance, only that
// the card is no longer where it was posed. How far it should have gone is
// `cascade/*`'s.
//
// THE FOUNDATIONS ARE READ CARD BY CARD, not merely counted, so a build that
// launched one card and dealt another back onto a foundation is caught as well.
// The card in flight is posed CLEAR OF BOTH SIDE EDGES for the whole second, so
// it cannot retire and turn a reading about launching into one about retirement.
//
// WHAT THIS DOES NOT DECIDE. The launch cadence, the launch order, or the
// velocity a card launches with, all of which are `cascade/*`'s. This point
// decides the gate.

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
