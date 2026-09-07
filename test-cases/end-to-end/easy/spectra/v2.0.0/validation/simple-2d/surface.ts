// Spectra — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns beside
// its state, as `[state, debug]`, and this module is that specification written
// down as types: the operations, their arguments, the snapshot shape, and the
// version. It is the ONLY description of the surface the validators read. The
// build implements the surface under whatever module it likes and declares its own
// type for it — `SpectraDebugApi`, exported from `src/game.ts` — and nothing here
// imports that type; the harness reaches the object itself through `engine.debug`
// alone. So a build whose surface departs from the specification is held against
// the specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface holds no state of its own and nothing on it mutates
// anything. Every operation is written in the shape of the game's `update`: a POSE
// takes the current state and returns the next one (`setShipBand(state,
// "magenta")`, `addDrone(state, "shard", 640, 200)`), and a READING takes the
// current state and returns what it read (`snapshot(state)`). A caller drives a
// pose through `engine.apply((s) => debug.setShipBand(s, "magenta"))` — the engine
// stores what the pose returned, and the next frame's `update` receives it — and a
// reading through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module imports
// nothing of the build: `harness.ts` binds it to the `SpectraState` the build
// declared, and the `Driver` there is what gives the validators the imperative
// reading (`h.debug.setShipBand("magenta")`, `h.debug.snapshot()`) over the pure
// shape declared here.
//
// THERE IS NO CLOCK OPERATION AND NO `setMuted`. Under an engine the clock is the
// engine's — a validator steps exact frames with `engine.advance` over the
// harness's `ConstantClock` — and the mute bit is the engine's audio bus, which a
// pure `(state, ...) => state` transform could not reach. `mute` is driven through
// its real binding and `snapshot().muted` reports the result
// (specs/instrumentation.md).
//
// THERE IS NO OPERATION THAT FLIPS, FIRES, DISCHARGES, OR ADDS A BURST. Each of
// those is an OUTCOME some review item grades, so the surface poses the situation
// and the game's own rules produce the outcome: a validator drives the real action
// and reads the band, the bullets, the discharge wave or the burst that follows.
//
// SPECTRA SHIPS TWO VARIANTS, `base` (Sortie) and `overload`, and they share one
// surface. The two members `overload` alone carries are declared here as OPTIONAL,
// so one harness serves both workspaces: `setDroneCharge` and the drone's
// `charge`. Everything else is required under both, and {@link REQUIRED_OPS} is
// the list a build is held to whichever variant it built. The suites under
// `overload/` require the two optional members before reading them; nothing under
// the fifteen common groups may touch either.

import type { DeepReadonly } from "ts-essentials";

/** The seed `reset()` restores when the caller names none (`DEFAULT_SEED`). */
export const DEFAULT_SEED = 1;

/** The seven screens the game moves between. */
export type Screen =
  | "title"
  | "howto"
  | "stageIntro"
  | "inWave"
  | "paused"
  | "stageCleared"
  | "gameOver";

/** The two sub-phases of the `inWave` screen. */
export type Phase = "live" | "ready";

/** The two bands. There is no neutral value. */
export type Band = "cyan" | "magenta";

/** The three drone kinds. */
export type DroneKind = "shard" | "flux" | "prism";

/** The four phases a drone passes through. */
export type DronePhase = "entering" | "formation" | "diving" | "returning";

/** Which mode the build ships, which `specs/mode.md` defines. */
export type Mode = "sortie" | "overload";

/** The ship. `x` is its CENTER along its fixed lane. */
export interface ShipSnapshot {
  x: number;
  band: Band;
  /** Derived: false exactly while `phase` is `"ready"`. */
  alive: boolean;
  /** Seconds of post-flip fire lockout left, `0` for none. */
  lockout: number;
  /** Seconds until the next shot is allowed, `0` for none. */
  cooldown: number;
  /** The ship's contact test runs. */
  contact: boolean;
}

