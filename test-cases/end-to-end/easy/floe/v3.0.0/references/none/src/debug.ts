// Floe — the debugging and automation surface, `window.__floe`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is inert
// during normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS ONE OF THREE THINGS: a read of the state, a pose of one
// field of it, or a move of the clock. A pose ARRANGES THE STRAIT and never
// fabricates an outcome — it puts the game into a situation and the game's own
// rules, in `src/game.ts` and `src/hunter.ts`, run from there on the next tick.
// So a scenario driven from code behaves exactly like one played by hand.
//
// THE TWO CLOCK OPERATIONS ARE THE EXCEPTION, deliberately. `setAutoStep` and
// `advance` reach past the state into the runtime, because this build stands on
// no engine and nothing outside it owns its clock. They pose no game state, so
// there is no snapshot field for them; the items that decide them read their
// effect instead. Everything else about driving a browser game stays absent:
// there is no `keyDown`, `keyUp` or `press` — the runtime's keys are driven by
// dispatching real key events at the page — and no overlay operation, because the
// runtime draws the panel and owns the backtick key. There is no `setMuted`
// either: mute is reached through the mute action, and `muted` is read back from
// the snapshot.

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
  type FloeKind,
  type LaneDir,
  type VehicleKind,
} from "./constants";
import {
  bearById,
  dropAllBears,
  dropBear,
  makeBear,
  makeCritter,
  placeCenter,
} from "./entities";
import { commitStep, settleBear } from "./hunter";
import { addItem, layoutLevel } from "./lanes";
import { resetState } from "./game";
import { snapshot, type FloeSnapshotShape } from "./snapshot";
import type { Facing, FloeState, Phase, Screen } from "./types";

/** The `window` property the surface is installed on. */
export const FLOE_HANDLE = "__floe";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `ticks` whole simulation ticks, each exactly `TICK_DT`. */
  advance(ticks: number): void;
}

/** The whole surface, exactly as `specs/instrumentation.md` lists it. */
export interface FloeDebugApi {
  version: number;

  // The clock.
  setAutoStep(enabled: boolean): void;
  advance(ticks: number): void;

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

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: FloeState,
  clock: DebugClock,
): FloeDebugApi {
  const withBear = (
    id: number,
    act: (bear: NonNullable<ReturnType<typeof bearById>>) => void,
  ): void => {
    const bear = bearById(state, id);
    if (bear !== null) act(bear);
  };

  return {
    version: FLOE_DEBUG_VERSION,

    // ---- The clock ----

    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    advance(ticks) {
      clock.advance(ticks);
    },

    // ---- The core ----

    reset(options) {
      resetState(state, options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      return snapshot(state);
    },

    // ---- The screen and the run ----

    setScreen(screen) {
      state.screen = screen;
    },

    setPhase(phase) {
      state.phase = phase;
    },

    setPhaseTimer(seconds) {
      state.phaseTimer = seconds;
    },

    setMenuIndex(index) {
      state.menuIndex = index;
    },

    /** A precondition. It grants no bonus life: the award belongs to the scoring path. */
    setScore(score) {
      state.score = score;
    },

    /** It ends no run: `setLives(0)` leaves the game playing and the next death ends it. */
    setLives(lives) {
      state.lives = lives;
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
      state.level = requireLevel(level);
      layoutLevel(state, state.level);
      reshapeSlots(state, state.level);
    },

    setReachedLevel(level) {
      state.reachedLevel = level;
    },

    /** A precondition. It kills nothing; the next tick of a running timer does. */
    setTimer(seconds) {
      state.timer = seconds;
    },

    // ---- The world gates ----

    setBearEmergence(enabled) {
      state.bearEmergence = Boolean(enabled);
    },

    setCatchTest(enabled) {
      state.catchTest = Boolean(enabled);
    },

    setFishCadence(enabled) {
      state.fishCadence = Boolean(enabled);
    },

    setTimerRunning(enabled) {
      state.timerRunning = Boolean(enabled);
    },

    // ---- The critter ----

    addCritter(col, row) {
      state.critter = makeCritter(col, row);
    },

    removeCritter() {
      state.critter.present = false;
    },

    setCritterTile(col, row) {
      placeCenter(state.critter, tileCX(col), tileCY(row));
    },

    /** The mid-drift pose: its column follows its center by `colAt(x)`. */
    setCritterX(x) {
      placeCenter(state.critter, x, state.critter.y);
    },

    setCritterFacing(facing) {
      state.critter.facing = facing;
    },

    setHopCooldown(seconds) {
      state.critter.hopCooldown = seconds;
    },

    setBestRow(row) {
      state.critter.bestRow = row;
    },

    // ---- The bears ----

    addBear(col, row) {
      state.bears.push(makeBear(state, col, row));
    },

    removeBear(id) {
      dropBear(state, id);
    },

    clearBears() {
      dropAllBears(state);
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
      withBear(id, (bear) => {
        commitStep(state, bear, direction);
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
      addItem(state, state.vehicles, row, kind, x);
    },

    removeVehicle(id) {
      state.vehicles = state.vehicles.filter((item) => item.id !== id);
    },

    clearVehicles() {
      state.vehicles = [];
    },

    setVehicleX(id, x) {
      const item = state.vehicles.find((vehicle) => vehicle.id === id);
      if (item === undefined) return;
      item.x = x;
      item.prevX = x;
    },

    addFloe(row, kind, x) {
      addItem(state, state.floes, row, kind, x);
    },

    removeFloe(id) {
      state.floes = state.floes.filter((item) => item.id !== id);
    },

    clearFloes() {
      state.floes = [];
    },

    setFloeX(id, x) {
      const item = state.floes.find((floe) => floe.id === id);
      if (item === undefined) return;
      item.x = x;
      item.prevX = x;
    },

    /** A speed of `0` holds the lane where it stands; every item keeps its position. */
    setLaneSpeed(row, speed) {
      const lane =
        state.iceLanes.find((entry) => entry.row === row) ??
        state.waterLanes.find((entry) => entry.row === row);
      if (lane === undefined) return;
      lane.speed = Math.max(0, speed);
    },

    setLaneDirection(row, dir) {
      const lane =
        state.iceLanes.find((entry) => entry.row === row) ??
        state.waterLanes.find((entry) => entry.row === row);
      if (lane === undefined) return;
      lane.dir = dir < 0 ? -1 : 1;
    },

    // ---- The bays and the bonus catch ----

    /** It scores nothing and clears no level: a level clears on a hop. */
    setBay(index, filled) {
      state.bays[requireBay(index)] = Boolean(filled);
    },

    clearBays() {
      state.bays = state.bays.map(() => false);
    },

    /** The linger clock starts at the call. */
    setFishBay(index) {
      state.fishBay = requireBay(index);
      state.lastFishBay = state.fishBay;
      state.fishTimer = FISH_LINGER;
    },

    clearFish() {
      state.lastFishBay = state.fishBay ?? state.lastFishBay;
      state.fishBay = null;
      state.fishTimer = FISH_INTERVAL;
    },
  };
}

/**
 * Install the surface on `window.__floe` and return the function that removes it
 * again, while the installed object is still the one this call published.
 */
export function installDebugApi(
  state: FloeState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[FLOE_HANDLE] = api;
  return () => {
    if (target[FLOE_HANDLE] === api) delete target[FLOE_HANDLE];
  };
}
