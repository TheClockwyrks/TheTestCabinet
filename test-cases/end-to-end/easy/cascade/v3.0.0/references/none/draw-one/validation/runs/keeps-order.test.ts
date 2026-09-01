// runs/keeps-order — the three cards of a moved run arrive in the order they
// left.
//
// `specs/tableau.md`, "What a move takes": "A run that moves lands on its target
// in the order it left, so the card that led the run is the target's new lowest
// card and the rest follow beneath it." A pile is reported bottom card first
// (`specs/table.md`, "The order of a pile"), so the run's cards are the target
// column's LAST entries, in the same relative order they had in the source.
//
// WHAT THIS ITEM DECIDES. The arrangement alone. That all three travelled is
// `runs/moves-as-unit`, which poses the same board and counts them; this check
// reads the target's tail and compares it, card for card, with the ids the source
// column held.
//
// THE THREE CARDS ARE TOLD APART BY RANK, so every wrong arrangement reads as a
// different list: a build that reversed the run reports the seven, the eight and
// the nine; a build that inserted the run above the target's own card reports the
// ten last. Neither is averaged away by a count.
//
// The four faculty gates stay at their reset defaults, which are all on. None can
// fire: the source column is emptied outright, so `autoFlip` has nothing to turn,
// and no card goes home, so `winDetect` has nothing to declare.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the run is lifted from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 2;

/** The column it is offered to. */
const TARGET = 5;

/**
 * The run, in pile order: the nine is the run's leading card and the seven the
 * one lying lowest on the table. Three ranks, so any transposition is visible.
 */
const RUN = cards("9S", "8H", "7S");

/** The red ten waiting on the target, which accepts the run's black nine. */
const TARGET_CARD = card("10H");

/** One frame, so the still shows the board the move left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lands the run on its target in the order it left the source", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const runIds = await poseColumn(h, SOURCE, RUN);

  const accepted = await h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "moved");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on the run offered to column ${TARGET}, ` +
      "whose lowest card is a red ten — specs/tableau.md: a column accepts a run " +
      "led by a card one rank lower and of the opposite color to its own lowest card",
  );

  const landed = pileOf(after, "tableau", TARGET).map((c) => c.id);
  assertLength(
    landed,
    RUN.length + 1,
    `the cards on column ${TARGET} after the move, before their order is read`,
  );
  assertDeepEqual(
    landed,
    [targetId, ...runIds],
    `column ${TARGET} read bottom card first: the card it already held, then the ` +
      "run's three cards in the order they lay in the source column. A reversed " +
      "list is a build that stacked the run backwards; a list with the target's " +
      "own card out of first place is one that inserted the run above it",
  );
});
