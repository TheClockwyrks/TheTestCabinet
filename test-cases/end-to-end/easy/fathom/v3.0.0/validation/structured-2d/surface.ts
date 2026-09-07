// Fathom — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// builds and returns, and specs/state.md fixes the object its one reading
// projects. This module is those two specifications written down as types: the
// operations, their arguments, the snapshot shape, and the version. It is the
// ONLY description of the surface the validators read. The build implements the
// surface under whatever module it likes and declares its own type for it — the
// `D` of its `GameInstance<D>`; nothing here imports it, and the harness reaches
// the object itself through `engine.debug` alone. So a build whose surface
// departs from the specification is held against the specification, not against
// its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation is a method that acts on the running
// game at the moment of the call, through the same systems play uses: a POSE
// takes only the arguments its heading names, returns nothing, and arranges the
// live game (`setScreen(s)`, `setForagerTile(tx, ty)`), and a READING takes no
// arguments and returns plain data read off the game at the instant of the call
// (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.setScreen("playing")`, `engine.debug.snapshot()` — with no
// wrapper in between. `version` is a plain number.
//
// Fathom runs in ONE world for the whole session and every screen is a value of
// `screen`, so no pose here rides a level transition: a pose takes effect at the
// call, and a reading taken straight after it sees it.
//
// The two variants share one surface and one set of operations. They differ in a
// single snapshot field — kindle's outer vision circle, `windowRadius` — which is
// declared optional here so one harness serves both workspaces, and the kindle
// slice under `kindle/` requires it before a check reads it.

import { DEFAULT_SEED, FATHOM_DEBUG_VERSION } from "./constants";

// The two figures this module states about the surface are the specification's
// like every other figure in this project, so they live in `constants.ts` with
// the rest and are re-exported here for the checks that already name them off
// the surface description.
export { DEFAULT_SEED, FATHOM_DEBUG_VERSION };

/**
 * A menu item's hit region, as `menuItemRect` reports it (specs/instrumentation.md).
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size, all in
 * the logical units specs/overview.md fixes the stage in.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The screens the state machine moves between (specs/state.md). */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

/** The four cardinal headings every body carries. */
export type Dir = "up" | "down" | "left" | "right";

/** The three hunters of the roster. */
export type PredatorKind = "lanternjaw" | "gloamfin" | "flarefish";

/**
 * What a predator is doing. `"search"` is reached only through the Gloamfin's
 * own behavior, so `setPredatorState` never poses it.
 */
export type PredatorState = "den" | "wander" | "chase" | "search";

/** The states `setPredatorState` may pose. */
export type PosablePredatorState = Exclude<PredatorState, "search">;

/** What cast a wavefront, and the tint it is drawn in. */
export type PulseSource = "forager" | "gloamfin";
export type PulseTint = "cyan" | "violet" | "orange";

/**
 * The tile grid's frame, as `snapshot().grid` reports it: the fixed geometry
 * specs/overview.md states. The center of tile `(tx, ty)` is
 * `(originX + tx * tile + tile / 2, originY + ty * tile + tile / 2)`.
 */
export interface GridFrame {
  cols: number;
  rows: number;
  tile: number;
  originX: number;
  originY: number;
}

/** The forager, as a snapshot reports it. */
export interface ForagerSnapshot {
  /** Its center, in logical units. */
  x: number;
  y: number;
  /** The tile its center lies on. */
  tx: number;
  ty: number;
  dir: Dir;
  /** True while it is traveling, which is a different question from `dir`. */
  moving: boolean;
}

/** One bonus drifter, as a snapshot reports it. */
export interface DrifterSnapshot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /**
   * True while its body is being drawn this instant, by the forager's light or
   * by a flare.
   *
   * Its amber mote is a separate drawing and is not what this answers for: the
   * mote is one of the maze's amber lights and shows under its own rule, while
   * `lit` says whether the jellyfish itself is drawn (specs/state.md).
   */
  lit: boolean;
  /** True while it runs its own wander, which is how a dive is played. */
  mind: boolean;
  /** True while its body carries that wander through the maze. */
  travel: boolean;
}

/**
 * One predator, as a snapshot reports it.
 *
 * The per-kind fields report `null` for a kind that does not carry them rather
 * than going missing, so every field below is present on every entry.
 */
export interface PredatorSnapshot {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  /** Where it is and what it is doing. */
  state: PredatorState;
  /** Whether its turn in the den's staggered schedule has come. */
  released: boolean;
  /** True while it runs its own mind, which is how a dive is played. */
  mind: boolean;
  /** True while its body carries what its mind decides through the maze. */
  travel: boolean;
  /** The rate it travels at in its current `state`, in logical units per second. */
  speed: number;
  /** True only during the `ALERT_TIME` window after a fix is acquired. */
  alert: boolean;
  /** True while its body is being drawn this instant. */
  lit: boolean;
  /** The Lanternjaw's and the Flarefish's light detection range. */
  detectRange: number | null;
  /** The Gloamfin's close-range hearing reach. */
  hearingRange: number | null;
  /** True while the Gloamfin holds a continuous hearing lock. */
  hearingLock: boolean | null;
  /** The Flarefish's pre-bloom charge-up glow. */
  flareCharging: boolean | null;
  /** True while the Flarefish's bloom burns. */
  flaring: boolean | null;
  /** The bloom's current lit radius, `0` when it is not flaring. */
  flareRadius: number | null;
}

