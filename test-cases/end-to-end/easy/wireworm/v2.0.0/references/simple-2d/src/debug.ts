// Wireworm — the debugging and automation surface (`specs/instrumentation.md`).
//
// `createDebugApi()` builds it and `initialize` returns it beside the state, as
// `[state, createDebugApi()]`. The engine holds the second element and hands it
// back from `engine.debug`, and that is the one way a caller reaches it: nothing
// is installed on the page. It reaches nothing global, holds no state, and is
// inert during normal play.
//
// Every operation is written in the shape of `update`, because nothing in this
// build holds a writable state. A POSE takes the current state and returns the
// next one, and a caller drives it through the engine, as
// `engine.apply((s) => engine.debug.setNode(s, 4, 4, 3))`. A READING takes the
// current state and returns what it read, as `debug.snapshot(engine.state)`.
//
// Each pose SETS ONE FIELD and takes scalars. There is no operation that takes a
// layout, no operation that arranges several things at once, and no operation
// that fabricates an outcome: a pose puts the game into a situation, and the
// game's own stepping, collision, charge, discharge and scoring rules are what
// run from there when the engine advances a frame.
//
// Everything about DRIVING A BROWSER GAME rather than about Wireworm belongs to
// the engine and is deliberately absent: there is no clock operation (the engine
// owns the clock and runs exact frames), no key operation (the registered
// actions are driven directly), no overlay toggle (the engine draws the panel
// and owns the backtick key), and no `setMuted` (the engine owns the mute bit;
// the `mute` binding sets it and the snapshot reports it).

import {
  CHARGE_MAX,
  DEFAULT_SEED,
  TOTAL_LEVELS,
  WIREWORM_DEBUG_VERSION,
  inBounds,
  wormLength,
  wormStepInterval,
} from "./constants";
import { addFoe as addFoeAt } from "./foes";
import { dropNode, putNode } from "./field";
import { placeCursor, resetToTitle } from "./flow";
import { addWorm as addWormAt } from "./worm";
import {
  foeById,
  takeId,
  toSim,
  wormById,
  type MutWorm,
  type Sim,
} from "./sim";
import type { FoeKind, Phase, Screen, WirewormState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** The plain, JSON-serializable view `snapshot` returns. */
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
  cursor: {
    x: number;
    y: number;
    invulnerable: number;
    contact: boolean;
  };
  fireCooldown: number;
  nodes: { c: number; r: number; charge: number }[];
  worms: {
    id: number;
    segments: { c: number; r: number }[];
    dh: number;
    dv: number;
    diving: boolean;
    stepping: boolean;
    body: boolean;
  }[];
  foes: {
    id: number;
    kind: FoeKind;
    x: number;
    y: number;
    vx: number;
    vy: number;
    hit: boolean;
    mind: boolean;
    travel: boolean;
  }[];
  bolts: { id: number; x: number; y: number }[];
  arcs: { from: { c: number; r: number }; to: { c: number; r: number } }[];
  simTime: number;
}

/** One pose or reading over the state, as the engine's `Transition` shape. */
type Pose = (state: DeepReadonly<WirewormState>) => WirewormState;

/** The surface `initialize` returns beside the state. */
export interface WirewormDebugApi {
  version: number;

  reset(
    state: DeepReadonly<WirewormState>,
    options?: { seed?: number },
  ): WirewormState;
  snapshot(state: DeepReadonly<WirewormState>): WirewormSnapshot;

  setScreen(state: DeepReadonly<WirewormState>, screen: Screen): WirewormState;
  setPhase(state: DeepReadonly<WirewormState>, phase: Phase): WirewormState;
  setPhaseTimer(
    state: DeepReadonly<WirewormState>,
    seconds: number,
  ): WirewormState;
  setMenuIndex(state: DeepReadonly<WirewormState>, n: number): WirewormState;
  setScore(state: DeepReadonly<WirewormState>, n: number): WirewormState;
  setLives(state: DeepReadonly<WirewormState>, n: number): WirewormState;
  setLevel(state: DeepReadonly<WirewormState>, n: number): WirewormState;
  setReachedLevel(state: DeepReadonly<WirewormState>, n: number): WirewormState;

  setFoeSpawning(
    state: DeepReadonly<WirewormState>,
    enabled: boolean,
  ): WirewormState;
  setWormEntry(
    state: DeepReadonly<WirewormState>,
    enabled: boolean,
  ): WirewormState;
  setCursorContact(
    state: DeepReadonly<WirewormState>,
    enabled: boolean,
  ): WirewormState;

