// Refract — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the
// one way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching
// the open world through the accessor the instance supplies — `engine.world`
// at the call — and takes only the parameters its own heading names. A POSE
// arranges the running game through the same systems play uses and returns
// nothing; a READING returns plain data built at the call and changes nothing.
// The pointer operations do not stand in for the engine's pointer: they feed
// the SAME per-sample resolution path the player controller feeds
// (`src/tracing.ts`), so the hit radius, the grab table, the limits, and the
// completion test all run exactly as they do in play, and each call takes
// effect immediately rather than waiting on a frame. The cues an operation's
// events raise are played on the world's bus, once per kind per call, exactly
// as the controller plays a tick's.
//
// The surface holds no state and is inert during normal play: nothing below
// runs until something calls it.

import type { World } from "@test-cabinet/structured-2d";
import { playEvents } from "./audio";
import { cellCenter, emptyBeams, parseBoard } from "./board";
import { DEFAULT_SEED, REFRACT_DEBUG_VERSION } from "./constants";
import { resetState, startMode as startModePose } from "./flow";
import { beamComplete, boardSolved, spentAt } from "./rules";
import {
  clearBeams,
  mergeEvents,
  noEvents,
  pointerDown,
  pointerMove,
  pointerUp,
  type TraceEvents,
} from "./tracing";
import {
  refractState,
  type Channel,
  type Mode,
  type NodeKind,
  type RefractState,
  type Screen,
} from "./game";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

export interface SnapshotNode {
  col: number;
  row: number;
  /** The cell center on the stage, derived from the board's dimensions. */
  x: number;
  y: number;
  kind: NodeKind;
  channel: Channel | null;
  charges: number | null;
  /** A crystal's spent charge count; `null` for an emitter and a lens. */
  spent: number | null;
}

export interface SnapshotBeam {
  /** The cells the beam runs through, in the order they were drawn. */
  cells: { col: number; row: number }[];
  /** R6 and R7, derived rather than stored. */
  complete: boolean;
}

export interface RefractSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  /** The screen's highlighted menu item; rests at `0` on `playing`. */
  menuIndex: number;
  boardIndex: number;
  solvedBoards: number[];
  unlockedCount: number;
  /** The board highlighted on the campaign select grid. */
  selectIndex: number;
  solvedCount: number;
  tier: number;
  board: {
    cols: number;
    rows: number;
    nodes: SnapshotNode[];
  };
  /** One entry per channel present on the board, and none for the rest. */
  beams: Partial<Record<Channel, SnapshotBeam>>;
  /** R9, derived rather than stored. */
  solved: boolean;
  tracing: { channel: Channel; live: { col: number; row: number } } | null;
  pointer: { x: number; y: number; down: boolean };
  muted: boolean;
  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose acts on the live world at the call and returns
 * nothing; the one reading, `snapshot`, returns what it read.
 */
export interface RefractDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): RefractSnapshot;
  startMode(mode: Mode): void;
  loadBoard(board: readonly string[]): void;
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
  trace(cells: readonly { col: number; row: number }[]): void;
  clear(): void;
}

/**
 * Build the surface over an accessor for the open world. It holds nothing:
 * every operation reads the world — and the state and cue bus it carries — at
 * the moment it is called, so the surface follows the live game for the life
 * of the engine.
 */
