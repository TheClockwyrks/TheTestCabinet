// The debug and automation surface (`specs/instrumentation.md`).
//
// Every operation is a reading or a pose of `GantryState`, written in the shape
// of `update`: the current state first, then the parameters its table names. A
// pose returns the next state, built from the one it was handed, which it
// leaves as it was; a reading returns what it read. The engine returns the
// surface from `engine.debug`, and it is reached that way alone.
//
// Three rules cover all of them:
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
// The clock, the input, and the projection are the engine's, so no operation
// here reaches one. The surface is inert during normal play: nothing here runs
// until something calls it.

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
  type LoadClass,
} from "./constants";
import {
  copyForces,
  copyStep,
  fromSimCheck,
  fromSimVec,
  point,
  thaw,
  type ReadonlyPoint,
} from "./convert";
import type {
  AxisReport,
  CheckReport,
  GantryDebugApi,
  GantryState,
  LoadPhase,
  MaterialName,
  MemberForce,
  PointReport,
  Snapshot,
  Tool,
} from "./game";
import { pick } from "./pick";
import * as edits from "./edits";
import {
  AXIS_NAMES,
  cost as structureCost,
  isAxisName,
  isMaterial,
  readiness,
  staticCheck,
  type AxisName,
} from "./sim";
import * as st from "./state";
import { menuRects } from "./menus";
import { lastDrawnEntries } from "./render";
import type { DrawnEntry } from "./render-drawn";

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
function requireNode(x: unknown, y: unknown, z: unknown): ReadonlyPoint {
  const at = point(
    requireNumber("x", x),
    requireNumber("y", y),
    requireNumber("z", z),
  );
  for (const c of [at.x, at.y, at.z]) {
    if (c % LATTICE_PITCH !== 0) {
      invalid(`(${at.x}, ${at.y}, ${at.z}) is not a lattice node`);
    }
  }
  return at;
}

function requireVector(
  names: readonly [string, string, string],
  x: unknown,
  y: unknown,
  z: unknown,
): ReadonlyPoint {
  return point(
    requireNumber(names[0], x),
    requireNumber(names[1], y),
    requireNumber(names[2], z),
  );
}

function requireAxis(value: unknown): AxisName {
  const s = requireString("axis", value);
  if (!isAxisName(s)) invalid(`axis must be one of ${AXIS_NAMES.join(", ")}`);
  return s;
}

