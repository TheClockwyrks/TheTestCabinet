// Spectra — the working value a frame is built in.
//
// The engine holds the state BY VALUE and hands every reader a
// `DeepReadonly<SpectraState>` view, so nothing in this build ever writes to a
// state it was handed. What `update` and every debug pose do instead is COPY the
// state they were given into a `Sim` — a field-for-field mirror of
// `SpectraState` with the `readonly` markers dropped — advance that, and return
// it. TypeScript accepts the result as a `SpectraState` because a mutable field
// is assignable to a readonly one, so the copy costs a type assertion nowhere.
//
// The copy is deep down to the entities: every drone, bullet and burst record is
// rebuilt, so a frame can rewrite one without the state it came from noticing.
// Two things are carried across by reference on purpose. `art` is the seeded
// sprites and the seeded particle system, loaded once and never written. A
// burst's `sim` is its own `ParticleSimulator`, which `specs/state.md` declares
// as the burst's simulation: stepping it IS the burst advancing, and a burst is
// rebuilt as a record around the same simulator.
//
// Writing a frame this way rather than as a chain of spreads is what keeps the
// rules readable as the rules — `drone.bandClock += h` is the sentence
// `specs/drones.md` writes — while the immutability the engine requires is
// enforced at the one boundary where it matters: the state handed in, and the
// state handed back.

import { unit } from "./random";
import type { Art } from "./assets";
import type { CueName } from "./constants";
import type {
  Band,
  DronePhase,
  DroneKind,
  Phase,
  Screen,
  SpectraState,
} from "./game";
import type { ParticleSimulator } from "@clockwyrks/particle-runtime";
import type { DeepReadonly } from "ts-essentials";

/**
 * What a frame produced beside the state it advanced.
 *
 * Cues are gathered rather than played as they happen, so a frame that raises
 * one twice still plays it once, which is what `specs/ui.md` asks for.
 * `dronesRemoved` is what the stage-clear rule reads: `specs/stages.md` makes a
 * clear the MOMENT the last drone of a wave is destroyed, so a live wave holding
 * no drone that has had none removed is being played rather than cleared — a
 * fact about the frame rather than about the field.
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
  stageClearing: boolean;
  entryClock: number;
  swayClock: number;
  diveClock: number;
  diveTarget: number;

  nextId: number;
  simTime: number;
  muted: boolean;

  art: Art;
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

    drones: state.drones.map((drone) => ({
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
    })),
    bullets: state.bullets.map((bullet) => ({
      id: bullet.id,
      x: bullet.x,
      y: bullet.y,
      vx: bullet.vx,
      vy: bullet.vy,
      band: bullet.band,
      friendly: bullet.friendly,
    })),
    bursts: state.bursts.map((burst) => ({
      id: burst.id,
      x: burst.x,
      y: burst.y,
      size: burst.size,
      elapsed: burst.elapsed,
      // The burst's own simulation, carried across rather than rebuilt: it IS
      // the burst (`specs/state.md`), and stepping it is the burst playing.
      sim: burst.sim as ParticleSimulator,
    })),

    waveEntry: state.waveEntry,
    diveLaunching: state.diveLaunching,
    stageClearing: state.stageClearing,
    entryClock: state.entryClock,
    swayClock: state.swayClock,
    diveClock: state.diveClock,
    diveTarget: state.diveTarget,

    nextId: state.nextId,
    simTime: state.simTime,
    muted: state.muted,

    // Loaded once and never written, so the art itself is shared.
    art: state.art as Art,
  };
}

/**
 * The id the next drone, bullet or burst takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; a counter that never goes backwards gives that,
 * and makes an id stable for as long as its entity exists.
 */
export function takeId(sim: Sim): number {
  const id = sim.nextId;
  sim.nextId = id + 1;
  return id;
}

/** One random draw, in `[0, 1)`. */
export function random(): number {
  return unit();
}

/** A draw from `[lo, hi)`. */
export function randomBetween(lo: number, hi: number): number {
  return lo + (hi - lo) * random();
}

/** A whole draw from `[0, count)`. */
export function randomIndex(count: number): number {
  return Math.min(count - 1, Math.floor(random() * count));
}

/** The drone with that id, or `undefined`. */
export function droneById(sim: Sim, id: number): MutDrone | undefined {
  return sim.drones.find((drone) => drone.id === id);
}

/** The bullet with that id, or `undefined`. */
export function bulletById(sim: Sim, id: number): MutBullet | undefined {
  return sim.bullets.find((bullet) => bullet.id === id);
}
