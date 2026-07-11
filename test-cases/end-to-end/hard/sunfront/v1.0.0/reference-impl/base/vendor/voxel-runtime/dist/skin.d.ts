/**
 * Pure-core **linear-blend skinning** for the skinned whole-body kinds
 * (`mc-skinned`/`sn-skinned`/`dc-skinned`): sample a rig's animations and caller
 * joint values into per-bone matrices ({@link skinningMatrices}) and deform a
 * {@link SkinnedMesh} by them on the CPU ({@link skinMesh}) — no `three`.
 *
 * The runtime drives a skinned mesh **procedurally from `rig.json`**, exactly as it
 * drives a rigid rig: the rig's `parts` are the bones, its `joints` each address a
 * bone by name, and {@link import("./hierarchy").poseRig} composes each bone's
 * world-space joint motion. A bone's **skinning matrix** is that posed world matrix
 * times the bone's inverse-bind matrix (`world · inverseBind`); a vertex is
 * transformed by up to four of them, blended by its `WEIGHTS_0`. This is the
 * mathematically identical result the `three` binding's `SkinnedVoxelRig` gets on
 * the GPU — the two paths agree.
 */
import type { ModelSpec, SkinnedMesh } from "./contract";
import { type PoseInput } from "./hierarchy";
/**
 * Compute one **skinning matrix** per bone of a {@link SkinnedMesh}, in the mesh's
 * bone order (the index space `JOINTS_0` addresses), ready to feed {@link skinMesh}
 * or a GPU skeleton.
 *
 * Each is `world · inverseBind`, where `world` is the bone's posed world matrix from
 * {@link poseRig} (looked up by bone name against the rig's parts) and `inverseBind`
 * is the bone's inverse-bind matrix from the `.glb`. A bone with no matching rig part
 * contributes the identity world (so it holds at bind pose). At rest every matrix is
 * the identity, so an un-posed skin is undeformed.
 *
 * @param rig the produced `rig.json` (`ModelSpec`) — its `parts` are the bones and
 *   its `joints`/`animations` drive them.
 * @param mesh the decoded skinned mesh, for its {@link SkinnedMesh.bones}.
 * @param input caller joint values (and, from the caller, any overlaid animation
 *   values) — the same {@link PoseInput} `poseRig` takes.
 */
export declare function skinningMatrices(rig: ModelSpec, mesh: Pick<SkinnedMesh, "bones">, input: PoseInput): Float32Array[];
/** The mesh data {@link skinMesh} deforms: positions/normals to transform and the
 * per-vertex `JOINTS_0`/`WEIGHTS_0` that bind them to the bone matrices. */
export type SkinnableMesh = Pick<SkinnedMesh, "positions" | "normals" | "joints" | "weights">;
/**
 * Linear-blend-skin a {@link SkinnedMesh} on the CPU: transform every vertex's
 * position and normal by its (up to four) bone matrices, blended by its `WEIGHTS_0`.
 *
 * For a vertex with joints `j` and weights `w`, the skinned position is
 * `Σ wᵢ · (boneMatrices[jᵢ] · position)` and the skinned normal is the same blend of
 * the matrices' rotation (upper-3x3) parts, re-normalized. Returns fresh
 * `Float32Array`s; the input mesh is untouched. Feed `boneMatrices` from
 * {@link skinningMatrices}.
 *
 * @param mesh the geometry plus its `JOINTS_0`/`WEIGHTS_0` binding.
 * @param boneMatrices one column-major 4x4 per bone (from {@link skinningMatrices}),
 *   indexed by the mesh's bone indices.
 */
export declare function skinMesh(mesh: SkinnableMesh, boneMatrices: ReadonlyArray<ArrayLike<number>>): {
    positions: Float32Array;
    normals: Float32Array;
};
//# sourceMappingURL=skin.d.ts.map