// Between the shapes `specs/state.md` declares and the shapes `src/sim` works
// in.
//
// The state holds a position as `{ x, y, z }`, because that is the declaration
// the specification fixes and the shape the snapshot reports; the simulation
// holds one as the triple `[x, y, z]`. Nothing here decides anything: it copies
// values across that seam, one direction per function, and every copy is deep
// enough that neither side can be changed through the other.

import { obstacleBox, SIM_SITES } from "./sim";
import type {
  AxisName,
  AxisState as SimAxisState,
  Box,
  Member as SimMember,
  MemberForce as SimMemberForce,
  RunLoad,
  RunState as SimRunState,
  SimSite,
  SiteLoad as SimSiteLoad,
  Structure as SimStructure,
  Vec3 as SimVec3,
} from "./sim";
import type { Obstacle, SiteLoad } from "./constants";
import type {
  GameRun,
  LoadState,
  MemberForce,
  SiteState,
  Structure,
  Vec3,
} from "./game";

// ---- Positions -------------------------------------------------------------

/** A simulation triple as the state and the snapshot carry a position. */
export const point = (p: SimVec3): Vec3 => ({ x: p[0], y: p[1], z: p[2] });

/** A state position as the simulation carries one. */
export const triple = (p: Vec3): SimVec3 => [p.x, p.y, p.z];

/** A position the caller owns. */
export const copyPoint = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });

// ---- The site --------------------------------------------------------------

/** One of the open site's loads, copied all the way down. */
export const copyLoad = (load: SiteLoad): SiteLoad => ({
  class: load.class,
  mass: load.mass,
  from: { ...load.from },
  to: { ...load.to },
});

/** One of the open site's obstacles, copied all the way down. */
export const copyObstacle = (box: Obstacle): Obstacle => ({
  min: { ...box.min },
  size: { ...box.size },
});

/** A load as the simulation reads one. */
export const simLoad = (load: SiteLoad): SimSiteLoad => ({
  cls: load.class,
  mass: load.mass,
  from: { pos: [load.from.x, load.from.y, load.from.z], yaw: load.from.yaw },
  to: { pos: [load.to.x, load.to.y, load.to.z], yaw: load.to.yaw },
});

/** An obstacle as the collision tests read one: its two corners. */
export const simObstacle = (box: Obstacle): Box => obstacleBox(box);

/**
 * The open site as the simulation reads it: the fixed table's figures for this
 * index, carrying the loads and obstacles the state is holding, which the site
 * poses of `specs/instrumentation.md` may have replaced.
 */
export function simSite(index: number, site: SiteState): SimSite {
  return {
    ...SIM_SITES[index],
    loads: site.loads.map(simLoad),
    obstacles: site.obstacles.map(simObstacle),
  };
}

// ---- The structure ---------------------------------------------------------

/** The open crane as the simulation reads it. */
export function simStructure(structure: Structure): SimStructure {
  return {
    members: structure.members.map(simMember),
    ring:
      structure.ring === null
        ? null
        : { corner: triple(structure.ring.corner) },
    counterweights: structure.counterweights.map(triple),
  };
}

/** One member as the simulation reads it. */
export const simMember = (m: Structure["members"][number]): SimMember => ({
  id: m.id,
  a: triple(m.a),
  b: triple(m.b),
  material: m.material,
});

/** One member as the state carries it. */
export const stateMember = (m: SimMember): Structure["members"][number] => ({
  id: m.id,
  a: point(m.a),
  b: point(m.b),
  material: m.material,
});

// ---- The run ---------------------------------------------------------------

const forces = (list: readonly SimMemberForce[]): MemberForce[] =>
  list.map((f) => ({ id: f.id, force: f.force, utilization: f.utilization }));

const runLoads = (list: readonly LoadState[]): RunLoad[] =>
  list.map((l) => ({ phase: l.phase, pos: triple(l.pos), yaw: l.yaw }));

const stateLoads = (list: readonly RunLoad[]): LoadState[] =>
  list.map((l) => ({ phase: l.phase, pos: point(l.pos), yaw: l.yaw }));

const axes = (run: GameRun): Record<AxisName, SimAxisState> => ({
  slew: { ...run.axes.slew },
  trolley: { ...run.axes.trolley },
  hoist: { ...run.axes.hoist },
  grip: { ...run.axes.grip },
});

/**
 * The run as the simulation's tick reads it: the declared fields of
 * `specs/state.md` beside the per-tick bookkeeping the state carries for it.
 */
export function simRun(run: GameRun): SimRunState {
  return {
    phase: run.phase,
    cause: run.cause,
    tick: run.tick,
    stepIndex: run.stepIndex,
    stepLive: run.stepLive,
    axes: axes(run),
    pivot: triple(run.pivot),
    previousPivot: triple(run.previousPivot),
    bob: { pos: triple(run.bob.pos), vel: triple(run.bob.vel) },
    previousBobVelocity: triple(run.previousBobVelocity),
    firstPendulumTick: run.firstPendulumTick,
    attached: run.attached,
    loads: runLoads(run.loads),
    forces: forces(run.forces),
    broken: [...run.broken],
    intact: run.intact,
    brokeThisTick: run.brokeThisTick,
    ringReactions: run.ringReactions,
    peakUtilization: run.peakUtilization,
    peakTension: run.peakTension,
    peakRingReaction: run.peakRingReaction,
  };
}

/**
 * Write what a tick produced back onto the live run, in place: the state is the
 * engine's own object and a tick advances the fields it moves rather than
 * replacing it. The watch speed, the accumulator, and the creak cooldown belong
 * to the frame loop rather than to the tick, so they are left as they stand.
 */
export function writeRun(run: GameRun, sim: SimRunState): void {
  run.phase = sim.phase;
  run.cause = sim.cause;
  run.tick = sim.tick;
  run.stepIndex = sim.stepIndex;
  run.stepLive = sim.stepLive;
  run.axes.slew = { ...sim.axes.slew };
  run.axes.trolley = { ...sim.axes.trolley };
  run.axes.hoist = { ...sim.axes.hoist };
  run.axes.grip = { ...sim.axes.grip };
  run.pivot = point(sim.pivot);
  run.previousPivot = point(sim.previousPivot);
  run.bob = { pos: point(sim.bob.pos), vel: point(sim.bob.vel) };
  run.previousBobVelocity = point(sim.previousBobVelocity);
  run.firstPendulumTick = sim.firstPendulumTick;
  run.attached = sim.attached;
  run.loads = stateLoads(sim.loads);
  run.forces = forces(sim.forces);
  run.broken = [...sim.broken];
  run.intact = sim.intact;
  run.brokeThisTick = sim.brokeThisTick;
  run.ringReactions = sim.ringReactions;
  run.peakUtilization = sim.peakUtilization;
  run.peakTension = sim.peakTension;
  run.peakRingReaction = sim.peakRingReaction;
}
