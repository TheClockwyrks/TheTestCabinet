// The debugging and automation surface (`specs/instrumentation.md`).
//
// The game instance's `initialize` returns what this module builds, and the
// engine hands it back from `engine.debug`; nothing is installed on the page.
// Every operation is a reading or a pose acting on the live world at the moment
// of the call. Three rules cover all of them:
//
//  - An argument outside the domain its operation states is invalid and the
//    call fails loudly — an index or a member id nothing carries included, and
//    a coordinate that is not a multiple of `LATTICE_PITCH` where the table
//    names a lattice node.
//  - A pose that stands for something a player does commits through the same
//    rule the player's act passes, so it is refused wherever that act is
//    refused, silently, changing nothing.
//  - Each pose applies on the screens its section names and does nothing on any
//    other.
//
// The clock, the keyboard, the pointer, the camera's projection, and the
// overlay belong to the engine, so nothing here reaches for any of them.
//
// The surface is inert during normal play: nothing here runs until something
// calls it.

import {
  GANTRY_DEBUG_VERSION,
  LATTICE_PITCH,
  RUN_SPEEDS,
  SITE_COUNT,
  TICK_HZ,
} from "./constants";
import { point, simStructure } from "./adapt";
import * as editor from "./editor";
import { menuRects } from "./menus";
import { requestRun } from "./app-tick";
import type { GameIo } from "./io";
import {
  AXIS_NAMES,
  isAxisName,
  isMaterial,
  readiness,
  staticCheck,
  type AxisName,
  type LoadClass,
  type LoadPhase,
  type Material,
  type MemberForce as SimMemberForce,
  type Vec3 as SimVec3,
} from "./sim";
import * as st from "./state";
import type {
  AxisReport,
  AxisState,
  CheckReport,
  GantryDebugApi,
  GantryState,
  LoadReport,
  MemberForceReport,
  Screen,
  Snapshot,
  Step,
} from "./game";
import type { DrawnEntry } from "./render-drawn";
import { lastDrawnEntries } from "./scene";

/** What the surface poses and reads: the live state, and the sound it raises. */
export interface GameAccess {
  /** The world's game state at the moment of the call. */
  state(): GantryState;
  /** The cue bus and the mute bit. */
  io: GameIo;
}

// ---- Domains ---------------------------------------------------------------

/** An argument outside its domain fails loudly rather than being guessed at. */
function invalid(message: string): never {
  throw new Error(`gantry debug: ${message}`);
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
  if (n < 0 || n >= count) invalid(`${name} ${n} is outside 0..${count - 1}`);
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
function requireNode(x: unknown, y: unknown, z: unknown): SimVec3 {
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
): SimVec3 {
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

const forces = (list: readonly SimMemberForce[]): MemberForceReport[] =>
  list.map((f) => ({ id: f.id, force: f.force, utilization: f.utilization }));

const axisReport = (axis: AxisState): AxisReport => ({
  value: axis.value,
  rate: axis.rate,
  command:
    axis.command === null
      ? null
      : { target: axis.command.target, rate: axis.command.rate },
});

const stepReport = (step: Step): Step =>
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
  members: readonly SimMemberForce[];
}): CheckReport => ({
  issues: [...result.issues],
  cost: result.cost,
  budget: result.budget,
  stable: result.stable,
  members: forces(result.members),
});

const loadReport = (
  load: GantryState["site"]["loads"][number],
): LoadReport => ({
  class: load.class,
  mass: load.mass,
  from: { ...load.from },
  to: { ...load.to },
});

// ---- The surface -----------------------------------------------------------

/**
 * Build the surface over the live game. Every operation reads or writes
 * `access.state()`, so a pose takes effect at the call.
 */
