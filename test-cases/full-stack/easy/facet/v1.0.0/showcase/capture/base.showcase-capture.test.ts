// showcase-capture — record a REAL PLAY session for the case showcase.
//
// Not a validator: a temporary capture driver staged beside the harness to
// (re)record `showcase/base/`'s replay and stills from the reference
// implementation. It opens the build on its title screen, chooses `PLAY` with a
// real key press, and then plays the round out with a real mouse — press a gem,
// drag onto its neighbor, release — letting the build's own swap animation,
// chain resolution, strain, cuts, shattering and refill produce everything on
// screen. Nothing is posed mid-play: `loadBoard` and `setGem` are never called,
// and the only surface operations the take uses are the clock
// (`setAutoStep`/`advance`, which nothing outside an engineless build owns),
// `reset` to open on the title screen, and `snapshot` for reading.
//
// The player has two layers, and the split is the same one carom's driver uses.
// EXECUTION is a real pointer through `press`/`moveTo`/`lift`, the input path a
// human uses, so the selection, the offer under the hand and the release that
// commits it behave exactly as under hand play. PLANNING is done through the
// CASE's own rule helpers in `board.ts` — `legalSwaps`, `swapped`, `runSeed`,
// `expandClearSet` — so each candidate swap is played forward under R1, R3, R4,
// R5 and R6 before it is made, and the player takes the move that clears the
// most. That is how a good player reads this board: ordinary matches prime the
// stones around them with strain, and once a corner is flawed through, the
// biggest move on the board is the one that tears it open. The escalation in the
// clip is the ruleset's, not a script's.
//
// THE TAKE WAITS ON THE BUILD'S OWN CLOCK, NEVER ON A WRITTEN-DOWN COUNT OF
// FRAMES. A step's hold is the step's own figure — `lastWaves * WAVE_SECONDS +
// lastFall * FALL_SECONDS_PER_ROW + STEP_SECONDS`, which the snapshot reports as
// `stepHold` — so the chain is polled to its end on `phase` rather than driven
// for a fixed span, and the two stills that frame a step in motion are timed off
// that step's own `lastWaves` and `lastFall` through `board.ts`'s `shatterEnd`
// and `landAt`. One is taken while the clear set is coming apart in waves, the
// other while the stones above it are still falling into the hole.
//
// A LEVEL CLEAR IS PART OF THE CLIP. Reaching the level's target opens the
// `levelclear` screen with the level's longest chain and best move on it, and
// the round waits there. The driver reads that screen, takes `CONTINUE` from it
// with the pointer — the menus answer the same mouse the board does — and plays
// on into the next level, whose board pours in from above.
//
// Every take is a fresh deal off the build's own random source, so no take can
// be played twice: each one is recorded as it is auditioned, under its own
// output ids, and the winner's files are copied to the names the showcase
// carries once every take has been judged.
//
// Run from the reference workspace root:
//   TCAB_VALIDATION_MEDIA_DIR=<out> TCAB_SHOWCASE_MAX_REPLAY_FRAMES=1500 \
//     npx vitest run --config validation/vitest.config.ts validation/showcase-capture.test.ts
//
// See `showcase/capture/README.md` for the staging steps and every knob.

import { copyFileSync, existsSync } from "node:fs";
import { afterEach, beforeEach, it } from "vitest";
import {
  captureReplay,
  captureStill,
  createHarness,
  mediaDestination,
  TICK_HZ,
  type Harness,
} from "./harness";
import { GRID_COLS, GRID_ROWS, MAX_STRAIN } from "./constants";
import {
  cellCenter,
  expandClearSet,
  isPrism,
  landAt,
  legalSwaps,
  parseRows,
  parseToken,
  runSeed,
  shatterEnd,
  swapped,
  targetCenter,
  tokenAt,
  type BoardRows,
  type CellRef,
} from "./board";
import type { FacetSnapshot } from "./surface";

/* -------------------------------------------------------------------------- */
/* Knobs                                                                      */
/* -------------------------------------------------------------------------- */

/** How many takes are auditioned, each a fresh deal and a fresh session. */
const AUDITION_TAKES = Number(process.env.TCAB_SHOWCASE_TAKES ?? "12");

/** Tie-break rotations, applied to the takes in turn. */
const AUDITION_PHASES = (process.env.TCAB_SHOWCASE_PHASES ?? "0,1")
  .split(",")
  .map((piece) => Number(piece.trim()))
  .filter((phase) => Number.isFinite(phase));

