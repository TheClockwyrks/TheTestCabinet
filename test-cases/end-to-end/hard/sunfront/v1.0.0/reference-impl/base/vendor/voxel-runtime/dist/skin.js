import { identity, multiply, poseRig } from "./hierarchy";
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
export function skinningMatrices(rig, mesh, input) {
    const posed = poseRig(rig, input);
    const worldByName = new Map(posed.map((p) => [p.name, p.worldMatrix]));
    return mesh.bones.map((bone) => {
        const world = worldByName.get(bone.name) ?? identity();
        return multiply(world, bone.inverseBind);
    });
}
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
export function skinMesh(mesh, boneMatrices) {
    const { positions, normals, joints, weights } = mesh;
    const vertexCount = Math.floor(positions.length / 3);
    const outPos = new Float32Array(vertexCount * 3);
    const outNorm = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
        const px = positions[v * 3];
        const py = positions[v * 3 + 1];
        const pz = positions[v * 3 + 2];
        const nx = normals[v * 3] ?? 0;
        const ny = normals[v * 3 + 1] ?? 0;
        const nz = normals[v * 3 + 2] ?? 0;
        let ax = 0;
        let ay = 0;
        let az = 0;
        let anx = 0;
        let any = 0;
        let anz = 0;
        for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k] ?? 0;
            if (w === 0)
                continue;
            const m = boneMatrices[joints[v * 4 + k]];
            if (!m)
                continue;
            // Column-major 4x4 · (position, 1).
            ax += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
            ay += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
            az += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
            // Upper-3x3 · normal (no translation).
            anx += w * (m[0] * nx + m[4] * ny + m[8] * nz);
            any += w * (m[1] * nx + m[5] * ny + m[9] * nz);
            anz += w * (m[2] * nx + m[6] * ny + m[10] * nz);
        }
        outPos[v * 3] = ax;
        outPos[v * 3 + 1] = ay;
        outPos[v * 3 + 2] = az;
        const len = Math.hypot(anx, any, anz);
        if (len > 0) {
            outNorm[v * 3] = anx / len;
            outNorm[v * 3 + 1] = any / len;
            outNorm[v * 3 + 2] = anz / len;
        }
        else {
            outNorm[v * 3] = nx;
            outNorm[v * 3 + 1] = ny;
            outNorm[v * 3 + 2] = nz;
        }
    }
    return { positions: outPos, normals: outNorm };
}
//# sourceMappingURL=skin.js.map