// The two solves of `specs/statics.md`, the ring transfer between them, the
// slack-cable iteration inside each, and the breakage cascade that follows.

import { RING_CAP } from "../constants";
import { assembleArmForces, assembleTowerForces, lumpedMasses } from "./loads";
import { MATERIALS, utilization } from "./materials";
import {
  memberLength,
  partition,
  railTrack,
  type RailTrackResult,
} from "./structure";
import { stiffnessSolve, type SolveMember } from "./stiffness";
import type {
  FailCause,
  Member,
  Motion,
  Structure,
  TrolleyPlacement,
} from "./types";
import {
  type Axis2,
  DEG,
  length,
  nodeKey,
  parseNodeKey,
  rotateAboutY,
  scale,
  sub,
  type Vec3,
} from "./vec";

/** The prescribed geometry at a tick: what stands where, and the track. */
export interface TickGeometry {
  readonly cos: number;
  readonly sin: number;
  readonly towerSet: ReadonlySet<string>;
  readonly armSet: ReadonlySet<string>;
  readonly bottom: readonly Vec3[];
  readonly top: readonly Vec3[];
  readonly track: RailTrackResult;
  /** Every node the solves touch, at the position it stands at this tick. */
  readonly positions: ReadonlyMap<string, Vec3>;
}

/**
 * The prescribed geometry: tower nodes at their lattice positions, arm nodes
 * turned about the slew axis by the slew angle, and nothing else moving them.
 */
export function computeGeometry(
  structure: Structure,
  intact: readonly Member[],
  anchors: readonly Vec3[],
  axis: Axis2,
  slewValue: number,
): TickGeometry {
  const cos = Math.cos(slewValue * DEG);
  const sin = Math.sin(slewValue * DEG);
  const standing: Structure = { ...structure, members: intact };
  const { towerSet, armSet, bottom, top } = partition(standing, anchors);
  const track = railTrack(standing, anchors);
  const keys = new Set<string>();
  for (const m of intact) {
    keys.add(nodeKey(m.a));
    keys.add(nodeKey(m.b));
  }
  for (const n of [...bottom, ...top]) keys.add(nodeKey(n));
  for (const n of anchors) keys.add(nodeKey(n));
  const positions = new Map<string, Vec3>();
  for (const k of keys) {
    const p = parseNodeKey(k);
    positions.set(
      k,
      armSet.has(k) && !towerSet.has(k) ? rotateAboutY(p, axis, cos, sin) : p,
    );
  }
  return { cos, sin, towerSet, armSet, bottom, top, track, positions };
}

interface System {
  readonly nodeCount: number;
  readonly index: Map<string, number>;
  readonly members: SolveMember[];
  readonly supports: Set<number>;
  readonly forces: Float64Array;
}

/**
 * The canonical node order the factorization eliminates in: ascending LATTICE
 * position, by `x`, then `y`, then `z`. Arm nodes are ordered by their lattice
 * positions and NOT by where the slew angle stands them, so the order is the
 * same at every angle.
 */
export function canonicalNodeOrder(keys: Iterable<string>): string[] {
  return [...keys]
    .map(parseNodeKey)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    .map(nodeKey);
}

function buildSystem(
  keys: Iterable<string>,
  members: readonly Member[],
  supportKeys: readonly string[],
  positions: ReadonlyMap<string, Vec3>,
): Omit<System, "forces"> {
  const order = canonicalNodeOrder(keys);
  const index = new Map<string, number>(order.map((k, i) => [k, i]));
  const solveMembers = members.map((m): SolveMember => {
    const pa = positions.get(nodeKey(m.a)) as Vec3;
    const pb = positions.get(nodeKey(m.b)) as Vec3;
    const d = sub(pb, pa);
    const l = length(d);
    return {
      id: m.id,
      material: m.material,
      ia: index.get(nodeKey(m.a)) as number,
      ib: index.get(nodeKey(m.b)) as number,
      ea: MATERIALS[m.material].ea,
      length: l,
      direction: scale(d, 1 / l),
      isCable: MATERIALS[m.material].isCable,
    };
  });
  const supports = new Set<number>();
  for (const k of supportKeys) {
    const i = index.get(k);
    if (i !== undefined) supports.add(i);
  }
  return { nodeCount: order.length, index, members: solveMembers, supports };
}

interface SlackSingular {
  readonly singular: true;
  readonly dof: number;
}

interface SlackSolved {
  readonly singular: false;
  readonly forces: Map<number, number>;
  readonly reactions: Map<number, Vec3>;
}

/**
 * The slack-cable fixed point: solve with every candidate cable present, drop
 * every cable whose force comes back negative, and solve again with the
 * remainder, until a solve marks no new cable slack. A dropped cable carries
 * zero force; it still hangs there and still weighs, so the masses and the
 * applied forces are fixed before the iteration and unchanged by it.
 */
