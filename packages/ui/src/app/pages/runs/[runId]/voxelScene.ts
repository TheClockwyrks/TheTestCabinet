import type { VoxelDims, VoxelsFile } from "@test-cabinet/run-record";

/** Column-major-agnostic 3-tuple. */
export type Vec3 = [number, number, number];

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
 * far plane — derived from the raw voxel bounds (or a fixed `frameDims` volume
 * when the caller pins the frame). Computed from the data rather than a built
 * rig so it's correct on the very first render, before the rig exists. Each voxel
 * occupies the unit cube `[x, x+1]`, so the far corner is `max + 1`; the rest
 * pose is representative, so posing a joint doesn't reframe.
 */
export function framing(
  voxels: Record<string, VoxelsFile> | VoxelsFile,
  frameDims: VoxelDims | null | undefined,
): { center: Vec3; distance: number; far: number } {
  if (frameDims) {
    const size = Math.max(
      frameDims.width,
      frameDims.height,
      frameDims.depth,
      1,
    );
    const dist = size * 2.2;
    return {
      center: [frameDims.width / 2, frameDims.height / 2, frameDims.depth / 2],
      distance: dist,
      far: dist * 20,
    };
  }
  const files = Array.isArray((voxels as VoxelsFile).voxels)
    ? [voxels as VoxelsFile]
    : Object.values(voxels as Record<string, VoxelsFile>);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const file of files) {
    for (const v of file.voxels) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  if (minX > maxX) {
    // No voxels to frame yet — a neutral default.
    return { center: [0, 0, 0], distance: 32, far: 400 };
  }
  const center: Vec3 = [
    (minX + maxX + 1) / 2,
    (minY + maxY + 1) / 2,
    (minZ + maxZ + 1) / 2,
  ];
  const size = Math.max(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1, 1);
  const dist = size * 2.2;
  return { center, distance: dist, far: dist * 20 };
}