export function createDebugApi(world: () => World): RefractDebugApi {
  const state = (): RefractState => refractState(world());

  /** Play the cues one operation's events raised, once per kind per call. */
  const play = (events: TraceEvents, clear = false): void => {
    playEvents(world().audio, { ...events, clear });
  };

  return {
    version: REFRACT_DEBUG_VERSION,

    /**
     * Every declared field back at its title-screen value, with `rngState`
     * seeded. `muted` is deliberately untouched: muting is a player
     * preference the runtime owns, and a reset is not a reason to start
     * making noise again.
     */
    reset(options) {
      resetState(state(), options?.seed ?? DEFAULT_SEED);
    },

    /** A pure read. It never changes anything. */
    snapshot() {
      const live = state();
      const beams: Partial<Record<Channel, SnapshotBeam>> = {};
      for (const beam of live.beams) {
        beams[beam.channel] = {
          cells: beam.cells.map(({ col, row }) => ({ col, row })),
          complete: beamComplete(live.board, beam),
        };
      }
      const liveBeam =
        live.tracing === null
          ? null
          : (live.beams.find(
              (beam) => beam.channel === live.tracing?.channel,
            ) ?? null);
      const liveEnd =
        liveBeam && liveBeam.cells.length > 0
          ? liveBeam.cells[liveBeam.cells.length - 1]
          : null;
      return {
        version: REFRACT_DEBUG_VERSION,
        screen: live.screen,
        mode: live.mode,
        menuIndex: live.menuIndex,
        boardIndex: live.boardIndex,
        solvedBoards: [...live.solvedBoards],
        unlockedCount: live.unlockedCount,
        selectIndex: live.selectIndex,
        solvedCount: live.solvedCount,
        tier: live.tier,
        board: {
          cols: live.board.cols,
          rows: live.board.rows,
          nodes: live.board.nodes.map((node) => {
            const [x, y] = cellCenter(node, live.board);
            return {
              col: node.col,
              row: node.row,
              x,
              y,
              kind: node.kind,
              channel: node.channel,
              charges: node.charges,
              spent: node.kind === "crystal" ? spentAt(live.beams, node) : null,
            };
          }),
        },
        beams,
        solved: boardSolved(live.board, live.beams),
        tracing:
          live.tracing !== null && liveEnd !== null
            ? {
                channel: live.tracing.channel,
                live: { col: liveEnd.col, row: liveEnd.row },
              }
            : null,
        pointer: {
          x: live.pointer.x,
          y: live.pointer.y,
          down: live.pointer.down,
        },
        muted: live.muted,
        simTime: live.simTime,
      };
    },

    /**
     * The choice of a mode from the title menu, exactly as choosing its item
     * does: Campaign to its select grid with the session's progress as it
     * stands, Cascade to a fresh sequence from tier 1 on a generated board.
     */
    startMode(mode) {
      startModePose(state(), mode);
    },

    /**
     * An arbitrary board posed onto the `playing` screen with every beam
     * empty and no trace live — the surface's main lever. The notation is
     * validated as it is parsed, and a board posed this way is a board like
     * any other: the rules apply to it unchanged.
     */
    loadBoard(board) {
      const parsed = parseBoard(board);
      const live = state();
      live.board = parsed;
      live.beams = emptyBeams(parsed);
      live.tracing = null;
      live.screen = "playing";
      live.menuIndex = 0;
    },

    /** A press, resolved immediately through the real input path. */
    pointerDown(x, y) {
      play(pointerDown(state(), x, y));
    },

    /** A move, resolved immediately: extend, retract, or a refused no-op. */
    pointerMove(x, y) {
      play(pointerMove(state(), x, y));
    },

    /** A release: the trace ends and the beam stays exactly as drawn. */
    pointerUp() {
      play(pointerUp(state()));
    },

    /**
     * Sugar over the three pointer operations: a press at the first cell's
     * center, a move to each remaining center in turn, then a release. A list
     * the limits refuse part way through leaves the beam ending at the last
     * segment they permitted, and the whole route is one batch, so each cue
     * plays at most once for the call.
     */
    trace(cells) {
      if (cells.length === 0) return;
      const live = state();
      const events = noEvents();
      const [firstX, firstY] = cellCenter(cells[0], live.board);
      mergeEvents(events, pointerDown(live, firstX, firstY));
      for (const cell of cells.slice(1)) {
        const [x, y] = cellCenter(cell, live.board);
        mergeEvents(events, pointerMove(live, x, y));
      }
      mergeEvents(events, pointerUp(live));
      play(events);
    },

    /** The `clear` action: every beam emptied, on the playing screen alone. */
    clear() {
      play(noEvents(), clearBeams(state()));
    },
  };
}
