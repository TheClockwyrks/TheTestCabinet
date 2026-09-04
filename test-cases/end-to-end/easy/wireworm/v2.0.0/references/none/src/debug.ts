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
  DEFAULT_SEED,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  wormLength,
  wormStepInterval,
} from "./constants";
import { clampCursor } from "./cursor";
import { clearNodes, listNodes, removeNode, setCharge } from "./field";
import { makeFoe } from "./foes";
import { resetState } from "./game";
import { poseScore } from "./scoring";
import type { Foe, FoeKind, Phase, Screen, WirewormState, Worm } from "./types";

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
  reset(options?: { seed?: number }): void;
  snapshot(): WirewormSnapshot;

  // The screen and the run.
  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setLevel(level: number): void;
  setReachedLevel(level: number): void;

  // The world gates.
  setFoeSpawning(enabled: boolean): void;
  setWormEntry(enabled: boolean): void;
  setCursorContact(enabled: boolean): void;

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

/** Build the surface over one live state object and the runtime driving it. */
export function createDebugApi(
  state: WirewormState,
  clock: DebugClock,
): WirewormDebugApi {
  const worm = (id: number): Worm | undefined =>
    state.worms.find((candidate) => candidate.id === id);
  const foe = (id: number): Foe | undefined =>
    state.foes.find((candidate) => candidate.id === id);

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
     * Restore every declared field to its title-screen value and reseed the
     * game's randomness.
     *
     * It does not touch the clock, and it leaves `muted` exactly as it stands.
     */
    reset(options) {
      resetState(state, options?.seed ?? DEFAULT_SEED);
    },

    snapshot() {
      return snapshotOf(state);
    },

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

    /**
     * Set the score directly.
     *
     * It grants no bonus life, whatever boundary it carries the score across:
     * the award belongs to the scoring path, and this is a precondition. The
     * next milestone moves past the posed figure, so the next real award still
     * lands at the next multiple.
     */
    setScore(score) {
      poseScore(state, score);
    },

    setLives(lives) {
      state.lives = lives;
    },

    /**
     * Set the level being played.
     *
     * It spawns nothing and clears nothing; the step interval and the worm
     * length the snapshot reports follow it, because both are derived.
     */
    setLevel(level) {
      state.level = Math.max(1, Math.min(TOTAL_LEVELS, Math.round(level)));
    },

    setReachedLevel(level) {
      state.reachedLevel = level;
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

    /** Place the cursor's center; the band's real clamp still applies. */
    setCursor(x, y) {
      state.cursor.x = x;
      state.cursor.y = y;
      clampCursor(state.cursor);
    },

    setCursorInvulnerable(seconds) {
      state.cursor.invulnerable = Math.max(0, seconds);
    },

    setFireCooldown(seconds) {
      state.fireCooldown = Math.max(0, seconds);
    },

    /**
     * Put one bolt in flight, its center at a stage position, travelling up.
     *
     * It then climbs and resolves its hit through the game's own shot rules.
     */
    addBolt(x, y) {
      state.bolts.push({ id: state.nextId, x, y });
      state.nextId += 1;
    },

    removeBolt(id) {
      const at = state.bolts.findIndex((bolt) => bolt.id === id);
      if (at >= 0) state.bolts.splice(at, 1);
    },

    clearBolts() {
      state.bolts = [];
    },

    /** Set the node on a tile, creating it where the tile was empty. */
    setNode(c, r, charge) {
      setCharge(state.field, c, r, Math.max(0, Math.min(CHARGE_MAX, charge)));
    },

    clearNode(c, r) {
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
      worm(id)?.segments.push({ c, r });
    },

    setWormHeading(id, dh) {
      const target = worm(id);
      if (target !== undefined) target.dh = dh < 0 ? -1 : 1;
    },

    setWormDescent(id, dv) {
      const target = worm(id);
      if (target !== undefined) target.dv = dv < 0 ? -1 : 1;
    },

    setWormDiving(id, diving) {
      const target = worm(id);
      if (target !== undefined) target.diving = Boolean(diving);
    },

    setWormStepping(id, enabled) {
      const target = worm(id);
      if (target !== undefined) target.stepping = Boolean(enabled);
    },

    setWormBody(id, enabled) {
      const target = worm(id);
      if (target !== undefined) target.body = Boolean(enabled);
    },

    removeWorm(id) {
      const at = state.worms.findIndex((candidate) => candidate.id === id);
      if (at >= 0) state.worms.splice(at, 1);
    },

    clearWorms() {
      state.worms = [];
    },

    /**
     * Add one foe with its center at a stage position, at its kind's own resting
     * velocity, with its hit flag down and both faculties on.
     */
    addFoe(kind, x, y) {
      state.foes.push(makeFoe(state, kind, x, y));
    },

    setFoeVelocity(id, vx, vy) {
      const target = foe(id);
      if (target === undefined) return;
      target.vx = vx;
      target.vy = vy;
    },

    /**
     * Set the dropper's taken-its-first-bolt flag, and nothing else.
     *
     * The speed-up is what a BOLT does; posing the flag poses the flag, so a
     * velocity a scenario set beforehand is not quietly overwritten.
     */
    setFoeHit(id, hit) {
      const target = foe(id);
      if (target !== undefined) target.hit = Boolean(hit);
    },

    setFoeMind(id, enabled) {
      const target = foe(id);
      if (target !== undefined) target.mind = Boolean(enabled);
    },

    setFoeTravel(id, enabled) {
      const target = foe(id);
      if (target !== undefined) target.travel = Boolean(enabled);
    },

    removeFoe(id) {
      const at = state.foes.findIndex((candidate) => candidate.id === id);
      if (at >= 0) state.foes.splice(at, 1);
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
