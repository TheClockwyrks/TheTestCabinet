// The tick pipeline of `specs/program.md`: seven stages, in order, the first
// failure a tick reaches ending the run with that cause and the later stages of
// that tick not running.

import { HOIST_MAX, HOIST_MIN, HOIST_START, TICK_HZ } from "../constants";
import { AXIS_NAMES, startingAxes, stepAxis } from "./axes";
import { startIssues } from "./check";
import { loadBelowGround, loadStrikesAny, segmentStrikesAny } from "./collide";
import { utilization } from "./materials";
import {
  attachCandidate,
  bobAcceleration,
  bobMass,
  cableSnaps,
  cableTension,
  judgeRelease,
  pendulumStep,
  type Bob,
  type RunLoad,
} from "./rigging";
import { classDimensions, classHalfExtents } from "./site";
import { computeGeometry, solveStage } from "./solve";
import {
  memberLength,
  railTrack,
  slewAxis,
  trackLength,
  type RailSpan,
} from "./structure";
import type {
  AxisName,
  AxisState,
  FailCause,
  Member,
  MemberForce,
  Motion,
  SimSite,
  Structure,
  Tape,
  TrolleyPlacement,
} from "./types";
import {
  add,
  DEG,
  length,
  negate,
  nodeKey,
  rotateAboutY,
  scale,
  sub,
  type Vec3,
  ZERO,
} from "./vec";

/**
 * The slack a range test allows, so a target sitting exactly at the track's
 * length is inside the range rather than a hair outside it.
 */
const RANGE_EPS = 1e-9;

/** The whole of one run, as `specs/state.md` describes it. */
export interface RunState {
  phase: "idle" | "running" | "cleared" | "failed";
  cause: FailCause | null;
  /** The run clock is `tick / TICK_HZ` seconds. */
  tick: number;
  stepIndex: number;
  /** Whether the step at `stepIndex` is taken and not yet complete. */
  stepLive: boolean;
  axes: Record<AxisName, AxisState>;
  /** The point the cable hangs from, at the most recent tick's geometry. */
  pivot: Vec3;
  /** The pivot the pendulum reads as the previous one. */
  previousPivot: Vec3;
  bob: Bob;
  previousBobVelocity: Vec3;
  /** No pendulum step has run yet, so the bob's acceleration is zero. */
  firstPendulumTick: boolean;
  attached: number | null;
  loads: RunLoad[];
  /** The latest solve's, over the members still intact, in member-id order. */
  forces: MemberForce[];
  /** The ids broken so far this run, in the order they broke. */
  broken: number[];
  /** The members the run still solves over. */
  intact: readonly Member[];
  /** Whether this tick's cascade broke members — the fact the `break` cue reads. */
  brokeThisTick: boolean;
  /** The latest solve's ring corner reactions, one per corner. */
  ringReactions: readonly Vec3[];
  peakUtilization: number;
  peakTension: number;
  peakRingReaction: number;
}

/** What a run reads: the site, the structure as authored, and the tape. */
export interface RunContext {
  readonly site: SimSite;
  readonly structure: Structure;
  readonly tape: Tape;
}

/** The run clock at a tick, in seconds. */
export const runClock = (tick: number): number => tick / TICK_HZ;

/** The idle placeholder `specs/state.md` fixes. */
export function idleRun(): RunState {
  return {
    phase: "idle",
    cause: null,
    tick: 0,
    stepIndex: 0,
    stepLive: false,
    axes: startingAxes(),
    pivot: ZERO,
    previousPivot: ZERO,
    bob: { pos: ZERO, vel: ZERO },
    previousBobVelocity: ZERO,
    firstPendulumTick: true,
    attached: null,
    loads: [],
    forces: [],
    broken: [],
    intact: [],
    brokeThisTick: false,
    ringReactions: [],
    peakUtilization: 0,
    peakTension: 0,
    peakRingReaction: 0,
  };
}

/**
 * Start a run, or refuse it. Starting is refused when the structure has a
 * readiness issue or the tape is empty; a refused start begins no run.
 */
export function startRun(ctx: RunContext): RunState | null {
  const { site, structure, tape } = ctx;
  if (startIssues(site, structure, tape).length > 0) return null;
  const ring = structure.ring;
  const track = railTrack(structure, site.anchors);
  if (!ring || !track.ok) return null;
  // The run-start posture puts the trolley at the track origin, at slew `0`,
  // and hangs the bob at rest `HOIST_START` below it.
  const pivot = track.origin;
  const run = idleRun();
  run.phase = "running";
  run.pivot = pivot;
  run.previousPivot = pivot;
  run.bob = { pos: [pivot[0], pivot[1] - HOIST_START, pivot[2]], vel: ZERO };
  run.loads = site.loads.map((l) => ({
    phase: "waiting",
    pos: l.from.pos,
    yaw: l.from.yaw,
  }));
  run.intact = structure.members.slice();
  return run;
}

