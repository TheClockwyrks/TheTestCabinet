// The one place the state's records and `src/sim`'s meet.
//
// `specs/state.md` fixes the state's positions as `{ x, y, z }` objects and the
// open site's loads and obstacles in the shape `src/constants.ts` gives them.
// The simulation works in triples and in the two-corner boxes its collision
// tests compare against. Neither shape is negotiable, so this module is the
// translation, both ways, and nothing else converts.
//
// It also holds the deep copies the transitions rest on. The engine hands every
// reader a `DeepReadonly<GantryState>`, so a transition thaws what it was given
// — a fresh, wholly owned, mutable state — writes the field it is about, and
// returns it. The state it was handed is left exactly as it was.

import type { DeepReadonly } from "@clockwyrks/simple-3d";
import type { Obstacle, SiteLoad } from "./constants";
import { SITES } from "./constants";
import type {
  AxisState,
  CheckResult,
  GantryState,
  LoadState,
  Member,
  MemberForce,
  RaisedCue,
  RunState,
  Score,
  SiteState,
  Step,
  Structure,
  Vec3,
} from "./game";
import {
  idleRun as simIdleRun,
  obstacleBox,
  SIM_SITES,
  type AxisName,
  type Box,
  type CheckResult as SimCheckResult,
  type Member as SimMember,
  type MemberForce as SimMemberForce,
  type RunState as SimRunState,
  type SimSite,
  type SiteLoad as SimSiteLoad,
  type Structure as SimStructure,
  type Tape,
  type Vec3 as SimVec3,
} from "./sim";

/** A position as any reader may hold one: the state's, or a read-only view. */
export interface ReadonlyPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---- Positions -------------------------------------------------------------

/** A position, as the state carries one. */
export const point = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A position's own copy, so neither holder can be changed through the other. */
export const copyPoint = (p: ReadonlyPoint): Vec3 => ({
  x: p.x,
  y: p.y,
  z: p.z,
});

/** The state's position, as the triple the simulation works in. */
export const toSimVec = (p: ReadonlyPoint): SimVec3 => [p.x, p.y, p.z];

/** The simulation's triple, as the position the state carries. */
export const fromSimVec = (v: SimVec3): Vec3 => ({
  x: v[0],
  y: v[1],
  z: v[2],
});

/** Whether two positions name the same point. */
export const samePoint = (a: ReadonlyPoint, b: ReadonlyPoint): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

// ---- The structure ---------------------------------------------------------

export const copyMember = (m: DeepReadonly<Member>): Member => ({
  id: m.id,
  a: copyPoint(m.a),
  b: copyPoint(m.b),
  material: m.material,
});

/** A structure copied deeply enough to be the undo stack's own. */
export const copyStructure = (s: DeepReadonly<Structure>): Structure => ({
  members: s.members.map(copyMember),
  nextMemberId: s.nextMemberId,
  ring: s.ring === null ? null : { corner: copyPoint(s.ring.corner) },
  counterweights: s.counterweights.map(copyPoint),
});

/** An empty crane, which is what a site nothing has been built on carries. */
export const emptyStructure = (): Structure => ({
  members: [],
  nextMemberId: 0,
  ring: null,
  counterweights: [],
});

/** The structure as the simulation reads it; `nextMemberId` is the editor's. */
export const toSimStructure = (s: DeepReadonly<Structure>): SimStructure => ({
  members: s.members.map(toSimMember),
  ring: s.ring === null ? null : { corner: toSimVec(s.ring.corner) },
  counterweights: s.counterweights.map(toSimVec),
});

export const toSimMember = (m: DeepReadonly<Member>): SimMember => ({
  id: m.id,
  a: toSimVec(m.a),
  b: toSimVec(m.b),
  material: m.material,
});

// ---- The tape --------------------------------------------------------------

export const copyStep = (step: DeepReadonly<Step>): Step =>
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

/** The tape as the simulation reads it. */
export const toSimTape = (program: readonly DeepReadonly<Step>[]): Tape =>
  program.map(copyStep);

// ---- The open site ---------------------------------------------------------

export const copyLoad = (load: DeepReadonly<SiteLoad>): SiteLoad => ({
  class: load.class,
  mass: load.mass,
  from: { x: load.from.x, y: load.from.y, z: load.from.z, yaw: load.from.yaw },
  to: { x: load.to.x, y: load.to.y, z: load.to.z, yaw: load.to.yaw },
});

export const copyObstacle = (o: DeepReadonly<Obstacle>): Obstacle => ({
  min: copyPoint(o.min),
  size: copyPoint(o.size),
});

