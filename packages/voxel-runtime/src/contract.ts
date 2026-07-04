/**
 * The contract types the voxel runtime operates on, re-exported from the
 * generated `@test-cabinet/run-record` package so there is a single source of
 * truth for the wire shapes. Nothing here is voxel-runtime-specific except the
 * {@link Vec3} tuple alias used by the posing math.
 */

export type {
  // The rig (`rig.json` / resolved `ModelSpec`).
  ModelSpec,
  PartSpec,
  JointSpec,
  JointKindSpec,
  AxisSpec,
  DriveKindSpec,
  // The model-authored F-curve animations (`rig.animations`).
  InterpSpec,
  KeyframeSpec,
  AnimationSpec,
  AnimationTrackSpec,
} from "@test-cabinet/run-record";

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
