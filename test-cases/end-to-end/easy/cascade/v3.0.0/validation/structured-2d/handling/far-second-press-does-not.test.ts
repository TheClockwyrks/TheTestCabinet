// handling/far-second-press-does-not — a second press past the slop is not a
// double click.
//
// THE RULE. specs/controls.md: a press is a double click only when "its point lies
// within `DOUBLE_CLICK_SLOP` (`20`) of the previous press's point". A press that
// does not is an ordinary press, and the release that follows it within
// `DRAG_THRESHOLD` is an ordinary click, which returns whatever the press lifted.
//
// THE SEPARATION IN SPACE. The two presses are `40` units apart — twice
// `DOUBLE_CLICK_SLOP` — and both land on the SAME card. A card is `100 x 140`
// (specs/table.md), so two points `40` apart on one axis both sit inside its
// footprint with room either side: the third condition, "it lands on a playable
// card", holds for both presses and the SLOP is the only condition that fails.
// A build with no slop at all, or one measuring it as a bounding box rather than a
// distance, or one whose slop is wider than the specification's, sends the card
// home here and fails.
//
// THE SEPARATION IN TIME is a third of `DOUBLE_CLICK_WINDOW` (`0.30`,
// specs/controls.md), so the window condition holds and cannot be what decided the
// outcome. `handling/slow-second-press-does-not` fails the window instead, and
// `handling/double-click-auto-moves` fails neither, so the three grade separately.
//
// WHAT IS READ. The card is still on its column and the foundation still holds its
// Ace alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DOUBLE_CLICK_SLOP,
  DOUBLE_CLICK_WINDOW,
  TABLEAU_Y,
} from "../../src/constants";
import { assertDeepEqual, assertNull } from "../assert";
import {
  ACE,
  captureStill,
  card,
  clickAt,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  TWO,
  type Harness,
} from "../harness";
import { pileText } from "./gestures";

/** The foundation the Ace of spades starts, and the suit in play. */
const FOUNDATION = 0;
const SUIT = "spades";

/** The card on the column: the one a double click would have sent home. */
const COLUMN = 0;
const CARDS = [card(SUIT, TWO)];

/**
 * How far apart the two presses land, in logical units: twice
 * `DOUBLE_CLICK_SLOP` (`20`, specs/controls.md), so the second press is outside
 * the slop by the whole of it.
 */
const SEPARATION = 2 * DOUBLE_CLICK_SLOP;

/**
 * How many frames separate the two presses: a third of the frames
 * `DOUBLE_CLICK_WINDOW` covers, so the window condition comfortably holds and the
 * slop is the only one that fails.
 */
const GAP_FRAMES = Math.round(framesFor(DOUBLE_CLICK_WINDOW) / 3);

/** The two piles as they must read after the gesture: exactly as posed. */
const UNCHANGED_FOUNDATION = ["AS"];
const UNCHANGED_COLUMN = ["2S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the card where it was when the second press lands past the slop", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, ACE);
  poseColumn(h, COLUMN, CARDS);

  // Both points lie on the card, which the column's only card draws at its own
  // anchor: 100 wide from COLUMN_X, 140 tall from TABLEAU_Y (specs/table.md).
  // They straddle the card's centre line, SEPARATION apart.
  const y = TABLEAU_Y + CARD_H / 2;
  const first = { x: COLUMN_X[COLUMN] + CARD_W / 2 - SEPARATION / 2, y };
  const second = { x: first.x + SEPARATION, y };

  clickAt(h, first.x, first.y);
  await h.advance(GAP_FRAMES);
  clickAt(h, second.x, second.y);

  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    pileText(after.tableau[COLUMN]),
    UNCHANGED_COLUMN,
    `column ${String(COLUMN)} after two presses ${String(SEPARATION)} units ` +
      `apart, which is past DOUBLE_CLICK_SLOP (${String(DOUBLE_CLICK_SLOP)}) ` +
      "and so is not a double click: the second press is an ordinary press and " +
      "its click returns the run it lifted (specs/controls.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    UNCHANGED_FOUNDATION,
    `foundation ${String(FOUNDATION)} after the gesture: no card was sent ` +
      "home (specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the second click, which returns whatever it lifted " +
      "(specs/controls.md)",
  );
});