function requireMaterial(value: unknown): MaterialName {
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

const report = (p: ReadonlyPoint): PointReport => ({ x: p.x, y: p.y, z: p.z });

const axisReport = (axis: {
  readonly value: number;
  readonly rate: number;
  readonly command: { readonly target: number; readonly rate: number } | null;
}): AxisReport => ({
  value: axis.value,
  rate: axis.rate,
  command:
    axis.command === null
      ? null
      : { target: axis.command.target, rate: axis.command.rate },
});

const forceReports = (
  list: readonly {
    readonly id: number;
    readonly force: number;
    readonly utilization: number;
  }[],
): MemberForce[] => copyForces(list);

const checkReport = (result: {
  readonly issues: readonly string[];
  readonly cost: number;
  readonly budget: number;
  readonly stable: boolean;
  readonly members: readonly {
    readonly id: number;
    readonly force: number;
    readonly utilization: number;
  }[];
}): CheckReport => ({
  issues: [...result.issues],
  cost: result.cost,
  budget: result.budget,
  stable: result.stable,
  members: forceReports(result.members),
});

// ---- The surface -----------------------------------------------------------

// NO REACH PREDICATES HERE. Which screen is showing, whether a run is in
// progress, and which tool is selected are how a PLAYER reaches a control, and
// `specs/instrumentation.md` (The operations) says they are not an operation's
// conditions: every operation below acts from wherever the game stands. What
// stays is each edit's own rule — the editor's placement rules, the tape
// editor's, and the run's readiness — because those are the edit rather than a
// gate on reaching it.

/**
 * The surface, built once in `initialize` and returned beside the state.
 *
 * It holds nothing of its own: every operation reads or rebuilds the state it
 * is handed, so it reports the state the engine holds at the instant it is
 * called.
 */
export function createDebugSurface(): GantryDebugApi {
  return {
    version: GANTRY_DEBUG_VERSION,

    // ---- Readings ---------------------------------------------------------

    snapshot(state): Snapshot {
      const site = st.currentSite(state);
      const structure = state.sites[state.siteIndex].structure;
      const simStructure = st.currentSimStructure(state);
      const run = state.run;
      const picked = pick(state);
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
            min: report(fromSimVec(site.envelope.min)),
            max: report(fromSimVec(site.envelope.max)),
          },
          anchors: site.anchors.map((a) => report(fromSimVec(a))),
          budget: site.budget,
          par: { cost: site.par.cost, time: site.par.time },
          loads: state.site.loads.map((l) => ({
            class: l.class,
            mass: l.mass,
            from: { x: l.from.x, y: l.from.y, z: l.from.z, yaw: l.from.yaw },
            to: { x: l.to.x, y: l.to.y, z: l.to.z, yaw: l.to.yaw },
          })),
          obstacles: state.site.obstacles.map((o) => ({
            min: report(o.min),
            size: report(o.size),
          })),
        },
        tool: state.tool,
        pendingNode:
          state.pendingNode === null ? null : report(state.pendingNode),
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
          node: picked.node === null ? null : report(picked.node),
          member: picked.member,
        },
        structure: {
          members: structure.members.map((m) => ({
            id: m.id,
            a: report(m.a),
            b: report(m.b),
            material: m.material,
          })),
          nextMemberId: structure.nextMemberId,
          ring:
            structure.ring === null
              ? null
              : { corner: report(structure.ring.corner) },
          counterweights: structure.counterweights.map(report),
          cost: structureCost(simStructure),
          issues: [...readiness(simStructure, site.anchors)],
        },
        program: state.sites[state.siteIndex].program.map(copyStep),
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
          pivot: report(run.pivot),
          bob: { pos: report(run.bob.pos), vel: report(run.bob.vel) },
          attached: run.attached,
          loads: run.loads.map((l) => ({
            phase: l.phase,
            pos: report(l.pos),
            yaw: l.yaw,
          })),
          forces: forceReports(run.forces),
          broken: [...run.broken],
        },
        muted: state.muted,
        simTime: state.simTime,
      };
    },

    menuItemRect(state, index) {
      // A menu entry's region is only a reading where a menu is showing, so a
      // screen with none and an index the menu has no entry at are both
      // outside the domain (`specs/instrumentation.md`).
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

    check(state): CheckReport {
      // Pure: it computes the check and returns it, and displays nothing, so
      // what the build screen is showing is untouched.
      return checkReport(
        fromSimCheck(
          staticCheck(
            st.currentSite(state),
            st.currentSimStructure(state),
            st.currentTape(state),
          ),
        ),
      );
    },

    // ---- The run and the screens -----------------------------------------

    reset(state): GantryState {
      // Every field goes back to its title-screen value bar `muted`, the copy
      // of a bit the game does not own.
      const s = st.titleState();
      s.muted = state.muted;
      return s;
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
     * is what it comes to in a build that does not: the state it was handed,
     * thawed and returned unchanged.
     */
    reconcile(state): GantryState {
      return thaw(state);
    },

    setScreen(state, screen): GantryState {
      const name = requireString("screen", screen);
      if (!st.isScreen(name)) {
        invalid(`screen must be one of ${st.SCREENS.join(", ")}`);
      }
      return st.setScreen(state, name);
    },

    setMenuIndex(state, index): GantryState {
      const count = st.menuLength(state);
      // The domain is the entry count of the menu the screen showing carries. A
      // screen carrying none has no entry to name, so there is no defined state
      // to reach and the call fails loudly rather than passing quietly.
      if (count === 0) {
        requireInteger("index", index);
        invalid(`the ${state.screen} screen carries no menu`);
      }
      return st.setMenuIndex(state, requireIndex("index", index, count));
    },

    openSite(state, index): GantryState {
      // The opening `specs/state.md` fixes and nothing else: the screen is left
      // exactly as it stands, so a caller entering a site from the select
      // screen calls `setScreen(s, "build")` after this.
      const site = requireIndex("index", index, SITE_COUNT);
      return st.openSite(state, site);
    },

    setCleared(state, index, cleared): GantryState {
      const site = requireIndex("index", index, SITE_COUNT);
      return st.setCleared(state, site, requireBoolean("cleared", cleared));
    },

    setBest(state, index, cost, time): GantryState {
      const site = requireIndex("index", index, SITE_COUNT);
      return st.setBest(state, site, {
        cost: requireNumber("cost", cost),
        time: requireNumber("time", time),
      });
    },

    clearBest(state, index): GantryState {
      return st.setBest(state, requireIndex("index", index, SITE_COUNT), null);
    },

    setCamera(state, yaw, pitch, dist): GantryState {
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
      return st.setCamera(state, turn, tilt, away);
    },

    startRun(state): GantryState {
      return st.beginRun(state) ?? thaw(state);
    },

    abortRun(state): GantryState {
      return st.abortRun(state);
    },

    showCheck(state): GantryState {
      // The `check` action, from wherever the game stands.
      return edits.showCheck(state);
    },

    // ---- The structure ----------------------------------------------------

    clearStructure(state): GantryState {
      return edits.clearStructure(state).state;
    },

    addMember(state, ax, ay, az, bx, by, bz, material): GantryState {
      const a = requireNode(ax, ay, az);
      const b = requireNode(bx, by, bz);
      const what = requireMaterial(material);
      return edits.addMember(state, a, b, what).state;
    },

    removeMember(state, id): GantryState {
      const wanted = requireInteger("id", id);
      const members = state.sites[state.siteIndex].structure.members;
      if (!members.some((m) => m.id === wanted)) {
        invalid(`no member carries id ${wanted}`);
      }
      return edits.removeMember(state, wanted).state;
    },

    setRing(state, x, y, z): GantryState {
      const corner = requireNode(x, y, z);
      return edits.setRing(state, corner).state;
    },

    clearRing(state): GantryState {
      return edits.clearRing(state).state;
    },

    addCounterweight(state, x, y, z): GantryState {
      const node = requireNode(x, y, z);
      return edits.addCounterweight(state, node).state;
    },

    removeCounterweight(state, x, y, z): GantryState {
      const node = requireNode(x, y, z);
      return edits.removeCounterweight(state, node).state;
    },

    setTool(state, tool): GantryState {
      const name = requireString("tool", tool);
      if (!st.isTool(name)) {
        invalid(`tool must be one of ${st.TOOLS.join(", ")}`);
      }
      return st.setTool(state, name as Tool);
    },

    setPendingNode(state, x, y, z): GantryState {
      const node = requireNode(x, y, z);
      return st.setPendingNode(state, node);
    },

    clearPendingNode(state): GantryState {
      return st.clearPendingNode(state);
    },

    // ---- The tape ---------------------------------------------------------

    clearProgram(state): GantryState {
      return st.clearProgram(state);
    },

    addMoveStep(state, axis, target, rate): GantryState {
      const name = requireAxis(axis);
      const to = requireNumber("target", target);
      const at = requireNumber("rate", rate);
      return st.addMoveStep(state, name, to, at);
    },

    addCommand(state, index, axis, target, rate): GantryState {
      const step = requireIndex(
        "index",
        index,
        state.sites[state.siteIndex].program.length,
      );
      const name = requireAxis(axis);
      const to = requireNumber("target", target);
      const at = requireNumber("rate", rate);
      return st.addCommand(state, step, name, to, at);
    },

    addActionStep(state, action): GantryState {
      const what = requireOneOf("action", action, [
        "attach",
        "release",
      ] as const);
      return st.addActionStep(state, what);
    },

    removeStep(state, index): GantryState {
      const step = requireIndex(
        "index",
        index,
        state.sites[state.siteIndex].program.length,
      );
      return st.removeStep(state, step);
    },

    // ---- The site ---------------------------------------------------------

    clearLoads(state): GantryState {
      return st.clearLoads(state);
    },

    addLoad(state, cls, mass, x, y, z, yaw): GantryState {
      const what = requireOneOf("cls", cls, LOAD_CLASSES);
      const weight = requireNumber("mass", mass);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      return st.addLoad(state, what, weight, at, turn);
    },

    setLoadTarget(state, index, x, y, z, yaw): GantryState {
      const load = requireIndex("index", index, state.site.loads.length);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      return st.setLoadTarget(state, load, at, turn);
    },

    clearObstacles(state): GantryState {
      return st.clearObstacles(state);
    },

    addObstacle(state, x, y, z, w, h, d): GantryState {
      const min = requireVector(["x", "y", "z"], x, y, z);
      const size = requireVector(["w", "h", "d"], w, h, d);
      return st.addObstacle(state, min, size);
    },

    // ---- The run in progress ----------------------------------------------

    setAxis(state, axis, value): GantryState {
      const name = requireAxis(axis);
      const to = requireNumber("value", value);
      return st.setAxis(state, name, to);
    },

    setAxisRate(state, axis, rate): GantryState {
      const name = requireAxis(axis);
      const at = requireNumber("rate", rate);
      return st.setAxisRate(state, name, at);
    },

    setBob(state, x, y, z): GantryState {
      const at = requireVector(["x", "y", "z"], x, y, z);
      return st.setBob(state, at);
    },

    setBobVelocity(state, vx, vy, vz): GantryState {
      const v = requireVector(["vx", "vy", "vz"], vx, vy, vz);
      return st.setBobVelocity(state, v);
    },

    setLoadPose(state, index, x, y, z, yaw): GantryState {
      const load = requireIndex("index", index, state.run.loads.length);
      const at = requireVector(["x", "y", "z"], x, y, z);
      const turn = requireNumber("yaw", yaw);
      return st.setLoadPose(state, load, at, turn);
    },

    setLoadPhase(state, index, phase): GantryState {
      const load = requireIndex("index", index, state.run.loads.length);
      const what = requireOneOf("phase", phase, LOAD_PHASES);
      return st.setLoadPhase(state, load, what);
    },

    setSpeedIndex(state, index): GantryState {
      const speed = requireIndex("index", index, RUN_SPEEDS.length);
      return st.setSpeedIndex(state, speed);
    },
  };
}
