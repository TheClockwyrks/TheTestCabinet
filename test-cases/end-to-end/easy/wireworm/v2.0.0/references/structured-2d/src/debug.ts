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
// The surface holds no state and is inert during normal play: nothing below runs
// until something calls it.

import type { World } from "@clockwyrks/structured-2d";
import { addBoltTo } from "./bolts";
import {
  CHARGE_MAX,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  inBounds,
  wormLength,
  wormStepInterval,
} from "./constants";
import { placeCursor } from "./cursor";
import { addFoeTo } from "./foes";
import { resetState } from "./flow";
import {
  wirewormState,
  type Edge,
  type FoeKind,
  type Phase,
  type Screen,
  type Tile,
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
  /** The level's spawner clocks, in seconds left (specs/foes.md). */
  glitchTimer: number;
  dropperTimer: number;
  corruptorTimer: number;
  /** The posed draws, each `null` until posed and once consumed. */
  nextWormEntry: Edge | null;
  nextGlitchEntry: SnapshotTile | null;
  nextDropperEntry: SnapshotTile | null;
  nextCorruptorEntry: SnapshotTile | null;
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

/** A posed tile as the snapshot reports it: a copy, or `null` for none posed. */
function copyTile(tile: Tile | null): SnapshotTile | null {
  return tile === null ? null : { c: tile.c, r: tile.r };
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose acts on the live game at the call and returns nothing;
 * the one reading, `snapshot`, returns what it read.
 */
export interface WirewormDebugApi {
  version: number;

  reset(): void;
  snapshot(): WirewormSnapshot;

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

  setSpawnTimer(kind: FoeKind, seconds: number): void;
  setNextFoeEntry(kind: FoeKind, c: number, r: number): void;
  setNextWormEntry(edge: Edge): void;

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

/**
 * Build the surface over an accessor for the open world. It holds nothing: every
 * operation reads the world — and the state and the audio bus it carries — at
 * the moment it is called, so the surface follows the live game for the life of
 * the engine.
 */
export function createDebugApi(world: () => World): WirewormDebugApi {
  const read = (): WirewormState => wirewormState(world());

  const worm = (id: number): WormState | undefined =>
    read().worms.find((entry) => entry.id === id);

  const foe = (id: number) => read().foes.find((entry) => entry.id === id);

  /** A charge as the field holds it: a whole number from 0 to CHARGE_MAX. */
  const charge = (value: number): number =>
    Math.min(CHARGE_MAX, Math.max(0, Math.round(value)));

  return {
    version: WIREWORM_DEBUG_VERSION,

    reset() {
      resetState(read());
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
        glitchTimer: state.glitchTimer,
        dropperTimer: state.dropperTimer,
        corruptorTimer: state.corruptorTimer,
        nextWormEntry: state.nextWormEntry,
        nextGlitchEntry: copyTile(state.nextGlitchEntry),
        nextDropperEntry: copyTile(state.nextDropperEntry),
        nextCorruptorEntry: copyTile(state.nextCorruptorEntry),
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

    setScreen(screen) {
      read().screen = screen;
    },

    setPhase(phase) {
      read().phase = phase;
    },

    setPhaseTimer(seconds) {
      read().phaseTimer = seconds;
    },

    setMenuIndex(index) {
      read().menuIndex = index;
    },

    /**
     * The score alone. It grants no bonus life whatever boundary it carries the
     * score across: the award belongs to the scoring path, and this is a
     * precondition.
     */
    setScore(score) {
      read().score = score;
    },

    setLives(lives) {
      read().lives = lives;
    },

    /** The level alone: it spawns nothing and clears nothing. */
    setLevel(level) {
      read().level = Math.min(TOTAL_LEVELS, Math.max(1, Math.round(level)));
    },

    setReachedLevel(level) {
      read().reachedLevel = level;
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

    // The clock then runs exactly as specs/foes.md states, so a clock posed at
    // 0 is drawn afresh on the next update of active play.
    setSpawnTimer(kind, seconds) {
      const state = read();
      const value = Math.max(0, seconds);
      if (kind === "glitch") state.glitchTimer = value;
      else if (kind === "dropper") state.dropperTimer = value;
      else state.corruptorTimer = value;
    },

    // The entry consumes the pose; every entry after it is drawn at random.
    setNextFoeEntry(kind, c, r) {
      const state = read();
      const tile = { c: Math.round(c), r: Math.round(r) };
      if (kind === "glitch") state.nextGlitchEntry = tile;
      else if (kind === "dropper") state.nextDropperEntry = tile;
      else state.nextCorruptorEntry = tile;
    },

    setNextWormEntry(edge) {
      read().nextWormEntry = edge === "left" ? "left" : "right";
    },

    setCursorContact(enabled) {
      read().cursor.contact = enabled;
    },

    /** The cursor's center, with the band's own clamp applied. */
    setCursor(x, y) {
      placeCursor(read(), x, y);
    },

    setCursorInvulnerable(seconds) {
      read().cursor.invulnerable = Math.max(0, seconds);
    },

    setFireCooldown(seconds) {
      read().fireCooldown = Math.max(0, seconds);
    },

    /** One bolt in flight, which then travels and resolves through the real shot code. */
    addBolt(x, y) {
      addBoltTo(read(), x, y);
    },

    removeBolt(id) {
      const state = read();
      state.bolts = state.bolts.filter((bolt) => bolt.id !== id);
    },

    clearBolts() {
      read().bolts = [];
    },

    setNode(c, r, value) {
      if (!inBounds(c, r)) return;
      putNode(read(), c, r, charge(value));
    },

    clearNode(c, r) {
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
      worm(id)?.segments.push({ c, r });
    },

    setWormHeading(id, dh) {
      const entry = worm(id);
      if (entry !== undefined) entry.dh = dh;
    },

    setWormDescent(id, dv) {
      const entry = worm(id);
      if (entry !== undefined) entry.dv = dv;
    },

    setWormDiving(id, diving) {
      const entry = worm(id);
      if (entry !== undefined) entry.diving = diving;
    },

    setWormStepping(id, enabled) {
      const entry = worm(id);
      if (entry !== undefined) entry.stepping = enabled;
    },

    setWormBody(id, enabled) {
      const entry = worm(id);
      if (entry !== undefined) entry.body = enabled;
    },

    removeWorm(id) {
      const state = read();
      state.worms = state.worms.filter((entry) => entry.id !== id);
    },

    clearWorms() {
      read().worms = [];
    },

    /** One foe of `kind`, at its own resting velocity, both faculties on. */
    addFoe(kind, x, y) {
      addFoeTo(read(), kind, x, y);
    },

    setFoeVelocity(id, vx, vy) {
      const entry = foe(id);
      if (entry !== undefined) {
        entry.vx = vx;
        entry.vy = vy;
      }
    },

    setFoeHit(id, hit) {
      const entry = foe(id);
      if (entry !== undefined) entry.hit = hit;
    },

    setFoeMind(id, enabled) {
      const entry = foe(id);
      if (entry !== undefined) entry.mind = enabled;
    },

    setFoeTravel(id, enabled) {
      const entry = foe(id);
      if (entry !== undefined) entry.travel = enabled;
    },

    removeFoe(id) {
      const state = read();
      state.foes = state.foes.filter((entry) => entry.id !== id);
    },

    clearFoes() {
      read().foes = [];
    },
  };
}
