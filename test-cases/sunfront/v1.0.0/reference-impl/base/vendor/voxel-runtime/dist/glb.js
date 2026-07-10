const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"
const COMPONENT_TYPE_UINT8 = 5121;
const COMPONENT_TYPE_UINT16 = 5123;
const COMPONENT_TYPE_UINT32 = 5125;
const COMPONENT_TYPE_FLOAT32 = 5126;
const EMPTY_MESH = { positions: [], normals: [], colors: [], indices: [] };
/** Read the 12-byte glb header and walk its chunks, returning the JSON chunk and
 * the BIN chunk's byte offset. Shared by {@link parseGlb} and {@link parseSkinnedGlb}. */
function readContainer(data) {
    const view = new DataView(data);
    if (data.byteLength < 12) {
        throw new Error("parseGlb: buffer too small to hold a glb header");
    }
    const magic = view.getUint32(0, true);
    if (magic !== GLB_MAGIC) {
        throw new Error("parseGlb: not a glb (bad magic)");
    }
    const version = view.getUint32(4, true);
    if (version !== 2) {
        throw new Error(`parseGlb: unsupported glb version ${version}`);
    }
    // Walk the chunks (each: uint32 length, uint32 type, then `length` bytes).
    let json = null;
    let binOffset = -1;
    let offset = 12;
    while (offset + 8 <= data.byteLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkStart = offset + 8;
        if (chunkType === CHUNK_TYPE_JSON) {
            const bytes = new Uint8Array(data, chunkStart, chunkLength);
            json = JSON.parse(new TextDecoder().decode(bytes));
        }
        else if (chunkType === CHUNK_TYPE_BIN) {
            binOffset = chunkStart;
        }
        offset = chunkStart + chunkLength;
    }
    if (!json) {
        throw new Error("parseGlb: no JSON chunk");
    }
    return { json, data, binOffset };
}
/** The byte offset within `data` where an accessor's elements begin. */
function accessorByteOffset(container, accessor) {
    const bufferView = (container.json.bufferViews ?? [])[accessor.bufferView];
    if (!bufferView)
        throw new Error(`parseGlb: missing bufferView ${accessor.bufferView}`);
    if (container.binOffset < 0)
        throw new Error("parseGlb: mesh present but no BIN chunk");
    return container.binOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
}
/** Read an F32 accessor of `components`-wide elements into a flat `Float32Array`.
 * The encoder packs each view tightly and 4-aligned, so views read directly. */
function readFloat(container, accessorIndex, type, components) {
    if (accessorIndex === undefined)
        return new Float32Array(0);
    const accessor = (container.json.accessors ?? [])[accessorIndex];
    if (!accessor)
        throw new Error(`parseGlb: missing accessor ${accessorIndex}`);
    if (accessor.componentType !== COMPONENT_TYPE_FLOAT32 || accessor.type !== type) {
        throw new Error(`parseGlb: accessor ${accessorIndex} is not an F32 ${type}`);
    }
    const byteOffset = accessorByteOffset(container, accessor);
    return new Float32Array(container.data.slice(byteOffset, byteOffset + accessor.count * components * 4));
}
/** Read an unsigned-integer accessor (U8/U16/U32) of `components`-wide elements into
 * a flat `Uint32Array`, widening narrow component types. Handles `JOINTS_0` (whose
 * componentType is commonly U8 or U16) and U32 `SCALAR` indices alike. */
function readUint(container, accessorIndex, components) {
    if (accessorIndex === undefined)
        return new Uint32Array(0);
    const accessor = (container.json.accessors ?? [])[accessorIndex];
    if (!accessor)
        throw new Error(`parseGlb: missing accessor ${accessorIndex}`);
    const byteOffset = accessorByteOffset(container, accessor);
    const dv = new DataView(container.data);
    const n = accessor.count * components;
    const out = new Uint32Array(n);
    switch (accessor.componentType) {
        case COMPONENT_TYPE_UINT8:
            for (let i = 0; i < n; i++)
                out[i] = dv.getUint8(byteOffset + i);
            break;
        case COMPONENT_TYPE_UINT16:
            for (let i = 0; i < n; i++)
                out[i] = dv.getUint16(byteOffset + i * 2, true);
            break;
        case COMPONENT_TYPE_UINT32:
            for (let i = 0; i < n; i++)
                out[i] = dv.getUint32(byteOffset + i * 4, true);
            break;
        default:
            throw new Error(`parseGlb: accessor ${accessorIndex} is not an unsigned integer`);
    }
    return out;
}
/**
 * Decode a per-part `.glb` into its {@link PartMesh}. Reads the 12-byte glb header,
 * the JSON chunk, and the BIN chunk, then walks the glTF `accessors`/`bufferViews`
 * to pull `POSITION`→positions, `NORMAL`→normals, `COLOR_0`→colors (F32 VEC3) and
 * the U32 SCALAR indices. A glb with no meshes decodes to an empty `PartMesh`.
 *
 * @throws if the container is not a glTF 2.0 binary or the primitive is malformed.
 */
