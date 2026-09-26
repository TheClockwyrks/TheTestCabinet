// The debugging and automation surface, `window.__gantry`
// (`specs/instrumentation.md`).
//
// Every operation is a reading or a pose. Three rules cover all of them:
//
//  - An argument outside the domain its operation states is invalid and the
//    call fails loudly — an index or a member id nothing carries included, and
//    a coordinate that is not a multiple of `LATTICE_PITCH` where the table
//    names a lattice node.
//  - A pose that stands for something a player does commits through the same
//    rule the player's act passes, so it is refused wherever that act is
//    refused, silently, changing nothing.
//  - Each pose applies on the screens its section names and does nothing on
//    any other.
//
// The surface is inert during normal play: nothing here runs until something
// calls it.

import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  GANTRY_DEBUG_VERSION,
  LATTICE_PITCH,
  RUN_SPEEDS,
  SITE_COUNT,
  TICK_HZ,
} from "./constants";
import type { Game } from "./app";
import * as editor from "./editor";
import { menuRects } from "./menus";
import { project } from "./render";
import type { DrawnEntry } from "./render-drawn";
import {
  AXIS_NAMES,
  cost as structureCost,
  isAxisName,
  isMaterial,
  readiness,
  staticCheck,
  type AxisName,
  type AxisState,
  type LoadClass,
  type LoadPhase,
  type Material,
  type MemberForce,
  type SiteLoad,
  type TapeStep,
  type Vec3,
} from "./sim";
import * as st from "./state";
import type { GantryState, Screen, Tool } from "./state";

// ---- The shapes the surface reports ---------------------------------------

/** A world position, as the snapshot reports one. */
export interface PointReport {
  x: number;
  y: number;
  z: number;
}

/** A lift point and a yaw, as the snapshot reports one. */
export interface PoseReport extends PointReport {
  yaw: number;
}

export interface ScoreReport {
  cost: number;
  time: number;
}

export interface MemberForceReport {
  id: number;
  force: number;
  utilization: number;
}

/** What the static check reports (`specs/structure.md`). */
export interface CheckReport {
  issues: string[];
  cost: number;
  budget: number;
  stable: boolean;
  members: MemberForceReport[];
}

export interface MemberReport {
  id: number;
  a: PointReport;
  b: PointReport;
  material: Material;
}

export interface LoadReport {
  class: LoadClass;
  mass: number;
  from: PoseReport;
  to: PoseReport;
}

export interface ObstacleReport {
  min: PointReport;
  size: PointReport;
}

export interface SiteReport {
  name: string;
  envelope: { min: PointReport; max: PointReport };
  anchors: PointReport[];
  budget: number;
  par: ScoreReport;
  loads: LoadReport[];
  obstacles: ObstacleReport[];
}

export interface StructureReport {
  members: MemberReport[];
  nextMemberId: number;
  ring: { corner: PointReport } | null;
  counterweights: PointReport[];
  cost: number;
  issues: string[];
}

export interface AxisReport {
  value: number;
  rate: number;
  command: { target: number; rate: number } | null;
}

export interface RunLoadReport {
  phase: LoadPhase;
  pos: PointReport;
  yaw: number;
}

export interface RunReport {
  phase: "idle" | "running" | "cleared" | "failed";
  cause: string | null;
  tick: number;
  /** `tick / TICK_HZ`, seconds. */
  time: number;
  speedIndex: number;
  stepIndex: number;
  stepLive: boolean;
  axes: Record<AxisName, AxisReport>;
  pivot: PointReport;
  bob: { pos: PointReport; vel: PointReport };
  attached: number | null;
  loads: RunLoadReport[];
  forces: MemberForceReport[];
  broken: number[];
}

export interface PointerReport {
  x: number;
  y: number;
  down: boolean;
  pressX: number;
  pressY: number;
  dragging: boolean;
}

export interface PickReport {
  node: PointReport | null;
  member: number | null;
}

/** The fixed shape `snapshot` returns; every field is present on every screen. */
export interface Snapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  siteIndex: number;
  cleared: boolean[];
  best: (ScoreReport | null)[];
  site: SiteReport;
  tool: Tool;
  pendingNode: PointReport | null;
  historyDepth: number;
  camera: { yaw: number; pitch: number; dist: number };
  pointer: PointerReport;
  pick: PickReport;
  structure: StructureReport;
  program: TapeStep[];
  checkResult: CheckReport | null;
  run: RunReport;
  muted: boolean;
  simTime: number;
}

