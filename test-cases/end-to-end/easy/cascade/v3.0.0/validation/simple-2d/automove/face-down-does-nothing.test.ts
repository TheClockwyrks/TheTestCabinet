// automove/face-down-does-nothing — a column whose lowest card is face-down sends
// nothing.
//
// specs/instrumentation.md: a pile that holds no playable card sends nothing, which
// covers a column whose lowest card is face-down, and `autoMove` returns `false`
// when nothing moved. specs/tableau.md: a move whose taken card is face-down is
// refused, and a face-down card is never moved and never read.
//
// THE FACE IS THE ONLY THING STOPPING THE MOVE. The spades foundation holds its Ace
// and the column's lowest card is the two of spades, which would go straight home
// were it face-up. So a build that never reads the face sends it and fails here,
// and the check is deciding the face rule rather than the rank rule.
//
// THE READING IS TAKEN BEFORE ANY FRAME RUNS. The pose and the call both happen
// between frames (specs/instrumentation.md: a pointer or event operation resolves
// before it returns), so the board is read the instant the call returns. A build
// that turns the exposed card on its own next frame cannot blur what this decides;
// the frame that follows is only there to draw the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The started foundation, which would accept the buried card were it face-up. */
const FOUNDATION = 0;
/** The column in play. */
const COLUMN = 1;
/** Its cards, drawn top of the fan first: a face-up card over a face-down one. */
const CARDS = ["3H", "#2S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends nothing when the column's lowest card is face-down", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", 1);
  poseColumn(h, COLUMN, CARDS);
  const before = boardSpecs(h.snapshot());

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = boardSpecs(h.snapshot());
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    went,
    false,
    `autoMove("tableau", ${COLUMN}), whose lowest card is face-down and so ` +
      "is not playable (specs/instrumentation.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the call: the face-down card is still face-down in its " +
      "column (specs/tableau.md)",
  );
});
