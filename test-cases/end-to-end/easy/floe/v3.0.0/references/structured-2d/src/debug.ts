// Floe — the debugging and automation surface the game instance returns.
//
// `specs/instrumentation.md` specifies it and this file implements it. The game
// instance's `initialize` returns it, the engine holds it and hands it back as
// `engine.debug`, and it is reached that way alone: nothing is installed on the
// page. It is inert during normal play — nothing below runs until something
// calls it.
//
// EVERY OPERATION IS ONE OF TWO THINGS: a pose of one part of the live game, or a
// reading of it. A pose takes only its own arguments, acts on the world open at
// the moment of the call, and returns nothing; a reading returns plain data built
// at the call. A pose ARRANGES THE STRAIT and never fabricates an outcome — it
// puts the game into a situation and the game's own rules, in `src/sim.ts` and
// `src/hunter.ts`, run from there on the next advanced frame. So a scenario
// driven from code behaves exactly like one played by hand.
//
// THERE IS NO CLOCK OPERATION. The clock is the engine's: a caller supplies its
// own and calls `engine.advance`. There is no keyboard operation either — the
// engine owns the keyboard, and a caller drives an action by dispatching a
// keyboard-shaped event at the event target the engine listens on — and no
// overlay operation, because the engine draws the panel and owns the backtick
// key. And there is no `setMuted`: mute is reached through the mute action, and
// `muted` is read back from the snapshot.

import type { World } from "@clockwyrks/structured-2d";
import {
  BAY_COUNT,
  DEFAULT_SEED,
  FISH_INTERVAL,
  FISH_LINGER,
  FLOE_DEBUG_VERSION,
  MAX_BEARS,
  SECOND_BEAR_LEVEL,
  TOTAL_LEVELS,
  tileCX,
  tileCY,
} from "./constants";
import type { Bear } from "./bodies";
import { bearById, critterOf, floesOf, vehiclesOf } from "./bodies";
import {
  claimSlot,
  dropAllBears,
  dropBear,
  placeCenter,
  placeCritter,
  spawnBear,
  syncFish,
} from "./entities";
import { commitStep, settleBear } from "./hunter";
import { addFloe, addVehicle, laneAt, layoutLevel } from "./lanes";
import { menuItemRect, type MenuRect } from "./menus";
import { resetGame } from "./sim";
import { snapshot, type FloeSnapshotShape } from "./snapshot";
import { floeState } from "./game";
import type {
  Facing,
  FloeKind,
  FloeState,
  LaneDir,
  Phase,
  Screen,
  VehicleKind,
} from "./game";

/** The whole surface, exactly as `specs/instrumentation.md` lists it. */
export interface FloeDebugApi {
  version: number;

  // The core.
  reset(options?: { seed?: number }): void;
  snapshot(): FloeSnapshotShape;
  /** Bring every reported reading into agreement with the strait as it stands. */
  reconcile(): void;
  menuItemRect(index: number): MenuRect | null;

  // The screen and the run.
  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setLevel(level: number): void;
  setReachedLevel(level: number): void;
  setTimer(seconds: number): void;

  // The world gates.
  setBearEmergence(enabled: boolean): void;
  setCatchTest(enabled: boolean): void;
  setFishCadence(enabled: boolean): void;
  setTimerRunning(enabled: boolean): void;

  // The critter.
  addCritter(col: number, row: number): void;
  removeCritter(): void;
  setCritterTile(col: number, row: number): void;
  setCritterX(x: number): void;
  setCritterFacing(facing: Facing): void;
  setHopCooldown(seconds: number): void;
  setBestRow(row: number): void;

  // The bears.
  addBear(col: number, row: number): void;
  removeBear(id: number): void;
  clearBears(): void;
  setBearTile(id: number, col: number, row: number): void;
  setBearPosition(id: number, x: number, y: number): void;
  setBearStep(id: number, direction: Facing): void;
  setBearTarget(id: number, col: number, row: number): void;
  setBearSense(id: number, enabled: boolean): void;
  setBearRouting(id: number, enabled: boolean): void;
  setBearTravel(id: number, enabled: boolean): void;

