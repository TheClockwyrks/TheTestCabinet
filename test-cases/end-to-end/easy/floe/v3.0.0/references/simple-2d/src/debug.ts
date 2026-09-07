// Floe — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// `[state, createDebugApi()]`. The engine holds the second element and hands it back
// from `engine.debug`, and that is the one way a caller reaches it: nothing is
// installed on the page. It reaches nothing global, holds no state, and is inert
// during normal play.
//
// Every operation is written in the shape of `update`, because nothing in this build
// holds a writable state. A POSE takes the current state and returns the next one,
// and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.setLives(s, 1))`. A READING takes the current
// state and returns what it read, as `debug.snapshot(engine.state)`.
//
// EACH POSE SETS ONE FIELD AND TAKES SCALARS. There is no operation that takes a
// layout, none that arranges several things at once, and none that fabricates an
// outcome: a pose puts the game into a situation, and the game's own hopping rules,
// lane motion, routing, catch test and scoring are what run from there when the
// engine advances a frame. `setLevel` is the one pose with a derived consequence,
// and the consequence is the specification's own: a level IS its lane speeds and
// gaps, so setting it lays the two rosters out (`specs/instrumentation.md`).
//
// EVERYTHING ABOUT DRIVING A BROWSER GAME rather than about Floe belongs to the
// engine and is deliberately absent: there is no clock operation (the engine owns
// the clock and runs exact frames), no key operation (the registered actions are
// driven directly), no overlay toggle (the engine draws the panel and owns the
// backtick key), and no `setMuted` (the engine owns the mute bit; the `mute` action
// sets it and the snapshot reports it).

