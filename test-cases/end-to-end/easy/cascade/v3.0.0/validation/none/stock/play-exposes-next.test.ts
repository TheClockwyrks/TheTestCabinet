// stock/play-exposes-next — once the waste's top card has left, the card beneath
// it is the waste's top card.
//
// `specs/stock.md`: "Once the top card has left, the card beneath it is the
// waste's top card." The waste's top card is the last of the cards it shows, and
// what it shows is decided by its set memory, so this point reads the card
// through that rule rather than off the end of the pile alone.
//
// THE WASTE HOLDS THREE CARDS, so "the card beneath it" is a choice rather than
// a tautology: the pass is the middle card, and a build that fell through to the
// bottom of the pile — the oldest card, drawn beneath everything — reads as a
// different card entirely. The pile's own length is read too, so a build that
// exposed the next card by copying rather than by removing is caught.
//
// THE MEMORY IS SIZED TO THE BUILD'S OWN TURN COUNT, counted back from the
// waste's top card. That matters here: under Draw Three the three cards are one
// set and the play leaves two of it showing, and under Draw One they are three
// sets of one and the play empties the newest so the waste falls back to the set
// before it. Both roads lead to the same card, which is what this point is
// about — the exposure, not the count. `wasteVisibleCount` is therefore NOT read
// here; the two `set-falls-back` points and `stock.set-shrinks-on-play` own it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { RANK_MIN } from "../constants";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseFoundation,
  poseWaste,
  topOf,
  wasteTop,
  type Harness,
} from "../harness";
import { turnCount, turnSets } from "./turns";

/** The foundation the played card goes home to, holding the Ace of its suit. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/**
 * The waste, bottom card first: the buried card, the card the play should
 * expose, and the card that is played.
 */
const WASTE = ["7D", "9H", "2S"];
const EXPOSED_INDEX = 1;

/** Where the waste's top card sits, counted from the bottom of the pile. */
const TOP_ROW = WASTE.length - 1;

/** One frame, so the still carries the card the departing top left showing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the card beneath the played one as the waste's top card", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  await poseFoundation(h, FOUNDATION, SUIT, RANK_MIN);
  const ids = await poseWaste(
    h,
    cards(...WASTE),
    turnSets(WASTE.length, count),
  );
  const exposedId = ids[EXPOSED_INDEX];

  const played = await h.debug.move(
    "waste",
    0,
    TOP_ROW,
    "foundation",
    FOUNDATION,
  );
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "exposed");

  assertEqual(
    played,
    true,
    `move's verdict on the waste's ${SUIT} 2 offered to a ${SUIT} foundation ` +
      "holding its Ace, which specs/foundations.md accepts",
  );

  const after = await h.snapshot();
  assertEqual(
    wasteTop(after)?.id,
    exposedId,
    `the waste's top card (id ${exposedId}, the ${WASTE[EXPOSED_INDEX]}) once ` +
      "the card above it has gone home — specs/stock.md: the card beneath " +
      "the departed top card is the waste's top card. The oldest card of the " +
      "pile here is a different card, so a build that fell through to the " +
      "bottom of the waste reads as that one",
  );
  assertEqual(
    topOf(after.waste)?.id,
    exposedId,
    "the card lying highest on the waste — the same card, since the cards a " +
      "waste shows are the topmost of the ones it holds (specs/stock.md)",
  );
  assertLength(
    after.waste,
    WASTE.length - 1,
    "the cards left on the waste — the played card left the pile rather " +
      "than being copied off it",
  );
});
