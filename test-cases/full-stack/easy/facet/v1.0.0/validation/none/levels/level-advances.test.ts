// levels/level-advances — reaching the level's target ends the level, and ends
// it on the board it was won on.
//
// specs/rules.md: "When `phase` returns to `idle` and `levelScore` is at or past
// the target, the level is over: `screen` becomes `levelclear` with `menuIndex`
// at `0`. The board stands as the chain left it, and `level`, `levelScore`,
// `bestChain`, and `bestMove` hold what the level left them at, which is what
// that screen reports." Five readings at one moment, and this check takes all
// five off the settled state.
//
// THE MOMENT IS THE END OF A CHAIN, NOT THE SCORING. `levelScore` is posed at the
// target BEFORE the swap, so it is already there while the chain runs; nothing
// may happen until `phase` returns to `idle`, and what this check reads is the
// state that return left behind. specs/instrumentation.md says as much of
// `setLevelScore`: "a level score posed at or past the target advances the level
// as the next chain settles."
//
// WHAT REACHING THE TARGET DOES NOT DO. It does not raise `level` and it does not
// deal a board. specs/rules.md gives both of those to `CONTINUE`, which is
// `levels/continue-opens-next-level`'s point. So the level standing where it was
// is as much the rule as the screen is, and a build that ran the whole level
// transition on the settle fails here rather than passing on the screen alone.
//
// HOW THE BOARD THE CHAIN LEFT IS TOLD FROM A FRESH DEAL. specs/rules.md gives an
// opening board two properties — no run under R4, and at least one legal swap —
// and says "Every gem on it is `plain` at strain `0`". The board a chain leaves
// cannot be that: R7 raises the strain of every gem outside the clear set that is
// orthogonally adjacent to it, those gems are by definition survivors, and no
// later step clears them because the step that ends the chain seeds nothing at
// all. So a settled board with strain somewhere on it is the board the chain
// left, and one with none anywhere was dealt again.
//
// That property is read with this project's own predicate over the notation the
// board came back in, never off the build's derived `legalSwap` — what that field
// reports is `levels/legal-swap-derived`'s question, and this point must not rest
// on the build's answer to it.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`.
// specs/rules.md states the rule against "the target", and `levelTarget` is the
// figure the round is playing to; what that figure OUGHT to be is
// `levels/level-target-derived`'s point. Posing the level score at the target the
// round reports leaves this point deciding the rule alone, so a build that
// derives its target wrongly owes that point and not this one as well.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
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

/**
 * Three rubies one exchange short of a run in row 4.
 *
 * The scenario is planted in the middle of the board and clear of the bottom-left
 * corner the filler's spare legal swap sits in, so the chain it starts neither
 * takes that swap away nor depends on it. The clear it makes is surrounded by
 * filler gems, which is what puts R7 strain on the settled board and lets the
 * reading below tell that board from a fresh deal.
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

afterEach(async () => {
  await h.dispose();
});

it("opens the level-clear screen on the board the level was won on", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  // The fixture is what it claims before the build is asked anything: a board
  // resting with no run on it, carrying the one exchange the scenario drives.
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

  const before = await h.snapshot();
  assertEqual(
    before.levelScore,
    opened.levelTarget,
    "the level score posed at the target the round reports",
  );
  assertEqual(before.screen, "playing", "the screen before the chain");

  const settled = await captureReplay(h, "levelup", async () => {
    // Through the swap animation to step 1's result, and then to rest: the
    // level condition is evaluated at the return to `idle` and at no earlier
    // moment, so the chain is driven all the way before anything is read.
    const first = await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
    assertEqual(first.phase, "resolving", "the phase step 1 resolved into");
    return resolveChain(h);
  });

  assertTrue(settled.settled, "the chain returned to idle within the cap");
  const after = settled.snapshot;

  assertEqual(after.screen, "levelclear", "the screen the met target opened");
  assertEqual(after.menuIndex, 0, "the highlighted item on arriving");

  // The level stands where it was: raising it is CONTINUE's, not the settle's.
  assertEqual(after.level, 1, "the level the met target left standing");
  assertGreaterThanOrEqual(
    after.levelScore,
    opened.levelTarget,
    "the level score, which the met target does not zero",
  );

  // And the board is the one the chain left: R7 put strain on the survivors
  // around the clear, which an opening board carries nowhere.
  assertEqual(
    allPlainAndClean(await h.board()),
    false,
    "every gem plain at strain 0, which only a freshly dealt board is",
  );
});
