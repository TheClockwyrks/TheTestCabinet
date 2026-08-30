// Deepcore — the working copy a frame builds the next state in, and the grid's
// copy-on-write.
//
// The engine holds the state BY VALUE: `update` is handed the current state as a
// `DeepReadonly` view and returns the next one, and nothing ever holds a writable
// reference to a state that has been published. This module is how that rule is
// kept without writing every rule of the game as a nest of spreads.
//
// A frame opens a DRAFT: a fresh, mutable object whose every field is a copy of
// the current state's, so writing to it cannot reach anything the engine handed
// over. The game's systems — physics, the drill, the hazards, the economy — then
// write to that draft exactly as they would to a live world, and `commit` hands
// back the finished value. A debug pose does the same, for the one field it sets.
//
// THE GRID IS THE ONE EXCEPTION, because it is the one big structure: a marathon
// mine is a thousand rows of thirty-two cells, and copying it every frame would
// cost more than the simulation does. It is shared with the state the draft was
// opened from and replaced a cell at a time instead: `writeTile` returns a new
// grid whose one changed row is a new array, and a `Tile` is never written to,
// only replaced. So a draft that changes nothing shares the whole grid, and one
// that breaks a cell copies one row.
//
// The draft also carries the frame's three OUTPUT QUEUES — the cues to play, the
// loops that should be sounding, and the effects to spawn. They belong to the
// moment rather than to the expedition, so `commit` drops them: `update` drains
// them into the engine's audio and into the effects pool once the frame's rules
// have all run.

import { WORLD_COLS } from "./constants";
import type { CueName, ItemId, OreId, TrackName } from "./constants";
import type {
  DeepcoreState,
  Dying,
  Grid,
  GroundItem,
  MaterialNode,
  Miner,
  MoveInput,
  Note,
  Notice,
  PointerState,
  RunSummary,
  Satchel,
  ScanResult,
  Tile,
} from "./game";
import type { LoopCue } from "./audio";
import type { FxEvent } from "./effects";
import type { DeepReadonly, DeepWritable, Writable } from "ts-essentials";

/** The miner as a draft holds it: the same fields, writable. */
export type MutableMiner = DeepWritable<Miner>;

/** The mutable twin of {@link DeepcoreState}, plus the frame's output queues. */
export interface Draft {
  screen: DeepcoreState["screen"];
  menuIndex: number;
  mode: DeepcoreState["mode"];
  pendingMode: DeepcoreState["mode"];
  worldSize: DeepcoreState["worldSize"];
  coreRow: number;
  panel: DeepcoreState["panel"];
  credits: number;
  creditsEarned: number;
  cargo: Record<OreId, number>;
  satchel: Writable<Satchel>;
  tiers: Record<TrackName, number>;
  installed: DeepcoreState["installed"][number][];
  items: Record<ItemId, number>;
  groundItems: Writable<GroundItem>[];
  coreTimer: number | null;
  deepestDepthMeters: number;
  elapsedSeconds: number;
  summary: Writable<RunSummary> | null;
  deathCause: DeepcoreState["deathCause"];
  grid: Grid;
  nodes: Writable<MaterialNode>[];
  miner: MutableMiner;
  camX: number;
  camY: number;
  camLead: number;
  simTime: number;
  muted: boolean;
  hasSave: boolean;
  rngState: number;
  input: Writable<MoveInput>;
  pointer: Writable<PointerState>;
  notes: Writable<Note>[];
  hurtT: number;
  dying: Writable<Dying> | null;
  launchAnim: number | null;
  scan: Writable<ScanResult>;
  shakeT: number;
  shakeAmp: number;
  drillFxCd: number;
  thrustFxCd: number;
  lavaFxCd: number;
  gasSeepCd: number;
  gasSeepIndex: number;
  notice: Writable<Notice> | null;
  noticesFired: { gas: boolean; lava: boolean };
  assets: DeepcoreState["assets"];

  /** One-shot cues this frame raised, played once each when it ends. */
  cues: CueName[];
  /** The loops that should be sounding when this frame ends. */
  loops: Set<LoopCue>;
  /** The effect bursts this frame raised, spawned when it ends. */
  fx: FxEvent[];
}

/**
 * Open a draft on the current state.
 *
 * Every field that a rule can write is copied, so nothing reachable from `state`
 * is ever written to. The grid, the loaded assets, and the finished summary are
 * shared, because the first is replaced a cell at a time and the other two are
 * never written at all.
 */
