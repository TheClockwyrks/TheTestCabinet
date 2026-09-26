// Facet — pointer/release-plays-the-offer: letting go of the gem with an offer
// standing is what plays the move.
//
// specs/controls.md's release table, first row: "An offer stands — The swap of
// the selected cell with the offered cell is requested, and the offer and the
// selection are both cleared." And the sentence the whole hold model rests on:
// "Nothing reaches the move rules until the pointer is released. … A move is
// played only by a release with an offer standing."
//
// SO THIS IS THE ONE ROUTE A PLAYER HAS TO PLAYING A MOVE AT ALL, which is why
// the item is capped at `broken`. Every other point in this directory reads a
// stage of the gesture that leaves the board alone; this reads the one edge that
// does not.
//
// WHAT AN ACCEPTED REQUEST LOOKS LIKE. specs/rules.md: an accepted swap
// "exchanges the two cells and puts the game into `swapping`, its first chain
// step resolving once `SWAP_SECONDS` (`0.18`) of game time has passed". So the
// reading is taken at the release itself, with no frame advanced: the two cells
// have traded gems, `phase` is `swapping`, and no refusal stands. Driving frames
// first would read step 1's board instead, which is the `moves` and `runs`
// categories' business rather than this one's.
//
// THE EXCHANGE IS POSED PRODUCTIVE, so the request has to be ACCEPTED for the
// reading to hold. A refused release would leave the board untouched and a
// refusal standing on two cells, which is a different reading altogether — and
// the acceptance rules that decide between them are R1, R2 and R3, which the
// `moves` category owns. What this point decides is that the release reached
// them at all.
//
// THE HOLD IS POSED RATHER THAN DRAGGED INTO PLACE. specs/instrumentation.md's
// `setSelection` and `setOffer` arrange exactly the state the release table reads
// against and request no swap between them, so nothing of how a player got there
// enters this reading. The whole gesture, driven end to end, is
// `pointer/drag-then-release-swaps`.

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

/**
 * Frames the replay runs on after the release, so the recording shows the swap
 * travelling rather than one still of the board.
 *
 * Nothing is read off them: every assertion below is made against the reading the
 * release itself returned. Ten frames is `0.15625` s, inside `SWAP_SECONDS`
 * (`0.18`), so the recording is of the swap in motion.
 */
const WATCH_FRAMES = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("requests the offered swap, which a productive exchange accepts", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, OFFERED),
    "the offered cell is an orthogonal neighbor of the held one",
  );
  assertTrue(
    swapIsProductive(posed, HELD, OFFERED),
    "the offered exchange is one R3 accepts, so the request is taken rather " +
      "than refused",
  );

  await loadBoard(h, posed);
  await h.debug.setSelection(HELD.col, HELD.row);
  await h.debug.setOffer(OFFERED.col, OFFERED.row);

  const before = await h.snapshot();
  assertDeepEqual(before.selection, HELD, "the gem the player has hold of");
  assertDeepEqual(before.offer, OFFERED, "the neighbor it is offered into");
  assertEqual(before.phase, "idle", "the phase before the release");
  assertBoardEquals(await h.board(), posed, "the board before the release");

  const { played, board } = await captureReplay(h, "play", async () => {
    // The one edge that reaches the move rules, read in the state it returned
    // and on the board that state holds, before any frame has run.
    const reading = await releasePointer(h);
    const traded = await h.board();
    await h.advance(WATCH_FRAMES);
    return { played: reading, board: traded };
  });

  // The two cells have traded gems: specs/rules.md exchanges them at the moment
  // the swap is accepted, before the animation that follows.
  assertBoardEquals(
    board,
    swapped(posed, HELD, OFFERED),
    "the board the accepted swap exchanged",
  );
  assertEqual(
    played.phase,
    "swapping",
    "the phase the release put the accepted swap into",
  );
  assertNull(played.refusal, "the refusal a refused request would have left");
  assertEqual(
    played.chainStep,
    0,
    "the chain step, which stands at 0 until the swap animation is over",
  );
});