  // The lanes.
  addVehicle(row: number, kind: VehicleKind, x: number): void;
  removeVehicle(id: number): void;
  clearVehicles(): void;
  setVehicleX(id: number, x: number): void;
  addFloe(row: number, kind: FloeKind, x: number): void;
  removeFloe(id: number): void;
  clearFloes(): void;
  setFloeX(id: number, x: number): void;
  setLaneSpeed(row: number, speed: number): void;
  setLaneDirection(row: number, dir: LaneDir): void;

  // The bays and the bonus catch.
  setBay(index: number, filled: boolean): void;
  clearBays(): void;
  setFishBay(index: number): void;
  clearFish(): void;
}

/** A bay index the strait actually has. */
function requireBay(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= BAY_COUNT) {
    throw new RangeError(
      `Floe: bay ${index} — the far shore carries ${BAY_COUNT} bays, 0 to ${BAY_COUNT - 1}`,
    );
  }
  return index;
}

/** A level the run actually has. */
function requireLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS) {
    throw new RangeError(
      `Floe: level ${level} — a run is levels 1 to ${TOTAL_LEVELS}`,
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
function requireDir(dir: number): LaneDir {
  if (dir !== 1 && dir !== -1) {
    throw new RangeError(
      `Floe: setLaneDirection dir ${dir} — a lane runs 1 rightward or -1 leftward`,
    );
  }
  return dir;
}

/**
 * Give the hunt the slots the level has, without touching a bear.
 *
 * A slot already filled is kept exactly as it stands, so raising the level to
 * `SECOND_BEAR_LEVEL` opens a second slot rather than restarting the hunt, and
 * lowering it below closes only a slot that stands empty.
 */
function reshapeSlots(state: FloeState, level: number): void {
  const want = level >= SECOND_BEAR_LEVEL ? MAX_BEARS : 1;
  while (state.slots.length < want) {
    state.slots.push({ bearId: null, emptyFor: 0 });
  }
  while (
    state.slots.length > want &&
    state.slots[state.slots.length - 1].bearId === null
  ) {
    state.slots.pop();
  }
}

/**
 * Build the surface over the live world.
 *
 * `open` is a getter rather than a held world, because `engine.world` follows
 * every transition and an operation reads it at the moment of the call
 * (engine/debug.md).
 */
export function createDebugApi(open: () => World): FloeDebugApi {
  // AN OPERATION NEVER REFUSES IN SILENCE (specs/instrumentation.md, "The
  // operations"). A call naming a subject the strait does not hold has no state
  // to reach, so it throws where it stands rather than returning with the game
  // unchanged and leaving the caller to guess.

  /** The bear that id names, or a loud failure. */
  const requireBear = (op: string, id: number): Bear => {
    const bear = bearById(open(), id);
    if (bear === null) {
      throw new RangeError(
        `Floe: ${op} id ${id} — no bear on the strait carries that id`,
      );
    }
    return bear;
  };

  const withBear = (
    op: string,
    id: number,
    act: (bear: Bear) => void,
  ): void => {
    act(requireBear(op, id));
  };

  /** The lane item that id names on its roster, or a loud failure. */
  const requireItem = <T extends { id: number }>(
    op: string,
    what: string,
    id: number,
    roster: Iterable<T>,
  ): T => {
    for (const item of roster) {
      if (item.id === id) return item;
    }
    throw new RangeError(
      `Floe: ${op} id ${id} — no ${what} on the strait carries that id`,
    );
  };

  /** The lane on strait `row`, or a loud failure: the shores and the median carry none. */
  const requireLane = (op: string, row: number) => {
    const lane = laneAt(floeState(open()), row);
    if (lane === null) {
      throw new RangeError(
        `Floe: ${op} row ${row} — that strait row carries no lane`,
      );
    }
    return lane;
  };

  return {
    version: FLOE_DEBUG_VERSION,

    // ---- The core ----

    reset(options) {
      const world = open();
      resetGame(world, floeState(world), options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      return snapshot(open());
    },

    /**
     * Bring every reported reading into agreement with the strait as it stands.
     *
     * Every derived reading this build reports — `timerMax`, the critter's
     * `col`, `row` and `footing`, and a bear's `swimming` — is worked out at the
     * read in `src/snapshot.ts`, from the level, the critter's transform, the
     * floes and the tile each bear is travelling into. Nothing is held that a
     * pose can leave behind, so there is nothing here to rewrite. The operation
     * is required of every build, including one that keeps those readings as
     * stored copies, and an empty body is what it comes to in a build that does
     * not.
     *
     * It advances nothing and it corrects nothing either way: no clock moves, no
     * lane carries its items, no bear travels, and a critter posed over open
     * water reads as standing on water rather than being moved somewhere it
     * would not drown.
     */
    reconcile() {},

    /**
     * The region item `index` is picked from on the menu the current screen
     * shows, in logical units, or `null` where the screen shows no menu or the
     * index names no entry.
     *
     * A pure read of the layout this build itself draws, so the menus keep the
     * arrangement it chose (specs/instrumentation.md). It is deliberately NOT
     * part of `snapshot`: the regions are geometry rather than run state.
     */
    menuItemRect(index) {
      return menuItemRect(floeState(open()).screen, index);
    },

    // ---- The screen and the run ----

    setScreen(screen) {
      floeState(open()).screen = screen;
    },

    setPhase(phase) {
      floeState(open()).phase = phase;
    },

    setPhaseTimer(seconds) {
      floeState(open()).phaseTimer = seconds;
    },

    setMenuIndex(index) {
      floeState(open()).menuIndex = index;
    },

    /** A precondition. It grants no bonus life: the award belongs to the scoring path. */
    setScore(score) {
      floeState(open()).score = score;
    },

    /** It ends no run: `setLives(0)` leaves the game playing and the next death ends it. */
    setLives(lives) {
      floeState(open()).lives = lives;
    },

    /**
     * Set the level, and lay the strait out for it.
     *
     * A level MEANS its sixteen lanes (specs/ice.md, specs/water.md), so both
     * rosters are replaced by the roster this level gives, each item taking a
     * fresh id. Nothing else moves: not the critter, the bears, the bays, the
     * bonus catch, the screen, the phase, the score, the lives or the timer.
     */
    setLevel(level) {
      const world = open();
      const state = floeState(world);
      state.level = requireLevel(level);
      layoutLevel(world, state, state.level);
      reshapeSlots(state, state.level);
    },

    setReachedLevel(level) {
      floeState(open()).reachedLevel = level;
    },

    /** A precondition. It kills nothing; the next tick of a running timer does. */
    setTimer(seconds) {
      floeState(open()).timer = seconds;
    },

    // ---- The world gates ----

    setBearEmergence(enabled) {
      floeState(open()).bearEmergence = Boolean(enabled);
    },

    setCatchTest(enabled) {
      floeState(open()).catchTest = Boolean(enabled);
    },

    setFishCadence(enabled) {
      floeState(open()).fishCadence = Boolean(enabled);
    },

    setTimerRunning(enabled) {
      floeState(open()).timerRunning = Boolean(enabled);
    },

    // ---- The critter ----

    addCritter(col, row) {
      placeCritter(critterOf(open()), col, row);
    },

    removeCritter() {
      critterOf(open()).present = false;
    },

    setCritterTile(col, row) {
      placeCenter(critterOf(open()), tileCX(col), tileCY(row));
    },

    /** The mid-drift pose: its column follows its center by `colAt(x)`. */
    setCritterX(x) {
      const critter = critterOf(open());
      placeCenter(critter, x, critter.transform.y);
    },

    setCritterFacing(facing) {
      critterOf(open()).facing = facing;
    },

    setHopCooldown(seconds) {
      critterOf(open()).hopCooldown = seconds;
    },

    setBestRow(row) {
      critterOf(open()).bestRow = row;
    },

    // ---- The bears ----

    addBear(col, row) {
      const world = open();
      const state = floeState(world);
      const bear = spawnBear(world, state, col, row);
      // A bear put on the strait fills a hunting slot where one stands empty, so
      // the run's own emerging does not put a second bear behind it.
      claimSlot(state, bear.id);
    },

    removeBear(id) {
      dropBear(floeState(open()), requireBear("removeBear", id));
    },

    clearBears() {
      const world = open();
      dropAllBears(world, floeState(world));
    },

    setBearTile(id, col, row) {
      withBear("setBearTile", id, (bear) => settleBear(bear, col, row));
    },

    /** The mid-glide pose: the two tiles it occupies are left exactly as they stand. */
    setBearPosition(id, x, y) {
      withBear("setBearPosition", id, (bear) => placeCenter(bear, x, y));
    },

    /**
     * Commit a bear to one step from the tile it last settled on, consulting no
     * route. A step into a tile closed to a bear is refused by the game's own
     * rules, exactly as a routed step is.
     */
    setBearStep(id, direction) {
      const world = open();
      withBear("setBearStep", id, (bear) => {
        commitStep(world, bear, direction);
      });
    },

    setBearTarget(id, col, row) {
      withBear("setBearTarget", id, (bear) => {
        bear.target = { col, row };
      });
    },

    setBearSense(id, enabled) {
      withBear("setBearSense", id, (bear) => {
        bear.sense = Boolean(enabled);
      });
    },

    setBearRouting(id, enabled) {
      withBear("setBearRouting", id, (bear) => {
        bear.routing = Boolean(enabled);
      });
    },

    setBearTravel(id, enabled) {
      withBear("setBearTravel", id, (bear) => {
        bear.travel = Boolean(enabled);
      });
    },

    // ---- The lanes ----

    addVehicle(row, kind, x) {
      const world = open();
      addVehicle(world, floeState(world), row, kind, x);
    },

    removeVehicle(id) {
      requireItem("removeVehicle", "vehicle", id, vehiclesOf(open())).destroy();
    },

    clearVehicles() {
      for (const item of vehiclesOf(open())) item.destroy();
    },

    setVehicleX(id, x) {
      const item = requireItem(
        "setVehicleX",
        "vehicle",
        id,
        vehiclesOf(open()),
      );
      item.transform.x = x;
      item.prevX = x;
    },

    addFloe(row, kind, x) {
      const world = open();
      addFloe(world, floeState(world), row, kind, x);
    },

    removeFloe(id) {
      requireItem("removeFloe", "floe", id, floesOf(open())).destroy();
    },

    clearFloes() {
      for (const item of floesOf(open())) item.destroy();
    },

    setFloeX(id, x) {
      const item = requireItem("setFloeX", "floe", id, floesOf(open()));
      item.transform.x = x;
      item.prevX = x;
    },

    /**
     * A speed of `0` holds the lane where it stands; every item keeps its
     * position. The speed is taken as given rather than clamped: the
     * specification fixes the domain at a number at or above `0`, so a call
     * outside it is a caller's mistake and says so.
     */
    setLaneSpeed(row, speed) {
      requireLane("setLaneSpeed", row).speed = requireSpeed(speed);
    },

    /** `1` rightward, `-1` leftward — an enumerated domain, so anything else throws. */
    setLaneDirection(row, dir) {
      requireLane("setLaneDirection", row).dir = requireDir(dir);
    },

    // ---- The bays and the bonus catch ----

    /** It scores nothing and clears no level: a level clears on a hop. */
    setBay(index, filled) {
      floeState(open()).bays[requireBay(index)] = Boolean(filled);
    },

    clearBays() {
      const state = floeState(open());
      state.bays = state.bays.map(() => false);
    },

    /** The linger clock starts at the call. */
    setFishBay(index) {
      const world = open();
      const state = floeState(world);
      state.fishBay = requireBay(index);
      state.lastFishBay = state.fishBay;
      state.fishTimer = FISH_LINGER;
      syncFish(world, state);
    },

    clearFish() {
      const world = open();
      const state = floeState(world);
      state.lastFishBay = state.fishBay ?? state.lastFishBay;
      state.fishBay = null;
      state.fishTimer = FISH_INTERVAL;
      syncFish(world, state);
    },
  };
}
