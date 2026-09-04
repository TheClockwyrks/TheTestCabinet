// levels/gameover-no-legal-swap — the round ends when a chain settles onto a
// board with no move left on it.
//
// specs/rules.md, after the level rule: "Otherwise, when `phase` returns to
// `idle` and no legal swap exists on the board, `screen` becomes `gameover`." The
// end of a round is therefore a thing that happens at ONE moment — the return to
// `idle` — and it is decided by the board standing at that moment, not by
// anything the player did.
//
// HOW THE DEAD BOARD IS PUT UNDER THE SETTLING CHAIN. A chain is opened by an
// ordinary accepted swap on an ordinary live board, and then, while the step is
// still holding, every cell is rewritten to the board specs/rules.md's end
// condition describes: no run stands on it, no prism sits on it, and exchanging
// any two orthogonally adjacent cells leaves every line still short of three of
// one kind, so R3 refuses every swap R1 would allow. specs/instrumentation.md
// says `setGem` leaves "every other cell, the screen, the phase, and the
// selection" where they were, so the step keeps holding and reads this board
// when its hold is up.
//
// That is what makes the check decide THIS point rather than the seeded refill.
// Letting a chain run itself out on a board that happens to go dead leaves the
// question to R9's random draw, which would answer differently for two builds
// that are both right; posing the dead board outright asks every build the same
// question.
//
// THE LEVEL RULE MUST NOT BE WHAT ANSWERS. It is stated first and takes
// precedence, so the round's `levelScore` is checked to be short of level 1's
// target before the step settles — the only condition left for the return to
// `idle` to meet is the empty board of moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { LEVEL_TARGET_STEP } from "../constants";
import {
  assertBoardEquals,
  deadBoard,
  hasAnyRun,
  legalSwapExists,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureReplay,
  createHarness,
  loadBoard,
  swapAndStep,
  writeBoard,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The exchange that drops the third ruby into row 4 and makes the run. */
const RUN_SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 3, row: 4 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the screen to gameover when the settled board carries no legal swap", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  const dead = deadBoard();
  // Both boards are what they claim before the build is asked anything.
  assertEqual(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    true,
    "the scenario's exchange is legal under R1 and R3",
  );
  assertEqual(
    legalSwapExists(posed),
    true,
    "a legal swap on the board the round opens on",
  );
  assertEqual(hasAnyRun(dead), false, "a maximal run on the dead board");
  assertEqual(legalSwapExists(dead), false, "a legal swap on the dead board");

  await loadBoard(h, posed);

  const ended = await captureReplay(h, "gameover", async () => {
    const first = await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
    assertEqual(first.phase, "resolving", "the phase step 1 resolved into");
    assertEqual(first.screen, "playing", "the screen while the chain runs");

    // The board goes dead under the running step.
    await writeBoard(h, dead);
    const held = await h.snapshot();
    assertEqual(held.phase, "resolving", "the phase setGem left standing");
    assertEqual(held.screen, "playing", "the screen setGem left standing");
    assertEqual(held.level, 1, "the level the round is on");
    assertLessThan(
      held.levelScore,
      LEVEL_TARGET_STEP,
      "the level score against level 1's target",
    );

    // One step's worth of game time: the board is read again, seeds nothing
    // under R5, and the chain ends.
    await advanceStep(h);
    return h.snapshot();
  });

  assertEqual(ended.phase, "idle", "the phase the chain ended in");
  assertEqual(
    ended.screen,
    "gameover",
    "the screen the settled dead board left",
  );

  // Nothing was dealt over it: the round ended on the board it was given, which
  // is the board the end condition was decided from.
  assertBoardEquals(await h.board(), dead, "the board the round ended on");
});
