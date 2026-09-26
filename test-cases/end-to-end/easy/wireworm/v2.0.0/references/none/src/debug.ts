// Wireworm — the debugging and automation surface, `window.__wireworm`.
//
// `specs/instrumentation.md` specifies it and this file implements it. It is
// installed by `src/main.ts` as soon as the game has initialized, and it is
// inert during normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS A READ, A POSE OF ONE FIELD, OR A MOVE OF THE CLOCK. That
// is the whole design. A pose ARRANGES THE WORLD and never fabricates an
// outcome: it puts the game into a situation, and the game's own update — the
// real step, the real block test, the real charge, the real discharge, the real
// scoring — is what runs from there on the next frame. So a scenario driven from
// code behaves exactly like one played by hand, and every pose is verifiable by
// setting a value and reading it back off `snapshot`.
//
// EVERY OPERATION ACTS, AND NONE OF THEM DECLINES QUIETLY. A pose reaches the
// value it names whatever the game's own rules would have allowed a player to
// reach, so nothing below clamps a posed value onto a legal neighbour or leaves
// the state as it was and calls that an answer. Where the game has no defined
// state to reach — a tile off the board, a charge outside the scale, a heading
// that is neither direction, a name outside its set, an id no live entity
// carries — the call THROWS, so the caller sees it rather than reading back a
// board it never posed (specs/instrumentation.md).
//
// THE TWO CLOCK OPERATIONS REACH PAST THE STATE, into the runtime, because this
// build stands on no engine and nothing outside it owns its clock. Without them
// a scenario could only be driven by waiting, and a check that waits measures the
// machine it ran on.
//
// WHAT IS DELIBERATELY ABSENT. There is no `keyDown`, `keyUp` or `press`: the
// runtime's registered actions are driven by dispatching real key events at the
// page, which is the same path a player's keyboard takes. There is no overlay
// toggle: the runtime draws the panel and owns the backtick key. And there is no
// `setMuted`: mute is the runtime's own bit, reached the way a player reaches it
// through `KeyM`, and the snapshot reports the result.

import {
  CHARGE_MAX,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  inBounds,
  wormLength,
  wormStepInterval,
} from "./constants";
import { clearNodes, listNodes, removeNode, setCharge } from "./field";
import { makeFoe } from "./foes";
import { resetState } from "./game";
import { itemRect, menuFor, type MenuRect } from "./menus";
import { poseScore } from "./scoring";
import type {
  Edge,
  Foe,
  FoeKind,
  Phase,
  Screen,
  Tile,
  WirewormState,
  Worm,
} from "./types";

/** The `window` property the surface is installed on. */
export const WIREWORM_HANDLE = "__wireworm";

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
}

/** One node, as the snapshot reports it. */
export interface NodeSnapshot {
  c: number;
  r: number;
  charge: number;
}

/** One worm, as the snapshot reports it. */
export interface WormSnapshot {
  id: number;
  segments: { c: number; r: number }[];
  dh: number;
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
}

/** One foe, as the snapshot reports it. */
export interface FoeSnapshot {
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

/** One bolt, as the snapshot reports it. */
export interface BoltSnapshot {
  id: number;
  x: number;
  y: number;
}

/** One conducted link, as the snapshot reports it: the tiles, not the drawing. */
export interface ArcSnapshot {
  from: { c: number; r: number };
  to: { c: number; r: number };
}

/** The plain, JSON-serializable view `snapshot()` returns. */
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
  glitchTimer: number;
  dropperTimer: number;
  corruptorTimer: number;
  nextWormEntry: Edge | null;
  nextGlitchEntry: Tile | null;
  nextDropperEntry: Tile | null;
  nextCorruptorEntry: Tile | null;
  wormStepInterval: number;
  wormLength: number;
  cursor: { x: number; y: number; invulnerable: number; contact: boolean };
  fireCooldown: number;
  nodes: NodeSnapshot[];
  worms: WormSnapshot[];
  foes: FoeSnapshot[];
  bolts: BoltSnapshot[];
  arcs: ArcSnapshot[];
  simTime: number;
}

