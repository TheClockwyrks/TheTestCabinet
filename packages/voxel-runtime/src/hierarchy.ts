import type { AxisSpec, JointSpec, ModelSpec, Vec3 } from "./contract";
import { sampleClip } from "./clips";

/**
 * A part's resolved world transform after posing, as a column-major 16-element
 * matrix (the layout `THREE.Matrix4.fromArray` expects).
 */
export interface PosedPart {
  /** The part name (matches a {@link ModelSpec} part). */
  name: string;
  /** Column-major 4x4 world matrix. */
  worldMatrix: Float32Array;
}

/** Inputs to {@link poseRig}. */
export interface PoseInput {
  /**
   * Values for caller-driven joints, keyed by joint name. Missing joints fall
   * back to the joint's `rest`; provided values are clamped to `[min, max]`.
   */
  caller?: Record<string, number>;
  /** The playback clock (ms) used to sample auto-play joints. Defaults to `0`. */
  timeMs?: number;
}

const AXIS_INDEX: Record<AxisSpec, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** The 4x4 identity as a fresh column-major array. */
export function identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/**
 * Column-major 4x4 matrix product `a * b` (apply `b` first, then `a`, to a
 * column vector).
 */
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!;
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** A translation matrix. */
export function translation(t: Vec3): Float32Array {
  const m = identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

/**
 * A fixed rotation expressed as intrinsic Euler angles `[x, y, z]` (radians),
 * applied X→Y→Z, as the matrix `Rz · Ry · Rx`.
 */
export function eulerRotation(euler: Vec3): Float32Array {
  return multiply(rotation("z", euler[2]), multiply(rotation("y", euler[1]), rotation("x", euler[0])));
}

/**
 * Rotation of `angle` radians about a principal `axis`, as a column-major matrix.
 *
 * `y` (yaw) and `z` (roll) are right-handed. `x` (**pitch**) is deliberately the
 * mirror of the right-handed rotation, so a positive angle lifts a part that
 * points forward (+z) **up** toward +y — the "positive pitch elevates" convention
 * every rig brief, the `voxel-anim` docs, and the `define-joint` help promise. A
 * plain right-handed +x rotation would instead tip a +z-forward barrel *down*,
 * which is the opposite of what authors and models mean by `max = barrel high`.
 * See `docs/testing/asset-generation/voxel-binaries.md` (Rotation direction).
 *
 * The glTF exporter (`scripts/voxel-to-gltf.mjs`) carries an identical `rotation`
 * and MUST be kept in sync with this one so replay and export pose the same way.
 */
export function rotation(axis: AxisSpec, angle: number): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = identity();
  switch (axis) {
    case "x":
      // Pitch: negated relative to a right-handed x-rotation so +angle lifts a
      // forward (+z) part up toward +y (see the convention note above).
      m[5] = c;
      m[6] = -s;
      m[9] = s;
      m[10] = c;
      break;
    case "y":
      m[0] = c;
      m[2] = -s;
      m[8] = s;
      m[10] = c;
      break;
    case "z":
      m[0] = c;
      m[1] = s;
      m[4] = -s;
      m[5] = c;
      break;
  }
  return m;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Resolve the scalar value a joint should be posed at for this frame. */
function jointValue(joint: JointSpec, input: PoseInput): number {
  let value: number;
  if (joint.drive === "auto") {
    value = joint.auto ? sampleClip(joint.auto, input.timeMs ?? 0) : joint.rest;
  } else {
    const provided = input.caller?.[joint.name];
    value = provided === undefined ? joint.rest : provided;
  }
  return clamp(value, joint.min, joint.max);
}

const nonZero = (v: Vec3 | undefined): v is Vec3 =>
  v !== undefined && (v[0] !== 0 || v[1] !== 0 || v[2] !== 0);

/**
 * The local transform a single joint contributes at `value`: its fixed compound
 * mount (`orient` rotation about the pivot and `offset` translation, applied
 * regardless of the driven value) composed with its driven single-axis motion,
 * as `mount · driven`. A joint with no mount contributes only the driven motion
 * (the common case), so existing rigs are unaffected.
 */
function jointMatrix(joint: JointSpec, value: number): Float32Array {
  const p: Vec3 = [joint.pivot[0], joint.pivot[1], joint.pivot[2]];
  const negP: Vec3 = [-p[0], -p[1], -p[2]];

  let driven: Float32Array;
  if (joint.kind === "translation") {
    const t: Vec3 = [0, 0, 0];
    t[AXIS_INDEX[joint.axis]] = value;
    driven = translation(t);
  } else {
    // Rotation about the joint's own pivot: T(pivot) * R(axis, value) * T(-pivot).
    driven = multiply(translation(p), multiply(rotation(joint.axis, value), translation(negP)));
  }

  const offset = joint.offset as Vec3 | undefined;
  const orient = joint.orient as Vec3 | undefined;
  if (!nonZero(offset) && !nonZero(orient)) return driven;

  // The fixed mount: a rotation about the pivot, then a translation, applied
  // outside the driven motion so the component is posed and then mounted.
  let mount = identity();
  if (nonZero(orient)) {
    mount = multiply(translation(p), multiply(eulerRotation(orient), translation(negP)));
  }
  if (nonZero(offset)) {
    mount = multiply(translation(offset), mount);
  }
  return multiply(mount, driven);
}

/**
 * Pose a rig into per-part world matrices.
 *
 * For each part `world = parentWorld ∘ joint₀ ∘ joint₁ …` where the joint
 * transforms are those declared on the part, composed in declared order. Parts
 * are sculpted in the shared volume's world coordinates (already positioned
 * where they sit on the assembled model), so a part contributes no placement
 * translation of its own — its `pivot` is the anchor its joints rotate about,
 * applied inside each joint. At rest a part stays exactly where it was sculpted.
 * Caller-driven joints read {@link PoseInput.caller} (clamped to
 * range, falling back to `rest`); auto-play joints are sampled from their
 * {@link AutoPlaySpec} at {@link PoseInput.timeMs}.
 *
 * Parts are resolved regardless of declaration order (parents are computed on
 * demand and memoised); the returned array preserves the rig's part order.
 * A part naming a missing parent, or a parent cycle, is treated as a root.
 */
export function poseRig(rig: ModelSpec, input: PoseInput): PosedPart[] {
  const partByName = new Map(rig.parts.map((p) => [p.name, p]));
  const jointsByPart = new Map<string, JointSpec[]>();
  for (const joint of rig.joints) {
    const list = jointsByPart.get(joint.part);
    if (list) list.push(joint);
    else jointsByPart.set(joint.part, [joint]);
  }

  const worldByName = new Map<string, Float32Array>();

  const resolve = (name: string, seen: Set<string>): Float32Array => {
    const cached = worldByName.get(name);
    if (cached) return cached;

    const part = partByName.get(name)!;
    // Parts are sculpted in the shared volume's world coordinates — each part's
    // voxels already sit where the part belongs on the assembled model — so a
    // part contributes no placement translation of its own. Its `pivot` is the
    // world-space anchor its joints rotate about (applied inside `jointMatrix`),
    // not an offset that re-places the part. At rest a part therefore stays
    // exactly where it was sculpted; translating by `pivot` here would shift it
    // a second time on top of its already-world-positioned voxels.
    let local = identity();
    for (const joint of jointsByPart.get(name) ?? []) {
      local = multiply(local, jointMatrix(joint, jointValue(joint, input)));
    }

    let world: Float32Array;
    if (part.parent && partByName.has(part.parent) && !seen.has(part.parent)) {
      const parentWorld = resolve(part.parent, new Set(seen).add(name));
      world = multiply(parentWorld, local);
    } else {
      world = local;
    }

    worldByName.set(name, world);
    return world;
  };

  return rig.parts.map((p) => ({
    name: p.name,
    worldMatrix: resolve(p.name, new Set([p.name])),
  }));
}
