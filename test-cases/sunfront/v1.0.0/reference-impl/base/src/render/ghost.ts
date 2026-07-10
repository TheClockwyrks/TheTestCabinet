/**
 * Sunfront — the build-placement ghost (specs/flow.md controls).
 *
 * When a build type is armed, the cursor shows a ghost over the build-grid cell it is
 * hovering: a translucent footprint filling the cell plus a wireframe box standing in
 * it, tinted the **valid/selection** colour where the cell is empty and affordable and
 * the **invalid** colour otherwise (an unaffordable or occupied cell does not place —
 * `specs/flow.md`). It is a UI aid, not inspectable geometry, so it is deliberately kept
 * out of the F4 wireframe registry.
 */

import * as THREE from "three";
import { PALETTE, BUILD_CELL_SIZE } from "../constants";

const GHOST_HEIGHT = 70;

export class PlacementGhost {
  private readonly group = new THREE.Group();
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly valid = new THREE.Color(PALETTE.valid);
  private readonly invalid = new THREE.Color(PALETTE.invalid);

  constructor(scene: THREE.Scene) {
    this.fillMat = new THREE.MeshBasicMaterial({
      color: this.valid,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(BUILD_CELL_SIZE, BUILD_CELL_SIZE), this.fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.6;
    this.group.add(fill);

    this.lineMat = new THREE.LineBasicMaterial({ color: this.valid, transparent: true, opacity: 0.9 });
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(BUILD_CELL_SIZE * 0.7, GHOST_HEIGHT, BUILD_CELL_SIZE * 0.7)),
      this.lineMat,
    );
    box.position.y = GHOST_HEIGHT / 2;
    this.group.add(box);

    this.group.visible = false;
    this.group.renderOrder = 6;
    scene.add(this.group);
  }

  /** Show the ghost centred at `(x, z)`, coloured by whether placement is allowed. */
  showAt(x: number, z: number, allowed: boolean): void {
    this.group.position.set(x, 0, z);
    const c = allowed ? this.valid : this.invalid;
    this.fillMat.color.copy(c);
    this.lineMat.color.copy(c);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
  }
}
