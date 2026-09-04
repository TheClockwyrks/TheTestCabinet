// handling/release-on-legal-completes — a release over a pile that accepts the
// run applies the move.
//
// THE RULE. specs/controls.md: a release farther than `DRAG_THRESHOLD` from its
// press is a drop, and a drop whose leading card's centre lies "In the rectangle
// of a pile that accepts the run" has "The move is applied: the run leaves its
// source and lands on that pile."
//
// THE GESTURE. A press on the source column's only card, eight interpolated
// moves, and a release with the leading card sitting on the target column's
// anchor — so its centre lies inside that column's drop rectangle
// (specs/table.md) and the release lies `122` units from its press, well past
// `DRAG_THRESHOLD` (`5`). `handling/drag-threshold` is the point that decides the
// threshold itself; this one only needs a gesture that is unambiguously a drop.
//
// THE TARGET ACCEPTS. A red five onto a black six is one rank lower and the
// opposite colour (specs/tableau.md). `handling/release-on-illegal-returns` poses
// a target that refuses and decides the other direction, so a build that lands
// every drop and one that lands none grade differently.
//
// WHAT IS READ. Both halves of "the run leaves its source and lands on that
// pile": the target column holds the six with the five beneath it, and the source
// column holds nothing. The hand is empty again, because the gesture ended.
//
// NOTHING ELSE IS ON THE TABLE, so no other pile could have taken the card and
// the source column, emptied by the move, turns nothing (specs/tableau.md: a move
// that empties a column turns nothing).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  card,
  cardTopLeft,
  createHarness,
  drag,
  FIVE,
  grabPoint,
  openTable,
  pileTopLeft,
  poseColumn,
  SIX,
  type Harness,
} from "../harness";
import { carryTo, pileText } from "./gestures";

/** The column the run is lifted from, and the column it is released over. */
const FROM_COLUMN = 0;
const TO_COLUMN = 1;
const FROM_ROW = 0;

/** A red five onto a black six, which specs/tableau.md has a column accept. */
const RUN = card("hearts", FIVE);
const TARGET = card("spades", SIX);

/** The target column after the drop, and the source column after it. */
const LANDED = ["6S", "5H"];
const EMPTIED: string[] = [];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands the run on the target and takes it off its source", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);

  const posed = h.snapshot();
  const press = grabPoint(posed, FROM_COLUMN, FROM_ROW);
  const lead = cardTopLeft(posed, "tableau", FROM_COLUMN, FROM_ROW);
  const release = carryTo(press, lead, pileTopLeft("tableau", TO_COLUMN));

  drag(h, press, release);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "dropped");

  assertDeepEqual(
    pileText(after.tableau[TO_COLUMN]),
    LANDED,
    `column ${String(TO_COLUMN)} after the release: the run landed on the ` +
      "pile its leading card's centre resolved to (specs/controls.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[FROM_COLUMN]),
    EMPTIED,
    `column ${String(FROM_COLUMN)} after the release: an applied move leaves ` +
      "its source (specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the release, which ended the gesture " +
      "(specs/controls.md)",
  );
});
