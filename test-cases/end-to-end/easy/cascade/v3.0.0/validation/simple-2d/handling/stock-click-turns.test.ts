// handling/stock-click-turns — a press and release on the stock turns cards onto the
// waste.
//
// specs/controls.md: a click "turns the stock, as specs/stock.md states, when the
// press point lies in the stock's drop rectangle", and a click is a release "within
// `DRAG_THRESHOLD` (`5`) of the press point". specs/table.md fixes that rectangle as
// `CARD_W x CARD_H` at `(STOCK_X, TOP_ROW_Y)`, so the press below lands at its
// center. specs/stock.md fixes what the turn moves: "`TURN_COUNT` cards, or all that
// remain when the stock holds fewer than that".
//
// WHY THE TURN COUNT IS READ RATHER THAN WRITTEN. `TURN_COUNT` is one of the four
// figures that differ between the two deal modes, so this common check cannot spell
// either one — and it must not read the build's own `src/constants` for it, because
// a build that turns two cards and writes `TURN_COUNT = 2` would then be measured
// against its own mistake and pass. The expected growth is `snapshot().turnCount`,
// which `draw-one/deal-mode-reported` and `draw-three/deal-mode-reported` separately
// pin to the figure their own `specs/stock.md` fixes. That is also what makes one
// validator serve both variants: the pose is `turnCount + SPARE` cards whatever the
// turn count is.
//
// THE STOCK HOLDS MORE THAN ONE TURN, so the reading separates a build that turns
// the deal mode's count from one that turns the whole stock, and the waste starts
// empty so what it holds afterwards IS what the click moved.
//
// WHAT THIS DOES NOT DECIDE. The order the cards arrive in, their faces, and the set
// the turn appends are the `stock` group's items. This point reads the gesture: that
// a press and a release over the stock is what turns it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { STOCK_X, TOP_ROW_Y } from "../constants";
import {
  cardCenter,
  captureStill,
  clickAt,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";

/** Cards left in the stock after one turn, so the turn cannot have emptied it. */
const SPARE = 2;

/**
 * The cards the stock is posed from, bottom card first.
 *
 * Long enough for either deal mode: a turn moves one card under Draw One and three
 * under Draw Three (specs/stock.md), so the pose takes three or five off this list.
 */
const DECK = ["2C", "3D", "4S", "5H", "6C", "7D", "8S"];

/** The center of the stock's drop rectangle, which the press lands in. */
const AT = cardCenter(STOCK_X, TOP_ROW_Y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("grows the waste by the deal mode's turn count on a click over the stock", async () => {
  openTable(h);

  const turnCount = h.snapshot().turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");

  const stock = DECK.slice(0, turnCount + SPARE);
  poseStock(h, stock);

  clickAt(h, AT.x, AT.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "turned");

  assertLength(
    after.waste,
    turnCount,
    `the cards on the waste after one click over the stock, which held ` +
      `${String(stock.length)}: a turn moves TURN_COUNT of them ` +
      "(specs/controls.md, specs/stock.md)",
  );
  assertLength(
    after.stock,
    SPARE,
    `the cards left in the stock after that click: the ${String(stock.length)} ` +
      `it held, less the ${String(turnCount)} the turn moved (specs/stock.md)`,
  );
});
