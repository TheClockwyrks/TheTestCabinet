// stock/empty-stock-empty-waste — a turn with the stock and the waste both empty
// leaves both empty.
//
// `specs/stock.md`: "A turn with the stock and the waste both empty leaves both
// empty." It is the degenerate corner of the turn rule — there is nothing to
// turn and nothing to recycle — and it is reachable in an ordinary game, once
// every card has been played off both piles onto the table.
//
// WHAT A BUILD CAN GET WRONG HERE. A recycle written as "move the waste onto the
// stock and clear the memory" is harmless on an empty waste; a turn written as
// "take the last card" or "deal a fresh hand when the stock runs out" is not,
// and neither is one that appends an empty set for a turn that moved nothing. So
// the reading is both piles still empty afterwards, the set memory still empty,
// and no card anywhere on the table — a build that dealt itself out of the
// corner reads as a table with cards on it.
//
// THE WHOLE TABLE IS EMPTY, which `openTable` leaves it, and that is the
// scenario rather than a convenience: this point is about the state where
// nothing is left to turn.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  everyCard,
  openTable,
  type Harness,
} from "../harness";

/** One frame, so the still carries the two empty piles. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves both piles empty when there is nothing to turn", async () => {
  await openTable(h);

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "empty");

  const after = await h.snapshot();
  assertLength(
    after.stock,
    0,
    "the cards on the stock after turning an empty stock over an empty " +
      "waste — specs/stock.md: a turn with both empty leaves both empty",
  );
  assertLength(
    after.waste,
    0,
    "the cards on the waste after that turn — there was nothing to turn and " +
      "nothing to recycle (specs/stock.md)",
  );
  assertDeepEqual(
    after.wasteSets,
    [],
    "the waste's set memory after that turn — a turn that moved no cards " +
      "adds no set (specs/stock.md)",
  );
  assertLength(
    everyCard(after),
    0,
    "the cards anywhere on the table after that turn — a build that dealt " +
      "itself a fresh hand out of the corner reads as a table with cards on it",
  );
});
