// Facet — pointer/release-with-no-offer-plays-nothing: letting go of a gem that
// was never offered anywhere plays nothing at all.
//
// The second row of specs/controls.md's release table: "No offer stands — The
// selection and the board stand as they are." It is the row that makes picking a
// gem up a safe thing to do: a player who presses on a gem to look at it, and
// then lets go without carrying it anywhere, has asked for nothing.
//
// THE GESTURE IS A PRESS AND A RELEASE AT ONE POINT, with no movement between
// them, because that is the whole of the situation the row describes. The press
// matches the press table's first row and takes hold of the cell with no offer
// standing (`pointer/press-selects` is that row); the release then finds no offer
// and must do nothing.
//
// THE ABSENT REFUSAL IS THE DISCRIMINATING READING. A build that answered the
// release by requesting SOME swap has to name two cells, and every candidate it
// could name is refused: the selected cell with itself is not an orthogonally
// adjacent pair, so R1 refuses it, and the last cell the pointer crossed is the
// selected cell here. specs/rules.md gives a refused swap a `refusal` standing on
// its two cells for `REFUSAL_SECONDS`, so such a build leaves a mark behind where
// a conforming one leaves none. Reading the board alone would not tell them
// apart, since a refused swap leaves the board alone too.
//
// FOUR READINGS, ONE PER WAY THE ROW CAN BE BROKEN. The selection still stands,
// so the release did not let go of a gem it was told to keep hold of; all 64
// cells are as posed, so nothing was exchanged; `phase` is `idle`, so nothing was
// accepted; and no refusal stands, so nothing was requested at all.
//
// THE BOARD CARRIES A PRODUCTIVE EXCHANGE OUT OF THE PRESSED CELL, deliberately.
// A build that offered the gem into a neighbor of its own choosing on the press,
// and played it on the release, would find an accepted swap waiting on this board
// rather than a refusal — so it is caught by `phase` as well as by the mark.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNull,
  assertTrue,
} from "../assert";
import {
  assertBoardEquals,
  hasAnyRun,
  quietRowsWithEscape,
  swapIsProductive,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  releasePointer,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem that is picked up and put back down. */
const HELD: CellRef = { col: 3, row: 3 };

/** The neighbor a swap out of that cell would be accepted onto. */
const NEIGHBOR: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the gem held, the board standing and nothing requested", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsProductive(posed, HELD, NEIGHBOR),
    "a swap out of the pressed cell would be ACCEPTED, so a build that offered " +
      "a neighbor of its own choosing shows as a chain rather than as nothing",
  );

  loadBoard(h, posed);

  // The press takes hold with no offer standing, which is the state the release
  // row this point is about reads against.
  const held = pressCell(h, HELD);
  assertDeepEqual(held.selection, HELD, "the gem the press took hold of");
  assertNull(
    held.offer,
    "the offer, which a press with nothing held raises none",
  );

  const released = releasePointer(h);

  // The frame that draws the gem still held, and the picture of it.
  await h.advance(1);
  captureStill(h, "held");

  assertDeepEqual(
    released.selection,
    HELD,
    "the selection, which a release with no offer standing leaves alone",
  );
  assertBoardEquals(h.board(), posed, "the board after the release");
  assertEqual(
    released.phase,
    "idle",
    "the phase, since no swap was requested at all",
  );
  assertNull(
    released.refusal,
    "the refusal a release that requested some swap of its own would have left",
  );
});
