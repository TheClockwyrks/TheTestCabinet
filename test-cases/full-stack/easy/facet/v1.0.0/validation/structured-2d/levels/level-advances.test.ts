// levels/level-advances — reaching the level target opens the next level on a
// board dealt fresh for it.
//
// specs/rules.md: "When `phase` returns to `idle` and `levelScore` is at or past
// the target, `level` rises by `1`, `levelScore` returns to `0`, and a fresh
// opening board is dealt." Four things at one moment, and this check reads all
// four off the settled state.
//
// THE MOMENT IS THE END OF A CHAIN, NOT THE SCORING. `levelScore` is posed at the
// target BEFORE the swap, so it is already there while the chain runs; nothing
// may happen until `phase` returns to `idle`, and what this check reads is the
// state that return left behind. `specs/instrumentation.md` says as much of
// `setLevelScore`: "a level score posed at or past the target advances the level
// as the next chain settles."
//
// HOW A FRESHLY DEALT BOARD IS TOLD FROM THE ONE THE CHAIN LEFT. specs/rules.md
// gives an opening board two properties — no run under R4, and at least one legal
// swap — and says "Every gem on it is `plain` at strain `0`". The board a chain
// leaves cannot be that: R7 raises the strain of every gem outside the clear set
// that is orthogonally adjacent to it, those gems are by definition survivors, and
// no later step clears them because the step that ends the chain seeds nothing at
// all. So a settled board with no strain anywhere on it is a board that was dealt
// again, and one carrying strain is the board the chain left standing.
//
// The three properties are read with this project's own predicates over the
// notation the board came back in, not off the build's derived `legalSwap` — what
// that field reports is `levels/legal-swap-derived`'s question, and this point
// must not rest on the build's answer to it.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`.
// specs/rules.md states the rule against "the target", and `levelTarget` is the
// figure the round is playing to; what that figure OUGHT to be is
// `levels/level-target-derived`'s point. Posing the level score at the target the
// round reports leaves this point deciding the rule alone, so a build that
// derives its target wrongly owes that point and not this one as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  allPlainAndClean,
  hasAnyRun,
  legalSwapExists,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resolveChain,
  swap,
  type Harness,
} from "../harness";

/**
 * Three rubies one exchange short of a run in row 4.
 *
 * The scenario is planted in the middle of the board and clear of the bottom-left
 * corner the filler's spare legal swap sits in, so the chain it starts neither
 * takes that swap away nor depends on it.
 */
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

afterEach(() => {
  h.dispose();
});

it("raises the level, zeroes the level score and deals a fresh board", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  // The fixture is what it claims before the build is asked anything: a board
  // resting with no run on it, carrying the one exchange the scenario drives.
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    "the scenario's exchange is legal under R1 and R3",
  );

  loadBoard(h, posed);
  h.debug.setLevel(1);

  // The target the round is playing to, read rather than reckoned.
  const opened = h.snapshot();
  assertEqual(opened.level, 1, "the level the round stands at");
  assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
  h.debug.setLevelScore(opened.levelTarget);

  const before = h.snapshot();
  assertEqual(
    before.levelScore,
    opened.levelTarget,
    "the level score posed at the target the round reports",
  );
  assertEqual(before.screen, "playing", "the screen before the chain");

  const settled = await captureReplay(h, "levelup", async () => {
    const first = swap(h, RUN_SWAP.a, RUN_SWAP.b);
    assertEqual(first.phase, "resolving", "the phase the accepted swap opened");
    return resolveChain(h);
  });

  assertTrue(settled.settled, "the chain returned to idle within the cap");
  const after = settled.snapshot;

  assertEqual(after.level, 2, "the level after the chain settled");
  assertEqual(after.levelScore, 0, "the level score after the level rose");
  assertEqual(after.screen, "playing", "the screen a completed level leaves");

  // And the board that was dealt for the new level is an opening board: no run
  // stands on it, a legal swap exists on it, and every gem on it is plain at
  // strain 0 — which the board the chain left behind cannot be.
  const board = h.board();
  assertEqual(
    hasAnyRun(board),
    false,
    "a maximal run on the new level's board",
  );
  assertEqual(
    legalSwapExists(board),
    true,
    "a legal swap on the new level's board",
  );
  assertEqual(
    allPlainAndClean(board),
    true,
    "every gem plain at strain 0, as an opening board's are",
  );
});
