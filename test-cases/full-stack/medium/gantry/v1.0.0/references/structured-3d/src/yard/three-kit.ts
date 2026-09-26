// The small `three` vocabulary the yard's own geometry is built from.
//
// `specs/overview.md` leaves the members, the aids, the pads, and the site's
// fixtures to be drawn in code, and the engine's direct path into the world
// pass is `Object3DComponent`: a subtree of the game's own `three` objects the
// pipeline places, shows, and fades like any other render component. Everything
// here builds or poses one of those objects. Nothing reads the state.

import * as THREE from "three";
import { DEG, type Box, type Vec3 as SimVec3 } from "../sim";
import type { Placement } from "../posture";

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A pool of one kind of object, taken and released a frame at a time.
 *
 * The crane changes shape every tick, so the alternative — building and
 * disposing meshes each frame — would churn the GPU for no gain. A pooled
 * object is reused for a different member next frame, and the ones a frame does
 * not take are hidden rather than removed.
 */
export class Pool<T extends THREE.Object3D> {
  private readonly items: T[] = [];
  private used = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly make: () => T,
  ) {}

  begin(): void {
    this.used = 0;
  }

  take(): T {
    let item = this.items[this.used];
    if (item === undefined) {
      item = this.make();
      this.items.push(item);
      this.parent.add(item);
    }
    item.visible = true;
    this.used += 1;
    return item;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) {
      this.items[i].visible = false;
    }
  }

  /** How many objects the pool has built, which a test counts. */
  get size(): number {
    return this.items.length;
  }

  /** How many the last frame took. */
  get taken(): number {
    return this.used;
  }
}

/**
 * Pose a bar of unit geometry between two world points, with a chosen
 * cross-section. The bar's own frame is built from its direction so the
 * "across" axis is horizontal for any member that is not vertical, which is
 * what makes a rail's flat profile read as a track.
 */
export function poseBar(
  object: THREE.Object3D,
  a: SimVec3,
  b: SimVec3,
  across: number,
  through: number,
  lift = 0,
): void {
  const from = new THREE.Vector3(a[0], a[1], a[2]);
  const to = new THREE.Vector3(b[0], b[1], b[2]);
  const along = to.clone().sub(from);
  const length = along.length();
  if (length < 1e-9) {
    object.visible = false;
    return;
  }
  const dir = along.clone().divideScalar(length);
  let side = new THREE.Vector3().crossVectors(UP, dir);
  if (side.lengthSq() < 1e-9) side = new THREE.Vector3(1, 0, 0);
  side.normalize();
  const other = new THREE.Vector3().crossVectors(dir, side).normalize();
  const centre = from.clone().add(to).multiplyScalar(0.5);
  if (lift !== 0) centre.addScaledVector(other, lift);
  object.matrixAutoUpdate = false;
  object.matrix.makeBasis(
    side.multiplyScalar(across),
    dir.clone().multiplyScalar(length),
    other.clone().multiplyScalar(through),
  );
  object.matrix.setPosition(centre);
  object.matrixWorldNeedsUpdate = true;
}

/** Stand a group where a produced model's subject is (`specs/assets.md`). */
export function place(group: THREE.Object3D, placement: Placement): void {
  group.matrixAutoUpdate = true;
  group.position.set(placement.centre[0], placement.baseY, placement.centre[2]);
  // A positive yaw carries `+x` toward `+z` (`specs/world.md`), which is a
  // negative rotation about `three`'s own `+y`.
  group.rotation.set(0, -placement.yaw * DEG, 0);
}

/** An axis-aligned box as the centre and the size a `BoxGeometry` takes. */
export const boxOf = (box: Box): { centre: SimVec3; size: SimVec3 } => ({
  centre: [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ],
  size: [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ],
});

/** Colour a lit bar, with an optional glow so it reads past the ramp's top. */
export function paint(mesh: THREE.Mesh, colour: number, glow: number): void {
  const material = mesh.material as THREE.MeshLambertMaterial;
  material.color.setHex(colour);
  material.emissive.setHex(colour);
  material.emissiveIntensity = Math.max(0, glow);
}

/** Colour an unlit marker. */
export function paintBasic(
  mesh: THREE.Mesh,
  colour: number,
  opacity: number,
): void {
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.color.setHex(colour);
  material.opacity = opacity;
}

/** Release every geometry and material a subtree holds. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh>;
    if (mesh.geometry !== undefined) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else if (material !== undefined) material.dispose();
  });
}
