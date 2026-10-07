// instrumentation/add-card-touches-one-pile — `addCard` changes its own pile and
// nothing else.
//
// specs/instrumentation.md: `addCard` "touches no other pile and no other field,
// the waste's set memory included".
//
// WHY THE SUITE RESTS ON IT. Every scenario in this project is posed one card at a
// time, so a board of thirteen piles is built by a run of `addCard` calls that must
// not interfere. A build that rebuilt the waste's set memory on every add, or that
// pushed the new card onto whichever pile it last touched, would quietly rearrange
// half the scenarios in this suite and the checks built on them would be deciding
// something else entirely.
//
// THE BOARD CARRIES EVERY PILE AND TWO SETS, so "everything else" is something to
// read: an addition to one column is made against twelve other piles that hold
// cards, a waste whose set memory holds two counts, and the flyers and gates the
// board also carries. An empty table would let a build that wiped its neighbours
// pass.
//
// NO FRAME RUNS between the reading before and the reading after, so the only thing
// that happened to the board is the one operation this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  parseCard,
  pileOf,
  pileSpecs,
  type Harness,
} from "../harness";
import { assertOtherPilesUnchanged, pileName, poseFullBoard } from "./board";

/** The pile the one card is added to, and the card. */
const TARGET = { pile: "tableau", index: 4 } as const;
const ADDED = "KH";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the other twelve piles and the waste's sets as they were", async () => {
  openTable(h);
  poseFullBoard(h);

  const before = h.snapshot();
  assertGreaterThan(
    before.wasteSets.length,
    0,
    "the sets the posed waste remembers, which the addition must leave alone",
  );

  const card = parseCard(ADDED);
  h.debug.addCard(TARGET.pile, TARGET.index, card.suit, card.rank, card.faceUp);

  const after = h.snapshot();

  // The board after the single addition.
  await h.advance(1);
  captureStill(h, "board");

  assertDeepEqual(
    pileSpecs(pileOf(after, TARGET.pile, TARGET.index)),
    [...pileSpecs(pileOf(before, TARGET.pile, TARGET.index)), ADDED],
    `${pileName(TARGET)}, the pile the card was added to`,
  );

  assertOtherPilesUnchanged(
    before,
    after,
    TARGET,
    "addCard touches no other pile (specs/instrumentation.md)",
  );

  assertDeepEqual(
    after.wasteSets,
    before.wasteSets,
    "the waste's set memory: addCard touches no other field, the waste's set " +
      "memory included (specs/instrumentation.md)",
  );
  assertEqual(
    after.wasteVisibleCount,
    before.wasteVisibleCount,
    "the cards the waste shows, which follows its set memory",
  );
});
