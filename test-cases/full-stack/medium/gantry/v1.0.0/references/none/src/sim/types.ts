// The plain data the simulation reads and writes. Nothing here renders, draws,
// or reaches an engine: these are the shapes `specs/structure.md`,
// `specs/program.md`, and `specs/state.md` describe, in the terms the solves
// use.

import type { FAIL_TEXT } from "../constants";
import type { Vec3 } from "./vec";

/** The three materials of `specs/structure.md`. */
export type Material = "strut" | "cable" | "rail";

/** A straight element between two distinct lattice nodes. */
export interface Member {
  readonly id: number;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly material: Material;
}

/** The slew ring, placed by its base corner. */
export interface Ring {
  readonly corner: Vec3;
}

/** A crane: its members, its ring if it has one, and its counterweights. */
export interface Structure {
  readonly members: readonly Member[];
  readonly ring: Ring | null;
  readonly counterweights: readonly Vec3[];
}

/** The three load classes of `specs/world.md`. */
export type LoadClass = "crate" | "container" | "drum";

/** A lift point and a yaw in degrees. */
export interface Pose {
  readonly pos: Vec3;
  readonly yaw: number;
}

/** One load a site asks for. */
export interface SiteLoad {
  readonly cls: LoadClass;
  readonly mass: number;
  readonly from: Pose;
  readonly to: Pose;
}

/** An axis-aligned box, by the two corners the collision tests read. */
export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** A site, in the terms `specs/world.md` defines and `specs/sites.md` fixes. */
export interface SimSite {
  readonly name: string;
  readonly envelope: Box;
  readonly anchors: readonly Vec3[];
  readonly budget: number;
  readonly par: { readonly cost: number; readonly time: number };
  readonly loads: readonly SiteLoad[];
  readonly obstacles: readonly Box[];
}

/** The four axes of `specs/program.md`. */
export type AxisName = "slew" | "trolley" | "hoist" | "grip";

/** One command of a move step: drive `axis` to `target` at up to `rate`. */
export interface Command {
  readonly axis: AxisName;
  readonly target: number;
  readonly rate: number;
}

export interface MoveStep {
  readonly kind: "move";
  readonly commands: readonly Command[];
}

export interface ActionStep {
  readonly kind: "action";
  readonly action: "attach" | "release";
}

/** One step of the instruction tape. */
export type TapeStep = MoveStep | ActionStep;

/** The tape: an ordered list of steps, executed one at a time. */
export type Tape = readonly TapeStep[];

/** The readiness issues of `specs/structure.md`, in the order they are listed. */
export type ReadinessIssue =
  "no-ring" | "no-rail" | "invalid-rail" | "disconnected-members";

/** What refuses a run: the readiness issues, and `empty-program` last. */
export type StartIssue = ReadinessIssue | "empty-program";

/** The failure vocabulary `specs/statics.md` closes with. */
export type FailCause = keyof typeof FAIL_TEXT;

/** A load's run phase (`specs/world.md`). */
export type LoadPhase = "waiting" | "attached" | "placed" | "lost";

/** One member's readout: what a solve found, and what it is against capacity. */
export interface MemberForce {
  readonly id: number;
  readonly force: number;
  readonly utilization: number;
}

/** An axis's live state: its value, its signed rate, and its command. */
export interface AxisState {
  value: number;
  rate: number;
  command: { readonly target: number; readonly rate: number } | null;
}

/** The kinematics one solve reads: the slew and the trolley, with their terms. */
export interface Motion {
  readonly slew: {
    readonly value: number;
    readonly rate: number;
    readonly accel: number;
  };
  readonly trolley: {
    readonly value: number;
    readonly rate: number;
    readonly accel: number;
  };
}

/**
 * Where the trolley stands: its position along the track, the two nodes of the
 * rail member carrying it, the share of it that belongs to the second of them,
 * and each rail member's start along the track, which the rail-break rule of
 * `specs/statics.md` reads.
 */
export interface TrolleyPlacement {
  readonly t: number;
  readonly nodeA: Vec3;
  readonly nodeB: Vec3;
  readonly fraction: number;
  readonly spanStartById: ReadonlyMap<number, number>;
}
