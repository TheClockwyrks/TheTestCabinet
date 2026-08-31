// showcase-capture — record a REAL PLAY session for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s replay and stills from the reference
// implementation. It opens the build on its title screen, chooses `PLAY` with a
// real key press, and then plays the round out with a real mouse — press a gem,
// drag onto its neighbor, release — letting the build's own chain resolution,
// strain, cuts and refill produce everything on screen. Nothing is posed mid-play:
// `loadBoard` and `setGem` are never called, and the only surface operations the
// take uses are the clock (`setAutoStep`/`advance`, which nothing outside an
// engineless build owns), `reset` for the seed, and `snapshot` for reading.
//
// The player has two layers, and the split is the same one carom's driver uses.
// EXECUTION is a real pointer through `press`/`moveTo`/`lift`, the input path a
// human uses, so selection, the drag rule and the acceptance path behave exactly
// as under hand play. PLANNING is done through the CASE's own rule helpers in
// `board.ts` — `legalSwaps`, `swapped`, `runSeed`, `expandClearSet` — so each
// candidate swap is played forward under R1, R3, R4, R5 and R6 before it is made,
// and the player takes the move that clears the most. That is how a good player
// reads this board: ordinary matches prime the stones around them with strain,
// and once a corner is flawed through, the biggest move on the board is the one
// that tears it open. The escalation in the clip is the ruleset's, not a script's.
//
// The take is deterministic — the same seed replays the identical session — which
// is what lets several takes be auditioned with the recorder off and the winner
// re-run with it on.
//
// Run from the reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1500 \
//     npx vitest run --config validation/vitest.config.ts validation/showcase-capture.test.ts
//
// See `showcase/capture/README.md` for the staging steps and every knob.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureReplay,
  captureStill,
  createHarness,
  TICK_HZ,
  type Harness,
} from "./harness";
import { GRID_COLS, GRID_ROWS, MAX_STRAIN } from "./constants";
import {
  cellCenter,
  expandClearSet,
  isPrism,
  legalSwaps,
  parseRows,
  parseToken,
  runSeed,
  swapped,
  tokenAt,
  type BoardRows,
  type CellRef,
} from "./board";
import type { FacetSnapshot } from "./surface";

/* -------------------------------------------------------------------------- */
/* Knobs                                                                      */
/* -------------------------------------------------------------------------- */

/** Seeds auditioned when the driver is asked to pick a take. */
const AUDITION_SEEDS = (process.env.TCAB_SHOWCASE_SEEDS ?? "1,2,3,4,5,6")
  .split(",")
  .map((piece) => Number(piece.trim()))
  .filter((seed) => Number.isFinite(seed));

/** Tie-break rotations auditioned against each seed. */
const AUDITION_PHASES = (process.env.TCAB_SHOWCASE_PHASES ?? "0,1")
  .split(",")
  .map((piece) => Number(piece.trim()))
  .filter((phase) => Number.isFinite(phase));

/** The take that ships, when the driver is not auditioning. */
const CHOSEN_SEED = Number(process.env.TCAB_SHOWCASE_SEED ?? "NaN");
const CHOSEN_PHASE = Number(process.env.TCAB_SHOWCASE_PHASE ?? "0");

/** How long the clip runs, in seconds of game time. */
const MIN_SECONDS = Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "20");
const MAX_SECONDS = Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "26");

/** Frames of the take's clock. The harness runs a steady 64 Hz. */
const MIN_FRAMES = Math.round(MIN_SECONDS * TICK_HZ);
const MAX_FRAMES = Math.round(MAX_SECONDS * TICK_HZ);

/** The opening beat on the title screen, before `PLAY` is confirmed. */
const TITLE_FRAMES = 48;
/** The beat after the deal, before the first gem is touched. */
const DEAL_FRAMES = 40;
/** The pointer resting on a gem before it presses: a player reading the board. */
const HOVER_FRAMES = 14;
/** The press held so the selection reads before the drag leaves the cell. */
const PRESS_FRAMES = 10;
/** Frames between two readings while a chain is resolving. */
const RESOLVE_POLL = 4;
/** A guard on one chain, well past the longest a settled board can run. */
const RESOLVE_CAP = 1200;

/* -------------------------------------------------------------------------- */
/* Planning, through the case's own rules                                     */
/* -------------------------------------------------------------------------- */

/** What one candidate swap would clear, read under R5 and R6 before it is made. */
interface Candidate {
  a: CellRef;
  b: CellRef;
  /** Cells the swap's first chain step would clear. */
  cleared: number;
  /** Points that step would score, at the step-1 multiplier of 1. */
  points: number;
  /** Flawed gems inside that clear set. */
  flawed: number;
}

/**
 * R5's seed for the board a swap produces.
 *
 * The ordinary seed is the union of the maximal runs. A swap that traded a prism
 * is seeded instead by the two sentences R5 states for it, written out here
 * because they are sentences rather than a computation `board.ts` could offer.
 */
