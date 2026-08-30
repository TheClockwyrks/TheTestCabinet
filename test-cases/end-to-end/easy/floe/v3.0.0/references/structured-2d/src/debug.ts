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

import type { World } from "@test-cabinet/structured-2d";
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
  dropAllBears,
  dropBear,
  placeCenter,
  placeCritter,
  spawnBear,
  syncFish,
} from "./entities";
import { commitStep, settleBear } from "./hunter";
import { addFloe, addVehicle, laneAt, layoutLevel } from "./lanes";
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
  const withBear = (id: number, act: (bear: Bear) => void): void => {
    const bear = bearById(open(), id);
    if (bear !== null) act(bear);
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
      spawnBear(world, floeState(world), col, row);
    },

    removeBear(id) {
      const world = open();
      const bear = bearById(world, id);
      if (bear !== null) dropBear(floeState(world), bear);
    },

    clearBears() {
      const world = open();
      dropAllBears(world, floeState(world));
    },

    setBearTile(id, col, row) {
      withBear(id, (bear) => settleBear(bear, col, row));
    },

    /** The mid-glide pose: the two tiles it occupies are left exactly as they stand. */
    setBearPosition(id, x, y) {
      withBear(id, (bear) => placeCenter(bear, x, y));
    },

    /**
     * Commit a bear to one step from the tile it last settled on, consulting no
     * route. A step into a tile closed to a bear is refused by the game's own
     * rules, exactly as a routed step is.
     */
    setBearStep(id, direction) {
      const world = open();
      withBear(id, (bear) => {
        commitStep(world, bear, direction);
      });
    },

    setBearTarget(id, col, row) {
      withBear(id, (bear) => {
        bear.target = { col, row };
      });
    },

    setBearSense(id, enabled) {
      withBear(id, (bear) => {
        bear.sense = Boolean(enabled);
      });
    },

    setBearRouting(id, enabled) {
      withBear(id, (bear) => {
        bear.routing = Boolean(enabled);
      });
    },

    setBearTravel(id, enabled) {
      withBear(id, (bear) => {
        bear.travel = Boolean(enabled);
      });
    },

    // ---- The lanes ----

    addVehicle(row, kind, x) {
      const world = open();
      addVehicle(world, floeState(world), row, kind, x);
    },

    removeVehicle(id) {
      for (const item of vehiclesOf(open())) {
        if (item.id === id) item.destroy();
      }
    },

    clearVehicles() {
      for (const item of vehiclesOf(open())) item.destroy();
    },

    setVehicleX(id, x) {
      for (const item of vehiclesOf(open())) {
        if (item.id !== id) continue;
        item.transform.x = x;
        item.prevX = x;
      }
    },

    addFloe(row, kind, x) {
      const world = open();
      addFloe(world, floeState(world), row, kind, x);
    },

    removeFloe(id) {
      for (const item of floesOf(open())) {
        if (item.id === id) item.destroy();
      }
    },

    clearFloes() {
      for (const item of floesOf(open())) item.destroy();
    },

    setFloeX(id, x) {
      for (const item of floesOf(open())) {
        if (item.id !== id) continue;
        item.transform.x = x;
        item.prevX = x;
      }
    },

    /** A speed of `0` holds the lane where it stands; every item keeps its position. */
    setLaneSpeed(row, speed) {
      const lane = laneAt(floeState(open()), row);
      if (lane === null) return;
      lane.speed = Math.max(0, speed);
    },

    setLaneDirection(row, dir) {
      const lane = laneAt(floeState(open()), row);
      if (lane === null) return;
      lane.dir = dir < 0 ? -1 : 1;
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