/** The live discharge wave. Reported, never set. */
export interface DischargeSnapshot {
  active: boolean;
  /** The live wave's radius, in logical units. */
  radius: number;
}

/** One drone on the field. `x` and `y` are its CENTER. */
export interface DroneSnapshot {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  /** Its STORED band. On a Prism this is the SHELL's; the core's is the opposite. */
  band: Band;
  /** The band it currently reads and counts as (specs/bands.md). */
  effectiveBand: Band;
  phase: DronePhase;
  /** The CENTER of its resting formation slot. */
  slotX: number;
  slotY: number;
  /** Seconds into the CURRENT band window; `0` on a Shard or a Prism. */
  bandClock: number;
  /** Derived: a Flux settled on neither band. `false` on the other two kinds. */
  shimmer: boolean;
  /** A Prism's outer shell stands. `true` on the other two kinds. */
  shellAlive: boolean;
  /** The locomotion faculty: the entrance path, the sway, the dive, the return. */
  travel: boolean;
  /** The band-clock faculty. It gates nothing on a Shard or a Prism. */
  oscillation: boolean;
  /** The firing faculty: the shots the drone takes during a dive. */
  fire: boolean;
  /** `0..OVERLOAD_AT`. OVERLOAD ONLY: absent under `base`. */
  charge?: number;
}

/** One bullet in flight. `x` and `y` are its CENTER; one roster holds both kinds. */
export interface BulletSnapshot {
  id: number;
  x: number;
  y: number;
  /** Its velocity, in logical units per second. */
  vx: number;
  vy: number;
  /** The band it was fired with and keeps for its life. */
  band: Band;
  /** The band it currently reads and counts as; a player bullet is never swapped. */
  effectiveBand: Band;
  /** `true` for one of the player's, travelling up. */
  friendly: boolean;
}

/** One drone-burst playing. `x` and `y` are its CENTER. */
export interface BurstSnapshot {
  id: number;
  x: number;
  y: number;
  /** The footprint the effect is played at. */
  size: number;
  /** Seconds into the effect. */
  elapsed: number;
  /** The live particles the burst's own simulation holds at the call. */
  particles: number;
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

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** Seconds left in the current hold. */
  phaseTimer: number;
  /** The highlighted item of the current screen's menu, from `0`. */
  menuIndex: number;
  /** The mode this build ships. */
  mode: Mode;
  /** `1` and up. */
  stage: number;
  /** Derived: `stage % CHALLENGE_EVERY === 0`. */
  isChallenge: boolean;
  score: number;
  lives: number;
  /** The run's one extra life has been paid. */
  extraLifeAwarded: boolean;
  /** The current challenge stage's tally of drones destroyed. */
  challengeHits: number;
  /** `0..RESONANCE_MAX`. */
  resonance: number;
  /** Derived: `resonance >= RESONANCE_MAX`. */
  dischargeReady: boolean;
  /** Seconds of spectral inversion left, `0` for none. */
  inversion: number;
  /** Derived: `inversion > 0`. */
  inversionActive: boolean;
  /** The runtime's mute bit, as the game read it. No operation sets it. */
  muted: boolean;
  /** The wave's own release of drones runs. */
  waveEntry: boolean;
  /** The assault's own dive choice runs. */
  diveLaunching: boolean;
  /** The stage's own end-of-stage test runs. */
  stageClearing: boolean;
  /** Seconds since the wave's last dive launch. */
  diveClock: number;
  /** Seconds that clock must reach for the next dive to launch. */
  diveGap: number;
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
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and
 * `snapshot` is a reading of the current state. None of them touches the state it
 * was handed: `DeepReadonly<S>` is the view the engine hands out, and the compiler
 * is what says a pose returns a new value rather than mutating.
 *
 * Every operation SETS ONE FIELD, reads the state, or adds or removes ONE entity,
 * and takes scalars. There is no operation that takes a layout and none that
 * arranges several things at once: `startPosed`, `startStage`, `poseDrone` and
 * `poseFormation` are helpers in `harness.ts` built out of these, not operations a
 * build implements.
 */
export interface SpectraDebugApi<S = unknown> {
  version: number;

