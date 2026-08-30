// runs/leaves-cards-above — a grab leaves the cards above the pressed one where
// they lay.
//
// specs/tableau.md: "The cards above the one taken stay in the column, in their
// order and with their faces unchanged." specs/controls.md adds that the run
// "leaves the pile it was lifted from as it enters the hand, so that pile holds
// only the cards left behind for as long as the gesture lasts", so the reading is
// taken on the press, with the run still in hand.
//
// What the grab TOOK is the sibling point `runs/takes-every-card-below`. This one
// reads the source column alone, so a build that lifts too much fails here and a
// build that reorders what it leaves fails here too.
//
// THE POSE SEPARATES THE WRONG MODELS. The press lands on the third card of a
// five-card column, so the rule leaves two: a build that lifts the whole column
// leaves none, a build that lifts the pressed card alone leaves four, and a build
// that lifts the cards above the press leaves the wrong two. The two left behind
// are a `3C` and a `JD` — neither in run order with the other nor with the card
// pressed — so no wrong model can produce them by re-deriving a run.
//
// EVERY CARD IS FACE-UP, so the exposed-card rule specs/tableau.md states never
// applies; specs/tableau.md separately fixes that a lift turns nothing while the
// cards are in hand, and `tableau/no-early-flip` is the point that decides it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
  type Point,
} from "../harness";
import { columnGrab, releaseFor } from "./grab";

/** The column the grab presses into. */
const COLUMN = 0;

/**
 * The column, bottom card first, every card face-up. Neither `3C` nor `JD` is in
 * run order with the card beneath it, so what stays behind is a pair no rule about
 * runs could have assembled.
 */
const CARDS = ["3C", "JD", "8S", "7H", "6S"];

/** The card pressed, counted from the column's bottom card at `0`. */
const GRAB_ROW = 2;

/** What stays in the column: the cards above the pressed one, in their order. */
const LEFT_BEHIND = CARDS.slice(0, GRAB_ROW);

/**
 * Where the lifted run's leading card is carried for the still.
 *
 * The third column position of the top row, `x = 468`, carries no pile
 * (specs/table.md), so the held cards sit clear of the source column in the
 * picture and what the column shows is the two cards left behind. It decides
 * nothing: the column loses the run on the press itself (specs/controls.md).
 */
const HELD_AT: Point = { x: 468, y: 24 };

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves the two cards above the pressed one in the column, in order", async () => {
  openTable(harness);
  const posed = poseColumn(harness, COLUMN, CARDS);

  const grab = columnGrab(harness.snapshot(), COLUMN, GRAB_ROW);
  harness.debug.pointerDown(grab.at.x, grab.at.y);
  const carried = releaseFor(grab, HELD_AT);
  harness.debug.pointerMove(carried.x, carried.y);
  await harness.advance(1);
  captureStill(harness, "source");

  const source = harness.snapshot().tableau[COLUMN];
  assertLength(
    source,
    LEFT_BEHIND.length,
    "cards left in the source column while the run is in hand",
  );
  assertDeepEqual(
    pileSpecs(source),
    LEFT_BEHIND,
    "the cards left in the source column, bottom card first",
  );
  assertDeepEqual(
    source.map((card) => card.id),
    posed.slice(0, GRAB_ROW),
    "the ids of the cards left in the source column, bottom card first",
  );
  for (const [at, card] of source.entries()) {
    assertEqual(
      card.faceUp,
      true,
      `the face of the card left at row ${at}, which the grab must not change`,
    );
  }
});
