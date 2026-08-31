// Facet — pointer/drag-then-release-swaps: the gesture a player actually makes,
// driven end to end, plays the move.
//
// specs/controls.md builds a move out of three tables — a press takes hold, a
// movement while held offers, and "The release is what plays a move" — and this
// point drives all three in one gesture: press on a cell, carry the pointer onto
// its orthogonal neighbor, let go there. A productive exchange makes that
// request an accepted swap, which specs/rules.md exchanges at once and puts into
// `swapping`.
//
// WHY IT IS A POINT OF ITS OWN, AND CAPPED AT `broken`. Every stage of the hold
// has its own point above, and a build can answer each of them in isolation and
// still lose the hold BETWEEN two of them — a press that arms a selection the
// movement cannot see, a movement that offers into a cell the release does not
// read, a release that reads a hold the movement had already dropped. None of the
// stage-by-stage points can see that, because each poses the state the one before
// it should have produced. This one poses nothing: it makes the gesture and reads
// the board.
//
// THROUGH THE REAL POINTER VERBS, for the same reason. The other points in this
// directory pose their presses through the surface, which specs/instrumentation.md
// resolves at the call; here the events are dispatched the way a player's pointer
// dispatches them, and each is delivered inside a frame's own update. So what is
// decided is that the build's real input path carries a hold from one frame to
// the next — which is the only way a player ever plays a move.
//
// FOUR READINGS. The two cells have traded gems; `phase` is `swapping`; and
// neither the selection nor the offer stands, because the release that plays a
// move lets go of the gem. The board is read against this project's own
// `swapped`, which is the exchange written out, so what is asserted is the move
// the player made rather than a board this check happened to expect.
//
// THE FRAME AFTER THE RELEASE is one frame of the suite's clock, `0.015625` s,
// far inside `SWAP_SECONDS` (`0.18`) — so the swap is still travelling and the
// reading is of the accepted request rather than of whatever step 1 left behind.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  assertBoardEquals,
  cellCenter,
  hasAnyRun,
  quietRowsWithEscape,
  swapIsProductive,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem the gesture takes hold of. */
const HELD: CellRef = { col: 3, row: 3 };

/** The orthogonal neighbor it is carried onto and let go beside. */
const NEIGHBOR: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the move the press, the carry and the release describe", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, NEIGHBOR),
    "the carried-onto cell is an orthogonal neighbor of the held one, so R1 " +
      "takes the pair",
  );
  assertTrue(
    swapIsProductive(posed, HELD, NEIGHBOR),
    "the exchange is one R3 accepts, so the release's request is taken",
  );

  await loadBoard(h, posed);

  const from = cellCenter(HELD.col, HELD.row);
  const onto = cellCenter(NEIGHBOR.col, NEIGHBOR.row);

  const played = await captureReplay(h, "play", async () => {
    // Each verb arms a real pointer event, and the `advance` after it is the
    // frame that delivers it to the game's own update.
    await h.press(from.x, from.y);
    await h.advance(1);
    const held = await h.snapshot();
    assertDeepEqual(
      held.selection,
      HELD,
      "the gem the real press took hold of",
    );

    await h.moveTo(onto.x, onto.y);
    await h.advance(1);
    const carried = await h.snapshot();
    assertDeepEqual(carried.offer, NEIGHBOR, "the offer the real carry made");
    assertEqual(
      carried.phase,
      "idle",
      "the phase while the gem stands offered",
    );

    await h.lift();
    await h.advance(1);
    return { reading: await h.snapshot(), board: await h.board() };
  });

  assertBoardEquals(
    played.board,
    swapped(posed, HELD, NEIGHBOR),
    "the board the accepted swap exchanged",
  );
  assertEqual(
    played.reading.phase,
    "swapping",
    "the phase the release put the accepted swap into",
  );
  assertNull(played.reading.selection, "the selection the release let go of");
  assertNull(played.reading.offer, "the offer the release played and cleared");
});
