// stock/waste-top-to-foundation — the waste's top card can go home.
//
// THE RULE. specs/stock.md: "Only the waste's top card may be played, onto a
// foundation that accepts it by `specs/foundations.md`", and specs/foundations.md:
// "A foundation accepts a card from a tableau column and from the waste, on exactly
// the terms above." So the waste is a source a foundation takes from, and a card
// that goes there leaves the waste behind. Without this route a Klondike deal cannot
// be finished at all, because every card the tableau never received passes through
// the waste.
//
// THE CARD OFFERED IS AN ACE AND THE FOUNDATION IS EMPTY, which is the one
// acceptance specs/foundations.md states with nothing built first. What is decided
// here is the ROUTE, waste to foundation, so the terms the foundation accepts on are
// held to their simplest case; which cards a foundation accepts and refuses is the
// `foundations` group's fourteen points, and the same route out of a column is
// `foundations/accepts-from-tableau`.
//
// A CARD IS LEFT UNDER IT, so "leaves the waste" is a card departing a pile that
// still holds another rather than a pile being emptied, and a build that cleared the
// waste rather than moving one card off it is caught.
//
// The card is followed by id, which it keeps across the move
// (specs/instrumentation.md), so what is read is that THIS card arrived rather than
// that something the right shape did.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  topOf,
  type Harness,
} from "../harness";

/**
 * The waste the card is played off: a card the play leaves behind, and the Ace of
 * spades on top of it, each on a set of its own so the Ace is the card shown.
 */
const POSED_WASTE = ["9D", "AS"] as const;
const POSED_SETS = [1, 1] as const;

/** The row the Ace sits at, counted from the bottom of the waste. */
const ACE_ROW = POSED_WASTE.length - 1;

/** The foundation it goes to: empty, so an Ace is exactly what it accepts. */
const FOUNDATION = 0;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("accepts the waste's top card onto a foundation and takes it off the waste", async () => {
  openTable(harness);
  const ids = poseWaste(harness, POSED_WASTE, POSED_SETS);
  const ace = ids[ACE_ROW];

  const accepted = harness.debug.move(
    "waste",
    0,
    ACE_ROW,
    "foundation",
    FOUNDATION,
  );

  await harness.advance(1);
  captureStill(harness, "accepted");

  assertEqual(
    accepted,
    true,
    "move() to accept the waste's top card onto a foundation that takes it " +
      "(specs/stock.md)",
  );

  const after = harness.snapshot();
  assertEqual(
    topOf(after, "foundation", FOUNDATION)?.id,
    ace,
    `the id of the card on foundation ${FOUNDATION} after the move ` +
      "(specs/foundations.md)",
  );
  assertLength(
    after.waste,
    POSED_WASTE.length - 1,
    "cards left on the waste once its top card went to a foundation " +
      "(specs/stock.md)",
  );
});
