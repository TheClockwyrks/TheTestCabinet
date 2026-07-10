/**
 * The contract types the voxel runtime operates on, re-exported from the
 * generated `@test-cabinet/run-record` package so there is a single source of
 * truth for the wire shapes. Nothing here is voxel-runtime-specific except the
 * {@link Vec3} tuple alias used by the posing math.
 */
/**
 * The rig contract types the voxel runtime operates on. In the source package
 * these are re-exported (type-only) from the generated `@test-cabinet/run-record`
 * package; in this vendored, prebuilt copy the type-only import is inlined so the
 * reference implementation builds with a plain `npm ci` outside the monorepo. They
 * are byte-for-byte the `run-record` shapes.
 */
/** A resolved part of a {@link ModelSpec}: one named voxel component of the rig. */
export type PartSpec = {
    /** Stable name of this part (for example `chassis`, `turret`). */
    name: string;
    /** The parent part this one is attached to, or absent for the root part. */
    parent?: string;
    /** The attachment point of this part in the parent's local voxel coordinates. */
    pivot: [number, number, number];
};
/** Whether a {@link JointSpec} rotates or translates its part. */
export type JointKindSpec = "rotation" | "translation";
/** A principal axis a {@link JointSpec} acts about or along. */
export type AxisSpec = "x" | "y" | "z";
/** Who drives a {@link JointSpec}: a caller (a game) or the model's animations. */
export type DriveKindSpec = "caller" | "auto";
/**
 * A resolved joint of a {@link ModelSpec}: one named degree of freedom on a part.
 * Either **caller-driven** (a game supplies its value) or **`auto`** (driven only
 * by the model's animation tracks). Rotations are radians about {@link axis}
 * through {@link pivot}; translations are voxel units along the axis.
 */
export type JointSpec = {
    /** Stable name of this joint; the parameter a game addresses. */
    name: string;
    /** The part this joint moves (a declared {@link PartSpec} name). */
    part: string;
    /** Whether this joint rotates or translates the part. */
    kind: JointKindSpec;
    /** The axis the joint acts about (rotation) or along (translation). */
    axis: AxisSpec;
    /** The joint origin in the part's local voxel coordinates. */
    pivot: [number, number, number];
    /** Minimum value: radians for a rotation, voxel units for a translation. */
    min: number;
    /** Maximum value. */
    max: number;
    /** The rest/default value, within `[min, max]`. */
    rest: number;
    /** A fixed mount translation applied in addition to the driven motion. */
    offset?: [number, number, number];
    /** A fixed mount rotation (Euler X→Y→Z about {@link pivot}) applied in addition. */
    orient?: [number, number, number];
    /** Who drives this joint. */
    drive: DriveKindSpec;
};
/** How an {@link AnimationSpec} F-curve segment interpolates between two keyframes. */
export type InterpSpec = "constant" | "linear" | "bezier" | "ease-in" | "ease-out" | "ease-in-out";
/** A resolved keyframe within an {@link AnimationTrackSpec} F-curve. */
export type KeyframeSpec = {
    /** Time offset from the start of the animation, in milliseconds. */
    tMs: number;
    /** The joint value at this time. */
    value: number;
    /** Interpolation of the segment **leaving** this key. */
    interp: InterpSpec;
    /** Bézier out-handle `[dt_ms, dvalue]`; absent = auto tangent. */
    outHandle?: [number, number];
    /** Bézier in-handle `[dt_ms, dvalue]`; absent = auto tangent. */
    inHandle?: [number, number];
};
/** One track of an {@link AnimationSpec}: the F-curve keyframes for a single joint. */
export type AnimationTrackSpec = {
    /** The joint this track drives (a declared {@link JointSpec} name). */
    joint: string;
    /** The keyframes, in time order, sampled over the animation's period. */
    keyframes: Array<KeyframeSpec>;
};
/** A model animation — one unified type across the pipeline. */
export type AnimationSpec = {
    /** Stable, unique name a game plays this animation by. */
    name: string;
    /** The period in milliseconds — one full loop across every track. */
    periodMs: number;
    /** Whether the animation loops or plays once and holds the last pose. */
    looping: boolean;
    /** Whether the animation plays continuously by default (a decorative idle). */
    autoPlay: boolean;
    /** The joints the animation is required to drive. */
    joints: Array<string>;
    /** The authored F-curve tracks, one per driven joint. */
    tracks?: Array<AnimationTrackSpec>;
};
/**
 * The rig a model produces — named parts in a parent/child hierarchy, the named
 * joints a consuming game (or an auto-play clip) drives, and the authored
 * animations.
 */
