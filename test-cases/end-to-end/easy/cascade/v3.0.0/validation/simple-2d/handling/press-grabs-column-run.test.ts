// handling/press-grabs-column-run — a press on a column card lifts that card and
// every card below it, in order.
//
// specs/controls.md's grab table: a press on "a face-up card in a column" lifts
// "that card and every card below it in the column, as the run specs/tableau.md
// defines", and the run "enters the hand on the press itself, before the pointer has
// moved at all". So the whole gesture this point drives is one `pointerDown`, and
// what it reads is `snapshot().drag` immediately afterwards: `cards[0]` is the
// grabbed card and the rest follow beneath it (specs/instrumentation.md).
//
// THE PRESS LANDS ON A CARD THAT IS NOT THE COLUMN'S LOWEST, which is the whole
// point of the item: a press on the lowest card would lift a run of one and decide
// nothing about "and the cards below". specs/controls.md resolves a press to "the
// lowest of the cards whose footprint contains that point", so it is aimed at the
// strip the grabbed card leaves uncovered (`aim.ts`) rather than at its center,
// which a lower card covers.
//
// THE POSE. One column, holding a buried face-down card and then three face-up cards
// in run order. The press takes the first of the three, so a build that lifts only
// the card under the pointer reads one card, a build that lifts the column's lowest
// card reads a different one, and a build that lifts them bottom-first reads them
// reversed. The face-down card at the bottom is left behind by the rule, and it is
// what separates "the cards below it" from "the whole column".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";
import { exposedPressPoint } from "./aim";

/** The column the run waits in, named away from the first slot on purpose. */
const COLUMN = 2;

/**
 * The column, bottom card first: one buried card and a three-card run.
 *
 * The three face-up cards are in run order — each one rank lower than, and the
 * opposite color of, the card above it (specs/tableau.md) — so what the press lifts
 * is a run by every reading of the word.
 */
const COLUMN_CARDS = ["#KD", "9S", "8H", "7C"];

/** The row the press lands on: the first of the three face-up cards. */
const GRABBED_ROW = 1;

/** What the press owes the hand: the grabbed card and every card below it. */
const EXPECTED_RUN = ["9S", "8H", "7C"];

/** What the column keeps: every card above the one grabbed. */
const EXPECTED_LEFT = ["#KD"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts the pressed card and every card below it, in order, on the press", async () => {
  openTable(h);
  poseColumn(h, COLUMN, COLUMN_CARDS);

  const at = exposedPressPoint(h.snapshot(), COLUMN, GRABBED_ROW);
  h.debug.pointerDown(at.x, at.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "held");

  assertDeepEqual(
    held.drag === null ? null : pileSpecs(held.drag.cards),
    EXPECTED_RUN,
    `the run in hand, grabbed card first, after a press on the ` +
      `${COLUMN_CARDS[GRABBED_ROW]} in column ${COLUMN}: the pressed card and ` +
      "every card below it, entering the hand on the press itself " +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    held.drag === null
      ? null
      : { fromPile: held.drag.fromPile, fromIndex: held.drag.fromIndex },
    { fromPile: "tableau", fromIndex: COLUMN },
    "the pile the run in hand was lifted from (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileSpecs(held.tableau[COLUMN]),
    EXPECTED_LEFT,
    `the cards left in column ${COLUMN}: the run leaves the pile it was ` +
      "lifted from as it enters the hand (specs/controls.md)",
  );
});
