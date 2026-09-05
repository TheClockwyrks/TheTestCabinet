// Deepcore — the game: the whole authoritative state, and the three functions
// the engine drives.
//
// A `Game<S, D>` is three functions, a state type, and the debug surface the game
// hands to the engine. `initialize` runs once and returns the state and the
// surface together as `[state, debug]`. `update` and `render` then run once each
// per frame — `update` first, with the frame's delta time in SECONDS, then
// `render`. The state is the only channel between them, and it is a VALUE: the
// engine hands `update` the current state as a `DeepReadonly` view and stores
// what it returns, and `render` draws that.
//
// THE STATE SHAPE BELOW IS THE CONTRACT the rest of the build is written
// against. Every field is declared here under its name, its type, and its
// meaning; `createInitialState` builds the whole of it in one go, so no field is
// optional; and `reset` on the debug surface restores exactly these fields.
// Every field is `readonly` and every array is a `readonly` array, so the
// declared type and the view the engine hands out are the same shape. A frame
// builds the next state in a DRAFT (`src/state.ts`), which is a fresh mutable
// copy, so nothing in this build ever writes to a state it was handed.
//
// THE CAMERA IS THE GAME'S. This engine draws nothing and holds no camera: it
// hands `render` a 2D context covering the logical stage, and the mine is far
// wider and far deeper than that stage. `camX` and `camY` below are the world
// point drawn at the top-left of the mine viewport, and `src/render.ts` applies
// them as its own transform on that context (specs/world.md).

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
import { loadAssets } from "./assets";
import type { Assets } from "./assets";
import { defineCues, playFrame } from "./audio";
import { controlsFor } from "./controls";
import { createDebugApi } from "./debug";
import type { DeepcoreDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { advanceEffects, installSystems, spawnEffects } from "./effects";
import type { FxEvent } from "./effects";
import { readActions, readPointer, registerActions } from "./input";
import { renderGame } from "./render";
import { stepGame } from "./simulation";
import { hasSave } from "./save";
import { commit, draft } from "./state";
import { PALETTE } from "./theme";
import { coreRowFor, DEFAULT_WORLD_SIZE } from "./tuning";
import { emptyMine, placeMinerAtSpawn, restingMiner } from "./world";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

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
  readonly material: MaterialId;
  readonly col: number;
  readonly row: number;
  readonly collected: boolean;
}

/** An item resting on a cell. A jettisoned Core Sample is the only one. */
export interface GroundItem {
  readonly kind: "core-sample";
  readonly col: number;
  readonly row: number;
}

// ---- The prospector ------------------------------------------------------

/** A cut in progress, and the seconds until its next hit lands. */
export interface DrillProgress {
  readonly col: number;
  readonly row: number;
  readonly dir: "down" | "left" | "right";
  readonly hitTimer: number;
}

/** The miner. `x` and `y` are the top-left of its box, in world units. */
export interface Miner {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: Facing;
  readonly state: MinerState;
  readonly fuel: number;
  readonly hull: number;
  readonly drilling: DrillProgress | null;
  /** Whether the miner's body moves. Held by the travel faculty gate. */
  readonly travel: boolean;
  /** Whether the miner's drill cuts. Held by the drill faculty gate. */
  readonly drill: boolean;
}

/** The held actions the miner's movement and drill read. */
export interface MoveInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly down: boolean;
  readonly thrust: boolean;
}

/** The pointer, in the stage's logical units, mirrored from the engine. */
export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

// ---- The expedition ------------------------------------------------------

/** The cargo bay: how many units of each mineral it holds. */
export type Cargo = Readonly<Record<OreId, number>>;

/** The satchel, which weighs nothing and takes no cargo slot. */
export interface Satchel {
  readonly resonite: number;
  readonly cryenite: number;
  readonly coreSample: boolean;
}

/** The current tier on every upgrade track. */
export type UpgradeTiers = Readonly<Record<TrackName, number>>;

/** How many of each field supply is held. */
export type ItemCounts = Readonly<Record<ItemId, number>>;

/** What the Victory and Game Over screens summarize. It is never persisted. */
export interface RunSummary {
  readonly deepestDepthMeters: number;
  readonly creditsEarned: number;
  readonly elapsedSeconds: number;
  readonly mode: Mode;
  readonly componentsInstalled: number;
  readonly deathCause: DeathCause | null;
}

