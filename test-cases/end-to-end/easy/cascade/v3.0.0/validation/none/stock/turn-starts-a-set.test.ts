// stock/turn-starts-a-set — each turn appends ONE set to the waste's memory,
// holding exactly the cards that turn moved.
//
// `specs/stock.md`: the waste "keeps the cards of each turn together as a set
// and remembers its sets in the order they were turned, oldest first ... Each
// turn appends one set, holding exactly the cards that turn moved." The snapshot
// reports the memory as `wasteSets`, oldest first, and `wasteVisibleCount` as
// the newest set's count (`specs/instrumentation.md`).
//
// THE POSE MAKES EVERY WRONG MODEL READ AS A DIFFERENT MEMORY. The waste already
// holds two cards under the memory a mode of this build would have left, and one
// turn is made:
//
//   the rule                  the memory it had, with the turn count appended
//   grows the newest set      one entry short, the last of them too large
//   a set per card            the right total, in too many entries
//   no memory at all          the memory it had, unchanged
//
// The already-standing memory is what separates "appends one set" from "sets are
// the turns" — a build that rebuilt the memory from the pile reads a single
// entry.
//
// THE MEMORY IT STARTS WITH IS SIZED TO THE BUILD'S OWN TURN COUNT, counted back
// from the waste's top card, so this common point poses only a board the build's
// own turns could have reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

/** The stock, bottom card first, deep enough for a full turn under either mode. */
const STOCK = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** The cards already on the waste, bottom card first. */
const WASTE = ["10C", "JD"];

/** One frame, so the still carries the waste and the set the turn added. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("appends one set holding exactly the cards the turn moved", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot(), STOCK.length);
  const posedSets = turnSets(WASTE.length, count);
  await poseWaste(h, cards(...WASTE), posedSets);
  await poseStock(h, faceDown(...STOCK));

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "turned");

  const after = await h.snapshot();
  assertDeepEqual(
    after.wasteSets,
    [...posedSets, count],
    "the waste's set memory after the turn, oldest set first — " +
      "specs/stock.md: each turn appends ONE set, holding exactly the cards " +
      `that turn moved, which is the ${count} this build turns`,
  );
  assertEqual(
    after.wasteVisibleCount,
    count,
    "the cards the waste is showing after the turn — specs/stock.md: it " +
      "shows the cards on the newest set, which is the one this turn just " +
      "appended",
  );
});
