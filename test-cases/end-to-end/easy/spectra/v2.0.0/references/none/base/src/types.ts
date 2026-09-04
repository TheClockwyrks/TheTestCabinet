// Spectra — the game's state, in one value.
//
// `specs/state.md` states what the state must carry and leaves its shape to the
// build. This is that shape: one mutable object the frame loop advances, the
// renderer reads, and the debug and automation surface reads and poses. Nothing
// else holds game state.
//
// Three things here are NOT game state and are called out where they sit: the
// decoded art (`art`), the starfield's layout (`stars`) and the per-frame cue set
// (`cues`), which is drained at the end of every frame so a frame raising a cue
// twice plays it once (specs/ui.md).

import type {
  ParticleSimulator,
  ParticleSystem,
} from "@test-cabinet/particle-runtime";

import type { Band, CueName } from "./constants";
import type { Path } from "./paths";
import type { RngState } from "./rng";

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

/** A drone's movement phase (specs/swarm.md). */
export type DronePhase = "entering" | "formation" | "diving" | "returning";

/** One decoded sprite, ready for `drawImage`. */
export type Sprite = CanvasImageSource;

/**
 * The seeded art, decoded and derived into the band-states the game draws
 * (specs/assets.md). Both band-states of one sprite are the same silhouette
 * carrying the other band's colour; the ring and diamond accents are drawn in
 * code on top, so a sprite's alpha silhouette is always the seeded one.
 */
export interface Art {
  /** The ship, by the band it is tuned to. */
  fighter: Record<Band, Sprite>;
  /** A Shard, by its band. */
  shard: Record<Band, Sprite>;
  /** A Flux settled on a band, by that band. */
  fluxHeld: Record<Band, Sprite>;
  /** A Flux mid-shimmer: the seeded art, showing both bands at once. */
  fluxShimmer: Sprite;
  /** A Prism with its shell intact, by its SHELL's band. */
  prismFull: Record<Band, Sprite>;
  /** A Prism with only its core left, by its CORE's band. */
  prismCore: Record<Band, Sprite>;
  /** The seeded drone-burst system, as authored. */
  burst: ParticleSystem;
}

/** One drone on the field. */
export interface Drone {
  /** Distinct among the entities live at any moment, and kept for life. */
  id: number;
  kind: DroneKind;
  /** The drone's CENTRE. */
  x: number;
  y: number;
  /** Its stored band. For a Prism this is the SHELL's; the core's is opposite. */
  band: Band;
  phase: DronePhase;
  /** Seconds it has been in the current phase. */
  phaseSeconds: number;
  /** The CENTRE of its resting formation slot. */
  slotX: number;
  slotY: number;
  /** The entry group it arrives with, counted from `0`. */
  entryGroup: number;
  /** Whether its group has been released; an unreleased drone holds its start. */
  released: boolean;
  /** How far a Flux is into its current band window, in seconds. */
  bandClock: number;
  /** Whether a Prism's outer shell stands; `true` on the other two kinds. */
  shellAlive: boolean;
  /** Shots taken during the current dive. */
  shots: number;
  /** It crossed the fire line and still owes the shot that crossing bought. */
  firePending: boolean;
  /** Its locomotion gate (specs/instrumentation.md). */
  travel: boolean;
  /** A Flux's band-clock gate; it gates nothing on the other two kinds. */
  oscillation: boolean;
  /** Its firing gate. */
  fire: boolean;
  /** The curve it is flying, or `null` while it rests in its slot. */
  path: Path | null;
  /** How far along that curve it has travelled. */
  pathDist: number;
  /** Marked for removal at the end of the sub-step. */
  dead: boolean;
  /** Marked for a drone-burst at the end of the sub-step, at this footprint. */
  popAt: number;
}

/** One bullet in flight. One roster holds both kinds, told apart by `friendly`. */
export interface Bullet {
  id: number;
  /** The bullet's CENTRE. */
  x: number;
  y: number;
  /** Logical units per second. */
  vx: number;
  vy: number;
  /** The band it was fired with, fixed for its whole life. */
  band: Band;
  /** `true` for one of the player's, travelling up. */
  friendly: boolean;
  dead: boolean;
}

/** One drone-burst playing. */
export interface Burst {
  id: number;
  /** The burst's CENTRE. */
  x: number;
  y: number;
  /** The footprint the seeded system's square field is played at. */
  size: number;
  /** Seconds into the effect. */
  elapsed: number;
  /** Its own simulation of the seeded system, seeded from the game's generator. */
  sim: ParticleSimulator;
}

/** One mark of the starfield. Presentation only; it carries no game state. */
export interface Star {
  x: number;
  y: number;
  r: number;
  color: string;
}

/** The ship and its cannon. */
export interface Ship {
  /** The ship's CENTRE `x` along its lane; its `y` is always `SHIP_Y`. */
  x: number;
  band: Band;
  /** Seconds of post-flip fire lockout left. */
  lockout: number;
  /** Seconds until the next shot is allowed. */
  cooldown: number;
  /** Whether the ship's contact test runs (specs/instrumentation.md). */
  contact: boolean;
}

/** The live discharge wave. */
export interface Discharge {
  active: boolean;
  /** The live wave's radius, in logical units. */
  radius: number;
  /** Seconds of the wave's life left. */
  timer: number;
}

/** The whole of the game, in one value. */
export interface SpectraState {
  /** The decoded seeded art. Not game state: it never changes after load. */
  readonly art: Art;
  /** The starfield's layout. Not game state: it never changes after load. */
  readonly stars: readonly Star[];
  /** Cues raised by the frame in progress, played once each as it closes. */
  readonly cues: Set<CueName>;

  screen: Screen;
  phase: Phase;
  /** Seconds left in whichever hold the current screen or phase is running. */
  phaseTimer: number;
  /** The highlighted item of whatever menu the current screen shows, from `0`. */
  menuIndex: number;

  score: number;
  lives: number;
  stage: number;
  /** Whether the run's single extra life has already been paid. */
  extraLifeAwarded: boolean;
  /** How many of the current challenge stage's drones have been destroyed. */
  challengeHits: number;

  /** The resonance meter, `0` to `RESONANCE_MAX`. */
  resonance: number;
  /** Seconds of spectral inversion left, `0` for none. */
  inversion: number;

  ship: Ship;
  discharge: Discharge;
  drones: Drone[];
  bullets: Bullet[];
  bursts: Burst[];

  /** Whether the wave's own release of drones runs. */
  waveEntry: boolean;
  /** Whether the assault's own dive launching runs. */
  diveLaunching: boolean;
  /** Whether the live stage's own end-of-stage test runs. */
  stageClearing: boolean;
  /** The clock the wave's entry groups are released against. */
  entryClock: number;
  /** The clock the formation's sway is drawn against. */
  swayClock: number;
  /** Seconds since the wave's last dive launch. */
  diveClock: number;
  /** The dive clock the next launch waits for. */
  diveGap: number;
  /**
   * Whether a drone of the current wave has been destroyed or has left the
   * field. A live wave that holds no drone and has had none removed is being
   * played rather than cleared (specs/stages.md).
   */
  waveRemoved: boolean;

  /** Accumulated simulation time, in seconds. */
  simTime: number;
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;
  /** The whole state of the one seeded generator every random choice runs off. */
  rngState: RngState;
  /** The id the next drone, bullet or burst takes. */
  nextId: number;
}
