// handling/sweep-resolves-per-sample — every pointer sample a frame delivers is
// answered, in the order it arrived.
//
// specs/controls.md: "Every sample a frame delivers is answered on its own, in the
// order it arrived, so a press and the release that followed it inside one frame
// both take effect and a gesture is never reduced to the last position of the frame
// that carried it."
//
// THE MEASUREMENT IS A WHOLE GESTURE INSIDE ONE FRAME. The press, the moves and the
// release are all dispatched to the ENGINE's own pointer before a single frame runs,
// and then one frame runs. A build that folds each sample in turn lifts the run on
// the press, carries it across the moves and lands it on the release; a build that
// keeps only the frame's last sample sees the release alone, has nothing in hand,
// and leaves the card in its source column. So the completed move is the whole
// reading.
//
// WHY NOT A SWEEP ACROSS SEVERAL PILES. Crossing a pile leaves no trace in this
// game: a build that answered every sample and one that answered only the last would
// both end over the same pile, and the two would be indistinguishable. Delivering
// the gesture's beginning and its end inside one frame is what separates them.
//
// THIS IS THE ENGINE'S POINTER, NOT THE SURFACE'S. The surface's
// `pointerDown`/`pointerMove`/`pointerUp` are immediate poses, each resolved before
// the call returns (specs/instrumentation.md), so driving them could never ask a
// build what it does with a frame's worth of samples. `sweepPointer` dispatches real
// pointer events and then runs the one frame that delivers them.
//
// THE TARGET ACCEPTS BY THE TABLEAU RULE: a column whose lowest card is the black six
// accepts a run led by the red five (specs/tableau.md). The press is at the card's
// center and the release at the center of the target's drop rectangle, so the
// leading card's center lands well inside it (specs/table.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  pressPoint,
  releasePoint,
  sweepPointer,
  type Harness,
} from "../harness";

/** The column the run is lifted from, and the run: one red five. */
const FROM_COLUMN = 0;
const RUN = "5H";

/** The column it is dropped on, and its lowest card: a black six, which accepts. */
const TO_COLUMN = 3;
const TARGET = "6S";

/** How many moves the gesture carries between its press and its release. */
const STEPS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts and lands a run whose whole gesture arrives inside one frame", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);

  await sweepPointer(
    h,
    pressPoint(h.snapshot(), "tableau", FROM_COLUMN, 0),
    releasePoint(h.snapshot(), "tableau", TO_COLUMN),
    STEPS,
  );
  const after = h.snapshot();
  captureStill(h, "dropped");

  assertDeepEqual(
    pileSpecs(after.tableau[TO_COLUMN]),
    [TARGET, RUN],
    `column ${TO_COLUMN} after a press, ${STEPS} moves and a release all ` +
      "delivered before one frame's update: every sample is answered on its " +
      "own, so the press lifted the run and the release landed it " +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[FROM_COLUMN]),
    [],
    `column ${FROM_COLUMN} after that frame: the run left its source, which a ` +
      "build that had seen only the frame's last sample never lifted " +
      "(specs/controls.md)",
  );
});
