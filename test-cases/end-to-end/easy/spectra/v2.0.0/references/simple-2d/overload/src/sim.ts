// Spectra — the working value a frame is built in.
//
// The engine holds the state by value and hands every reader a
// `DeepReadonly<SpectraState>` view, so nothing in this build ever writes to a
// state it was handed. What `update` and every debug pose do instead is COPY the
// state they were given into a `Sim` — a field-for-field mirror of `SpectraState`
// with the `readonly` markers dropped — advance that, and return it. TypeScript
// accepts the result as a `SpectraState` because a mutable field is assignable to
// a readonly one, so the copy costs a type assertion nowhere.
//
// The copy is deep down to the entities: every drone, bullet and burst is rebuilt,
// so a frame can rewrite one without the state it came from noticing. A burst's
// particle simulation and the loaded art are carried across by reference: the
// simulation is a live object the burst owns for its whole life, and the art is
// loaded once and never written.

import { nextInt, nextRange, nextSeed } from "./rng";
import type { CueName } from "./constants";
import type {
  Art,
  Band,
  DroneKind,
  DronePhase,
  Phase,
  Screen,
  SpectraState,
} from "./game";
import type { ParticleSimulator } from "@test-cabinet/particle-runtime";
import type { DeepReadonly } from "ts-essentials";

/**
 * What a frame produced beside the state it advanced.
 *
 * Cues are gathered rather than played as they happen, so a frame that raises one
 * twice still plays it once, which is what `specs/ui.md` asks for.
 * `dronesRemoved` is what the stage-clear rule reads: `specs/stages.md` makes a
 * clear the MOMENT the last drone of a wave is destroyed, or, on a challenge
 * stage, the moment the last of its drones has left the field, so a wave that
 * holds no drone and has had none removed is being played rather than cleared.
 * That is a fact about the frame rather than about the field.
 */
export interface FrameEvents {
  readonly cues: Set<CueName>;
  dronesRemoved: number;
}

/** A fresh record of what a frame produced. */
export function newFrameEvents(): FrameEvents {
  return { cues: new Set<CueName>(), dronesRemoved: 0 };
}

export interface MutShip {
  x: number;
  band: Band;
  lockout: number;
  cooldown: number;
  contact: boolean;
}

export interface MutDischarge {
  active: boolean;
  radius: number;
}

export interface MutDrone {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  band: Band;
  phase: DronePhase;
  phaseClock: number;
  slotX: number;
  slotY: number;
  entryGroup: number;
  bandClock: number;
  shellAlive: boolean;
  shotsFired: number;
  travel: boolean;
  oscillation: boolean;
  fire: boolean;
  charge: number;
}

export interface MutBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: Band;
  friendly: boolean;
}

export interface MutBurst {
  id: number;
  x: number;
  y: number;
  size: number;
  elapsed: number;
  sim: ParticleSimulator;
}

/** The whole of `SpectraState`, writable, for the length of one transition. */
export interface Sim {
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;

  score: number;
  lives: number;
  stage: number;
  extraLifeAwarded: boolean;
  challengeHits: number;

  resonance: number;
  inversion: number;

  ship: MutShip;
  discharge: MutDischarge;

  drones: MutDrone[];
  bullets: MutBullet[];
  bursts: MutBurst[];

  waveEntry: boolean;
  diveLaunching: boolean;
  entryClock: number;
  swayClock: number;
  diveClock: number;
  diveTarget: number;

  nextId: number;
  simTime: number;
  muted: boolean;
  rngState: number;

  art: Art;
}

/** Copy one drone into a value this transition may write. */
export function copyDrone(drone: DeepReadonly<MutDrone>): MutDrone {
  return {
    id: drone.id,
    kind: drone.kind,
    x: drone.x,
    y: drone.y,
    band: drone.band,
    phase: drone.phase,
    phaseClock: drone.phaseClock,
    slotX: drone.slotX,
    slotY: drone.slotY,
    entryGroup: drone.entryGroup,
    bandClock: drone.bandClock,
    shellAlive: drone.shellAlive,
    shotsFired: drone.shotsFired,
    travel: drone.travel,
    oscillation: drone.oscillation,
    fire: drone.fire,
    charge: drone.charge,
  };
}

/** Copy the state handed in into a value this transition may write. */
export function toSim(state: DeepReadonly<SpectraState>): Sim {
  return {
    screen: state.screen,
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    menuIndex: state.menuIndex,

    score: state.score,
    lives: state.lives,
    stage: state.stage,
    extraLifeAwarded: state.extraLifeAwarded,
    challengeHits: state.challengeHits,

    resonance: state.resonance,
    inversion: state.inversion,

    ship: {
      x: state.ship.x,
      band: state.ship.band,
      lockout: state.ship.lockout,
      cooldown: state.ship.cooldown,
      contact: state.ship.contact,
    },
    discharge: {
      active: state.discharge.active,
      radius: state.discharge.radius,
    },

    drones: state.drones.map(copyDrone),
    bullets: state.bullets.map((bullet) => ({
      id: bullet.id,
      x: bullet.x,
      y: bullet.y,
      vx: bullet.vx,
      vy: bullet.vy,
      band: bullet.band,
      friendly: bullet.friendly,
    })),
    // A burst's particle simulation is a live object the burst owns for its
    // whole life, so it is carried across rather than rebuilt.
    bursts: state.bursts.map((burst) => ({
      id: burst.id,
      x: burst.x,
      y: burst.y,
      size: burst.size,
      elapsed: burst.elapsed,
      sim: burst.sim as ParticleSimulator,
    })),

    waveEntry: state.waveEntry,
    diveLaunching: state.diveLaunching,
    entryClock: state.entryClock,
    swayClock: state.swayClock,
    diveClock: state.diveClock,
    diveTarget: state.diveTarget,

    nextId: state.nextId,
    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,

    // Loaded once and never written, so the sprites themselves are shared.
    art: state.art as Art,
  };
}

/**
 * The id the next drone, bullet or burst takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; a counter that never goes backwards gives that and
 * makes an id stable for as long as its entity exists.
 */
export function takeId(sim: Sim): number {
  const id = sim.nextId;
  sim.nextId = id + 1;
  return id;
}

/** The drone with that id, or `undefined`. */
export function droneById(sim: Sim, id: number): MutDrone | undefined {
  return sim.drones.find((drone) => drone.id === id);
}

/** The bullet with that id, or `undefined`. */
export function bulletById(sim: Sim, id: number): MutBullet | undefined {
  return sim.bullets.find((bullet) => bullet.id === id);
}

/** A whole draw in `[lo, hi]` from the game's own generator. */
export function drawInt(sim: Sim, lo: number, hi: number): number {
  const [value, next] = nextInt(sim.rngState, lo, hi);
  sim.rngState = next;
  return value;
}

/** A draw in `[lo, hi)` from the game's own generator. */
export function drawRange(sim: Sim, lo: number, hi: number): number {
  const [value, next] = nextRange(sim.rngState, lo, hi);
  sim.rngState = next;
  return value;
}

/** A seed for a burst's own scatter, drawn from the game's own generator. */
export function drawSeed(sim: Sim): number {
  const [value, next] = nextSeed(sim.rngState);
  sim.rngState = next;
  return value;
}
