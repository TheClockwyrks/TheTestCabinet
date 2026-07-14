import * as THREE from "three";
import type { AnimationSpec, ModelSpec, SkinnedMesh } from "../contract";
/** Options for {@link SkinnedVoxelRig}. */
export interface SkinnedVoxelRigOptions {
    /**
     * Material used for the skinned mesh. Defaults to a `MeshStandardMaterial` with
     * `vertexColors: true` and `side: THREE.DoubleSide` (the scene must supply
     * lighting), matching {@link import("./VoxelRig").VoxelRig}. The rig disposes only
     * the default material; a caller-supplied material is left alone.
     */
    material?: THREE.Material;
    /** Initial playback clock, in milliseconds. Defaults to `0`. */
    timeMs?: number;
}
/**
 * A posable three.js **skinned** rig: a single {@link THREE.SkinnedMesh} bound to a
 * {@link THREE.Skeleton}, deformed on the GPU by **linear-blend skinning** (up to
 * four bone influences per vertex). This is the skinned counterpart to
 * {@link import("./VoxelRig").VoxelRig} — where each rigid part is its own mesh posed
 * about a pivot, a skinned character is **one continuous mesh** whose vertices blend
 * their bones' transforms across a joint.
 *
 * The skeleton is driven **procedurally from the produced `rig.json`**: the rig's
 * `parts` are the bones, its `joints` (caller- and animation-driven alike) rotate
 * them, and {@link poseRig} composes each bone's world-space motion. The bones' world
 * matrices are written straight onto flat {@link THREE.Bone}s (`matrixAutoUpdate =
 * false`) held under a self-contained skeleton root kept at identity, so the
 * consumer's transform on {@link root} places the whole character without
 * double-transforming the skin. Each bone's inverse-bind matrix comes from the
 * decoded `.glb`. The math is identical to the pure-core
 * {@link import("../skin").skinMesh} path — the two agree.
 */
export declare class SkinnedVoxelRig {
    /** The scene node to add to your three.js scene. */
    readonly root: THREE.Group;
    /** The bound skinned mesh (added under {@link root}). */
    readonly mesh: THREE.SkinnedMesh;
    private readonly rig;
    private readonly bones;
    private readonly boneByName;
    /** Flat container for the bones, kept at identity and outside {@link root} so the
     * bones' world matrices equal the posed matrices (a consumer transform on `root`
     * is not folded into the skinning, only into the final placement of the mesh). */
    private readonly skeletonRoot;
    private readonly skeleton;
    private readonly geometry;
    private readonly ownedMaterial;
    private caller;
    private timeMs;
    private activeAnimation;
    /**
     * @param rig the produced rig (`ModelSpec`): its `parts` are the bones, its
     *   `joints`/`animations` drive them.
     * @param mesh the decoded {@link SkinnedMesh} (from
     *   {@link import("../glb").parseSkinnedGlb}) — geometry plus `JOINTS_0`/`WEIGHTS_0`
     *   and the bone skeleton.
     */
    constructor(rig: ModelSpec, mesh: SkinnedMesh, opts?: SkinnedVoxelRigOptions);
    /** Set caller-driven joint values (clamped to range) and re-pose. */
    pose(caller: Record<string, number>): void;
    /**
     * Play one of the model's animations — by its {@link AnimationSpec} or `name` — or
     * `null` to stop (falling back to the rig's `autoPlay` idle). Mirrors
     * {@link import("./VoxelRig").VoxelRig.playAnimation}.
     */
    playAnimation(animation: AnimationSpec | string | null): void;
    /** Advance the playback clock by `dtSeconds` and re-pose. */
    update(dtSeconds: number): void;
    /** Seek the playback clock to an absolute time (in milliseconds) and re-pose. */
    seek(timeMs: number): void;
    /** The joint names, optionally filtered to a single drive kind. */
    jointNames(drive?: "caller" | "auto"): string[];
    /** The `{ min, max, rest }` range of a named joint. */
    jointRange(name: string): {
        min: number;
        max: number;
        rest: number;
    };
    /** Release GPU geometry, the skeleton, and the default material, and detach. */
    dispose(): void;
    private applyPose;
}
//# sourceMappingURL=SkinnedVoxelRig.d.ts.map