function solveSlack(system: System): SlackSingular | SlackSolved {
  const slack = new Set<number>();
  for (let iteration = 0; iteration <= system.members.length + 1; iteration++) {
    const active = system.members.filter((m) => !slack.has(m.id));
    const result = stiffnessSolve(
      system.nodeCount,
      active,
      system.supports,
      system.forces,
    );
    if (result.singular) return { singular: true, dof: result.dof };
    let added = false;
    for (let i = 0; i < active.length; i++) {
      if (active[i].isCable && result.forces[i] < 0) {
        slack.add(active[i].id);
        added = true;
      }
    }
    if (added) continue;
    const forces = new Map<number, number>();
    for (let i = 0; i < active.length; i++)
      forces.set(active[i].id, result.forces[i]);
    for (const id of slack) forces.set(id, 0);
    return { singular: false, forces, reactions: result.reactions };
  }
  // Each pass that does not return drops at least one cable, so this is not
  // reachable; a system that somehow oscillates is a mechanism.
  return { singular: true, dof: -1 };
}

export interface SolvePairFailure {
  readonly ok: false;
  readonly cause: Extract<FailCause, "collapse" | "ring-overload">;
  readonly where: "arm" | "tower" | "ring";
  readonly geometry: TickGeometry;
}

export interface SolvePairSuccess {
  readonly ok: true;
  /** By member id, over every member in either solve. */
  readonly forces: ReadonlyMap<number, number>;
  readonly geometry: TickGeometry;
  /** One per ring corner, in flange order. */
  readonly ringReactions: readonly Vec3[];
  /** Whether a corner exceeded `RING_CAP`, whether or not that was checked. */
  readonly ringOver: boolean;
  /** The tower solve's own reactions, one per anchor, in the site's order. */
  readonly anchorReactions: readonly Vec3[];
}

export type SolvePairResult = SolvePairFailure | SolvePairSuccess;

export interface SolvePairOptions {
  /**
   * Run the pair without the `RING_CAP` check between the two solves. The
   * editor's static check needs it: nothing fails during a check, so a static
   * ring reaction over the cap is reported and no more (`specs/structure.md`).
   */
  readonly ignoreRingCap?: boolean;
}

/**
 * One tick's pair of solves: the arm solve, the ring check on the reactions it
 * reads back, then the tower solve — the fixed order `specs/statics.md` gives,
 * the first of them to fail ending the run.
 */
export function solvePair(
  structure: Structure,
  anchors: readonly Vec3[],
  axis: Axis2,
  motion: Motion,
  intact: readonly Member[],
  cableForce: Vec3,
  trolley: TrolleyPlacement | null,
  options: SolvePairOptions = {},
): SolvePairResult {
  const geometry = computeGeometry(
    structure,
    intact,
    anchors,
    axis,
    motion.slew.value,
  );
  const { armSet, towerSet, bottom, top, positions, track } = geometry;
  const flangeKeys = [...bottom, ...top].map(nodeKey);
  const masses = lumpedMasses(structure, intact, flangeKeys);

  const omega = motion.slew.rate * DEG;
  const alpha = motion.slew.accel * DEG;

  const armMembers = intact.filter(
    (m) => armSet.has(nodeKey(m.a)) || armSet.has(nodeKey(m.b)),
  );
  const armIds = new Set(armMembers.map((m) => m.id));
  const towerMembers = intact.filter(
    (m) =>
      (towerSet.has(nodeKey(m.a)) || towerSet.has(nodeKey(m.b))) &&
      !armIds.has(m.id),
  );

  // ---- the arm solve
  const armKeys = new Set<string>(top.map(nodeKey));
  for (const m of armMembers) {
    armKeys.add(nodeKey(m.a));
    armKeys.add(nodeKey(m.b));
  }
  const armBase = buildSystem(armKeys, armMembers, top.map(nodeKey), positions);
  const armSystem: System = {
    ...armBase,
    forces: assembleArmForces({
      index: armBase.index,
      positions,
      masses,
      axis,
      omega,
      alpha,
      cos: geometry.cos,
      sin: geometry.sin,
      track: track.ok ? track : null,
      trolley: track.ok ? trolley : null,
      trolleyRate: motion.trolley.rate,
      trolleyAccel: motion.trolley.accel,
      cableForce,
    }),
  };
  const armResult = solveSlack(armSystem);
  if (armResult.singular) {
    return { ok: false, cause: "collapse", where: "arm", geometry };
  }

  // ---- the ring transfer: each corner's top-flange reaction, by ring index
  const ringReactions: Vec3[] = [];
  for (let i = 0; i < top.length; i++) {
    const ti = armSystem.index.get(nodeKey(top[i]));
    const r = ti === undefined ? undefined : armResult.reactions.get(ti);
    ringReactions.push(r ?? [0, 0, 0]);
  }
  let ringOver = false;
  for (const r of ringReactions) if (length(r) > RING_CAP) ringOver = true;
  if (ringOver && !options.ignoreRingCap) {
    return { ok: false, cause: "ring-overload", where: "ring", geometry };
  }

  // ---- the tower solve
  const towerKeys = new Set<string>([
    ...bottom.map(nodeKey),
    ...anchors.map(nodeKey),
  ]);
  for (const m of towerMembers) {
    towerKeys.add(nodeKey(m.a));
    towerKeys.add(nodeKey(m.b));
  }
  const towerBase = buildSystem(
    towerKeys,
    towerMembers,
    anchors.map(nodeKey),
    positions,
  );
  const towerSystem: System = {
    ...towerBase,
    forces: assembleTowerForces(towerBase.index, masses, bottom, ringReactions),
  };
  const towerResult = solveSlack(towerSystem);
  if (towerResult.singular) {
    return { ok: false, cause: "collapse", where: "tower", geometry };
  }

  const anchorReactions = anchors.map((a): Vec3 => {
    const i = towerSystem.index.get(nodeKey(a));
    const r = i === undefined ? undefined : towerResult.reactions.get(i);
    return r ?? [0, 0, 0];
  });

  const forces = new Map<number, number>([
    ...armResult.forces,
    ...towerResult.forces,
  ]);
  return {
    ok: true,
    forces,
    geometry,
    ringReactions,
    ringOver,
    anchorReactions,
  };
}