export function createDebugSurface(access: GameAccess): GantryDebugApi {
  const now = (): GantryState => access.state();
  const io = access.io;
  const commit = (outcome: editor.EditOutcome): void => {
    if (outcome.cue !== null) io.playCue(outcome.cue);
  };
  const onScreen = (...screens: readonly Screen[]): boolean =>
    screens.includes(now().screen);
  const running = (): boolean => now().run.phase === "running";

  return {
    version: GANTRY_DEBUG_VERSION,

    // ---- Readings ---------------------------------------------------------

    snapshot(): Snapshot {
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
          loads: state.site.loads.map(loadReport),
          obstacles: state.site.obstacles.map((box) => ({
            min: { ...box.min },
            size: { ...box.size },
          })),
        },
        tool: state.tool,
        pendingNode:
          state.pendingNode === null ? null : { ...state.pendingNode },
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
          node: picked.node === null ? null : { ...picked.node },
          member: picked.member,
        },
        structure: {
          members: structure.members.map((m) => ({
            id: m.id,
            a: { ...m.a },
            b: { ...m.b },
            material: m.material,
          })),
          nextMemberId: structure.nextMemberId,
          ring:
            structure.ring === null
              ? null
              : { corner: { ...structure.ring.corner } },
          counterweights: structure.counterweights.map((cw) => ({ ...cw })),
          cost: st.craneCost(state),
          issues: [...readiness(simStructure(structure), site.anchors)],
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
          pivot: { ...run.pivot },
          bob: { pos: { ...run.bob.pos }, vel: { ...run.bob.vel } },
          attached: run.attached,
          loads: run.loads.map((l) => ({
            phase: l.phase,
            pos: { ...l.pos },
            yaw: l.yaw,
          })),
          forces: forces(run.forces),
          broken: [...run.broken],
        },
        muted: state.muted,
        simTime: state.simTime,
      };
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

    drawn(): DrawnEntry[] {
      // What the last frame drew. The frame itself describes what it put on
      // screen, so the reading and the picture cannot disagree
      // (`specs/instrumentation.md`).
      return lastDrawnEntries();
    },

    check(): CheckReport {
      const state = now();
      // Pure: it computes the check and returns it, and displays nothing, so
      // what the build screen is showing is untouched.
      return checkReport(
        staticCheck(
          st.currentSite(state),
          simStructure(st.currentStructure(state)),
          st.currentProgram(state),
        ),
      );
    },

    // ---- The run and the screens -----------------------------------------

    reset() {
      // Every field goes back to its title-screen value bar `muted`, the copy
      // of a bit the game does not own.
      st.resetState(now());
    },

    setScreen(screen) {
      const name = requireString("screen", screen);
      if (!st.isScreen(name)) {
        invalid(`screen must be one of ${st.SCREENS.join(", ")}`);
      }
      st.setScreen(now(), name);
    },

    setMenuIndex(index) {
      const state = now();
      const count = st.menuLength(state);
      // The three screens that show a menu take it; the other four do nothing,
      // whatever the index.
      if (count === 0) {
        requireInteger("index", index);
        return;
      }
      st.setMenuIndex(state, requireIndex("index", index, count));
    },

    openSite(index) {
      // The opening `specs/state.md` fixes and nothing else: the screen is left
      // exactly as it stands, so a caller entering a site from the select
      // screen calls `setScreen("build")` after this.
      const state = now();
      const site = requireIndex("index", index, SITE_COUNT);
      st.openSite(state, site);
    },

    setCleared(index, cleared) {
      const state = now();
      const site = requireIndex("index", index, SITE_COUNT);
      st.setCleared(state, site, requireBoolean("cleared", cleared));
    },

    setBest(index, cost, time) {
      const state = now();
      const site = requireIndex("index", index, SITE_COUNT);
      st.setBest(state, site, {
        cost: requireNumber("cost", cost),
        time: requireNumber("time", time),
      });
    },

    clearBest(index) {
      const state = now();
      st.setBest(state, requireIndex("index", index, SITE_COUNT), null);
    },

    setCamera(yaw, pitch, dist) {
      st.setCamera(
        now(),
        requireNumber("yaw", yaw),
        requireNumber("pitch", pitch),
        requireNumber("dist", dist),
      );
    },

    startRun() {
      if (!onScreen("build", "program")) return;
      requestRun(now(), io);
    },

    abortRun() {
      if (!running()) return;
      st.abortRun(now());
    },

    showCheck() {
      // The `check` action, on the screen the action applies to.
      if (!onScreen("build")) return;
      editor.showCheck(now());
    },

    // ---- The structure ----------------------------------------------------

    clearStructure() {
      if (!onScreen("build")) return;
      commit(editor.clearStructure(now()));
    },

    addMember(ax, ay, az, bx, by, bz, material) {
      const a = requireNode(ax, ay, az);
      const b = requireNode(bx, by, bz);
      const what = requireMaterial(material);
      if (!onScreen("build")) return;
      commit(editor.addMember(now(), a, b, what));
    },

    removeMember(id) {
      const state = now();
      const wanted = requireInteger("id", id);
      if (!st.currentStructure(state).members.some((m) => m.id === wanted)) {
        invalid(`no member carries id ${wanted}`);
      }
      if (!onScreen("build")) return;
      commit(editor.removeMember(state, wanted));
    },

    setRing(x, y, z) {
      const corner = requireNode(x, y, z);
      if (!onScreen("build")) return;
      commit(editor.setRing(now(), corner));
    },

    clearRing() {
      if (!onScreen("build")) return;
      commit(editor.clearRing(now()));
    },

    addCounterweight(x, y, z) {
      const node = requireNode(x, y, z);
      if (!onScreen("build")) return;
      commit(editor.addCounterweight(now(), node));
    },

    removeCounterweight(x, y, z) {
      const node = requireNode(x, y, z);
      if (!onScreen("build")) return;
      commit(editor.removeCounterweight(now(), node));
    },

    setTool(tool) {
      const name = requireString("tool", tool);
      if (!st.isTool(name)) {
        invalid(`tool must be one of ${st.TOOLS.join(", ")}`);
      }
      if (!onScreen("build")) return;
      st.setTool(now(), name);
    },

    setPendingNode(x, y, z) {
      const node = requireNode(x, y, z);
      if (!onScreen("build")) return;
      st.setPendingNode(now(), point(node));
    },

    clearPendingNode() {
      if (!onScreen("build")) return;
      st.clearPendingNode(now());
    },

    // ---- The tape ---------------------------------------------------------

    clearProgram() {
      if (!onScreen("program")) return;
      st.clearProgram(now());
    },

    addMoveStep(axis, target, rate) {
      const name = requireAxis(axis);
      const to = requireNumber("target", target);
      const at = requireNumber("rate", rate);
      if (!onScreen("program")) return;
      st.addMoveStep(now(), name, to, at);
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
      if (!onScreen("program")) return;
      st.addCommand(state, step, name, to, at);
    },

    addActionStep(action) {
      const what = requireOneOf("action", action, [
        "attach",
        "release",
      ] as const);
      if (!onScreen("program")) return;
      st.addActionStep(now(), what);
    },

    removeStep(index) {
      const state = now();
      const step = requireIndex(
        "index",
        index,
        st.currentProgram(state).length,
      );
      if (!onScreen("program")) return;
      st.removeStep(state, step);
    },

    // ---- The site ---------------------------------------------------------

    clearLoads() {
      if (!onScreen("build", "program") || running()) return;
      st.clearLoads(now());
    },

    addLoad(cls, mass, x, y, z, yaw) {
      const what = requireOneOf("cls", cls, LOAD_CLASSES);
      const weight = requireNumber("mass", mass);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      if (!onScreen("build", "program") || running()) return;
      st.addLoad(now(), what, weight, point(at), turn);
    },

    setLoadTarget(index, x, y, z, yaw) {
      const state = now();
      const load = requireIndex("index", index, state.site.loads.length);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      if (!onScreen("build", "program") || running()) return;
      st.setLoadTarget(state, load, point(at), turn);
    },

    clearObstacles() {
      if (!onScreen("build", "program") || running()) return;
      st.clearObstacles(now());
    },

    addObstacle(x, y, z, w, h, d) {
      const min = requireVector(["x", "y", "z"], x, y, z);
      const size = requireVector(["w", "h", "d"], w, h, d);
      if (!onScreen("build", "program") || running()) return;
      st.addObstacle(now(), point(min), point(size));
    },

    // ---- The run in progress ----------------------------------------------

    setAxis(axis, value) {
      const name = requireAxis(axis);
      const to = requireNumber("value", value);
      if (!running()) return;
      st.setAxis(now(), name, to);
    },

    setAxisRate(axis, rate) {
      const name = requireAxis(axis);
      const at = requireNumber("rate", rate);
      if (!running()) return;
      st.setAxisRate(now(), name, at);
    },

    setBob(x, y, z) {
      const at = requireVector(["x", "y", "z"], x, y, z);
      if (!running()) return;
      st.setBob(now(), point(at));
    },

    setBobVelocity(vx, vy, vz) {
      const v = requireVector(["vx", "vy", "vz"], vx, vy, vz);
      if (!running()) return;
      st.setBobVelocity(now(), point(v));
    },

    setLoadPose(index, x, y, z, yaw) {
      const state = now();
      const load = requireIndex("index", index, state.run.loads.length);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      if (!running()) return;
      st.setLoadPose(state, load, point(at), turn);
    },

    setLoadPhase(index, phase) {
      const state = now();
      const load = requireIndex("index", index, state.run.loads.length);
      const what = requireOneOf("phase", phase, LOAD_PHASES);
      if (!running()) return;
      st.setLoadPhase(state, load, what);
    },

    setRunTick(tick) {
      const at = requireWholeNumber("tick", tick);
      if (!running()) return;
      st.setRunTick(now(), at);
    },

    setSpeedIndex(index) {
      const speed = requireIndex("index", index, RUN_SPEEDS.length);
      if (!onScreen("run")) return;
      st.setSpeedIndex(now(), speed);
    },
  };
}
