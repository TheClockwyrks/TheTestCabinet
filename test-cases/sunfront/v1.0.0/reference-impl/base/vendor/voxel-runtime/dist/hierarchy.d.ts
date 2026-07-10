import type { AxisSpec, ModelSpec, Vec3 } from "./contract";
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
    /** The playback clock (ms). Reserved for callers that time their own posing;
     * `poseRig` itself no longer samples per-joint clips (animations overlay their
     * joints onto `caller` before posing). Defaults to `0`. */
    timeMs?: number;
}
/** The 4x4 identity as a fresh column-major array. */
export declare function identity(): Float32Array;
/**
 * Column-major 4x4 matrix product `a * b` (apply `b` first, then `a`, to a
 * column vector).
 */
export declare function multiply(a: Float32Array, b: Float32Array): Float32Array;
/** A translation matrix. */
export declare function translation(t: Vec3): Float32Array;
/**
 * A fixed rotation expressed as intrinsic Euler angles `[x, y, z]` (radians),
 * applied X→Y→Z, as the matrix `Rz · Ry · Rx`.
 */
export declare function eulerRotation(euler: Vec3): Float32Array;
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
export declare function rotation(axis: AxisSpec, angle: number): Float32Array;
/**
 * Pose a rig into per-part world matrices.
 *
 * For each part `world = parentWorld ∘ joint₀ ∘ joint₁ …` where the joint
 * transforms are those declared on the part, composed in declared order. Parts
 * are sculpted in the shared volume's world coordinates (already positioned
 * where they sit on the assembled model), so a part contributes no placement
 * translation of its own — its `pivot` is the anchor its joints rotate about,
 * applied inside each joint. At rest a part stays exactly where it was sculpted.
 * Every joint reads its value from {@link PoseInput.caller} (clamped to range,
 * falling back to `rest`): a game supplies caller-driven values, and an animation
 * overlays its `auto` joints onto the same map before posing.
 *
 * Parts are resolved regardless of declaration order (parents are computed on
 * demand and memoised); the returned array preserves the rig's part order.
 * A part naming a missing parent, or a parent cycle, is treated as a root.
 */
export declare function poseRig(rig: ModelSpec, input: PoseInput): PosedPart[];
//# sourceMappingURL=hierarchy.d.ts.map