/**
 * Whether a rail among the members just broken takes the track out from under
 * the trolley: the trolley is ON the broken member or BEYOND it, its position
 * at or past that member's end nearer the track origin. A break outboard of the
 * trolley simply shortens the track.
 */
export function railBreakTakesTrack(
  trolley: TrolleyPlacement | null,
  broken: readonly Member[],
): boolean {
  if (!trolley) return false;
  for (const m of broken) {
    if (m.material !== "rail") continue;
    const start = trolley.spanStartById.get(m.id);
    if (start !== undefined && trolley.t >= start - 1e-9) return true;
  }
  return false;
}

export interface SolveStageFailure {
  readonly ok: false;
  readonly cause: Extract<FailCause, "collapse" | "ring-overload">;
  readonly intact: readonly Member[];
  /** Everything this stage broke, in the order it joined the run's list. */
  readonly brokenAdded: readonly number[];
}

export interface SolveStageSuccess {
  readonly ok: true;
  readonly forces: ReadonlyMap<number, number>;
  readonly intact: readonly Member[];
  readonly geometry: TickGeometry;
  readonly ringReactions: readonly Vec3[];
  readonly brokenAdded: readonly number[];
}

export type SolveStageResult = SolveStageFailure | SolveStageSuccess;

/**
 * Stage 6 whole: the pair of solves, then the breakage it calls for.
 *
 * Every member over utilization `1` is removed AT ONCE, permanently, joining
 * the run's broken list in ascending member-id order; then the whole stage runs
 * again over what remains, until a pass breaks nothing or a pass fails. A
 * cascade that ends in collapse still records everything its last pass broke.
 */
export function solveStage(
  structure: Structure,
  anchors: readonly Vec3[],
  axis: Axis2,
  motion: Motion,
  intactIn: readonly Member[],
  cableForce: Vec3,
  trolley: TrolleyPlacement | null,
): SolveStageResult {
  let intact = intactIn;
  const brokenAdded: number[] = [];
  for (let pass = 0; pass <= intactIn.length; pass++) {
    const result = solvePair(
      structure,
      anchors,
      axis,
      motion,
      intact,
      cableForce,
      trolley,
    );
    if (!result.ok) {
      return { ok: false, cause: result.cause, intact, brokenAdded };
    }
    const breaks: Member[] = [];
    for (const m of intact) {
      const force = result.forces.get(m.id);
      if (force === undefined) continue;
      if (utilization(m.material, memberLength(m), force) > 1) breaks.push(m);
    }
    if (breaks.length === 0) {
      return {
        ok: true,
        forces: result.forces,
        intact,
        geometry: result.geometry,
        ringReactions: result.ringReactions,
        brokenAdded,
      };
    }
    breaks.sort((x, y) => x.id - y.id);
    const broken = new Set(breaks.map((m) => m.id));
    for (const m of breaks) brokenAdded.push(m.id);
    intact = intact.filter((m) => !broken.has(m.id));

    // A rail breaking can take the track out from under the trolley, and the
    // rails left may no longer form a single track. Either ends the run.
    if (railBreakTakesTrack(trolley, breaks)) {
      return { ok: false, cause: "collapse", intact, brokenAdded };
    }
    if (!railTrack({ ...structure, members: intact }, anchors).ok) {
      return { ok: false, cause: "collapse", intact, brokenAdded };
    }
  }
  return { ok: false, cause: "collapse", intact, brokenAdded };
}
