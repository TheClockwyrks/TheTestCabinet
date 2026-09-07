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

import type { World } from "@clockwyrks/structured-2d";
import { playEvents } from "./audio";
import { cellCenter, emptyBeams, parseBoard } from "./board";
import { DEFAULT_SEED, REFRACT_DEBUG_VERSION } from "./constants";
import { resetState } from "./flow";
import { beamComplete, boardSolved, spentAt } from "./rules";
import { targetsFor } from "./layout";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import { noEvents, performClearBeams, type TraceEvents } from "./tracing";
import {
  refractState,
  type Channel,
  type Mode,
  type NodeKind,
  type PointerDevice,
  type RefractState,
  type Screen,
} from "./game";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

/** One pointer target, as the snapshot reports it. */
export interface SnapshotTarget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  pointer: {
    x: number;
    y: number;
    down: boolean;
    device: PointerDevice;
  };
  /** The current screen's pointer targets, in the order specs/controls.md fixes. */
  targets: SnapshotTarget[];
  muted: boolean;
  simTime: number;
  /** The seeded generator's current state. */
  rngState: number;
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
  /** Bring every reported reading into agreement with the board as it stands. */
  reconcile(): void;
  setMode(mode: Mode): void;
  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  loadBoard(board: readonly string[]): void;
  pointerDown(x: number, y: number, device?: PointerDevice): void;
  pointerMove(x: number, y: number, device?: PointerDevice): void;
  pointerUp(device?: PointerDevice): void;
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
          device: live.pointer.device,
        },
        targets: targetsFor(live).map((target) => ({ ...target })),
        muted: live.muted,
        simTime: live.simTime,
        rngState: live.rngState,
      };
    },

    /**
     * Bring every reported reading into agreement with the board as it stands.
     *
     * Every derived reading this build reports — a node's `x` and `y`, a
     * crystal's `spent`, a beam's `complete`, `solved`, and `targets` — is
     * worked out at the read, in `snapshot` above, from the board's dimensions,
     * the drawn beams and the current screen. Nothing is held that a pose can
     * leave behind, so there is nothing here to rewrite. The operation is
     * required of every build, including one that keeps those readings as stored
     * copies, and this is what it comes to in a build that does not.
     *
     * It advances nothing and it corrects nothing either way: the clock stays
     * where it is, nothing is drawn from the generator, no cue plays, and a beam
     * drawn past a crystal's charges reads as it was drawn rather than being
     * trimmed back to a legal route.
     */
    reconcile() {},

    /** The mode field alone. No screen moves, and no board is generated. */
    setMode(mode) {
      state().mode = mode;
    },

    /**
     * The screen field alone. Everything the screen draws is left as it is,
     * and nothing stays armed, exactly as leaving a screen in play disarms it.
     */
    setScreen(screen) {
      const live = state();
      live.screen = screen;
      live.armedTarget = null;
    },

    /** The highlighted item on whichever menu the current screen shows. */
    setMenuIndex(index) {
      state().menuIndex = index;
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
    pointerDown(x, y, device = "mouse") {
      play(pointerDown(state(), x, y, device));
    },

    /** A move, resolved immediately: extend, retract, or a refused no-op. */
    pointerMove(x, y, device = "mouse") {
      play(pointerMove(state(), x, y, device));
    },

    /** A release: the trace ends and the beam stays exactly as drawn. */
    pointerUp(device = "mouse") {
      play(pointerUp(state(), device));
    },

    /**
     * The `clear` action's own transaction: every beam on the board emptied and
     * any live trace ended, from wherever the game stands.
     *
     * It does NOT ask which screen is up. That is the player's route to the
     * action — `specs/controls.md` reads the key on `playing` alone, and
     * `tryClearBeams` is where that lives — and an operation never asks whether
     * a player could have pressed it (specs/instrumentation.md, "The
     * operations"). A check about the action being unreachable presses the key.
     */
    clear() {
      play(noEvents(), performClearBeams(state()));
    },
  };
}