export function parseGlb(data) {
    const container = readContainer(data);
    // An empty part is emitted with no meshes → an empty PartMesh.
    const mesh = container.json.meshes?.[0];
    const primitive = mesh?.primitives?.[0];
    if (!primitive) {
        return EMPTY_MESH;
    }
    const positions = readFloat(container, primitive.attributes.POSITION, "VEC3", 3);
    const normals = readFloat(container, primitive.attributes.NORMAL, "VEC3", 3);
    const colors = readFloat(container, primitive.attributes.COLOR_0, "VEC3", 3);
    const indices = readIndices(container, primitive);
    return { positions, normals, colors, indices };
}
/** Read a primitive's U32 SCALAR index accessor, or an empty array if unindexed. */
function readIndices(container, primitive) {
    if (primitive.indices === undefined)
        return new Uint32Array(0);
    const accessor = (container.json.accessors ?? [])[primitive.indices];
    if (!accessor)
        throw new Error(`parseGlb: missing index accessor ${primitive.indices}`);
    if (accessor.type !== "SCALAR")
        throw new Error("parseGlb: index accessor is not a SCALAR");
    return readUint(container, primitive.indices, 1);
}
const EMPTY_SKINNED = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    joints: [],
    weights: [],
    bones: [],
};
/**
 * Decode a skinned whole-body `.glb` (from `mc-skin`/`sn-skin`/`dc-skin`) into a
 * {@link SkinnedMesh}: the {@link PartMesh} geometry plus `JOINTS_0` (widened to
 * `Uint32Array`), `WEIGHTS_0` (`Float32Array`, re-normalized so each vertex's four
 * weights sum to 1), and the {@link SkinnedBone} skeleton read from the glTF skin —
 * its `inverseBindMatrices` (one column-major 4x4 per bone) and joint-node list,
 * with each bone's `parent` resolved from the node hierarchy.
 *
 * The bones are returned in the glTF skin's `joints` order, which is the index space
 * `JOINTS_0` addresses. A glb with no skin decodes to an empty `SkinnedMesh`.
 *
 * @throws if the container is not a glTF 2.0 binary or the primitive is malformed.
 */
export function parseSkinnedGlb(data) {
    const container = readContainer(data);
    const json = container.json;
    const mesh = json.meshes?.[0];
    const primitive = mesh?.primitives?.[0];
    if (!primitive) {
        return EMPTY_SKINNED;
    }
    const positions = readFloat(container, primitive.attributes.POSITION, "VEC3", 3);
    const normals = readFloat(container, primitive.attributes.NORMAL, "VEC3", 3);
    const colors = readFloat(container, primitive.attributes.COLOR_0, "VEC3", 3);
    const indices = readIndices(container, primitive);
    const joints = readUint(container, primitive.attributes.JOINTS_0, 4);
    const weights = normalizeWeights(readFloat(container, primitive.attributes.WEIGHTS_0, "VEC4", 4));
    const skin = json.skins?.[0];
    const bones = skin ? readBones(container, skin) : [];
    return { positions, normals, colors, indices, joints, weights, bones };
}
/** Re-normalize a flat `WEIGHTS_0` array in place so each vertex's four weights sum
 * to 1 (a degenerate all-zero vertex is left untouched). Defensive: the binaries
 * already emit normalized weights, but a consumer relies on the invariant. */
function normalizeWeights(weights) {
    for (let v = 0; v < weights.length; v += 4) {
        const sum = weights[v] + weights[v + 1] + weights[v + 2] + weights[v + 3];
        if (sum > 0 && sum !== 1) {
            weights[v] = weights[v] / sum;
            weights[v + 1] = weights[v + 1] / sum;
            weights[v + 2] = weights[v + 2] / sum;
            weights[v + 3] = weights[v + 3] / sum;
        }
    }
    return weights;
}
/** Read the skeleton for a glTF skin: one {@link SkinnedBone} per joint node, in the
 * skin's `joints` order, resolving each bone's `parent` index from the node hierarchy
 * and its `inverseBind` matrix from the `inverseBindMatrices` accessor (identity when
 * absent, per the glTF default). */
function readBones(container, skin) {
    const nodes = container.json.nodes ?? [];
    const jointNodes = skin.joints;
    // node index → its position in the skin's joints list (the bone index space).
    const boneIndexByNode = new Map();
    jointNodes.forEach((node, i) => boneIndexByNode.set(node, i));
    // node index → its parent node index, from every node's `children`.
    const parentByNode = new Map();
    nodes.forEach((node, nodeIndex) => {
        for (const child of node.children ?? [])
            parentByNode.set(child, nodeIndex);
    });
    const ibm = skin.inverseBindMatrices !== undefined
        ? readFloat(container, skin.inverseBindMatrices, "MAT4", 16)
        : new Float32Array(0);
    return jointNodes.map((nodeIndex, i) => {
        const node = nodes[nodeIndex];
        const parentNode = parentByNode.get(nodeIndex);
        const parent = parentNode !== undefined && boneIndexByNode.has(parentNode)
            ? boneIndexByNode.get(parentNode)
            : null;
        const inverseBind = ibm.length >= (i + 1) * 16
            ? ibm.slice(i * 16, i * 16 + 16)
            : identityMat4();
        return { name: node?.name ?? `bone${i}`, parent, inverseBind };
    });
}
/** A fresh identity 4x4 as a column-major `Float32Array`. */
function identityMat4() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
}
//# sourceMappingURL=glb.js.map