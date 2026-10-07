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
// EVERY OPERATION ACTS, AND NONE OF THEM DECLINES QUIETLY. A pose reaches the
// value it names whatever the game's own rules would have allowed a player to
// reach, so nothing below clamps a posed value onto a legal neighbour or hands
// back the state it was given and calls that an answer. Where the game has no
// defined state to reach — a tile off the board, a charge outside the scale, a
// heading that is neither direction, a name outside its set, an id no live
// entity carries — the call THROWS, so the caller sees it rather than reading
// back a board it never posed (specs/instrumentation.md).
//
// Everything about DRIVING A BROWSER GAME rather than about Wireworm belongs to
// the engine and is deliberately absent: there is no clock operation (the engine
// owns the clock and runs exact frames), no key operation (the registered
// actions are driven directly), no overlay toggle (the engine draws the panel
// and owns the backtick key), and no `setMuted` (the engine owns the mute bit;
// the `mute` binding sets it and the snapshot reports it).

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
import { addFoe as addFoeAt } from "./foes";
import { dropNode, putNode } from "./field";
import { resetToTitle } from "./flow";
import { itemRect, menuFor, type MenuRect } from "./menus";
import { addWorm as addWormAt } from "./worm";
import {
  foeById,
  takeId,
  toSim,
  wormById,
  type MutWorm,
  type Sim,
} from "./sim";
import type { Edge, FoeKind, Phase, Screen, WirewormState } from "./game";
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
  glitchTimer: number;
  dropperTimer: number;
  corruptorTimer: number;
  nextWormEntry: Edge | null;
  nextGlitchEntry: { c: number; r: number } | null;
  nextDropperEntry: { c: number; r: number } | null;
  nextCorruptorEntry: { c: number; r: number } | null;
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

  reset(state: DeepReadonly<WirewormState>): WirewormState;
  snapshot(state: DeepReadonly<WirewormState>): WirewormSnapshot;
  reconcile(state: DeepReadonly<WirewormState>): WirewormState;

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
  menuItemRect(
    state: DeepReadonly<WirewormState>,
    index: number,
  ): MenuRect | null;

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

  setSpawnTimer(
    state: DeepReadonly<WirewormState>,
    kind: FoeKind,
    seconds: number,
  ): WirewormState;
  setNextFoeEntry(
    state: DeepReadonly<WirewormState>,
    kind: FoeKind,
    c: number,
    r: number,
  ): WirewormState;
  setNextWormEntry(
    state: DeepReadonly<WirewormState>,
    edge: Edge,
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

/* -------------------------------------------------------------------------- */
/* The loud half of the contract                                              */
/* -------------------------------------------------------------------------- */
//
// An operation never returns the state it was handed unchanged. Where there is a
// defined state the call reaches, it reaches it; where there is not, it throws,
// and the helpers below are how it throws. They are the only guards on this
// surface: nothing here asks which screen is up, where the cursor is standing,
// or whether the game is live before doing what it is named for.

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

/** Apply `change` to the worm with that id; an id no worm carries fails loudly. */
function poseWorm(
  op: string,
  id: number,
  change: (worm: MutWorm) => void,
): Pose {
  return pose((sim) => {
    const worm = wormById(sim, id);
    if (worm === undefined) reject(op, `no worm carries id ${String(id)}`);
    change(worm);
  });
}

/** The foe with that id; an id no foe carries fails loudly. */
function requireFoe(op: string, sim: Sim, id: number) {
  const foe = foeById(sim, id);
  if (foe === undefined) reject(op, `no foe carries id ${String(id)}`);
  return foe;
}

/** A posed tile as the snapshot reports it: a copy, or `null` for none posed. */
function readTile(
  tile: DeepReadonly<{ c: number; r: number }> | null,
): { c: number; r: number } | null {
  return tile === null ? null : { c: tile.c, r: tile.r };
}

/** The surface. Every member is one pose or one reading. */
export function createDebugApi(): WirewormDebugApi {
  return {
    version: WIREWORM_DEBUG_VERSION,

    reset: (state) =>
      pose((sim) => {
        resetToTitle(sim);
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
      glitchTimer: state.glitchTimer,
      dropperTimer: state.dropperTimer,
      corruptorTimer: state.corruptorTimer,
      nextWormEntry: state.nextWormEntry,
      nextGlitchEntry: readTile(state.nextGlitchEntry),
      nextDropperEntry: readTile(state.nextDropperEntry),
      nextCorruptorEntry: readTile(state.nextCorruptorEntry),
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

    /**
     * Bring every reported reading into agreement with the world as it stands.
     *
     * Every derived reading this build reports — `wormStepInterval` and
     * `wormLength` from the level, `arcs` from the live discharge, a foe's `vx`
     * and `vy` from its own motion — is worked out at the read in `snapshot`, so
     * nothing is held that a pose can leave behind and there is nothing here to
     * rewrite. The operation is required of every build, including one that
     * keeps those readings as stored copies, and this is what it comes to in a
     * build that does not: the state handed back equals the state handed in.
     *
     * It advances nothing and fires nothing either way: no clock moves, no
     * system runs, and a caller may make the call as often as it likes.
     */
    reconcile: (state) => pose(() => undefined)(state),

    // ---- The screen and the run ------------------------------------------

    setScreen: (state, screen) =>
      pose((sim) => {
        sim.screen = requireOneOf("setScreen", "screen", screen, SCREENS);
      })(state),

    setPhase: (state, phase) =>
      pose((sim) => {
        sim.phase = requireOneOf("setPhase", "phase", phase, PHASES);
      })(state),

    setPhaseTimer: (state, seconds) =>
      pose((sim) => {
        sim.phaseTimer = requireNumber("setPhaseTimer", "seconds", seconds);
      })(state),

    setMenuIndex: (state, n) =>
      pose((sim) => {
        sim.menuIndex = requireNumber("setMenuIndex", "index", n);
      })(state),

    // A pose is a precondition, so no bonus life is granted here whatever
    // boundary the score is carried across.
    setScore: (state, n) =>
      pose((sim) => {
        sim.score = requireNumber("setScore", "score", n);
      })(state),

    setLives: (state, n) =>
      pose((sim) => {
        sim.lives = requireNumber("setLives", "lives", n);
      })(state),

    // The level's step interval and worm length are derived from this, and
    // nothing is spawned or cleared by setting it. `1` through `TOTAL_LEVELS`
    // is a range the specs fix as a constant, so it is a domain rather than a
    // rule: a level outside it names no level of this game and the call fails
    // loudly instead of landing on the nearest one.
    setLevel: (state, n) =>
      pose((sim) => {
        sim.level = requireWhole("setLevel", "level", n, 1, TOTAL_LEVELS);
      })(state),

    setReachedLevel: (state, n) =>
      pose((sim) => {
        sim.reachedLevel = requireWhole(
          "setReachedLevel",
          "level",
          n,
          1,
          TOTAL_LEVELS,
        );
      })(state),

    /**
     * Where the build put item `index` of the menu the current screen shows
     * (specs/instrumentation.md).
     *
     * A pure read of the same layout `src/render.ts` draws from, so a pointer
     * selects exactly what the player sees. `null` on `playing` and `howto`,
     * which show no menu, and for an index the current menu has no item at.
     */
    menuItemRect: (state, index) => {
      const menu = menuFor(state.screen);
      return menu === null ? null : itemRect(menu, index);
    },

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

    // ---- The level's draws ------------------------------------------------

    // The clock then runs exactly as specs/foes.md states, so a clock posed at
    // 0 is drawn afresh on the next update of active play.
    setSpawnTimer: (state, kind, seconds) =>
      pose((sim) => {
        requireOneOf("setSpawnTimer", "kind", kind, FOE_KINDS);
        const value = requireNumber("setSpawnTimer", "seconds", seconds);
        if (kind === "glitch") sim.glitchTimer = value;
        else if (kind === "dropper") sim.dropperTimer = value;
        else sim.corruptorTimer = value;
      })(state),

    // The entry consumes the pose; every entry after it is drawn at random.
    // The board's tiles are fixed by the specs, so a tile off the board names
    // no entry and fails loudly rather than being rounded onto one.
    setNextFoeEntry: (state, kind, c, r) =>
      pose((sim) => {
        requireOneOf("setNextFoeEntry", "kind", kind, FOE_KINDS);
        requireTile("setNextFoeEntry", c, r);
        const tile = { c, r };
        if (kind === "glitch") sim.nextGlitchEntry = tile;
        else if (kind === "dropper") sim.nextDropperEntry = tile;
        else sim.nextCorruptorEntry = tile;
      })(state),

    setNextWormEntry: (state, edge) =>
      pose((sim) => {
        sim.nextWormEntry = requireOneOf(
          "setNextWormEntry",
          "edge",
          edge,
          EDGES,
        );
      })(state),

    // ---- The cursor and its bolts -----------------------------------------

    // The band is the cursor's own fixed bound rather than a live figure, so it
    // is this operation's domain: a position outside it fails loudly. What it
    // does NOT do is land the cursor on the nearest edge and let the caller read
    // a position it never posed — the clamp belongs to the movement path, which
    // is what a held movement runs through.
    setCursor: (state, x, y) =>
      pose((sim) => {
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
        sim.cursor.x = x;
        sim.cursor.y = y;
      })(state),

    setCursorInvulnerable: (state, seconds) =>
      pose((sim) => {
        sim.cursor.invulnerable = requireNumber(
          "setCursorInvulnerable",
          "seconds",
          seconds,
        );
      })(state),

    setFireCooldown: (state, seconds) =>
      pose((sim) => {
        sim.fireCooldown = requireNumber("setFireCooldown", "seconds", seconds);
      })(state),

    addBolt: (state, x, y) =>
      pose((sim) => {
        requireNumber("addBolt", "x", x);
        requireNumber("addBolt", "y", y);
        sim.bolts.push({ id: takeId(sim), x, y });
      })(state),

    removeBolt: (state, id) =>
      pose((sim) => {
        if (!sim.bolts.some((bolt) => bolt.id === id)) {
          reject("removeBolt", `no bolt carries id ${String(id)}`);
        }
        sim.bolts = sim.bolts.filter((bolt) => bolt.id !== id);
      })(state),

    clearBolts: (state) =>
      pose((sim) => {
        sim.bolts = [];
      })(state),

    // ---- The node field ---------------------------------------------------

    // The board's tiles and the charge scale are both fixed by the specs, so
    // both are domains: a tile off the board and a charge outside `0` to
    // `CHARGE_MAX` each fail loudly rather than being dropped or squeezed into
    // range.
    setNode: (state, c, r, charge) =>
      pose((sim) => {
        requireTile("setNode", c, r);
        putNode(
          sim,
          c,
          r,
          requireWhole("setNode", "charge", charge, 0, CHARGE_MAX),
        );
      })(state),

    clearNode: (state, c, r) =>
      pose((sim) => {
        requireTile("clearNode", c, r);
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
      poseWorm("appendSegment", id, (worm) => {
        worm.segments.push({ c, r });
      })(state),

    setWormHeading: (state, id, dh) =>
      poseWorm("setWormHeading", id, (worm) => {
        worm.dh = requireOneOf("setWormHeading", "dh", dh, [1, -1]);
      })(state),

    setWormDescent: (state, id, dv) =>
      poseWorm("setWormDescent", id, (worm) => {
        worm.dv = requireOneOf("setWormDescent", "dv", dv, [1, -1]);
      })(state),

    setWormDiving: (state, id, diving) =>
      poseWorm("setWormDiving", id, (worm) => {
        worm.diving = diving;
      })(state),

    setWormStepping: (state, id, enabled) =>
      poseWorm("setWormStepping", id, (worm) => {
        worm.stepping = enabled;
      })(state),

    setWormBody: (state, id, enabled) =>
      poseWorm("setWormBody", id, (worm) => {
        worm.body = enabled;
      })(state),

    removeWorm: (state, id) =>
      pose((sim) => {
        if (!sim.worms.some((worm) => worm.id === id)) {
          reject("removeWorm", `no worm carries id ${String(id)}`);
        }
        sim.worms = sim.worms.filter((worm) => worm.id !== id);
      })(state),

    clearWorms: (state) =>
      pose((sim) => {
        sim.worms = [];
      })(state),

    // ---- The foes ---------------------------------------------------------

    addFoe: (state, kind, x, y) =>
      pose((sim) => {
        requireOneOf("addFoe", "kind", kind, FOE_KINDS);
        requireNumber("addFoe", "x", x);
        requireNumber("addFoe", "y", y);
        addFoeAt(sim, kind, x, y);
      })(state),

    setFoeVelocity: (state, id, vx, vy) =>
      pose((sim) => {
        const foe = requireFoe("setFoeVelocity", sim, id);
        foe.vx = requireNumber("setFoeVelocity", "vx", vx);
        foe.vy = requireNumber("setFoeVelocity", "vy", vy);
      })(state),

    setFoeHit: (state, id, hit) =>
      pose((sim) => {
        requireFoe("setFoeHit", sim, id).hit = hit;
      })(state),

    setFoeMind: (state, id, enabled) =>
      pose((sim) => {
        requireFoe("setFoeMind", sim, id).mind = enabled;
      })(state),

    setFoeTravel: (state, id, enabled) =>
      pose((sim) => {
        requireFoe("setFoeTravel", sim, id).travel = enabled;
      })(state),

    removeFoe: (state, id) =>
      pose((sim) => {
        if (!sim.foes.some((foe) => foe.id === id)) {
          reject("removeFoe", `no foe carries id ${String(id)}`);
        }
        sim.foes = sim.foes.filter((foe) => foe.id !== id);
      })(state),

    clearFoes: (state) =>
      pose((sim) => {
        sim.foes = [];
      })(state),
  };
}
