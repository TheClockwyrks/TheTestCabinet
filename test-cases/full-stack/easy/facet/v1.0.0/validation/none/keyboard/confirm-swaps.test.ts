// Facet — keyboard/confirm-swaps: `confirm` fired while the cursor sits on a
// cell orthogonally adjacent to the selected one requests that swap, and clears
// the selection.
//
// THE ROW THIS IS ABOUT. specs/controls.md sends the keyboard through the
// pointer's own table — "`confirm` acts on the cursor's cell exactly as a press
// on that cell does. The four rows under Selecting and swapping decide it, read
// against the cursor's cell in place of a targeted one" — and the third row is
// "A cell orthogonally adjacent to the selected cell | Requests that swap and
// clears the selection." It is the row that makes the keyboard a way to PLAY
// rather than merely a way to point: a build that lost it can move a cursor and
// light a cell and never make a move.
//
// AND IT MUST BE A REQUEST, NOT A PRIVATE PATH. "Every requested swap goes
// through one acceptance path, whether a press, a drag, or the keyboard asked
// for it, and the move rules in specs/rules.md decide it." So the evidence a
// swap was really requested is the evidence specs/rules.md fixes for an accepted
// one: "An accepted swap exchanges the two cells at once, sets `chainStep` to
// `1`, sets `phase` to `resolving`, and resolves step `1` immediately."
//
// WHY THE SCENARIO IS BUILT THE WAY IT IS. The swap has to be one the move rules
// ACCEPT, or a build that routed `confirm` correctly would still show nothing:
// R3 accepts a swap only when the board it produces carries a maximal run. So
// the fixture plants one, and says so in the fixture's own terms — `swapIsLegal`
// is R1 and R3 read off the written board — rather than trusting the board to be
// what it looks like. Whether R1, R2 and R3 decide a swap correctly is the move
// items' business; here they are the reason the request is visible at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import { BINDINGS } from "../constants";
import {
  captureReplay,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

/**
 * Frames run at rest either side of the press.
 *
 * Nothing is read across them — the phase and the chain step are read on the
 * frame the press itself ran. They are what makes the recording read as a board
 * sitting still, taking one swap, and resolving it, rather than as a board that
 * was already mid-exchange.
 */
const REST_FRAMES = 8;

let h: Harness;

/** The selected cell: the jade the swap carries down into row 3. */
const SELECTED: CellRef = { col: 3, row: 2 };

/** The cursor's cell, orthogonally adjacent to it and one row below. */
const NEIGHBOR: CellRef = { col: 3, row: 3 };

/**
 * Three jades over the run-free filler, arranged so that exchanging
 * {@link SELECTED} with {@link NEIGHBOR} completes a horizontal run of jade at
 * `(2,3)`, `(3,3)`, `(4,3)`.
 *
 * Nothing about the shape is a spec figure — R3 asks only that the produced
 * board carry a maximal run — so the fixture asserts the two properties it
 * needs instead of resting on the arithmetic: the posed board carries no run of
 * its own, and R1 and R3 accept the swap.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: 2, row: 3, token: "J0" },
  { col: 4, row: 3, token: "J0" },
  { col: 3, row: 2, token: "J0" },
];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("requests the swap when confirm fires on a neighbor of the selection", async () => {
  // The two properties the scenario rests on, read off the WRITTEN board rather
  // than off the build: a quiet board, and one swap the move rules accept.
  const rows = quietRowsWithEscape(SCENARIO);
  assertEqual(maximalRuns(rows).length, 0, "runs on the posed board");
  assertTrue(
    swapIsLegal(rows, SELECTED, NEIGHBOR),
    "R1 and R3 accept the scenario's swap",
  );

  /** Pose the board afresh and put the selection and the cursor in place. */
  const arrange = async (): Promise<void> => {
    await loadBoard(h, rows);
    await h.debug.setSelection(SELECTED.col, SELECTED.row);
    await h.debug.setCursor(NEIGHBOR.col, NEIGHBOR.row);
  };

  await arrange();
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the scenario is posed on");
  assertEqual(before.phase, "idle", "the phase a swap may be requested from");
  assertEqual(before.chainStep, 0, "the chain step before the swap");

  // The evidence is the exchange itself, so the recording opens on the posed
  // board at rest with the selection standing, covers the frame the key is read
  // on, and runs on far enough for the swap and the clear it opens to be
  // watchable.
  await captureReplay(h, "swap", async () => {
    await h.advance(REST_FRAMES);

    // `Enter` is the first key specs/controls.md binds to `confirm`, and the
    // binding table is fixed for a build of every engine.
    await h.tapAction("confirm");

    // The swap was requested, the acceptance path took it, and step 1 resolved
    // on the spot — which is what specs/rules.md says an accepted swap does.
    // Read on the frame the press ran, before a later frame carries the chain
    // past it.
    const after = await h.snapshot();
    assertEqual(
      after.phase,
      "resolving",
      "the phase after confirm on a neighbor",
    );
    assertEqual(after.chainStep, 1, "the chain step the accepted swap opened");
    assertNull(after.selection, "the selection after the swap was requested");

    // Frames past the request, so the recording carries the exchange rather
    // than ending on the frame that asked for it.
    await h.advance(REST_FRAMES);
  });

  // "Each key listed for an action fires that action on its own", so the
  // alternate binding requests the same swap on a freshly posed board.
  const alternate = BINDINGS.confirm[1];
  await arrange();
  await h.tap(alternate);
  const second = await h.snapshot();
  assertEqual(second.phase, "resolving", `the phase after ${alternate}`);
  assertEqual(second.chainStep, 1, `the chain step after ${alternate}`);
  assertNull(second.selection, `the selection after ${alternate}`);
});
