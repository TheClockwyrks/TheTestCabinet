/**
 * Sunfront — shared placement math (specs/assets.md).
 *
 * Every rig — a GPU-instanced unit part or a one-off `VoxelRig` singleton — is placed
 * on the ground plane the same way: its footprint is centred on the unit's `(x, z)`,
 * its sculpted floor is dropped onto `y = altitude`, and it is rotated to its facing
 * yaw. The rigs are authored in a positive octant (not about their own centre) and
 * grounded near `y = 0` in model units that already equal logical units (a Monolith
 * towers over a Scarab with no per-model renormalisation), so the only correction is
 * the rest-pose recentre carried on each {@link RigBounds}.
 *
 * `M_place = T(x, altitude, z) · R_y(yaw) · T(-centerX, -minY, -centerZ)` — a rigid
 * transform (unit scale). For instanced parts we need the full matrix (to compose
 * with each posed part's world matrix); for singletons we set an `Object3D`'s
 * position/quaternion directly from the same decomposition.
 */

import * as THREE from "three";
import type { RigBounds } from "../types";

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const scratchRot = new THREE.Matrix4();
const scratchRecentre = new THREE.Matrix4();
const scratchCentre = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();

/**
 * Write `M_place` for one instance into {@link out}: place the rig's centred footprint
 * at `(x, z)`, drop its floor to `altitude`, and face `yaw`.
 */
export function placeMatrix(
  out: THREE.Matrix4,
  x: number,
  altitude: number,
  z: number,
  yaw: number,
  bounds: RigBounds,
): THREE.Matrix4 {
  out.makeTranslation(x, altitude, z);
  scratchRot.makeRotationY(yaw);
  out.multiply(scratchRot);
  scratchRecentre.makeTranslation(-bounds.centerX, -bounds.minY, -bounds.centerZ);
  out.multiply(scratchRecentre);
  return out;
}

/**
 * Apply the same placement to a singleton `Object3D` (its `VoxelRig.root`) via
 * position + quaternion, so `matrixAutoUpdate` can stay on: the recentre folds into
 * the position as `t = pos − R_y·centre`.
 */
export function applyPlacement(
  obj: THREE.Object3D,
  x: number,
  altitude: number,
  z: number,
  yaw: number,
  bounds: RigBounds,
): void {
  scratchQuat.setFromAxisAngle(Y_AXIS, yaw);
  obj.quaternion.copy(scratchQuat);
  scratchCentre.set(bounds.centerX, bounds.minY, bounds.centerZ).applyQuaternion(scratchQuat);
  obj.position.set(x - scratchCentre.x, altitude - scratchCentre.y, z - scratchCentre.z);
}
