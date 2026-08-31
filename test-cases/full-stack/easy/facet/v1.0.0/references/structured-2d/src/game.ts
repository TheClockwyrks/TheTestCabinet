// Facet — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session. `FacetInstance.initialize` runs once, before the level opens — it
// registers the actions, defines the eight cues over the produced sounds, and
// returns the debug surface, which the engine holds and returns from
// `engine.debug`. `FacetMode` runs that level: its `gameStateClass` is
// `FacetState`, so the engine builds the state below when the world opens; its
// `beginPlay` adds the single player (possessing nothing) whose controller
// reads the frame's actions and pointer, and registers the diagnostic sources;
// and its `tick` advances the simulation, accumulates `simTime`, and mirrors
// the engine's mute bit (specs/state.md, specs/instrumentation.md).
//
// THE RULES ARE NOT HERE. `src/core/` is Facet's whole simulation — the board,
// R1 to R9, the chain cadence, the screens, and the pose logic behind the debug
// surface — written against nothing but `src/constants.ts`, so a score recorded
// under this engine means exactly what a score recorded under another does.
// This file declares the state the ENGINE holds; `src/bridge.ts` is the one
// place that carries it into the core's own shape and back.
//
// THE STATE SHAPE BELOW IS A CONTRACT (specs/state.md). It is the world's game
// state — `engine.world.state` is the one instance of it — and the framework's
// states are LIVE objects: a tick writes the fields it advances in place, and
// each field initializer is that field's title-screen value, the same value the
// debug surface's `reset` restores. It is the whole of the authoritative game:
// every value carried from one frame to the next lives on it, and nothing is
// kept in a module-level variable or a closure. Facet's screens run on `screen`
// rather than on the match phase: the mode never calls `setPhase`, so the
// inherited `phase` stays `"waiting"` and `elapsed` stays `0`.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@test-cabinet/structured-2d";
import { loadAssets } from "./assets";
import { defineCues, loadCues } from "./audio";
import { Bench } from "./bench";
import { CURSOR_START_COL, CURSOR_START_ROW, DEFAULT_SEED } from "./constants";
import { FacetController } from "./controller";
import { createDebugApi, type FacetDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { advanceFrame } from "./frame";
import { registerActions } from "./input";
import { COLOR } from "./theme";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { FacetDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars around the stage match
 * the field the board sits on.
 */
export const BACKGROUND: string = COLOR.bg;

// ---- The state contract (specs/state.md) ---------------------------------

export type GemKind =
  "ruby" | "amber" | "citrine" | "jade" | "beryl" | "sapphire" | "amethyst";

export type Cut = "plain" | "brilliant" | "star" | "prism";

export type Screen = "title" | "howto" | "playing" | "paused" | "gameover";

export type Phase = "idle" | "resolving";

export interface CellRef {
  col: number;
  row: number;
}

export interface GemState {
  col: number;
  row: number;
  kind: GemKind | null;
  cut: Cut;
  strain: number;
}

export interface BoardState {
  cols: number;
  rows: number;
  cells: GemState[];
}

export interface RefusalState {
  a: CellRef;
  b: CellRef;
  timer: number;
}

export interface PointerState {
  x: number;
  y: number;
  down: boolean;
}

/**
 * The engine's `GameState` under a type that leaves `phase` to Facet.
 *
 * `specs/state.md` declares `phase` as Facet's RESOLUTION phase — `"idle"` or
 * `"resolving"` — "over the framework's", and states the consequences outright:
 * the mode never calls `setPhase`, and `elapsed` stays `0`. Both hold here. The
 * engine accumulates `elapsed` only while the field reads the framework's
 * `"playing"`, which Facet's phase never does, and the only other reader of the
 * field is `setPhase` itself, which is never called; the overlay's own phase
 * line reads the game mode's `phase`, not the state's.
 *
 * So the two meanings share one field at runtime and this class IS a
 * `GameState`. The alias below and the one paired with it at
 * `FacetMode.gameStateClass` change nothing but which of the two meanings the
 * type checker enforces over that field, and the specification fixes that it is
 * Facet's.
 */
const GameStateBase = GameState as unknown as new () => Omit<
  GameState,
  "phase"
>;

export class FacetState extends GameStateBase {
  screen: Screen = "title";
  menuIndex = 0;

  board: BoardState = { cols: 0, rows: 0, cells: [] };
  phase: Phase = "idle";
  chainStep = 0;
  stepTimer = 0;

  score = 0;
  level = 1;
  levelScore = 0;
  lastCleared = 0;
  lastPoints = 0;

  cursor: CellRef = { col: CURSOR_START_COL, row: CURSOR_START_ROW };
  selection: CellRef | null = null;
  refusal: RefusalState | null = null;

  pointer: PointerState = { x: 0, y: 0, down: false };
  simTime = 0;
  muted = false;
  rngState = DEFAULT_SEED;

  // ---- Bookkeeping the rules need and the snapshot does not report -------
  //
  // Three values are carried from one frame to the next that `specs/state.md`
  // does not name, and every one of them is required for a rule that file
  // points at. They live here rather than in a module variable or a closure
  // because the state is "the whole of the authoritative game": a field kept
  // anywhere else would survive `reset` and put a seeded replay out of step.
  //
  // They are additions to the declared shape, never substitutes: every
  // declared field above keeps its name, its type, and its meaning, and
  // `reset` restores these three alongside them.

  /**
   * The swap that began the chain now running, and `null` while `phase` is
   * `"idle"`. R8 reads it to place a created gem at the cell the chain's swap
   * exchanged (specs/rules.md, R8), which no declared field records.
   */
  chainSwap: { a: CellRef; b: CellRef } | null = null;

  /**
   * The cell a still-held press targeted, and whether that hold has already
   * requested its one swap. `specs/controls.md` decides a drag from the cell
   * the press landed on and permits one swap per hold, and both facts outlive
   * the frame the press arrived in — `selection` cannot stand in for either,
   * since an accepted swap clears it.
   */
  pressedCell: CellRef | null = null;
  dragSwapped = false;
}

/**
 * The open world's state, as the state it is: the mode names `FacetState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
 */
export function facetState(world: World): FacetState {
  const state = world.state;
  if (!(state instanceof FacetState)) {
    throw new Error("Facet: the open world does not hold a FacetState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) --------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. It registers every
 * action against its bindings, declares the cues — synthesized placeholders
 * first so a name always exists, then the produced `.wav` over each — and
 * returns the debug surface `specs/instrumentation.md` fixes. The surface reads
 * the live world off the engine at each call, so it holds no state of its own.
 */
class FacetInstance extends GameInstance<FacetDebugApi> {
  override async initialize(api: InitApi): Promise<FacetDebugApi> {
    registerActions(api);
    defineCues(api);
    await loadCues(api);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the board is
 * played with the pointer and a cursor rather than through a pawn — and
 * registers the diagnostic sources with the world's overlay registry. `tick`
 * runs after every controller and actor has ticked, so it advances the
 * simulation over the state this frame's input already wrote, and it is where
 * `simTime` accumulates and the engine's mute bit is mirrored (specs/state.md).
 */
class FacetMode extends GameMode {
  // The other half of the pair documented at `GameStateBase`: one field, two
  // meanings, and the engine builds the same object either way.
  override gameStateClass = FacetState as unknown as new () => GameState;
  override playerControllerClass = FacetController;
  override pawnClass = null;

  override beginPlay(): void {
    // The bench is the whole of the world's scenery — the two draw layers and
    // the presentation they draw — and the mode spawns it here rather than
    // through the level's `actors` list so the level definition below does not
    // have to name a class out of `src/bench.ts`, which names the state
    // declared above: the two modules refer to each other, and only one of the
    // two references can be resolved before both have loaded.
    this.world.spawn(Bench);
    // `pawnClass` is `null`, so the one player possesses nothing; its
    // controller is where the frame's actions and pointer samples are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = facetState(this.world);
    // The frame's game time, run through the core: `simTime` accumulates on
    // every screen, and the board, the chain, and the refusal mark advance
    // only on `playing` (specs/ui.md, What advances on each screen). The cues
    // this frame raised — the controller's input events merged with the
    // chain's — are played once each inside it.
    advanceFrame(this.world, state, dt);
    // The game's readable copy of the engine's mute bit, refreshed each frame.
    state.muted = this.world.audio.muted();
  }
}

/**
 * The game this build's engine drives: the instance, the single level, and the
 * name `engine.initialize` opens it under.
 *
 * The level's `load` is awaited before the world is built, so the produced
 * sprites and particle systems are in hand by the time the mode's `beginPlay`
 * spawns the bench and the first frame draws the finished board rather than a
 * half-loaded one. `src/main.ts` binds this definition to the engine.
 */
export const game: GameDefinition<FacetDebugApi> = {
  instance: FacetInstance,
  levels: {
    bench: {
      mode: FacetMode,
      load: loadAssets,
    },
  },
  startLevel: "bench",
};
