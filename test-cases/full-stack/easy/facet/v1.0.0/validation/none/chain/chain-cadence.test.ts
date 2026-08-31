// chain/chain-cadence — a step holds the board for STEP_SECONDS.
//
// specs/rules.md fixes the cadence exactly: "`stepTimer` holds `0` while `phase`
// is `idle`, and accumulates game time while `phase` is `resolving`. When
// `stepTimer` reaches `STEP_SECONDS` it returns to `0` and the board is read
// again." So a chain is not a burst — each step's result stands on the board for
// a quarter of a second of game time, which is the whole of what a player sees
// of it, and the next step is read only when that time has been spent.
//
// TWO FAULTS ARE READ HERE, AND THEY ARE OPPOSITE ONES. A build that resolves
// its whole chain in one frame shows the player nothing, and shows here as a
// `chainStep` past 1 before the timer has run. A build whose timer never fires
// leaves the chain stuck, and shows as a `chainStep` still at 1 after it has.
//
// The board is read on every frame of the hold, not only at its end: the
// specification says the board is read AGAIN when the timer fires, so nothing may
// move on the cells in between. `TICK_S` is 1/64 s, chosen in `constants.ts`
// because sixteen of them sum to exactly `STEP_SECONDS` with no floating-point
// residue — so 15 frames is 0.234375 s, strictly inside the hold under any
// arithmetic, and 17 is 0.265625 s, past it whether the build compares `>=` or
// `>`.
//
// Everything crosses into the page, so every reading is awaited. The
// scenario itself is the specification's, and reads the same under all three
// engines.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
import { FRAMES_PER_STEP, STEP_SECONDS, TICK_S } from "../constants";
import {
  assertBoardEquals,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** Step 1's run across row 4, and the amethyst the swap trades out of it. */
const STEP_ONE: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

/**
 * The jades step 2 clears. They make the chain run on, which is what gives this
 * check a second step to time: a chain that ended after step 1 would leave the
 * timer with nothing to fire into.
 */
const STEP_TWO: PlacedToken[] = [
  { col: 4, row: 3, token: "J0" },
  { col: 4, row: 5, token: "J0" },
  { col: 4, row: 6, token: "J0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/**
 * Frames held and read one at a time, all of them strictly inside the step.
 *
 * `FRAMES_PER_STEP` (16) is exactly `STEP_SECONDS`, so one fewer is the last
 * frame the board must not have moved on, at 0.234375 s.
 */
const FRAMES_INSIDE = FRAMES_PER_STEP - 1;

/** Frames driven after the hold, carrying the timer past `STEP_SECONDS`. */
const FRAMES_PAST = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the board and the chain until stepTimer reaches STEP_SECONDS", async () => {
  const posed = quietRowsWithEscape([...STEP_ONE, ...STEP_TWO]);
  // The fixture's own guarantees, so a failure below is the build's: the posed
  // board carries no run, the swap is one R1 and R3 both accept, and the only
  // run it makes is step 1's.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(
    maximalRuns(swapped(posed, SWAP_A, SWAP_B)),
    1,
    "maximal runs the swap makes",
  );

  await loadBoard(h, posed);
  const first = await swap(h, SWAP_A, SWAP_B);
  // The swap resolved step 1 on the spot, and no game time has passed since, so
  // the timer this step is measured against starts at nothing.
  assertEqual(first.chainStep, 1, "chainStep the accepted swap opened");
  assertEqual(first.stepTimer, 0, "stepTimer at the moment the swap resolved");
  const held = await h.board();

  await captureReplay(h, "cadence", async () => {
    // Every frame of the hold, one at a time. The board must not move on any of
    // them, the chain must not advance, and the timer must carry exactly the
    // game time that has been handed to it.
    for (let frame = 1; frame <= FRAMES_INSIDE; frame += 1) {
      await h.advance(1);
      const during = await h.snapshot();
      assertEqual(during.chainStep, 1, `chainStep after ${frame} frames`);
      assertEqual(during.phase, "resolving", `phase after ${frame} frames`);
      assertCloseTo(
        during.stepTimer,
        frame * TICK_S,
        4,
        `stepTimer after ${frame} frames`,
      );
      assertBoardEquals(await h.board(), held, `the board after ${frame} frames`);
    }

    // And past the step: 17 frames is 0.265625 s, past `STEP_SECONDS` whether
    // the build fires at `>=` or at `>`, and well short of a second boundary.
    await h.advance(FRAMES_PAST);
  });

  const after = await h.snapshot();
  assertEqual(after.chainStep, 2, "chainStep once the step's time was spent");
  // "When `stepTimer` reaches `STEP_SECONDS` it returns to `0`" — how much of the
  // overrun a build carries back into the next step is its own arithmetic, so
  // what is read is that the timer went back rather than kept counting.
  assertLessThan(after.stepTimer, STEP_SECONDS, "stepTimer after the boundary");
});
