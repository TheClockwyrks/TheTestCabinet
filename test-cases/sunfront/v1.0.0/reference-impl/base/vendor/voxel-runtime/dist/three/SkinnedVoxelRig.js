import * as THREE from "three";
import { sampleAnimation } from "../clips";
import { poseRig } from "../hierarchy";
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
export class SkinnedVoxelRig {
    /** The scene node to add to your three.js scene. */
    root;
    /** The bound skinned mesh (added under {@link root}). */
    mesh;
    rig;
    bones;
    boneByName = new Map();
    /** Flat container for the bones, kept at identity and outside {@link root} so the
     * bones' world matrices equal the posed matrices (a consumer transform on `root`
     * is not folded into the skinning, only into the final placement of the mesh). */
    skeletonRoot;
    skeleton;
    geometry;
    ownedMaterial;
    caller = {};
    timeMs;
    activeAnimation = null;
    /**
     * @param rig the produced rig (`ModelSpec`): its `parts` are the bones, its
     *   `joints`/`animations` drive them.
     * @param mesh the decoded {@link SkinnedMesh} (from
     *   {@link import("../glb").parseSkinnedGlb}) — geometry plus `JOINTS_0`/`WEIGHTS_0`
     *   and the bone skeleton.
     */
    constructor(rig, mesh, opts = {}) {
        this.rig = rig;
        this.timeMs = opts.timeMs ?? 0;
        this.activeAnimation = rig.animations?.find((a) => a.autoPlay) ?? null;
        let material;
        if (opts.material) {
            material = opts.material;
            this.ownedMaterial = null;
        }
        else {
            material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide });
            this.ownedMaterial = material;
        }
        // Geometry: the four base attributes plus the skin's per-vertex binding.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.positions), 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(mesh.colors), 3));
        geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(Array.from(mesh.joints), 4));
        geometry.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(mesh.weights), 4));
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        this.geometry = geometry;
        // One flat THREE.Bone per glb bone, in the mesh's bone (JOINTS_0 index) order.
        this.skeletonRoot = new THREE.Group();
        this.skeletonRoot.name = "voxel-skeleton";
        this.bones = mesh.bones.map((b) => {
            const bone = new THREE.Bone();
            bone.name = b.name;
            bone.matrixAutoUpdate = false; // world matrices are written directly by poseRig
            this.boneByName.set(b.name, bone);
            this.skeletonRoot.add(bone);
            return bone;
        });
        const boneInverses = mesh.bones.map((b) => new THREE.Matrix4().fromArray(Array.from(b.inverseBind)));
        this.skeleton = new THREE.Skeleton(this.bones, boneInverses);
        this.mesh = new THREE.SkinnedMesh(geometry, material);
        this.mesh.name = "voxel-skin";
        // Detached bind with an identity bind matrix: the geometry is authored in the
        // same (field) space the bones are posed in, so no bind-space offset is needed,
        // and a transform on `root` places the mesh without disturbing the skin.
        this.mesh.bindMode = THREE.DetachedBindMode;
        this.mesh.bind(this.skeleton, new THREE.Matrix4());
        this.root = new THREE.Group();
        this.root.name = "voxel-skinned-rig";
        this.root.add(this.mesh);
        this.applyPose();
    }
    /** Set caller-driven joint values (clamped to range) and re-pose. */
    pose(caller) {
        this.caller = caller;
        this.applyPose();
    }
    /**
     * Play one of the model's animations — by its {@link AnimationSpec} or `name` — or
     * `null` to stop (falling back to the rig's `autoPlay` idle). Mirrors
     * {@link import("./VoxelRig").VoxelRig.playAnimation}.
     */
    playAnimation(animation) {
        if (animation === null) {
            this.activeAnimation = this.rig.animations?.find((a) => a.autoPlay) ?? null;
        }
        else if (typeof animation === "string") {
            this.activeAnimation = this.rig.animations?.find((a) => a.name === animation) ?? null;
        }
        else {
            this.activeAnimation = animation;
        }
        this.applyPose();
    }
    /** Advance the playback clock by `dtSeconds` and re-pose. */
    update(dtSeconds) {
        this.timeMs += dtSeconds * 1000;
        this.applyPose();
    }
    /** Seek the playback clock to an absolute time (in milliseconds) and re-pose. */
    seek(timeMs) {
        this.timeMs = timeMs;
        this.applyPose();
    }
    /** The joint names, optionally filtered to a single drive kind. */
    jointNames(drive) {
        const joints = drive ? this.rig.joints.filter((j) => j.drive === drive) : this.rig.joints;
        return joints.map((j) => j.name);
    }
    /** The `{ min, max, rest }` range of a named joint. */
    jointRange(name) {
        const joint = this.rig.joints.find((j) => j.name === name);
        if (!joint)
            throw new Error(`voxel-runtime: unknown joint "${name}"`);
        return { min: joint.min, max: joint.max, rest: joint.rest };
    }
    /** Release GPU geometry, the skeleton, and the default material, and detach. */
    dispose() {
        this.geometry.dispose();
        this.skeleton.dispose();
        this.ownedMaterial?.dispose();
        for (const bone of this.bones)
            bone.removeFromParent();
        this.mesh.removeFromParent();
        this.root.removeFromParent();
    }
    applyPose() {
        const caller = this.activeAnimation
            ? { ...this.caller, ...sampleAnimation(this.activeAnimation, this.timeMs) }
            : this.caller;
        const posed = poseRig(this.rig, { caller, timeMs: this.timeMs });
        for (const part of posed) {
            const bone = this.boneByName.get(part.name);
            if (bone)
                bone.matrix.fromArray(part.worldMatrix);
        }
        // Refresh the flat bones' world matrices (they equal their local matrices, since
        // the skeleton root is identity) so the skeleton's offset matrices are current.
        this.skeletonRoot.updateMatrixWorld(true);
        this.skeleton.update();
    }
}
//# sourceMappingURL=SkinnedVoxelRig.js.map