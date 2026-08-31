// levels/continue-opens-next-level — CONTINUE is what opens the next level, and
// it opens it on a board dealt fresh for it.
//
// specs/rules.md: "Choosing `CONTINUE` there opens the next level: `level` rises
// by `1`, `levelScore`, `bestChain`, and `bestMove` return to `0`, a fresh
// opening board is dealt, and `screen` returns to `playing`."
// specs/instrumentation.md poses that choice as `continueLevel`, and adds what
// the arrival looks like: "`menuIndex` at `0`, no selection, no offer and no
// refusal."
//
// WHY IT IS SEPARATE FROM REACHING THE SCREEN. Meeting the target only raises
// `levelclear` — `levels/level-advances` reads that, and reads that the level
// does NOT rise there. Everything the transition actually does happens on this
// choice, so a build that raises the screen and then strands the player on it
// stops the round at level 1, which is what the `broken` cap says.
//
// HOW A FRESHLY DEALT BOARD IS TOLD FROM THE ONE THE LEVEL WAS WON ON.
// specs/rules.md gives an opening board two properties — it holds no run under
// R4, and at least one legal swap exists on it — and says "Every gem on it is
// `plain` at strain `0`". The board a chain leaves cannot be that: R7 raises the
// strain of every gem outside the clear set that is orthogonally adjacent to it,
// and the step that ended the chain seeded nothing, so those strained survivors
// are still standing. So the board is read twice, once at the level-clear screen
// and once after the choice, and the strain that is on the first and not on the
// second is the deal.
//
// The run and the strain are read with this project's own predicates over the
// notation the board came back in. `legalSwap` is read off the BUILD, because
// specs/rules.md words the opening board's second property as the existence of a
// legal swap and specs/instrumentation.md derives that very field from it; what
// the field ought to answer on an arbitrary board is
// `levels/legal-swap-derived`'s point.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`:
// what that figure ought to be is `levels/level-target-derived`'s point, and this
// one only needs a level that finishes.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertTrue,
} from "../assert";
import {
  allPlainAndClean,
  hasAnyRun,
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
  swapAndStep,
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

it("raises the level, zeroes the level score and deals a fresh board", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    "the scenario's exchange is legal under R1 and R3",
  );

  await loadBoard(h, posed);
  await h.debug.setLevel(1);

  // The target the round is playing to, read rather than reckoned.
  const opened = await h.snapshot();
  assertEqual(opened.level, 1, "the level the round stands at");
  assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
  await h.debug.setLevelScore(opened.levelTarget);

  const next = await captureReplay(h, "next", async () => {
    const first = await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
    assertEqual(first.phase, "resolving", "the phase step 1 resolved into");

    const settled = await resolveChain(h);
    assertTrue(settled.settled, "the chain returned to idle within the cap");
    assertEqual(
      settled.snapshot.screen,
      "levelclear",
      "the screen the met target opened, which CONTINUE is offered from",
    );

    // The board the level was won on carries R7's strain, which is what makes
    // the reading after the choice say a board was dealt rather than kept.
    assertEqual(
      allPlainAndClean(await h.board()),
      false,
      "every gem plain at strain 0 on the board the level was won on",
    );

    await h.debug.continueLevel();
    return h.snapshot();
  });

  assertEqual(next.level, 2, "the level CONTINUE opened");
  assertEqual(next.levelScore, 0, "the level score the new level opens at");
  assertEqual(next.screen, "playing", "the screen CONTINUE returns to");
  assertEqual(next.menuIndex, 0, "the highlighted item on arriving");
  assertNull(next.selection, "the selection the new level opens with");
  assertNull(next.offer, "the offer the new level opens with");
  assertNull(next.refusal, "the refusal the new level opens with");

  // And the board it opened on is an opening board: no run stands on it, a legal
  // swap exists on it, and every gem is plain at strain 0 — which the board the
  // level was won on, read above, is not.
  const board = await h.board();
  assertEqual(
    hasAnyRun(board),
    false,
    "a maximal run on the new level's board",
  );
  assertEqual(
    next.legalSwap,
    true,
    "a legal swap on the new level's board, as the round reports it",
  );
  assertEqual(
    allPlainAndClean(board),
    true,
    "every gem plain at strain 0, as an opening board's are",
  );
});
