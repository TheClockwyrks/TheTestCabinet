// Wireworm — the game: the state contract and the framework objects the engine
// drives.
//
// The game is ONE GameDefinition with ONE level. The engine opens that level at
// `startLevel` and the game never opens another: every screen is a value of the
// state's `screen` field, so the world and its game state live for the whole
// session and the node field survives a level advance without being rebuilt
// (`specs/nodes.md`, The field persists). `WirewormInstance.initialize` runs
// once, before the level opens — register the actions, define the ten cues, load
// the seeded sprite art, and return the debug surface, which the engine holds
// and returns from `engine.debug`. `WirewormMode` runs the level: its
// `gameStateClass` is `WirewormState`, so the engine builds the state below when
// the world opens; its `beginPlay` adds the single player (possessing nothing)
// whose controller reads the frame's actions and registers the diagnostic
// sources; and its `tick` is the whole of the simulation the frame owes the
// game.
//
// THE STATE BELOW IS A CONTRACT (`specs/state.md`). It is the world's game state
// — `engine.world.state` is the one instance of it — and the framework's states
// are LIVE objects: a tick writes the fields it advances in place, and each
// field initializer is that field's title-screen value, the same value the debug
// surface's `reset` restores. It is the whole of the authoritative game: every
// value carried from one frame to the next lives on it, nothing is kept in a
// module-level variable or a closure, and every other module is either
// arithmetic over these fields or a system that writes them through the paths
// play runs on. Wireworm's screens run on `screen` rather than the match phase:
// the mode never calls `setPhase`, so the inherited `phase` stays `"waiting"`
// and `elapsed` stays `0`.

