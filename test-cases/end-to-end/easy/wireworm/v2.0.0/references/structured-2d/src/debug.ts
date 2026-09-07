// Wireworm — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call — and takes only the parameters its own row names. A POSE arranges the
// running game and returns nothing; a READING returns plain data built at the
// call and changes nothing.
//
// EACH POSE SETS ONE FIELD. There is no operation that takes a layout, a patch
// or a bag of options: a worm is built one segment at a time, a foe is added at
// a position and then steered, and each faculty is its own switch. That is what
// makes every pose verifiable by setting a value and reading it back through
// `snapshot`, and it is why the snapshot reports every field a pose can set.
//
// THE THREE WORLD GATES are the exception worth naming: `setFoeSpawning`,
// `setWormEntry` and `setCursorContact` each hold ONE faculty of the level
// itself, default to on, are restored to on by `reset`, and are reported by
// `snapshot`. They are what let a scenario pose a board holding only what its
// own requirement concerns.
//
// EVERY OPERATION ACTS, AND NONE OF THEM DECLINES QUIETLY. A pose reaches the
// value it names whatever the game's own rules would have allowed a player to
// reach, so nothing below clamps a posed value onto a legal neighbour or returns
// having changed nothing. Where the game has no defined state to reach — a tile
// off the board, a charge outside the scale, a heading that is neither
// direction, a name outside its set, an id no live entity carries — the call
// THROWS, so the caller sees it rather than reading back a board it never posed
// (`specs/instrumentation.md`).
//
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@clockwyrks/structured-2d";
import { addBoltTo } from "./bolts";
import {
  CHARGE_MAX,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  DEFAULT_SEED,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  inBounds,
  wormLength,
  wormStepInterval,
} from "./constants";
import { addFoeTo } from "./foes";
import { resetState } from "./flow";
import {
  wirewormState,
  type FoeKind,
  type Phase,
  type Screen,
  type WirewormState,
  type WormState,
} from "./game";
import { dropNode, putNode } from "./grid";
import { itemRect, menuFor, type MenuRect } from "./menus";
import { addWormTo } from "./worm";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

export interface SnapshotTile {
  c: number;
  r: number;
}

export interface SnapshotNode {
  c: number;
  r: number;
  charge: number;
}

export interface SnapshotWorm {
  id: number;
  segments: SnapshotTile[];
  dh: number;
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
}

export interface SnapshotFoe {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
  mind: boolean;
  travel: boolean;
}

export interface SnapshotBolt {
  id: number;
  x: number;
  y: number;
}

export interface SnapshotArc {
  from: SnapshotTile;
  to: SnapshotTile;
}

export interface SnapshotCursor {
  x: number;
  y: number;
  invulnerable: number;
  contact: boolean;
}

export interface WirewormSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  score: number;
  lives: number;
  level: number;
  reachedLevel: number;
  muted: boolean;
  foeSpawning: boolean;
  wormEntry: boolean;
  /** Derived from `level` by the formulas in specs/worm.md, not stored. */
  wormStepInterval: number;
  wormLength: number;
  cursor: SnapshotCursor;
  fireCooldown: number;
  nodes: SnapshotNode[];
  worms: SnapshotWorm[];
  foes: SnapshotFoe[];
  bolts: SnapshotBolt[];
  arcs: SnapshotArc[];
  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose acts on the live game at the call and returns nothing;
 * the one reading, `snapshot`, returns what it read.
 */
export interface WirewormDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): WirewormSnapshot;
  reconcile(): void;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setLevel(level: number): void;
  setReachedLevel(level: number): void;
  menuItemRect(index: number): MenuRect | null;

  setFoeSpawning(enabled: boolean): void;
  setWormEntry(enabled: boolean): void;
  setCursorContact(enabled: boolean): void;

  setCursor(x: number, y: number): void;
  setCursorInvulnerable(seconds: number): void;
  setFireCooldown(seconds: number): void;
  addBolt(x: number, y: number): void;
  removeBolt(id: number): void;
  clearBolts(): void;

  setNode(c: number, r: number, charge: number): void;
  clearNode(c: number, r: number): void;
  clearNodes(): void;

  addWorm(c: number, r: number): void;
  appendSegment(id: number, c: number, r: number): void;
  setWormHeading(id: number, dh: number): void;
  setWormDescent(id: number, dv: number): void;
  setWormDiving(id: number, diving: boolean): void;
  setWormStepping(id: number, enabled: boolean): void;
  setWormBody(id: number, enabled: boolean): void;
  removeWorm(id: number): void;
  clearWorms(): void;

  addFoe(kind: FoeKind, x: number, y: number): void;
  setFoeVelocity(id: number, vx: number, vy: number): void;
  setFoeHit(id: number, hit: boolean): void;
  setFoeMind(id: number, enabled: boolean): void;
  setFoeTravel(id: number, enabled: boolean): void;
  removeFoe(id: number): void;
  clearFoes(): void;
}

