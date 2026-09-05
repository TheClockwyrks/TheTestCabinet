// Fathom — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call — and takes only the parameters its own heading names. A POSE sets ONE
// thing through the same systems play uses and returns nothing, leaving the rest
// of the game exactly as it stands; a READING returns plain data built at the
// call and changes nothing. Nothing is bypassed: a posed layout is loaded by the
// same code a descent loads one with, a posed predator hunts through its own
// mind, and a posed chase takes its fix through the same acquisition a sense
// takes one through, so a scenario driven from code behaves exactly like one
// played by hand.
//
// An argument outside the domain its operation states, and a subject not in the
// condition the operation states, both fail loudly rather than leaving the game
// in a state no play could reach.
//
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@clockwyrks/structured-2d";
import { noCues } from "./audio";
import {
  BRIGHT_HOLD,
  DEFAULT_SEED,
  DRIFTER_INTERVAL,
  FATHOM_DEBUG_VERSION,
  GLOAMFIN_HEAR,
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
  type PredatorKind,
} from "./constants";
import { Drifter, Predator, buildRoster } from "./creatures";
import type { PredatorState } from "./creatures";
import {
  CLEARED_TIME,
  beginPlay,
  denPredators,
  loadLayout,
  openMenu,
  resetState,
  sonarRange,
  startCountdown,
} from "./flow";
import type { Cell, Dir } from "./grid";
import { cellIndex, inGrid } from "./grid";
import { itemRect, menuItems, type Rect } from "./menu";
import { bodyCell, restAt } from "./movement";
import { acquireFix, lightDetectRange } from "./predators";
import { drifterDrawn, predatorDrawn, refreshLight, trenchFor } from "./sim";
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
  lit: boolean;
  mind: boolean;
  travel: boolean;
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
  mind: boolean;
  travel: boolean;
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
  /** The highlighted item, `null` on the four screens that show no menu. */
  menuIndex: number | null;
  /** The title menu's remembered selection, never `null`. */
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  /** Seconds until the cadence admits the next drifter (`specs/state.md`). */
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: SnapshotGrid;
  tiles: string[];
  plankton: string[];
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
  reset(seed?: number): void;
  snapshot(): FathomSnapshot;
  menuItemRect(index: number): Rect | null;
  setScreen(s: Screen): void;
  setMenuIndex(index: number): void;
  setTitleIndex(index: number): void;
  setScore(points: number): void;
  setLives(n: number): void;
  setDepth(d: number): void;
  setMaze(rows: readonly string[]): void;
  setPlankton(tx: number, ty: number, present: boolean): void;
  clearPlankton(): void;
  clearFog(): void;
  setForagerTile(tx: number, ty: number): void;
  setForagerDir(dir: Dir): void;
  setBrightness(g: number): void;
  setBrightHold(seconds: number): void;
  clearPredators(): void;
  addPredator(kind: PredatorKind, tx: number, ty: number): void;
  setPredatorTile(index: number, tx: number, ty: number): void;
  setPredatorDir(index: number, dir: Dir): void;
  setPredatorState(index: number, value: "den" | "wander" | "chase"): void;
  setPredatorReleased(index: number, released: boolean): void;
  setPredatorMind(index: number, enabled: boolean): void;
  setPredatorTravel(index: number, enabled: boolean): void;
  spawnDrifter(tx: number, ty: number): void;
  clearDrifters(): void;
  setDrifterMind(index: number, enabled: boolean): void;
  setDrifterTravel(index: number, enabled: boolean): void;
  setDrifterIn(seconds: number): void;
  setSonarCooldown(seconds: number): void;
  setInkCooldown(seconds: number): void;
}

const DIR_NAMES: readonly Dir[] = ["up", "down", "left", "right"];

const SCREEN_NAMES: readonly Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "cleared",
  "gameover",
];

const KIND_NAMES: readonly PredatorKind[] = [
  "lanternjaw",
  "gloamfin",
  "flarefish",
];

function requireDir(value: unknown, where: string): Dir {
  if (typeof value !== "string" || !DIR_NAMES.includes(value as Dir)) {
    throw new Error(
      `${where}: expected one of ${DIR_NAMES.join(", ")}, received ${String(value)}`,
    );
  }
  return value as Dir;
}

