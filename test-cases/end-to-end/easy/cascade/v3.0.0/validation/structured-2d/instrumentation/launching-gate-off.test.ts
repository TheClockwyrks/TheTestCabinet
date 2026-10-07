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
import { assertEqual, assertGreaterThan } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  card,
  cardsHome,
  createHarness,
  flyerById,
  KING,
  poseFlyer,
  startCascade,
  type Harness,
} from "../harness";

/** The card posed in flight, mid-table and clear of both side edges. */
const FLYER = { spec: card("hearts", KING), x: 400, y: 300, vx: 120, vy: 0 };

/** How long the gated cascade is left running. */
const GATED_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends no further card up over a second while a card already in flight keeps moving", async () => {
  // A real win: fifty-two cards home, the cascade entered by the move that
  // completed the board. No frame has run, so nothing has launched yet.
  startCascade(h);
  h.debug.setLaunching(false);
  assertEqual(
    h.snapshot().launching,
    false,
    "snapshot().launching after setLaunching(false): each gate is reported by " +
      "snapshot (specs/instrumentation.md)",
  );
  const flyerId = poseFlyer(
    h,
    FLYER.spec,
    FLYER.x,
    FLYER.y,
    FLYER.vx,
    FLYER.vy,
  );

  const before = h.snapshot();
  assertEqual(
    before.launched,
    0,
    "cards the cascade had launched before the gate was closed",
  );

  await h.advanceSeconds(GATED_SECONDS);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "gated");

  assertEqual(
    cardsHome(after),
    DECK_SIZE,
    `cards left on the four foundations after ${GATED_SECONDS} s with ` +
      "setLaunching(false): off, no further card leaves the foundations " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.launched,
    0,
    `cards the cascade launched over ${GATED_SECONDS} s with the gate off ` +
      "(specs/instrumentation.md)",
  );

  const flyer = flyerById(after, flyerId);
  assertGreaterThan(
    flyer?.x ?? Number.NEGATIVE_INFINITY,
    FLYER.x,
    "how far right the card already in flight reached, having been posed at " +
      `x = ${FLYER.x} with vx = ${FLYER.vx}: every card already in flight ` +
      "keeps flying (specs/instrumentation.md)",
  );
});
