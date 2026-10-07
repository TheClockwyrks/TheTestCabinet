/**
 * notation.ts — Refract board notation, cell geometry, and the constants the
 * specs fix.
 *
 * Derived from the specs alone:
 *   - specs/board.md          — cells, geometry (cellX/cellY), node kinds,
 *                               channels, and the board notation table.
 *   - specs/controls.md       — STAGE_W x STAGE_H (the logical stage).
 *   - specs/campaign-boards.md — CAMPAIGN_LENGTH.
 *   - specs/modes/cascade.md  — MAX_TIER, TIER_ADVANCE, TIERS.
 *
 * No DOM, no engine, no reference implementation.
 */

// ---------------------------------------------------------------------------
// Constants the specs fix, each under the spec's own name.
// ---------------------------------------------------------------------------

/** specs/board.md "Where a cell sits": adjacent cell centers are this far apart. */
export const CELL_PITCH = 96;
/** specs/board.md: the grid is centered on (BOARD_CX, BOARD_CY) whatever its size. */
export const BOARD_CX = 640;
export const BOARD_CY = 392;
/** specs/board.md: every node's drawn form fits inside this radius of its cell center. */
export const NODE_R = 30;
/** specs/board.md + specs/controls.md: pointer targets a node within this radius. */
export const NODE_HIT_R = 44;
/** specs/board.md "Cells": cols is at least 1 and at most GRID_MAX_COLS. */
export const GRID_MAX_COLS = 7;
/** specs/board.md "Cells": rows is at least 1 and at most GRID_MAX_ROWS. */
export const GRID_MAX_ROWS = 6;
/** specs/board.md "Nodes": a crystal carries 1 to MAX_CHARGES charges. */
export const MAX_CHARGES = 3;
/** specs/controls.md "The pointer": the logical stage size. */
export const STAGE_W = 1280;
export const STAGE_H = 720;
/** specs/campaign-boards.md: the campaign is CAMPAIGN_LENGTH boards, 1..24. */
export const CAMPAIGN_LENGTH = 24;
/** specs/modes/cascade.md "The tier ladder". */
export const MAX_TIER = 5;
/** specs/modes/cascade.md: the tier climbs one step every TIER_ADVANCE boards solved. */
export const TIER_ADVANCE = 5;

/** specs/board.md "Channels": the three channel identifiers, in this order. */
export type Channel = "triangle" | "square" | "diamond";
export const CHANNELS: readonly Channel[] = ["triangle", "square", "diamond"];

/**
 * specs/modes/cascade.md "The tier ladder" and "The floor, by tier", one entry
 * per tier (index 0 is tier 1). Grid sizes are the stated inclusive ranges;
 * crystal counts and charge ranges likewise; `emptyCells` is the stated
 * maximum. The floor fields carry the tier's stated bounds, with an unstated
 * bound held at the loosest value of its kind.
 */
export interface TierSpec {
  readonly tier: number;
  readonly cols: readonly [min: number, max: number];
  readonly rows: readonly [min: number, max: number];
  readonly channels: number;
  readonly crystals: readonly [min: number, max: number];
  readonly charges: readonly [min: number, max: number];
  /** The most cells a board at this tier leaves empty. */
  readonly emptyCells: number;
  /** Routes per channel: every channel present admits at least this many. */
  readonly minRoutes: number;
  /** The solution count the board admits, inclusive on both ends. */
  readonly solutions: readonly [min: number, max: number];
  /** The determined share, at most, as a fraction of a solution's segments. */
  readonly maxDeterminedShare: number;
  /** The branching factor, at least. */
  readonly minBranching: number;
  /** Crystals crossed by two or more channels in one solution, at least. */
  readonly minSharedCrystals: number;
}
export const TIERS: readonly TierSpec[] = [
  {
    tier: 1,
    cols: [3, 4],
    rows: [3, 4],
    channels: 1,
    crystals: [0, 0],
    charges: [0, 0],
    emptyCells: 6,
    minRoutes: 2,
    solutions: [1, 64],
    maxDeterminedShare: 1,
    minBranching: 1.7,
    minSharedCrystals: 0,
  },
  {
    tier: 2,
    cols: [4, 5],
    rows: [4, 4],
    channels: 2,
    crystals: [0, 1],
    charges: [1, 2],
    emptyCells: 7,
    minRoutes: 2,
    solutions: [2, 64],
    maxDeterminedShare: 0.95,
    minBranching: 1.7,
    minSharedCrystals: 0,
  },
  {
    tier: 3,
    cols: [4, 5],
    rows: [4, 5],
    channels: 2,
    crystals: [2, 3],
    charges: [1, 2],
    emptyCells: 9,
    minRoutes: 3,
    solutions: [2, 128],
    maxDeterminedShare: 0.9,
    minBranching: 1.8,
    minSharedCrystals: 1,
  },
  {
    tier: 4,
    cols: [5, 6],
    rows: [4, 5],
    channels: 3,
    crystals: [3, 5],
    charges: [1, 3],
    emptyCells: 10,
    minRoutes: 3,
    solutions: [2, 192],
    maxDeterminedShare: 0.85,
    minBranching: 1.9,
    minSharedCrystals: 2,
  },
  {
    tier: 5,
    cols: [6, 7],
    rows: [5, 6],
    channels: 3,
    crystals: [4, 7],
    charges: [1, 3],
    emptyCells: 14,
    minRoutes: 6,
    solutions: [2, 256],
    maxDeterminedShare: 0.8,
    minBranching: 2,
    minSharedCrystals: 3,
  },
];