/** One sonar wavefront in flight, the forager's pulses and the pings alike. */
export interface PulseSnapshot {
  source: PulseSource;
  tint: PulseTint;
  /** The tile the pulse originated from. */
  ox: number;
  oy: number;
  /** How far the leading edge has traveled from that tile, in corridor steps. */
  front: number;
  /** The furthest it will travel, in the same steps. */
  range: number;
}

/** One ink cloud still standing. */
export interface InkCloudSnapshot {
  x: number;
  y: number;
  radius: number;
  /** The seconds of life it has left. */
  remaining: number;
}

/** The sonar pulse's readiness, as a snapshot reports it. */
export interface SonarSnapshot {
  ready: boolean;
  cooldown: number;
  /** `E`, the pulse's maximum path range in tiles at the current depth. */
  range: number;
}

/** Ink's readiness, as a snapshot reports it. */
export interface InkSnapshot {
  ready: boolean;
  cooldown: number;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns (specs/state.md).
 *
 * Two of its figures run whatever the screen is: `muted` is the game's readable
 * copy of the runtime's own mute bit, refreshed every frame, and `simTime` is
 * accumulated simulation time, which every tick adds to — so neither is touched
 * by a screen change.
 */
export interface FathomSnapshot {
  version: number;
  screen: Screen;
  /**
   * The highlighted item on the menu the current screen shows, counted from `0`
   * over the items specs/ui.md lists for that menu.
   *
   * `null` on `"howto"`, `"countdown"`, `"playing"` and `"cleared"`, which show
   * no menu (specs/state.md).
   */
  menuIndex: number | null;
  /**
   * The title menu's remembered selection: the index of the item last confirmed
   * there, `0` before any of them has been. Never `null` (specs/state.md).
   */
  titleIndex: number;
  /** The current maze's depth, a whole number from `1`. */
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  /**
   * The seconds left on the bonus-drifter cadence: the countdown that admits
   * the next drifter at the den gate. `DRIFTER_INTERVAL` at the top of a maze
   * and again from each admission, and never more than that (specs/state.md).
   */
  drifterIn: number;
  /** `G`, the forager's brightness, in `[0, 1]`. */
  brightness: number;
  /** The seconds left on the `BRIGHT_HOLD` hold, `0` once it has expired. */
  brightHold: number;
  /** `V`, the line-of-sight light radius, in logical units. */
  visionRadius: number;
  sonar: SonarSnapshot;
  ink: InkSnapshot;
  grid: GridFrame;
  /** The layout: `rows` strings of `cols` characters, `#`/`.`/`g`/`d`. */
  tiles: string[];
  /** The same layout, one plankton character per tile: `*`/`-`. */
  plankton: string[];
  /** The same layout, one visibility character per tile: `u`/`r`/`l`. */
  visibility: string[];
  forager: ForagerSnapshot;
  drifters: DrifterSnapshot[];
  /** The roster of the current depth, in release order. */
  predators: PredatorSnapshot[];
  pulses: PulseSnapshot[];
  inkClouds: InkCloudSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
  /**
   * `R`, the outer vision circle's radius, in logical units: kindle alone.
   *
   * The Standard dive has no such circle and reports no such field, so this is
   * optional here and required by the kindle slice that reads it.
   */
  windowRadius?: number;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game and returns nothing; `snapshot` is a reading of
 * that same running game. An argument outside the domain its operation states is
 * invalid, and the call fails loudly rather than guessing what was meant, so a
 * check that poses an out-of-domain value is asserting that refusal.
 */
export interface FathomDebugApi {
  version: number;
  /** Restores every observable field to its title-screen value. */
  reset(seed?: number): void;
  /** A pure read of the game. */
  snapshot(): FathomSnapshot;
  /**
   * Brings every value the surface reports into agreement with the dive as it
   * stands, advancing nothing (`specs/instrumentation.md`).
   *
   * A body's `tx` and `ty`, `visionRadius`, `sonar.range`, the two `ready`
   * flags, `planktonRemaining` and a predator's `speed`, `detectRange` and
   * `hearingRange` are all functions of the world as it stands, and a build is
   * free to keep any of them as a copy — this is what rewrites such a copy from
   * what it is a copy of after a pose.
   */
  reconcile(): void;
  /**
   * The hit region of item `index` on the menu the current screen shows, and
   * `null` on the four screens that show no menu or for an index that menu does
   * not hold. A pure reading: it changes nothing.
   */
  menuItemRect(index: number): MenuRect | null;
  /** Sets `screen`, and changes no other field. */
  setScreen(s: Screen): void;
  /** Highlights item `index` of the current screen's menu, and nothing else. */
  setMenuIndex(index: number): void;
  /** Sets the title menu's remembered selection, and nothing else. */
  setTitleIndex(index: number): void;
  /** Sets the running score to a whole number of at least `0`. */
  setScore(points: number): void;
  /** Sets the lives held in reserve, the one being played not among them. */
  setLives(n: number): void;
  /** Sets the current depth to the whole number `d`, at least `1`. */
  setDepth(d: number): void;
  /**
   * Replaces the maze layout with the fixture given, `rows` strings of `cols`
   * characters in the snapshot's own tile alphabet.
   *
   * The posed layout is exempt from every rule in specs/maze.md, and the layout
   * is the whole of what it sets: the plankton, the fog, the roster, every
   * body's tile and facing, the cooldowns, the score, the lives, the depth and
   * the screen are all left exactly as they stand.
   */
  setMaze(rows: readonly string[]): void;
  /** Puts a plankton on an open corridor tile, or takes one off. */
  setPlankton(tx: number, ty: number, present: boolean): void;
  /** Takes every plankton off the maze at once, eating none of them. */
  clearPlankton(): void;
  /** Puts every tile of the maze back to unrevealed. */
  clearFog(): void;
  /** Moves the forager to the center of an open corridor tile, at rest. */
  setForagerTile(tx: number, ty: number): void;
  /** Sets the forager's facing, moving it nowhere. */
  setForagerDir(dir: Dir): void;
  /** Sets `G` to `g`, in `[0, 1]`, leaving the hold exactly as it stands. */
  setBrightness(g: number): void;
  /** Sets the seconds left on the brightness hold, from `0` to `BRIGHT_HOLD`. */
  setBrightHold(seconds: number): void;
  /** Takes every predator off the board at once, leaving the roster empty. */
  clearPredators(): void;
  /**
   * Adds one predator of `kind` at the center of an open corridor tile, at the
   * end of the roster, loose and patrolling with its mind running.
   */
  addPredator(kind: PredatorKind, tx: number, ty: number): void;
  /** Moves one predator, by its index in `snapshot().predators`, to a tile. */
  setPredatorTile(index: number, tx: number, ty: number): void;
  /** Sets one predator's facing. */
  setPredatorDir(index: number, dir: Dir): void;
  /** Poses one predator's state, on the tile it already stands on. */
  setPredatorState(index: number, value: PosablePredatorState): void;
  /** Sets one predator's `released` flag, moving it nowhere. */
  setPredatorReleased(index: number, released: boolean): void;
  /** Turns one predator's sensing and deciding on or off. */
  setPredatorMind(index: number, enabled: boolean): void;
  /** Turns one predator's locomotion on or off, its mind running untouched. */
  setPredatorTravel(index: number, enabled: boolean): void;
  /** Adds one bonus drifter at the center of an open corridor tile. */
  spawnDrifter(tx: number, ty: number): void;
  /** Takes every bonus drifter off the maze at once, eating none of them. */
  clearDrifters(): void;
  /** Turns one drifter's own wander on or off. */
  setDrifterMind(index: number, enabled: boolean): void;
  /** Turns one drifter's locomotion on or off, its wander running untouched. */
  setDrifterTravel(index: number, enabled: boolean): void;
  /** Poses the seconds left on the bonus-drifter cadence, `0` to `DRIFTER_INTERVAL`. */
  setDrifterIn(seconds: number): void;
  /** Sets the seconds remaining on the sonar pulse's cooldown. */
  setSonarCooldown(seconds: number): void;
  /** Sets the seconds remaining on ink's cooldown. */
  setInkCooldown(seconds: number): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/surface-present) calls a reading for its
 * value and a pose for its effect.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/** Every operation the surface must carry, in both variants. */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "reconcile",
  "menuItemRect",
  "setScreen",
  "setMenuIndex",
  "setTitleIndex",
  "setScore",
  "setLives",
  "setDepth",
  "setMaze",
  "setPlankton",
  "clearPlankton",
  "clearFog",
  "setForagerTile",
  "setForagerDir",
  "setBrightness",
  "setBrightHold",
  "clearPredators",
  "addPredator",
  "setPredatorTile",
  "setPredatorDir",
  "setPredatorState",
  "setPredatorReleased",
  "setPredatorMind",
  "setPredatorTravel",
  "spawnDrifter",
  "clearDrifters",
  "setDrifterMind",
  "setDrifterTravel",
  "setDrifterIn",
  "setSonarCooldown",
  "setInkCooldown",
] as const;
