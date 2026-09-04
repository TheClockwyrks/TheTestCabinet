// Spectra — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// returns, and this module is that specification written down as types: the
// operations, their arguments, the snapshot shape, and the version. It is the
// ONLY description of the surface the validators read. The build implements the
// surface under whatever module it likes and declares its own type for it — the
// `D` of its `GameDefinition<D>` — and nothing here imports it; the harness
// reaches the object itself through `engine.debug` alone. So a build whose
// surface departs from the specification is held against the specification, not
// against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation acts on the running game at the
// moment of the call, through the same systems play uses: a POSE takes only the
// arguments its row names, returns nothing, and arranges the live world
// (`setShipBand("magenta")`, `addDrone("shard", 640, 200)`), and a READING takes
// no arguments and returns plain data read off the world at the instant of the
// call (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.setResonance(100)`, `engine.debug.snapshot()` — with no wrapper
// in between. `version` is a plain number.
//
// The clock, the keyboard, the audio bus, and the overlay belong to the engine
// under this engine, so the surface carries no operation for any of them:
// `setAutoStep` and `advance` exist under the engineless build alone, and
// demanding either here would fail a perfectly conformant build. There is no
// `setMuted` under any engine — `muted` is the runtime's own bit, reached
// through the `mute` binding and reported by the snapshot.
//
// THE TWO VARIANTS SHARE THIS FILE, because one validator directory serves both.
// `overload` adds one field (`charge`) and one pose (`setDroneCharge`), and both
// are declared OPTIONAL here so a `base` build — which is never asked for either
// — is not held to them. {@link REQUIRED_OPS} is what every build owes;
// {@link OVERLOAD_OPS} is what the `overload` suites additionally reach for.

/** The surface's version, reported as `version`. */
export const SPECTRA_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The seven screens the game moves between (specs/ui.md). */
export type Screen =
  | "title"
  | "howto"
  | "stageIntro"
  | "inWave"
  | "paused"
  | "stageCleared"
  | "gameOver";

/** The two sub-phases of the `inWave` screen (specs/progression.md). */
export type Phase = "live" | "ready";

/** The two bands everything in Spectra is one of (specs/bands.md). */
export type Band = "cyan" | "magenta";

/** The three drone kinds (specs/drones.md). */
export type DroneKind = "shard" | "flux" | "prism";

/** The four phases of a drone's life (specs/swarm.md). */
export type DronePhase = "entering" | "formation" | "diving" | "returning";

/** The mode the build ships, which `specs/mode.md` defines. */
export type Mode = "sortie" | "overload";

/**
 * One drone on the field, as the snapshot reports it.
 *
 * `x`/`y` is the drone's CENTER in logical stage units, and so is
 * `slotX`/`slotY`. `band` is the STORED band — on a Prism the shell's, on a Flux
 * the band it holds or, mid-shimmer, the one it is leaving — while
 * `effectiveBand` is what the drone currently reads and counts as.
 */
export interface DroneSnapshot {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  band: Band;
  effectiveBand: Band;
  phase: DronePhase;
  slotX: number;
  slotY: number;
  /** Seconds into the CURRENT band window; `0` on a Shard and a Prism. */
  bandClock: number;
  /** A Flux settled on neither band; `false` on the other two kinds. */
  shimmer: boolean;
  /** A Prism's outer shell stands; `true` on the other two kinds. */
  shellAlive: boolean;
  travel: boolean;
  oscillation: boolean;
  fire: boolean;
  /** `0..OVERLOAD_AT`. The `overload` variant alone reports it. */
  charge?: number;
}

/** One bullet in flight. `x`/`y` is its CENTER, `vx`/`vy` logical units per second. */
export interface BulletSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: Band;
  effectiveBand: Band;
  /** `true` for one of the player's, traveling up. */
  friendly: boolean;
}

/** One drone-burst playing. `x`/`y` is its CENTER. */
export interface BurstSnapshot {
  id: number;
  x: number;
  y: number;
  /** The footprint the effect is played at, in logical units. */
  size: number;
  /** Seconds into the effect. */
  elapsed: number;
  /** Live particles the burst's own simulation holds at the call. */
  particles: number;
}

/** The ship: its lane position, its band, and the three clocks it carries. */
export interface ShipSnapshot {
  /** The ship's CENTER along its lane. */
  x: number;
  band: Band;
  /** Derived: `false` exactly while `phase` is `"ready"`. */
  alive: boolean;
  /** Seconds of post-flip fire lockout left. */
  lockout: number;
  /** Seconds until the next shot is allowed. */
  cooldown: number;
  /** The ship's contact test runs. */
  contact: boolean;
}

/** The live discharge wave. */
export interface DischargeSnapshot {
  active: boolean;
  /** The live wave's radius, in logical units. */
  radius: number;
}

/**
 * A menu item's hit region, in logical units, as `menuItemRect` returns it.
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size
 * (`specs/instrumentation.md`). Where a build LAYS its menus out is the build's
 * own (`specs/ui.md`), so this is the only thing a pointer check knows about the
 * geometry it drives at.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation can set is present, so every operation is verifiable
 * by setting a value and reading it back. The derived entries — `isChallenge`,
 * `dischargeReady`, `inversionActive`, `ship.alive`, the four stage-scaled
 * figures, each drone's `effectiveBand` and `shimmer` — are built at the call
 * from the fields they follow, by the formulas specs/stages.md,
 * specs/resonance.md and specs/bands.md fix.
 */