/** specs/modes/cascade.md: tier = min(floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER). */
export function tierForSolvedCount(solvedCount: number): number {
  return Math.min(Math.floor(solvedCount / TIER_ADVANCE) + 1, MAX_TIER);
}

// ---------------------------------------------------------------------------
// Geometry — specs/board.md "Where a cell sits".
// ---------------------------------------------------------------------------

/** cellX(col, cols) = BOARD_CX - (cols - 1) * CELL_PITCH / 2 + col * CELL_PITCH */
export function cellX(col: number, cols: number): number {
  return BOARD_CX - ((cols - 1) * CELL_PITCH) / 2 + col * CELL_PITCH;
}

/** cellY(row, rows) = BOARD_CY - (rows - 1) * CELL_PITCH / 2 + row * CELL_PITCH */
export function cellY(row: number, rows: number): number {
  return BOARD_CY - ((rows - 1) * CELL_PITCH) / 2 + row * CELL_PITCH;
}

/** The center of cell (col, row) on a cols x rows board, in stage units. */
export function cellCenter(
  col: number,
  row: number,
  cols: number,
  rows: number,
): { x: number; y: number } {
  return { x: cellX(col, cols), y: cellY(row, rows) };
}

// ---------------------------------------------------------------------------
// The board and its notation — specs/board.md "Board notation".
// ---------------------------------------------------------------------------

export type NodeKind = "emitter" | "lens" | "crystal";

export interface BoardNode {
  col: number;
  row: number;
  kind: NodeKind;
  /** The channel an emitter or lens belongs to; null for a crystal (channel-neutral). */
  channel: Channel | null;
  /** 1..MAX_CHARGES for a crystal; null for emitters and lenses. */
  charges: number | null;
}

export interface Board {
  cols: number;
  rows: number;
  nodes: BoardNode[];
}

type NodeSpec = Pick<BoardNode, "kind" | "channel" | "charges">;

/** specs/board.md notation table: one character per cell. */
const CHAR_TO_NODE: Readonly<Record<string, NodeSpec>> = {
  T: { kind: "emitter", channel: "triangle", charges: null },
  S: { kind: "emitter", channel: "square", charges: null },
  D: { kind: "emitter", channel: "diamond", charges: null },
  t: { kind: "lens", channel: "triangle", charges: null },
  s: { kind: "lens", channel: "square", charges: null },
  d: { kind: "lens", channel: "diamond", charges: null },
  "1": { kind: "crystal", channel: null, charges: 1 },
  "2": { kind: "crystal", channel: null, charges: 2 },
  "3": { kind: "crystal", channel: null, charges: 3 },
};

/**
 * Parse a board-notation string (one row of characters per board row, top-left
 * to bottom-right) into a Board. Throws on a malformed string: ragged rows,
 * an unknown character, or dimensions outside 1..GRID_MAX_COLS x
 * 1..GRID_MAX_ROWS. Leading/trailing blank lines and per-line surrounding
 * whitespace are tolerated so fixtures can be written as template literals.
 */
