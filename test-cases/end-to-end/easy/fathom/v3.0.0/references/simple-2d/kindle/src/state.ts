// Fathom — the observable state, exactly as `specs/state.md` declares it.
//
// The state is a VALUE. The engine holds it, hands every reader a
// `DeepReadonly<FathomState>` view, and replaces it with whatever `update`
// returns, so a frame builds the next state from the current one rather than
// writing into it. Every field below is `readonly` and every array is a
// `readonly` array, which is what lets a transition spread a state into the next
// one without a cast.
//
// THIS SHAPE IS THE CONTRACT. It is what the debug surface poses and reads, and
// what the snapshot projects. Nothing authoritative lives anywhere else: there is
// no module-level game state in this build and no closure over mutable data, so
// `reset` restoring these fields returns the whole game to its initial state.
//
// `src/game.ts` re-exports every type here, because the game module is where the
// specification says the state contract is declared.

import type { Sheets } from "./assets";
import type { PredatorKind } from "./constants";

/** The screen the game is showing (`specs/ui.md`). */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

/** A cardinal direction. A body faces one of these whether or not it moves. */
export type Dir = "up" | "down" | "left" | "right";

/** The direction a body is traveling, or `null` while it is at rest. */
export type Heading = Dir | null;

/** One tile of the grid. */
export interface Tile {
  readonly tx: number;
  readonly ty: number;
}

/**
 * The maze layout and the structures read off it.
 *
 * `rows` is the layout in the snapshot's own alphabet — `'#'` rock, `'.'`
 * corridor, `'g'` the den gate, `'d'` den interior — one string per row from the
 * top. Everything else here is derived from it when it is loaded, so a posed
 * fixture brings its own den, gate and wrap tunnel with it and nothing can fall
 * out of step with the layout.
 */
export interface MazeState {
  /** `GRID_ROWS` strings of `GRID_COLS` characters. */
  readonly rows: readonly string[];
  /** The row the wrap tunnel pierces, or `-1` on a layout that pierces none. */
  readonly wrapRow: number;
  /** The single den gate, or `null` on a layout with no den. */
  readonly gate: Tile | null;
  /** Every den-interior tile, in reading order. */
  readonly denTiles: readonly Tile[];
  /** Where the forager rests at the start of each life. */
  readonly start: Tile;
}

/** The forager (`specs/movement.md`). */
export interface ForagerState {
  /** Its center, in logical units. */
  readonly x: number;
  readonly y: number;
  /** Its facing, whether it is moving or at rest. */
  readonly facing: Dir;
  /** The direction it is traveling, or `null` while it is at rest. */
  readonly heading: Heading;
  /**
   * The desired direction a movement action set, held until another replaces it.
   * It is a request: `specs/movement.md` fixes where it is honored.
   */
  readonly desired: Heading;
}

/** A bonus drifter (`specs/gameplay.md`). */
export interface DrifterState {
  readonly x: number;
  readonly y: number;
  readonly facing: Dir;
  readonly heading: Heading;
  /** Whether it decides its own wander (`specs/instrumentation.md`). */
  readonly mind: boolean;
  /** Whether its body carries that wander through the maze. */
  readonly travel: boolean;
}

/** What a predator is doing (`specs/state.md`). */
export type PredatorMode = "den" | "wander" | "chase" | "search";

/** One predator of the roster (`specs/predators.md`). */
export interface PredatorState {
  readonly kind: PredatorKind;
  /** Its center, in logical units. */
  readonly x: number;
  readonly y: number;
  /** Its facing, whether it is moving or at rest. */
  readonly facing: Dir;
  /** The direction it is traveling, or `null` while it is at rest. */
  readonly heading: Heading;
  /** Where it is and what it is doing. */
  readonly mode: PredatorMode;
  /** Whether its turn in the den's staggered schedule has come. */
  readonly released: boolean;
  /** Whether it senses and decides for itself (`specs/instrumentation.md`). */
  readonly mind: boolean;
  /** Whether its body carries what its mind decides through the maze. */
  readonly travel: boolean;
  /** The rate it travels at in its current mode, in logical units per second. */
  readonly speed: number;
  /**
   * The seconds left until its release time, or `null` for a predator that has
   * none: the staggered schedule runs on the roster a maze is laid out with, so a
   * predator the debug surface adds carries no release time
   * (`specs/instrumentation.md`).
   */
  readonly releaseIn: number | null;
  /** The tile it believes the forager is on, or `null` while it holds no fix. */
  readonly fix: Tile | null;
  /** The seconds left of the linger that outlives a lapsed sense. */
  readonly linger: number;
  /** The seconds left of the detection alert. */
  readonly alertIn: number;
  /** The seconds left of the window a sonar pulse's mark draws it for. */
  readonly markIn: number;
  /** Whether its body is drawn this instant. */
  readonly lit: boolean;
  /** The Gloamfin's chase speed, which a corner knocks down and time restores. */
  readonly chaseSpeed: number;
  /** The Gloamfin's seconds until its next ordinary ping. */
  readonly pingIn: number;
  /** The Gloamfin's seconds left of the floor between one ping and the next. */
  readonly pingGap: number;
  /** Whether the Gloamfin holds a continuous close-range hearing lock. */
  readonly hearingLock: boolean;
  /** The Gloamfin's seconds left of a search before it gives the fix up. */
  readonly searchIn: number;
  /**
   * The Gloamfin's seconds until the one guaranteed ping of the current search,
   * or `null` once that search has cast it.
   */
  readonly searchPingIn: number | null;
  /** The Flarefish's seconds until its next flare. */
  readonly flareIn: number;
  /**
   * The Flarefish's seconds into the flare it is casting, counted from the start
   * of the charge-up, or `null` while it casts none.
   */
  readonly flarePhase: number | null;
  /**
   * The seconds left of the bloom art's fade, which plays out after the flare is
   * already over and lights nothing.
   */
  readonly flareFadeIn: number;
}