  setCursor(
    state: DeepReadonly<WirewormState>,
    x: number,
    y: number,
  ): WirewormState;
  setCursorInvulnerable(
    state: DeepReadonly<WirewormState>,
    seconds: number,
  ): WirewormState;
  setFireCooldown(
    state: DeepReadonly<WirewormState>,
    seconds: number,
  ): WirewormState;
  addBolt(
    state: DeepReadonly<WirewormState>,
    x: number,
    y: number,
  ): WirewormState;
  removeBolt(state: DeepReadonly<WirewormState>, id: number): WirewormState;
  clearBolts(state: DeepReadonly<WirewormState>): WirewormState;

  setNode(
    state: DeepReadonly<WirewormState>,
    c: number,
    r: number,
    charge: number,
  ): WirewormState;
  clearNode(
    state: DeepReadonly<WirewormState>,
    c: number,
    r: number,
  ): WirewormState;
  clearNodes(state: DeepReadonly<WirewormState>): WirewormState;

  addWorm(
    state: DeepReadonly<WirewormState>,
    c: number,
    r: number,
  ): WirewormState;
  appendSegment(
    state: DeepReadonly<WirewormState>,
    id: number,
    c: number,
    r: number,
  ): WirewormState;
  setWormHeading(
    state: DeepReadonly<WirewormState>,
    id: number,
    dh: number,
  ): WirewormState;
  setWormDescent(
    state: DeepReadonly<WirewormState>,
    id: number,
    dv: number,
  ): WirewormState;
  setWormDiving(
    state: DeepReadonly<WirewormState>,
    id: number,
    diving: boolean,
  ): WirewormState;
  setWormStepping(
    state: DeepReadonly<WirewormState>,
    id: number,
    enabled: boolean,
  ): WirewormState;
  setWormBody(
    state: DeepReadonly<WirewormState>,
    id: number,
    enabled: boolean,
  ): WirewormState;
  removeWorm(state: DeepReadonly<WirewormState>, id: number): WirewormState;
  clearWorms(state: DeepReadonly<WirewormState>): WirewormState;

  addFoe(
    state: DeepReadonly<WirewormState>,
    kind: FoeKind,
    x: number,
    y: number,
  ): WirewormState;
  setFoeVelocity(
    state: DeepReadonly<WirewormState>,
    id: number,
    vx: number,
    vy: number,
  ): WirewormState;
  setFoeHit(
    state: DeepReadonly<WirewormState>,
    id: number,
    hit: boolean,
  ): WirewormState;
  setFoeMind(
    state: DeepReadonly<WirewormState>,
    id: number,
    enabled: boolean,
  ): WirewormState;
  setFoeTravel(
    state: DeepReadonly<WirewormState>,
    id: number,
    enabled: boolean,
  ): WirewormState;
  removeFoe(state: DeepReadonly<WirewormState>, id: number): WirewormState;
  clearFoes(state: DeepReadonly<WirewormState>): WirewormState;
}

/** Write `change` into a copy of the state and hand the copy back. */
function pose(change: (sim: Sim) => void): Pose {
  return (state) => {
    const sim = toSim(state);
    change(sim);
    return sim;
  };
}

/** Apply `change` to the worm with that id, and leave the state alone otherwise. */
function poseWorm(id: number, change: (worm: MutWorm) => void): Pose {
  return pose((sim) => {
    const worm = wormById(sim, id);
    if (worm !== undefined) change(worm);
  });
}

