// Cascade — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE `GameDefinition` with ONE level. The engine opens that level
// at `startLevel` and the game never opens another: every screen is a value of
// the state's `screen` field (`specs/screens.md`), so the world and its game
// state live for the whole session and the table survives from the title screen
// to the victory cascade without being rebuilt.
//
// `CascadeInstance.initialize` runs once, before the level opens. It defines the
// ten cues `specs/audio.md` names and returns the debug surface
// `specs/instrumentation.md` fixes, which the engine holds and hands back from
// `engine.debug`. Nothing is installed on the page.
//
// `CascadeMode` runs the level. Its `gameStateClass` is `CascadeState`, so the
// engine builds the state below when the world opens; its `beginPlay` adds the
// single player — possessing nothing, because the table is played with the
// pointer rather than by driving a pawn — and registers the diagnostic sources
// the overlay shows; and its `tick` is the whole of the simulation the frame
// owes the game.
//
// THE STATE BELOW IS A CONTRACT (`specs/state.md`), written into this module
// exactly as that file states it. It is the world's game state —
// `engine.world.state` is the one instance of it — and the framework's states
// are LIVE objects: a tick writes the fields it advances in place, and each
// field initializer is that field's title-screen value, the same value the debug
// surface's `reset` restores. It is the whole of the authoritative game: every
// value carried from one frame to the next lives on it, apart from the drawing
// resource the painted layer needs, and nothing is kept in a module-level
// variable or a closure.
//
// Cascade's screens run on `screen` rather than on the match phase: the mode
// never calls `setPhase`, so the inherited `phase` stays `"waiting"` and
// `elapsed` stays `0`.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@test-cabinet/structured-2d";
import { applyEvents, defineCues, noEvents } from "./audio";
import { advanceCascade } from "./cascade";
import { DEFAULT_SEED, LEVELS, TAGS } from "./constants";
import { CascadeController } from "./controller";
import { createDebugApi, type CascadeDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { CascadeTable, FlyingCards, Hud } from "./table";
import { BACKGROUND as FELT } from "./theme";
import { Trail } from "./trail";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { CascadeDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the colour the
 * canvas is cleared to each frame, so the letterbox bars around the table match
 * the felt itself.
 */
export const BACKGROUND: string = FELT;

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen = "title" | "howto" | "playing" | "won";

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

export type PileKind = "stock" | "waste" | "foundation" | "tableau";

export interface CardState {
  id: number;
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

export interface DragState {
  cards: CardState[];
  fromPile: "waste" | "foundation" | "tableau";
  fromIndex: number;
  x: number;
  y: number;
}

export interface DropTargetState {
  pile: "foundation" | "tableau";
  index: number;
}

export interface PointerState {
  x: number;
  y: number;
  down: boolean;
}

export interface PressState {
  x: number;
  y: number;
  at: number;
}

export interface FlyerState {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class CascadeState extends GameState {
  screen: Screen = "title";

  stock: CardState[] = [];
  waste: CardState[] = [];
  wasteSets: number[] = [];
  foundations: CardState[][] = [[], [], [], []];
  tableau: CardState[][] = [[], [], [], [], [], [], []];

  drag: DragState | null = null;
  dropTarget: DropTargetState | null = null;
  pointer: PointerState = { x: 0, y: 0, down: false };
  lastPress: PressState | null = null;

  autoFlip = true;
  winDetect = true;
  launching = true;
  trailPainting = true;

  launchClock = 0;
  launched = 0;
  flyers: FlyerState[] = [];
  cascadeDone = false;
  trailStamps = 0;

  nextId = 1;
  simTime = 0;
  muted = false;
  rngState = DEFAULT_SEED;

  /**
   * The drawing resource the painted layer needs, which `specs/state.md` allows
   * beside the declared fields. It carries no game value: `trailStamps` is what
   * the game counts and what the surface reports, and the pixels are what the
   * cascade drew. `reset`, a new deal and `clearTrail` all empty it.
   */
  readonly trail = new Trail();
}

/**
 * The open world's state, as the state it is. The mode names `CascadeState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error rather than a silent cast.
 */
export function cascadeState(world: World): CascadeState {
  const state = world.state;
  if (!(state instanceof CascadeState)) {
    throw new Error("Cascade: the open world does not hold a CascadeState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) ---------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. It defines the ten cues
 * and returns the debug surface, which reads the live world off the engine at
 * each call and so holds no state of its own. Cascade registers no actions and
 * selects no touch layout: every control is a rectangle the pointer resolves
 * against (`specs/controls.md`), and the overlay's toggle key is the engine's.
 */
class CascadeInstance extends GameInstance<CascadeDebugApi> {
  override initialize(api: InitApi): CascadeDebugApi {
    defineCues(api);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, because the table is
 * driven through the state rather than as a pawn — and registers the diagnostic
 * sources with the world's overlay registry. That player's controller is where
 * the frame's pointer samples are read (`src/controller.ts`), which is why it is
 * not done here: controllers tick before any actor, so the table is drawn from
 * the state this frame's input produced.
 *
 * `tick` is the simulation. Every rate is per second and integrated against the
 * delta the engine hands it, so the game advances on elapsed time alone and
 * reads nothing from the renderer.
 */
class CascadeMode extends GameMode {
  declare readonly state: CascadeState;

  override gameStateClass = CascadeState;
  override playerControllerClass = CascadeController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's pointer samples are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = this.state;

    // Every update's delta, whatever the screen (specs/state.md).
    state.simTime += dt;
    // The game's readable copy of the runtime's mute bit, refreshed each frame.
    // The runtime owns muting; this field is what the snapshot reports.
    state.muted = this.world.audio.muted();

    const events = noEvents();
    advanceCascade(state, dt, events);
    applyEvents(this.world.audio, events);
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * three actors in it, and the name `engine.initialize` opens the level under.
 * `src/main.ts` binds it to the engine; each actor's draw components render the
 * state the controller and the mode advance.
 */
export const game: GameDefinition<CascadeDebugApi> = {
  instance: CascadeInstance,
  levels: {
    [LEVELS.table]: {
      mode: CascadeMode,
      actors: [
        { type: CascadeTable, tags: [TAGS.table] },
        { type: FlyingCards, tags: [TAGS.cascade] },
        { type: Hud, tags: [TAGS.hud] },
      ],
    },
  },
  startLevel: LEVELS.table,
};
