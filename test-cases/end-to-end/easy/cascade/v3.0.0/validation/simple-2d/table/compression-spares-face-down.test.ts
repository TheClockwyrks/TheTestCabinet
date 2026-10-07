// table/compression-spares-face-down — a compressed column still draws 24 under a
// face-down card.
//
// THE RULE. specs/table.md reduces the FACE-UP offset alone: "its face-up offset
// is reduced uniformly ... The face-down offset stays at `24` however far a column
// is compressed." A buried card shows nothing but its back, so nothing is gained
// by tightening it, and specs/table.md keeps the buried run reading at its own
// pitch however long the column grows.
//
// THE SCENARIO POSES THE DISTINGUISHING VALUE. Six face-down cards under fourteen
// face-up ones — the six buried cards column `6` is dealt (specs/deal.md), with a
// long run built onto them — reach `180 + 6 x 24 + 13 x 34 + 140 = 906` at the
// natural offsets, so the column must be fitted. Fitting the face-up gaps alone
// leaves `(676 - 140 - 180 - 144) / 13 = 16.31` under each face-up card and `24`
// under each face-down one. A build that instead fitted EVERY gap uniformly would
// need `(676 - 140 - 180) / 19 = 18.74` and so would draw `18.74` under the
// face-down cards: `5.26` away from `24`, which is what makes the two models read
// as different numbers here.
//
// The fitted face-up gap is `16.31`, above `FACE_UP_OFFSET_MIN` (`14`), so the
// floor never engages and the arrangement asks the fit one question only.
//
// ONLY THE FACE-DOWN GAPS ARE ASSERTED. What the face-up gaps were reduced to is
// `table/column-compression` and `table/compression-uniform`; whether the column
// needed fitting at all is `table/column-compression`. A build that never
// compresses draws `24` under its face-down cards and passes here, correctly:
// its fault is the one that point names.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { FACE_DOWN_OFFSET } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { drawnColumnGaps } from "./geometry";

/**
 * How far a drawn face-down gap may sit from `FACE_DOWN_OFFSET`, in logical units.
 *
 * `24` is exact in specs/table.md; this is the unit a build may lose insetting a
 * stroke inside the footprint it draws, the same room `harness.ts` reads a
 * card-sized box with (`CARD_BOX_TOLERANCE`). The build this point exists to catch
 * — one that fits every gap of the column alike — draws `18.74` here, `5.26` away,
 * so the window cannot admit it.
 */
const OFFSET_TOLERANCE = 2;

/** The column the run is posed on. */
const COLUMN = 6;

/** Six buried cards, as column 6 is dealt, under a fourteen-card face-up run. */
const BURIED = ["#3C", "#7D", "#2H", "#JS", "#5C", "#9D"];
const RUN = [
  "KS",
  "QH",
  "JC",
  "10D",
  "9S",
  "8H",
  "7C",
  "6D",
  "5S",
  "4H",
  "3C",
  "2D",
  "AS",
  "KH",
];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves the face-down gaps of a compressed column at 24", async () => {
  openTable(harness);
  poseColumn(harness, COLUMN, [...BURIED, ...RUN]);

  const calls = await drawFrame(harness);
  captureStill(harness, "compressed");

  const gaps = drawnColumnGaps(harness, calls);
  assertLength(
    gaps,
    BURIED.length + RUN.length - 1,
    `gaps drawn in the column, which was posed with ` +
      `${BURIED.length + RUN.length} cards`,
  );

  // The gap under card `row` is decided by card `row`'s own face, so the gaps
  // this point reads are the first `BURIED.length` of them.
  for (let row = 0; row < BURIED.length; row += 1) {
    assertBetween(
      gaps[row],
      FACE_DOWN_OFFSET - OFFSET_TOLERANCE,
      FACE_DOWN_OFFSET + OFFSET_TOLERANCE,
      `the drawn gap under the face-down card at row ${row} of a compressed ` +
        `column, FACE_DOWN_OFFSET (specs/table.md)`,
    );
  }
});
