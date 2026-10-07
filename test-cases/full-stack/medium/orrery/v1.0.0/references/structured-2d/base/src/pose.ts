// Orrery — where a part is DRAWN this frame (specs/simulation.md "Motion and
// carrying", specs/assets.md "What stays drawn in code").
//
// A part's pose in `sim.poses` is where it stands at the last boundary. Within
// a cycle it is somewhere between that pose and the one its instruction leads
// to, and specs/editor.md asks for that motion drawn "smoothly along the same
// paths the collision rule samples". So the drawn pose is derived here, from
// the same fetch the cycle itself ran: the instruction each part holds for the
// cycle now running, swept by `sim.fraction`.
//
// Nothing here changes anything. `fetchCycle` is a pure read of the machine and
// the poses, so calling it once a frame to draw with cannot disagree with the
// cycle the clock resolved from the same three inputs.
//
// While editing, and on a part the cycle raised a fetch fault on, the drawn
// pose is simply the rest pose: nothing has moved.

import { HEX_PITCH } from "./constants";
import { fetchCycle, type PartStep } from "./fetch";
import { hexCenter, sameHex } from "./hex";
import { type StagePoint } from "./motion";
import { armSpokes, gripperHex, isArmKind } from "./parts";
import type { PartState, Pose, SimState } from "./types";
import type { OrreryState } from "./state";

/** How many degrees one spoke step covers. */
const SPOKE_DEGREES = 60;

/** One arm or wheel as this frame draws it. */
export interface DrawnPart {
  /** The part as the editor placed it. */
  readonly part: PartState;
  /** The stage position of its base. */
  readonly base: StagePoint;
  /** The bearing of spoke `0`, in degrees, swept by any rotation under way. */
  readonly bearing: number;
  /** The live length, which a piston's `extend` and `retract` sweep. */
  readonly length: number;
  /** The spoke directions this part carries grippers on, at its rest rotation. */
  readonly spokes: readonly number[];
  /** The spokes whose gripper is closed on a mote. */
  readonly holding: readonly number[];
}

/** Where one gripper is drawn: its stage position and the bearing it points. */
export interface DrawnGripper {
  readonly spoke: number;
  readonly at: StagePoint;
  readonly bearing: number;
  readonly closed: boolean;
}

/**
 * Every arm and wheel of the machine as this frame draws it, in placement
 * order. With no run the parts stand at their rest poses; with one they stand
 * where `sim.fraction` has carried them through the cycle now running.
 */
export function drawnParts(state: OrreryState): DrawnPart[] {
  const parts = state.editor.parts;
  const sim = state.sim;
  const steps =
    sim === null ? [] : fetchCycle(parts, sim.poses, sim.cycle).steps;
  const byPart = new Map(steps.map((step) => [step.part.id, step]));
  const drawn: DrawnPart[] = [];
  for (const part of parts) {
    if (!isArmKind(part.kind) && part.kind !== "wheel") continue;
    const pose = restPoseOf(part, sim);
    const step = byPart.get(part.id) ?? null;
    const t = sim === null ? 0 : sim.fraction;
    drawn.push({
      part,
      base: sweptBase(pose, step, t),
      bearing: pose.rotation * SPOKE_DEGREES + sweptTurn(step, t),
      length: sweptLength(pose, step, t),
      spokes: isArmKind(part.kind)
        ? armSpokes(part.kind, pose.rotation)
        : [0, 1, 2, 3, 4, 5],
      holding: sim === null ? [] : grippingSpokes(sim, part, pose),
    });
  }
  return drawn;
}

/** Every gripper of one drawn arm, in spoke order. */
export function drawnGrippers(drawn: DrawnPart): DrawnGripper[] {
  return drawn.spokes.map((spoke) => {
    const bearing = drawn.bearing + (spoke - firstSpoke(drawn)) * SPOKE_DEGREES;
    const radians = (bearing * Math.PI) / 180;
    return {
      spoke,
      at: {
        x: drawn.base.x + Math.cos(radians) * HEX_PITCH * drawn.length,
        y: drawn.base.y + Math.sin(radians) * HEX_PITCH * drawn.length,
      },
      bearing,
      closed: drawn.holding.includes(spoke),
    };
  });
}

/**
 * The spoke the part's `bearing` is measured against: the rest rotation, which
 * `armSpokes` counts the rest of the spokes from.
 */
function firstSpoke(drawn: DrawnPart): number {
  return drawn.spokes[0] ?? 0;
}

/** The pose a part stands at: its live pose in a run, else where it was placed. */
function restPoseOf(part: PartState, sim: SimState | null): Pose {
  const live = sim?.poses.find((pose) => pose.part === part.id);
  if (live !== undefined) return live;
  return {
    part: part.id,
    rotation: part.rotation,
    length: part.length,
    cell: { q: part.q, r: part.r },
  };
}

/** The base, carried linearly toward the track cell an `advance` leads to. */
function sweptBase(pose: Pose, step: PartStep | null, t: number): StagePoint {
  const from = hexCenter(pose.cell);
  if (step === null || (step.cell !== "advance" && step.cell !== "recede")) {
    return from;
  }
  const to = hexCenter(step.next.cell);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** The degrees a rotation has swept so far this cycle. */
function sweptTurn(step: PartStep | null, t: number): number {
  if (step === null) return 0;
  if (step.cell === "rotate-cw") return SPOKE_DEGREES * t;
  if (step.cell === "rotate-ccw") return -SPOKE_DEGREES * t;
  return 0;
}

/** The length a piston's `extend` or `retract` has swept so far this cycle. */
function sweptLength(pose: Pose, step: PartStep | null, t: number): number {
  if (step === null) return pose.length;
  if (step.cell === "extend") return pose.length + t;
  if (step.cell === "retract") return pose.length - t;
  return pose.length;
}

/**
 * Which of a part's spokes have a gripper closed on a mote. A grip records the
 * mote rather than the constellation, so the closed spokes are the ones whose
 * gripper hex a held mote rests on.
 */
function grippingSpokes(sim: SimState, part: PartState, pose: Pose): number[] {
  if (!isArmKind(part.kind)) return [];
  const held = sim.grips
    .filter((grip) => grip.part === part.id)
    .map((grip) => sim.motes.find((mote) => mote.id === grip.mote))
    .filter((mote): mote is NonNullable<typeof mote> => mote !== undefined);
  if (held.length === 0) return [];
  return armSpokes(part.kind, pose.rotation).filter((spoke) => {
    const at = gripperHex(pose.cell, spoke, pose.length);
    return held.some((mote) => sameHex(mote, at));
  });
}
