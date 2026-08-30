// table/foundation-anchors — the four foundations sit at 590, 712, 834 and 956,
// and the third column position in the top row carries nothing.
//
// THE RULE. specs/table.md anchors the four foundations at
// `(FOUNDATION_X[i], TOP_ROW_Y)` — `(590, 24)`, `(712, 24)`, `(834, 24)`,
// `(956, 24)` — and calls them squared piles, so a card on one is drawn with its
// top-left exactly at its anchor. The same table states that "the third column
// position, `x = 468`, carries no pile in the top row": it is the space that
// separates the two draw piles from the foundations.
//
// BOTH HALVES ARE THE ONE REQUIREMENT — the four foundations are laid out over
// the RIGHT four column positions. A build that shifted its foundations one place
// left would put a card at `(468, 24)` and one fewer at `(956, 24)`, and it is the
// pair of readings together that names that fault for what it is.
//
// THE SCENARIO IS FOUR ACES AND NOTHING ELSE. One card on each foundation, on an
// otherwise empty table, so every card the frame draws belongs to this point. The
// nine empty piles draw card-sized slot marks (specs/table.md), but the stock and
// the waste sit at `224` and `346` and the seven columns at `TABLEAU_Y` (`180`),
// so no slot mark can be mistaken for a foundation card and — this is what makes
// the second half readable — none of them sits at `(468, 24)` either. The waste is
// deliberately left EMPTY, because under Draw Three a full fan's last card reaches
// past `468`, which specs/table.md allows.
//
// NO GESTURE DRIVES IT. The Aces are posed straight onto the foundations, so a
// broken auto-move or drop resolution cannot reach this verdict.

import { afterEach, beforeEach, it } from "vitest";
import { FOUNDATION_X, TOP_ROW_Y } from "../../src/constants";
import { fail } from "../assert";
import {
  boxAt,
  captureStill,
  cardBoxes,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  posePile,
  type Harness,
} from "../harness";
import { cardCorners } from "./geometry";

/**
 * How far a drawn card's top-left may sit from its anchor, in logical units.
 *
 * The anchors are exact in specs/table.md; this is the unit an inset stroke costs,
 * matching `harness.ts`'s `CARD_BOX_TOLERANCE`. Two neighbouring anchors are `122`
 * apart, so no card can be read at the wrong one.
 */
const ANCHOR_TOLERANCE = 2;

/** The column position the top row leaves bare (specs/table.md). */
const BARE_X = 468;

/** One Ace per foundation, in the suit order a deck is built in. */
const ACES = ["AS", "AH", "AD", "AC"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws each foundation's card at its own anchor and none at 468", async () => {
  openTable(harness);
  for (let index = 0; index < FOUNDATION_X.length; index += 1) {
    posePile(harness, "foundation", index, [ACES[index]]);
  }

  const calls = await drawFrame(harness);
  captureStill(harness, "foundations");

  const boxes = cardBoxes(drawnBoxes(harness, calls));

  for (let index = 0; index < FOUNDATION_X.length; index += 1) {
    const anchorX = FOUNDATION_X[index];
    if (boxAt(boxes, anchorX, TOP_ROW_Y, ANCHOR_TOLERANCE) === null) {
      fail(
        `a card-sized box with its top-left at (${anchorX}, ${TOP_ROW_Y}), ` +
          `foundation ${index}'s anchor (specs/table.md), among the card-sized ` +
          `boxes the frame drew`,
        cardCorners(boxes),
      );
    }
  }

  const intruder = boxAt(boxes, BARE_X, TOP_ROW_Y, ANCHOR_TOLERANCE);
  if (intruder !== null) {
    fail(
      `no card-sized box at (${BARE_X}, ${TOP_ROW_Y}): the third column ` +
        `position carries no pile in the top row (specs/table.md)`,
      cardCorners([intruder]),
    );
  }
});