/** The showcase's own output ids, which the winning take's files are copied to. */
const SHOWCASE_OUTPUTS: readonly (readonly [id: string, extension: string])[] =
  [
    ["gameplay", "json.gz"],
    ["fresh-board", "png"],
    ["a-corner-goes", "png"],
    ["deep-chain", "png"],
    ["strained-board", "png"],
    ["level-clear", "png"],
  ];

/** The output id one take's media is written under, so no take overwrites another. */
function takeOutput(take: number, id: string): string {
  return `take-${String(take).padStart(2, "0")}-${id}`;
}

/** How long the clip runs, in seconds of game time. */
const MIN_SECONDS = Number(process.env.TCAB_SHOWCASE_MIN_SECONDS ?? "20");
const MAX_SECONDS = Number(process.env.TCAB_SHOWCASE_MAX_SECONDS ?? "26");

/** Frames of the take's clock. The harness runs a steady 64 Hz. */
const MIN_FRAMES = Math.round(MIN_SECONDS * TICK_HZ);
const MAX_FRAMES = Math.round(MAX_SECONDS * TICK_HZ);

/** The opening beat on the title screen, before `PLAY` is confirmed. */
const TITLE_FRAMES = 48;
/** The beat a dealt board is given to pour in and stand before it is played. */
const DEAL_FRAMES = 44;
/**
 * How far into a deal's pour the fresh-board still is taken.
 *
 * A dealt gem carries a `fell` of at least `row + 1`, so the deepest row is in
 * the air for `8 * FALL_SECONDS_PER_ROW` — four tenths of a second — and a
 * picture taken a little under half way through it catches the board arriving.
 */
const POUR_STILL_FRAMES = 12;
/** The pointer resting on a gem before it presses: a player reading the board. */
const HOVER_FRAMES = 14;
/** The press held so the selection reads before the drag leaves the cell. */
const PRESS_FRAMES = 10;
/** Frames between two readings while a swap or a chain is in motion. */
const RESOLVE_POLL = 2;
/** A guard on one chain, well past the longest a settled board can run. */
const RESOLVE_CAP = 1600;
/** The beat the level-clear screen is held for, long enough to read its figures. */
const LEVELCLEAR_FRAMES = 72;
/** The pointer resting on a menu item before it presses it. */
const MENU_HOVER_FRAMES = 12;
/** The closing beat on the settled board the take ends on. */
const CLOSING_FRAMES = 24;

/**
 * How far into the shattering the tear still is taken, past half of it.
 *
 * A cell at wave `w` comes apart `w * WAVE_SECONDS` into the step and its sheet
 * runs for rather longer than one wave, so a picture taken here catches the
 * early waves in pieces, a middle one just breaking, and the last still whole.
 */
const SHATTER_STILL_LEAD = 0.06;
/** How far through a step's fall the deep-chain still is taken. */
const FALL_STILL_FRACTION = 0.5;

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

/** Cut stones standing on a board, each of which carries a running aura. */
function cutCount(rows: BoardRows): number {
  return parseRows(rows).reduce(
    (total, row) => total + row.filter((gem) => gem.cut !== "plain").length,
    0,
  );
}

/* -------------------------------------------------------------------------- */
/* One take                                                                   */
/* -------------------------------------------------------------------------- */

interface Take {
  /** Which audition this was, counted from 1. */
  take: number;
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
  /** The most points one move of the take scored. */
  richest: number;
  /** The most flawed gems standing on the board at once. */
  flawedPeak: number;
  /** Levels the take cleared, each of which it took `CONTINUE` from. */
  levels: number;
  score: number;
  /** The longest stretch with nothing clearing, in seconds. */
  maxLull: number;
  /** Whether the take ended settled, still on the board. */
  endedPlaying: boolean;
}

/**
 * Play one take out.
 *
 * The stills are written under the take's own output ids; the replay is armed by
 * the caller around this, so the recorded stretch is exactly the session below
 * and nothing else.
 */
