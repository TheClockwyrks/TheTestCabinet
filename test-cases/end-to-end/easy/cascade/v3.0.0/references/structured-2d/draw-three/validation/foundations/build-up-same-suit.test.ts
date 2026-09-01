// foundations/build-up-same-suit — a started foundation takes the next rank up of
// its own suit.
//
// specs/foundations.md: a foundation whose top card is rank `r` of suit `s` accepts
// the card of rank `r + 1` and suit `s`. A foundation builds one suit upward from
// Ace to King.
// specs/instrumentation.md: `move` returns `true` when the game's own rules accepted
// it.
//
// THE POSE. The spade foundation is built up to its five, and the six of spades
// waits alone in a column: the right suit and exactly one rank up, which is the one
// card the rule names. The foundation is built to a MIDDLE rank rather than to its
// Ace, so this asks about building rather than about starting — `ace-starts-empty`
// is the item that asks about starting — and a build that accepts only onto a
// single card fails here.
//
// This is the acceptance alone. The three refusals the same rule implies are
// `reject-off-suit`, `reject-rank-gap` and `reject-lower-rank`, each its own item,
// so a build with the suit test right and the rank test wrong grades differently
// from one with both wrong.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FIVE,
  openTable,
  poseColumn,
  poseFoundation,
  SIX,
  type Harness,
} from "../harness";
import { builtText, pileText } from "./board";

/** The started foundation, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = FIVE;
/** The column the next card waits in. */
const COLUMN = 4;
/** One rank above the foundation's top card, and of its suit. */
const NEXT = card(FOUNDATION_SUIT, SIX);
const NEXT_TEXT = "6S";
/** The foundation once the move has landed: its Ace through the card offered. */
const BUILT = builtText(FOUNDATION_SUIT, SIX);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the next-higher card of the foundation's own suit", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, [NEXT]);

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${NEXT_TEXT} onto the ${FOUNDATION_SUIT} foundation built to ` +
      `its ${FOUNDATION_TOP_RANK}, which accepts the next rank up of its own ` +
      "suit (specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    BUILT,
    `foundation ${FOUNDATION} after the move: one rank higher, its Ace still ` +
      "at the bottom (specs/foundations.md)",
  );
  assertLength(
    after.tableau[COLUMN],
    0,
    `the cards left in column ${COLUMN}: the card has left it ` +
      "(specs/tableau.md)",
  );
});