/** A menu entry's hit region, in logical stage units. */
export interface MenuRectReport {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a world position is drawn, in logical stage units. */
export interface ProjectionReport {
  x: number;
  y: number;
  visible: boolean;
}

/** The whole surface (`specs/instrumentation.md`). */
export interface GantryDebugApi {
  readonly version: number;

  // The clock
  setAutoStep(enabled: boolean): void;
  advance(ticks?: number): void;

  // Readings
  snapshot(): Snapshot;
  check(): CheckReport;
  project(x: number, y: number, z: number): ProjectionReport;
  drawn(): DrawnEntry[];
  menuItemRect(index: number): MenuRectReport;

  // The run and the screens
  reset(): void;
  /** Bring every reported reading into agreement with the world as it stands. */
  reconcile(): void;
  setScreen(screen: string): void;
  setMenuIndex(index: number): void;
  openSite(index: number): void;
  setCleared(index: number, cleared: boolean): void;
  setBest(index: number, cost: number, time: number): void;
  clearBest(index: number): void;
  setCamera(yaw: number, pitch: number, dist: number): void;
  startRun(): void;
  abortRun(): void;
  showCheck(): void;

  // The structure
  clearStructure(): void;
  addMember(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    material: string,
  ): void;
  removeMember(id: number): void;
  setRing(x: number, y: number, z: number): void;
  clearRing(): void;
  addCounterweight(x: number, y: number, z: number): void;
  removeCounterweight(x: number, y: number, z: number): void;
  setTool(tool: string): void;
  setPendingNode(x: number, y: number, z: number): void;
  clearPendingNode(): void;

  // The tape
  clearProgram(): void;
  addMoveStep(axis: string, target: number, rate: number): void;
  addCommand(index: number, axis: string, target: number, rate: number): void;
  addActionStep(action: string): void;
  removeStep(index: number): void;

