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

/** The camera position that frames a model fit at `distance` (a raised 3/4 view). */
export function cameraPosition(distance: number): Vec3 {
  return [distance, distance * 0.8, distance];
}

/**
 * Camera framing — the model's center, the camera distance that fits it, and a
 * far plane — derived from the mesh's vertex bounds. Computed from the geometry
 * rather than a built rig so it's correct on the very first render, before the rig
 * exists. Mesh positions are already in model units, so the bounds are the raw
 * min/max of the `positions` arrays; the rest pose is representative, so posing a
 * joint doesn't reframe.
 */
export function framing(
  meshes: Record<string, PartMesh> | PartMesh,
): { center: Vec3; distance: number; far: number } {
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
  if (minX > maxX) {
    // No geometry to frame yet — a neutral default.
    return { center: [0, 0, 0], distance: 32, far: 400 };
  }
  const center: Vec3 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
  const dist = size * 2.2;
  return { center, distance: dist, far: dist * 20 };
}
