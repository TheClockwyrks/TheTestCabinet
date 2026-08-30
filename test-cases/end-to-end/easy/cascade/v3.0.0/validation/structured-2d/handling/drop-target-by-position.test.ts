// handling/drop-target-by-position — a drop resolves to the pile holding the
// leading card's CENTRE, not to a pile the card merely overlaps and not to the
// pile under the pointer.
//
// THE RULE. specs/controls.md: "A drop resolves to the pile whose drop rectangle
// contains the center of the run's leading card, that card being the one drawn at
// the top of the held run. The rectangles do not overlap, so that center lies in
// at most one of them." specs/table.md fixes the rectangles: a column holding
// cards answers `CARD_W` wide at its own `COLUMN_X`, from `TABLEAU_Y` down.
//
// THE SCENARIO POSES THE DISTINGUISHING PLACE. Two columns, one at `346..446` and
// one at `468..568`, both holding a black six, so both would accept the red five
// being carried and only the resolution rule can say which one takes it. The run
// is released with its leading card's top-left at `x = 430`:
//
//   the card covers 430..530, so it OVERLAPS column 1 (430..446) and column 2;
//   its centre is at x = 480, which lies in column 2's rectangle alone;
//   the POINTER is at x = 432, which lies in column 1's rectangle.
//
// So every wrong model names a different column:
//
//   the pile holding the leading card's centre (the rule)  ->  column 2
//   the pile under the pointer                             ->  column 1
//   the pile holding the leading card's TOP-LEFT           ->  column 1
//   the first pile the card overlaps, left to right        ->  column 1
//
// HOW THE POINTER IS PUT THERE. The press lands two units inside the source
// card's top-left, so the run carries an offset of `(2, 2)` and the pointer trails
// the leading card's own corner by that much (specs/controls.md: the run keeps
// the offset between the press point and the leading card's top-left).
//
// THE RELEASE IS UNAMBIGUOUSLY A DROP: it lies `206` units from its press, far
// past `DRAG_THRESHOLD` (`5`).

import { afterEach, beforeEach, it } from "vitest";
import { COLUMN_X, TABLEAU_Y } from "../../src/constants";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  drag,
  FIVE,
  openTable,
  poseColumn,
  SIX,
  type Harness,
} from "../harness";
import { carryTo, pileText } from "./gestures";

/** The column the run is lifted from, and the two columns it is released across. */
const FROM_COLUMN = 0;
const OVERLAPPED_COLUMN = 1;
const RESOLVED_COLUMN = 2;

/** A red five over two black sixes: either column would accept it. */
const RUN = card("hearts", FIVE);
const OVERLAPPED = card("spades", SIX);
const RESOLVED = card("clubs", SIX);

/**
 * How far inside the source card's top-left the press lands. Two units, so the
 * pointer stays inside column 1's rectangle while the card's centre is inside
 * column 2's — which is the whole of what this point separates.
 */
const PRESS_INSET = 2;

/**
 * The top-left the leading card is released at. Column 1's rectangle ends at
 * `446` and column 2's begins at `468` (specs/table.md), so `430` puts the card's
 * left edge inside column 1 and its centre, at `480`, inside column 2.
 */
const RELEASE_LEFT = 430;

/** The three columns as they must read after the drop. */
const LANDED = ["6C", "5H"];
const UNTOUCHED = ["6S"];
const EMPTIED: string[] = [];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands the run on the column holding the leading card's centre, not the one it overlaps", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, OVERLAPPED_COLUMN, [OVERLAPPED]);
  poseColumn(h, RESOLVED_COLUMN, [RESOLVED]);

  // The source column holds one card, so it is drawn at the column's anchor
  // (specs/table.md), and the press lands two units inside that corner.
  const lead = { x: COLUMN_X[FROM_COLUMN], y: TABLEAU_Y };
  const press = { x: lead.x + PRESS_INSET, y: lead.y + PRESS_INSET };
  const release = carryTo(press, lead, { x: RELEASE_LEFT, y: TABLEAU_Y });

  drag(h, press, release);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "resolved");

  assertDeepEqual(
    pileText(after.tableau[RESOLVED_COLUMN]),
    LANDED,
    `column ${String(RESOLVED_COLUMN)}, whose drop rectangle holds the leading ` +
      "card's centre, so it is the pile the drop resolves to " +
      "(specs/controls.md, specs/table.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[OVERLAPPED_COLUMN]),
    UNTOUCHED,
    `column ${String(OVERLAPPED_COLUMN)}, which the released card overlaps and ` +
      "the pointer is over but whose rectangle does NOT hold that card's " +
      "centre (specs/controls.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[FROM_COLUMN]),
    EMPTIED,
    `column ${String(FROM_COLUMN)} after the drop: an applied move leaves its ` +
      "source (specs/controls.md)",
  );
});
