// stock/turn-moves-to-waste — a turn takes the deal mode's turn count of cards
// off the stock and puts them on the waste.
//
// `specs/stock.md`: "A turn of a stock holding cards moves `TURN_COUNT` cards
// onto the waste, or all that remain when the stock holds fewer than that." This
// point decides the count on BOTH piles at once: the stock is smaller by the
// turn count and the waste larger by the same, so a build that moved the wrong
// number, and a build that copied the cards onto the waste rather than taking
// them off the stock, each read as a different pair of numbers.
//
// THE COUNT IS THE BUILD'S OWN, read from `snapshot().turnCount`, because this
// point is common to both variants. `draw-one/turn-count` and
// `draw-three/turn-count` are what hold that reading against the figure
// `specs/stock.md` fixes for their mode; this one holds the build to whatever
// mode it says it is playing.
//
// THE WASTE STARTS WITH A CARD ON IT, so both readings are DELTAS rather than
// pile sizes. A build that treats a turn as "the waste is now the cards this
// turn moved" reads one card short, and a build that laid the turned cards on an
// emptied waste is caught by the same number.
//
// THE STOCK IS DEEP ENOUGH FOR A FULL TURN under either mode, so the short-turn
// rule — "or all that remain" — is not in play here. `draw-three/turn-remainder`
// is the point that owns it.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  faceDown,
  openTable,
  poseStock,
  poseWaste,
  type Harness,
} from "../harness";
import { turnCount } from "./turns";

/** The stock, bottom card first, face-down as a card on the stock is. */
const STOCK = ["2C", "3D", "4S", "5H", "6C", "7D", "8S", "9H"];

/** The card already on the waste, on a set of its own, so both reads are deltas. */
const WASTE = ["10C"];
const WASTE_SETS = [1];

/** One frame, so the still carries the waste the assertions read. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the turn count off the stock and onto the waste", async () => {
  await openTable(h);
  await poseWaste(h, cards(...WASTE), WASTE_SETS);
  await poseStock(h, faceDown(...STOCK));

  const count = turnCount(await h.snapshot(), STOCK.length);

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "turned");

  const after = await h.snapshot();
  assertLength(
    after.stock,
    STOCK.length - count,
    `the cards left on the stock after one turn of a stock holding ` +
      `${STOCK.length} — specs/stock.md: a turn moves TURN_COUNT cards, ` +
      `which this build reports as ${count}`,
  );
  assertLength(
    after.waste,
    WASTE.length + count,
    `the cards on the waste after the turn — the ${WASTE.length} it already ` +
      `held and the ${count} the turn moved onto it (specs/stock.md)`,
  );
});
