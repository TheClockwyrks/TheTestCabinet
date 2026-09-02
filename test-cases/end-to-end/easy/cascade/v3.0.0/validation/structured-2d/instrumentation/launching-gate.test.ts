// instrumentation/launching-gate — `setLaunching` stops the cascade sending
// further cards up, and stops nothing else.
//
// THE RULE. specs/instrumentation.md, under The faculty gates:
// `setLaunching(enabled)` gates "the cascade's launch clock and the launching
// of the next card. Off, no further card leaves the foundations. Every card
// already in flight keeps flying, bouncing, painting, and retiring."
//
// WHY A SCENARIO NEEDS THE GATE AT ALL. Every check about a card in flight —
// its gravity, its bounce, its retirement — has to be able to watch ONE card,
// and a running cascade adds another every `LAUNCH_INTERVAL` (specs/victory.md).
// The gate is what holds the cascade at the cards already up, and this point is
// what says it really does.
//
// THE SCENARIO IS A REAL WON GAME, entered through the game's own win path, so
// the launching that has to stop is the launching a cascade actually does: a
// board completed to fifty-two, the cascade entered by the move that completed
// it, and the gate closed BEFORE a single frame has run — the clock holds a
// whole interval when the cascade begins, so the first card would otherwise
// launch on the cascade's first frame (specs/victory.md).
//
// TWO READINGS OVER ONE SECOND, and both are needed: the foundations still hold
// all fifty-two cards and `launched` is still `0` — "no further card leaves the
// foundations" — while the card posed in flight has moved, which is what
// separates a gate on the launching from a build that simply stopped advancing
// the cascade.
//
// THE FLYER IS POSED CLEAR OF BOTH SIDE EDGES, at a horizontal speed that
// carries it `120` units in the second, so it cannot retire before it is read
// (specs/victory.md retires a card only at a side edge). Only the DIRECTION of
// its travel is asserted: how far it should have gone in a second is
// `cascade.advance-x`, and demanding a distance here would charge that item's
// defect to this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  KING,
  captureStill,
  card,
  cardsHome,
  createHarness,
  flyerById,
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