/** A whole number held inside `[lo, hi]`. */
function whole(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(): WirewormDebugApi {
  return {
    version: WIREWORM_DEBUG_VERSION,

    reset: (state, options) =>
      pose((sim) => {
        resetToTitle(sim, options?.seed ?? DEFAULT_SEED);
      })(state),

    snapshot: (state) => ({
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
      worms: state.worms.map((worm) => ({
        id: worm.id,
        segments: worm.segments.map((tile) => ({ c: tile.c, r: tile.r })),
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
      bolts: state.bolts.map((bolt) => ({
        id: bolt.id,
        x: bolt.x,
        y: bolt.y,
      })),
      // The links a live discharge is arcing along; each one's remaining life is
      // the game's own bookkeeping and is left out.
      arcs: state.arcs.map((arc) => ({
        from: { c: arc.from.c, r: arc.from.r },
        to: { c: arc.to.c, r: arc.to.r },
      })),
      simTime: state.simTime,
    }),

    // ---- The screen and the run ------------------------------------------

    setScreen: (state, screen) =>
      pose((sim) => {
        sim.screen = screen;
      })(state),

    setPhase: (state, phase) =>
      pose((sim) => {
        sim.phase = phase;
      })(state),

    setPhaseTimer: (state, seconds) =>
      pose((sim) => {
        sim.phaseTimer = seconds;
      })(state),

    setMenuIndex: (state, n) =>
      pose((sim) => {
        sim.menuIndex = Math.max(0, Math.round(n));
      })(state),

    // A pose is a precondition, so no bonus life is granted here whatever
    // boundary the score is carried across.
    setScore: (state, n) =>
      pose((sim) => {
        sim.score = n;
      })(state),

    setLives: (state, n) =>
      pose((sim) => {
        sim.lives = Math.max(0, Math.round(n));
      })(state),

    // The level's step interval and worm length are derived from this, and
    // nothing is spawned or cleared by setting it.
    setLevel: (state, n) =>
      pose((sim) => {
        sim.level = whole(n, 1, TOTAL_LEVELS);
      })(state),

    setReachedLevel: (state, n) =>
      pose((sim) => {
        sim.reachedLevel = whole(n, 1, TOTAL_LEVELS);
      })(state),

    // ---- The world gates --------------------------------------------------

    setFoeSpawning: (state, enabled) =>
      pose((sim) => {
        sim.foeSpawning = enabled;
      })(state),

    setWormEntry: (state, enabled) =>
      pose((sim) => {
        sim.wormEntry = enabled;
      })(state),

    setCursorContact: (state, enabled) =>
      pose((sim) => {
        sim.cursor.contact = enabled;
      })(state),

    // ---- The cursor and its bolts -----------------------------------------

    setCursor: (state, x, y) =>
      pose((sim) => {
        placeCursor(sim, x, y);
      })(state),

    setCursorInvulnerable: (state, seconds) =>
      pose((sim) => {
        sim.cursor.invulnerable = Math.max(0, seconds);
      })(state),

    setFireCooldown: (state, seconds) =>
      pose((sim) => {
        sim.fireCooldown = Math.max(0, seconds);
      })(state),

    addBolt: (state, x, y) =>
      pose((sim) => {
        sim.bolts.push({ id: takeId(sim), x, y });
      })(state),

    removeBolt: (state, id) =>
      pose((sim) => {
        sim.bolts = sim.bolts.filter((bolt) => bolt.id !== id);
      })(state),

    clearBolts: (state) =>
      pose((sim) => {
        sim.bolts = [];
      })(state),

    // ---- The node field ---------------------------------------------------

    setNode: (state, c, r, charge) =>
      pose((sim) => {
        if (!inBounds(c, r)) return;
        putNode(sim, c, r, whole(charge, 0, CHARGE_MAX));
      })(state),

    clearNode: (state, c, r) =>
      pose((sim) => {
        dropNode(sim, c, r);
      })(state),

    clearNodes: (state) =>
      pose((sim) => {
        sim.nodes = [];
      })(state),

    // ---- The worms --------------------------------------------------------

    addWorm: (state, c, r) =>
      pose((sim) => {
        addWormAt(sim, c, r);
      })(state),

    appendSegment: (state, id, c, r) =>
      poseWorm(id, (worm) => {
        worm.segments.push({ c, r });
      })(state),

    setWormHeading: (state, id, dh) =>
      poseWorm(id, (worm) => {
        worm.dh = dh < 0 ? -1 : 1;
      })(state),

    setWormDescent: (state, id, dv) =>
      poseWorm(id, (worm) => {
        worm.dv = dv < 0 ? -1 : 1;
      })(state),

    setWormDiving: (state, id, diving) =>
      poseWorm(id, (worm) => {
        worm.diving = diving;
      })(state),

    setWormStepping: (state, id, enabled) =>
      poseWorm(id, (worm) => {
        worm.stepping = enabled;
      })(state),

    setWormBody: (state, id, enabled) =>
      poseWorm(id, (worm) => {
        worm.body = enabled;
      })(state),

    removeWorm: (state, id) =>
      pose((sim) => {
        sim.worms = sim.worms.filter((worm) => worm.id !== id);
      })(state),

    clearWorms: (state) =>
      pose((sim) => {
        sim.worms = [];
      })(state),

    // ---- The foes ---------------------------------------------------------

    addFoe: (state, kind, x, y) =>
      pose((sim) => {
        addFoeAt(sim, kind, x, y);
      })(state),

    setFoeVelocity: (state, id, vx, vy) =>
      pose((sim) => {
        const foe = foeById(sim, id);
        if (foe === undefined) return;
        foe.vx = vx;
        foe.vy = vy;
      })(state),

    setFoeHit: (state, id, hit) =>
      pose((sim) => {
        const foe = foeById(sim, id);
        if (foe === undefined) return;
        foe.hit = hit;
      })(state),

    setFoeMind: (state, id, enabled) =>
      pose((sim) => {
        const foe = foeById(sim, id);
        if (foe !== undefined) foe.mind = enabled;
      })(state),

    setFoeTravel: (state, id, enabled) =>
      pose((sim) => {
        const foe = foeById(sim, id);
        if (foe !== undefined) foe.travel = enabled;
      })(state),

    removeFoe: (state, id) =>
      pose((sim) => {
        sim.foes = sim.foes.filter((foe) => foe.id !== id);
      })(state),

    clearFoes: (state) =>
      pose((sim) => {
        sim.foes = [];
      })(state),
  };
}