export type ModelSpec = {
    /** The declared parts, in declared order (the first is the root). */
    parts: Array<PartSpec>;
    /** The declared joints, in declared order. */
    joints: Array<JointSpec>;
    /** The model's animations, each carrying its F-curve tracks on the produced rig. */
    animations?: Array<AnimationSpec>;
};
/** An integer or real 3-vector `[x, y, z]`. */
export type Vec3 = [number, number, number];
/**
 * One part's surface mesh: an indexed triangle list with a position, normal, and
 * linear `0..1` RGB color per vertex. This is the geometry the Rust mesher already
 * extracted (cube, marching cubes, surface nets, or dual contouring — all emit the
 * same shape) and wrote as a per-part binary glTF (`.glb`); the runtime **consumes**
 * it — via {@link import("./glb").parseGlb} — and never re-meshes.
 *
 * Fields are {@link ArrayLike} so this type covers both a `.glb` decoded by
 * `parseGlb` (typed arrays) and plain `number[]` arrays — the three binding's
 * {@link import("./three").buildPartGeometry} copies each into the `Float32Array`/
 * `Uint32Array` a `THREE.BufferAttribute` needs.
 */
export interface PartMesh {
    /** Vertex positions, 3 floats (x, y, z) per vertex, in model units. */
    positions: ArrayLike<number>;
    /** Vertex normals, 3 floats per vertex (unit normals). */
    normals: ArrayLike<number>;
    /** Vertex colors, 3 floats (r, g, b) in `0..1` per vertex. */
    colors: ArrayLike<number>;
    /** Triangle indices into the vertex arrays, 3 per triangle. */
    indices: ArrayLike<number>;
}
/**
 * One bone of a {@link SkinnedMesh}'s skeleton, in the glTF skin's `joints` order
 * (i.e. the bone index space that {@link SkinnedMesh.joints} addresses).
 *
 * A skinned model (the `mc-skinned`/`sn-skinned`/`dc-skinned` kinds) binds **one
 * continuous mesh** to this skeleton and deforms it by per-vertex weights, unlike
 * the rigid `-animation` kinds where each part is its own mesh posed about a pivot.
 * The bone's motion is driven procedurally from the produced `rig.json` — its
 * `joints` (each addressing a bone by the bone's name via `JointSpec.part`) and its
 * F-curve `animations` — through the same {@link import("./hierarchy").poseRig}
 * world-space joint composition the rigid kinds use. The rig's `parts` are the
 * bones; a bone here is matched to its posed world matrix by `name`.
 */
export interface SkinnedBone {
    /** The bone name — matches a `ModelSpec` part (a `PartSpec.name`) and the glTF
     * node name, so the rig's posed world matrix for this bone is looked up by name. */
    name: string;
    /** Index into the owning {@link SkinnedMesh.bones} array of this bone's parent,
     * or `null` for a root bone. Derived from the glTF node hierarchy. */
    parent: number | null;
    /** This bone's inverse-bind matrix, a column-major 16-element 4x4 (the layout
     * `THREE.Matrix4.fromArray` and `poseRig` use). Decoded from the glTF skin's
     * `inverseBindMatrices`. Under this runtime's delta convention — the skin is
     * driven by `poseRig`'s world-space joint composition, which already folds the
     * rest placement — it is the identity for models this repo's binaries emit; it is
     * decoded and exposed for standard-glTF consumers and applied as `world · inverseBind`. */
    inverseBind: Float32Array;
}
/**
 * One skinned whole-body mesh: the {@link PartMesh} geometry (an indexed triangle
 * list with position/normal/color per vertex) **plus** the two extra vertex
 * attributes and the skeleton that make it a linear-blend **skin** — `JOINTS_0`
 * (up to four influencing bone indices per vertex) and `WEIGHTS_0` (their matching,
 * normalized weights), and the {@link SkinnedBone} skeleton the indices address.
 *
 * This is what a skinning binary (`mc-skin`/`sn-skin`/`dc-skin`) emits as a single
 * `mesh.glb`; the runtime **consumes** it — via {@link import("./glb").parseSkinnedGlb}
 * — and never re-meshes or re-weights. Pose it with
 * {@link import("./skin").skinningMatrices} + {@link import("./skin").skinMesh} (pure
 * CPU) or the `three` binding's `SkinnedVoxelRig` (GPU skinning).
 */
export interface SkinnedMesh {
    /** Vertex positions, 3 floats (x, y, z) per vertex, in model units. */
    positions: ArrayLike<number>;
    /** Vertex normals, 3 floats per vertex (unit normals). */
    normals: ArrayLike<number>;
    /** Vertex colors, 3 floats (r, g, b) in `0..1` per vertex. */
    colors: ArrayLike<number>;
    /** Triangle indices into the vertex arrays, 3 per triangle. */
    indices: ArrayLike<number>;
    /** `JOINTS_0`: 4 bone indices per vertex (into {@link bones}), the up-to-four
     * influencing bones. Unused influences carry index `0` with weight `0`. */
    joints: ArrayLike<number>;
    /** `WEIGHTS_0`: 4 skin weights per vertex, matching {@link joints}, normalized so
     * each vertex's weights sum to ~1. */
    weights: ArrayLike<number>;
    /** The skeleton, in the glTF skin's joint order (the index space {@link joints}
     * addresses). Empty for a mesh with no skin. */
    bones: SkinnedBone[];
}
//# sourceMappingURL=contract.d.ts.map