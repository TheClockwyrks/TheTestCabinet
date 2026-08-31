// Facet — moves/refusal-expires: a refusal clears after REFUSAL_SECONDS.
//
// "A chain step" in specs/rules.md gives the mark a life as well as a place: the
// refusal "stands for `REFUSAL_SECONDS` (`0.3`) of game time and then clears". A
// mark that never clears leaves the board wearing an answer to a move the player
// made long ago; one that clears on the next frame is a flash nobody sees. Both
// are builds that carry the mark but not the rule, and both pass
// `moves/refusal-marked` — so the lifetime is read on its own here.
//
// HOW THE THRESHOLD IS APPROACHED. The clock is game time, not frames, so the
// drive is stated in the two figures the specification's own number brackets:
// `REFUSAL_FRAMES_BEFORE` sums to `0.296875` s, just inside `0.3`, and one frame
// more sums to `0.3125` s, just past it whichever way a build compares. The
// reading is taken at each. The elapsed game time is then read back off the
// build's own `simTime` and checked against `REFUSAL_SECONDS`, so a build whose
// clock ran differently than the drive intended fails on the arrangement rather
// than being credited with an answer to a question it was never asked.
//
// WHICH CELLS the mark names is `moves/refusal-marked`'s item and is not read
// here: what this one reads is only that a mark stands, and then that none does.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLength,
  assertLessThan,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  maximalRuns,
  quietRowsWithEscape,
  swapWouldMatch,
  type BoardRows,
  type CellRef,
} from "../board";
import {
  REFUSAL_FRAMES_AFTER,
  REFUSAL_FRAMES_BEFORE,
  REFUSAL_SECONDS,
} from "../constants";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** The run-free filler: nothing on it makes a run, so a swap on it is refused. */
const ROWS: BoardRows = quietRowsWithEscape([]);

/** The pair named in the request: adjacent, both plain, and unproductive. */
const PAIR: { a: CellRef; b: CellRef } = {
  a: { col: 5, row: 2 },
  b: { col: 5, row: 3 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the refusal until REFUSAL_SECONDS of game time has passed", async () => {
  // The fixture: a request R1 admits and R3 refuses.
  assertTrue(areAdjacent(PAIR.a, PAIR.b), "the pair is orthogonally adjacent");
  assertLength(maximalRuns(ROWS), 0, "runs on the posed board");
  assertTrue(
    !swapWouldMatch(ROWS, PAIR.a, PAIR.b),
    "the exchange makes NO maximal run",
  );

  await loadBoard(h, ROWS);
  const opened = await swap(h, PAIR.a, PAIR.b);
  assertNotNull(opened.refusal, "refusal at the moment of the request");

  const readings = await captureReplay(h, "refusal", async () => {
    await h.advance(REFUSAL_FRAMES_BEFORE);
    const standing = await h.snapshot();
    await h.advance(REFUSAL_FRAMES_AFTER - REFUSAL_FRAMES_BEFORE);
    const gone = await h.snapshot();
    return { standing, gone };
  });

  // The drive really did straddle the threshold, measured on the build's own
  // clock rather than assumed from the frame count.
  assertLessThan(
    readings.standing.simTime - opened.simTime,
    REFUSAL_SECONDS,
    "game time elapsed at the first reading",
  );
  assertGreaterThan(
    readings.gone.simTime - opened.simTime,
    REFUSAL_SECONDS,
    "game time elapsed at the second reading",
  );

  assertNotNull(readings.standing.refusal, "refusal before REFUSAL_SECONDS");
  assertNull(readings.gone.refusal, "refusal after REFUSAL_SECONDS");
});
