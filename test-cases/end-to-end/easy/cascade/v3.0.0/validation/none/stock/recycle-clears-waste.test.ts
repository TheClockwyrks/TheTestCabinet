// stock/recycle-clears-waste — a recycle leaves the waste holding nothing.
//
// `specs/stock.md`: "The waste is left empty and its set memory is emptied with
// it." This point reads the pile; `stock.recycle-clears-sets` reads the memory,
// and `stock.empty-stock-recycles` reads the stock the cards went back to. Split
// that way, a build that copied the waste onto the stock instead of moving it —
// leaving the same cards in both places — loses exactly this point and keeps the
// other two.
//
// THE PILE IS READ, NOT THE MEMORY. A build whose waste still holds its cards
// while its set memory is empty draws an empty slot (`specs/table.md`: "A waste
// whose set memory is empty shows no card ... whatever cards it still holds"),
// so nothing about the picture would catch it and the pile's own length is the
// only honest reading.
//
// THE MEMORY THE WASTE CARRIES BEFOREHAND IS SIZED TO THE BUILD'S OWN TURN
// COUNT, counted back from its top card, so the board is one its own turns could
// have left.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";
import { turnCount, turnSets } from "./turns";

/** The waste, bottom card first. */
const WASTE = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** One frame, so the still carries the empty waste the recycle leaves. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the waste holding nothing", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  await poseWaste(h, cards(...WASTE), turnSets(WASTE.length, count));

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "recycled");

  const after = await h.snapshot();
  assertLength(
    after.waste,
    0,
    `the cards left on the waste after a recycle of ${WASTE.length} — ` +
      "specs/stock.md: the waste is left empty, the cards having gone back " +
      "to the stock rather than been copied there",
  );
});