function cloneAxes(
  axes: Record<AxisName, AxisState>,
): Record<AxisName, AxisState> {
  return {
    slew: { ...axes.slew },
    trolley: { ...axes.trolley },
    hoist: { ...axes.hoist },
    grip: { ...axes.grip },
  };
}

/**
 * Advance a run by one tick. A run that has ended is left as it ended.
 *
 * A tick that ends the run counts like any other, whatever stage it reached, so
 * the run clock the run ends on is that tick's own number over `TICK_HZ`.
 */
export function advanceRun(previous: RunState, ctx: RunContext): RunState {
  if (previous.phase !== "running") return previous;
  const { site, structure, tape } = ctx;
  const anchors = site.anchors;
  const run: RunState = {
    ...previous,
    tick: previous.tick + 1,
    axes: cloneAxes(previous.axes),
    loads: previous.loads.map((l) => ({ ...l })),
    broken: [...previous.broken],
    brokeThisTick: false,
  };
  const fail = (cause: FailCause): RunState => {
    run.phase = "failed";
    run.cause = cause;
    return run;
  };
  const standing = (): Structure => ({ ...structure, members: run.intact });

  // ---- stage 1: the tape
  if (run.stepLive) {
    const step = tape[run.stepIndex];
    if (
      step !== undefined &&
      step.kind === "move" &&
      step.commands.every((c) => run.axes[c.axis].command === null)
    ) {
      run.stepLive = false;
      run.stepIndex += 1;
    }
  }
  // A `trolley` command already running is judged again at the top of every
  // tick: the first tick that finds the track no longer reaching its target
  // ends the run, BEFORE any axis moves.
  const liveTrolley = run.axes.trolley.command;
  if (
    liveTrolley !== null &&
    liveTrolley.target > trackLength(standing(), anchors) + RANGE_EPS
  ) {
    return fail("command-out-of-range");
  }
  if (!run.stepLive) {
    if (run.stepIndex >= tape.length) {
      // A tick that finds no live step and no step left to take is the tick the
      // run ends on. It runs none of the stages below.
      const cleared = run.loads.every((l) => l.phase === "placed");
      run.phase = cleared ? "cleared" : "failed";
      run.cause = cleared ? null : "loads-unplaced";
      return run;
    }
    const step = tape[run.stepIndex];
    if (step.kind === "action") {
      if (step.action === "attach") {
        // One load is attached at a time: there is no free hook to attach with.
        if (run.attached !== null) return fail("attach-missed");
        const candidate = attachCandidate(run.loads, run.bob.pos);
        if (candidate === null) return fail("attach-missed");
        run.attached = candidate;
        run.loads[candidate].phase = "attached";
        // The hook seizes the load squarely.
        run.axes.grip.value = run.loads[candidate].yaw;
      } else {
        if (run.attached === null) return fail("release-misplaced");
        const target = site.loads[run.attached].to;
        const judgement = judgeRelease(
          run.loads[run.attached],
          target,
          length(run.bob.vel),
        );
        if (!judgement.placed) {
          // "If any test fails, the load is dropped and `lost`, and the run ends
          // as `release-misplaced`" (specs/rigging.md). The verdict is decided
          // here, but the load still comes off the hook: it leaves the run
          // attached to nothing, at the pose it held when it came off.
          run.loads[run.attached].phase = "lost";
          run.attached = null;
          return fail("release-misplaced");
        }
        run.loads[run.attached].phase = "placed";
        run.loads[run.attached].pos = target.pos;
        run.loads[run.attached].yaw = target.yaw;
        run.attached = null;
      }
      run.stepIndex += 1;
    } else {
      // Whether a target is reachable is judged when its step starts.
      const limit = trackLength(standing(), anchors);
      for (const command of step.commands) {
        if (
          command.axis === "hoist" &&
          (command.target < HOIST_MIN || command.target > HOIST_MAX)
        ) {
          return fail("command-out-of-range");
        }
        if (
          command.axis === "trolley" &&
          (command.target < 0 || command.target > limit + RANGE_EPS)
        ) {
          return fail("command-out-of-range");
        }
        run.axes[command.axis].command = {
          target: command.target,
          rate: command.rate,
        };
      }
      run.stepLive = true;
    }
  }

  // ---- stage 2: axis motion
  const accels: Record<AxisName, number> = {
    slew: 0,
    trolley: 0,
    hoist: 0,
    grip: 0,
  };
  for (const name of AXIS_NAMES) {
    const stepped = stepAxis(run.axes[name], name);
    run.axes[name] = stepped.state;
    accels[name] = stepped.accel;
  }

  // ---- stage 3: geometry
  const ring = structure.ring;
  const track = railTrack(standing(), anchors);
  // Rails that no longer form a track leave the trolley nowhere to run.
  if (!ring || !track.ok) return fail("collapse");
  const axis = slewAxis(ring);
  const cos = Math.cos(run.axes.slew.value * DEG);
  const sin = Math.sin(run.axes.slew.value * DEG);
  const origin = rotateAboutY(track.origin, axis, cos, sin);
  const far = rotateAboutY(track.far, axis, cos, sin);
  const direction = scale(sub(far, origin), 1 / track.length);
  run.previousPivot = run.pivot;
  run.pivot = add(origin, scale(direction, run.axes.trolley.value));

  // The rail member the trolley is on: its position lies between that member's
  // two ends along the track, both ends included.
  const t = run.axes.trolley.value;
  let span: RailSpan = track.spans[0];
  for (const candidate of track.spans) {
    if (t >= candidate.s0 - RANGE_EPS && t <= candidate.s1 + RANGE_EPS) {
      span = candidate;
      break;
    }
  }
  const fraction = (t - span.s0) / (span.s1 - span.s0);
  const trolley: TrolleyPlacement = {
    t,
    nodeA: span.nodeA,
    nodeB: span.nodeB,
    fraction: Math.min(1, Math.max(0, fraction)),
    spanStartById: new Map(track.spans.map((s) => [s.member.id, s.s0])),
  };

  // ---- stage 4: rigging
  const bob = pendulumStep(
    run.bob,
    run.pivot,
    run.previousPivot,
    run.axes.hoist.value,
  );
  const acceleration = bobAcceleration(
    bob.vel,
    run.previousBobVelocity,
    run.firstPendulumTick,
  );
  run.previousBobVelocity = bob.vel;
  run.bob = bob;
  run.firstPendulumTick = false;
  const mass = bobMass(
    run.attached === null ? null : site.loads[run.attached].mass,
  );
  const tension = cableTension(acceleration, mass);
  const tensionMagnitude = length(tension);
  if (tensionMagnitude > run.peakTension) run.peakTension = tensionMagnitude;
  if (cableSnaps(tensionMagnitude)) return fail("cable-snap");
  if (run.attached !== null) {
    // The attached load's lift point is the bob's position, and its yaw is the
    // grip's value.
    run.loads[run.attached].pos = bob.pos;
    run.loads[run.attached].yaw = run.axes.grip.value;
  }

  // ---- stage 5: collisions
  const geometry = computeGeometry(
    standing(),
    run.intact,
    anchors,
    axis,
    run.axes.slew.value,
  );
  for (const m of run.intact) {
    const pa = geometry.positions.get(nodeKey(m.a)) as Vec3;
    const pb = geometry.positions.get(nodeKey(m.b)) as Vec3;
    if (segmentStrikesAny(pa, pb, site.obstacles)) {
      return fail("structure-struck-obstacle");
    }
  }
  if (run.attached !== null) {
    const cls = site.loads[run.attached].cls;
    const half = classHalfExtents(cls);
    if (loadStrikesAny(bob.pos, run.axes.grip.value, half, site.obstacles)) {
      return fail("load-struck-obstacle");
    }
    if (loadBelowGround(bob.pos, classDimensions(cls)[1])) {
      return fail("load-struck-ground");
    }
  } else if (bob.pos[1] < 0) {
    // With no load attached, the hook point below `0` ends the run the same way.
    return fail("load-struck-ground");
  }

  // ---- stage 6: the solves
  const motion: Motion = {
    slew: {
      value: run.axes.slew.value,
      rate: run.axes.slew.rate,
      accel: accels.slew,
    },
    trolley: {
      value: run.axes.trolley.value,
      rate: run.axes.trolley.rate,
      accel: accels.trolley,
    },
  };
  const stage = solveStage(
    standing(),
    anchors,
    axis,
    motion,
    run.intact,
    negate(tension),
    trolley,
  );
  for (const id of stage.brokenAdded) run.broken.push(id);
  run.brokeThisTick = stage.brokenAdded.length > 0;
  run.intact = stage.intact;
  if (!stage.ok) return fail(stage.cause);

  // ---- stage 7: readouts
  run.ringReactions = stage.ringReactions;
  const forces: MemberForce[] = [];
  for (const m of [...run.intact].sort((x, y) => x.id - y.id)) {
    const force = stage.forces.get(m.id) ?? 0;
    const u = utilization(m.material, memberLength(m), force);
    forces.push({ id: m.id, force, utilization: u });
    if (u > run.peakUtilization) run.peakUtilization = u;
  }
  run.forces = forces;
  for (const r of stage.ringReactions) {
    const magnitude = length(r);
    if (magnitude > run.peakRingReaction) run.peakRingReaction = magnitude;
  }
  return run;
}

/**
 * Play a whole run, for a test or a validator: `null` when the start is refused,
 * otherwise the run as it ended. `maxTicks` bounds the wait, and a run that has
 * not ended by then comes back still `running`.
 */
export function playRun(
  ctx: RunContext,
  maxTicks = TICK_HZ * 900,
): RunState | null {
  let run = startRun(ctx);
  if (run === null) return null;
  for (let i = 0; i < maxTicks && run.phase === "running"; i++) {
    run = advanceRun(run, ctx);
  }
  return run;
}
