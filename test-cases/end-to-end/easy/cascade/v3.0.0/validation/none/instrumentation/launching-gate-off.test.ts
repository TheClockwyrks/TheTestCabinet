// instrumentation/launching-gate-off — with the cascade's launching gated off,
// the gate reads back off, no further card leaves the foundations, and a card
// already in flight goes on flying.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setLaunching(enabled)`
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
// THE CONTROL IS READ AS `x` ALONE, and loosely. `specs/victory.md` integrates
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
import { assertEqual, assertNotEqual } from "../assert";
import { CARD_W, FLOOR_Y, STAGE_W, SUITS } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  poseFlyer,
  poseFoundation,
  requireFlyer,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** How far each of the four foundations is built up before the gate goes off. */
const FOUNDATION_UP_TO = 5;

/** The span the gate is held over, in seconds. */
const SPAN_SECONDS = 1;

/**
 * The card posed in flight, and why it is where it is.
 *
 * `specs/victory.md` retires a card once `x + CARD_W < 0` or `x > STAGE_W`. At
 * `vx` of `160` a second carries it from `400` to `560`, which leaves it more
 * than half the stage clear of the right edge, so it is still flying at the
 * reading. It starts above `FLOOR_Y` (`580`) with no vertical speed of its own.
 */
const FLYER = { x: 400, y: 160, vx: 160, vy: 0 };

/** The four foundations printed whole, so a card that left is named. */
function foundations(s: CascadeSnapshot): string {
  return s.foundations
    .map(
      (pile, index) =>
        `foundation ${index}: ` +
        (pile.length === 0
          ? "(empty)"
          : pile.map((c) => `${c.id}:${c.suit}-${c.rank}`).join(" ")),
    )
    .join(" | ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every card on the foundations while a posed card flies on", async () => {
  await openTable(h);
  for (const [index, suit] of SUITS.entries()) {
    await poseFoundation(h, index, suit, FOUNDATION_UP_TO);
  }
  // The cascade runs on the `won` screen (`specs/victory.md`), which is the only
  // screen on which a card could leave a foundation at all.
  await h.debug.setScreen("won");
  await h.debug.setLaunching(false);
  assertEqual(
    (await h.snapshot()).launching,
    false,
    "snapshot().launching after setLaunching(false): each gate is reported by " +
      "snapshot (specs/instrumentation.md)",
  );

  if (FLYER.x < 0 || FLYER.x + FLYER.vx * SPAN_SECONDS > STAGE_W - CARD_W) {
    throw new RangeError(
      `cascade: a flyer posed at x ${FLYER.x} with vx ${FLYER.vx} does not ` +
        `stay clear of the side edges for ${SPAN_SECONDS} s`,
    );
  }
  if (FLYER.y > FLOOR_Y) {
    throw new RangeError(
      `cascade: a flyer posed at y ${FLYER.y} is not clear of the floor`,
    );
  }
  const id = await poseFlyer(h, FLYER);

  const before = await h.snapshot();
  const held = foundations(before);

  await h.advance(framesFor(SPAN_SECONDS));
  const after = await h.snapshot();

  // Before the assertions, so a launch that should not have happened still
  // leaves the picture of the foundations it emptied.
  await captureStill(h, "gated");

  // The control first: the second really was spent on a running cascade.
  assertNotEqual(
    requireFlyer(after, id, "reading the control card in flight").x,
    FLYER.x,
    `the x of the card posed in flight after ${SPAN_SECONDS} s of game time, ` +
      `which is where it was posed — every card already in flight keeps flying ` +
      `with the gate off (specs/instrumentation.md), and without a card that ` +
      `moved, foundations that did not say nothing`,
  );

  assertEqual(
    foundations(after),
    held,
    `the four foundations after ${SPAN_SECONDS} s on the won screen with ` +
      `setLaunching(false), against the ${FOUNDATION_UP_TO} cards each was ` +
      `built up to — with the gate off no further card leaves the foundations ` +
      `(specs/instrumentation.md)`,
  );
  assertEqual(
    after.launched,
    before.launched,
    `the cards the cascade counted out over that second, against the count ` +
      `before it — the gate stops the launch clock and the launching of the ` +
      `next card (specs/instrumentation.md)`,
  );
});
