// Floe — the plain projection the debug surface reads (`specs/instrumentation.md`).
//
// `snapshot` returns exactly the object that file fixes, and nothing else: plain
// numbers, strings and booleans, so a caller reads it without knowing anything about
// how the state is held. Four of its fields are DERIVED rather than stored, and each
// is derived here from the state it is handed:
//
//   * `timerMax` is `crossingTimer(level)`.
//   * The critter's `col` and `row` follow its centre, through `colAt` and `rowAt`.
//   * `critter.footing` is its row and the floes on it.
//   * A bear's `swimming` is the tile it is travelling into.
//
// It is a pure read: it copies the state into a working value to reach the same
// derivations play uses, and changes nothing.

import { crossingTimer } from "./constants";
import { critterCol, critterRow, footingOf } from "./critter";
import { swimming } from "./hunter";
import { toSim } from "./sim";
import type {
  Facing,
  FloeKind,
  FloeState,
  Footing,
  LaneDir,
  Phase,
  Screen,
  VehicleKind,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

export interface CritterSnapshot {
  present: boolean;
  col: number;
  row: number;
  x: number;
  y: number;
  facing: Facing;
  footing: Footing;
  hopCooldown: number;
  bestRow: number;
}

export interface BearSnapshot {
  id: number;
  col: number;
  row: number;
  stepCol: number;
  stepRow: number;
  x: number;
  y: number;
  facing: Facing;
  swimming: boolean;
  target: { col: number; row: number };
  sense: boolean;
  routing: boolean;
  travel: boolean;
}

export interface LaneSnapshot {
  row: number;
  dir: LaneDir;
  speed: number;
}

export interface VehicleSnapshot {
  id: number;
  row: number;
  kind: VehicleKind;
  x: number;
  len: number;
}

export interface FloeSnapshotItem {
  id: number;
  row: number;
  kind: FloeKind;
  x: number;
  len: number;
}

/** The whole of what `snapshot()` returns (`specs/instrumentation.md`). */
export interface FloeSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  level: number;
  reachedLevel: number;
  lives: number;
  score: number;
  timer: number;
  timerMax: number;
  muted: boolean;
  bearEmergence: boolean;
  catchTest: boolean;
  fishCadence: boolean;
  timerRunning: boolean;
  bays: boolean[];
  fishBay: number | null;
  critter: CritterSnapshot;
  bears: BearSnapshot[];
  iceLanes: LaneSnapshot[];
  waterLanes: LaneSnapshot[];
  vehicles: VehicleSnapshot[];
  floes: FloeSnapshotItem[];
  simTime: number;
}

/** Read the state, exactly as `specs/instrumentation.md` shapes it. */
export function snapshotOf(
  state: DeepReadonly<FloeState>,
  version: number,
): FloeSnapshot {
  const sim = toSim(state);
  return {
    version,
    screen: sim.screen,
    phase: sim.phase,
    phaseTimer: sim.phaseTimer,
    menuIndex: sim.menuIndex,
    level: sim.level,
    reachedLevel: sim.reachedLevel,
    lives: sim.lives,
    score: sim.score,
    timer: sim.timer,
    timerMax: crossingTimer(sim.level),
    muted: sim.muted,
    bearEmergence: sim.gates.bearEmergence,
    catchTest: sim.gates.catchTest,
    fishCadence: sim.gates.fishCadence,
    timerRunning: sim.gates.timerRunning,
    bays: [...sim.bays],
    fishBay: sim.fishBay,
    critter: {
      present: sim.critter.present,
      col: critterCol(sim),
      row: critterRow(sim),
      x: sim.critter.x,
      y: sim.critter.y,
      facing: sim.critter.facing,
      footing: footingOf(sim),
      hopCooldown: sim.critter.hopCooldown,
      bestRow: sim.critter.bestRow,
    },
    bears: sim.bears.map((bear) => ({
      id: bear.id,
      col: bear.col,
      row: bear.row,
      stepCol: bear.stepCol,
      stepRow: bear.stepRow,
      x: bear.x,
      y: bear.y,
      facing: bear.facing,
      swimming: swimming(sim, bear),
      target: { col: bear.target.col, row: bear.target.row },
      sense: bear.sense,
      routing: bear.routing,
      travel: bear.travel,
    })),
    iceLanes: sim.iceLanes.map((lane) => ({
      row: lane.row,
      dir: lane.dir,
      speed: lane.speed,
    })),
    waterLanes: sim.waterLanes.map((lane) => ({
      row: lane.row,
      dir: lane.dir,
      speed: lane.speed,
    })),
    vehicles: sim.vehicles.map((item) => ({
      id: item.id,
      row: item.row,
      kind: item.kind,
      x: item.x,
      len: item.len,
    })),
    floes: sim.floes.map((item) => ({
      id: item.id,
      row: item.row,
      kind: item.kind,
      x: item.x,
      len: item.len,
    })),
    simTime: sim.simTime,
  };
}
