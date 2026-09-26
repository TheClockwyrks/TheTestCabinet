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
  claimSlot,
  dropAllBears,
  dropBear,
  makeBear,
  makeCritter,
  placeCenter,
} from "./entities";
import { commitStep, settleBear } from "./hunter";
import { menuItemRect, type MenuRect } from "./menus";
import { addItem, layoutLane, layoutLevel } from "./lanes";
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
  reset(): void;
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
  setLanePhase(row: number, x: number): void;

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
  // AN OPERATION NEVER REFUSES IN SILENCE (specs/instrumentation.md, "The
  // operations"). A call naming a subject the strait does not hold has no state
  // to reach, so it throws where it stands rather than returning with the game
  // unchanged and leaving the caller to guess.

  /** The bear that id names, or a loud failure. */
  const requireBear = (
    op: string,
    id: number,
  ): NonNullable<ReturnType<typeof bearById>> => {
    const bear = bearById(state, id);
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
    act: (bear: NonNullable<ReturnType<typeof bearById>>) => void,
  ): void => {
    act(requireBear(op, id));
  };

  /** The lane item that id names on its roster, or a loud failure. */
  const requireItem = <T extends { id: number }>(
    op: string,
    roster: readonly T[],
    what: string,
    id: number,
  ): T => {
    const item = roster.find((entry) => entry.id === id);
    if (item === undefined) {
      throw new RangeError(
        `Floe: ${op} id ${id} — no ${what} on the strait carries that id`,
      );
    }
    return item;
  };

  /** The lane on strait `row`, or a loud failure: the shores and the median carry none. */
  const requireLane = (op: string, row: number) => {
    const lane =
      state.iceLanes.find((entry) => entry.row === row) ??
      state.waterLanes.find((entry) => entry.row === row);
    if (lane === undefined) {
      throw new RangeError(
        `Floe: ${op} row ${row} — that strait row carries no lane`,
      );
    }
    return lane;
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

    reset() {
      resetState(state);
    },

    snapshot() {
      return snapshot(state);
    },

    /**
     * Bring every reported reading into agreement with the strait as it stands.
     *
     * Every derived reading this build reports — `timerMax`, the critter's `col`,
     * `row` and `footing`, and a bear's `swimming` — is worked out at the read in
     * `src/snapshot.ts`, from the level, the critter's centre, the floes and the
     * tile each bear is travelling into. Nothing is held that a pose can leave
     * behind, so there is nothing here to rewrite. The operation is required of
     * every build, including one that keeps those readings as stored copies, and
     * an empty body is what it comes to in a build that does not.
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
     * A pure read of the layout the build itself drew, so the menus keep the
     * arrangement this build chose (specs/instrumentation.md). It is deliberately
     * NOT part of `snapshot`: the regions are geometry rather than run state.
     */
    menuItemRect(index) {
      return menuItemRect(state.screen, index);
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
      const bear = makeBear(state, col, row);
      state.bears.push(bear);
      // A bear put on the strait fills a hunting slot where one stands empty, so
      // the run's own emerging does not put a second bear behind it.
      claimSlot(state, bear.id);
    },

    removeBear(id) {
      dropBear(state, requireBear("removeBear", id).id);
    },

    clearBears() {
      dropAllBears(state);
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
      withBear("setBearStep", id, (bear) => {
        commitStep(state, bear, direction);
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
      addItem(state, state.vehicles, row, kind, x);
    },

    removeVehicle(id) {
      requireItem("removeVehicle", state.vehicles, "vehicle", id);
      state.vehicles = state.vehicles.filter((item) => item.id !== id);
    },

    clearVehicles() {
      state.vehicles = [];
    },

    setVehicleX(id, x) {
      const item = requireItem("setVehicleX", state.vehicles, "vehicle", id);
      item.x = x;
      item.prevX = x;
    },

    addFloe(row, kind, x) {
      addItem(state, state.floes, row, kind, x);
    },

    removeFloe(id) {
      requireItem("removeFloe", state.floes, "floe", id);
      state.floes = state.floes.filter((item) => item.id !== id);
    },

    clearFloes() {
      state.floes = [];
    },

    setFloeX(id, x) {
      const item = requireItem("setFloeX", state.floes, "floe", id);
      item.x = x;
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

    /** Relays one lane at a phase; its speed and direction are untouched. */
    setLanePhase(row, x) {
      layoutLane(state, row, x);
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
