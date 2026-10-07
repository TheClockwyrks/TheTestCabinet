// runs/takes-every-card-below — a grab lifts the pressed card and everything
// fanned below it.
//
// specs/controls.md: a press on "a face-up card in a column" lifts "that card and
// every card below it in the column", and "the run enters the hand on the press
// itself, before the pointer has moved at all". specs/tableau.md says the same of
// a move: it "takes one of its face-up cards and every card below it in that
// column, in the order they lie there".
//
// So the reading is taken from the hand, on the press alone: what the grab took,
// not what any target then did with it. What the grab LEAVES is the sibling point
// `runs/leaves-cards-above`.
//
// THE POSE SEPARATES THE WRONG MODELS. Five face-up cards, one of them not in run
// order with the rest, and the press lands on the second from the top of the
// column: the rule lifts four, a build that lifts the pressed card alone lifts
// one, a build that lifts the whole column lifts five, and a build that lifts the
// cards ABOVE the press lifts one different card. The ids are read alongside the
// names, so the four are the four that were in the column and not four cards of
// the same names.
//
// EVERY CARD IS FACE-UP, so the exposed-card rule specs/tableau.md states never
// applies and no gate has to be turned off to keep it out of this reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
import {
  captureStill,
  createHarness,
  movePointerTo,
  openTable,
  poseColumn,
  pressAt,
  type Harness,
  type Point,
} from "../harness";
import { cardsOf, pileText } from "./board";
import { columnGrab, releaseFor } from "./grab";

/** The column the grab presses into. */
const COLUMN = 0;

/**
 * The column, bottom card first, every card face-up.
 *
 * `3C` is not in run order with the `9H` below it, so a build that lifted the
 * whole column and a build that followed the rule cannot agree by accident.
 */
const CARDS = ["3C", "9H", "8S", "7H", "6S"];

/** The card pressed, counted from the column's bottom card at `0`. */
const GRAB_ROW = 1;

/** What the press lifts: the pressed card and the three fanned below it. */
const TAKEN = CARDS.slice(GRAB_ROW);

/**
 * Where the lifted run's leading card is carried for the still.
 *
 * specs/table.md anchors the top row's six piles on the first, second, fourth,
 * fifth, sixth and seventh column positions, so the third — `x = 468` — carries
 * no pile. Holding the run there puts the lifted cards clear of the column they
 * came out of, so the picture shows what the grab took. It decides nothing: what
 * a grab takes is fixed at the press (specs/controls.md), and the reading below
 * is taken after the carry either way.
 */
const HELD_AT: Point = { x: 468, y: 24 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts the pressed card and every card below it in the column", async () => {
  openTable(h);
  const posed = poseColumn(h, COLUMN, cardsOf(CARDS));

  const grab = columnGrab(h.snapshot(), COLUMN, GRAB_ROW);
  pressAt(h, grab.at.x, grab.at.y);
  const carried = releaseFor(grab, HELD_AT);
  movePointerTo(h, carried.x, carried.y);
  await h.advance(1);
  captureStill(h, "held");

  const held = h.snapshot().drag;
  if (held === null) {
    fail(
      "a press on a face-up column card to lift a run into the hand " +
        "(specs/controls.md)",
      held,
    );
  }

  assertLength(
    held.cards,
    TAKEN.length,
    "cards in hand: the pressed card and the three fanned below it " +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    pileText(held.cards),
    TAKEN,
    "the cards in hand, the pressed one first",
  );
  assertDeepEqual(
    held.cards.map((card) => card.id),
    posed.slice(GRAB_ROW),
    "the ids of the cards in hand, the pressed one first",
  );
  assertEqual(held.fromPile, "tableau", "the pile the run was lifted from");
  assertEqual(held.fromIndex, COLUMN, "the column the run was lifted from");
});
