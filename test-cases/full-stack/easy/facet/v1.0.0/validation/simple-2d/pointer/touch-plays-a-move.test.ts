// Facet — pointer/touch-plays-a-move: a finger plays a move, and the game says it
// was a finger.
//
// specs/controls.md opens its pointer section with the sentence this point is
// about: "A mouse, a pen, and a finger on a touchscreen all drive the pointer,
// and the game reads them the same way. Everything the pointer does below is done
// by all three." specs/instrumentation.md gives the posed press, movement and
// release a trailing `device` — "`mouse`, `pen`, or `touch`" — and says the three
// "drive the same input path a real pointer drives, so a posed touch and a posed
// mouse differ only in the `device` the state reports".
//
// SO IT IS `pointer/drag-then-release-swaps`'s GESTURE, RUN AGAIN AS A FINGER.
// Press on a cell, carry onto its orthogonal neighbor, release there, over a
// productive exchange — and every one of the three calls names `touch`.
//
// BOTH HALVES ARE ASSERTED, because either alone passes a build that is wrong in
// the other direction. A build that ignores touch entirely plays no move, and the
// swap is the half that catches it. A build that plays the move and reports
// `mouse` has not read the device at all, and the reported device is the half that
// catches it — and that build has a diagnostic overlay, and a
// `pointer/pointer-mirrored` reading, that lie about what the player is using.
// specs/controls.md gives all three devices one path, so a build with a real
// touch path passes both without doing anything twice.
//
// WHY A TOUCHSCREEN IS WORTH ITS OWN POINT AT ALL. The hold model this whole
// category describes is the model a finger needs: there is no hover, so the press
// is what takes hold and the release is what plays. A build that listened for
// mouse events alone answers every point above this one and leaves a touchscreen
// dead, which is not a fault any of them can see.

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
  dragOntoCell,
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

/** The gem the finger takes hold of. */
const HELD: CellRef = { col: 3, row: 3 };

/** The orthogonal neighbor it is carried onto and lifted beside. */
const NEIGHBOR: CellRef = { col: 3, row: 4 };

/** The device every call of the gesture names. */
const FINGER = "touch";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the move with a finger, and reports the device as touch", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, NEIGHBOR),
    "the carried-onto cell is an orthogonal neighbor of the held one",
  );
  assertTrue(
    swapIsProductive(posed, HELD, NEIGHBOR),
    "the exchange is one R3 accepts, so the release's request is taken",
  );

  loadBoard(h, posed);

  const played = await captureReplay(h, "touch", async () => {
    // The same three operations, every one of them naming the finger.
    const held = pressCell(h, HELD, FINGER);
    assertDeepEqual(held.selection, HELD, "the gem the finger took hold of");
    assertEqual(held.pointer.device, FINGER, "the device the press named");

    const carried = dragOntoCell(h, NEIGHBOR, FINGER);
    assertDeepEqual(carried.offer, NEIGHBOR, "the offer the carry made");
    assertEqual(carried.pointer.device, FINGER, "the device the carry named");

    const reading = releasePointer(h, FINGER);
    const board = h.board();
    await h.advance(1);
    return { reading, board };
  });

  // Half one: the move was played.
  assertBoardEquals(
    played.board,
    swapped(posed, HELD, NEIGHBOR),
    "the board the finger's accepted swap exchanged",
  );
  assertEqual(
    played.reading.phase,
    "swapping",
    "the phase the finger's release put the accepted swap into",
  );
  assertNull(played.reading.offer, "the offer the release played and cleared");

  // Half two: the game read what drove it.
  assertEqual(
    played.reading.pointer.device,
    FINGER,
    "the device the snapshot reports for the gesture that played the move",
  );
});
