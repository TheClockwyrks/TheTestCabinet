import * as THREE from "three";
import type { AnimationSpec, ModelSpec, PartMesh } from "../contract";
/** Options for {@link VoxelRig}. */
export interface VoxelRigOptions {
    /**
     * Material used for every part mesh. Defaults to a `MeshStandardMaterial`
     * with `vertexColors: true` and `side: THREE.DoubleSide` (the scene must supply
     * lighting). Double-sided rendering is deliberate: a mesher-extracted surface can
     * be legitimately open — a hollowed barrel bore, an intentional cavity — and
     * front-face-only culling would render those interior walls invisible, reading as a
     * hole straight through the model. The rig takes ownership only of the default
     * material (it is disposed by {@link VoxelRig.dispose}); a caller-supplied material
     * is left alone.
     */
    material?: THREE.Material;
    /** Initial playback clock, in milliseconds. Defaults to `0`. */
    timeMs?: number;
}
/**
 * A posable three.js voxel rig: one {@link THREE.Group} per part (all parented
 * under {@link VoxelRig.root}) carrying a single vertex-colored mesh, loaded
 * straight from that part's {@link PartMesh} (decoded from its `.glb`) — the runtime never
 * re-meshes.
 *
 * `pose`/`update` run {@link poseRig} and write each part's **world** matrix onto
 * its group (`matrixAutoUpdate = false`), so the groups are held flat under
 * `root` and the resolved world transforms compose correctly beneath whatever
 * transform the consumer applies to `root`.
 */
export declare class VoxelRig {
    /** The scene node to add to your three.js scene. */
    readonly root: THREE.Group;
    private readonly rig;
    private readonly groups;
    private readonly geometries;
    private readonly ownedMaterial;
    private readonly material;
    private caller;
    private timeMs;
    /**
     * The animation playing, or `null`. When set, each of its tracks poses its joint
     * from the F-curve sampled at {@link timeMs} (overlaid onto the caller values), so
     * `update` walks the animation forward. Defaults to the rig's `autoPlay` animation
     * (a decorative idle) so it plays continuously without being triggered.
     */
    private activeAnimation;
    /**
     * @param rig the parts, joints, and animations to pose.
     * @param meshesByPart each part's produced {@link PartMesh} (decoded from its `.glb`), keyed
     *   by part name — or a single `PartMesh` for a static model (assigned to the
     *   first part). A part with no entry, or an empty mesh, renders as an empty
     *   group (an attach socket).
     */
    constructor(rig: ModelSpec, meshesByPart: Record<string, PartMesh> | PartMesh, opts?: VoxelRigOptions);
    /** Set caller-driven joint values (clamped to range) and re-pose. */
    pose(caller: Record<string, number>): void;
    /**
     * Play one of the model's {@link AnimationSpec} animations — by its
     * {@link AnimationSpec} object or its `name` — or `null` to stop (falling back to
     * the rig's `autoPlay` idle if it has one). Each of the animation's tracks poses
     * its joint from the F-curve sampled at the current clock, overlaying only the
     * joints it drives — every other joint holds at its caller/rest pose — so driving
     * {@link update} walks the whole choreography forward independently of the caller
     * values set by {@link pose}.
     */
    playAnimation(animation: AnimationSpec | string | null): void;
    /** Advance the playback clock by `dtSeconds` and re-pose. */
    update(dtSeconds: number): void;
    /**
     * Seek the playback clock to an absolute time (in milliseconds) and re-pose.
     * Unlike {@link update}, which advances by a delta driven off a wall clock,
     * this poses the rig at an exact time — so a caller can sample deterministic,
     * evenly-spaced frames of a clip (e.g. baking an animation to a GIF or glTF)
     * independent of real time.
     */
    seek(timeMs: number): void;
    /** The joint names, optionally filtered to a single drive kind. */
    jointNames(drive?: "caller" | "auto"): string[];
    /** The `{ min, max, rest }` range of a named joint. */
    jointRange(name: string): {
        min: number;
        max: number;
        rest: number;
    };
    /** Release GPU geometry and the default material, and detach the groups. */
    dispose(): void;
    private applyPose;
}
//# sourceMappingURL=VoxelRig.d.ts.map