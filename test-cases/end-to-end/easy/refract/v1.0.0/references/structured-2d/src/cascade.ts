// Refract — Cascade's board generator and tier ladder.
//
// The generator's central requirement is that EVERY board it emits is solvable
// under the rules in `src/rules.ts` (specs/modes/cascade.md): a board the
// player cannot finish is the one failure the endless sequence cannot absorb.
// It earns that guarantee by construction and then proves it: a board is built
// by carving the SOLUTION first — one path of 8-adjacent cells per channel,
// walked under the very limits a beam obeys — and the nodes are read off the
// paths afterward: an endpoint becomes an emitter, a cell one path crosses
// once becomes a lens (or a one-charge crystal), and a cell the paths cross
// more than once becomes a crystal charged once per crossing. The finished
// board is then verified by replaying those paths through the real ruleset,
// and only a board whose solution the rules accept is emitted.
//
// All randomness runs off the one integer `RefractState.rngState`, threaded
// through a cursor and handed back advanced, so the sequence is a function of
// the seed alone (specs/modes/cascade.md, Determinism). A construction attempt
// can fail — a walk can box itself in — and a failed attempt simply draws
// again; the deterministic fallback board at the bottom exists so the
// generator cannot fail outright, and in practice an attempt lands long before
// the cap.

import { channelsOn, parseBoard } from "./board";
import {
  CHANNELS,
  MAX_TIER,
  TIER_ADVANCE,
  TIERS,
  type Tier,
} from "./constants";
import { boardSolved, canExtend, segmentKey } from "./rules";
import { cursor, type RngCursor } from "./rng";
import type { BeamState, BoardState, Cell, NodeState } from "./game";

/** The tier the ladder puts a run at (specs/modes/cascade.md). */
export function tierFor(solvedCount: number): number {
  return Math.min(Math.floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER);
}

export interface GeneratedBoard {
  readonly board: BoardState;
  /** A known solution: one route per channel present, in CHANNELS order. */
  readonly solution: readonly (readonly Cell[])[];
  /** The generator state after this board, to store back in `rngState`. */
  readonly rngState: number;
}

/** Construction attempts before the deterministic fallback is used. */
const MAX_ATTEMPTS = 64;

/** Restarts a single path is given before the whole attempt is abandoned. */
const WALK_RESTARTS = 24;

/** The chance a walk stops once it may, per step; longer walks otherwise. */
const STOP_CHANCE = 0.3;

/** One board at a tier, and the advanced generator state. */
export function generateBoard(
  rngState: number,
  tier: number,
): { board: BoardState; rngState: number } {
  const { board, rngState: next } = generateBoardWithSolution(rngState, tier);
  return { board, rngState: next };
}

/**
 * One board at a tier, together with the solution it was carved from. The
 * solution is what the emitted guarantee rests on, and what this build's own
 * tests replay through the pointer path.
 */
export function generateBoardWithSolution(
  rngState: number,
  tier: number,
): GeneratedBoard {
  const spec = TIERS[Math.min(Math.max(tier, 1), MAX_TIER) - 1];
  const rng = cursor(rngState);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const built = tryBuild(spec, rng);
    if (built && solutionSolves(built.board, built.solution)) {
      return { ...built, rngState: rng.state };
    }
  }
  const fallback = fallbackBoard(spec);
  return { ...fallback, rngState: rng.state };
}

/**
 * Whether the given routes, drawn one per present channel in CHANNELS order,
 * solve the board under the real ruleset: each grows segment by segment
 * through `canExtend`, and the finished beams satisfy R9.
 */
export function solutionSolves(
  board: BoardState,
  solution: readonly (readonly Cell[])[],
): boolean {
  const channels = channelsOn(board);
  if (solution.length !== channels.length) return false;
  const beams: BeamState[] = channels.map((channel) => ({
    channel,
    cells: [],
  }));
  for (let i = 0; i < channels.length; i++) {
    const route = solution[i];
    if (route.length < 2) return false;
    beams[i] = { channel: channels[i], cells: [route[0]] };
    for (let step = 1; step < route.length; step++) {
      if (!canExtend(board, beams, channels[i], route[step - 1], route[step])) {
        return false;
      }
      beams[i] = { ...beams[i], cells: [...beams[i].cells, route[step]] };
    }
  }
  return boardSolved(board, beams);
}

// ---- Construction --------------------------------------------------------

/** The working grid an attempt carves its paths into. */
interface Carving {
  readonly cols: number;
  readonly rows: number;
  /** How many times each cell has been crossed, by key `col,row`. */
  readonly visits: Map<string, number>;
  /** The channel index that first crossed each cell. */
  readonly owner: Map<string, number>;
  /** Cells that are path endpoints — future emitters, never crossed again. */
  readonly endpoints: Set<string>;
  /** Segments any path has drawn, canonically keyed. */
  readonly segments: Set<string>;
  /** Cells crossed more than once — future crystals. */
  readonly merged: Set<string>;
  /** How many crystals this attempt is aiming for. */
  readonly crystalTarget: number;
  readonly spec: Tier;
}