/** A short line of feedback, fading over `t` seconds. */
export interface Note {
  readonly text: string;
  readonly t: number;
}

/**
 * The one-time hazard notice: armed while `shown` is `false` and counting down
 * `NOTICE_DELAY`, on screen while it is `true` and counting down `NOTICE_FADE`.
 */
export interface Notice {
  readonly hazard: NoticeHazard;
  readonly shown: boolean;
  readonly t: number;
}

/** A death playing out before the mode's outcome is applied. */
export interface Dying {
  readonly cause: DeathCause;
  readonly t: number;
}

/** What the scanner reads, recomputed every update. */
export interface ScanResult {
  readonly locked: boolean;
  readonly target: MaterialId | null;
  readonly dirX: number;
  readonly dirY: number;
  readonly distanceTiles: number | null;
}

/** The whole authoritative state. */
export interface DeepcoreState {
  // The screen and its menu.
  readonly screen: ScreenName;
  readonly menuIndex: number;
  readonly panel: PanelId | null;

  // The expedition's terms.
  readonly mode: Mode;
  /** The mode chosen at mode-select, held until a world size is picked. */
  readonly pendingMode: Mode;
  readonly worldSize: WorldSize;
  /** The deepest row at the current world size: the Core chamber's. */
  readonly coreRow: number;

  // What the expedition has accumulated.
  readonly credits: number;
  readonly creditsEarned: number;
  readonly cargo: Cargo;
  readonly satchel: Satchel;
  readonly tiers: UpgradeTiers;
  readonly installed: readonly ComponentId[];
  readonly items: ItemCounts;
  readonly groundItems: readonly GroundItem[];
  readonly coreTimer: number | null;
  readonly deepestDepthMeters: number;
  readonly elapsedSeconds: number;
  readonly summary: RunSummary | null;
  readonly deathCause: DeathCause | null;

  // The mine and the miner.
  readonly grid: Grid;
  readonly nodes: readonly MaterialNode[];
  readonly miner: Miner;

  // The camera: the world point drawn at the viewport's top-left, and the
  // carried vertical lead, positive downward (specs/world.md).
  readonly camX: number;
  readonly camY: number;
  readonly camLead: number;

  // The session.
  /** Accumulated game time, in seconds, on every screen. */
  readonly simTime: number;
  /** The engine's mute bit, mirrored every update. */
  readonly muted: boolean;
  /** Whether the save slot holds an expedition, mirrored every update. */
  readonly hasSave: boolean;
  /** The generator every draw the game makes runs off (src/rng.ts). */
  readonly rngState: number;

  // What the frame read, mirrored so the render is a function of the state.
  readonly input: MoveInput;
  readonly pointer: PointerState;

  // The moment rather than the expedition.
  readonly notes: readonly Note[];
  readonly hurtT: number;
  readonly dying: Dying | null;
  readonly launchAnim: number | null;
  readonly scan: ScanResult;
  readonly shakeT: number;
  readonly shakeAmp: number;
  readonly drillFxCd: number;
  readonly thrustFxCd: number;
  readonly lavaFxCd: number;
  readonly gasSeepCd: number;
  readonly gasSeepIndex: number;
  readonly notice: Notice | null;
  readonly noticesFired: { readonly gas: boolean; readonly lava: boolean };

  // What has been raised and not yet handed over. A frame's rules run before
  // the frame plays what they raised, and a debug control raises the same two
  // outside a frame, so both wait here until the next update drains them.
  readonly cues: readonly CueName[];
  readonly fx: readonly FxEvent[];

  /** The produced sprites, cycles, and systems, loaded once in `initialize`. */
  readonly assets: Assets;
}

/** Every mineral a bay counts, the ten ores then the three gemstones. */
const MINERAL_ORDER: readonly OreId[] = [...ORE_IDS, ...GEMSTONE_IDS];

/** An empty cargo bay: every mineral at zero. */
export function emptyCargo(): Record<OreId, number> {
  const cargo = {} as Record<OreId, number>;
  for (const id of MINERAL_ORDER) cargo[id] = 0;
  return cargo;
}

/** No field supplies held. */
export function emptyItems(): Record<ItemId, number> {
  const counts = {} as Record<ItemId, number>;
  for (const id of ITEM_IDS) counts[id] = 0;
  return counts;
}