async function runTake(
  h: Harness,
  index: number,
  phase: number,
): Promise<Take> {
  // A previous take can end with the mouse held over a gem. Lift it before the
  // reset, so no drag leaks across into the next session.
  await h.lift();
  await h.debug.reset();
  await h.advance(1);

  const record = true;
  const still = (id: string): Promise<void> =>
    captureStill(h, takeOutput(index, id));

  const take: Take = {
    take: index,
    phase,
    frames: 0,
    moves: 0,
    steps: 0,
    cleared: 0,
    biggest: 0,
    deepest: 0,
    richest: 0,
    flawedPeak: 0,
    levels: 0,
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
    if (frames <= 0) return;
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
        await still(`qa-${String(want).padStart(2, "0")}`);
      }
    }
  };

  /**
   * Hold the step now resolving until `target` seconds into it.
   *
   * Never past the step's own `stepHold`: the board is read again there and the
   * next step begins, which is a different picture from the one being framed.
   */
  const intoStep = async (target: number): Promise<void> => {
    const now = await h.snapshot();
    if (now.phase !== "resolving") return;
    const limit = Math.min(target, now.stepHold - 2 / TICK_HZ);
    await advance(Math.round((limit - now.stepTimer) * TICK_HZ));
  };

  // The title screen, held long enough to read, then `PLAY` taken with a real
  // key through the registered `confirm` action.
  await advance(TITLE_FRAMES);
  await h.tapAction("confirm");
  take.frames += 1;

  // The board the deal dealt, caught pouring in from above it, and then standing.
  await advance(POUR_STILL_FRAMES);
  if (record) await still("fresh-board");
  await advance(DEAL_FRAMES - POUR_STILL_FRAMES);

  let snapshot: FacetSnapshot = await h.snapshot();
  let previousStep = snapshot.chainStep;

  /** Keep the running figures a reading carries, and where the chain stands. */
  const observe = (next: FacetSnapshot): void => {
    previousStep = next.chainStep;
    take.score = next.score;
    take.richest = Math.max(take.richest, next.bestMove, next.moveScore);
  };

  /** What a freshly resolved step did, and the two pictures it may be worth. */
  const stepResolved = async (next: FacetSnapshot): Promise<void> => {
    take.steps += 1;
    take.cleared += next.lastCleared;
    take.biggest = Math.max(take.biggest, next.lastCleared);
    take.deepest = Math.max(take.deepest, next.chainStep);
    lastClearFrame = take.frames;

    // The biggest step of the take, framed while its clear set is still coming
    // apart: the early waves in pieces and the last of them not yet gone.
    if (record && next.lastCleared > bestTearStill && next.lastCleared >= 8) {
      bestTearStill = next.lastCleared;
      await intoStep(shatterEnd(next.lastWaves) * 0.5 + SHATTER_STILL_LEAD);
      await still("a-corner-goes");
    }
    // The deepest step of the take, kept rather than the first deep one so the
    // still carries the highest multiplier the session reached, and framed part
    // way through the fall that follows the shattering.
    if (record && next.chainStep > deepestChainStill && next.chainStep >= 3) {
      deepestChainStill = next.chainStep;
      const shattered = shatterEnd(next.lastWaves);
      const landed = landAt(next.lastWaves, next.lastFall);
      await intoStep(shattered + (landed - shattered) * FALL_STILL_FRACTION);
      await still("deep-chain");
    }
  };

  /** Poll a swap and the chain it started to their end, at the game's cadence. */
  const resolve = async (): Promise<void> => {
    let driven = 0;
    while (driven < RESOLVE_CAP) {
      const next = await h.snapshot();
      if (next.screen !== "playing" || next.phase === "idle") break;
      await advance(RESOLVE_POLL);
      driven += RESOLVE_POLL;
      const after = await h.snapshot();
      const stepped = after.chainStep > 0 && after.chainStep !== previousStep;
      observe(after);
      if (stepped) await stepResolved(after);
      if (take.frames >= MAX_FRAMES + RESOLVE_CAP) break;
    }
  };

  /**
   * The level-clear screen: read it, and take `CONTINUE` from it with the
   * pointer, which is the same mouse the board is played with.
   */
  const clearLevel = async (): Promise<void> => {
    await advance(LEVELCLEAR_FRAMES);
    if (record) await still("level-clear");

    const screen = await h.snapshot();
    const cont = screen.targets.find((target) => target.id === "menu-0");
    if (cont === undefined) {
      throw new Error(
        "facet: the level-clear screen reported no menu-0 target",
      );
    }
    const spot = targetCenter(cont);
    await h.moveTo(spot.x, spot.y);
    await advance(MENU_HOVER_FRAMES);
    await h.press(spot.x, spot.y);
    await advance(PRESS_FRAMES);
    await h.lift();
    await advance(1);
    take.levels += 1;
    lastClearFrame = take.frames;

    // The next level's board pours in from above; give it the beat that takes.
    await advance(DEAL_FRAMES);
  };

  while (take.frames < MAX_FRAMES) {
    snapshot = await h.snapshot();
    if (snapshot.screen === "levelclear") {
      await clearLevel();
      if (take.frames >= MIN_FRAMES) break;
      continue;
    }
    if (snapshot.screen !== "playing") break;

    const rows = await h.board();
    const standing = flawedCount(rows);
    take.flawedPeak = Math.max(take.flawedPeak, standing);
    // The most primed board of the take, and — where two boards are equally
    // primed — the one carrying more cut stones, each of which stands under a
    // running aura.
    if (
      record &&
      snapshot.phase === "idle" &&
      standing >= 6 &&
      standing * 100 + cutCount(rows) > bestStrainStill
    ) {
      bestStrainStill = standing * 100 + cutCount(rows);
      await still("strained-board");
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

    // The gesture: rest on the gem, press it, carry it onto its neighbor, and
    // let go — the release with the offer standing is what plays the move.
    await h.moveTo(from.x, from.y);
    await advance(HOVER_FRAMES);
    await h.press(from.x, from.y);
    await advance(PRESS_FRAMES);
    await h.moveTo(onto.x, onto.y);
    await advance(2);
    await h.lift();
    await advance(1);
    take.moves += 1;

    observe(await h.snapshot());

    // The swap's own animation, and then the chain it started.
    await resolve();

    // Past the minimum, end on a settled board rather than mid-chain. A chain
    // that ended by clearing the level is not one: the screen it left standing
    // is taken first, at the top of the loop.
    if (take.frames >= MIN_FRAMES) {
      const now = await h.snapshot();
      if (now.screen === "playing") break;
    }
  }

  // A beat of the settled board to close on.
  await advance(CLOSING_FRAMES);
  const last = await h.snapshot();
  take.score = last.score;
  take.richest = Math.max(take.richest, last.bestMove);
  take.endedPlaying = last.screen === "playing" && last.phase === "idle";
  return take;
}

