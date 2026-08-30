// stock/turn-starts-a-set — one turn appends exactly one set.
//
// THE RULE. specs/stock.md: the waste "keeps the cards of each turn together as a
// set and remembers its sets in the order they were turned, oldest first ... Each
// turn appends one set, holding exactly the cards that turn moved." So a turn adds
// one entry to the memory, at its newest end, whose count is what the turn brought
// over, and it disturbs no entry already there.
//
// THE MEMORY IS POSED NON-EMPTY, deliberately. A turn onto an empty waste would let
// a build that REPLACES the memory with a single set pass, since replacing one entry
// with one entry is invisible when there was none. So the waste is posed holding
// cards under a set of its own, and what the turn is asked for is the APPEND
// specs/stock.md describes: the older entry has to still be there, unchanged, with
// the new one after it.
//
// THE COUNT IS READ FROM WHAT THE TURN MOVED, not from a literal, because the size
// of a turn is the one figure the two deal modes differ in and `draw-one.turn-count`
// and `draw-three.turn-count` are the points that pin it. What is decided here is
// that the set the turn appended holds exactly the cards that turn moved.
//
// WHAT IS NOT READ HERE. `wasteVisibleCount` following the newest entry is
// `instrumentation.waste-sets-pose`; a set shrinking as its cards are played is
// `stock/set-shrinks-on-play`; the fallback to an older set is the two variants'
// `set-falls-back`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  card,
  createHarness,
  NINE,
  openTable,
  poseStock,
  poseWaste,
  TWO,
  type Harness,
} from "../harness";
import { stockSpecs } from "./turning";

/** Cards posed on the stock, longer than either deal mode's turn. */
const STOCK_SIZE = 12;

/**
 * The waste the turn is appended to: two cards under one set of two.
 *
 * Any non-empty memory would do. This one is a single entry, so the memory after
 * the turn has to be exactly two entries and a build that replaced rather than
 * appended reports one.
 */
const POSED_WASTE = [card("clubs", TWO), card("diamonds", NINE)];
const POSED_SETS = [2] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("appends one set holding the cards the turn moved", async () => {
  openTable(h);
  poseWaste(h, POSED_WASTE, POSED_SETS);
  poseStock(h, stockSpecs(STOCK_SIZE));

  const before = h.snapshot();
  h.debug.turnStock();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "turned");

  const moved = before.stock.length - after.stock.length;
  assertGreaterThanOrEqual(
    moved,
    1,
    "cards a turn of a twelve-card stock took off the stock (specs/stock.md)",
  );

  assertEqual(
    after.wasteSets.length,
    before.wasteSets.length + 1,
    "entries in the waste's set memory after one turn (specs/stock.md)",
  );
  assertDeepEqual(
    after.wasteSets.slice(0, before.wasteSets.length),
    [...before.wasteSets],
    "the entries the memory already held, which a turn appends after rather " +
      "than replaces (specs/stock.md)",
  );
  assertEqual(
    after.wasteSets[after.wasteSets.length - 1],
    moved,
    "the newest entry of the set memory, holding exactly the cards the turn " +
      "moved (specs/stock.md)",
  );
});