/** Every operation the surface carries. */
export interface WirewormDebugApi {
  version: number;

  // The clock.
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  // The core.
  reset(): void;
  snapshot(): WirewormSnapshot;
  reconcile(): void;

  // The screen and the run.
  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setLevel(level: number): void;
  setReachedLevel(level: number): void;
  menuItemRect(index: number): MenuRect | null;

  // The world gates.
  setFoeSpawning(enabled: boolean): void;
  setWormEntry(enabled: boolean): void;
  setCursorContact(enabled: boolean): void;

  // The level's draws.
  setSpawnTimer(kind: FoeKind, seconds: number): void;
  setNextFoeEntry(kind: FoeKind, c: number, r: number): void;
  setNextWormEntry(edge: Edge): void;

  // The cursor and its bolts.
  setCursor(x: number, y: number): void;
  setCursorInvulnerable(seconds: number): void;
  setFireCooldown(seconds: number): void;
  addBolt(x: number, y: number): void;
  removeBolt(id: number): void;
  clearBolts(): void;

  // The node field.
  setNode(c: number, r: number, charge: number): void;
  clearNode(c: number, r: number): void;
  clearNodes(): void;

  // The worms.
  addWorm(c: number, r: number): void;
  appendSegment(id: number, c: number, r: number): void;
  setWormHeading(id: number, dh: number): void;
  setWormDescent(id: number, dv: number): void;
  setWormDiving(id: number, diving: boolean): void;
  setWormStepping(id: number, enabled: boolean): void;
  setWormBody(id: number, enabled: boolean): void;
  removeWorm(id: number): void;
  clearWorms(): void;

  // The foes.
  addFoe(kind: FoeKind, x: number, y: number): void;
  setFoeVelocity(id: number, vx: number, vy: number): void;
  setFoeHit(id: number, hit: boolean): void;
  setFoeMind(id: number, enabled: boolean): void;
  setFoeTravel(id: number, enabled: boolean): void;
  removeFoe(id: number): void;
  clearFoes(): void;
}

/** A posed tile as the snapshot reports it: a copy, or `null` for none posed. */
function copyTile(tile: Tile | null): Tile | null {
  return tile === null ? null : { c: tile.c, r: tile.r };
}

/** A pure read of the whole state, exactly as `specs/instrumentation.md` shapes it. */
export function snapshotOf(state: WirewormState): WirewormSnapshot {
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
    muted: state.muted,
    foeSpawning: state.foeSpawning,
    wormEntry: state.wormEntry,
    glitchTimer: state.glitchTimer,
    dropperTimer: state.dropperTimer,
    corruptorTimer: state.corruptorTimer,
    nextWormEntry: state.nextWormEntry,
    nextGlitchEntry: copyTile(state.nextGlitchEntry),
    nextDropperEntry: copyTile(state.nextDropperEntry),
    nextCorruptorEntry: copyTile(state.nextCorruptorEntry),
    // Derived from the level rather than stored, as `specs/worm.md` states.
    wormStepInterval: wormStepInterval(state.level),
    wormLength: wormLength(state.level),
    cursor: {
      x: state.cursor.x,
      y: state.cursor.y,
      invulnerable: state.cursor.invulnerable,
      contact: state.cursor.contact,
    },
    fireCooldown: state.fireCooldown,
    nodes: listNodes(state.field),
    worms: state.worms.map((worm) => ({
      id: worm.id,
      segments: worm.segments.map((segment) => ({
        c: segment.c,
        r: segment.r,
      })),
      dh: worm.dh,
      dv: worm.dv,
      diving: worm.diving,
      stepping: worm.stepping,
      body: worm.body,
    })),
    foes: state.foes.map((foe) => ({
      id: foe.id,
      kind: foe.kind,
      x: foe.x,
      y: foe.y,
      vx: foe.vx,
      vy: foe.vy,
      hit: foe.hit,
      mind: foe.mind,
      travel: foe.travel,
    })),
    bolts: state.bolts.map((bolt) => ({ id: bolt.id, x: bolt.x, y: bolt.y })),
    // The tiles each link joined, with the drawn lightning and its remaining
    // life left out: an arc is a fact about the chain, not about the picture.
    arcs: state.arcs.map((arc) => ({
      from: { c: arc.from.c, r: arc.from.r },
      to: { c: arc.to.c, r: arc.to.r },
    })),
    simTime: state.simTime,
  };
}