function seedFor(rows: BoardRows, a: CellRef, b: CellRef): CellRef[] {
  const after = swapped(rows, a, b);
  const aWasPrism = isPrism(rows, a);
  const bWasPrism = isPrism(rows, b);
  if (!aWasPrism && !bWasPrism) return runSeed(after);

  const every: CellRef[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) every.push({ col, row });
  }
  // Prism against prism: every cell on the board.
  if (aWasPrism && bWasPrism) return every;

  // Prism against a gem: that prism, and every gem of the traded gem's kind.
  const prismCell = aWasPrism ? b : a;
  const tradedCell = aWasPrism ? a : b;
  const traded = parseToken(tokenAt(after, tradedCell.col, tradedCell.row));
  return every.filter((cell) => {
    if (cell.col === prismCell.col && cell.row === prismCell.row) return true;
    return parseToken(tokenAt(after, cell.col, cell.row)).kind === traded.kind;
  });
}

/** Every legal swap on a board, read for what its first step would clear. */
function rank(rows: BoardRows): Candidate[] {
  const candidates = legalSwaps(rows).map(({ a, b }) => {
    const after = swapped(rows, a, b);
    const set = expandClearSet(after, seedFor(rows, a, b));
    let points = 0;
    let flawed = 0;
    for (const cell of set) {
      const strain = parseToken(tokenAt(after, cell.col, cell.row)).strain;
      points += strain >= MAX_STRAIN ? 20 : 10;
      if (strain >= MAX_STRAIN) flawed += 1;
    }
    return { a, b, cleared: set.length, points, flawed };
  });
  // Best first: the biggest tear, then the richest, then a stable reading order.
  candidates.sort(
    (x, y) =>
      y.cleared - x.cleared ||
      y.points - x.points ||
      x.a.row - y.a.row ||
      x.a.col - y.a.col ||
      x.b.row - y.b.row ||
      x.b.col - y.b.col,
  );
  return candidates;
}

/** Flawed gems standing on a board. */
function flawedCount(rows: BoardRows): number {
  return parseRows(rows).reduce(
    (total, row) =>
      total + row.filter((gem) => gem.strain >= MAX_STRAIN).length,
    0,
  );
}

/* -------------------------------------------------------------------------- */
/* One take                                                                   */
/* -------------------------------------------------------------------------- */

interface Take {
  seed: number;
  phase: number;
  frames: number;
  moves: number;
  /** Chain steps the take resolved. */
  steps: number;
  /** Gems the take cleared, summed over every step. */
  cleared: number;
  /** The largest single step of the take. */
  biggest: number;
  /** The deepest `chainStep` the take reached. */
  deepest: number;
  /** The most flawed gems standing on the board at once. */
  flawedPeak: number;
  score: number;
  /** The longest stretch with nothing clearing, in seconds. */
  maxLull: number;
  /** Whether the take ended settled, still on the board. */
  endedPlaying: boolean;
}

/**
 * Play one take out.
 *
 * `record` writes the stills; the replay is armed by the caller around this, so
 * the recorded stretch is exactly the session below and nothing else.
 */
