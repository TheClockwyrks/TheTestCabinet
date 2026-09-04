// Floe — the snapshot, as `specs/instrumentation.md` fixes its shape.
//
// A PURE READ. Nothing here writes to the world, and every value is a plain
// number, string, boolean or array, so the whole thing crosses out of the build
// as JSON and a caller holds no framework object. Every field a pose can set is
// present, which is what makes every operation of the surface verifiable by
// setting it and reading it back.
//
// Four of the fields are DERIVED rather than stored: `timerMax` from the level,
// the critter's tile from its center, its footing from its row and the floes on
// it, and a bear's `swimming` from the tile it is travelling into. `muted` is a
// LIVE READ of the engine's own mute bit at the call, because under this engine
// the surface holds the live world.

import type { World } from "@test-cabinet/structured-2d";
import { FLOE_DEBUG_VERSION, crossingTimer } from "./constants";
import { bearsOf, critterOf, floesOf, vehiclesOf } from "./bodies";
import { critterCol, critterFooting, critterRow } from "./entities";
import { bearSwimming } from "./hunter";
import { floeState } from "./game";
import type {
  Facing,
  FloeKind,
  Footing,
  LaneDir,
  Phase,
  Screen,
  VehicleKind,
} from "./game";

/** The critter, as the snapshot reports it. */
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

/** One bear, as the snapshot reports it. */
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

/** One lane's motion, as the snapshot reports it. */
export interface LaneSnapshot {
  row: number;
  dir: LaneDir;
  speed: number;
}

/** One vehicle, as the snapshot reports it. */
export interface VehicleSnapshot {
  id: number;
  row: number;
  kind: VehicleKind;
  x: number;
  len: number;
}

/** One floe, as the snapshot reports it. */
export interface FloeSnapshot {
  id: number;
  row: number;
  kind: FloeKind;
  x: number;
  len: number;
}

/** The whole read. */
export interface FloeSnapshotShape {
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
  floes: FloeSnapshot[];
  simTime: number;
}

/** Read the whole game. It changes nothing. */
export function snapshot(world: World): FloeSnapshotShape {
  const state = floeState(world);
  const critter = critterOf(world);
  return {
    version: FLOE_DEBUG_VERSION,
    screen: state.screen,
    phase: state.phase,
    phaseTimer: state.phaseTimer,
    menuIndex: state.menuIndex,
    level: state.level,
    reachedLevel: state.reachedLevel,
    lives: state.lives,
    score: state.score,
    timer: state.timer,
    timerMax: crossingTimer(state.level),
    muted: world.audio.muted(),
    bearEmergence: state.bearEmergence,
    catchTest: state.catchTest,
    fishCadence: state.fishCadence,
    timerRunning: state.timerRunning,
    bays: [...state.bays],
    fishBay: state.fishBay,
    critter: {
      present: critter.present,
      col: critterCol(critter),
      row: critterRow(critter),
      x: critter.transform.x,
      y: critter.transform.y,
      facing: critter.facing,
      footing: critterFooting(world, critter),
      hopCooldown: critter.hopCooldown,
      bestRow: critter.bestRow,
    },
    bears: bearsOf(world).map((bear) => ({
      id: bear.id,
      col: bear.col,
      row: bear.row,
      stepCol: bear.stepCol,
      stepRow: bear.stepRow,
      x: bear.transform.x,
      y: bear.transform.y,
      facing: bear.facing,
      swimming: bearSwimming(world, bear),
      target: { col: bear.target.col, row: bear.target.row },
      sense: bear.sense,
      routing: bear.routing,
      travel: bear.travel,
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
    vehicles: vehiclesOf(world).map((item) => ({
      id: item.id,
      row: item.row,
      kind: item.kind as VehicleKind,
      x: item.transform.x,
      len: item.len,
    })),
    floes: floesOf(world).map((item) => ({
      id: item.id,
      row: item.row,
      kind: item.kind as FloeKind,
      x: item.transform.x,
      len: item.len,
    })),
    simTime: state.simTime,
  };
}
