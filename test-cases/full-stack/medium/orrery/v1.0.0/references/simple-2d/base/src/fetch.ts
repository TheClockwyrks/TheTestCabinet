// Orrery — the fetch step, and the fault table it answers to
// (specs/simulation.md "One cycle runs in this order", step 1, and "Faults").
//
// Fetch is the FIRST step of a cycle: every arm and wheel reads the cell at
// index `sim.cycle mod P` of its own tape, and an instruction the executing part
// cannot perform halts the cycle here — before any gripper opens, before any
// gripper closes, and before anything moves. That ordering is the whole reason
// this module resolves the faults as well as the cells: a caller that has a
// fault in hand has not touched the field yet.
//
// The fault table is read in the order the specification words it. The wheel
// rule takes precedence, so a wheel given anything but `rotate-cw` or
// `rotate-ccw` is `impossible` whatever else would apply; then `extend` and
// `retract` against the piston rule and the length bounds; then `advance` and
// `recede` against the mount and the ends of an open track. When more than one
// part faults at one fetch the EARLIEST part in placement order raises it, so
// the loop below walks the machine in placement order and stops at the first.
//
// The bounds are read off the LIVE pose rather than the placed part: `extend`
// and `retract` change a piston's length at run time and `advance` and `recede`
// change a mounted part's cell, so it is the pose the run has reached that
// decides whether the next step is off the end.

import { ARM_MAX_LEN, ARM_MIN_LEN } from "./constants";
import { WHEEL_INSTRUCTIONS } from "./figures";
import { sameHex, subHex, wrapDir } from "./hex";
import { machinePeriod, tapeCellAt } from "./machine";
import { REST, rotationMotion, spokeVector, translationMotion } from "./motion";
import { carriesTape, gripperHex, mountedTrack } from "./parts";
import type {
  Fault,
  FaultKind,
  Hex,
  Motion,
  PartState,
  PartStep,
  Pose,
  TapeCell,
  W,
} from "./types";

// `PartStep` is declared in `src/types.ts`, because a `CyclePlan` carries the
// steps a cycle resolved; it is re-exported here, where the fetch that builds
// them lives.
export type { PartStep };

/** What one fetch resolved: a step per part, and the fault that halts the cycle. */
export interface Fetched {
  /** One step per arm and wheel, in placement order. */
  readonly steps: PartStep[];
  /** The fetch fault, naming the earliest faulting part, or `null`. */
  readonly fault: W<Fault> | null;
}

/**
 * Fetch every arm and wheel's cell for cycle `cycle` and resolve what it does.
 * The steps are returned whether or not a fault was raised, so a caller can
 * report what the machine was about to do; a fault means the cycle stops here.
 */
export function fetchCycle(
  parts: readonly PartState[],
  poses: readonly Pose[],
  cycle: number,
): Fetched {
  const period = machinePeriod(parts);
  const steps: PartStep[] = [];
  let fault: W<Fault> | null = null;
  for (const part of parts) {
    if (!carriesTape(part.kind)) continue;
    const pose = poses.find((entry) => entry.part === part.id);
    if (pose === undefined) continue;
    const cell = tapeCellAt(part.tape, cycle, period);
    const kind = fetchFault(part, pose, cell, parts);
    if (kind !== null) {
      if (fault === null) fault = { kind, parts: [part.id], motes: [] };
      continue;
    }
    const next = poseAfter(pose, cell, parts);
    steps.push({
      part,
      pose,
      cell,
      next,
      carried: carriedMotion(pose, cell, next),
    });
  }
  return { steps, fault };
}

/**
 * The fault `cell` raises on `part`, or `null` when the part can perform it.
 * A blank cell is a rest on every part, a wheel included, and never faults.
 */
