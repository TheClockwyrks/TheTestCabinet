// Deepcore — the game: the whole authoritative state, and the framework objects
// the engine drives.
//
// The game is ONE `GameDefinition` with ONE level. The engine opens that level
// at `startLevel` and the game never opens another: every screen is a value of
// the state's `screen` field, so the world and its game state live for the whole
// session. `DeepcoreInstance.initialize` runs once, before the level opens — it
// registers the actions, declares the thirteen cues over the produced clips,
// loads the produced sprites, cycles, and particle systems, and returns the
// debug surface, which the engine holds and returns from `engine.debug`.
// `DeepcoreMode` runs the level: its `gameStateClass` is `DeepcoreState`, so the
// engine builds the state below when the world opens; its `pawnClass` is the
// prospector, so `beginPlay`'s single player possesses one; and its `tick` is
// the frame's simulation, the audio it raised, the effects it spawned, and the
// camera it asks the engine for.
//
// THE STATE SHAPE BELOW IS THE CONTRACT the rest of the build is written
// against. It is the world's game state — `engine.world.state` is the one
// instance of it — and the framework's states are LIVE objects: a tick writes
// the fields it advances in place. `restore` states every field's title-screen
// value in one place, the constructor runs it, and the debug surface's `reset`
// runs it again, so there is exactly one description of what an untouched game
// holds. It is the whole of the authoritative game: every value carried from one
// frame to the next lives on it, and every other module is either arithmetic
// over these fields or a system that writes them through the paths play runs on.
//
// Deepcore's screens run on `screen` rather than on the match phase: the mode
// never calls `setPhase`, so the inherited `phase` stays `"waiting"` and
// `elapsed` stays `0`. The expedition's own clock is `elapsedSeconds`, which
// runs only while an expedition is in the mine.
//
// THE CAMERA IS THE ENGINE'S. The mine is far wider and far deeper than the
// logical stage, and `camX`/`camY` are the world point the game wants drawn at
// the top-left of the mine viewport. `src/camera.ts` computes them and positions
// the engine's camera to match at the end of every tick, so the mine is drawn
// through the engine's own projection (specs/world.md).