export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** Seconds left in the current hold. */
  phaseTimer: number;
  /** The highlighted menu item, from 0. */
  menuIndex: number;
  /** The mode this build ships (specs/mode.md). */
  mode: Mode;
  /** `1` and up. */
  stage: number;
  /** Derived: `stage % CHALLENGE_EVERY === 0`. */
  isChallenge: boolean;
  score: number;
  lives: number;
  /** The run's one extra life has been paid. */
  extraLifeAwarded: boolean;
  /** `0..RESONANCE_MAX`. */
  resonance: number;
  /** Derived: `resonance >= RESONANCE_MAX`. */
  dischargeReady: boolean;
  /** Seconds of spectral inversion left, `0` for none. */
  inversion: number;
  /** Derived: `inversion > 0`. */
  inversionActive: boolean;
  /** The runtime's own mute bit, refreshed in every update. */
  muted: boolean;
  /** The wave's own release of drones runs. */
  waveEntry: boolean;
  /** The assault's own dive choice runs. */
  diveLaunching: boolean;
  /** Seconds since the wave's last dive launch. */
  diveClock: number;
  /** Derived from `stage`. */
  droneSpeedScale: number;
  /** Derived from `stage`. */
  bulletSpeedScale: number;
  /** Derived from `stage`. */
  diveGapScale: number;
  /** Derived from `stage`, in seconds. */
  fluxHold: number;
  ship: ShipSnapshot;
  discharge: DischargeSnapshot;
  /** Every drone on the field, in roster order. */
  drones: DroneSnapshot[];
  /** Every bullet in flight, in roster order. */
  bullets: BulletSnapshot[];
  /** Every drone-burst playing, in roster order. */
  bursts: BurstSnapshot[];
  /** Accumulated simulation time, in seconds, on every screen. */
  simTime: number;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game at the moment of the call and returns nothing;
 * `snapshot` is a reading of that same running game, built at the call. No frame
 * has to be advanced between a pose and the reading that checks it.
 *
 * Every `x` and `y` is an entity's CENTER in the stage's logical units.
 */
export interface SpectraDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): SpectraSnapshot;
  /**
   * A pure read of the hit region of item `index` on the menu the current screen
   * shows, in logical units. It changes nothing.
   *
   * `null` on the four screens that show no menu and for an index the current
   * menu has no item at (`specs/instrumentation.md`).
   */
  menuItemRect(index: number): MenuRect | null;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(n: number): void;
  setScore(n: number): void;
  setLives(n: number): void;
  setStage(n: number): void;
  setExtraLifeAwarded(awarded: boolean): void;

  setWaveEntry(enabled: boolean): void;
  setDiveLaunching(enabled: boolean): void;
  setShipContact(enabled: boolean): void;
  setDiveClock(seconds: number): void;

  setShipX(x: number): void;
  setShipBand(band: Band): void;
  setFireLockout(seconds: number): void;
  setFireCooldown(seconds: number): void;

  setResonance(value: number): void;
  setInversion(seconds: number): void;

  addDrone(kind: DroneKind, x: number, y: number): void;
  setDronePosition(id: number, x: number, y: number): void;
  setDroneBand(id: number, band: Band): void;
  setDronePhase(id: number, phase: DronePhase): void;
  setDroneSlot(id: number, x: number, y: number): void;
  setDroneBandClock(id: number, seconds: number): void;
  setDroneShell(id: number, intact: boolean): void;
  setDroneTravel(id: number, enabled: boolean): void;
  setDroneOscillation(id: number, enabled: boolean): void;
  setDroneFire(id: number, enabled: boolean): void;
  removeDrone(id: number): void;
  clearDrones(): void;

  addPlayerBullet(x: number, y: number, band: Band): void;
  addEnemyBullet(x: number, y: number, band: Band): void;
  setBulletVelocity(id: number, vx: number, vy: number): void;
  removeBullet(id: number): void;
  clearPlayerBullets(): void;
  clearEnemyBullets(): void;

  removeBurst(id: number): void;
  clearBursts(): void;

  /** Poses a drone's charge, `0..OVERLOAD_AT`: the `overload` variant alone. */
  setDroneCharge?(id: number, charge: number): void;
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

/**
 * Every operation the surface must carry under this engine, in the order
 * specs/instrumentation.md states them.
 *
 * `setAutoStep` and `advance` belong to the engineless build alone: the engine
 * owns the clock here, so they are deliberately absent. `setDroneCharge` is the
 * `overload` variant's alone and is in {@link OVERLOAD_OPS} instead, so a `base`
 * build is not failed for lacking an operation it was never asked for.
 */
export const REQUIRED_OPS = [
  // The core.
  "reset",
  "snapshot",
  "menuItemRect",

  // The screen and the run.
  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setStage",
  "setExtraLifeAwarded",

  // The world gates and the dive clock.
  "setWaveEntry",
  "setDiveLaunching",
  "setShipContact",
  "setDiveClock",

  // The ship and its cannon.
  "setShipX",
  "setShipBand",
  "setFireLockout",
  "setFireCooldown",

  // Resonance and the inversion.
  "setResonance",
  "setInversion",

  // The drones.
  "addDrone",
  "setDronePosition",
  "setDroneBand",
  "setDronePhase",
  "setDroneSlot",
  "setDroneBandClock",
  "setDroneShell",
  "setDroneTravel",
  "setDroneOscillation",
  "setDroneFire",
  "removeDrone",
  "clearDrones",

  // The bullets.
  "addPlayerBullet",
  "addEnemyBullet",
  "setBulletVelocity",
  "removeBullet",
  "clearPlayerBullets",
  "clearEnemyBullets",

  // The bursts.
  "removeBurst",
  "clearBursts",
] as const;

/**
 * Every operation the `overload` variant's surface carries BEYOND
 * {@link REQUIRED_OPS} (specs/instrumentation.md, The drones).
 *
 * Only the `overload` group's suites name this list. A `base` build's surface is
 * complete without it.
 */
export const OVERLOAD_OPS = ["setDroneCharge"] as const;
