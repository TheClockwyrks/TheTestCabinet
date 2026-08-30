// stock/no-recycle-with-cards — a turn of a stock that still holds cards TURNS,
// and never recycles.
//
// `specs/stock.md`: "A turn of a stock that holds cards never recycles." The
// recycle is reached by one condition and one only — an empty stock — and this
// point holds the other side of that condition: with cards left on the stock the
// waste grows and keeps what it held, rather than emptying into the stock.
//
// EVERY WRONG MODEL READS AS A DIFFERENT PAIR OF PILES. The board is posed with
// cards on both piles, which is the only board on which the two behaviours
// differ at all:
//
//   the rule                       waste larger, still holding both its cards,
//                                  and a stock shorter than it was
//   recycles whenever the waste     waste empty, stock longer than it was
//   holds cards
//   turns and recycles both         the waste's own cards gone from it
//
// THE CARDS ALREADY ON THE WASTE ARE READ BY IDENTITY, so a build that emptied
// the waste and then turned onto it — which can leave a waste of the right size
// under Draw One — is caught by the two ids that are no longer there.
//
// THE EXACT SIZE OF THE TURN IS NOT THIS POINT'S. `stock.turn-moves-to-waste`
// decides that the turn moved the turn count; this one decides that a turn is
// what happened.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, assertTrue } from "../assert";
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
import { turnCount, turnSets } from "./turns";

/** The stock, bottom card first, holding more than one turn's worth. */
const STOCK = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** The cards already on the waste, bottom card first. */
const WASTE = ["10C", "JD"];

/** One frame, so the still carries the larger waste the turn left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("turns onto the waste rather than recycling it", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot(), STOCK.length);
  const ids = await poseWaste(
    h,
    cards(...WASTE),
    turnSets(WASTE.length, count),
  );
  await poseStock(h, faceDown(...STOCK));

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "turned");

  const after = await h.snapshot();
  assertGreaterThan(
    after.waste.length,
    WASTE.length,
    `the cards on the waste after turning a stock still holding ` +
      `${STOCK.length} — specs/stock.md: a turn of a stock that holds cards ` +
      "never recycles, so the waste grows rather than emptying",
  );
  assertLessThan(
    after.stock.length,
    STOCK.length,
    "the cards left on the stock after the turn — the cards came OFF the " +
      "stock, so a stock that grew is a recycle that should not have " +
      "happened (specs/stock.md)",
  );
  const held = new Set(after.waste.map((c) => c.id));
  assertTrue(
    ids.every((id) => held.has(id)),
    `the two cards the waste already held (ids ${ids.join(", ")}) still on ` +
      "it after the turn — a turn adds to the waste and takes nothing off it " +
      "(specs/stock.md)",
  );
});