/* -------------------------------------------------------------------------- */
/* The loud half of the contract                                              */
/* -------------------------------------------------------------------------- */
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

/** The edges `setNextWormEntry` names. */
const EDGES: readonly Edge[] = ["left", "right"];

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

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: WirewormState,
  clock: DebugClock,
): WirewormDebugApi {
  const worm = (op: string, id: number): Worm => {
    const found = state.worms.find((candidate) => candidate.id === id);
    if (found === undefined) reject(op, `no worm carries id ${String(id)}`);
    return found;
  };
  const foe = (op: string, id: number): Foe => {
    const found = state.foes.find((candidate) => candidate.id === id);
    if (found === undefined) reject(op, `no foe carries id ${String(id)}`);
    return found;
  };

  return {
    version: WIREWORM_DEBUG_VERSION,

    /**
     * Take the game off real time, and give it back.
     *
     * Drawing is unaffected either way: the loop keeps rendering, so the canvas
     * shows the state the most recent frame left. It changes no game state.
     */
    setAutoStep(enabled) {
      clock.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order.
     *
     * Each is a real frame — the same update the loop runs, then a render — so
     * the game's own rules produce the result. Every rate is integrated against
     * the frame's delta and the worm's step clock carries its remainder, so
     * `advance(1, 1)` and `advance(1, 60)` cover the same second and reach the
     * same outcome.
     *
     * Advancing while the game is still stepping itself ADDS to what the wall
     * clock is already doing, so call `setAutoStep(false)` first.
     */
    advance(seconds, frames = 1) {
      clock.advance(seconds, frames);
    },

    /**
     * Restore every declared field to its title-screen value.
     *
     * It does not touch the clock, and it leaves `muted` exactly as it stands.
     */
    reset() {
      resetState(state);
    },

    snapshot() {
      return snapshotOf(state);
    },

    /**
     * Bring every reported reading into agreement with the world as it stands.
     *
     * Every derived reading this build reports — `wormStepInterval` and
     * `wormLength` from the level, `arcs` from the live discharge, a foe's `vx`
     * and `vy` from its own motion — is worked out at the read in `snapshotOf`,
     * so nothing is held that a pose can leave behind and there is nothing here
     * to rewrite. The operation is required of every build, including one that
     * keeps those readings as stored copies, and this is what it comes to in a
     * build that does not.
     *
     * It advances nothing and fires nothing either way: no clock moves, no
     * system runs, and a caller may make the call as often as it likes.
     */
    reconcile() {},

    setScreen(screen) {
      state.screen = requireOneOf("setScreen", "screen", screen, SCREENS);
    },

    setPhase(phase) {
      state.phase = requireOneOf("setPhase", "phase", phase, PHASES);
    },

    setPhaseTimer(seconds) {
      state.phaseTimer = requireNumber("setPhaseTimer", "seconds", seconds);
    },

    setMenuIndex(index) {
      state.menuIndex = requireNumber("setMenuIndex", "index", index);
    },

    /**
     * Set the score directly.
     *
     * It grants no bonus life, whatever boundary it carries the score across:
     * the award belongs to the scoring path, and this is a precondition. The
     * next milestone moves past the posed figure, so the next real award still
     * lands at the next multiple.
     */
    setScore(score) {
      poseScore(state, requireNumber("setScore", "score", score));
    },

    setLives(lives) {
      state.lives = requireNumber("setLives", "lives", lives);
    },

    /**
     * Set the level being played.
     *
     * It spawns nothing and clears nothing; the step interval and the worm
     * length the snapshot reports follow it, because both are derived.
     *
     * `1` through `TOTAL_LEVELS` is a range the specs fix as a constant, so it
     * is a domain rather than a rule: a level outside it names no level of this
     * game and the call fails loudly instead of landing on the nearest one.
     */
    setLevel(level) {
      state.level = requireWhole("setLevel", "level", level, 1, TOTAL_LEVELS);
    },

    setReachedLevel(level) {
      state.reachedLevel = requireNumber("setReachedLevel", "level", level);
    },

    /**
     * Where the build put item `index` of the menu the current screen shows
     * (specs/instrumentation.md).
     *
     * A pure read of the same layout `src/render.ts` draws from, so a pointer
     * selects exactly what the player sees. `null` on `playing` and `howto`,
     * which show no menu, and for an index the current menu has no item at.
     */
    menuItemRect(index) {
      const menu = menuFor(state.screen);
      return menu === null ? null : itemRect(menu, index);
    },

    setFoeSpawning(enabled) {
      state.foeSpawning = Boolean(enabled);
    },

    setWormEntry(enabled) {
      state.wormEntry = Boolean(enabled);
    },

    setCursorContact(enabled) {
      state.cursor.contact = Boolean(enabled);
    },

    /**
     * Set the seconds left on the level's clock for one foe kind.
     *
     * The clock then runs exactly as `specs/foes.md` states, so a clock posed at
     * `0` is drawn afresh on the next update of active play.
     */
    setSpawnTimer(kind, seconds) {
      requireOneOf("setSpawnTimer", "kind", kind, FOE_KINDS);
      const value = requireNumber("setSpawnTimer", "seconds", seconds);
      if (kind === "glitch") state.glitchTimer = value;
      else if (kind === "dropper") state.dropperTimer = value;
      else state.corruptorTimer = value;
    },

    /**
     * Pose the tile the next foe of `kind` the level brings in enters on. The
     * entry consumes the pose; every entry after it is drawn at random again.
     *
     * The board's tiles are fixed by the specs, so a tile off the board names
     * no entry and fails loudly rather than being rounded onto one.
     */
    setNextFoeEntry(kind, c, r) {
      requireOneOf("setNextFoeEntry", "kind", kind, FOE_KINDS);
      requireTile("setNextFoeEntry", c, r);
      const tile = { c, r };
      if (kind === "glitch") state.nextGlitchEntry = tile;
      else if (kind === "dropper") state.nextDropperEntry = tile;
      else state.nextCorruptorEntry = tile;
    },

    /** Pose the edge the next worm the level or the respawn brings in enters at. */
    setNextWormEntry(edge) {
      state.nextWormEntry = requireOneOf(
        "setNextWormEntry",
        "edge",
        edge,
        EDGES,
      );
    },

    /**
     * Place the cursor's center, exactly where the call names.
     *
     * The band is the cursor's own fixed bound rather than a live figure, so it
     * is this operation's domain: a position outside it fails loudly. What it
     * does NOT do is land the cursor on the nearest edge and let the caller read
     * a position it never posed — the clamp belongs to `moveCursor`, which is
     * what a held movement runs through.
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
      state.cursor.x = x;
      state.cursor.y = y;
    },

    setCursorInvulnerable(seconds) {
      state.cursor.invulnerable = requireNumber(
        "setCursorInvulnerable",
        "seconds",
        seconds,
      );
    },

    setFireCooldown(seconds) {
      state.fireCooldown = requireNumber("setFireCooldown", "seconds", seconds);
    },

    /**
     * Put one bolt in flight, its center at a stage position, travelling up.
     *
     * It then climbs and resolves its hit through the game's own shot rules.
     */
    addBolt(x, y) {
      requireNumber("addBolt", "x", x);
      requireNumber("addBolt", "y", y);
      state.bolts.push({ id: state.nextId, x, y });
      state.nextId += 1;
    },

    removeBolt(id) {
      const at = state.bolts.findIndex((bolt) => bolt.id === id);
      if (at < 0) reject("removeBolt", `no bolt carries id ${String(id)}`);
      state.bolts.splice(at, 1);
    },

    clearBolts() {
      state.bolts = [];
    },

    /**
     * Set the node on a tile, creating it where the tile was empty.
     *
     * The board's tiles and the charge scale are both fixed by the specs, so
     * both are domains: a tile off the board and a charge outside `0` to
     * `CHARGE_MAX` each fail loudly rather than being dropped or squeezed into
     * range.
     */
    setNode(c, r, charge) {
      requireTile("setNode", c, r);
      setCharge(
        state.field,
        c,
        r,
        requireWhole("setNode", "charge", charge, 0, CHARGE_MAX),
      );
    },

    clearNode(c, r) {
      requireTile("clearNode", c, r);
      removeNode(state.field, c, r);
    },

    clearNodes() {
      clearNodes(state.field);
    },

    /**
     * Add a worm of one segment, heading right and descending, with both
     * faculties on. Further segments are appended one at a time.
     */
    addWorm(c, r) {
      state.worms.push({
        id: state.nextId,
        segments: [{ c, r }],
        dh: 1,
        dv: 1,
        diving: false,
        stepping: true,
        body: true,
        stepClock: 0,
      });
      state.nextId += 1;
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
      worm("setWormDiving", id).diving = Boolean(diving);
    },

    setWormStepping(id, enabled) {
      worm("setWormStepping", id).stepping = Boolean(enabled);
    },

    setWormBody(id, enabled) {
      worm("setWormBody", id).body = Boolean(enabled);
    },

    removeWorm(id) {
      const at = state.worms.findIndex((candidate) => candidate.id === id);
      if (at < 0) reject("removeWorm", `no worm carries id ${String(id)}`);
      state.worms.splice(at, 1);
    },

    clearWorms() {
      state.worms = [];
    },

    /**
     * Add one foe with its center at a stage position, at its kind's own resting
     * velocity, with its hit flag down and both faculties on.
     */
    addFoe(kind, x, y) {
      requireOneOf("addFoe", "kind", kind, FOE_KINDS);
      requireNumber("addFoe", "x", x);
      requireNumber("addFoe", "y", y);
      state.foes.push(makeFoe(state, kind, x, y));
    },

    setFoeVelocity(id, vx, vy) {
      const target = foe("setFoeVelocity", id);
      target.vx = requireNumber("setFoeVelocity", "vx", vx);
      target.vy = requireNumber("setFoeVelocity", "vy", vy);
    },

    /**
     * Set the dropper's taken-its-first-bolt flag, and nothing else.
     *
     * The speed-up is what a BOLT does; posing the flag poses the flag, so a
     * velocity a scenario set beforehand is not quietly overwritten.
     */
    setFoeHit(id, hit) {
      foe("setFoeHit", id).hit = Boolean(hit);
    },

    setFoeMind(id, enabled) {
      foe("setFoeMind", id).mind = Boolean(enabled);
    },

    setFoeTravel(id, enabled) {
      foe("setFoeTravel", id).travel = Boolean(enabled);
    },

    removeFoe(id) {
      const at = state.foes.findIndex((candidate) => candidate.id === id);
      if (at < 0) reject("removeFoe", `no foe carries id ${String(id)}`);
      state.foes.splice(at, 1);
    },

    clearFoes() {
      state.foes = [];
    },
  };
}

/**
 * Install the surface on `window.__wireworm` and return the function that
 * removes it again, while the installed object is still the one this call
 * published.
 */
export function installDebugApi(
  state: WirewormState,
  clock: DebugClock,
): () => void {
  const api = createDebugApi(state, clock);
  const target = window as unknown as Record<string, unknown>;
  target[WIREWORM_HANDLE] = api;
  return () => {
    if (target[WIREWORM_HANDLE] === api) delete target[WIREWORM_HANDLE];
  };
}
