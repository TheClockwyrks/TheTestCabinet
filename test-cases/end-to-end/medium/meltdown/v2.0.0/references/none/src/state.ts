// Meltdown — the game's whole state, and the two ways it is put back to a known
// value: `createState` for a cold start, `resetState` for the debug surface's
// `reset` (specs/state.md, specs/instrumentation.md).
//
// The state is ONE mutable value. The frame loop hands it to `update`, `render`
// draws it, and the debug surface reads and poses it; nothing else holds a
// reference to anything inside it. Everything the mode and difficulty derive, the
// routes across the floor, and the panel's control rectangles are rebuilt from
// what is here rather than stored as authority, so there is exactly one place a
// figure can disagree with itself: none.

import { DEFAULT_SEED } from "./constants";
import { TOWER_DEFS } from "./defs";
import { Floor, type Footprint } from "./grid";
import { modeFigures } from "./modes";
import { createRng, type Rng } from "./rng";
import type {
  DifficultyId,
  Level,
  ModeId,
  Phase,
  Rotation,
  Screen,
  Speed,
  SurgeType,
  TowerType,
  Vent,
} from "./types";

/** One tower standing on the floor. */
export interface Tower {
  id: number;
  type: TowerType;
  /** The footprint's top-left tile. */
  col: number;
  row: number;
  /** Fixed the moment the tower is placed, and never changed afterward. */
  rotation: Rotation;
  level: Level;
  /** `0` for the Forge and the Sink, which carry no heat of their own. */
  heat: number;
  tripped: boolean;
  /** Seconds left on the trip cooldown; `0` when the tower is online. */
  tripTimer: number;
  /** The fire clock, in seconds, which only runs while a target is held. */
  fireAcc: number;
  /** The id of the unit this tower is firing on, or `null`. */
  targeting: number | null;
  /** Whether this tower has a target and is online this frame. */
  firing: boolean;
  kills: number;
  damageDealt: number;
  /** Everything spent on this tower: its build cost plus every upgrade. */
  spent: number;
  /** Whether it still refunds in full. */
  fresh: boolean;
  /** The targeting-and-firing faculty gate (specs/instrumentation.md). */
  firingEnabled: boolean;
  /** The heat-model faculty gate (specs/instrumentation.md). */
  thermalEnabled: boolean;
}

/** One surge unit crossing the floor. */
export interface Unit {
  id: number;
  type: SurgeType;
  /** The unit's CENTRE, in logical stage units. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** The fraction of base speed the live slow removes; `0` for none. */
  slowFactor: number;
  /** Seconds the live slow has left; `0` for none. */
  slowTimer: number;
  /** The vent it entered at; its exhaust is that vent's fixed opposite. */
  vent: Vent;
  /** The locomotion faculty gate (specs/instrumentation.md). */
  motion: boolean;
}

/** A shot's brief trace on the floor. Drawn, and read by nothing else. */
export interface Shot {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The splash radius drawn around the impact, in logical units; `0` for none. */
  splash: number;
  /** Seconds of drawing left. */
  life: number;
  color: string;
}

/** The held build preview: what is armed, where, and at what rotation. */
export interface BuildPreview {
  type: TowerType;
  col: number;
  row: number;
  rotation: Rotation;
}

/** The region a pointer press landed in, so its release resolves against it. */
export type PressRegion =
  | { kind: "menu"; index: number }
  | { kind: "shop"; type: TowerType }
  | { kind: "control"; name: string }
  | { kind: "floor" };

