// The static check of `specs/structure.md`: the structure read as it stands, at
// the run-start posture, with the bare hook hanging at rest and nothing moving.

import { GRAVITY, HOOK_MASS } from "../constants";
import { utilization } from "./materials";
import { solvePair } from "./solve";
import {
  cost as structureCost,
  memberLength,
  railTrack,
  readiness,
  slewAxis,
} from "./structure";
import type {
  MemberForce,
  SimSite,
  StartIssue,
  Structure,
  Tape,
  TrolleyPlacement,
} from "./types";
import type { Vec3 } from "./vec";

/** Exactly what the `check` action reports (`specs/instrumentation.md`). */
export interface CheckResult {
  /** What would refuse a run, in the order `specs/structure.md` lists them. */
  readonly issues: readonly StartIssue[];
  readonly cost: number;
  readonly budget: number;
  readonly stable: boolean;
  /** Empty exactly when the structure does not stand; in member-id order. */
  readonly members: readonly MemberForce[];
}

/**
 * The issues that would refuse a run: the readiness issues, and `empty-program`
 * for an empty tape, last.
 */
export function startIssues(
  site: SimSite,
  structure: Structure,
  tape: Tape,
): StartIssue[] {
  const issues: StartIssue[] = [...readiness(structure, site.anchors)];
  if (tape.length === 0) issues.push("empty-program");
  return issues;
}

/**
 * The static check.
 *
 * With any readiness issue the structure is not solved and reports no member at
 * all. Otherwise the two solves run at the run-start posture and the structure
 * stands when both are regular. A ready structure is solved whether or not it
 * has a tape, so `empty-program` on its own still reports the forces and the
 * verdict. Nothing breaks and nothing fails during a check: a utilization above
 * `1` is reported and no more, and so is a ring reaction over `RING_CAP`.
 */
export function staticCheck(
  site: SimSite,
  structure: Structure,
  tape: Tape = [],
): CheckResult {
  const ready = readiness(structure, site.anchors);
  const issues = startIssues(site, structure, tape);
  const cost = structureCost(structure);
  const budget = site.budget;
  if (ready.length > 0) {
    return { issues, cost, budget, stable: false, members: [] };
  }
  const ring = structure.ring;
  const track = railTrack(structure, site.anchors);
  if (!ring || !track.ok) {
    return { issues, cost, budget, stable: false, members: [] };
  }
  const axis = slewAxis(ring);
  const span = track.spans[0];
  const trolley: TrolleyPlacement = {
    t: 0,
    nodeA: span.nodeA,
    nodeB: span.nodeB,
    fraction: 0,
    spanStartById: new Map(track.spans.map((s) => [s.member.id, s.s0])),
  };
  const cableForce: Vec3 = [0, -HOOK_MASS * GRAVITY, 0];
  const result = solvePair(
    structure,
    site.anchors,
    axis,
    {
      slew: { value: 0, rate: 0, accel: 0 },
      trolley: { value: 0, rate: 0, accel: 0 },
    },
    structure.members,
    cableForce,
    trolley,
    { ignoreRingCap: true },
  );
  // With the ring cap out of the way the only failure left is a singular arm or
  // tower solve, which is the one thing that makes a ready structure not stand.
  if (!result.ok) {
    return { issues, cost, budget, stable: false, members: [] };
  }
  const members: MemberForce[] = [...structure.members]
    .sort((x, y) => x.id - y.id)
    .map((m) => {
      // A member joined to neither the arm nor the tower is in no solve. It is
      // still intact and reports zero force and zero utilization.
      const force = result.forces.get(m.id) ?? 0;
      return {
        id: m.id,
        force,
        utilization: utilization(m.material, memberLength(m), force),
      };
    });
  return { issues, cost, budget, stable: true, members };
}
