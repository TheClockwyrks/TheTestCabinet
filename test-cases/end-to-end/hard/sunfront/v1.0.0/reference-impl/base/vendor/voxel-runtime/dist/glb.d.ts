/**
 * A minimal, synchronous decoder from a binary glTF (`.glb`) file to the runtime's
 * mesh contracts — {@link PartMesh} for the rigid, per-part kinds and
 * {@link SkinnedMesh} for the skinned whole-body kinds.
 *
 * The meshing binaries (cube, marching cubes, surface nets, dual contouring — and
 * their `-anim` variants) emit each part's surface as a standard glTF 2.0 binary
 * container holding **one mesh with one primitive**: the `POSITION`, `NORMAL`, and
 * `COLOR_0` attributes (all F32 `VEC3`) plus U32 `SCALAR` indices, concatenated
 * tightly into the single BIN chunk. The skinning binaries (`mc-skin`/`sn-skin`/
 * `dc-skin`) emit a single whole-body mesh that additionally carries `JOINTS_0`
 * (a bone-index `VEC4`), `WEIGHTS_0` (an F32 `VEC4`), and a glTF **skin** (its
 * inverse-bind-matrices accessor, joint-node list, and the bone node hierarchy).
 * Because the shape is our own fixed one and
 * {@link import("./three").buildPartGeometry} already does the geometry wiring, this
 * is a direct container parser rather than three's async `GLTFLoader`.
 *
 * An empty part (an attach socket with no geometry) is emitted as a valid glb with
 * no meshes; it decodes to a {@link PartMesh} with all four arrays empty.
 */
import type { PartMesh, SkinnedMesh } from "./contract";
/**
 * Decode a per-part `.glb` into its {@link PartMesh}. Reads the 12-byte glb header,
 * the JSON chunk, and the BIN chunk, then walks the glTF `accessors`/`bufferViews`
 * to pull `POSITION`→positions, `NORMAL`→normals, `COLOR_0`→colors (F32 VEC3) and
 * the U32 SCALAR indices. A glb with no meshes decodes to an empty `PartMesh`.
 *
 * @throws if the container is not a glTF 2.0 binary or the primitive is malformed.
 */
export declare function parseGlb(data: ArrayBuffer): PartMesh;
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
export declare function parseSkinnedGlb(data: ArrayBuffer): SkinnedMesh;
//# sourceMappingURL=glb.d.ts.map