export const copySiteState = (site: DeepReadonly<SiteState>): SiteState => ({
  loads: site.loads.map(copyLoad),
  obstacles: site.obstacles.map(copyObstacle),
});

/** The open site's loads and obstacles, as that site's table authored them. */
export const authoredSiteState = (index: number): SiteState => ({
  loads: SITES[index].loads.map(copyLoad),
  obstacles: SITES[index].obstacles.map(copyObstacle),
});

const toSimLoad = (load: DeepReadonly<SiteLoad>): SimSiteLoad => ({
  cls: load.class,
  mass: load.mass,
  from: {
    pos: [load.from.x, load.from.y, load.from.z],
    yaw: load.from.yaw,
  },
  to: { pos: [load.to.x, load.to.y, load.to.z], yaw: load.to.yaw },
});

/** An obstacle's two corners, from the minimum corner and the size it states. */
export const toSimBox = (o: DeepReadonly<Obstacle>): Box =>
  obstacleBox({ min: copyPoint(o.min), size: copyPoint(o.size) });

/**
 * The open site as the simulation reads it: the fixed table's figures for that
 * index, carrying the loads and obstacles the state is holding, which the site
 * poses of `specs/instrumentation.md` may have replaced.
 */
export const toSimSite = (
  index: number,
  site: DeepReadonly<SiteState>,
): SimSite => ({
  ...SIM_SITES[index],
  loads: site.loads.map(toSimLoad),
  obstacles: site.obstacles.map(toSimBox),
});

// ---- The check -------------------------------------------------------------

const copyForce = (
  f: DeepReadonly<MemberForce> | SimMemberForce,
): MemberForce => ({
  id: f.id,
  force: f.force,
  utilization: f.utilization,
});

export const copyForces = (
  list: readonly (DeepReadonly<MemberForce> | SimMemberForce)[],
): MemberForce[] => list.map(copyForce);

export const copyCheckResult = (
  result: DeepReadonly<CheckResult> | null,
): CheckResult | null =>
  result === null
    ? null
    : {
        issues: [...result.issues],
        cost: result.cost,
        budget: result.budget,
        stable: result.stable,
        members: copyForces(result.members),
      };

/** The simulation's check result, in the shape the state holds. */
export const fromSimCheck = (result: SimCheckResult): CheckResult => ({
  issues: [...result.issues],
  cost: result.cost,
  budget: result.budget,
  stable: result.stable,
  members: copyForces(result.members),
});

// ---- The run ---------------------------------------------------------------

const copyAxis = (a: DeepReadonly<AxisState>): AxisState => ({
  value: a.value,
  rate: a.rate,
  command:
    a.command === null
      ? null
      : { target: a.command.target, rate: a.command.rate },
});

const copyLoadState = (l: DeepReadonly<LoadState>): LoadState => ({
  phase: l.phase,
  pos: copyPoint(l.pos),
  yaw: l.yaw,
});

export const copyRun = (run: DeepReadonly<RunState>): RunState => ({
  phase: run.phase,
  cause: run.cause,
  tick: run.tick,
  speedIndex: run.speedIndex,
  stepIndex: run.stepIndex,
  stepLive: run.stepLive,
  axes: {
    slew: copyAxis(run.axes.slew),
    trolley: copyAxis(run.axes.trolley),
    hoist: copyAxis(run.axes.hoist),
    grip: copyAxis(run.axes.grip),
  },
  pivot: copyPoint(run.pivot),
  bob: { pos: copyPoint(run.bob.pos), vel: copyPoint(run.bob.vel) },
  attached: run.attached,
  loads: run.loads.map(copyLoadState),
  forces: copyForces(run.forces),
  broken: [...run.broken],
  internals: {
    previousPivot: copyPoint(run.internals.previousPivot),
    previousBobVel: copyPoint(run.internals.previousBobVel),
    firstPendulumTick: run.internals.firstPendulumTick,
    brokeThisTick: run.internals.brokeThisTick,
    peakUtilization: run.internals.peakUtilization,
    peakTension: run.internals.peakTension,
    peakRingReaction: run.internals.peakRingReaction,
    accumulator: run.internals.accumulator,
    lastCreakTick: run.internals.lastCreakTick,
  },
});

/**
 * The state's run, as the simulation's.
 *
 * The members a run still solves over are the structure's less the ones broken
 * so far, in the structure's own order, which is exactly what the simulation
 * carries as `intact`; `ringReactions` is written afresh by every tick and read
 * by none, so nothing carries it.
 */
