import * as THREE from "three";
import type { VoxelsFile } from "../contract";
import { buildPartMesh } from "../mesh";

/**
 * Build a single {@link THREE.BufferGeometry} for one part's voxels, baking each
 * voxel's `#rrggbb` color into per-vertex colors (one geometry / one draw call).
 *
 * Interior faces shared with an adjacent occupied voxel are culled, so only the
 * visible surface is emitted. Use a material with `vertexColors: true`. The
 * geometry is built from the framework-agnostic {@link buildPartMesh} so this and
 * the glTF exporter emit identical geometry.
 */
export function buildPartGeometry(voxels: VoxelsFile): THREE.BufferGeometry {
  const mesh = buildPartMesh(voxels);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
