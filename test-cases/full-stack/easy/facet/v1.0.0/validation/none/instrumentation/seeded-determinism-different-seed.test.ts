// Facet — instrumentation/seeded-determinism-different-seed: the seed is what
// the deal is a function OF.
//
// specs/instrumentation.md: "`options.seed` seeds `rngState`", and "Any
// randomness the game uses runs off a generator seeded from `state.rngState`
// … The deal of an opening board and the refill in R9 draw from it."
// specs/rules.md says the opening board's kinds are "drawn from `GEM_KINDS` off
// the game's seeded random source".
//
// WHY IT IS SEPARATE FROM REPRODUCIBILITY. A build that deals ONE fixed board,
// ignoring `rngState` altogether, is perfectly reproducible: it passes
// `instrumentation/seeded-determinism-same-seed` on every seed. What it has
// lost is the thing that makes a seed useful — every scenario a check writes
// against a seed reads the same board, and `reset({ seed })` decides nothing.
// So the two directions are two points, and a build can hold one without the
// other.
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
// and what `reset` restores, which is
// `instrumentation/reset-restores-every-field`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual } from "../assert";
import { renderBoard } from "../board";
import {
  captureStill,
  createHarness,
  failSurface,
  startRound,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * Two seeds, adjacent on purpose.
 *
 * The specification fixes no seed but `DEFAULT_SEED`, so any pair answers the
 * question; neighbors answer a sharper one. A build that quantized the seed,
 * or that used only its high bits, reproduces its own deal perfectly and still
 * deals `SEED` and `OTHER_SEED` identically.
 */
const SEED = 12345;
const OTHER_SEED = 12346;

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

it("deals a different opening board from a different seed", async () => {
  requireSurface();
  await h.debug.reset({ seed: SEED });
  const mine = renderBoard(await startRound(h));

  const other = await dealFresh(OTHER_SEED);

  // Sixty-four cells drawn from seven kinds: two seeds that agreed here would be
  // one seed, and `reset({ seed })` would decide nothing.
  assertNotEqual(
    other.rows.join(" / "),
    mine.join(" / "),
    `the deal from seed ${OTHER_SEED}, against the deal from seed ${SEED}`,
  );

  // The board one of the two seeds dealt, as the picture the comparison was
  // made over.
  await h.advance(1);
  await captureStill(h, "deal");
});