export function parseBoard(notation: string): Board {
  const lines = notation
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("empty board notation");
  const rows = lines.length;
  const first = lines[0];
  if (first === undefined) throw new Error("empty board notation");
  const cols = first.length;
  if (rows < 1 || rows > GRID_MAX_ROWS) {
    throw new Error(`rows must be 1..${GRID_MAX_ROWS}, got ${rows}`);
  }
  if (cols < 1 || cols > GRID_MAX_COLS) {
    throw new Error(`cols must be 1..${GRID_MAX_COLS}, got ${cols}`);
  }
  const nodes: BoardNode[] = [];
  for (let row = 0; row < rows; row++) {
    const line = lines[row];
    if (line === undefined || line.length !== cols) {
      throw new Error(
        `row ${row} carries ${line?.length ?? 0} characters; every row must carry ${cols}`,
      );
    }
    for (let col = 0; col < cols; col++) {
      const ch = line[col];
      if (ch === undefined) continue;
      if (ch === ".") continue;
      const spec = CHAR_TO_NODE[ch];
      if (spec === undefined) {
        throw new Error(`unknown board character '${ch}' at (${col}, ${row})`);
      }
      nodes.push({
        col,
        row,
        kind: spec.kind,
        channel: spec.channel,
        charges: spec.charges,
      });
    }
  }
  return { cols, rows, nodes };
}

/** The notation character for one node — the inverse of the parse table. */
export function nodeChar(
  node: Pick<BoardNode, "kind" | "channel" | "charges">,
): string {
  if (node.kind === "crystal") {
    if (
      node.charges === null ||
      node.charges < 1 ||
      node.charges > MAX_CHARGES
    ) {
      throw new Error(`crystal charges must be 1..${MAX_CHARGES}`);
    }
    return String(node.charges);
  }
  const byChannel: Record<Channel, [emitter: string, lens: string]> = {
    triangle: ["T", "t"],
    square: ["S", "s"],
    diamond: ["D", "d"],
  };
  if (node.channel === null)
    throw new Error(`${node.kind} must carry a channel`);
  const pair = byChannel[node.channel];
  return node.kind === "emitter" ? pair[0] : pair[1];
}

/** Re-serialize a Board to its notation string (rows joined by '\n'). */
export function boardToNotation(board: Board): string {
  const grid: string[][] = [];
  for (let r = 0; r < board.rows; r++) {
    grid.push(new Array<string>(board.cols).fill("."));
  }
  for (const n of board.nodes) {
    const rowArr = grid[n.row];
    if (rowArr === undefined || n.col < 0 || n.col >= board.cols) {
      throw new Error(
        `node at (${n.col}, ${n.row}) is off the ${board.cols}x${board.rows} board`,
      );
    }
    rowArr[n.col] = nodeChar(n);
  }
  return grid.map((r) => r.join("")).join("\n");
}

/** The channels that have any node (emitter or lens) on the board. */
export function channelsPresent(board: Board): Channel[] {
  return CHANNELS.filter((ch) => board.nodes.some((n) => n.channel === ch));
}

/**
 * Structural legality per specs/board.md: dimensions in range, at most one
 * node per cell (guaranteed by parse, re-checked for hand-built Boards),
 * 1 to 3 channels declared, and every channel present carrying exactly two
 * emitters. Returns a list of violations; an empty list means legal.
 */
export function validateBoard(board: Board): string[] {
  const violations: string[] = [];
  if (board.cols < 1 || board.cols > GRID_MAX_COLS) {
    violations.push(`cols ${board.cols} outside 1..${GRID_MAX_COLS}`);
  }
  if (board.rows < 1 || board.rows > GRID_MAX_ROWS) {
    violations.push(`rows ${board.rows} outside 1..${GRID_MAX_ROWS}`);
  }
  const seen = new Set<string>();
  for (const n of board.nodes) {
    const key = `${n.col},${n.row}`;
    if (seen.has(key))
      violations.push(`cell (${n.col}, ${n.row}) holds more than one node`);
    seen.add(key);
    if (n.col < 0 || n.col >= board.cols || n.row < 0 || n.row >= board.rows) {
      violations.push(`node at (${n.col}, ${n.row}) is off the board`);
    }
    if (n.kind === "crystal") {
      if (n.charges === null || n.charges < 1 || n.charges > MAX_CHARGES) {
        violations.push(
          `crystal at (${n.col}, ${n.row}) carries charges outside 1..${MAX_CHARGES}`,
        );
      }
    } else if (n.channel === null) {
      violations.push(`${n.kind} at (${n.col}, ${n.row}) carries no channel`);
    }
  }
  const present = channelsPresent(board);
  if (present.length < 1 || present.length > 3) {
    violations.push(
      `a board declares 1 to 3 channels; this one declares ${present.length}`,
    );
  }
  for (const ch of present) {
    const emitters = board.nodes.filter(
      (n) => n.kind === "emitter" && n.channel === ch,
    ).length;
    if (emitters !== 2) {
      violations.push(
        `channel ${ch} has ${emitters} emitters; every channel present has exactly two`,
      );
    }
  }
  return violations;
}
