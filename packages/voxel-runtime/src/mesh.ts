/**
 * Framework-agnostic voxel → mesh conversion.
 *
 * Turns a part's sparse {@link VoxelsFile} into a single indexed triangle mesh
 * with per-vertex colors, as plain typed arrays with **no rendering dependency**.
 * Interior faces shared with an adjacent occupied voxel are culled, so only the
 * visible surface is emitted (one quad → two triangles per exposed cube face).
 *
 * The three.js binding ({@link "@test-cabinet/voxel-runtime/three"}'s
 * `buildPartGeometry`) wraps this to produce a `THREE.BufferGeometry`, and the
 * `scripts/voxel-to-gltf.mjs` exporter uses it to write glTF mesh primitives, so
 * both render the exact same geometry.
 */

import type { Vec3, VoxelsFile } from "./contract";

/** One cube face: its outward normal and four corner offsets in CCW order. */
interface Face {
  dir: Vec3;
  corners: [Vec3, Vec3, Vec3, Vec3];
}

// Unit-cube faces from (x,y,z) to (x+1,y+1,z+1). Corner offsets are wound
// counter-clockwise as seen from outside (standard front-facing winding), so
// back-face culling keeps the outward faces.
const FACES: readonly Face[] = [
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
];

/** A `#rrggbb` string to a linear-order `[r, g, b]` in `0..1`. */
export function hexToRgb(hex: string): Vec3 {
  const h = hex.charCodeAt(0) === 35 /* '#' */ ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  if (h.length === 6 && !Number.isNaN(n)) {
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }
  return [1, 1, 1];
}

const cellKey = (x: number, y: number, z: number): number =>
  // Bias into non-negative range so signed coordinates keep distinct keys.
  ((x + 1024) * 4096 + (y + 1024)) * 4096 + (z + 1024);

/**
 * A part's surface mesh as plain typed arrays: an indexed triangle list with a
 * position, normal, and linear `0..1` RGB color per vertex. Directly consumable by
 * any renderer or glTF writer (four floats per exposed face vertex, six indices
 * per exposed face).
 */
export interface PartMesh {
  /** Vertex positions, 3 floats (x, y, z) per vertex, in voxel units. */
  positions: Float32Array;
  /** Vertex normals, 3 floats per vertex (unit face normals). */
  normals: Float32Array;
  /** Vertex colors, 3 floats (r, g, b) in `0..1` per vertex. */
  colors: Float32Array;
  /** Triangle indices into the vertex arrays, 3 per triangle. */
  indices: Uint32Array;
}

/**
 * Build the surface mesh for one part's voxels, culling interior faces and baking
 * each voxel's `#rrggbb` into per-vertex colors.
 */
export function buildPartMesh(voxels: VoxelsFile): PartMesh {
  const occupied = new Set<number>();
  for (const v of voxels.voxels) occupied.add(cellKey(v.x, v.y, v.z));

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let base = 0;

  for (const v of voxels.voxels) {
    const [r, g, b] = hexToRgb(v.color);
    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      if (occupied.has(cellKey(v.x + dx, v.y + dy, v.z + dz))) continue;
      for (const c of face.corners) {
        positions.push(v.x + c[0], v.y + c[1], v.z + c[2]);
        normals.push(dx, dy, dz);
        colors.push(r, g, b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