import {
  BAY_COUNT,
  DEFAULT_SEED,
  FISH_INTERVAL,
  FLOE_DEBUG_VERSION,
  ITEM_LEN,
  TOTAL_LEVELS,
  tileCX,
  tileCY,
} from "./constants";
import { placeFish } from "./fish";
import { resetToTitle } from "./flow";
import {
  addBear as addBearAt,
  claimSlot,
  commitStep,
  reconcileSlots,
} from "./hunter";
import { layOutStrait } from "./lanes";
import { menuItemRect, type MenuRect } from "./menus";
import { snapshotOf, type FloeSnapshot } from "./snapshot";
import {
  bearById,
  floeById,
  laneAt,
  takeId,
  toSim,
  vehicleById,
  type MutBear,
  type MutLane,
  type Sim,
} from "./sim";
import type {
  Facing,
  FloeKind,
  FloeState,
  Phase,
  Screen,
  VehicleKind,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

/** One pose over the state, in the engine's own `Transition` shape. */
type Pose = (state: DeepReadonly<FloeState>) => FloeState;

/** The surface `initialize` returns beside the state. */
export interface FloeDebugApi {
  version: number;

  reset(state: DeepReadonly<FloeState>, options?: { seed?: number }): FloeState;
  snapshot(state: DeepReadonly<FloeState>): FloeSnapshot;
  /** Bring every reported reading into agreement with the strait as it stands. */
  reconcile(state: DeepReadonly<FloeState>): FloeState;
  menuItemRect(state: DeepReadonly<FloeState>, index: number): MenuRect | null;

  setScreen(state: DeepReadonly<FloeState>, screen: Screen): FloeState;
  setPhase(state: DeepReadonly<FloeState>, phase: Phase): FloeState;
  setPhaseTimer(state: DeepReadonly<FloeState>, seconds: number): FloeState;
  setMenuIndex(state: DeepReadonly<FloeState>, n: number): FloeState;
  setScore(state: DeepReadonly<FloeState>, n: number): FloeState;
  setLives(state: DeepReadonly<FloeState>, n: number): FloeState;
  setLevel(state: DeepReadonly<FloeState>, n: number): FloeState;
  setReachedLevel(state: DeepReadonly<FloeState>, n: number): FloeState;
  setTimer(state: DeepReadonly<FloeState>, seconds: number): FloeState;

  setBearEmergence(state: DeepReadonly<FloeState>, enabled: boolean): FloeState;
  setCatchTest(state: DeepReadonly<FloeState>, enabled: boolean): FloeState;
  setFishCadence(state: DeepReadonly<FloeState>, enabled: boolean): FloeState;
  setTimerRunning(state: DeepReadonly<FloeState>, enabled: boolean): FloeState;

  addCritter(
    state: DeepReadonly<FloeState>,
    col: number,
    row: number,
  ): FloeState;
  removeCritter(state: DeepReadonly<FloeState>): FloeState;
  setCritterTile(
    state: DeepReadonly<FloeState>,
    col: number,
    row: number,
  ): FloeState;
  setCritterX(state: DeepReadonly<FloeState>, x: number): FloeState;
  setCritterFacing(state: DeepReadonly<FloeState>, dir: Facing): FloeState;
  setHopCooldown(state: DeepReadonly<FloeState>, seconds: number): FloeState;
  setBestRow(state: DeepReadonly<FloeState>, r: number): FloeState;

  addBear(state: DeepReadonly<FloeState>, col: number, row: number): FloeState;
  removeBear(state: DeepReadonly<FloeState>, id: number): FloeState;
  clearBears(state: DeepReadonly<FloeState>): FloeState;
  setBearTile(
    state: DeepReadonly<FloeState>,
    id: number,
    col: number,
    row: number,
  ): FloeState;
  setBearPosition(
    state: DeepReadonly<FloeState>,
    id: number,
    x: number,
    y: number,
  ): FloeState;
  setBearStep(
    state: DeepReadonly<FloeState>,
    id: number,
    direction: Facing,
  ): FloeState;
  setBearTarget(
    state: DeepReadonly<FloeState>,
    id: number,
    col: number,
    row: number,
  ): FloeState;
  setBearSense(
    state: DeepReadonly<FloeState>,
    id: number,
    enabled: boolean,
  ): FloeState;
  setBearRouting(
    state: DeepReadonly<FloeState>,
    id: number,
    enabled: boolean,
  ): FloeState;
  setBearTravel(
    state: DeepReadonly<FloeState>,
    id: number,
    enabled: boolean,
  ): FloeState;

  addVehicle(
    state: DeepReadonly<FloeState>,
    row: number,
    kind: VehicleKind,
    x: number,
  ): FloeState;
  removeVehicle(state: DeepReadonly<FloeState>, id: number): FloeState;
  clearVehicles(state: DeepReadonly<FloeState>): FloeState;
  setVehicleX(state: DeepReadonly<FloeState>, id: number, x: number): FloeState;
  addFloe(
    state: DeepReadonly<FloeState>,
    row: number,
    kind: FloeKind,
    x: number,
  ): FloeState;
  removeFloe(state: DeepReadonly<FloeState>, id: number): FloeState;
  clearFloes(state: DeepReadonly<FloeState>): FloeState;
  setFloeX(state: DeepReadonly<FloeState>, id: number, x: number): FloeState;
  setLaneSpeed(
    state: DeepReadonly<FloeState>,
    row: number,
    speed: number,
  ): FloeState;
  setLaneDirection(
    state: DeepReadonly<FloeState>,
    row: number,
    dir: number,
  ): FloeState;

  setBay(
    state: DeepReadonly<FloeState>,
    index: number,
    filled: boolean,
  ): FloeState;
  clearBays(state: DeepReadonly<FloeState>): FloeState;
  setFishBay(state: DeepReadonly<FloeState>, index: number): FloeState;
  clearFish(state: DeepReadonly<FloeState>): FloeState;
}

/** Write `change` into a copy of the state and hand the copy back. */
function pose(change: (sim: Sim) => void): Pose {
  return (state) => {
    const sim = toSim(state);
    change(sim);
    return sim;
  };
}

// AN OPERATION NEVER REFUSES IN SILENCE (`specs/instrumentation.md`, "The
// operations"). A pose reaches the value it names whatever the game's own rules
// would have allowed, so nothing below is clamped or rounded into range; and a
// call naming a subject the strait does not hold has no state to reach, so it
// throws where it stands rather than returning the state unchanged.

/** Apply `change` to the bear with that id, or fail loudly: no bear, no state. */
function poseBear(
  op: string,
  id: number,
  change: (bear: MutBear, sim: Sim) => void,
): Pose {
  return pose((sim) => {
    const bear = bearById(sim, id);
    if (bear === undefined) {
      throw new RangeError(
        `Floe: ${op} id ${id} — no bear on the strait carries that id`,
      );
    }
    change(bear, sim);
  });
}

/** The lane item that id names on its roster, or a loud failure. */
function requireItem<T>(
  op: string,
  what: string,
  id: number,
  item: T | undefined,
): T {
  if (item === undefined) {
    throw new RangeError(
      `Floe: ${op} id ${id} — no ${what} on the strait carries that id`,
    );
  }
  return item;
}

/** The lane on strait `row`, or a loud failure: the shores and the median carry none. */
function requireLane(
  op: string,
  row: number,
  lane: MutLane | undefined,
): MutLane {
  if (lane === undefined) {
    throw new RangeError(
      `Floe: ${op} row ${row} — that strait row carries no lane`,
    );
  }
  return lane;
}

/** A bay index the far shore actually has: a domain the specification fixes. */
function requireBay(op: string, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= BAY_COUNT) {
    throw new RangeError(
      `Floe: ${op} bay ${index} — the far shore carries ${BAY_COUNT} bays, 0 to ${BAY_COUNT - 1}`,
    );
  }
  return index;
}

