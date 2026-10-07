// handling/press-grabs-foundation-top — a press on a foundation lifts its top
// card.
//
// THE RULE. specs/controls.md: a press on "a foundation's top card" lifts "that
// card alone". specs/foundations.md: "A foundation's top card may be moved back
// onto a tableau column that accepts it", so the lift is the first half of the
// one move that leaves a foundation. The run enters the hand on the press itself
// (specs/controls.md), so `snapshot().drag` is read with no frame advanced and no
// pointer motion.
//
// THE FOUNDATION IS THREE CARDS DEEP, so a build that hands over the whole pile
// reads as three cards rather than one, and a build that hands over the pile's
// BOTTOM card reads as the Ace rather than the three. specs/table.md squares a
// foundation at its anchor, so every one of its cards is drawn at the same point
// and only the pile order says which one is on top.
//
// FOUNDATION 2, NOT FOUNDATION 0. specs/foundations.md ties no suit to a slot, so
// the requirement holds on any of the four, and posing an inner one catches a
// build that answers a press with a fixed foundation.
//
// WHERE THE PRESS LANDS. The centre of a card drawn at that foundation's anchor,
// which specs/table.md fixes at `(FOUNDATION_X[2], TOP_ROW_Y)`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import {
  cardCenter,
  captureStill,
  createHarness,
  openTable,
  pileTopLeft,
  poseFoundation,
  pressAt,
  THREE,
  type Harness,
} from "../harness";
import { pileText } from "./gestures";

/** The foundation in play, and the suit built on it. Any slot takes any suit. */
const FOUNDATION = 2;
const SUIT = "spades";

/** The rank it is built to: Ace, two, three, so its top card is the three. */
const BUILT_TO = THREE;

/** The card the press must put in the hand, and the pile left behind. */
const HELD = ["3S"];
const LEFT_BEHIND = ["AS", "2S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the foundation's top card in the hand and leaves the rest of the pile", async () => {
  openTable(h);
  const ids = poseFoundation(h, FOUNDATION, SUIT, BUILT_TO);
  const topId = ids[ids.length - 1];

  const anchor = pileTopLeft("foundation", FOUNDATION);
  const at = cardCenter(anchor.x, anchor.y);
  pressAt(h, at.x, at.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "held");

  assertNotNull(
    held.drag,
    `the run in hand after a press on foundation ${FOUNDATION}, which enters ` +
      "the hand on the press itself (specs/controls.md)",
  );
  assertLength(
    held.drag?.cards ?? [],
    HELD.length,
    `the cards in hand off a foundation holding ${String(BUILT_TO)}: a press ` +
      "on a foundation lifts its top card alone (specs/controls.md)",
  );
  assertDeepEqual(
    pileText(held.drag?.cards ?? []),
    HELD,
    "the card in hand, which is the foundation's top card — the last of its " +
      "pile (specs/table.md)",
  );
  assertEqual(
    held.drag?.cards[0]?.id,
    topId,
    "the id of the card in hand, which is the one posed last onto the " +
      "foundation (specs/instrumentation.md)",
  );
  assertEqual(
    held.drag?.fromPile,
    "foundation",
    "the pile the card was lifted from (specs/instrumentation.md)",
  );
  assertEqual(
    held.drag?.fromIndex,
    FOUNDATION,
    "the foundation the card was lifted from (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileText(held.foundations[FOUNDATION]),
    LEFT_BEHIND,
    `foundation ${FOUNDATION} while the card is held: the run leaves the pile ` +
      "as it enters the hand (specs/controls.md)",
  );
});