export function draft(state: DeepReadonly<DeepcoreState>): Draft {
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,
    mode: state.mode,
    pendingMode: state.pendingMode,
    worldSize: state.worldSize,
    coreRow: state.coreRow,
    panel: state.panel,
    credits: state.credits,
    creditsEarned: state.creditsEarned,
    cargo: { ...state.cargo },
    satchel: { ...state.satchel },
    tiers: { ...state.tiers },
    installed: [...state.installed],
    items: { ...state.items },
    groundItems: state.groundItems.map((item) => ({ ...item })),
    coreTimer: state.coreTimer,
    deepestDepthMeters: state.deepestDepthMeters,
    elapsedSeconds: state.elapsedSeconds,
    summary: state.summary === null ? null : { ...state.summary },
    deathCause: state.deathCause,
    grid: state.grid,
    nodes: state.nodes.map((node) => ({ ...node })),
    miner: {
      ...state.miner,
      drilling:
        state.miner.drilling === null ? null : { ...state.miner.drilling },
    },
    camX: state.camX,
    camY: state.camY,
    camLead: state.camLead,
    simTime: state.simTime,
    muted: state.muted,
    hasSave: state.hasSave,
    rngState: state.rngState,
    input: { ...state.input },
    pointer: { ...state.pointer },
    notes: state.notes.map((note) => ({ ...note })),
    hurtT: state.hurtT,
    dying: state.dying === null ? null : { ...state.dying },
    launchAnim: state.launchAnim,
    scan: { ...state.scan },
    shakeT: state.shakeT,
    shakeAmp: state.shakeAmp,
    drillFxCd: state.drillFxCd,
    thrustFxCd: state.thrustFxCd,
    lavaFxCd: state.lavaFxCd,
    gasSeepCd: state.gasSeepCd,
    gasSeepIndex: state.gasSeepIndex,
    notice: state.notice === null ? null : { ...state.notice },
    noticesFired: { ...state.noticesFired },
    assets: state.assets,
    cues: [],
    loops: new Set(),
    fx: [],
  };
}

/**
 * Close a draft: the finished value, with the frame's output queues dropped.
 *
 * Every field is named, so a field added to the state and forgotten here fails
 * the type check rather than silently resting at its previous value.
 */
export function commit(d: Draft): DeepcoreState {
  return {
    screen: d.screen,
    menuIndex: d.menuIndex,
    mode: d.mode,
    pendingMode: d.pendingMode,
    worldSize: d.worldSize,
    coreRow: d.coreRow,
    panel: d.panel,
    credits: d.credits,
    creditsEarned: d.creditsEarned,
    cargo: d.cargo,
    satchel: d.satchel,
    tiers: d.tiers,
    installed: d.installed,
    items: d.items,
    groundItems: d.groundItems,
    coreTimer: d.coreTimer,
    deepestDepthMeters: d.deepestDepthMeters,
    elapsedSeconds: d.elapsedSeconds,
    summary: d.summary,
    deathCause: d.deathCause,
    grid: d.grid,
    nodes: d.nodes,
    miner: d.miner,
    camX: d.camX,
    camY: d.camY,
    camLead: d.camLead,
    simTime: d.simTime,
    muted: d.muted,
    hasSave: d.hasSave,
    rngState: d.rngState,
    input: d.input,
    pointer: d.pointer,
    notes: d.notes,
    hurtT: d.hurtT,
    dying: d.dying,
    launchAnim: d.launchAnim,
    scan: d.scan,
    shakeT: d.shakeT,
    shakeAmp: d.shakeAmp,
    drillFxCd: d.drillFxCd,
    thrustFxCd: d.thrustFxCd,
    lavaFxCd: d.lavaFxCd,
    gasSeepCd: d.gasSeepCd,
    gasSeepIndex: d.gasSeepIndex,
    notice: d.notice,
    noticesFired: d.noticesFired,
    assets: d.assets,
  };
}

// ---- The grid's copy-on-write --------------------------------------------

/** One cell, or `null` where the coordinates fall outside the grid. */
export function tileAt(grid: Grid, col: number, row: number): Tile | null {
  return grid[row]?.[col] ?? null;
}

/** A grid with one cell replaced. The row it changes is the only one copied. */
export function writeTile(
  grid: Grid,
  col: number,
  row: number,
  tile: Tile,
): Grid {
  const line = grid[row];
  if (!line || col < 0 || col >= line.length) return grid;
  const rows = grid.slice();
  const next = line.slice();
  next[col] = tile;
  rows[row] = next;
  return rows;
}

/**
 * A grid with several cells replaced, each row copied once however many of its
 * cells change. A blast that clears a block goes through here rather than
 * through `writeTile` cell by cell.
 */
export function writeTiles(
  grid: Grid,
  edits: readonly { col: number; row: number; tile: Tile }[],
): Grid {
  if (edits.length === 0) return grid;
  const rows: (readonly Tile[])[] = grid.slice();
  const copied = new Set<number>();
  for (const edit of edits) {
    const line = rows[edit.row];
    if (!line || edit.col < 0 || edit.col >= line.length) continue;
    if (!copied.has(edit.row)) {
      rows[edit.row] = line.slice();
      copied.add(edit.row);
    }
    (rows[edit.row] as Tile[])[edit.col] = edit.tile;
  }
  return rows;
}

/** Replace one cell of the draft's grid. */
export function setDraftTile(
  d: Draft,
  col: number,
  row: number,
  tile: Tile,
): void {
  d.grid = writeTile(d.grid, col, row, tile);
}

/** Whether a column is inside the grid's width. */
export function inGridCol(col: number): boolean {
  return col >= 0 && col < WORLD_COLS;
}
