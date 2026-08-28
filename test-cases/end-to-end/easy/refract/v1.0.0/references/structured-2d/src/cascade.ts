// Refract — Cascade's board generator and tier ladder.
//
// The generator's contract (specs/modes/cascade.md) has two halves. EVERY
// board it emits is solvable under the rules in `src/rules.ts`: a board the
// player cannot finish is the one failure the endless sequence cannot absorb.
// And every board meets its tier's DIFFICULTY FLOOR: the five measures in
// `src/difficulty.ts`, each within the bounds the tier's TIERS entry states,
// so the sequence cannot drift into busywork the way a merely solvable board
// can.
//
// Solvability is earned by construction and then proved: a board is built by
// carving the SOLUTION first — one path of 8-adjacent cells per channel,
// walked under the very limits a beam obeys — and the nodes are read off the
// paths afterward: an endpoint becomes an emitter, a cell one path crosses
// once becomes a lens (or a one-charge crystal), and a cell the paths cross
// more than once becomes a crystal charged once per crossing. The finished
// board is verified by replaying those paths through the real ruleset, then
// measured against the floor, and only a board that passes both is emitted.
//
// All randomness runs off the one integer `RefractState.rngState`, threaded
// through a cursor and handed back advanced, so the sequence is a function of
// the seed alone (specs/modes/cascade.md, Determinism). An attempt can fail —
// a walk can box itself in, and most carved boards land under the floor — and
// a failed attempt simply draws again. The per-tier reserve boards at the
// bottom exist so the generator cannot fail outright: each is fixed, verified
// against its tier's whole contract, and reached only if every attempt in the
// budget misses, which the acceptance rate makes vanishingly rare.

import { channelsOn, parseBoard } from "./board";
import {
  CHANNELS,
  MAX_TIER,
  TIER_ADVANCE,
  TIERS,
  type Tier,
} from "./constants";
import { measureDifficulty, meetsFloor } from "./difficulty";
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

/** Attempts before the tier's reserve board is used. Acceptance against the
 * floor runs a fifth to two thirds per carved candidate across the ladder, so
 * the reserve is a guarantee rather than a path taken in practice. */
const MAX_ATTEMPTS = 400;

/** Restarts a single path is given before the whole attempt is abandoned. */
const WALK_RESTARTS = 24;

/** The chance a walk stops once it may, per step; longer walks otherwise. */
const STOP_CHANCE = 0.22;

/** Walk length as a share of the channel's cell budget, low and high. */
const WALK_SHARE_LO = 0.62;
const WALK_SHARE_HI = 0.95;

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
    if (!built) continue;
    const cells = built.board.cols * built.board.rows;
    if (cells - built.board.nodes.length > spec.maxEmptyCells) continue;
    if (!solutionSolves(built.board, built.solution)) continue;
    if (!clearsFloor(built.board, spec)) continue;
    return { ...built, rngState: rng.state };
  }
  const reserve = reserveBoard(tier);
  return { ...reserve, rngState: rng.state };
}

/**
 * Whether a candidate clears its tier's difficulty floor. The enumeration is
 * asked for one solution past the tier's cap, so a board over the cap comes
 * back capped and fails; a board the expansion budget stops on is discarded
 * the same way, since its measures are not trustworthy either.
 */
