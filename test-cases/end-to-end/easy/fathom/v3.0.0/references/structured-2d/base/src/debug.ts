// Fathom — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call — and takes only the parameters its own heading names. A POSE arranges
// the running game through the same systems play uses and returns nothing; a
// READING returns plain data built at the call and changes nothing. Nothing is
// bypassed: a posed maze is laid out by the same code a descent lays one out
// with, a posed brightness arms the same hold eating arms, and a posed chase
// takes its fix through the same acquisition a sense takes one through, so a
// scenario driven from code behaves exactly like one played by hand.
//
// An argument outside the domain its operation states fails loudly rather than
// leaving the game in a state no play could reach.
//
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@test-cabinet/structured-2d";
import { noCues } from "./audio";
import {
  DEFAULT_SEED,
  FATHOM_DEBUG_VERSION,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
  type PredatorKind,
} from "./constants";
import {
  Drifter,
  buildRoster,
  denSlots,
  type Predator,
  type PredatorState,
} from "./creatures";
import {
  beginDive,
  beginPlay as beginPlayNow,
  denPredators,
  poseMaze,
  resetState,
  sonarRange,
} from "./flow";
import type { Cell, Dir } from "./grid";
import { cellIndex, inGrid } from "./grid";
import { bodyCell, restAt } from "./movement";
import { acquireFix, lightDetectRange } from "./predators";
import { predatorDrawn, refreshLight, trenchFor } from "./sim";
import type { PulseSource, PulseTint } from "./sonar";
import { fathomState, type FathomState, type Screen } from "./game";

// ---- The snapshot shape (specs/state.md) ---------------------------------

export interface SnapshotGrid {
  cols: number;
  rows: number;
  tile: number;
  originX: number;
  originY: number;
}

export interface SnapshotForager {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  moving: boolean;
}

