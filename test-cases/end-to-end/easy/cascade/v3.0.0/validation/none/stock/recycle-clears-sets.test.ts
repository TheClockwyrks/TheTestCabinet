// stock/recycle-clears-sets — a recycle empties the waste's set memory with it.
//
// `specs/stock.md`: "The waste is left empty and its set memory is emptied with
// it." This point reads the memory: `wasteSets` empty, and `wasteVisibleCount`
// `0`, which `specs/instrumentation.md` defines as "the newest entry of
// `wasteSets`, and `0` when `wasteSets` is empty".
//
// WHY THE MEMORY IS ITS OWN POINT. The pile and the memory are two fields, and a
// build that emptied the pile and kept the sets is left claiming that a waste
// holding nothing is showing cards — the very inconsistency the set memory was
// specified to close. The pile is `stock.recycle-clears-waste`; the cards' return
// to the stock is `stock.empty-stock-recycles`.
//
// BOTH READINGS ARE TAKEN, because they are two claims a build can get
// separately wrong: a build that emptied `wasteSets` while `wasteVisibleCount`
// still reported the count it had is reporting a derived field it does not
// derive, and `specs/instrumentation.md` says that field is built at the call
// from the memory.
//
// THE MEMORY IT STARTS WITH IS SIZED TO THE BUILD'S OWN TURN COUNT, counted back
// from the waste's top card, and it holds more than one set, so "emptied" is a
// reading rather than a coincidence of a memory that held one entry anyway.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";
import { turnCount, turnSets } from "./turns";

/** The waste, bottom card first: six cards, which is more than one turn's worth. */
const WASTE = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** One frame, so the still carries the waste with its memory emptied. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("empties the waste's set memory", async () => {
  await openTable(h);
  const count = turnCount(await h.snapshot());
  const posedSets = turnSets(WASTE.length, count);
  await poseWaste(h, cards(...WASTE), posedSets);

  const posed = await h.snapshot();
  assertGreaterThanOrEqual(
    posed.wasteSets.length,
    2,
    "sets in the waste's memory before the recycle — the pose gives it more " +
      "than one so that emptying it is a reading rather than a coincidence",
  );

  await h.debug.turnStock();
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "recycled");

  const after = await h.snapshot();
  assertDeepEqual(
    after.wasteSets,
    [],
    "the waste's set memory after the recycle — specs/stock.md: the waste is " +
      "left empty and its set memory is emptied with it",
  );
  assertEqual(
    after.wasteVisibleCount,
    0,
    "the cards the waste reports showing after the recycle — " +
      "specs/instrumentation.md builds it from the newest entry of wasteSets, " +
      "and it is 0 when the memory is empty",
  );
});