import { GameInstance, GameMode, GameState } from "@test-cabinet/structured-2d";
import type {
  GameDefinition,
  InitApi,
  World,
} from "@test-cabinet/structured-2d";
import { defineCues, noCues, playCues } from "./audio";
import { DEFAULT_SEED, LEVELS, START_LIVES } from "./constants";
import { WirewormController } from "./controller";
import { createDebugApi, type WirewormDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { registerActions } from "./input";
import { advanceGame } from "./sim";
import { loadArt } from "./sprites";
import { Board } from "./stage";
import { COLOR } from "./theme";

// The surface is part of the module contract and is declared beside the game it
// types, so the type is exported from here whichever module implements it.
export type { WirewormDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the board.
 */
export const BACKGROUND: string = COLOR.void;

// ---- The state contract (specs/state.md) ---------------------------------

export type Screen =
  "title" | "howto" | "playing" | "paused" | "victory" | "gameover";

export type Phase = "banner" | "active" | "respawn";

export type FoeKind = "glitch" | "dropper" | "corruptor";

export interface Tile {
  c: number;
  r: number;
}

export interface NodeState {
  c: number;
  r: number;
  charge: number;
}

export interface WormState {
  id: number;
  segments: Tile[];
  dh: number;
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
  stepClock: number;
}

export interface FoeState {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
  mind: boolean;
  travel: boolean;
  dartClock: number;
}

export interface BoltState {
  id: number;
  x: number;
  y: number;
}

export interface ArcState {
  from: Tile;
  to: Tile;
  life: number;
}

export interface CursorState {
  x: number;
  y: number;
  invulnerable: number;
  contact: boolean;
}

/**
 * The engine's `GameState`, presented without its own `phase`.
 *
 * `GameState.phase` is the MATCH phase — `waiting`, `playing`, `over` — that a
 * mode moves with `setPhase`. Wireworm's `phase` is the sub-phase of the
 * `playing` SCREEN — `banner`, `active`, `respawn` (`specs/state.md`) — and this
 * game's mode never calls `setPhase`, so no match phase is ever written to the
 * field and the two vocabularies never meet. TypeScript cannot express a
 * subclass that re-types an inherited field, so the base is presented here
 * without the one field this game declares its own vocabulary for. Everything
 * else about `GameState` is inherited unchanged and `instanceof GameState` holds
 * of every instance, which is what the engine builds the state through.
 */
const BoardStateBase = GameState as unknown as {
  new (): Omit<GameState, "phase">;
};

/** Where one pointer's current press began. See {@link WirewormState.presses}. */
export interface PressAnchor {
  /** The pointer the press came from, so several contacts are told apart. */
  id: number;
  /** The screen the press landed on. */
  screen: Screen;
  /** The menu item it landed in, or `-1` for a press outside every region. */
  index: number;
}

export class WirewormState extends BoardStateBase {
  screen: Screen = "title";
  phase: Phase = "banner";
  phaseTimer = 0;
  menuIndex = 0;

  score = 0;
  lives = START_LIVES;
  level = 1;
  reachedLevel = 1;

  nodes: NodeState[] = [];
  worms: WormState[] = [];
  foes: FoeState[] = [];
  bolts: BoltState[] = [];
  arcs: ArcState[] = [];

  cursor: CursorState = { x: 640, y: 688, invulnerable: 0, contact: true };
  fireCooldown = 0;

  foeSpawning = true;
  wormEntry = true;
  glitchTimer = 0;
  corruptorTimer = 0;
  dropperTimer = 0;

  nextId = 1;
  simTime = 0;
  muted = false;
  rngState = DEFAULT_SEED;

  /**
   * Where each pointer's current press began.
   *
   * Bookkeeping for the rule `specs/ui.md` fixes: a confirm takes BOTH of its
   * edges inside one item's region, so the release has to know where the press
   * landed, and a press and its release may be frames apart. It is not part of
   * the declared state — nothing poses it, nothing reads it back, and it is
   * rebuilt from the pointer stream alone — and it lives on the state because
   * this build keeps nothing between frames anywhere else.
   */
  presses: PressAnchor[] = [];
}

/**
 * The open world's state, as the state it is: the mode names `WirewormState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
 */
export function wirewormState(world: World): WirewormState {
  const state = world.state;
  if (!(state instanceof WirewormState)) {
    throw new Error("Wireworm: the open world does not hold a WirewormState");
  }
  return state;
}

// ---- The framework objects (specs/overview.md, The runtime) ---------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. It registers every
 * action against its bindings, defines the ten cues, loads the seeded sprite art
 * — which belongs to the whole game and outlives every world — and returns the
 * debug surface `specs/instrumentation.md` fixes. The surface reads the live
 * world off the engine at each call, so it holds no state of its own.
 */
class WirewormInstance extends GameInstance<WirewormDebugApi> {
  override async initialize(api: InitApi): Promise<WirewormDebugApi> {
    registerActions(api);
    defineCues(api);
    await loadArt(api.assets);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player — possessing nothing, since the cursor is
 * driven through the state rather than as a pawn — and registers the diagnostic
 * sources with the world's overlay registry. The player's controller resolves
 * the frame's input into the state (`src/controller.ts`), which is why it is not
 * done here: controllers tick before any actor, so the board is drawn from the
 * state this frame's input produced.
 *
 * `tick` is the simulation. Every rate is per second and integrated against the
 * delta the engine hands it, and the one clocked quantity — the worm's tile step
 * — accumulates that same delta and carries its remainder (`specs/worm.md`), so
 * an interval of game time reaches the same state however it was divided into
 * frames.
 */
class WirewormMode extends GameMode {
  // The state the engine builds when the world opens. The cast is the other
  // half of the note on `BoardStateBase`: the class IS a `GameState`, and only
  // the type of the one re-typed field keeps TypeScript from saying so.
  override gameStateClass = WirewormState as unknown as new () => GameState;
  override playerControllerClass = WirewormController;

  override beginPlay(): void {
    // `pawnClass` stays `null`, so the one player possesses nothing; its
    // controller is where the frame's actions are read.
    this.addPlayer();
    registerDiagnostics(this.world);
  }

  override tick(dt: number): void {
    const state = wirewormState(this.world);
    // The game's readable copy of the engine's mute bit, refreshed each frame
    // (specs/state.md). The runtime owns muting; this field is what the snapshot
    // reports.
    state.muted = this.world.audio.muted();

    const cues = noCues();
    advanceGame(state, dt, cues);
    playCues(this.world.audio, cues);
  }
}

/**
 * The game this build's engine drives: the instance, the single level and the
 * one actor in it, and the name `engine.initialize` opens the level under.
 * `src/main.ts` binds it to the engine; the board actor's draw components render
 * the state the mode advances.
 */
export const game: GameDefinition<WirewormDebugApi> = {
  instance: WirewormInstance,
  levels: { [LEVELS.board]: { mode: WirewormMode, actors: [{ type: Board }] } },
  startLevel: LEVELS.board,
};
