// Facet — instrumentation/seeded-determinism-same-seed: one seed deals one
// board, on every load.
//
// WHY THIS IS A POINT. specs/instrumentation.md rests the whole automation
// surface on it — "Seeded randomness. Any randomness the game uses runs off a
// generator seeded from `state.rngState`, and it keeps its whole generator state
// in that field, so reseeding and replaying the same calls reproduces the same
// result exactly. The deal of an opening board and the refill in R9 draw from
// it" — and closes the section with "Given the same seed and the same sequence
// of calls and elapsed game time, the game reaches the same state every time."
// A build that reached for `Math.random`, or that kept part of its generator
// outside `rngState`, deals a different board every run: every scenario written
// against a dealt board becomes a coin toss, and a failing run cannot be
// reproduced to be looked at.
//
// THE OTHER DIRECTION IS ITS OWN POINT. That a DIFFERENT seed deals a different
// board is `instrumentation/seeded-determinism-different-seed`. A build that
// ignores the seed entirely and deals one fixed board passes this point and
// fails that one, which is exactly the separation two points buy: reproducible
// and seeded are two properties, and a build can hold one without the other.
//
// WHY A SECOND INSTANCE. Replaying the same seed inside one page proves only
// that the deal is a function of something that was reset. A build holding a
// counter in a module-level variable, or seeding itself off the clock and then
// merely reporting `rngState`, passes that and still deals differently on a
// fresh load. So the replay is driven in a second, independently loaded
// instance, and the two deals are compared cell for cell.
//
// WHAT A CELL IS COMPARED BY, AND WHY `fell` IS NOT AMONG IT. A deal is compared
// through the notation, which writes a cell's kind, its cut and its strain — the
// three the seeded draw decides. It writes no `fell`, and deliberately:
// specs/rules.md hands a dealt gem's figure to the build, at or above the floor
// of `row + 1`, so two deals from one seed are entitled to agree on it and
// nothing requires them to. A build that staggered its deal off a source of its
// own would be conformant, and comparing the figure would fail it for a freedom
// the specification granted. The floor itself is `board/opening-falls-in`'s.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. What an opening board must LOOK like —
// that it holds no run under R4 and carries a legal swap is `board/opening-*` —
// and what `reset` restores, which is `instrumentation/reset-restores`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { assertBoardEquals, renderBoard } from "../board";
import {
  captureStill,
  createHarness,
  failSurface,
  startRound,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The seed both deals are made from.
 *
 * The specification fixes no seed but `DEFAULT_SEED`, and this point is about
 * one seed reaching one board rather than about which seed, so any value
 * answers it.
 */
const SEED = 12345;

/** What a deal is compared as: the board, and the generator state it left. */
interface Deal {
  rows: string[];
  rngState: number;
}

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

/** Read the deal `seed` makes, off a fresh instance of the build. */
async function dealFresh(seed: number): Promise<Deal> {
  const fresh = await createHarness({ seed });
  try {
    if (fresh.surfaceFault !== null) failSurface(fresh.surfaceFault);
    await fresh.debug.reset({ seed });
    const opened = await startRound(fresh);
    return { rows: renderBoard(opened), rngState: opened.rngState };
  } finally {
    await fresh.dispose();
  }
}

beforeEach(async () => {
  h = await createHarness({ seed: SEED });
});

afterEach(async () => {
  await h.dispose();
});

it("deals the same opening board from the same seed, in a fresh instance", async () => {
  requireSurface();
  // A round from a known deal is a `reset` carrying a seed followed by the deal
  // itself, which is what the harness's `startRound` runs: `dealBoard` "deals a
  // fresh opening board through the game's own code, drawing from `rngState`".
  await h.debug.reset({ seed: SEED });
  const opened = await startRound(h);

  // The same seed, in a build that was loaded and initialized separately.
  const again = await dealFresh(SEED);

  assertBoardEquals(
    again.rows,
    renderBoard(opened),
    `the deal from seed ${SEED}`,
  );
  assertEqual(
    again.rngState,
    opened.rngState,
    `the rngState the deal from seed ${SEED} left`,
  );

  // The board the comparison was made over.
  await h.advance(1);
  await captureStill(h, "deal");
});
