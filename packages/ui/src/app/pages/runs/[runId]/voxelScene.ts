import type { PartMesh } from "@test-cabinet/voxel-runtime";

/** Column-major-agnostic 3-tuple. */
export type Vec3 = [number, number, number];

// A single (static-model) {@link PartMesh} versus a by-part map: a `PartMesh`
// carries the flat `positions` array, a map does not.
function isPartMesh(v: Record<string, PartMesh> | PartMesh): v is PartMesh {
  const positions = (v as PartMesh).positions;
  return Array.isArray(positions) || ArrayBuffer.isView(positions);
}

// The scene's lighting and camera framing, shared by the interactive viewer
// (`VoxelViewer`, which declares them as R3F elements) and the offscreen GIF
// capture (`voxelGif`, which builds them imperatively) so a downloaded GIF looks
// like the preview it was taken from. A single source of truth keeps them from
// drifting apart.
export const AMBIENT_INTENSITY = 0.7;
export const KEY_LIGHT = { position: [1, 2, 1] as Vec3, intensity: 1.1 };
export const FILL_LIGHT = { position: [-1, 0.5, -1] as Vec3, intensity: 0.5 };
export const CAMERA_FOV = 45;

/** The raised 3/4 view direction: the camera sits at `distance` times this vector. */
const VIEW_DIR: Vec3 = [1, 0.8, 1];

/**
 * The fraction of the frame's half-extent the model's projected silhouette is fit
 * to fill (so `1` would touch the frame edge). Held below `1` on purpose: framing
 * is computed from the *rest-pose* bounds, so the reserved margin is what keeps a
 * swung limb (a raised leg, a thrown punch, a recoiling barrel) inside the frame
 * as the animation plays. Raise it to zoom in, lower it for more headroom.
 */
const FRAME_FILL = 0.82;

/** The camera position that frames a model fit at `distance` (a raised 3/4 view). */
export function cameraPosition(distance: number): Vec3 {
  return [
    distance * VIEW_DIR[0],
    distance * VIEW_DIR[1],
    distance * VIEW_DIR[2],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// The camera's screen basis for {@link VIEW_DIR} (looking at the origin, world-up
// +Y), replicating three.js `lookAt`: `zAxis` points from the target back toward
// the eye, `xAxis`/`yAxis` are screen-right/screen-up. Constant because the view
// direction is fixed, so the corner projection below only varies with distance.
const CAM_Z = normalize(VIEW_DIR);
const CAM_X = normalize(cross([0, 1, 0], CAM_Z));
const CAM_Y = cross(CAM_Z, CAM_X);
const TAN_HALF_FOV = Math.tan((CAMERA_FOV * Math.PI) / 180 / 2);

/**
 * The largest normalized-device-coordinate a model with the given half-extents
 * (centered at the origin, so its corners are `(±ex, ±ey, ±ez)`) projects to when
 * the camera is placed at `distance` along {@link VIEW_DIR}. `1` means the
 * silhouette exactly touches the frame edge; a corner behind the camera returns
 * `Infinity` (the camera is inside the model). Perspective-correct, so the closer
 * corners of the 3/4 view — which spread wider on screen — are accounted for.
 */
function maxProjection(halfExtents: Vec3, distance: number): number {
  const cam = cameraPosition(distance);
  let max = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const rel: Vec3 = [
          sx * halfExtents[0] - cam[0],
          sy * halfExtents[1] - cam[1],
          sz * halfExtents[2] - cam[2],
        ];
        const depth = -dot(rel, CAM_Z);
        if (depth <= 1e-3) return Infinity;
        const ndcX = Math.abs(dot(rel, CAM_X)) / (depth * TAN_HALF_FOV);
        const ndcY = Math.abs(dot(rel, CAM_Y)) / (depth * TAN_HALF_FOV);
        max = Math.max(max, ndcX, ndcY);
      }
    }
  }
  return max;
}

/**
 * Camera framing — the model's center, the camera distance that fits it, and a
 * far plane — derived from the mesh's vertex bounds. Computed from the geometry
 * rather than a built rig so it's correct on the very first render, before the rig
 * exists. Mesh positions are already in model units, so the bounds are the raw
 * min/max of the `positions` arrays; the rest pose is representative, so posing a
 * joint doesn't reframe.
 *
 * The distance is solved so the model's *projected* silhouette fills {@link FRAME_FILL}
 * of the frame — a perspective-correct fit over the AABB's eight corners, so a tall,
 * wide, or cubic model each fill the frame the same way (the raised 3/4 view's near
 * corners spread wider on screen, which a bounding-radius heuristic would ignore and
 * over-zoom). The sub-`1` fill reserves the margin an animation's limb-swing needs.
 */
export function framing(meshes: Record<string, PartMesh> | PartMesh): {
  center: Vec3;
  distance: number;
  far: number;
} {
  const list = isPartMesh(meshes) ? [meshes] : Object.values(meshes);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const mesh of list) {
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      // The loop bound guarantees these three indices are in range.
      const x = p[i]!;
      const y = p[i + 1]!;
      const z = p[i + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  // `minX > maxX` (no geometry) falls through to framingFromBounds' neutral default.
  return framingFromBounds([minX, minY, minZ], [maxX, maxY, maxZ]);
}

/**
 * {@link framing} reduced to the AABB's two corners (world units). Split out so a
 * caller that already holds an axis-aligned box — the Blender character viewer frames
 * the loaded glTF from a three `Box3` — gets the identical perspective-correct fit the
 * vertex path computes, without flattening every position back into an array. A `min`
 * that exceeds `max` on any axis (an empty box) returns a neutral default.
 */
export function framingFromBounds(
  min: Vec3,
  max: Vec3,
): {
  center: Vec3;
  distance: number;
  far: number;
} {
  if (min[0] > max[0]) {
    // No geometry to frame — a neutral default.
    return { center: [0, 0, 0], distance: 32, far: 400 };
  }
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const halfExtents: Vec3 = [
    Math.max((max[0] - min[0]) / 2, 0),
    Math.max((max[1] - min[1]) / 2, 0),
    Math.max((max[2] - min[2]) / 2, 0),
  ];
  const size =
    Math.max(halfExtents[0], halfExtents[1], halfExtents[2], 0.5) * 2;

  // Solve for the distance whose projected silhouette fills FRAME_FILL of the frame.
  // maxProjection is monotonically decreasing in distance, so bisect: `lo` is always
  // too close (fills more than the target), `hi` always far enough (fills less).
  let lo = size * 0.1;
  let hi = size * 40;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (maxProjection(halfExtents, mid) > FRAME_FILL) lo = mid;
    else hi = mid;
  }
  const distance = hi;
  return { center, distance, far: distance * 20 };
}