  // ---- The core ----------------------------------------------------------

  /** Restore every declared field to its title-screen value. */
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  /** A pure read of the state. It changes nothing. */
  snapshot(state: DeepReadonly<S>): SpectraSnapshot;
  /**
   * Brings every value the snapshot reports into agreement with the game as it
   * stands, without advancing anything (`specs/instrumentation.md`).
   *
   * A build that works its derived readings out at the read returns a state
   * equal to the one it was handed; a build that keeps one as a stored copy
   * rewrites it from its source. It is what a driver calls after posing a game
   * and before reading it back.
   */
  reconcile(state: DeepReadonly<S>): S;
  /**
   * A pure read of the hit region of item `index` on the menu the current screen
   * shows, in logical units. It changes nothing.
   *
   * `null` on the four screens that show no menu and for an index the current
   * menu has no item at (`specs/instrumentation.md`).
   */
  menuItemRect(state: DeepReadonly<S>, index: number): MenuRect | null;

  // ---- The screen and the run --------------------------------------------

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setPhase(state: DeepReadonly<S>, phase: Phase): S;
  setPhaseTimer(state: DeepReadonly<S>, seconds: number): S;
  setMenuIndex(state: DeepReadonly<S>, n: number): S;
  /** Sets the score. It grants no extra life: this is a precondition. */
  setScore(state: DeepReadonly<S>, n: number): S;
  setLives(state: DeepReadonly<S>, n: number): S;
  /** Sets the stage, a whole number from `1`. It spawns and clears nothing. */
  setStage(state: DeepReadonly<S>, n: number): S;
  /** Sets the run's one-extra-life latch. */
  setExtraLifeAwarded(state: DeepReadonly<S>, awarded: boolean): S;
  /**
   * Sets the current challenge stage's tally of drones destroyed, a whole
   * number from `0`. It destroys nothing and pays nothing.
   */
  setChallengeHits(state: DeepReadonly<S>, n: number): S;

  // ---- The world gates and the dive clock --------------------------------