// ---- The loud half of the contract ---------------------------------------
//
// An operation never returns having changed nothing. Where there is a defined
// state the call reaches, it reaches it; where there is not, it throws, and the
// helpers below are how it throws. They are the only guards on this surface:
// nothing here asks which screen is up, where the cursor is standing, or whether
// the game is live before doing what it is named for.

/** The screens `setScreen` names. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
];

/** The sub-phases `setPhase` names. */
const PHASES: readonly Phase[] = ["banner", "active", "respawn"];

/** The foes `addFoe` names. */
const FOE_KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];

/** The failure a call the game has no defined state for gets. */
function reject(op: string, detail: string): never {
  throw new RangeError(`${op}: ${detail}`);
}

/** A finite number, else a loud failure. */
function requireNumber(op: string, name: string, value: number): number {
  if (!Number.isFinite(value)) {
    reject(op, `${name} must be a finite number, got ${String(value)}`);
  }
  return value;
}

/** A whole number inside a range the specs fix as a constant, else a failure. */
function requireWhole(
  op: string,
  name: string,
  value: number,
  lo: number,
  hi: number,
): number {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    reject(
      op,
      `${name} must be a whole number from ${lo} to ${hi}, got ${String(value)}`,
    );
  }
  return value;
}

/** One of a fixed set of names, else a loud failure. */
function requireOneOf<T extends string | number>(
  op: string,
  name: string,
  value: T,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value)) {
    reject(
      op,
      `${name} must be one of ${allowed.join(", ")}, got ${String(value)}`,
    );
  }
  return value;
}

/** A tile of the board, else a loud failure. */
function requireTile(op: string, c: number, r: number): void {
  if (!Number.isInteger(c) || !Number.isInteger(r) || !inBounds(c, r)) {
    reject(op, `(${String(c)}, ${String(r)}) is not a tile of the board`);
  }
}

/**
 * Build the surface over an accessor for the open world. It holds nothing: every
 * operation reads the world — and the state and the audio bus it carries — at
 * the moment it is called, so the surface follows the live game for the life of
 * the engine.
 */