export interface SnapshotDrifter {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export interface SnapshotPredator {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  state: PredatorState;
  released: boolean;
  speed: number;
  alert: boolean;
  lit: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
}

export interface SnapshotPulse {
  source: PulseSource;
  tint: PulseTint;
  ox: number;
  oy: number;
  front: number;
  range: number;
}

export interface SnapshotInk {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

export interface FathomSnapshot {
  version: number;
  screen: Screen;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  creatureAI: boolean;
  planktonRemaining: number;
  brightness: number;
  visionRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: SnapshotGrid;
  tiles: string[];
  visibility: string[];
  forager: SnapshotForager;
  drifters: SnapshotDrifter[];
  predators: SnapshotPredator[];
  pulses: SnapshotPulse[];
  inkClouds: SnapshotInk[];
  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose acts on the live world at the call and returns
 * nothing; the one reading, `snapshot`, returns what it read.
 */
export interface FathomDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): FathomSnapshot;
  startDive(): void;
  beginPlay(): void;
  setDepth(d: number): void;
  setMaze(rows: readonly string[]): void;
  setForagerTile(tx: number, ty: number): void;
  setForagerDir(dir: Dir): void;
  setBrightness(g: number): void;
  setPredatorTile(index: number, tx: number, ty: number): void;
  setPredatorDir(index: number, dir: Dir): void;
  setPredatorState(index: number, value: "den" | "wander" | "chase"): void;
  spawnDrifter(tx: number, ty: number): void;
  setCreatureAI(enabled: boolean): void;
  setPlankton(tx: number, ty: number, present: boolean): void;
  clearPlankton(): void;
  setSonarCooldown(seconds: number): void;
  setInkCooldown(seconds: number): void;
}

const DIR_NAMES: readonly Dir[] = ["up", "down", "left", "right"];

function requireDir(value: unknown, where: string): Dir {
  if (typeof value !== "string" || !DIR_NAMES.includes(value as Dir)) {
    throw new Error(
      `${where}: expected one of ${DIR_NAMES.join(", ")}, received ${String(value)}`,
    );
  }
  return value as Dir;
}

function requireSeconds(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${where}: expected a number of seconds of at least 0, received ${String(value)}`,
    );
  }
  return value;
}

function requireCell(tx: number, ty: number, where: string): Cell {
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || !inGrid(tx, ty)) {
    throw new Error(`${where}: (${String(tx)}, ${String(ty)}) is off the grid`);
  }
  return { tx, ty };
}

/** A tile the forager, a drifter and a plankton may all stand on. */
function requireCorridor(
  state: FathomState,
  tx: number,
  ty: number,
  where: string,
): Cell {
  const cell = requireCell(tx, ty, where);
  if (!state.maze.isCorridor(cell.tx, cell.ty)) {
    throw new Error(`${where}: (${tx}, ${ty}) is not an open corridor tile`);
  }
  return cell;
}

function requirePredator(
  state: FathomState,
  index: number,
  where: string,
): Predator {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= state.predators.length
  ) {
    throw new Error(
      `${where}: no predator at index ${String(index)}; the roster holds ${state.predators.length}`,
    );
  }
  return state.predators[index];
}

/**
 * Build the surface over an accessor for the open world. It holds nothing:
 * every operation reads the world — and the state it carries — at the moment it
 * is called, so the surface follows the live game for the life of the engine.
 */
export function createDebugApi(world: () => World): FathomDebugApi {
  const read = (): FathomState => fathomState(world());

  return {
    version: FATHOM_DEBUG_VERSION,

    /**
     * Every declared field back at its title-screen value, with the generator
     * seeded. `muted` is deliberately untouched: muting is a player preference
     * the runtime owns, and a reset is not a reason to start making noise.
     */
    reset(options) {
      resetState(read(), options?.seed ?? DEFAULT_SEED);
    },

    /** A pure read. It never changes anything. */
    snapshot() {
      return snapshotOf(read());
    },

    /** The opening of a real dive, exactly as choosing `DIVE` does. */
    startDive() {
      beginDive(read());
    },

    /** The countdown ended now, on the countdown screen alone. */
    beginPlay() {
      const state = read();
      if (state.screen !== "countdown") return;
      beginPlayNow(state);
    },

    /**
     * The depth everything depth scales recomputes from. The roster is the one
     * that depth holds, back in the den on the ordinary schedule, and the maze
     * and the screen are left as they are.
     */
    setDepth(d) {
      if (!Number.isInteger(d) || d < 1) {
        throw new Error(
          `setDepth(d): expected a whole number of at least 1, received ${String(d)}`,
        );
      }
      const state = read();
      state.depth = d;
      state.predators = buildRoster(d);
      denPredators(state, false);
      state.pulses = [];
    },

    /**
     * A fixture posed over the maze, used exactly as given and exempt from
     * every rule in `specs/maze.md`. The board is left as a freshly laid-out
     * maze starts, the release schedule is suspended while it stands, and what
     * the game is doing is left alone.
     */
    setMaze(rows) {
      if (!Array.isArray(rows)) {
        throw new Error("setMaze(rows): expected an array of row strings");
      }
      poseMaze(read(), rows);
    },

    /** The forager at rest on the center of an open corridor tile. */
    setForagerTile(tx, ty) {
      const state = read();
      const cell = requireCorridor(state, tx, ty, "setForagerTile(tx, ty)");
      restAt(state.forager, cell);
      state.desired = null;
      state.heldDirs = [];
      refreshLight(state);
    },

    /** The forager's facing, which moves it nowhere. */
    setForagerDir(dir) {
      const state = read();
      state.forager.facing = requireDir(dir, "setForagerDir(dir)");
      state.forager.heading = null;
      state.desired = null;
      state.heldDirs = [];
    },

    /**
     * `G` posed outright, arming the brightness hold in full exactly as eating
     * does, so the value is steady for that whole second. `V` and the light
     * detection ranges recompute from it.
     */
    setBrightness(g) {
      if (typeof g !== "number" || !Number.isFinite(g) || g < 0 || g > 1) {
        throw new Error(
          `setBrightness(g): expected a number in [0, 1], received ${String(g)}`,
        );
      }
      const state = read();
      state.forager.shine(g);
      refreshLight(state);
    },

    /** One predator moved to the center of a tile it may stand on. */
    setPredatorTile(index, tx, ty) {
      const where = "setPredatorTile(index, tx, ty)";
      const state = read();
      const predator = requirePredator(state, index, where);
      const cell = requireCell(tx, ty, where);
      if (!state.maze.openToPredator(cell.tx, cell.ty)) {
        throw new Error(
          `${where}: (${tx}, ${ty}) is neither corridor, den nor gate`,
        );
      }
      const heading = predator.heading;
      restAt(predator, cell);
      predator.heading = heading;
    },

    /** One predator's facing. */
    setPredatorDir(index, dir) {
      const where = "setPredatorDir(index, dir)";
      const state = read();
      requirePredator(state, index, where).facing = requireDir(dir, where);
    },

    /**
     * One predator's state. `"den"` returns it to a den tile with its release
     * time suspended; `"wander"` and `"chase"` leave it loose on the tile it
     * stands on with its turn behind it. A chase takes its fix through the same
     * acquisition a sense takes one through, and fires no alert of its own,
     * because a pose is an arrangement rather than a detection.
     */
    setPredatorState(index, value) {
      const where = "setPredatorState(index, value)";
      const state = read();
      const predator = requirePredator(state, index, where);
      if (value === "den") {
        const slots = denSlots(state.maze);
        predator.returnToDen(slots[index % slots.length], true);
        return;
      }
      if (value === "wander") {
        predator.dropFix();
        predator.state = "wander";
        predator.released = true;
        predator.heldInDen = false;
        predator.alert = 0;
        return;
      }
      if (value === "chase") {
        predator.state = "wander";
        predator.released = true;
        predator.heldInDen = false;
        acquireFix(
          predator,
          trenchFor(state, noCues()),
          bodyCell(state.forager),
        );
        predator.alert = 0;
        return;
      }
      throw new Error(
        `${where}: expected one of den, wander, chase, received ${String(value)}`,
      );
    },

    /** One bonus drifter, which then wanders through the ordinary code. */
    spawnDrifter(tx, ty) {
      const state = read();
      const cell = requireCorridor(state, tx, ty, "spawnDrifter(tx, ty)");
      state.drifters.push(new Drifter(cell));
    },

    /** The creatures' own minds, on or off. */
    setCreatureAI(enabled) {
      read().creatureAI = enabled === true;
    },

    /** A plankton put on a tile or taken off it, which is not eating it. */
    setPlankton(tx, ty, present) {
      const state = read();
      const cell = requireCorridor(
        state,
        tx,
        ty,
        "setPlankton(tx, ty, present)",
      );
      const key = cellIndex(cell.tx, cell.ty);
      const has = state.plankton[key] === true;
      const wanted = present === true;
      if (has === wanted) return;
      state.plankton[key] = wanted;
      state.planktonRemaining += wanted ? 1 : -1;
    },

    /** Every plankton off the maze at once, which clears no maze. */
    clearPlankton() {
      const state = read();
      state.plankton.fill(false);
      state.planktonRemaining = 0;
    },

    /** The seconds left on the sonar pulse's cooldown. */
    setSonarCooldown(seconds) {
      read().sonarCooldown = requireSeconds(
        seconds,
        "setSonarCooldown(seconds)",
      );
    },

    /** The seconds left on ink's cooldown. */
    setInkCooldown(seconds) {
      read().inkCooldown = requireSeconds(seconds, "setInkCooldown(seconds)");
    },
  };
}

/** The snapshot `specs/state.md` defines, built at the call. */
export function snapshotOf(state: FathomState): FathomSnapshot {
  const forager = state.forager;
  const here = bodyCell(forager);

  return {
    version: FATHOM_DEBUG_VERSION,
    screen: state.screen,
    depth: state.depth,
    score: state.score,
    lives: state.lives,
    muted: state.muted,
    creatureAI: state.creatureAI,
    planktonRemaining: state.planktonRemaining,
    brightness: forager.brightness,
    visionRadius: forager.visionRadius,
    sonar: {
      ready: state.sonarCooldown <= 0,
      cooldown: state.sonarCooldown,
      range: sonarRange(state.depth),
    },
    ink: { ready: state.inkCooldown <= 0, cooldown: state.inkCooldown },
    grid: {
      cols: GRID_COLS,
      rows: GRID_ROWS,
      tile: TILE,
      originX: GRID_ORIGIN_X,
      originY: GRID_ORIGIN_Y,
    },
    tiles: state.maze.toRows(),
    visibility: state.fog.toRows(),
    forager: {
      x: forager.x,
      y: forager.y,
      tx: here.tx,
      ty: here.ty,
      dir: forager.facing,
      moving: forager.heading !== null,
    },
    drifters: state.drifters.map((drifter) => {
      const cell = bodyCell(drifter);
      return { x: drifter.x, y: drifter.y, tx: cell.tx, ty: cell.ty };
    }),
    predators: state.predators.map((predator) => {
      const cell = bodyCell(predator);
      const light =
        predator.kind === "lanternjaw" || predator.kind === "flarefish";
      const gloamfin = predator.kind === "gloamfin";
      const flarefish = predator.kind === "flarefish";
      return {
        kind: predator.kind,
        x: predator.x,
        y: predator.y,
        tx: cell.tx,
        ty: cell.ty,
        dir: predator.facing,
        state: predator.state,
        released: predator.released,
        speed: predator.speed,
        alert: predator.alert > 0,
        lit: predatorDrawn(state, predator),
        detectRange: light ? lightDetectRange(forager.brightness) : null,
        hearingRange: gloamfin ? GLOAMFIN_HEAR : null,
        hearingLock: gloamfin ? predator.hearingLock : null,
        flareCharging: flarefish ? predator.flareCharging : null,
        flaring: flarefish ? predator.flaring : null,
        flareRadius: flarefish ? predator.flareRadius : null,
      };
    }),
    pulses: state.pulses.map((pulse) => ({
      source: pulse.source,
      tint: pulse.tint,
      ox: pulse.origin.tx,
      oy: pulse.origin.ty,
      front: pulse.front,
      range: pulse.range,
    })),
    inkClouds: state.inkClouds.map((cloud) => ({
      x: cloud.x,
      y: cloud.y,
      radius: cloud.radius,
      remaining: cloud.remaining,
    })),
    simTime: state.simTime,
  };
}