import { GameInstance, GameMode, GameState } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi, World } from "@clockwyrks/structured-2d";
import { DEFAULT_SEED, GEMSTONE_IDS, ITEM_IDS, ORE_IDS } from "./constants";
import type {
  ComponentId,
  CueName,
  DeathCause,
  Facing,
  ItemId,
  MaterialId,
  MinerState,
  Mode,
  NoticeHazard,
  OreId,
  PanelId,
  ScreenName,
  TileKind,
  TrackName,
  BandName,
  WorldSize,
} from "./constants";
import { currentAssets, installAssets, loadAssets } from "./assets";
import type { Assets } from "./assets";
import { defineCues, playFrame } from "./audio";
import type { LoopCue } from "./audio";
import { syncCamera } from "./camera";
import { DeepcoreController } from "./controller";
import { createDebugApi } from "./debug";
import type { DeepcoreDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { advanceEffects, installSystems, spawnEffects } from "./effects";
import type { FxEvent } from "./effects";
import { registerActions } from "./input";
import { Mine } from "./mine";
import { Prospector } from "./prospector";
import { hasSave as saveExists } from "./save";
import { stepGame } from "./simulation";
import { PALETTE } from "./theme";
import { coreRowFor, DEFAULT_WORLD_SIZE } from "./tuning";
import { emptyMine, restingMiner } from "./world";

// The surface is part of the module contract and is declared beside the
// operations that implement it, so the type is exported from here as well.
export type { DeepcoreDebugApi };

/**
 * The stage background. `src/main.ts` hands it to the engine as the color the
 * canvas is cleared to each frame, so the letterbox bars match the mine.
 */
export const BACKGROUND: string = PALETTE.void;

// ---- The mine ------------------------------------------------------------

/**
 * One cell of the grid. A minable cell becomes a `tunnel` once it is drilled
 * out; `health` is `null` until the cell is first cut, and its band fixes the
 * value it starts at.
 *
 * A tile is never written to, only replaced, which is what lets the grid be
 * shared between the state and anything that captured it (`src/state.ts`).
 */
export interface Tile {
  readonly kind: TileKind;
  readonly band: BandName;
  readonly ore: OreId | null;
  readonly material: MaterialId | null;
  readonly health: number | null;
}

/** The grid, indexed `grid[row][col]`. */
export type Grid = readonly (readonly Tile[])[];

/** A buried material node the scanner targets. */
export interface MaterialNode {
  material: MaterialId;
  col: number;
  row: number;
  collected: boolean;
}

/** An item resting on a cell. A jettisoned Core Sample is the only one. */
export interface GroundItem {
  kind: "core-sample";
  col: number;
  row: number;
}

// ---- The prospector ------------------------------------------------------

/** A cut in progress, and the seconds until its next hit lands. */
export interface DrillProgress {
  col: number;
  row: number;
  dir: "down" | "left" | "right";
  hitTimer: number;
}

/** The miner. `x` and `y` are the top-left of its box, in world units. */
export interface Miner {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  state: MinerState;
  fuel: number;
  hull: number;
  drilling: DrillProgress | null;
  /** Whether the miner's body moves. Held by the travel faculty gate. */
  travel: boolean;
  /** Whether the miner's drill cuts. Held by the drill faculty gate. */
  drill: boolean;
}

/** The held actions the miner's movement and drill read. */
export interface MoveInput {
  left: boolean;
  right: boolean;
  down: boolean;
  thrust: boolean;
}

/** The pointer, in the stage's logical units, mirrored from the engine. */
export interface PointerState {
  x: number;
  y: number;
  down: boolean;
}

// ---- The expedition ------------------------------------------------------

/** The cargo bay: how many units of each mineral it holds. */
export type Cargo = Record<OreId, number>;

/** The satchel, which weighs nothing and takes no cargo slot. */
export interface Satchel {
  resonite: number;
  cryenite: number;
  coreSample: boolean;
}

/** The current tier on every upgrade track. */
export type UpgradeTiers = Record<TrackName, number>;

/** How many of each field supply is held. */
export type ItemCounts = Record<ItemId, number>;

/** What the Victory and Game Over screens summarize. It is never persisted. */
export interface RunSummary {
  deepestDepthMeters: number;
  creditsEarned: number;
  elapsedSeconds: number;
  mode: Mode;
  componentsInstalled: number;
  deathCause: DeathCause | null;
}

/** A short line of feedback, fading over `t` seconds. */
export interface Note {
  text: string;
  t: number;
}

/**
 * The one-time hazard notice: armed while `shown` is `false` and counting down
 * `NOTICE_DELAY`, on screen while it is `true` and counting down `NOTICE_FADE`.
 */
export interface Notice {
  hazard: NoticeHazard;
  shown: boolean;
  t: number;
}

/** A death playing out before the mode's outcome is applied. */
export interface Dying {
  cause: DeathCause;
  t: number;
}

/** What the scanner reads, recomputed every update. */
export interface ScanResult {
  locked: boolean;
  target: MaterialId | null;
  dirX: number;
  dirY: number;
  distanceTiles: number | null;
}

/** Every mineral a bay counts, the ten ores then the three gemstones. */
const MINERAL_ORDER: readonly OreId[] = [...ORE_IDS, ...GEMSTONE_IDS];

/** An empty cargo bay: every mineral at zero. */
export function emptyCargo(): Cargo {
  const cargo = {} as Cargo;
  for (const id of MINERAL_ORDER) cargo[id] = 0;
  return cargo;
}

/** No field supplies held. */
export function emptyItems(): ItemCounts {
  const counts = {} as ItemCounts;
  for (const id of ITEM_IDS) counts[id] = 0;
  return counts;
}

/** Tier `1` on every track. */
export function startingTiers(): UpgradeTiers {
  return {
    fuel: 1,
    drill: 1,
    cargo: 1,
    hull: 1,
    jetpack: 1,
    radiator: 1,
    scanner: 1,
  };
}

// ---- The state contract --------------------------------------------------

/**
 * The whole authoritative state, as the world holds it.
 *
 * `restore` states the title-screen value of every field it owns, so the
 * constructor and the debug surface's `reset` share one description of an
 * untouched game. The three fields declared outside it survive a reset: `muted`
 * is a player preference the engine owns, `hasSave` describes a slot that
 * outlives the session, and `assets` are the produced files loaded once.
 */
export class DeepcoreState extends GameState {
  /** The engine's mute bit, mirrored every tick. */
  muted = false;
  /** Whether the save slot holds an expedition, mirrored every tick. */
  hasSave = saveExists();
  /** The produced sprites, cycles, and systems, loaded once in `initialize`. */
  assets: Assets = currentAssets();

  // The screen and its menu.
  screen!: ScreenName;
  menuIndex!: number;
  panel!: PanelId | null;

  // The expedition's terms.
  mode!: Mode;
  /** The mode chosen at mode-select, held until a world size is picked. */
  pendingMode!: Mode;
  worldSize!: WorldSize;
  /** The deepest row at the current world size: the Core chamber's. */
  coreRow!: number;

  // What the expedition has accumulated.
  credits!: number;
  creditsEarned!: number;
  cargo!: Cargo;
  satchel!: Satchel;
  tiers!: UpgradeTiers;
  installed!: ComponentId[];
  items!: ItemCounts;
  groundItems!: GroundItem[];
  coreTimer!: number | null;
  deepestDepthMeters!: number;
  elapsedSeconds!: number;
  summary!: RunSummary | null;
  deathCause!: DeathCause | null;

  // The mine and the miner.
  grid!: Grid;
  nodes!: MaterialNode[];
  miner!: Miner;

  // The camera: the world point the game asks the engine to draw at the mine
  // viewport's top-left, and the carried vertical lead, positive downward
  // (specs/world.md).
  camX!: number;
  camY!: number;
  camLead!: number;

  /** Accumulated game time, in seconds, on every screen. */
  simTime!: number;
  /** The generator every draw the game makes runs off (src/rng.ts). */
  rngState!: number;

  // What the frame read, mirrored so the drawing is a function of the state.
  input!: MoveInput;
  pointer!: PointerState;

  // The moment rather than the expedition.
  notes!: Note[];
  hurtT!: number;
  dying!: Dying | null;
  launchAnim!: number | null;
  scan!: ScanResult;
  shakeT!: number;
  shakeAmp!: number;
  drillFxCd!: number;
  thrustFxCd!: number;
  lavaFxCd!: number;
  gasSeepCd!: number;
  gasSeepIndex!: number;
  notice!: Notice | null;
  noticesFired!: { gas: boolean; lava: boolean };

  // What has been raised and not yet handed over. A tick's rules run before the
  // tick plays what they raised, and a debug control raises the same two outside
  // a tick, so both wait here until the next tick drains them.
  /** One-shot cues raised and not yet played. */
  cues!: CueName[];
  /** The loops that should be sounding when this tick ends. */
  loops!: Set<LoopCue>;
  /** The effect bursts raised and not yet spawned. */
  fx!: FxEvent[];

  constructor() {
    super();
    this.restore();
  }

  /**
   * Every field this state owns back at its title-screen value: the `title`
   * screen, no expedition in progress, an empty mine, the miner standing at the
   * spawn, tier `1` on every track, a full tank and hull, and nothing held.
   *
   * `options.seed` seeds the generator, defaulting to `DEFAULT_SEED`. `muted`,
   * `hasSave`, and `assets` are deliberately untouched
   * (specs/instrumentation.md).
   */
  restore(options: { seed?: number } = {}): void {
    const coreRow = coreRowFor(DEFAULT_WORLD_SIZE);
    const tiers = startingTiers();

    this.screen = "title";
    this.menuIndex = 0;
    this.panel = null;

    this.mode = "standard";
    this.pendingMode = "standard";
    this.worldSize = DEFAULT_WORLD_SIZE;
    this.coreRow = coreRow;

    this.credits = 0;
    this.creditsEarned = 0;
    this.cargo = emptyCargo();
    this.satchel = { resonite: 0, cryenite: 0, coreSample: false };
    this.tiers = tiers;
    this.installed = [];
    this.items = emptyItems();
    this.groundItems = [];
    this.coreTimer = null;
    this.deepestDepthMeters = 0;
    this.elapsedSeconds = 0;
    this.summary = null;
    this.deathCause = null;

    this.grid = emptyMine(coreRow);
    this.nodes = [];
    this.miner = restingMiner(tiers);

    this.camX = 0;
    this.camY = 0;
    this.camLead = 0;

    this.simTime = 0;
    this.rngState = options.seed ?? DEFAULT_SEED;

    this.input = { left: false, right: false, down: false, thrust: false };
    this.pointer = { x: 0, y: 0, down: false };

    this.notes = [];
    this.hurtT = 0;
    this.dying = null;
    this.launchAnim = null;
    this.scan = {
      locked: false,
      target: null,
      dirX: 0,
      dirY: 0,
      distanceTiles: null,
    };
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.drillFxCd = 0;
    this.thrustFxCd = 0;
    this.lavaFxCd = 0;
    this.gasSeepCd = 0;
    this.gasSeepIndex = 0;
    this.notice = null;
    this.noticesFired = { gas: false, lava: false };

    this.cues = [];
    this.loops = new Set();
    this.fx = [];
  }
}

/**
 * The open world's state, as the state it is: the mode names `DeepcoreState` as
 * its `gameStateClass`, so this holds of every world this game opens, and the
 * check turns a wrong wiring into a named error instead of a silent cast.
 */
export function deepcoreState(world: World): DeepcoreState {
  const state = world.state;
  if (!(state instanceof DeepcoreState)) {
    throw new Error("Deepcore: the open world does not hold a DeepcoreState");
  }
  return state;
}

// ---- The framework objects -----------------------------------------------

/**
 * The whole game: the one framework object that outlives the world.
 *
 * `initialize` runs once, before the start level opens. It registers every
 * action against its keys, declares the thirteen cues over the produced clips,
 * loads the produced sprites, cycles, and particle systems, and returns the
 * debug surface `specs/instrumentation.md` fixes. The surface reads the live
 * world off the engine at each call, so it holds no state of its own.
 */
class DeepcoreInstance extends GameInstance<DeepcoreDebugApi> {
  override async initialize(api: InitApi): Promise<DeepcoreDebugApi> {
    registerActions(api);
    const [loaded] = await Promise.all([loadAssets(api), defineCues(api)]);
    installAssets(loaded.assets);
    installSystems(loaded.systems);
    return createDebugApi(() => this.engine.world);
  }
}

/**
 * The rules of the one level the game runs in.
 *
 * `beginPlay` adds the single player, which possesses the prospector, and
 * registers the diagnostic sources with the world's overlay registry. The screen
 * machine and the controls run in that player's controller
 * (`src/controller.ts`); the tick below is the frame's own work, in the order
 * the specification asks for it.
 */
class DeepcoreMode extends GameMode {
  declare readonly state: DeepcoreState;

  override gameStateClass = DeepcoreState;
  override playerControllerClass = DeepcoreController;
  override pawnClass = Prospector;

  override beginPlay(): void {
    this.addPlayer();
    registerDiagnostics(this.world);
    // The engine's camera is the view over the mine, and the game positions it
    // rather than following an actor, because the mine's clamps are its own
    // (specs/world.md). It starts where the state's resting camera sits.
    syncCamera(this.world, this.state);
  }

  override spawnPoint(): {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  } {
    const { miner } = this.state;
    return { x: miner.x, y: miner.y, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  /**
   * One frame of the game.
   *
   * The controller has already read this frame's actions and pointer and
   * mirrored them onto the state, and the prospector has already followed the
   * miner it was holding. What is left is the simulation itself, the audio and
   * the effects it raised, and the camera it left the game asking for.
   */
  override tick(dt: number): void {
    const state = this.state;
    // The loops are the frame's own: every one that should be sounding when it
    // ends is added by the rules that ran in it.
    state.loops.clear();
    stepGame(state, dt);
    playFrame(this.world.audio, state);
    spawnEffects(state.fx);
    state.fx.length = 0;
    advanceEffects(dt);
    // The mute bit is mirrored last, so a frame in which the player toggled it
    // leaves the state agreeing with the bus rather than one frame behind.
    state.muted = this.world.audio.muted();
    state.hasSave = saveExists();
    // The world's own objects follow the body the simulation settled on, and the
    // camera the frame's rules asked for is handed to the engine, both before it
    // renders.
    this.world.find(Prospector)?.follow(state);
    syncCamera(this.world, state);
  }
}

/**
 * The game this build's engine drives: the instance, the single level, and the
 * name `engine.initialize` opens it under. `src/main.ts` binds it to the engine;
 * the mine's own actor draws the state the mode advances.
 */
export const game: GameDefinition<DeepcoreDebugApi> = {
  instance: DeepcoreInstance,
  levels: { mine: { mode: DeepcoreMode, actors: [{ type: Mine }] } },
  startLevel: "mine",
};