/** The whole of the game. */
export interface MeltdownState {
  screen: Screen;
  phase: Phase;
  menuIndex: number;
  mode: ModeId;
  difficulty: DifficultyId;
  money: number;
  lives: number;
  score: number;
  wave: number;
  buildTimer: number;
  /** Units of the current wave still to be released. */
  wavePending: number;
  /** The wave spawner's own release clock, in seconds. */
  spawnClock: number;
  speed: Speed;
  towers: Tower[];
  surge: Unit[];
  selected: number | null;
  hoverShop: TowerType | null;
  build: BuildPreview | null;
  /** The world gate: whether the run releases surge of its own accord. */
  waveSpawning: boolean;
  pointer: { x: number; y: number; down: boolean };
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;
  simTime: number;
  rng: Rng;
  /** The next id, shared by both rosters so no two live entities collide. */
  nextId: number;
  /** The blocked set and the routes over it, rebuilt whenever a tower moves. */
  floor: Floor;
  shots: Shot[];
  /** Where the live pointer press began, so a release resolves in one region. */
  press: PressRegion | null;
}

/** Every footprint the floor is currently carrying. */
export function footprints(state: MeltdownState): Footprint[] {
  return state.towers.map((tower) => ({
    id: tower.id,
    col: tower.col,
    row: tower.row,
    size: TOWER_DEFS[tower.type].size,
  }));
}

/** Recompute the blocked set and both routes from the towers standing now. */
export function rebuildFloor(state: MeltdownState): void {
  state.floor.rebuild(footprints(state));
}

/** A state at its title-screen values, on Containment at Medium. */
export function createState(seed: number = DEFAULT_SEED): MeltdownState {
  const figures = modeFigures("containment", "medium");
  return {
    screen: "title",
    phase: "opening",
    menuIndex: 0,
    mode: "containment",
    difficulty: "medium",
    money: figures.startMoney,
    lives: figures.startLives,
    score: 0,
    wave: 1,
    buildTimer: 0,
    wavePending: 0,
    spawnClock: 0,
    speed: 1,
    towers: [],
    surge: [],
    selected: null,
    hoverShop: null,
    build: null,
    waveSpawning: true,
    pointer: { x: 0, y: 0, down: false },
    muted: false,
    simTime: 0,
    rng: createRng(seed),
    nextId: 1,
    floor: new Floor(),
    shots: [],
    press: null,
  };
}

/**
 * Every declared field back at its title-screen value (specs/instrumentation.md).
 *
 * `muted` and `pointer` are deliberately untouched: both are the game's copy of
 * something the runtime owns, and a reset restores the game rather than the
 * runtime beneath it.
 */
export function resetState(
  state: MeltdownState,
  options?: { seed?: number },
): void {
  const figures = modeFigures("containment", "medium");
  state.screen = "title";
  state.phase = "opening";
  state.menuIndex = 0;
  state.mode = "containment";
  state.difficulty = "medium";
  state.money = figures.startMoney;
  state.lives = figures.startLives;
  state.score = 0;
  state.wave = 1;
  state.buildTimer = 0;
  state.wavePending = 0;
  state.spawnClock = 0;
  state.speed = 1;
  state.towers = [];
  state.surge = [];
  state.selected = null;
  state.hoverShop = null;
  state.build = null;
  state.waveSpawning = true;
  state.simTime = 0;
  state.rng = createRng(options?.seed ?? DEFAULT_SEED);
  state.nextId = 1;
  state.shots = [];
  state.press = null;
  rebuildFloor(state);
}

/**
 * A fresh run of the mode and difficulty the state already carries, in its
 * opening phase. What RESTART, PLAY AGAIN and confirming a mode or a difficulty
 * all reach.
 */
export function startRun(state: MeltdownState): void {
  const figures = modeFigures(state.mode, state.difficulty);
  state.screen = "playing";
  state.phase = "opening";
  state.money = figures.startMoney;
  state.lives = figures.startLives;
  state.score = 0;
  state.wave = 1;
  state.buildTimer = 0;
  state.wavePending = 0;
  state.spawnClock = 0;
  state.speed = 1;
  state.towers = [];
  state.surge = [];
  state.selected = null;
  state.hoverShop = null;
  state.build = null;
  state.shots = [];
  state.press = null;
  rebuildFloor(state);
}
