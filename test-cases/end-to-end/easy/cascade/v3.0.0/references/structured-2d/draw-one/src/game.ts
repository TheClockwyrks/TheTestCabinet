// Cascade — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session (specs/state.md). `CascadeInstance.initialize` runs once, before the
// level opens — define the ten cues and return the debug surface, which the
// engine holds and returns from `engine.debug`. `CascadeMode` runs the level:
// its `gameStateClass` is `CascadeState`, so the engine builds the state below
// when the world opens; its `beginPlay` adds the single player (possessing
// nothing) whose controller reads the pointer, and registers the diagnostic
// sources; and its `tick` is the bookkeeping and the cascade every frame owes
// the game.
//
// THE STATE BELOW IS A CONTRACT (specs/state.md). It is the world's game state
// — `engine.world.state` is the one instance of it — and the framework's states
// are LIVE objects: a tick writes the fields it advances in place, and each
// field initializer is that field's title-screen value, the same value the debug
// surface's `reset` restores. It is the whole of the authoritative game: every
// value carried from one frame to the next lives on it apart from the painted
// layer's drawing surface, which `specs/state.md` names as the one exception,
// and every other module is either arithmetic over these fields or a system
// that writes them through the paths play runs on.
//
// Cascade registers the four menu actions specs/controls.md names and selects no
// touch layout: every
// control is a rectangle the pointer lands in (specs/controls.md), which both
// the engine reports without any registration. Cascade's screens run on
// `screen` rather than the match phase, so the mode never calls `setPhase` and
// the inherited `phase` stays `"waiting"`.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@test-cabinet/structured-2d";
import { applyAudio, defineCues, noCues } from "./audio";
import { advanceCascade } from "./cascade";
import { DEFAULT_SEED, LEVELS, MENU_BINDINGS, TAGS } from "./constants";
import { CascadeController } from "./controller";
import { createDebugApi, type CascadeDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { CascadeTable, FlightDeck, Hud } from "./table";
import { COLOR } from "./theme";
import { PaintedLayer } from "./trail";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { CascadeDebugApi };

/**
 * The table background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the felt.
 */
export const BACKGROUND: string = COLOR.felt;

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
  /** The selected item on the menu the current screen shows. */
  menuIndex = 0;
  /** The title menu's remembered selection: the entry last activated there. */
  titleIndex = 0;

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
   * The painted layer's drawing surface: a resource rather than a value, the
   * same handle from frame to frame, and the one thing `specs/state.md` allows
   * beside the declared fields. How many stamps it holds is the declared field
   * `trailStamps`.
   */
  readonly trail = new PaintedLayer();
}

/**
 * The open world's state, as the state it is: the mode names `CascadeState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
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
 * and returns the debug surface `specs/instrumentation.md` fixes. The surface
 * reads the live world off the engine at each call, so it holds no state of its
 * own. No action is registered, because Cascade binds no key: the pointer is
 * the whole of its input and the engine reports it without registration.
 */
class CascadeInstance extends GameInstance<CascadeDebugApi> {
  override initialize(api: InitApi): CascadeDebugApi {
    defineCues(api);
    // The four menu actions specs/controls.md names, each bound to the codes it
    // fixes. The engine owns the keyboard, so the game registers names and the
    // player controller reads press edges back through `this.input.pressed`.
    for (const [name, keys] of Object.entries(MENU_BINDINGS)) {
      api.input.register(name, { keys: [...keys] });
    }
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the pointer
 * plays the table rather than driving a pawn — and registers the diagnostic
 * sources with the world's overlay registry. The frame's pointer samples are
 * resolved in that player's controller (`src/controller.ts`) rather than here,
 * because controllers tick before any actor: what the controller writes is what
 * this tick advances and what this frame draws.
 *
 * `tick` accumulates game time, mirrors the engine's mute bit, and advances the
 * victory cascade. Every rate is per second and integrated against the delta
 * the engine hands it, so the simulation reads nothing from the renderer
 * (specs/overview.md, specs/victory.md).
 */
class CascadeMode extends GameMode {
  override gameStateClass = CascadeState;
  override playerControllerClass = CascadeController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's pointer samples are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = cascadeState(this.world);
    // Accumulated simulation time, on every screen; `dt` is already seconds.
    state.simTime += dt;
    // The game's readable copy of the engine's mute bit, refreshed each frame
    // (specs/state.md). The runtime owns muting; this field is what the
    // snapshot reports.
    state.muted = this.world.audio.muted();

    const cues = noCues();
    advanceCascade(state, dt, cues);
    applyAudio(this.world.audio, state, cues);
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * three actors in it, and the name `engine.initialize` opens the level under.
 * `src/main.ts` binds it to the engine; the actors' draw components render the
 * state the mode advances.
 */
export const game: GameDefinition<CascadeDebugApi> = {
  instance: CascadeInstance,
  levels: {
    [LEVELS.table]: {
      mode: CascadeMode,
      actors: [
        { type: CascadeTable, tags: [TAGS.table] },
        { type: FlightDeck, tags: [TAGS.cascade] },
        { type: Hud, tags: [TAGS.hud] },
      ],
    },
  },
  startLevel: LEVELS.table,
};