function key(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

function tryBuild(
  spec: Tier,
  rng: RngCursor,
): { board: BoardState; solution: Cell[][] } | null {
  const cols = rng.int(spec.minCols, spec.maxCols);
  const rows = rng.int(spec.minRows, spec.maxRows);
  const crystalTarget = rng.int(spec.minCrystals, spec.maxCrystals);
  const carving: Carving = {
    cols,
    rows,
    visits: new Map(),
    owner: new Map(),
    endpoints: new Set(),
    segments: new Set(),
    merged: new Set(),
    crystalTarget,
    spec,
  };

  // Path lengths sized to the grid, so the puzzle uses the bench it is given
  // rather than idling in a corner.
  const share = (cols * rows) / spec.channels;
  const minLen = Math.max(4, Math.round(share * 0.5));
  const maxLen = Math.max(minLen + 1, Math.round(share * 0.8));

  const solution: Cell[][] = [];
  for (let channel = 0; channel < spec.channels; channel++) {
    const path = walkPath(carving, channel, minLen, maxLen, rng);
    if (!path) return null;
    solution.push(path);
  }

  const crystals = chooseCrystals(carving, rng);
  if (!crystals) return null;

  return { board: buildBoard(carving, crystals), solution };
}

/**
 * One channel's route: a walk of 8-adjacent steps that claims fresh cells,
 * may cross an already-crossed cell where the tier's crystal budget allows —
 * that cell becomes a crystal — and ends on a cell of its own that nothing
 * else has touched, which becomes an emitter. Failed walks restore the
 * carving and try again from a different start.
 */
function walkPath(
  carving: Carving,
  channel: number,
  minLen: number,
  maxLen: number,
  rng: RngCursor,
): Cell[] | null {
  for (let restart = 0; restart < WALK_RESTARTS; restart++) {
    const snapshot = {
      visits: new Map(carving.visits),
      owner: new Map(carving.owner),
      endpoints: new Set(carving.endpoints),
      segments: new Set(carving.segments),
      merged: new Set(carving.merged),
    };
    const path = tryWalk(carving, channel, minLen, maxLen, rng);
    if (path) return path;
    carving.visits.clear();
    snapshot.visits.forEach((count, k) => carving.visits.set(k, count));
    carving.owner.clear();
    snapshot.owner.forEach((ownerIndex, k) => carving.owner.set(k, ownerIndex));
    carving.endpoints.clear();
    snapshot.endpoints.forEach((k) => carving.endpoints.add(k));
    carving.segments.clear();
    snapshot.segments.forEach((k) => carving.segments.add(k));
    carving.merged.clear();
    snapshot.merged.forEach((k) => carving.merged.add(k));
  }
  return null;
}

function visitCell(carving: Carving, channel: number, cell: Cell): void {
  const k = key(cell);
  const count = (carving.visits.get(k) ?? 0) + 1;
  carving.visits.set(k, count);
  if (!carving.owner.has(k)) carving.owner.set(k, channel);
  if (count > 1) carving.merged.add(k);
}

function tryWalk(
  carving: Carving,
  channel: number,
  minLen: number,
  maxLen: number,
  rng: RngCursor,
): Cell[] | null {
  const free: Cell[] = [];
  for (let row = 0; row < carving.rows; row++) {
    for (let col = 0; col < carving.cols; col++) {
      if (!carving.visits.has(key({ col, row }))) free.push({ col, row });
    }
  }
  if (free.length === 0) return null;

  let current = free[rng.int(0, free.length - 1)];
  visitCell(carving, channel, current);
  carving.endpoints.add(key(current));
  const path: Cell[] = [current];

  for (;;) {
    const onFreshCell =
      carving.visits.get(key(current)) === 1 &&
      !carving.merged.has(key(current));
    const mayStop = path.length >= minLen && onFreshCell;
    if (mayStop && (path.length >= maxLen || rng.draw() < STOP_CHANCE)) {
      carving.endpoints.add(key(current));
      return path;
    }
    const steps = validSteps(carving, current);
    if (steps.length === 0) {
      if (mayStop) {
        carving.endpoints.add(key(current));
        return path;
      }
      return null;
    }
    const next = steps[rng.int(0, steps.length - 1)];
    carving.segments.add(segmentKey(current, next));
    visitCell(carving, channel, next);
    path.push(next);
    current = next;
  }
}

/**
 * The cells a walk may step to from `from`: 8-adjacent, inside the grid, along
 * an unused segment whose crossing diagonal is also unused, never onto an
 * endpoint, and onto an already-crossed cell only when merging it into a
 * crystal stays within the tier's crystal count and charge caps.
 */
function validSteps(carving: Carving, from: Cell): Cell[] {
  const steps: Cell[] = [];
  for (let dCol = -1; dCol <= 1; dCol++) {
    for (let dRow = -1; dRow <= 1; dRow++) {
      if (dCol === 0 && dRow === 0) continue;
      const to = { col: from.col + dCol, row: from.row + dRow };
      if (to.col < 0 || to.col >= carving.cols) continue;
      if (to.row < 0 || to.row >= carving.rows) continue;
      if (carving.segments.has(segmentKey(from, to))) continue;
      if (dCol !== 0 && dRow !== 0) {
        const crossing = segmentKey(
          { col: from.col, row: to.row },
          { col: to.col, row: from.row },
        );
        if (carving.segments.has(crossing)) continue;
      }
      const k = key(to);
      if (carving.endpoints.has(k)) continue;
      const visits = carving.visits.get(k) ?? 0;
      if (visits > 0) {
        if (visits + 1 > carving.spec.maxCharges) continue;
        if (
          !carving.merged.has(k) &&
          carving.merged.size >= carving.crystalTarget
        )
          continue;
      }
      steps.push(to);
    }
  }
  return steps;
}

/**
 * The crystal cells and their charges: every merged cell is a crystal charged
 * once per crossing, and single-crossed cells are converted to one-charge
 * crystals until the attempt's target is met — preferring cells beside
 * another channel's territory, so a crystal reads as a question of who spends
 * it rather than a label on one beam's path.
 */
function chooseCrystals(
  carving: Carving,
  rng: RngCursor,
): Map<string, number> | null {
  const crystals = new Map<string, number>();
  carving.merged.forEach((k) => {
    crystals.set(k, carving.visits.get(k) ?? 0);
  });

  const need = carving.crystalTarget - crystals.size;
  if (need <= 0) return crystals;

  const candidates: Cell[] = [];
  carving.visits.forEach((count, k) => {
    if (count !== 1 || carving.endpoints.has(k)) return;
    const [col, row] = k.split(",").map(Number);
    candidates.push({ col, row });
  });
  const preferred = candidates.filter((cell) =>
    besideAnotherChannel(carving, cell),
  );
  const rest = candidates.filter(
    (cell) => !besideAnotherChannel(carving, cell),
  );
  const picks = [...rng.shuffle(preferred), ...rng.shuffle(rest)].slice(
    0,
    need,
  );
  if (crystals.size + picks.length < carving.spec.minCrystals) return null;
  for (const cell of picks) crystals.set(key(cell), 1);
  return crystals;
}

function besideAnotherChannel(carving: Carving, cell: Cell): boolean {
  const own = carving.owner.get(key(cell));
  for (let dCol = -1; dCol <= 1; dCol++) {
    for (let dRow = -1; dRow <= 1; dRow++) {
      if (dCol === 0 && dRow === 0) continue;
      const neighbor = carving.owner.get(
        key({ col: cell.col + dCol, row: cell.row + dRow }),
      );
      if (neighbor !== undefined && neighbor !== own) return true;
    }
  }
  return false;
}

/** The finished board read off a carving, nodes in reading order. */
function buildBoard(
  carving: Carving,
  crystals: Map<string, number>,
): BoardState {
  const nodes: NodeState[] = [];
  for (let row = 0; row < carving.rows; row++) {
    for (let col = 0; col < carving.cols; col++) {
      const k = key({ col, row });
      if (!carving.visits.has(k)) continue;
      if (crystals.has(k)) {
        nodes.push({
          col,
          row,
          kind: "crystal",
          channel: null,
          charges: crystals.get(k) ?? 1,
        });
        continue;
      }
      const channel = CHANNELS[carving.owner.get(k) ?? 0];
      nodes.push({
        col,
        row,
        kind: carving.endpoints.has(k) ? "emitter" : "lens",
        channel,
        charges: null,
      });
    }
  }
  return { cols: carving.cols, rows: carving.rows, nodes };
}

// ---- The fallback --------------------------------------------------------

/**
 * A deterministic board for the tier, used only if every construction attempt
 * fails: one straight route per channel on its own row, with the tier's
 * minimum crystal count converted from the first channel's lenses. Plain, but
 * well-formed and provably solvable, which is the one thing the sequence
 * cannot do without.
 */
export function fallbackBoard(spec: Tier): {
  board: BoardState;
  solution: Cell[][];
} {
  const cols = spec.maxCols;
  const rows = spec.maxRows;
  const notation: string[] = [];
  const solution: Cell[][] = [];
  const emitterChars = ["T", "S", "D"];
  const lensChars = ["t", "s", "d"];
  for (let row = 0; row < rows; row++) {
    const channel = row % 2 === 0 ? row / 2 : -1;
    if (channel >= 0 && channel < spec.channels) {
      let line = emitterChars[channel];
      for (let col = 1; col < cols - 1; col++) {
        const crystal = channel === 0 && col <= spec.minCrystals;
        line += crystal ? "1" : lensChars[channel];
      }
      line += emitterChars[channel];
      notation.push(line);
      const route: Cell[] = [];
      for (let col = 0; col < cols; col++) route.push({ col, row });
      solution.push(route);
    } else {
      notation.push(".".repeat(cols));
    }
  }
  return { board: parseBoard(notation), solution };
}