export function createDebugApi(world: () => World): WirewormDebugApi {
  const read = (): WirewormState => wirewormState(world());

  const worm = (op: string, id: number): WormState => {
    const entry = read().worms.find((candidate) => candidate.id === id);
    if (entry === undefined) reject(op, `no worm carries id ${String(id)}`);
    return entry;
  };

  const foe = (op: string, id: number) => {
    const entry = read().foes.find((candidate) => candidate.id === id);
    if (entry === undefined) reject(op, `no foe carries id ${String(id)}`);
    return entry;
  };

  return {
    version: WIREWORM_DEBUG_VERSION,

    reset(options) {
      resetState(read(), options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      const state = read();
      return {
        version: WIREWORM_DEBUG_VERSION,
        screen: state.screen,
        phase: state.phase,
        phaseTimer: state.phaseTimer,
        menuIndex: state.menuIndex,
        score: state.score,
        lives: state.lives,
        level: state.level,
        reachedLevel: state.reachedLevel,
        // The runtime's own mute bit, read at the call.
        muted: world().audio.muted(),
        foeSpawning: state.foeSpawning,
        wormEntry: state.wormEntry,
        wormStepInterval: wormStepInterval(state.level),
        wormLength: wormLength(state.level),
        cursor: {
          x: state.cursor.x,
          y: state.cursor.y,
          invulnerable: state.cursor.invulnerable,
          contact: state.cursor.contact,
        },
        fireCooldown: state.fireCooldown,
        nodes: state.nodes.map((node) => ({
          c: node.c,
          r: node.r,
          charge: node.charge,
        })),
        worms: state.worms.map((entry) => ({
          id: entry.id,
          segments: entry.segments.map((segment) => ({
            c: segment.c,
            r: segment.r,
          })),
          dh: entry.dh,
          dv: entry.dv,
          diving: entry.diving,
          stepping: entry.stepping,
          body: entry.body,
        })),
        foes: state.foes.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          x: entry.x,
          y: entry.y,
          vx: entry.vx,
          vy: entry.vy,
          hit: entry.hit,
          mind: entry.mind,
          travel: entry.travel,
        })),
        bolts: state.bolts.map((bolt) => ({
          id: bolt.id,
          x: bolt.x,
          y: bolt.y,
        })),
        // The links a live discharge is arcing along, each one's remaining life
        // left out.
        arcs: state.arcs.map((arc) => ({
          from: { c: arc.from.c, r: arc.from.r },
          to: { c: arc.to.c, r: arc.to.r },
        })),
        simTime: state.simTime,
      };
    },

    /**
     * Bring every reported reading into agreement with the world as it stands.
     *
     * Every derived reading this build reports — `wormStepInterval` and
     * `wormLength` from the level, `arcs` from the live discharge, `muted` from
     * the engine's own bit, a foe's `vx` and `vy` from its own motion — is
     * worked out at the read in `snapshot`, so nothing is held that a pose can
     * leave behind and there is nothing here to rewrite. The operation is
     * required of every build, including one that keeps those readings as stored
     * copies, and this is what it comes to in a build that does not.
     *
     * It advances nothing and fires nothing either way: no clock moves, no
     * system runs, and a caller may make the call as often as it likes.
     */
    reconcile() {},

    setScreen(screen) {
      read().screen = requireOneOf("setScreen", "screen", screen, SCREENS);
    },

    setPhase(phase) {
      read().phase = requireOneOf("setPhase", "phase", phase, PHASES);
    },

    setPhaseTimer(seconds) {
      read().phaseTimer = requireNumber("setPhaseTimer", "seconds", seconds);
    },

    setMenuIndex(index) {
      read().menuIndex = requireNumber("setMenuIndex", "index", index);
    },

    /**
     * The score alone. It grants no bonus life whatever boundary it carries the
     * score across: the award belongs to the scoring path, and this is a
     * precondition.
     */
    setScore(score) {
      read().score = requireNumber("setScore", "score", score);
    },

    setLives(lives) {
      read().lives = requireNumber("setLives", "lives", lives);
    },

    /**
     * The level alone: it spawns nothing and clears nothing.
     *
     * `1` through `TOTAL_LEVELS` is a range the specs fix as a constant, so it
     * is a domain rather than a rule: a level outside it names no level of this
     * game and the call fails loudly instead of landing on the nearest one.
     */
    setLevel(level) {
      read().level = requireWhole("setLevel", "level", level, 1, TOTAL_LEVELS);
    },

    setReachedLevel(level) {
      read().reachedLevel = requireNumber("setReachedLevel", "level", level);
    },

    /**
     * Where the build put item `index` of the menu the current screen shows
     * (`specs/instrumentation.md`).
     *
     * A pure read of the same layout `src/render.ts` draws from, so a pointer
     * selects exactly what the player sees. `null` on `playing` and `howto`,
     * which show no menu, and for an index the current menu has no item at.
     */
    menuItemRect(index) {
      const menu = menuFor(read().screen);
      return menu === null ? null : itemRect(menu, index);
    },

    setFoeSpawning(enabled) {
      read().foeSpawning = enabled;
    },

    setWormEntry(enabled) {
      read().wormEntry = enabled;
    },

    setCursorContact(enabled) {
      read().cursor.contact = enabled;
    },

    /**
     * The cursor's center, exactly where the call names.
     *
     * The band is the cursor's own fixed bound rather than a live figure, so it
     * is this operation's domain: a position outside it fails loudly. What it
     * does NOT do is land the cursor on the nearest edge and let the caller read
     * a position it never posed — the clamp belongs to the movement path, which
     * is what a held movement runs through.
     */
    setCursor(x, y) {
      requireNumber("setCursor", "x", x);
      requireNumber("setCursor", "y", y);
      if (x < CURSOR_X_MIN || x > CURSOR_X_MAX) {
        reject(
          "setCursor",
          `x must be within the band, ${CURSOR_X_MIN} to ${CURSOR_X_MAX}, got ${String(x)}`,
        );
      }
      if (y < CURSOR_Y_MIN || y > CURSOR_Y_MAX) {
        reject(
          "setCursor",
          `y must be within the band, ${CURSOR_Y_MIN} to ${CURSOR_Y_MAX}, got ${String(y)}`,
        );
      }
      const cursor = read().cursor;
      cursor.x = x;
      cursor.y = y;
    },

    setCursorInvulnerable(seconds) {
      read().cursor.invulnerable = requireNumber(
        "setCursorInvulnerable",
        "seconds",
        seconds,
      );
    },

    setFireCooldown(seconds) {
      read().fireCooldown = requireNumber(
        "setFireCooldown",
        "seconds",
        seconds,
      );
    },

    /** One bolt in flight, which then travels and resolves through the real shot code. */
    addBolt(x, y) {
      requireNumber("addBolt", "x", x);
      requireNumber("addBolt", "y", y);
      addBoltTo(read(), x, y);
    },

    removeBolt(id) {
      const state = read();
      if (!state.bolts.some((bolt) => bolt.id === id)) {
        reject("removeBolt", `no bolt carries id ${String(id)}`);
      }
      state.bolts = state.bolts.filter((bolt) => bolt.id !== id);
    },

    clearBolts() {
      read().bolts = [];
    },

    /**
     * The node on a tile, creating it where the tile was empty.
     *
     * The board's tiles and the charge scale are both fixed by the specs, so
     * both are domains: a tile off the board and a charge outside `0` to
     * `CHARGE_MAX` each fail loudly rather than being dropped or squeezed into
     * range.
     */
    setNode(c, r, value) {
      requireTile("setNode", c, r);
      putNode(
        read(),
        c,
        r,
        requireWhole("setNode", "charge", value, 0, CHARGE_MAX),
      );
    },

    clearNode(c, r) {
      requireTile("clearNode", c, r);
      dropNode(read(), c, r);
    },

    clearNodes() {
      read().nodes = [];
    },

    /** A worm of one segment, heading right and descending, both faculties on. */
    addWorm(c, r) {
      addWormTo(read(), [{ c, r }], 1, 1);
    },

    appendSegment(id, c, r) {
      worm("appendSegment", id).segments.push({ c, r });
    },

    setWormHeading(id, dh) {
      worm("setWormHeading", id).dh = requireOneOf(
        "setWormHeading",
        "dh",
        dh,
        [1, -1],
      );
    },

    setWormDescent(id, dv) {
      worm("setWormDescent", id).dv = requireOneOf(
        "setWormDescent",
        "dv",
        dv,
        [1, -1],
      );
    },

    setWormDiving(id, diving) {
      worm("setWormDiving", id).diving = diving;
    },

    setWormStepping(id, enabled) {
      worm("setWormStepping", id).stepping = enabled;
    },

    setWormBody(id, enabled) {
      worm("setWormBody", id).body = enabled;
    },

    removeWorm(id) {
      const state = read();
      if (!state.worms.some((entry) => entry.id === id)) {
        reject("removeWorm", `no worm carries id ${String(id)}`);
      }
      state.worms = state.worms.filter((entry) => entry.id !== id);
    },

    clearWorms() {
      read().worms = [];
    },

    /** One foe of `kind`, at its own resting velocity, both faculties on. */
    addFoe(kind, x, y) {
      requireOneOf("addFoe", "kind", kind, FOE_KINDS);
      requireNumber("addFoe", "x", x);
      requireNumber("addFoe", "y", y);
      addFoeTo(read(), kind, x, y);
    },

    setFoeVelocity(id, vx, vy) {
      const entry = foe("setFoeVelocity", id);
      entry.vx = requireNumber("setFoeVelocity", "vx", vx);
      entry.vy = requireNumber("setFoeVelocity", "vy", vy);
    },

    setFoeHit(id, hit) {
      foe("setFoeHit", id).hit = hit;
    },

    setFoeMind(id, enabled) {
      foe("setFoeMind", id).mind = enabled;
    },

    setFoeTravel(id, enabled) {
      foe("setFoeTravel", id).travel = enabled;
    },

    removeFoe(id) {
      const state = read();
      if (!state.foes.some((entry) => entry.id === id)) {
        reject("removeFoe", `no foe carries id ${String(id)}`);
      }
      state.foes = state.foes.filter((entry) => entry.id !== id);
    },

    clearFoes() {
      read().foes = [];
    },
  };
}