  // The site
  clearLoads(): void;
  addLoad(
    cls: string,
    mass: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void;
  setLoadTarget(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void;
  clearObstacles(): void;
  addObstacle(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ): void;

  // The run in progress
  setAxis(axis: string, value: number): void;
  setAxisRate(axis: string, rate: number): void;
  setBob(x: number, y: number, z: number): void;
  setBobVelocity(vx: number, vy: number, vz: number): void;
  setLoadPose(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void;
  setLoadPhase(index: number, phase: string): void;
  setRunTick(tick: number): void;
  setSpeedIndex(index: number): void;

  // Input
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(): void;
  touchDown(x: number, y: number): void;
  touchUp(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
}

// ---- Domains ---------------------------------------------------------------

/** An argument outside its domain fails loudly rather than being guessed at. */
function invalid(message: string): never {
  throw new Error(`__gantry: ${message}`);
}

function requireNumber(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`${name} must be a finite number`);
  }
  return value;
}

function requireInteger(name: string, value: unknown): number {
  const n = requireNumber(name, value);
  if (!Number.isInteger(n)) invalid(`${name} must be an integer`);
  return n;
}

/** A count: an integer at or above zero, with no upper bound of its own. */
function requireWholeNumber(name: string, value: unknown): number {
  const n = requireInteger(name, value);
  if (n < 0) invalid(`${name} must be at or above 0`);
  return n;
}

function requireIndex(name: string, value: unknown, count: number): number {
  const n = requireInteger(name, value);
  if (n < 0 || n >= count) {
    invalid(`${name} ${n} is outside 0..${count - 1}`);
  }
  return n;
}

function requireBoolean(name: string, value: unknown): boolean {
  if (typeof value !== "boolean") invalid(`${name} must be a boolean`);
  return value;
}

function requireString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${name} must be a non-empty string`);
  }
  return value;
}

function requireOneOf<T extends string>(
  name: string,
  value: unknown,
  allowed: readonly T[],
): T {
  const s = requireString(name, value);
  if (!(allowed as readonly string[]).includes(s)) {
    invalid(`${name} must be one of ${allowed.join(", ")}, not ${s}`);
  }
  return s as T;
}

/**
 * A lattice node: every coordinate a finite multiple of `LATTICE_PITCH`. A
 * coordinate that is not one is outside the domain and fails here, rather than
 * being refused as an edit.
 */
function requireNode(x: unknown, y: unknown, z: unknown): Vec3 {
  const coords: [number, number, number] = [
    requireNumber("x", x),
    requireNumber("y", y),
    requireNumber("z", z),
  ];
  for (const c of coords) {
    if (c % LATTICE_PITCH !== 0) {
      invalid(`(${coords.join(", ")}) is not a lattice node`);
    }
  }
  return coords;
}

function requireVector(
  names: readonly [string, string, string],
  x: unknown,
  y: unknown,
  z: unknown,
): Vec3 {
  return [
    requireNumber(names[0], x),
    requireNumber(names[1], y),
    requireNumber(names[2], z),
  ];
}

function requireAxis(value: unknown): AxisName {
  const s = requireString("axis", value);
  if (!isAxisName(s)) invalid(`axis must be one of ${AXIS_NAMES.join(", ")}`);
  return s;
}

function requireMaterial(value: unknown): Material {
  const s = requireString("material", value);
  if (!isMaterial(s)) invalid(`material must be strut, cable, or rail`);
  return s;
}

const LOAD_CLASSES: readonly LoadClass[] = ["crate", "container", "drum"];
const LOAD_PHASES: readonly LoadPhase[] = [
  "waiting",
  "attached",
  "placed",
  "lost",
];

// ---- Reporting -------------------------------------------------------------

const point = (p: Vec3): PointReport => ({ x: p[0], y: p[1], z: p[2] });

const pose = (p: { pos: Vec3; yaw: number }): PoseReport => ({
  ...point(p.pos),
  yaw: p.yaw,
});

const forces = (list: readonly MemberForce[]): MemberForceReport[] =>
  list.map((f) => ({ id: f.id, force: f.force, utilization: f.utilization }));

const axisReport = (axis: AxisState): AxisReport => ({
  value: axis.value,
  rate: axis.rate,
  command:
    axis.command === null
      ? null
      : { target: axis.command.target, rate: axis.command.rate },
});

const loadReport = (load: SiteLoad): LoadReport => ({
  class: load.cls,
  mass: load.mass,
  from: pose(load.from),
  to: pose(load.to),
});

const stepReport = (step: TapeStep): TapeStep =>
  step.kind === "move"
    ? {
        kind: "move",
        commands: step.commands.map((c) => ({
          axis: c.axis,
          target: c.target,
          rate: c.rate,
        })),
      }
    : { kind: "action", action: step.action };

const checkReport = (result: {
  issues: readonly string[];
  cost: number;
  budget: number;
  stable: boolean;
  members: readonly MemberForce[];
}): CheckReport => ({
  issues: [...result.issues],
  cost: result.cost,
  budget: result.budget,
  stable: result.stable,
  members: forces(result.members),
});

// ---- The surface -----------------------------------------------------------

/**
 * Build the surface over a game. Every operation reads or replaces
 * `game.state`, so a pose takes effect at the call.
 */
export function createDebugSurface(game: Game): GantryDebugApi {
  const now = (): GantryState => game.state;
  const put = (next: GantryState): void => {
    game.state = next;
  };
  const commit = (outcome: editor.EditOutcome): void => {
    if (outcome.cue !== null) game.playCue(outcome.cue);
    put(outcome.state);
  };
  // NO REACH PREDICATES HERE. Which screen is showing, whether a run is in
  // progress, and which tool is selected are how a PLAYER reaches a control, and
  // `specs/instrumentation.md` (The operations) says they are not an operation's
  // conditions: every operation below acts from wherever the game stands. What
  // stays is each edit's own rule — the editor's placement rules, the tape
  // editor's, and the run's readiness — because those are the edit rather than a
  // gate on reaching it.

  return {
    version: GANTRY_DEBUG_VERSION,

    // ---- The clock --------------------------------------------------------

    setAutoStep(enabled) {
      game.autoStep = requireBoolean("enabled", enabled);
    },

    advance(ticks = 1) {
      const count = requireInteger("ticks", ticks);
      if (count < 0) invalid(`ticks must not be negative`);
      game.advance(count);
    },

    // ---- Readings ---------------------------------------------------------

    snapshot() {
      const state = now();
      const site = st.currentSite(state);
      const structure = st.currentStructure(state);
      const run = state.run;
      const picked =
        state.screen === "build"
          ? editor.pick(state)
          : { node: null, member: null };
      return {
        version: GANTRY_DEBUG_VERSION,
        screen: state.screen,
        menuIndex: state.menuIndex,
        siteIndex: state.siteIndex,
        cleared: [...state.cleared],
        best: state.best.map((b) =>
          b === null ? null : { cost: b.cost, time: b.time },
        ),
        site: {
          name: site.name,
          envelope: {
            min: point(site.envelope.min),
            max: point(site.envelope.max),
          },
          anchors: site.anchors.map(point),
          budget: site.budget,
          par: { cost: site.par.cost, time: site.par.time },
          loads: site.loads.map(loadReport),
          obstacles: site.obstacles.map((box) => ({
            min: point(box.min),
            size: {
              x: box.max[0] - box.min[0],
              y: box.max[1] - box.min[1],
              z: box.max[2] - box.min[2],
            },
          })),
        },
        tool: state.tool,
        pendingNode:
          state.pendingNode === null ? null : point(state.pendingNode),
        historyDepth: state.history.length,
        camera: { ...state.camera },
        pointer: {
          x: state.pointer.x,
          y: state.pointer.y,
          down: state.pointer.down,
          pressX: state.pointer.pressX,
          pressY: state.pointer.pressY,
          dragging: state.pointer.dragging,
        },
        pick: {
          node: picked.node === null ? null : point(picked.node),
          member: picked.member,
        },
        structure: {
          members: structure.members.map((m) => ({
            id: m.id,
            a: point(m.a),
            b: point(m.b),
            material: m.material,
          })),
          nextMemberId: structure.nextMemberId,
          ring:
            structure.ring === null
              ? null
              : { corner: point(structure.ring.corner) },
          counterweights: structure.counterweights.map(point),
          cost: structureCost(structure),
          issues: [...readiness(structure, site.anchors)],
        },
        program: st.currentProgram(state).map(stepReport),
        checkResult:
          state.checkResult === null ? null : checkReport(state.checkResult),
        run: {
          phase: run.phase,
          cause: run.cause,
          tick: run.tick,
          time: run.tick / TICK_HZ,
          speedIndex: run.speedIndex,
          stepIndex: run.stepIndex,
          stepLive: run.stepLive,
          axes: {
            slew: axisReport(run.axes.slew),
            trolley: axisReport(run.axes.trolley),
            hoist: axisReport(run.axes.hoist),
            grip: axisReport(run.axes.grip),
          },
          pivot: point(run.pivot),
          bob: { pos: point(run.bob.pos), vel: point(run.bob.vel) },
          attached: run.attached,
          loads: run.loads.map((l) => ({
            phase: l.phase,
            pos: point(l.pos),
            yaw: l.yaw,
          })),
          forces: forces(run.forces),
          broken: [...run.broken],
        },
        muted: state.muted,
        simTime: state.simTime,
      };
    },

    check() {
      const state = now();
      // Pure: it computes the check and returns it, and displays nothing, so
      // what the build screen is showing is untouched.
      return checkReport(
        staticCheck(
          st.currentSite(state),
          st.currentStructure(state),
          st.currentProgram(state),
        ),
      );
    },

    drawn() {
      // What the last frame drew. It is the frame's own description rather than
      // one built here, so the reading and the picture can never disagree
      // (`specs/instrumentation.md`).
      return game.lastDrawn();
    },

    project(x, y, z) {
      const world = requireVector(["x", "y", "z"], x, y, z);
      return project(now().camera, world);
    },

    menuItemRect(index) {
      // A menu entry's region is only a reading where a menu is showing, so a
      // screen with none and an index the menu has no entry at are both
      // outside the domain (`specs/instrumentation.md`).
      const state = now();
      const count = st.menuLength(state);
      if (count === 0) {
        invalid(
          `menuItemRect is read on a screen showing a menu; ${state.screen} shows none`,
        );
      }
      const at = requireIndex("index", index, count);
      const rect = menuRects(state)[at];
      if (rect === undefined) invalid(`index has no entry at ${at}`);
      return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    },

    // ---- The run and the screens -----------------------------------------

    reset() {
      // Every field goes back to its title-screen value bar `muted`, the copy
      // of a bit the game does not own.
      put({ ...st.titleState(), muted: now().muted });
    },

    /**
     * Bring every reported reading into agreement with the world as it stands.
     *
     * Every derived reading this build reports — the structure's `cost` and
     * `issues`, the `pick` a click at the pointer would take, and the `check` —
     * is worked out at the read, in `snapshot` and `check` above, from the open
     * site's structure, its anchors and the pointer. Nothing is held that a pose
     * can leave behind and there is nothing here to rewrite. `run.forces` is the
     * latest solve's and `run.pivot` is the most recent tick's geometry, so both
     * are the tick's rather than this call's. The operation is required of every
     * build, including one that keeps those readings as stored copies, and this
     * is what it comes to in a build that does not.
     */
    reconcile() {},

    setScreen(screen) {
      const name = requireString("screen", screen);
      if (!st.isScreen(name)) {
        invalid(`screen must be one of ${st.SCREENS.join(", ")}`);
      }
      put(st.setScreen(now(), name));
    },

    setMenuIndex(index) {
      const state = now();
      const count = st.menuLength(state);
      // The domain is the entry count of the menu the screen showing carries. A
      // screen carrying none has no entry to name, so there is no defined state
      // to reach and the call fails loudly rather than passing quietly.
      if (count === 0) {
        requireInteger("index", index);
        invalid(`the ${state.screen} screen carries no menu`);
      }
      put(st.setMenuIndex(state, requireIndex("index", index, count)));
    },

    openSite(index) {
      // The opening `specs/state.md` fixes and nothing else: the screen is left
      // exactly as it stands, so a caller entering a site from the select
      // screen calls `setScreen("build")` after this.
      const site = requireIndex("index", index, SITE_COUNT);
      put(st.openSite(now(), site));
    },

    setCleared(index, cleared) {
      const site = requireIndex("index", index, SITE_COUNT);
      put(st.setCleared(now(), site, requireBoolean("cleared", cleared)));
    },

    setBest(index, cost, time) {
      const site = requireIndex("index", index, SITE_COUNT);
      put(
        st.setBest(now(), site, {
          cost: requireNumber("cost", cost),
          time: requireNumber("time", time),
        }),
      );
    },

    clearBest(index) {
      put(st.setBest(now(), requireIndex("index", index, SITE_COUNT), null));
    },

    setCamera(yaw, pitch, dist) {
      // `specs/controls.md` fixes the pitch and distance limits as constants, so
      // they are this operation's domain rather than a live rule: a value
      // outside either fails loudly rather than being snapped back inside it.
      const turn = requireNumber("yaw", yaw);
      const tilt = requireNumber("pitch", pitch);
      const away = requireNumber("dist", dist);
      if (tilt < CAMERA_PITCH_MIN || tilt > CAMERA_PITCH_MAX) {
        invalid(
          `pitch must be within [${CAMERA_PITCH_MIN}, ${CAMERA_PITCH_MAX}]`,
        );
      }
      if (away < CAMERA_DIST_MIN || away > CAMERA_DIST_MAX) {
        invalid(`dist must be within [${CAMERA_DIST_MIN}, ${CAMERA_DIST_MAX}]`);
      }
      put(st.setCamera(now(), turn, tilt, away));
    },

    startRun() {
      game.requestRun();
    },

    abortRun() {
      put(st.abortRun(now()));
    },

    showCheck() {
      // The `check` action, from wherever the game stands.
      put(editor.showCheck(now()));
    },

    // ---- The structure ----------------------------------------------------

    clearStructure() {
      commit(editor.clearStructure(now()));
    },

    addMember(ax, ay, az, bx, by, bz, material) {
      const a = requireNode(ax, ay, az);
      const b = requireNode(bx, by, bz);
      const what = requireMaterial(material);
      commit(editor.addMember(now(), a, b, what));
    },

    removeMember(id) {
      const state = now();
      const wanted = requireInteger("id", id);
      if (!st.currentStructure(state).members.some((m) => m.id === wanted)) {
        invalid(`no member carries id ${wanted}`);
      }
      commit(editor.removeMember(state, wanted));
    },

    setRing(x, y, z) {
      const corner = requireNode(x, y, z);
      commit(editor.setRing(now(), corner));
    },

    clearRing() {
      commit(editor.clearRing(now()));
    },

    addCounterweight(x, y, z) {
      const node = requireNode(x, y, z);
      commit(editor.addCounterweight(now(), node));
    },

    removeCounterweight(x, y, z) {
      const node = requireNode(x, y, z);
      commit(editor.removeCounterweight(now(), node));
    },

    setTool(tool) {
      const name = requireString("tool", tool);
      if (!st.isTool(name)) {
        invalid(`tool must be one of ${st.TOOLS.join(", ")}`);
      }
      put(st.setTool(now(), name));
    },

    setPendingNode(x, y, z) {
      const node = requireNode(x, y, z);
      put(st.setPendingNode(now(), node));
    },

    clearPendingNode() {
      put(st.clearPendingNode(now()));
    },

    // ---- The tape ---------------------------------------------------------

    clearProgram() {
      put(st.clearProgram(now()));
    },

    addMoveStep(axis, target, rate) {
      const name = requireAxis(axis);
      const to = requireNumber("target", target);
      const at = requireNumber("rate", rate);
      put(st.addMoveStep(now(), name, to, at));
    },

    addCommand(index, axis, target, rate) {
      const state = now();
      const step = requireIndex(
        "index",
        index,
        st.currentProgram(state).length,
      );
      const name = requireAxis(axis);
      const to = requireNumber("target", target);
      const at = requireNumber("rate", rate);
      put(st.addCommand(state, step, name, to, at));
    },

    addActionStep(action) {
      const what = requireOneOf("action", action, [
        "attach",
        "release",
      ] as const);
      put(st.addActionStep(now(), what));
    },

    removeStep(index) {
      const state = now();
      const step = requireIndex(
        "index",
        index,
        st.currentProgram(state).length,
      );
      put(st.removeStep(state, step));
    },

    // ---- The site ---------------------------------------------------------

    clearLoads() {
      put(st.clearLoads(now()));
    },

    addLoad(cls, mass, x, y, z, yaw) {
      const what = requireOneOf("cls", cls, LOAD_CLASSES);
      const weight = requireNumber("mass", mass);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      put(st.addLoad(now(), what, weight, at, turn));
    },

    setLoadTarget(index, x, y, z, yaw) {
      const state = now();
      const load = requireIndex("index", index, state.site.loads.length);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      put(st.setLoadTarget(state, load, at, turn));
    },

    clearObstacles() {
      put(st.clearObstacles(now()));
    },

    addObstacle(x, y, z, w, h, d) {
      const min = requireVector(["x", "y", "z"], x, y, z);
      const size = requireVector(["w", "h", "d"], w, h, d);
      put(st.addObstacle(now(), min, size));
    },

    // ---- The run in progress ----------------------------------------------

    setAxis(axis, value) {
      const name = requireAxis(axis);
      const to = requireNumber("value", value);
      put(st.setAxis(now(), name, to));
    },

    setAxisRate(axis, rate) {
      const name = requireAxis(axis);
      const at = requireNumber("rate", rate);
      put(st.setAxisRate(now(), name, at));
    },

    setBob(x, y, z) {
      const at = requireVector(["x", "y", "z"], x, y, z);
      put(st.setBob(now(), at));
    },

    setBobVelocity(vx, vy, vz) {
      const v = requireVector(["vx", "vy", "vz"], vx, vy, vz);
      put(st.setBobVelocity(now(), v));
    },

    setLoadPose(index, x, y, z, yaw) {
      const state = now();
      const load = requireIndex("index", index, state.run.loads.length);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      put(st.setLoadPose(state, load, at, turn));
    },

    setLoadPhase(index, phase) {
      const state = now();
      const load = requireIndex("index", index, state.run.loads.length);
      const what = requireOneOf("phase", phase, LOAD_PHASES);
      put(st.setLoadPhase(state, load, what));
    },

    setRunTick(tick) {
      const at = requireWholeNumber("tick", tick);
      put(st.setRunTick(now(), at));
    },

    setSpeedIndex(index) {
      const speed = requireIndex("index", index, RUN_SPEEDS.length);
      put(st.setSpeedIndex(now(), speed));
    },

    // ---- Input ------------------------------------------------------------

    pointerMove(x, y) {
      game.runtime.feedPointerMove(
        requireNumber("x", x),
        requireNumber("y", y),
      );
    },

    pointerDown(x, y) {
      game.runtime.feedPointerDown(
        requireNumber("x", x),
        requireNumber("y", y),
      );
    },

    pointerUp() {
      game.runtime.feedPointerUp();
    },

    touchDown(x, y) {
      game.runtime.feedTouchDown(requireNumber("x", x), requireNumber("y", y));
    },

    touchUp() {
      game.runtime.feedTouchUp();
    },

    keyDown(code) {
      game.runtime.feedKeyDown(requireString("code", code));
    },

    keyUp(code) {
      game.runtime.feedKeyUp(requireString("code", code));
    },
  };
}

declare global {
  interface Window {
    __gantry?: GantryDebugApi;
  }
}

/**
 * Install the surface on `window.__gantry`, which is where every scenario
 * driven from code reaches the game.
 */
export function installDebugSurface(game: Game): GantryDebugApi {
  const api = createDebugSurface(game);
  if (typeof window !== "undefined") window.__gantry = api;
  return api;
}