/** A level the run actually has: a domain the specification fixes. */
function requireLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS) {
    throw new RangeError(
      `Floe: setLevel level ${level} — a run is levels 1 to ${TOTAL_LEVELS}`,
    );
  }
  return level;
}

/** A lane speed the specification allows: a number at or above `0`. */
function requireSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed < 0) {
    throw new RangeError(
      `Floe: setLaneSpeed speed ${speed} — a lane's speed is a number at or above 0`,
    );
  }
  return speed;
}

/** A lane direction the specification allows: `1` rightward, `-1` leftward. */
function requireDir(dir: number): 1 | -1 {
  if (dir !== 1 && dir !== -1) {
    throw new RangeError(
      `Floe: setLaneDirection dir ${dir} — a lane runs 1 rightward or -1 leftward`,
    );
  }
  return dir;
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(): FloeDebugApi {
  return {
    version: FLOE_DEBUG_VERSION,

    // ---- The core ---------------------------------------------------------

    reset: (state, options) =>
      pose((sim) => {
        resetToTitle(sim, options?.seed ?? DEFAULT_SEED);
      })(state),

    snapshot: (state) => snapshotOf(state, FLOE_DEBUG_VERSION),

    /**
     * Bring every reported reading into agreement with the strait as it stands.
     *
     * Every derived reading this build reports — `timerMax`, the critter's
     * `col`, `row` and `footing`, and a bear's `swimming` — is worked out at the
     * read in `src/snapshot.ts`, from the level, the critter's centre, the floes
     * and the tile each bear is travelling into. Nothing is held that a pose can
     * leave behind, so the next state is the one it was handed. The operation is
     * required of every build, including one that keeps those readings as stored
     * copies, and this is what it comes to in a build that does not.
     *
     * It advances nothing and corrects nothing: no clock moves, no lane carries
     * its items, no bear travels, and a critter posed over open water reads as
     * standing on water rather than being moved somewhere it would not drown.
     */
    reconcile: (state) => pose(() => {})(state),

    /**
     * The region item `index` is picked from on the menu the state's screen
     * shows, in logical units, or `null` where the screen shows no menu or the
     * index names no entry.
     *
     * A reading of the layout this build itself draws, so the menus keep the
     * arrangement it chose (`specs/instrumentation.md`). It is deliberately NOT
     * part of `snapshot`: the regions are geometry rather than run state.
     */
    menuItemRect: (state, index) => menuItemRect(state.screen, index),

    // ---- The screen and the run -------------------------------------------

    setScreen: (state, screen) =>
      pose((sim) => {
        sim.screen = screen;
      })(state),

    setPhase: (state, phase) =>
      pose((sim) => {
        sim.phase = phase;
      })(state),

    setPhaseTimer: (state, seconds) =>
      pose((sim) => {
        sim.phaseTimer = seconds;
      })(state),

    setMenuIndex: (state, n) =>
      pose((sim) => {
        sim.menuIndex = n;
      })(state),

    // A pose is a precondition, so no bonus life is granted here whatever boundary
    // the score is carried across.
    setScore: (state, n) =>
      pose((sim) => {
        sim.score = n;
      })(state),

    // It ends no run: the next death is what does that.
    setLives: (state, n) =>
      pose((sim) => {
        sim.lives = n;
      })(state),

    // A level IS its lane speeds and gaps, so setting it lays the strait out for
    // it. Nothing else on the strait is touched, and it creates no bear.
    setLevel: (state, n) =>
      pose((sim) => {
        sim.level = requireLevel(n);
        layOutStrait(sim);
      })(state),

    setReachedLevel: (state, n) =>
      pose((sim) => {
        sim.reachedLevel = n;
      })(state),

    // It kills nothing: the next tick of a running timer is what costs the life.
    setTimer: (state, seconds) =>
      pose((sim) => {
        sim.timer = seconds;
      })(state),

    // ---- The world gates ---------------------------------------------------

    setBearEmergence: (state, enabled) =>
      pose((sim) => {
        sim.gates.bearEmergence = enabled;
      })(state),

    setCatchTest: (state, enabled) =>
      pose((sim) => {
        sim.gates.catchTest = enabled;
      })(state),

    setFishCadence: (state, enabled) =>
      pose((sim) => {
        sim.gates.fishCadence = enabled;
      })(state),

    setTimerRunning: (state, enabled) =>
      pose((sim) => {
        sim.gates.timerRunning = enabled;
      })(state),

    // ---- The critter -------------------------------------------------------

    addCritter: (state, col, row) =>
      pose((sim) => {
        sim.critter = {
          present: true,
          x: tileCX(col),
          y: tileCY(row),
          facing: "up",
          hopCooldown: 0,
          bestRow: row,
        };
      })(state),

    removeCritter: (state) =>
      pose((sim) => {
        sim.critter.present = false;
      })(state),

    setCritterTile: (state, col, row) =>
      pose((sim) => {
        sim.critter.x = tileCX(col);
        sim.critter.y = tileCY(row);
      })(state),

    // The mid-drift pose: a critter riding a floe is normally between columns.
    setCritterX: (state, x) =>
      pose((sim) => {
        sim.critter.x = x;
      })(state),

    setCritterFacing: (state, dir) =>
      pose((sim) => {
        sim.critter.facing = dir;
      })(state),

    setHopCooldown: (state, seconds) =>
      pose((sim) => {
        sim.critter.hopCooldown = seconds;
      })(state),

    setBestRow: (state, r) =>
      pose((sim) => {
        sim.critter.bestRow = r;
      })(state),

    // ---- The bears ---------------------------------------------------------

    addBear: (state, col, row) =>
      pose((sim) => {
        const bear = addBearAt(sim, col, row);
        // A bear put on the strait fills a hunting slot where one stands empty, so
        // the run's own emergence does not put a second bear behind it.
        claimSlot(sim, bear.id);
      })(state),

    removeBear: (state, id) =>
      pose((sim) => {
        requireItem("removeBear", "bear", id, bearById(sim, id));
        sim.bears = sim.bears.filter((bear) => bear.id !== id);
        reconcileSlots(sim);
      })(state),

    clearBears: (state) =>
      pose((sim) => {
        sim.bears = [];
        reconcileSlots(sim);
      })(state),

    // Settled on the tile: no longer between two. Its target and its three
    // faculties are untouched.
    setBearTile: (state, id, col, row) =>
      poseBear("setBearTile", id, (bear) => {
        bear.col = col;
        bear.row = row;
        bear.stepCol = col;
        bear.stepRow = row;
        bear.x = tileCX(col);
        bear.y = tileCY(row);
        bear.carry = 0;
      })(state),

    // The mid-glide pose: the two tiles it occupies are left exactly as they stand.
    setBearPosition: (state, id, x, y) =>
      poseBear("setBearPosition", id, (bear) => {
        bear.x = x;
        bear.y = y;
      })(state),

    // It consults no route, so a bear can be sent where its routing would not go.
    // A step into a tile closed to a bear is refused by the game's own rules.
    setBearStep: (state, id, direction) =>
      poseBear("setBearStep", id, (bear, sim) => {
        commitStep(sim, bear, direction);
      })(state),

    setBearTarget: (state, id, col, row) =>
      poseBear("setBearTarget", id, (bear) => {
        bear.target = { col, row };
      })(state),

    setBearSense: (state, id, enabled) =>
      poseBear("setBearSense", id, (bear) => {
        bear.sense = enabled;
      })(state),

    setBearRouting: (state, id, enabled) =>
      poseBear("setBearRouting", id, (bear) => {
        bear.routing = enabled;
      })(state),

    setBearTravel: (state, id, enabled) =>
      poseBear("setBearTravel", id, (bear) => {
        bear.travel = enabled;
      })(state),

    // ---- The lanes ---------------------------------------------------------

    addVehicle: (state, row, kind, x) =>
      pose((sim) => {
        sim.vehicles.push({
          id: takeId(sim),
          row,
          kind,
          x,
          len: ITEM_LEN[kind],
        });
      })(state),

    removeVehicle: (state, id) =>
      pose((sim) => {
        requireItem("removeVehicle", "vehicle", id, vehicleById(sim, id));
        sim.vehicles = sim.vehicles.filter((item) => item.id !== id);
      })(state),

    clearVehicles: (state) =>
      pose((sim) => {
        sim.vehicles = [];
      })(state),

    setVehicleX: (state, id, x) =>
      pose((sim) => {
        requireItem("setVehicleX", "vehicle", id, vehicleById(sim, id)).x = x;
      })(state),

    addFloe: (state, row, kind, x) =>
      pose((sim) => {
        sim.floes.push({
          id: takeId(sim),
          row,
          kind,
          x,
          len: ITEM_LEN[kind],
        });
      })(state),

    removeFloe: (state, id) =>
      pose((sim) => {
        requireItem("removeFloe", "floe", id, floeById(sim, id));
        sim.floes = sim.floes.filter((item) => item.id !== id);
      })(state),

    clearFloes: (state) =>
      pose((sim) => {
        sim.floes = [];
      })(state),

    setFloeX: (state, id, x) =>
      pose((sim) => {
        requireItem("setFloeX", "floe", id, floeById(sim, id)).x = x;
      })(state),

    // It repopulates nothing: every item of the lane keeps its exact position.
    setLaneSpeed: (state, row, speed) =>
      pose((sim) => {
        requireLane("setLaneSpeed", row, laneAt(sim, row)).speed =
          requireSpeed(speed);
      })(state),

    // `1` rightward, `-1` leftward — an enumerated domain, so anything else throws.
    setLaneDirection: (state, row, dir) =>
      pose((sim) => {
        requireLane("setLaneDirection", row, laneAt(sim, row)).dir =
          requireDir(dir);
      })(state),

    // ---- The bays and the bonus catch ---------------------------------------

    // It scores nothing and clears no level.
    setBay: (state, index, filled) =>
      pose((sim) => {
        sim.bays[requireBay("setBay", index)] = filled;
      })(state),

    // It scores nothing and clears nothing, and it leaves the catch where it is.
    clearBays: (state) =>
      pose((sim) => {
        sim.bays = sim.bays.map(() => false);
      })(state),

    setFishBay: (state, index) =>
      pose((sim) => {
        placeFish(sim, requireBay("setFishBay", index));
      })(state),

    // The bays are left exactly as they are.
    clearFish: (state) =>
      pose((sim) => {
        sim.fishBay = null;
        sim.fishTimer = FISH_INTERVAL;
      })(state),
  };
}
