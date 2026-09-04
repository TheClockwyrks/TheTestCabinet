// handling/release-on-legal-completes — a release over a pile that accepts the run
// applies the move.
//
// specs/controls.md: a drop whose leading card's center lies "in the rectangle of a
// pile that accepts the run" has "the move is applied: the run leaves its source and
// lands on that pile", and "an applied move is a move like any other". So the
// reading is both halves at once: the run is ON the target and OFF its source, and
// nothing is left in the hand.
//
// THE GESTURE IS A DROP AND NOT A CLICK. specs/controls.md separates the two by the
// release point's distance from the press point, `DRAG_THRESHOLD` (`5`); the sweep
// below runs the width of three column pitches, hundreds of units, so it is a drop
// by any reading. `handling/short-gesture-is-a-click` and `handling/long-gesture-is-a-drop` are the
// items that grade the boundary
// itself.
//
// THE TARGET ACCEPTS BY THE TABLEAU RULE. specs/tableau.md has a column whose lowest
// card is the black six accept a run led by the red five. The two cards are the
// whole table, so the source column is emptied rather than exposing a face-down card
// and no turn (specs/tableau.md) enters the reading.
//
// The press is at the card's center and the release at the center of the target's
// drop rectangle (specs/table.md), so the leading card's center lands as far inside
// that rectangle as a point can be. Where the boundary of a rectangle lies is
// `handling/drop-target-by-position`'s requirement, not this one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  drag,
  openTable,
  pileSpecs,
  poseColumn,
  pressPoint,
  releasePoint,
  type Harness,
} from "../harness";

/** The column the run is lifted from, and the run: one red five. */
const FROM_COLUMN = 0;
const RUN = "5H";

/** The column it is dropped on, and its lowest card: a black six, which accepts. */
const TO_COLUMN = 3;
const TARGET = "6S";

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

  const press = pressPoint(h.snapshot(), "tableau", FROM_COLUMN, 0);
  const release = releasePoint(h.snapshot(), "tableau", TO_COLUMN);
  drag(h, press, release);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "dropped");

  assertDeepEqual(
    pileSpecs(after.tableau[TO_COLUMN]),
    [TARGET, RUN],
    `column ${TO_COLUMN} after the ${RUN} was released over it: the run lands ` +
      "on the pile that accepted it (specs/controls.md, specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[FROM_COLUMN]),
    [],
    `column ${FROM_COLUMN} after the drop: the run left its source ` +
      "(specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the hand after the drop: the gesture ended with the release " +
      "(specs/controls.md)",
  );
});
