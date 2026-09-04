// Spectra — the shapes the whole build agrees on.
//
// `specs/state.md` leaves the state's organization to the build and fixes only
// what it must carry. This is that shape: ONE state object, held by the runtime,
// advanced by the update, read by the renderer, and posed by the debug surface.
// Nothing else holds game state, which is what makes `snapshot()` a complete read
// and `reset()` a complete restore.

import type { Path } from "./paths";
import type { Burst } from "./bursts";

/** One of the two spectral bands. */
export type Band = "cyan" | "magenta";

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

/** The three drone kinds (specs/drones.md). */
export type DroneKind = "shard" | "flux" | "prism";

/** The four phases a drone moves through (specs/swarm.md). */
export type DronePhase = "entering" | "formation" | "diving" | "returning";

/** The ship and its cannon (specs/ship.md). */
export interface Ship {
  /** The ship's centre `x` along its lane. */
  x: number;
  /** The band the ship holds, which is also its hull's shield. */
  band: Band;
  /** Seconds of post-flip fire lockout left. */
  lockout: number;
  /** Seconds until the ship may fire again. */
  cooldown: number;
  /** Whether the ship's contact test runs (a debug-posable world gate). */
  contact: boolean;
}

/** One bullet in flight, the player's or a drone's (specs/ship.md, specs/swarm.md). */
export interface Bullet {
  id: number;
  /** The bullet's centre. */
  x: number;
  y: number;
  /** The bullet's velocity, in units per second. */
  vx: number;
  vy: number;
  /** The band it was fired with, fixed for its whole life. */
  band: Band;
  /** True for one of the player's bullets, travelling up. */
  friendly: boolean;
}

/** One drone on the field (specs/swarm.md, specs/drones.md, specs/mode.md). */
export interface Drone {
  id: number;
  kind: DroneKind;
  /** The stored band. For a Prism this is the SHELL's band. */
  band: Band;
  /** The drone's centre. */
  x: number;
  y: number;
  phase: DronePhase;
  /** Seconds the drone has been in its current phase. */
  phaseTime: number;
  /** The centre of the drone's resting formation slot. */
  slotX: number;
  slotY: number;
  /** The entry group the drone arrives with, counted from `0`. */
  group: number;
  /** Whether the wave has released this drone's group yet. */
  released: boolean;
  /** The path the drone is travelling, when it is travelling one. */
  path: Path | null;
  /** How far along that path the drone has travelled. */
  pathDist: number;
  /** How far a Flux is into its CURRENT band window, in seconds. */
  bandClock: number;
  /** Whether a Prism's outer shell stands. Always true on the other kinds. */
  shellAlive: boolean;
  /** How many shots the drone has taken during its current dive. */
  diveShots: number;
  /** Whether the drone has crossed the fire line on this dive. */
  fireArmed: boolean;
  /** Whether this dive has already triggered a spectral inversion. */
  invertedThisDive: boolean;
  /** Whether the drone's locomotion runs (a debug-posable faculty gate). */
  travel: boolean;
  /** Whether a Flux's band clock runs (a debug-posable faculty gate). */
  oscillation: boolean;
  /** Whether the drone's dive fire runs (a debug-posable faculty gate). */
  fire: boolean;
  /** The charge a mismatched shot feeds, from `0` to `OVERLOAD_AT`. */
  charge: number;
  /** Whether the drone belongs to a challenge stage's flyover. */
  challenge: boolean;
  /**
   * Whether the drone is one the STAGE'S OWN WAVE built.
   *
   * `specs/stages.md` clears a stage on the moment the last drone OF ITS WAVE is
   * destroyed, so a drone placed on the field by the debug surface is not one of
   * them and destroying it clears nothing.
   */
  ofWave: boolean;
  /** Whether this dive is an overloaded Shard's faster plunge. */
  plunge: boolean;
}

/** The live discharge wave (specs/resonance.md). */
export interface Discharge {
  /** Whether a wave is running. */
  active: boolean;
  /** Seconds the wave has been running. */
  elapsed: number;
  /** The wave's current radius, in logical units. */
  radius: number;
}

/** The whole of Spectra's state (specs/state.md). */
export interface SpectraState {
  // The screen and the run.
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  score: number;
  lives: number;
  stage: number;
  /** Whether the run's one extra life has already been paid. */
  extraLifeAwarded: boolean;
  /** How many of the current challenge stage's drones have been destroyed. */
  challengeHits: number;

  // The band systems.
  resonance: number;
  /** Seconds of spectral inversion remaining, `0` for none. */
  inversion: number;

  // The field.
  ship: Ship;
  discharge: Discharge;
  drones: Drone[];
  bullets: Bullet[];
  bursts: Burst[];

  // The wave's own schedules.
  /** Whether the wave's own release of drones runs. */
  waveEntry: boolean;
  /** Whether the assault's own dive launching runs. */
  diveLaunching: boolean;
  /** Whether the live stage's own end-of-stage test runs. */
  stageClearing: boolean;
  /** The clock the wave's entry groups are released against, in seconds. */
  entryClock: number;
  /** The clock the formation's sway is drawn against, in seconds. */
  swayClock: number;
  /** Seconds since the wave's last dive launch. */
  diveClock: number;
  /** The gap the next dive launch is waiting for, in seconds. */
  nextDiveGap: number;
  /**
   * Whether a stage's own wave is open: built, with at least one drone, and not
   * yet cleared. It is what makes the stage-clear transition a transition rather
   * than a predicate over an empty roster (specs/stages.md).
   */
  waveOpen: boolean;

  // The rest.
  simTime: number;
  muted: boolean;
  /** The whole state of the seeded generator (specs/instrumentation.md). */
  rngState: number;
  /** The next id a drone, bullet or burst will be handed. */
  nextId: number;
}
