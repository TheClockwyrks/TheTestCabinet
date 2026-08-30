// Floe — the working value one transition is built in.
//
// The engine holds the state BY VALUE and hands every reader a
// `DeepReadonly<FloeState>` view, so nothing in this build writes to a state it
// was handed. What `update` and every debug pose do instead is COPY the state they
// were given into a `Sim` — a field-for-field mirror of `FloeState` with the
// `readonly` markers dropped — advance that, and return it. TypeScript accepts the
// result as a `FloeState` because a mutable field is assignable to a readonly one,
// so the copy costs a type assertion nowhere.
//
// The copy is deep down to the entities: the critter, every bear, every lane
// motion, every vehicle and every floe is rebuilt, so a transition can rewrite one
// without the state it came from noticing. `sprites` is carried across by
// reference, because the art is loaded once and never changes.
//
// Writing a transition this way rather than as a chain of spreads is what keeps
// the rules readable AS the rules — `bear.x += travel` is the sentence
// `specs/hunter.md` writes — while the immutability the engine requires is enforced
// at the one boundary where it matters: the state handed in, and the state handed
// back.

import type { Sprites } from "./assets";
import type {
  Facing,
  FloeKind,
  FloeState,
  LaneDir,
  Phase,
  Screen,
  VehicleKind,
} from "./game";
import type { CueName } from "./constants";
import type { DeepReadonly } from "ts-essentials";

/**
 * What a tick produced beside the state it advanced.
 *
 * Cues are gathered rather than played as they happen, so a tick that raises one
 * twice still plays it once, which is what `specs/ui.md` asks for. The dedup is
 * per TICK: a frame worth several ticks plays each tick's cues in turn.
 */
export interface TickEvents {
  readonly cues: Set<CueName>;
}

/** A fresh record of what one tick produced. */
export function newTickEvents(): TickEvents {
  return { cues: new Set<CueName>() };
}

export interface MutCritter {
  present: boolean;
  x: number;
  y: number;
  facing: Facing;
  hopCooldown: number;
  bestRow: number;
}

export interface MutBear {
  id: number;
  col: number;
  row: number;
  stepCol: number;
  stepRow: number;
  x: number;
  y: number;
  facing: Facing;
  target: { col: number; row: number };
  sense: boolean;
  routing: boolean;
  travel: boolean;
  carry: number;
}

export interface MutLane {
  row: number;
  dir: LaneDir;
  speed: number;
}

export interface MutVehicle {
  id: number;
  row: number;
  kind: VehicleKind;
  x: number;
  len: number;
}

export interface MutFloe {
  id: number;
  row: number;
  kind: FloeKind;
  x: number;
  len: number;
}

export interface MutSlot {
  /** The bear filling the slot, or `null` while it stands empty. */
  bearId: number | null;
  /** The seconds left before an empty slot may fill. */
  fillIn: number;
}

export interface MutLunge {
  x: number;
  y: number;
  facing: Facing;
  timer: number;
}

/** The whole of `FloeState`, writable, for the length of one transition. */
export interface Sim {
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;

  level: number;
  reachedLevel: number;
  lives: number;
  score: number;
  timer: number;

  bays: boolean[];
  fishBay: number | null;

  critter: MutCritter;
  bears: MutBear[];

  iceLanes: MutLane[];
  waterLanes: MutLane[];
  vehicles: MutVehicle[];
  floes: MutFloe[];

  gates: {
    bearEmergence: boolean;
    catchTest: boolean;
    fishCadence: boolean;
    timerRunning: boolean;
  };

  simTime: number;
  muted: boolean;
  rngState: number;

  frameCarry: number;
  animTime: number;
  nextId: number;
  slots: MutSlot[];
  fishTimer: number;
  lastFishBay: number | null;
  request: Facing | null;
  lunge: MutLunge | null;

  sprites: Sprites;
}

/** Copy the state handed in into a value this transition may write. */
export function toSim(state: DeepReadonly<FloeState>): Sim {
  return {
    screen: state.screen,
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    menuIndex: state.menuIndex,

    level: state.level,
    reachedLevel: state.reachedLevel,
    lives: state.lives,
    score: state.score,
    timer: state.timer,

    bays: [...state.bays],
    fishBay: state.fishBay,

    critter: {
      present: state.critter.present,
      x: state.critter.x,
      y: state.critter.y,
      facing: state.critter.facing,
      hopCooldown: state.critter.hopCooldown,
      bestRow: state.critter.bestRow,
    },
    bears: state.bears.map((bear) => ({
      id: bear.id,
      col: bear.col,
      row: bear.row,
      stepCol: bear.stepCol,
      stepRow: bear.stepRow,
      x: bear.x,
      y: bear.y,
      facing: bear.facing,
      target: { col: bear.target.col, row: bear.target.row },
      sense: bear.sense,
      routing: bear.routing,
      travel: bear.travel,
      carry: bear.carry,
    })),

    iceLanes: state.iceLanes.map((lane) => ({
      row: lane.row,
      dir: lane.dir,
      speed: lane.speed,
    })),
    waterLanes: state.waterLanes.map((lane) => ({
      row: lane.row,
      dir: lane.dir,
      speed: lane.speed,
    })),
    vehicles: state.vehicles.map((item) => ({
      id: item.id,
      row: item.row,
      kind: item.kind,
      x: item.x,
      len: item.len,
    })),
    floes: state.floes.map((item) => ({
      id: item.id,
      row: item.row,
      kind: item.kind,
      x: item.x,
      len: item.len,
    })),

    gates: {
      bearEmergence: state.gates.bearEmergence,
      catchTest: state.gates.catchTest,
      fishCadence: state.gates.fishCadence,
      timerRunning: state.gates.timerRunning,
    },

    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,

    frameCarry: state.frameCarry,
    animTime: state.animTime,
    nextId: state.nextId,
    slots: state.slots.map((slot) => ({
      bearId: slot.bearId,
      fillIn: slot.fillIn,
    })),
    fishTimer: state.fishTimer,
    lastFishBay: state.lastFishBay,
    request: state.request,
    lunge:
      state.lunge === null
        ? null
        : {
            x: state.lunge.x,
            y: state.lunge.y,
            facing: state.lunge.facing,
            timer: state.lunge.timer,
          },

    // Loaded once and never written, so the frames themselves are shared.
    sprites: state.sprites as Sprites,
  };
}

/**
 * The id the next bear, vehicle or floe takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; a counter that never goes backwards gives that and
 * makes an id stable for as long as its entity is on the strait.
 */
export function takeId(sim: Sim): number {
  const id = sim.nextId;
  sim.nextId = id + 1;
  return id;
}

/** The bear with that id, or `undefined`. */
export function bearById(sim: Sim, id: number): MutBear | undefined {
  return sim.bears.find((bear) => bear.id === id);
}

/** The vehicle with that id, or `undefined`. */
export function vehicleById(sim: Sim, id: number): MutVehicle | undefined {
  return sim.vehicles.find((item) => item.id === id);
}

/** The floe with that id, or `undefined`. */
export function floeById(sim: Sim, id: number): MutFloe | undefined {
  return sim.floes.find((item) => item.id === id);
}

/** The lane at `row`, whichever band it belongs to, or `undefined`. */
export function laneAt(sim: Sim, row: number): MutLane | undefined {
  return (
    sim.iceLanes.find((lane) => lane.row === row) ??
    sim.waterLanes.find((lane) => lane.row === row)
  );
}
