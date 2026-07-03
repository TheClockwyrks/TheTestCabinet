/**
 * A minimal, synchronous decoder from a per-part binary glTF (`.glb`) file to the
 * runtime's {@link PartMesh} contract.
 *
 * The meshing binaries (cube, marching cubes, surface nets, dual contouring — and
 * their `-anim` variants) emit each part's surface as a standard glTF 2.0 binary
 * container holding **one mesh with one primitive**: the `POSITION`, `NORMAL`, and
 * `COLOR_0` attributes (all F32 `VEC3`) plus U32 `SCALAR` indices, concatenated
 * tightly into the single BIN chunk. Because the shape is our own fixed one and
 * {@link import("./three").buildPartGeometry} already does the geometry wiring, this
 * is a direct container parser rather than three's async `GLTFLoader`.
 *
 * An empty part (an attach socket with no geometry) is emitted as a valid glb with
 * no meshes; it decodes to a {@link PartMesh} with all four arrays empty.
 */
import type { PartMesh } from "./contract";

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"

const COMPONENT_TYPE_UINT32 = 5125;
const COMPONENT_TYPE_FLOAT32 = 5126;

/** The subset of the glTF 2.0 JSON we consume. */
interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
}
interface GltfMesh {
  primitives: GltfPrimitive[];
}
interface GltfJson {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  meshes?: GltfMesh[];
}

const EMPTY_MESH: PartMesh = { positions: [], normals: [], colors: [], indices: [] };

/**
 * Decode a per-part `.glb` into its {@link PartMesh}. Reads the 12-byte glb header,
 * the JSON chunk, and the BIN chunk, then walks the glTF `accessors`/`bufferViews`
 * to pull `POSITION`→positions, `NORMAL`→normals, `COLOR_0`→colors (F32 VEC3) and
 * the U32 SCALAR indices. A glb with no meshes decodes to an empty `PartMesh`.
 *
 * @throws if the container is not a glTF 2.0 binary or the primitive is malformed.
 */
export function parseGlb(data: ArrayBuffer): PartMesh {
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
  let json: GltfJson | null = null;
  let binOffset = -1;
  let binLength = 0;
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkType === CHUNK_TYPE_JSON) {
      const bytes = new Uint8Array(data, chunkStart, chunkLength);
      json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
    } else if (chunkType === CHUNK_TYPE_BIN) {
      binOffset = chunkStart;
      binLength = chunkLength;
    }
    offset = chunkStart + chunkLength;
  }

  if (!json) {
    throw new Error("parseGlb: no JSON chunk");
  }

  // An empty part is emitted with no meshes → an empty PartMesh.
  const mesh = json.meshes?.[0];
  if (!mesh) {
    return EMPTY_MESH;
  }
  const primitive = mesh.primitives?.[0];
  if (!primitive) {
    return EMPTY_MESH;
  }

  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  if (binOffset < 0) {
    throw new Error("parseGlb: mesh present but no BIN chunk");
  }
  // The BIN chunk data starts at `binOffset` within `data`; f32/u32 elements are
  // naturally 4-byte-aligned and the encoder packs each view 4-aligned, so views
  // can be read as typed arrays directly (glb aligns the BIN chunk to 4 bytes).
  void binLength;

  const readFloat3 = (accessorIndex: number | undefined): Float32Array => {
    if (accessorIndex === undefined) return new Float32Array(0);
    const accessor = accessors[accessorIndex];
    if (!accessor) throw new Error(`parseGlb: missing accessor ${accessorIndex}`);
    if (accessor.componentType !== COMPONENT_TYPE_FLOAT32 || accessor.type !== "VEC3") {
      throw new Error(`parseGlb: accessor ${accessorIndex} is not an F32 VEC3`);
    }
    const bufferView = bufferViews[accessor.bufferView];
    if (!bufferView) throw new Error(`parseGlb: missing bufferView ${accessor.bufferView}`);
    const byteOffset = binOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return new Float32Array(data.slice(byteOffset, byteOffset + accessor.count * 3 * 4));
  };

  const positions = readFloat3(primitive.attributes.POSITION);
  const normals = readFloat3(primitive.attributes.NORMAL);
  const colors = readFloat3(primitive.attributes.COLOR_0);

  let indices: Uint32Array = new Uint32Array(0);
  if (primitive.indices !== undefined) {
    const accessor = accessors[primitive.indices];
    if (!accessor) throw new Error(`parseGlb: missing index accessor ${primitive.indices}`);
    if (accessor.componentType !== COMPONENT_TYPE_UINT32 || accessor.type !== "SCALAR") {
      throw new Error("parseGlb: index accessor is not a U32 SCALAR");
    }
    const bufferView = bufferViews[accessor.bufferView];
    if (!bufferView) throw new Error(`parseGlb: missing index bufferView ${accessor.bufferView}`);
    const byteOffset = binOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    indices = new Uint32Array(data.slice(byteOffset, byteOffset + accessor.count * 4));
  }

  return { positions, normals, colors, indices };
}
