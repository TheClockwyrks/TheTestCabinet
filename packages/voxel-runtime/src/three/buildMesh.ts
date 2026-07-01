import * as THREE from "three";
import type { Vec3, VoxelsFile } from "../contract";

/** One cube face: its outward normal and four corner offsets in CCW order. */
interface Face {
  dir: Vec3;
  corners: [Vec3, Vec3, Vec3, Vec3];
}

// Unit-cube faces from (x,y,z) to (x+1,y+1,z+1). Corner offsets are wound
// counter-clockwise as seen from outside (three.js front faces), so back-face
// culling keeps the outward faces.
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

function hexToRgb(hex: string): Vec3 {
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
 * Build a single {@link THREE.BufferGeometry} for one part's voxels, baking each
 * voxel's `#rrggbb` color into per-vertex colors (one geometry / one draw call).
 *
 * Interior faces shared with an adjacent occupied voxel are culled, so only the
 * visible surface is emitted. Use a material with `vertexColors: true`.
 */
export function buildPartGeometry(voxels: VoxelsFile): THREE.BufferGeometry {
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

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