/** What makes a watchable Facet clip: escalation, and no dead air. */
function judge(take: Take): number {
  return (
    take.cleared * 1.5 +
    take.biggest * 4 +
    take.deepest * 6 +
    take.flawedPeak * 2 +
    take.levels * 14 -
    take.maxLull * 8 +
    (take.endedPlaying ? 15 : -25)
  );
}

function describe(take: Take): string {
  return (
    `take=${take.take} phase=${take.phase}: ` +
    `${(take.frames / TICK_HZ).toFixed(1)}s, ${take.moves} moves, ` +
    `${take.steps} steps, ${take.cleared} cleared, biggest ${take.biggest}, ` +
    `deepest chain ${take.deepest}, best move ${take.richest}, ` +
    `flawed peak ${take.flawedPeak}, levels ${take.levels}, ` +
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
    if (AUDITION_TAKES < 1 || AUDITION_PHASES.length === 0) {
      throw new Error("facet: nothing to audition");
    }

    // Every take is recorded as it is played, because a fresh deal cannot be
    // played twice; the winner's files are copied to the showcase's names once
    // every take has been judged.
    let best: Take | null = null;
    for (let index = 1; index <= AUDITION_TAKES; index += 1) {
      const phase = AUDITION_PHASES[(index - 1) % AUDITION_PHASES.length];
      const take = await captureReplay(h, takeOutput(index, "gameplay"), () =>
        runTake(h, index, phase),
      );
      console.log(`take ${describe(take)}`);
      if (best === null || judge(take) > judge(best)) best = take;
    }
    if (best === null) throw new Error("facet: no take was auditioned");

    console.log(`keeping ${describe(best)}`);
    for (const [id, extension] of SHOWCASE_OUTPUTS) {
      const from = mediaDestination(takeOutput(best.take, id), extension);
      const to = mediaDestination(id, extension);
      if (from === null || to === null || !existsSync(from)) continue;
      copyFileSync(from, to);
    }
  },
  30 * 60 * 1000,
);