export function fetchFault(
  part: PartState,
  pose: Pose,
  cell: TapeCell,
  parts: readonly PartState[],
): FaultKind | null {
  if (cell === null) return null;
  // The wheel rule takes precedence over every other row of the table.
  if (part.kind === "wheel") {
    return WHEEL_INSTRUCTIONS.includes(cell) ? null : "impossible";
  }
  switch (cell) {
    case "extend":
      if (part.kind !== "piston") return "impossible";
      return pose.length >= ARM_MAX_LEN ? "overextended" : null;
    case "retract":
      if (part.kind !== "piston") return "impossible";
      return pose.length <= ARM_MIN_LEN ? "overretracted" : null;
    case "advance":
    case "recede":
      return trackFault(pose, cell === "advance", parts);
    default:
      return null;
  }
}

/** `unmounted` off a track, `track-end` past the end of an open one, else `null`. */
function trackFault(
  pose: Pose,
  forward: boolean,
  parts: readonly PartState[],
): FaultKind | null {
  const track = mountedTrack(pose.cell, parts);
  if (track === null) return "unmounted";
  if (track.closed === true) return null;
  const cells = track.cells ?? [];
  const at = cells.findIndex((cell) => sameHex(cell, pose.cell));
  const last = cells.length - 1;
  return (forward ? at >= last : at <= 0) ? "track-end" : null;
}

/**
 * The live pose the part stands in once the cycle has landed. A rotation steps
 * the direction, `extend` and `retract` step the length, and `advance` and
 * `recede` step the cell along the track, wrapping on a closed one; every other
 * cell, a pivot and a blank included, leaves the pose exactly as it stands.
 */
export function poseAfter(
  pose: Pose,
  cell: TapeCell,
  parts: readonly PartState[],
): Pose {
  const held: Pose = {
    part: pose.part,
    rotation: pose.rotation,
    length: pose.length,
    cell: { q: pose.cell.q, r: pose.cell.r },
  };
  switch (cell) {
    case "rotate-cw":
      return { ...held, rotation: wrapDir(pose.rotation + 1) };
    case "rotate-ccw":
      return { ...held, rotation: wrapDir(pose.rotation - 1) };
    case "extend":
      return { ...held, length: pose.length + 1 };
    case "retract":
      return { ...held, length: pose.length - 1 };
    case "advance":
    case "recede":
      return { ...held, cell: trackStep(pose.cell, cell === "advance", parts) };
    default:
      return held;
  }
}

/** The next or previous cell of the track a part stands on, wrapping when closed. */
export function trackStep(
  from: Hex,
  forward: boolean,
  parts: readonly PartState[],
): Hex {
  const track = mountedTrack(from, parts);
  const cells = track?.cells ?? [];
  const at = cells.findIndex((cell) => sameHex(cell, from));
  if (at < 0) return { q: from.q, r: from.r };
  const step = forward ? 1 : -1;
  const to = (at + step + cells.length) % cells.length;
  return { q: cells[to].q, r: cells[to].r };
}

/**
 * The motion this part imposes on whatever its grippers hold, from the
 * specification's motion table. A pivot's center is the HOLDING GRIPPER's hex
 * rather than the part's, so it is left for `imposedMotion` to resolve per
 * gripper and reported here as `null`.
 *
 * `extend` and `retract` translate along the part's own spoke. Only a piston
 * ever reaches them — every other part raises `impossible` at the fetch — and a
 * piston carries its one gripper on the spoke its rotation names, so the
 * rotation is the spoke.
 */
function carriedMotion(pose: Pose, cell: TapeCell, next: Pose): Motion | null {
  switch (cell) {
    case "rotate-cw":
      return rotationMotion(pose.cell, 1);
    case "rotate-ccw":
      return rotationMotion(pose.cell, -1);
    case "pivot-cw":
    case "pivot-ccw":
      return null;
    case "extend":
      return translationMotion(spokeVector(pose.rotation, true));
    case "retract":
      return translationMotion(spokeVector(pose.rotation, false));
    case "advance":
    case "recede":
      return translationMotion(subHex(next.cell, pose.cell));
    default:
      return REST;
  }
}

/** The motion `step`'s gripper on `spoke` imposes on the constellation it holds. */
export function imposedMotion(step: PartStep, spoke: number): Motion {
  if (step.carried !== null) return step.carried;
  const center = gripperHex(step.pose.cell, spoke, step.pose.length);
  return rotationMotion(center, step.cell === "pivot-cw" ? 1 : -1);
}
