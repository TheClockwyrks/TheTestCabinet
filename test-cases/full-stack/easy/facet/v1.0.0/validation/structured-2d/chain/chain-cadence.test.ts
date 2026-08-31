// chain/chain-cadence — a step holds the board for its own STEP_HOLD.
//
// specs/rules.md fixes the cadence against a figure the step itself decides:
// "`stepTimer` holds `0` while `phase` is not `resolving`, and accumulates game
// time while it is, counting from `0` at the moment a step resolves ... When
// `stepTimer` reaches `STEP_HOLD` it returns to `0` and the board is read
// again." `STEP_HOLD` is `LAND_AT + STEP_SECONDS`, and `LAND_AT` runs off the
// depth of the shattering and the height of the fall, so two steps of one chain
// rarely hold for the same time. A chain is therefore not a burst: each step's
// result stands on the board for its own span, which is the whole of what a
// player sees of it, and the next step is read only when that time is spent.
//
// TWO FAULTS ARE READ HERE, AND THEY ARE OPPOSITE ONES. A build that resolves
// its whole chain in one frame shows the player nothing, and shows here as a
// `chainStep` past 1 before the hold has run. A build whose timer never fires
// leaves the chain stuck, and shows as a `chainStep` still at 1 after it has.
//
// THE HOLD IS READ FROM THE BUILD RATHER THAN RECKONED. `snapshot().stepHold`
// reports the figure the step in progress is being held for, and that figure is
// what this check waits out. What the figure OUGHT to be is
// `chain/step-hold-derived`'s point, so a build that computes it wrongly should
// fail there alone rather than failing here as well for the same fault — and a
// build that computes it correctly is held to the span it named, whatever that
// span is. That the span ANSWERS to the fall at all is
// `chain/step-waits-for-the-fall`'s.
//
// THE BOARD IS READ ON EVERY FRAME OF THE HOLD, not only at its end: the
// specification says the board is read AGAIN when the timer fires, so nothing
// may move on the cells in between.
//
// THE SCHEDULE STAYS CLEAR OF THE EXACT BOUNDARY TICK, which "reaches" leaves
// open. `framesShortOf` gives the most frames of the suite's clock that fit
// STRICTLY inside what is left of the hold, so a build comparing `>=` and one
// comparing `>` both still hold the board on the last of them; `framesPast`
// gives the fewest that carry beyond it with a whole frame to spare, so both
// have fired by the reading after. That overshoot is at most two frames,
// `0.03125` s, far short of the `0.3` s that is the SHORTEST hold any step can
// have — `lastWaves` is `0` when the clear set is its seed alone, and `lastFall`
// is at least `1` because a step that cleared anything refills at least one cell
// from above row `0` — so the drive past the boundary cannot reach a second one.
//
// THE READING AFTER THE BOUNDARY IS A BOUND, NOT A VALUE. "When `stepTimer`
// reaches `STEP_HOLD` it returns to `0`" fixes that the timer went back; how
// much of the overrun a build carries into the next step is its own arithmetic,
// so what is read is that the timer is below the hold rather than at a figure.
//
// The world is LIVE under this engine, so a pose returns nothing and takes
// effect at the call; a reading is synchronous. Only the frame drive is awaited.
// The scenario itself is the specification's, and reads the same under all three
// engines.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
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
  framesPast,
  framesShortOf,
  loadBoard,
  swapAndStep,
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
 * hold with nothing to fire into. They are no run while the ruby at (4,4) parts
 * them, and a column of three once step 1 has removed it and R9 has closed the
 * gap.
 */
const STEP_TWO: PlacedToken[] = [
  { col: 4, row: 3, token: "J0" },
  { col: 4, row: 5, token: "J0" },
  { col: 4, row: 6, token: "J0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the board and the chain until stepTimer reaches the hold it reports", async () => {
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

  loadBoard(h, posed);
  // Through the swap animation and into step 1, which is where the hold begins.
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.chainStep, 1, "the chain step the swap resolved into");
  assertEqual(first.phase, "resolving", "the phase step 1 resolved in");

  // The step's own figure, and how much of it the drive into step 1 already
  // spent. Everything below is counted against these two rather than against a
  // constant, because a step's hold is the step's own.
  const hold = first.stepHold;
  assertGreaterThan(
    hold,
    first.stepTimer,
    "the hold step 1 reports, against the time already spent in it",
  );
  const held = h.board();

  await captureReplay(h, "cadence", async () => {
    // Every frame that fits strictly inside what is left of the hold, one at a
    // time. The board must not move on any of them, the chain must not advance,
    // and the timer must still be short of the hold the step named.
    const inside = framesShortOf(hold - first.stepTimer);
    for (let frame = 1; frame <= inside; frame += 1) {
      await h.advance(1);
      const during = h.snapshot();
      assertEqual(during.chainStep, 1, `chainStep after ${frame} frames`);
      assertEqual(during.phase, "resolving", `phase after ${frame} frames`);
      assertLessThan(during.stepTimer, hold, `stepTimer after ${frame} frames`);
      assertBoardEquals(h.board(), held, `the board after ${frame} frames`);
    }

    // And past the hold: the fewest frames that carry beyond it with a whole
    // frame to spare, so a build firing at `>=` and one firing at `>` read
    // alike, and the overshoot is far too small to reach a second boundary.
    const before = h.snapshot();
    await h.advance(framesPast(Math.max(0, hold - before.stepTimer)));
  });

  const after = h.snapshot();
  assertEqual(after.chainStep, 2, "chainStep once the step's time was spent");
  assertEqual(after.phase, "resolving", "phase once the step's time was spent");
  assertLessThan(after.stepTimer, hold, "stepTimer after the boundary");
});