/** Tier `1` on every track. */
export function startingTiers(): Record<TrackName, number> {
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

/**
 * The whole state at its title-screen value: the `title` screen, no expedition
 * in progress, an empty mine, the miner standing at the spawn, tier `1` on every
 * track, a full tank and hull, and nothing held. `reset` on the debug surface
 * restores exactly this, seeded as the caller asked (specs/instrumentation.md).
 */
export function createInitialState(
  assets: Assets,
  options: { seed?: number; muted?: boolean; hasSave?: boolean } = {},
): DeepcoreState {
  const coreRow = coreRowFor(DEFAULT_WORLD_SIZE);
  const tiers = startingTiers();
  const state: DeepcoreState = {
    screen: "title",
    menuIndex: 0,
    panel: null,
    mode: "standard",
    pendingMode: "standard",
    worldSize: DEFAULT_WORLD_SIZE,
    coreRow,
    credits: 0,
    creditsEarned: 0,
    cargo: emptyCargo(),
    satchel: { resonite: 0, cryenite: 0, coreSample: false },
    tiers,
    installed: [],
    items: emptyItems(),
    groundItems: [],
    coreTimer: null,
    deepestDepthMeters: 0,
    elapsedSeconds: 0,
    summary: null,
    deathCause: null,
    grid: emptyMine(coreRow),
    nodes: [],
    miner: restingMiner(tiers),
    camX: 0,
    camY: 0,
    camLead: 0,
    simTime: 0,
    muted: options.muted ?? false,
    hasSave: options.hasSave ?? false,
    rngState: options.seed ?? DEFAULT_SEED,
    input: { left: false, right: false, down: false, thrust: false },
    pointer: { x: 0, y: 0, down: false },
    notes: [],
    hurtT: 0,
    dying: null,
    launchAnim: null,
    scan: {
      locked: false,
      target: null,
      dirX: 0,
      dirY: 0,
      distanceTiles: null,
    },
    shakeT: 0,
    shakeAmp: 0,
    drillFxCd: 0,
    thrustFxCd: 0,
    lavaFxCd: 0,
    gasSeepCd: 0,
    gasSeepIndex: 0,
    notice: null,
    noticesFired: { gas: false, lava: false },
    cues: [],
    fx: [],
    assets,
  };
  return placeMinerAtSpawn(state);
}

// ---- The game the engine drives ------------------------------------------

export const game: Game<DeepcoreState, DeepcoreDebugApi> = {
  /**
   * Runs once, before any frame: register every action against its keys, declare
   * the thirteen cues over the produced clips, load the produced sprites,
   * cycles, and particle systems, register the diagnostic sources, and build the
   * complete initial state. The state and the debug surface come back together.
   *
   * Neither the diagnostics nor the surface holds the state: a source is handed
   * the state current at the read, and every operation on the surface takes the
   * state it poses and returns the next (specs/instrumentation.md).
   */
  async initialize(
    api: InitApi<DeepcoreState>,
  ): Promise<[DeepcoreState, DeepcoreDebugApi]> {
    registerActions(api);
    registerDiagnostics(api);
    const [loaded] = await Promise.all([loadAssets(api), defineCues(api)]);
    installSystems(loaded.systems);
    return [
      createInitialState(loaded.assets, { hasSave: hasSave() }),
      createDebugApi(),
    ];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current one.
   *
   * The frame opens a draft, mirrors what the engine owns into it, resolves this
   * frame's pointer and action edges, runs the simulation against `dt`, and then
   * drains what the frame raised — the cues, the loops that should be sounding,
   * and the effect bursts — before closing the draft.
   */
  update(
    state: DeepReadonly<DeepcoreState>,
    api: UpdateApi,
    dt: number,
  ): DeepcoreState {
    const d = draft(state);
    d.hasSave = hasSave();
    // The controls are read off the state the frame opened on, which is the
    // layout the previous frame drew and the one the pointer was aimed at.
    readPointer(d, api, controlsFor(state));
    readActions(d, api);
    stepGame(d, dt);
    playFrame(api, d);
    spawnEffects(d.fx);
    d.fx.length = 0;
    advanceEffects(dt);
    // The mute bit is mirrored last, so a frame in which the player toggled it
    // leaves the state agreeing with the bus rather than one frame behind.
    d.muted = api.audio.muted();
    return commit(d);
  },

  /** Runs once per frame, after `update`. Draws the state it is handed. */
  render(state: DeepReadonly<DeepcoreState>, api: RenderApi): void {
    renderGame(state, api.ctx);
  },
};