function clearsFloor(board: BoardState, spec: Tier): boolean {
  const measured = measureDifficulty(
    board,
    spec.maxSolutions + 1,
    spec.minRoutes,
  );
  return measured !== null && !measured.capped && meetsFloor(measured, spec);
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

  // Path lengths sized to the grid, so the puzzle crowds the bench it is
  // given: the floor's branching and routes bounds are met by full boards,
  // not by paths idling in a corner.
  const share = (cols * rows) / spec.channels;
  const minLen = Math.max(4, Math.round(share * WALK_SHARE_LO));
  const maxLen = Math.max(minLen + 1, Math.round(share * WALK_SHARE_HI));

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
 * it rather than a label on one beam's path. The floor's shared-crystals
 * bound is what a candidate without genuinely contested crystals then fails.
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

// ---- The reserves --------------------------------------------------------

/** One fixed board per tier: notation rows and a solving route per channel. */
interface Reserve {
  readonly notation: readonly string[];
  readonly solution: readonly (readonly Cell[])[];
}

/**
 * The per-tier reserve boards, used only if every construction attempt
 * misses. Each is verified against its tier's whole contract — shape, floor,
 * and the stored solution — by this build's own tests, so even the last
 * resort keeps the sequence's guarantees.
 */
const RESERVES: readonly Reserve[] = [
  {
    notation: [".ttt", ".ttt", "Ttt.", "Tttt"],
    solution: [
      [
        { col: 0, row: 2 },
        { col: 1, row: 1 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 2, row: 2 },
        { col: 3, row: 3 },
        { col: 2, row: 3 },
        { col: 1, row: 2 },
        { col: 1, row: 3 },
        { col: 0, row: 3 },
      ],
    ],
  },
  {
    notation: ["tTssS", "tStss", "tttT.", "tt..."],
    solution: [
      [
        { col: 1, row: 0 },
        { col: 0, row: 0 },
        { col: 0, row: 1 },
        { col: 0, row: 2 },
        { col: 1, row: 2 },
        { col: 0, row: 3 },
        { col: 1, row: 3 },
        { col: 2, row: 2 },
        { col: 2, row: 1 },
        { col: 3, row: 2 },
      ],
      [
        { col: 4, row: 0 },
        { col: 3, row: 0 },
        { col: 4, row: 1 },
        { col: 3, row: 1 },
        { col: 2, row: 0 },
        { col: 1, row: 1 },
      ],
    ],
  },
  {
    notation: ["S.ttT", ".2t2.", "ss2t.", "..S.T"],
    solution: [
      [
        { col: 4, row: 0 },
        { col: 3, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 1 },
        { col: 2, row: 1 },
        { col: 1, row: 1 },
        { col: 2, row: 2 },
        { col: 3, row: 1 },
        { col: 3, row: 2 },
        { col: 4, row: 3 },
      ],
      [
        { col: 0, row: 0 },
        { col: 1, row: 1 },
        { col: 0, row: 2 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
        { col: 2, row: 3 },
      ],
    ],
  },
  {
    notation: [".D.tt", "113DT", ".2s2T", "SsS.."],
    solution: [
      [
        { col: 4, row: 1 },
        { col: 4, row: 0 },
        { col: 3, row: 0 },
        { col: 2, row: 1 },
        { col: 1, row: 1 },
        { col: 0, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 1 },
        { col: 3, row: 2 },
        { col: 4, row: 2 },
      ],
      [
        { col: 0, row: 3 },
        { col: 1, row: 2 },
        { col: 1, row: 3 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 2, row: 3 },
      ],
      [
        { col: 1, row: 0 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
      ],
    ],
  },
  {
    notation: ["...Ttt.", ".Sss2Dd", "Ss222d.", "s.3d.t.", ".Dss..T"],
    solution: [
      [
        { col: 3, row: 0 },
        { col: 4, row: 0 },
        { col: 5, row: 0 },
        { col: 4, row: 1 },
        { col: 3, row: 2 },
        { col: 4, row: 2 },
        { col: 5, row: 3 },
        { col: 6, row: 4 },
      ],
      [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 2, row: 3 },
        { col: 2, row: 4 },
        { col: 3, row: 4 },
        { col: 2, row: 3 },
        { col: 2, row: 2 },
        { col: 1, row: 2 },
        { col: 0, row: 3 },
        { col: 0, row: 2 },
      ],
      [
        { col: 5, row: 1 },
        { col: 6, row: 1 },
        { col: 5, row: 2 },
        { col: 4, row: 1 },
        { col: 4, row: 2 },
        { col: 3, row: 3 },
        { col: 2, row: 3 },
        { col: 1, row: 4 },
      ],
    ],
  },
];

/** The tier's fixed reserve board and its solution. */
export function reserveBoard(tier: number): {
  board: BoardState;
  solution: Cell[][];
} {
  const reserve = RESERVES[Math.min(Math.max(tier, 1), MAX_TIER) - 1];
  return {
    board: parseBoard(reserve.notation),
    solution: reserve.solution.map((route) =>
      route.map((cell) => ({ ...cell })),
    ),
  };
}