  /** Gates the wave's own release of entry groups, and nothing else. */
  setWaveEntry(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the assault's own choice of which drone dives next, and nothing else. */
  setDiveLaunching(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the live stage's own end-of-stage test, and nothing else. */
  setStageClearing(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the ship's contact test, and nothing else. Reported as `ship.contact`. */
  setShipContact(state: DeepReadonly<S>, enabled: boolean): S;
  /** Sets the seconds since the wave's last dive launch. It launches nothing. */
  setDiveClock(state: DeepReadonly<S>, seconds: number): S;
  setDiveGap(state: DeepReadonly<S>, seconds: number): S;

  // ---- The ship and its cannon -------------------------------------------

  /** Places the ship's CENTER along its lane. The lane's clamp applies. */
  setShipX(state: DeepReadonly<S>, x: number): S;
  /** Sets the band the ship holds. It starts no fire lockout. */
  setShipBand(state: DeepReadonly<S>, band: Band): S;
  setFireLockout(state: DeepReadonly<S>, seconds: number): S;
  setFireCooldown(state: DeepReadonly<S>, seconds: number): S;

  // ---- Resonance and the inversion ---------------------------------------

  /** Sets the meter, `0..RESONANCE_MAX`. `dischargeReady` follows it. */
  setResonance(state: DeepReadonly<S>, value: number): S;
  /** Sets the seconds of inversion left. `inversionActive` follows it. */
  setInversion(state: DeepReadonly<S>, seconds: number): S;

  // ---- The drones --------------------------------------------------------

  /**
   * Adds one drone of `kind` at a CENTER, appended to the roster with a fresh id.
   *
   * It opens cyan, in phase `"formation"`, its slot the position it was placed at,
   * its band clock `0`, its shell intact, its charge `0` under `overload`, and all
   * three of its faculties ON.
   */
  addDrone(state: DeepReadonly<S>, kind: DroneKind, x: number, y: number): S;
  setDronePosition(state: DeepReadonly<S>, id: number, x: number, y: number): S;
  /** Sets the STORED band, on every kind. `bandClock` stays where it stands. */
  setDroneBand(state: DeepReadonly<S>, id: number, band: Band): S;
  setDronePhase(state: DeepReadonly<S>, id: number, phase: DronePhase): S;
  setDroneSlot(state: DeepReadonly<S>, id: number, x: number, y: number): S;
  /** Sets the position inside the CURRENT band window, `0..fluxWindow(stage)`. */
  setDroneBandClock(state: DeepReadonly<S>, id: number, seconds: number): S;
  setDroneShell(state: DeepReadonly<S>, id: number, intact: boolean): S;
  /** Sets the charge, `0..OVERLOAD_AT`. OVERLOAD ONLY: absent under `base`. */
  setDroneCharge?(state: DeepReadonly<S>, id: number, charge: number): S;
  /** Gates the drone's locomotion alone. */
  setDroneTravel(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  /** Gates a Flux's band clock alone. */
  setDroneOscillation(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  /** Gates the drone's firing alone. */
  setDroneFire(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  removeDrone(state: DeepReadonly<S>, id: number): S;
  /** Removes every drone, leaving the bullets and bursts standing. */
  clearDrones(state: DeepReadonly<S>): S;

  // ---- The bullets -------------------------------------------------------

  /** Adds one of the player's bullets at a CENTER, climbing at PLAYER_BULLET_SPEED. */
  addPlayerBullet(state: DeepReadonly<S>, x: number, y: number, band: Band): S;
  /** Adds one enemy bullet at a CENTER, falling at the stage's ENEMY_BULLET_SPEED. */
  addEnemyBullet(state: DeepReadonly<S>, x: number, y: number, band: Band): S;
  /** Sets a bullet's velocity, in logical units per second. */
  setBulletVelocity(
    state: DeepReadonly<S>,
    id: number,
    vx: number,
    vy: number,
  ): S;
  removeBullet(state: DeepReadonly<S>, id: number): S;
  /** Removes the player's bullets alone. */
  clearPlayerBullets(state: DeepReadonly<S>): S;
  /** Removes the enemy bullets alone. */
  clearEnemyBullets(state: DeepReadonly<S>): S;

  // ---- The bursts --------------------------------------------------------

  removeBurst(state: DeepReadonly<S>, id: number): S;
  /** Removes every live burst, leaving the drones and bullets standing. */
  clearBursts(state: DeepReadonly<S>): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the current
 * state and hand back, and which to run through `engine.apply`; the surface's
 * shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/**
 * Every operation the surface must carry under EITHER variant, in the order
 * specs/instrumentation.md lists them.
 *
 * `instrumentation/surface-present` reads this table: a build missing any one of
 * these is missing a deliverable the case requires, and the point names it.
 *
 * `setDroneCharge` is deliberately absent — it is the overload variant's own
 * operation, and `overload/*` is where a build is held to it.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "reconcile",
  "menuItemRect",

  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setStage",
  "setExtraLifeAwarded",
  "setChallengeHits",

  "setWaveEntry",
  "setDiveLaunching",
  "setStageClearing",
  "setShipContact",
  "setDiveClock",
  "setDiveGap",

  "setShipX",
  "setShipBand",
  "setFireLockout",
  "setFireCooldown",

  "setResonance",
  "setInversion",

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

  "addPlayerBullet",
  "addEnemyBullet",
  "setBulletVelocity",
  "removeBullet",
  "clearPlayerBullets",
  "clearEnemyBullets",

  "removeBurst",
  "clearBursts",
] as const;