async function runTake(
  h: Harness,
  seed: number,
  phase: number,
  record: boolean,
): Promise<Take> {
  // A previous take can end with the mouse held over a gem. Lift it before the
  // reset, so no drag leaks across and the seed replays what it replayed before.
  await h.lift();
  await h.debug.reset({ seed });
  await h.advance(1);

  const take: Take = {
    seed,
    phase,
    frames: 0,
    moves: 0,
    steps: 0,
    cleared: 0,
    biggest: 0,
    deepest: 0,
    flawedPeak: 0,
    score: 0,
    maxLull: 0,
    endedPlaying: false,
  };

  let lastClearFrame = 0;
  let deepestChainStill = 0;
  let bestTearStill = 0;
  let bestStrainStill = 0;
  let qaStills = 0;

  const advance = async (frames: number): Promise<void> => {
    await h.advance(frames);
    take.frames += frames;
    take.maxLull = Math.max(
      take.maxLull,
      (take.frames - lastClearFrame) / TICK_HZ,
    );
    if (record && process.env.TCAB_SHOWCASE_QA_STILLS === "1") {
      const want = Math.floor(take.frames / (TICK_HZ * 2));
      if (want > qaStills) {
        qaStills = want;
        await captureStill(h, `qa-${String(want).padStart(2, "0")}`);
      }
    }
  };

  // The title screen, held long enough to read, then `PLAY` taken with a real
  // key through the registered `confirm` action.
  await advance(TITLE_FRAMES);
  if (record) await captureStill(h, "title");
  await h.tapAction("confirm");
  take.frames += 1;

  // The deal the seed made, standing before anything is touched.
  await advance(DEAL_FRAMES);
  if (record) await captureStill(h, "fresh-board");

  let snapshot: FacetSnapshot = await h.snapshot();
  let previousStep = snapshot.chainStep;

  /** Read the chain as it runs, keeping the take's figures and its stills. */
  const observe = async (next: FacetSnapshot): Promise<void> => {
    if (next.chainStep > 0 && next.chainStep !== previousStep) {
      take.steps += 1;
      take.cleared += next.lastCleared;
      take.biggest = Math.max(take.biggest, next.lastCleared);
      take.deepest = Math.max(take.deepest, next.chainStep);
      lastClearFrame = take.frames;
      // The deepest step of the take, kept rather than the first deep one, so
      // the still carries the highest multiplier the session actually reached.
      if (record && next.chainStep > deepestChainStill && next.chainStep >= 3) {
        deepestChainStill = next.chainStep;
        await captureStill(h, "deep-chain");
      }
      if (record && next.lastCleared > bestTearStill && next.lastCleared >= 8) {
        bestTearStill = next.lastCleared;
        await captureStill(h, "a-corner-goes");
      }
    }
    previousStep = next.chainStep;
    take.score = next.score;
  };

  while (take.frames < MAX_FRAMES) {
    snapshot = await h.snapshot();
    if (snapshot.screen !== "playing") break;

    const rows = await h.board();
    const standing = flawedCount(rows);
    take.flawedPeak = Math.max(take.flawedPeak, standing);
    if (
      record &&
      standing > bestStrainStill &&
      standing >= 6 &&
      snapshot.phase === "idle"
    ) {
      bestStrainStill = standing;
      await captureStill(h, "strained-board");
    }

    const candidates = rank(rows);
    if (candidates.length === 0) break;
    // The best move on the board. Where several are equally good the take
    // rotates between them, so a phase varies the session without ever giving
    // the player a worse move than the one it had.
    const best = candidates[0];
    const tied = candidates.filter(
      (candidate) =>
        candidate.cleared === best.cleared && candidate.points === best.points,
    );
    const chosen = tied[(take.moves + phase) % tied.length];

    const from = cellCenter(chosen.a.col, chosen.a.row);
    const onto = cellCenter(chosen.b.col, chosen.b.row);

    // The gesture: rest on the gem, press it, drag onto its neighbor, release.
    await h.moveTo(from.x, from.y);
    await advance(HOVER_FRAMES);
    await h.press(from.x, from.y);
    await advance(PRESS_FRAMES);
    await h.moveTo(onto.x, onto.y);
    await advance(2);
    await h.lift();
    await advance(1);
    take.moves += 1;

    await observe(await h.snapshot());

    // The chain the swap started, run to its end at the game's own step cadence.
    let driven = 0;
    while (driven < RESOLVE_CAP) {
      const next = await h.snapshot();
      if (next.screen !== "playing" || next.phase === "idle") break;
      await advance(RESOLVE_POLL);
      driven += RESOLVE_POLL;
      await observe(await h.snapshot());
      if (take.frames >= MAX_FRAMES + RESOLVE_CAP) break;
    }

    // Past the minimum, end on a settled board rather than mid-chain.
    if (take.frames >= MIN_FRAMES) break;
  }

  // A beat of the settled board to close on.
  await advance(24);
  const last = await h.snapshot();
  take.score = last.score;
  take.endedPlaying = last.screen === "playing" && last.phase === "idle";
  return take;
}

/** What makes a watchable Facet clip: escalation, and no dead air. */
function judge(take: Take): number {
  return (
    take.cleared * 1.5 +
    take.biggest * 4 +
    take.deepest * 6 +
    take.flawedPeak * 2 -
    take.maxLull * 8 +
    (take.endedPlaying ? 15 : -25)
  );
}

function describe(take: Take): string {
  return (
    `seed=${take.seed} phase=${take.phase}: ` +
    `${(take.frames / TICK_HZ).toFixed(1)}s, ${take.moves} moves, ` +
    `${take.steps} steps, ${take.cleared} cleared, biggest ${take.biggest}, ` +
    `deepest chain ${take.deepest}, flawed peak ${take.flawedPeak}, ` +
    `score ${take.score}, lull ${take.maxLull.toFixed(1)}s, ` +
    `${take.endedPlaying ? "settled" : "unsettled"} -> ${judge(take).toFixed(0)}`
  );
}

/* -------------------------------------------------------------------------- */

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness?.dispose();
});

it(
  "records a real play session for the showcase",
  async () => {
    const h = harness;
    if (h.surfaceFault !== null) {
      throw new Error(`facet: ${h.surfaceFault}`);
    }
    let seed = CHOSEN_SEED;
    let phase = CHOSEN_PHASE;

    if (!Number.isFinite(seed)) {
      // Audition with the recorder off, then re-run the winner under it.
      let best: Take | null = null;
      for (const auditionSeed of AUDITION_SEEDS) {
        for (const auditionPhase of AUDITION_PHASES) {
          const take = await runTake(h, auditionSeed, auditionPhase, false);
          console.log(`take ${describe(take)}`);
          if (best === null || judge(take) > judge(best)) best = take;
        }
      }
      if (best === null) throw new Error("facet: no take was auditioned");
      seed = best.seed;
      phase = best.phase;
    }

    console.log(`recording seed=${seed} phase=${phase}`);
    const final = await captureReplay(h, "gameplay", () =>
      runTake(h, seed, phase, true),
    );
    console.log(`recorded ${describe(final)}`);
  },
  30 * 60 * 1000,
);