/** What cast a sonar wavefront, and the tint that identifies it. */
export type PulseSource = "forager" | "gloamfin";
export type PulseTint = "cyan" | "violet" | "orange";

/**
 * A sonar wavefront in flight: the forager's pulse or a Gloamfin's ping.
 *
 * `buckets` is the corridor flood from the origin grouped by corridor distance —
 * index `d` holds every tile the front reaches in exactly `d` steps — so the
 * front sweeps near tiles before far ones and bends around bends exactly as
 * `specs/sensing.md` requires. It is computed once, when the pulse is cast.
 */
export interface PulseState {
  readonly source: PulseSource;
  readonly tint: PulseTint;
  /** The tile it originated from. */
  readonly ox: number;
  readonly oy: number;
  /** How far the front has traveled, in corridor steps. */
  readonly front: number;
  /** The furthest it will travel, in corridor steps. */
  readonly range: number;
  /** The highest bucket already handed to the game as the front swept it. */
  readonly delivered: number;
  /** The corridor flood, grouped by distance from the origin. */
  readonly buckets: readonly (readonly Tile[])[];
  /** The index of the predator that cast it, or `null` for the forager's pulse. */
  readonly emitter: number | null;
  /** Whether its front has already reached the forager. */
  readonly caughtForager: boolean;
}

/** An ink cloud still standing (`specs/sensing.md`). */
export interface InkCloudState {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** The seconds of life it has left. */
  readonly remaining: number;
}

/** The whole of Fathom's state. */
export interface FathomState {
  // ---- The run ----------------------------------------------------------
  readonly screen: Screen;
  readonly depth: number;
  readonly score: number;
  readonly lives: number;
  readonly muted: boolean;
  /** Accumulated simulation time, in seconds, on every screen. */
  readonly simTime: number;
  /**
   * The elapsed time a frame delivered that has not yet been spent on a whole
   * `TICK_DT` tick, carried into the next frame (`specs/movement.md`).
   */
  readonly carry: number;

  // ---- The screens ------------------------------------------------------
  /** The selected item of the menu the current screen carries. */
  readonly menuIndex: number;
  /**
   * The title menu's remembered selection: the item last confirmed there, `0`
   * until one has been. Every arrival at the title takes `menuIndex` from it
   * (`specs/ui.md`), and it survives the return a dive is put back by.
   */
  readonly titleIndex: number;
  /**
   * The menu item a pointer or a finger is currently pressed on, or `null`.
   *
   * A confirm takes both of its edges inside ONE region (`specs/ui.md`), so the
   * region the press landed in has to outlive the frame it landed on. It is
   * derived from the gesture in flight and nothing else, and every screen change
   * drops it, so no pose can leave a press latched over a menu it was not made
   * on.
   */
  readonly pressedItem: number | null;
  /** The seconds the countdown or the cleared interstitial has left to run. */
  readonly screenIn: number;

  // ---- The maze ---------------------------------------------------------
  readonly maze: MazeState;
  /** One entry per tile: whether a plankton is on it. */
  readonly plankton: readonly boolean[];
  readonly planktonRemaining: number;
  /** One entry per tile: whether any source has ever revealed it. */
  readonly revealed: readonly boolean[];
  /** One entry per tile: whether it is lit this instant. */
  readonly lit: readonly boolean[];

  // ---- The forager's senses ---------------------------------------------
  /** `G`, in `[0, 1]`. */
  readonly brightness: number;
  /** The seconds left of the hold during which `G` is steady. */
  readonly brightHold: number;
  /** The seconds left until the sonar pulse is ready. */
  readonly sonarCooldown: number;
  /** The seconds left until ink is ready. */
  readonly inkCooldown: number;

  // ---- The creatures ----------------------------------------------------
  readonly forager: ForagerState;
  readonly drifters: readonly DrifterState[];
  /** The roster, in release order (`specs/state.md`). */
  readonly predators: readonly PredatorState[];
  /** The seconds until the drifter cadence next tops the maze up. */
  readonly drifterIn: number;

  // ---- The wavefronts and the ink ---------------------------------------
  readonly pulses: readonly PulseState[];
  readonly inkClouds: readonly InkCloudState[];

  // ---- The controls -----------------------------------------------------
  /**
   * The movement actions held as of the most recent frame. It is what tells a
   * direction newly asked for from one still being held, so pressing a second
   * direction turns the forager rather than being ignored while the first is
   * down (`specs/movement.md`).
   */
  readonly heldDirs: readonly Dir[];

  // ---- The art ----------------------------------------------------------
  /**
   * The frames of the seeded sprite sheets, loaded once by `initialize`
   * (`specs/assets.md`). They live on the state because nothing in this build
   * is carried from one frame to the next anywhere else; a `reset` keeps them,
   * because they are the project's art rather than a value a dive opens with.
   */
  readonly sheets: Sheets;
}
