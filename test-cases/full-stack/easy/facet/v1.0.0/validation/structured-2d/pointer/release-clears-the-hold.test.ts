// Facet — pointer/release-clears-the-hold: the release that plays a move lets go
// of the gem.
//
// The second clause of specs/controls.md's release table's first row: "The swap
// of the selected cell with the offered cell is requested, AND THE OFFER AND THE
// SELECTION ARE BOTH CLEARED." The swap itself is
// `pointer/release-plays-the-offer`'s point; what the release leaves behind is
// this one.
//
// WHY THE TWO ARE SEPARATE POINTS. They are different faults with different
// repairs, and the second is invisible until the player's NEXT press. A build
// that plays the move and leaves the gem held has that next press land on the
// press table's re-grab row, or on its offer row, instead of on a fresh
// selection — so the player's following move goes somewhere they did not aim it,
// on a board that has meanwhile resolved a chain. A build that clears the
// selection and leaves the offer standing is worse still: the release after it
// would replay a move against whatever gem the refill dropped into the offered
// cell.
//
// READ ON THE FRAME AFTER THE RELEASE, not only at the call. specs/state.md keeps
// `selection` and `offer` as state the update carries forward, so a build that
// cleared them in the release and put them back on the next frame — from a
// pointer it re-reads, or from a hold it never let go of — is caught by the
// second reading and not by the first. Both are taken, and both are asserted.
//
// The frame is one frame of the suite's clock, `0.015625` s, which is well inside
// `SWAP_SECONDS` (`0.18`), so the swap is still in motion and the reading is of
// the same move the release played rather than of whatever step 1 left.
//
// THE HOLD IS POSED, and the exchange under it is productive, for the same reason
// `pointer/release-plays-the-offer` poses its own: the release has to be one that
// really plays a move, or "the hold was let go of" would be the answer a release
// that did nothing at all gives.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
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
  releasePointer,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem the player has hold of at the release. */
const HELD: CellRef = { col: 3, row: 3 };

/** The neighbor it is offered into, which the release plays it onto. */
const OFFERED: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves neither the selection nor the offer standing", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, OFFERED),
    "the offered cell is an orthogonal neighbor of the held one",
  );
  assertTrue(
    swapIsProductive(posed, HELD, OFFERED),
    "the offered exchange is one R3 accepts, so the release really plays a move",
  );

  loadBoard(h, posed);
  h.debug.setSelection(HELD.col, HELD.row);
  h.debug.setOffer(OFFERED.col, OFFERED.row);

  const before = h.snapshot();
  assertDeepEqual(before.selection, HELD, "the gem the player has hold of");
  assertDeepEqual(before.offer, OFFERED, "the neighbor it is offered into");

  const played = releasePointer(h);
  assertEqual(
    played.phase,
    "swapping",
    "the phase the release put the accepted swap into, so this is the release " +
      "the row is about",
  );
  assertNull(played.selection, "the selection the release let go of");
  assertNull(played.offer, "the offer the release played and cleared");

  // And the frame after it, which is where a build that puts either back shows.
  await h.advance(1);
  captureStill(h, "released");

  const next = h.snapshot();
  assertNull(next.selection, "the selection on the frame after the release");
  assertNull(next.offer, "the offer on the frame after the release");
});
