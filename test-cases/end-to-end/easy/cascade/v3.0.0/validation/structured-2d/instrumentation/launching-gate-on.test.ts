// instrumentation/launching-gate-on — with the cascade's launching gated back on,
// the gate reads back on and the same second of game time takes cards off the
// foundations again.
//
// THE RULE. specs/instrumentation.md, The faculty gates: `setLaunching(enabled)`
// gates "The cascade's launch clock and the launching of the next card", and each
// gate "is reported by `snapshot`". specs/victory.md states the faculty: the
// cascade launches a card every `LAUNCH_INTERVAL` (`0.18`) seconds until all
// fifty-two have gone.
//
// WHY THE ON DIRECTION IS ITS OWN POINT, AND WHY IT TURNS THE GATE OFF FIRST. A
// switch that never turns launching back on leaves the ending the game is named
// for dead in normal play, which costs the player something completely different
// from a switch that never turns it off (`instrumentation/launching-gate-off`).
// Setting the gate to `true` from `false` rather than reading the default is what
// makes this a reading of the SWITCH: a build that ignores the operation entirely
// and always launches would otherwise pass on a value it never honoured.
//
// THE BOARD IS THE OFF DIRECTION'S, POSED THE SAME WAY, so nothing separates the
// two points but the gate: four foundations built up to the same rank, on the
// `won` screen, which specs/victory.md makes the only screen a card can leave a
// foundation on.
//
// WHAT IS READ IS THAT CARDS LEFT, NOT HOW MANY OR IN WHAT ORDER. The cadence,
// the launch order and the velocity a card launches with are all `cascade/*`'s;
// this point decides the gate. A second is far more than the `0.18` s the first
// launch needs, so a build that launches at any conformant rate has moved cards
// off the foundations by the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
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

it("reports the gate on again and launches cards off the foundations", async () => {
  // A real win: fifty-two cards home, the cascade entered by the move that
  // completed the board. No frame has run, so nothing has launched yet.
  startCascade(h);
  // Off and then on, so what is read is the operation rather than a default.
  h.debug.setLaunching(false);
  h.debug.setLaunching(true);
  assertEqual(
    h.snapshot().launching,
    true,
    "snapshot().launching after setLaunching(true) followed " +
      "setLaunching(false): each gate is reported by snapshot " +
      "(specs/instrumentation.md)",
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

  assertLessThan(
    cardsHome(after),
    DECK_SIZE,
    `cards left on the four foundations after ${GATED_SECONDS} s with ` +
      "setLaunching(true): with the gate on the cascade launches again " +
      "(specs/instrumentation.md, specs/victory.md), so a build that never " +
      "launches fails here rather than passing on a gate it ignores",
  );
  assertGreaterThan(
    after.launched,
    0,
    `cards the cascade counted out over ${GATED_SECONDS} s with the gate back ` +
      "on (specs/instrumentation.md)",
  );

  // Before the last assertion, so a cascade that never resumed still leaves the
  // picture of the foundations it was watched from.
  captureStill(h, "launching");

  const flyer = flyerById(after, flyerId);
  assertGreaterThan(
    flyer?.x ?? Number.NEGATIVE_INFINITY,
    FLYER.x,
    "how far right the card already in flight reached, having been posed at " +
      `x = ${FLYER.x} with vx = ${FLYER.vx}: every card already in flight ` +
      "keeps flying (specs/instrumentation.md)",
  );
});
