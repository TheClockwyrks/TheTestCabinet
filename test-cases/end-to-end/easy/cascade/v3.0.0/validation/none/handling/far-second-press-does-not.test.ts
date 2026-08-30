// handling/far-second-press-does-not — a second press landing past
// `DOUBLE_CLICK_SLOP` from the first is not a double click, and sends nothing
// home.
//
// `specs/controls.md` fixes it: a press is a double click only when "its point
// lies within `DOUBLE_CLICK_SLOP` (`20`) of the previous press's point". A press
// that is not a double click is a press like any other: it lifts what it lands
// on, and the release that follows it at the same point is a click, which
// "returns any held run to the pile it was lifted from".
//
// WHAT SEPARATES THIS FROM ITS SIBLINGS. Only the slop is outside its figure
// here. The presses are `0.1` s of game time apart, a third of the window, so the
// timing is satisfied; BOTH of them land on the same playable card, so the
// auto-move would be legal if the slop allowed it, and a build that has no slop
// rule at all — or that measures it against the card rather than against the
// previous press point — sends the card home and fails.
//
// THE PRESSES ARE `40` UNITS APART, twice the slop. `specs/table.md` puts a card
// at `100 x 140`, so both points sit comfortably inside the one card while being
// far outside the figure, which is what keeps this reading about the slop rather
// than about where the second press landed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import {
  card,
  cardCenter,
  captureStill,
  clickAt,
  createHarness,
  framesFor,
  openTable,
  pileOf,
  pileTopLeft,
  pointInRect,
  poseColumn,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";
import { CARD_H, CARD_W, DOUBLE_CLICK_SLOP } from "../constants";

/** The foundation the card would belong on, its suit, and how far it stands. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/** The column the card sits on, alone and face-up, and which card it is. */
const COLUMN = 3;
const STAYING = "6H";

/**
 * How far apart the two presses land, in logical units: twice
 * `DOUBLE_CLICK_SLOP` (`20`), which is the item's own figure.
 *
 * The two points straddle the card's centre, `20` units either side of it, so
 * each is `30` units in from the card's own edge and both are unambiguously on
 * the card the second press would otherwise send home.
 */
const PRESS_GAP = 2 * DOUBLE_CLICK_SLOP;

/** Game time between the two presses, a third of `DOUBLE_CLICK_WINDOW`. */
const GAP_SECONDS = 0.1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the card where it lay when the second press is too far", async () => {
  await openTable(h);
  const foundationIds = await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  const [stayingId] = await poseColumn(h, COLUMN, [card(STAYING)]);

  const at = pileTopLeft("tableau", COLUMN);
  const centre = cardCenter(at.x, at.y);
  const first = { x: centre.x - PRESS_GAP / 2, y: centre.y };
  const second = { x: centre.x + PRESS_GAP / 2, y: centre.y };

  // Both presses are on the card, so the slop is the only figure they miss.
  const footprint = { x: at.x, y: at.y, w: CARD_W, h: CARD_H };
  assertTrue(
    pointInRect(first.x, first.y, footprint),
    "the first press on the card",
  );
  assertTrue(
    pointInRect(second.x, second.y, footprint),
    "the second press on the card",
  );

  await clickAt(h, first.x, first.y);
  await h.advance(framesFor(GAP_SECONDS));
  await clickAt(h, second.x, second.y);

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, stayingId),
    { pile: "tableau", index: COLUMN, row: 0 },
    "where the card sits after the second press",
  );
  assertLength(
    pileOf(after, "foundation", FOUNDATION),
    foundationIds.length,
    "the cards the foundation still holds",
  );
});