function requireScreen(value: unknown, where: string): Screen {
  if (typeof value !== "string" || !SCREEN_NAMES.includes(value as Screen)) {
    throw new Error(
      `${where}: expected one of ${SCREEN_NAMES.join(", ")}, received ${String(value)}`,
    );
  }
  return value as Screen;
}

function requireKind(value: unknown, where: string): PredatorKind {
  if (
    typeof value !== "string" ||
    !KIND_NAMES.includes(value as PredatorKind)
  ) {
    throw new Error(
      `${where}: expected one of ${KIND_NAMES.join(", ")}, received ${String(value)}`,
    );
  }
  return value as PredatorKind;
}

function requireSeconds(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `${where}: expected a number of seconds of at least 0, received ${String(value)}`,
    );
  }
  return value;
}

function requireWhole(
  value: unknown,
  least: number,
  where: string,
  most?: number,
): number {
  const outside =
    !Number.isInteger(value) ||
    (value as number) < least ||
    (most !== undefined && (value as number) > most);
  if (outside) {
    const bound =
      most === undefined ? `of at least ${least}` : `from ${least} to ${most}`;
    throw new Error(
      `${where}: expected a whole number ${bound}, received ${String(value)}`,
    );
  }
  return value as number;
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

function requireDrifter(
  state: FathomState,
  index: number,
  where: string,
): Drifter {
  if (!Number.isInteger(index) || index < 0 || index >= state.drifters.length) {
    throw new Error(
      `${where}: no drifter at index ${String(index)}; the maze holds ${state.drifters.length}`,
    );
  }
  return state.drifters[index];
}

/**
 * A roster the surface has rebuilt leaves every pulse a Gloamfin cast pointing
 * at a slot that is no longer the fish that cast it, so the emitter is dropped
 * and the wavefront travels on as the sound it already is.
 */
function forgetEmitters(state: FathomState): void {
  for (const pulse of state.pulses) pulse.emitterIndex = null;
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
    reset(seed = DEFAULT_SEED) {
      resetState(read(), seed);
    },

    /** A pure read. It never changes anything. */
    snapshot() {
      return snapshotOf(read());
    },

    /**
     * Where this build drew item `index` of the menu the current screen shows,
     * in logical units. A pure read: it changes nothing.
     *
     * `null` on the four screens that show no menu, and for an index the current
     * menu does not hold, which is what `specs/instrumentation.md` fixes.
     */
    menuItemRect(index) {
      return itemRect(read().screen, index);
    },

    /**
     * The screen alone. The game carries on under its own rules from there, so
     * each screen's own behavior follows: a countdown counts down, a cleared
     * interstitial runs out into the descent, and live play starts the release
     * schedule's clock at the moment it opens.
     */
    setScreen(s) {
      const state = read();
      const screen = requireScreen(s, "setScreen(s)");
      // Whichever screen was showing, its own timer goes with it, so only the
      // timer the new screen runs on is left standing.
      state.countdown = 0;
      state.clearedTimer = 0;
      if (screen === "countdown") {
        startCountdown(state);
        return;
      }
      if (screen === "playing") {
        beginPlay(state);
        return;
      }
      openMenu(state, screen);
      if (screen === "cleared") state.clearedTimer = CLEARED_TIME;
    },

    /**
     * The highlighted item of whichever menu the current screen shows, and no
     * other field: the screen, the maze and every body stay exactly as they
     * stand, and a `confirm` from there takes the item this named.
     */
    setMenuIndex(index) {
      const state = read();
      const items = menuItems(state.screen);
      if (items.length === 0) {
        throw new RangeError(
          `Fathom: setMenuIndex(index) — the ${state.screen} screen shows no menu`,
        );
      }
      state.menuIndex = requireWhole(
        index,
        0,
        "setMenuIndex(index)",
        items.length - 1,
      );
    },

    /**
     * The title menu's remembered selection, and nothing else: the screen and
     * the highlighted item stay as they stand, so the value set here is the one
     * the next arrival at the title selects.
     */
    setTitleIndex(index) {
      read().titleIndex = requireWhole(
        index,
        0,
        "setTitleIndex(index)",
        menuItems("title").length - 1,
      );
    },

    /** The running score, which play carries on from. */
    setScore(points) {
      read().score = requireWhole(points, 0, "setScore(points)");
    },

    /** The lives held in reserve, the one being played not among them. */
    setLives(n) {
      read().lives = requireWhole(n, 0, "setLives(n)");
    },

    /**
     * The depth, and with it what the specification derives from depth: the
     * sonar's range, and the roster laid out in the den unreleased. The maze,
     * the plankton, the fog and the screen are left as they are.
     */
    setDepth(d) {
      const state = read();
      state.depth = requireWhole(d, 1, "setDepth(d)");
      state.predators = buildRoster(state.depth);
      denPredators(state);
      forgetEmitters(state);
    },

    /**
     * A fixture posed over the maze, used exactly as given and exempt from
     * every rule in `specs/maze.md`. The layout is the whole of what it sets:
     * everything else on the board is left exactly as it stands, and the light
     * is recast over the new rock because the pocket is read off the layout.
     */
    setMaze(rows) {
      if (!Array.isArray(rows)) {
        throw new Error("setMaze(rows): expected an array of row strings");
      }
      const state = read();
      loadLayout(state, rows);
      refreshLight(state);
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

    /** Every tile back to unrevealed, which reveals nothing of its own. */
    clearFog() {
      read().fog.reset();
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
     * `G` alone. `V` and the light detection ranges recompute from it, and the
     * hold is left as it stands, so `G` decays from here on the ordinary curve
     * as soon as whatever hold was running expires.
     */
    setBrightness(g) {
      if (typeof g !== "number" || !Number.isFinite(g) || g < 0 || g > 1) {
        throw new Error(
          `setBrightness(g): expected a number in [0, 1], received ${String(g)}`,
        );
      }
      const state = read();
      state.forager.brightness = g;
      refreshLight(state);
    },

    /** The seconds left on the brightness hold, which changes `G` not at all. */
    setBrightHold(seconds) {
      const where = "setBrightHold(seconds)";
      const held = requireSeconds(seconds, where);
      if (held > BRIGHT_HOLD) {
        throw new Error(
          `${where}: expected at most ${BRIGHT_HOLD}, received ${String(seconds)}`,
        );
      }
      read().forager.hold = held;
    },

    /** Every predator off the board at once, leaving the roster empty. */
    clearPredators() {
      const state = read();
      state.predators = [];
      forgetEmitters(state);
    },

    /**
     * One predator added at the end of the roster, loose and patrolling on the
     * tile it is placed on. It carries no release time, because the staggered
     * schedule runs on the roster a maze is laid out with.
     */
    addPredator(kind, tx, ty) {
      const where = "addPredator(kind, tx, ty)";
      const state = read();
      const which = requireKind(kind, where);
      const cell = requireCorridor(state, tx, ty, where);
      const predator = new Predator(which, null);
      restAt(predator, cell);
      predator.facing = "up";
      predator.state = "wander";
      predator.released = true;
      state.predators.push(predator);
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
     * One predator's state, on the tile it already stands on: `"den"` inside
     * the den chamber, `"wander"` and `"chase"` out in the corridors. It moves
     * the predator nowhere and leaves its release flag as it stands. A posed
     * chase takes its fix through the same acquisition a sense takes one
     * through, and fires no alert of its own, because a pose is an arrangement
     * rather than a detection.
     */
    setPredatorState(index, value) {
      const where = "setPredatorState(index, value)";
      const state = read();
      const predator = requirePredator(state, index, where);
      const cell = bodyCell(predator);
      const denned =
        state.maze.isDen(cell.tx, cell.ty) ||
        state.maze.isGate(cell.tx, cell.ty);

      if (value === "den") {
        if (!denned) {
          throw new Error(
            `${where}: predator ${index} stands on (${cell.tx}, ${cell.ty}), which is neither a den tile nor the gate`,
          );
        }
        predator.state = "den";
        predator.dropFix();
        predator.alert = 0;
        return;
      }

      if (value !== "wander" && value !== "chase") {
        throw new Error(
          `${where}: expected one of den, wander, chase, received ${String(value)}`,
        );
      }
      if (!state.maze.isCorridor(cell.tx, cell.ty)) {
        throw new Error(
          `${where}: predator ${index} stands on (${cell.tx}, ${cell.ty}), which is not an open corridor tile`,
        );
      }

      predator.state = "wander";
      predator.dropFix();
      predator.alert = 0;
      if (value === "chase") {
        acquireFix(
          predator,
          trenchFor(state, noCues()),
          bodyCell(state.forager),
        );
        predator.alert = 0;
      }
    },

    /** Whether one predator's turn in the staggered schedule has come. */
    setPredatorReleased(index, released) {
      const where = "setPredatorReleased(index, released)";
      const state = read();
      requirePredator(state, index, where).released = released === true;
    },

    /**
     * One predator's own mind, on or off. With it off the predator senses
     * nothing and decides nothing, so nothing is carried out and it holds
     * exactly where it stands, keeping the facing, the state and the fix it was
     * posed with. It is drawn and makes contact as it always did.
     */
    setPredatorMind(index, enabled) {
      const where = "setPredatorMind(index, enabled)";
      const state = read();
      requirePredator(state, index, where).mind = enabled === true;
    },

    /**
     * One predator's travel, on or off. With it off its body holds the tile it
     * stands on while its mind runs untouched: it senses, takes and lapses a
     * fix, fires its alert, changes its state, and reports the speed that state
     * carries. It is drawn and makes contact as it always did.
     */
    setPredatorTravel(index, enabled) {
      const where = "setPredatorTravel(index, enabled)";
      const state = read();
      requirePredator(state, index, where).travel = enabled === true;
    },

    /** One bonus drifter, which then wanders through the ordinary code. */
    spawnDrifter(tx, ty) {
      const state = read();
      const cell = requireCorridor(state, tx, ty, "spawnDrifter(tx, ty)");
      state.drifters.push(new Drifter(cell));
    },

    /** Every bonus drifter off the maze at once, none of them eaten. */
    clearDrifters() {
      read().drifters = [];
    },

    /** One drifter's own mind, on or off, which decides its wander. */
    setDrifterMind(index, enabled) {
      const where = "setDrifterMind(index, enabled)";
      const state = read();
      requireDrifter(state, index, where).mind = enabled === true;
    },

    /** One drifter's travel, on or off, which carries its wander out. */
    setDrifterTravel(index, enabled) {
      const where = "setDrifterTravel(index, enabled)";
      const state = read();
      requireDrifter(state, index, where).travel = enabled === true;
    },

    /**
     * The seconds left on the bonus-drifter cadence, which runs down from there
     * and admits at `0` exactly as one the game armed itself does. The call
     * admits nothing (`specs/instrumentation.md`).
     */
    setDrifterIn(seconds) {
      const where = "setDrifterIn(seconds)";
      const left = requireSeconds(seconds, where);
      if (left > DRIFTER_INTERVAL) {
        throw new Error(
          `${where}: expected at most ${DRIFTER_INTERVAL}, received ${String(seconds)}`,
        );
      }
      read().drifterTimer = left;
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

/** The plankton layer, as the snapshot's `plankton` reports it. */
function planktonRows(state: FathomState): string[] {
  const rows: string[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    let row = "";
    for (let tx = 0; tx < GRID_COLS; tx++) {
      row += state.plankton[cellIndex(tx, ty)] ? "*" : "-";
    }
    rows.push(row);
  }
  return rows;
}

/** The snapshot `specs/state.md` defines, built at the call. */
export function snapshotOf(state: FathomState): FathomSnapshot {
  const forager = state.forager;
  const here = bodyCell(forager);

  return {
    version: FATHOM_DEBUG_VERSION,
    screen: state.screen,
    menuIndex: menuItems(state.screen).length > 0 ? state.menuIndex : null,
    titleIndex: state.titleIndex,
    depth: state.depth,
    score: state.score,
    lives: state.lives,
    muted: state.muted,
    planktonRemaining: state.planktonRemaining,
    drifterIn: state.drifterTimer,
    brightness: forager.brightness,
    brightHold: forager.hold,
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
    plankton: planktonRows(state),
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
      return {
        x: drifter.x,
        y: drifter.y,
        tx: cell.tx,
        ty: cell.ty,
        lit: drifterDrawn(state, drifter),
        mind: drifter.mind,
        travel: drifter.travel,
      };
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
        mind: predator.mind,
        travel: predator.travel,
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