export function toSimRun(
  run: DeepReadonly<RunState>,
  members: readonly SimMember[],
): SimRunState {
  const broken = new Set(run.broken);
  const copy = copyRun(run);
  return {
    phase: copy.phase,
    cause: copy.cause,
    tick: copy.tick,
    stepIndex: copy.stepIndex,
    stepLive: copy.stepLive,
    axes: {
      slew: copy.axes.slew,
      trolley: copy.axes.trolley,
      hoist: copy.axes.hoist,
      grip: copy.axes.grip,
    } as Record<AxisName, AxisState>,
    pivot: toSimVec(copy.pivot),
    previousPivot: toSimVec(copy.internals.previousPivot),
    bob: { pos: toSimVec(copy.bob.pos), vel: toSimVec(copy.bob.vel) },
    previousBobVelocity: toSimVec(copy.internals.previousBobVel),
    firstPendulumTick: copy.internals.firstPendulumTick,
    attached: copy.attached,
    loads: copy.loads.map((l) => ({
      phase: l.phase,
      pos: toSimVec(l.pos),
      yaw: l.yaw,
    })),
    forces: copy.forces,
    broken: copy.broken,
    intact: members.filter((m) => !broken.has(m.id)),
    brokeThisTick: copy.internals.brokeThisTick,
    ringReactions: [],
    peakUtilization: copy.internals.peakUtilization,
    peakTension: copy.internals.peakTension,
    peakRingReaction: copy.internals.peakRingReaction,
  };
}

/** The simulation's run, as the state's, with the run's own bookkeeping kept. */
export function fromSimRun(
  sim: SimRunState,
  speedIndex: number,
  accumulator: number,
  lastCreakTick: number | null,
): RunState {
  return {
    phase: sim.phase,
    cause: sim.cause,
    tick: sim.tick,
    speedIndex,
    stepIndex: sim.stepIndex,
    stepLive: sim.stepLive,
    axes: {
      slew: copyAxis(sim.axes.slew),
      trolley: copyAxis(sim.axes.trolley),
      hoist: copyAxis(sim.axes.hoist),
      grip: copyAxis(sim.axes.grip),
    },
    pivot: fromSimVec(sim.pivot),
    bob: { pos: fromSimVec(sim.bob.pos), vel: fromSimVec(sim.bob.vel) },
    attached: sim.attached,
    loads: sim.loads.map((l) => ({
      phase: l.phase,
      pos: fromSimVec(l.pos),
      yaw: l.yaw,
    })),
    forces: copyForces(sim.forces),
    broken: [...sim.broken],
    internals: {
      previousPivot: fromSimVec(sim.previousPivot),
      previousBobVel: fromSimVec(sim.previousBobVelocity),
      firstPendulumTick: sim.firstPendulumTick,
      brokeThisTick: sim.brokeThisTick,
      peakUtilization: sim.peakUtilization,
      peakTension: sim.peakTension,
      peakRingReaction: sim.peakRingReaction,
      accumulator,
      lastCreakTick,
    },
  };
}

/**
 * The idle placeholder `specs/state.md` fixes: what the run carries before a
 * site's first run, and what opening a site, aborting, and a `reset` put back.
 */
export const idleRun = (): RunState => fromSimRun(simIdleRun(), 0, 0, null);

// ---- The whole state -------------------------------------------------------

const copyScore = (s: DeepReadonly<Score> | null): Score | null =>
  s === null ? null : { cost: s.cost, time: s.time };

const copyCue = (c: DeepReadonly<RaisedCue>): RaisedCue => ({
  cue: c.cue,
  at: c.at === null ? null : copyPoint(c.at),
});

/**
 * A wholly owned, mutable copy of a state handed over read-only. Every
 * transition begins here, so nothing it returns shares a container with what it
 * was given.
 */
export function thaw(state: DeepReadonly<GantryState>): GantryState {
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,
    siteIndex: state.siteIndex,
    cleared: [...state.cleared],
    best: state.best.map(copyScore),
    sites: state.sites.map((entry) => ({
      structure: copyStructure(entry.structure),
      program: entry.program.map(copyStep),
    })),
    site: copySiteState(state.site),
    tool: state.tool,
    pendingNode:
      state.pendingNode === null ? null : copyPoint(state.pendingNode),
    history: state.history.map(copyStructure),
    checkResult: copyCheckResult(state.checkResult),
    camera: { ...state.camera },
    pointer: { ...state.pointer },
    run: copyRun(state.run),
    muted: state.muted,
    simTime: state.simTime,
    cues: state.cues.map(copyCue),
  };
}
