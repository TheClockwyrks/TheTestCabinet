/**
 * Sunfront — the GPU-instanced voxel unit renderer (specs/assets.md, the crux).
 *
 * The roster is uniform rigid rigs, which is what lets one instanced pipeline draw
 * every unit. At load, for each unit type we build ONE `THREE.BufferGeometry` per part
 * (reused across all instances of that type) and ONE `THREE.InstancedMesh` per
 * (type, part), sharing a single lit material and carrying a per-instance `instanceColor`
 * for the team tint. Each frame we pose every live unit with the runtime's own math
 * (`sampleAnimation` overlaid on any caller joints, then `poseRig`) and write
 * `M_place · partWorldMatrix` into that unit's instance slot in every one of its parts.
 *
 * Instancing is why a heavy late-match battle stays interactive: dozens of units of a
 * type cost one draw call per part, not one scene graph per unit.
 */

import * as THREE from "three";
import { poseRig, sampleAnimation } from "../runtime";
import type { RenderEntity, RigTemplate, UnitType } from "../types";
import { instanceColor } from "./materials";
import { placeMatrix } from "./placement";

/** Max simultaneous instances per unit type (generous for a heavy late-match battle). */
const CAPACITY = 256;

interface TypeRecord {
  readonly template: RigTemplate;
  /** One InstancedMesh per part that has geometry, keyed by part name. */
  readonly parts: Map<string, THREE.InstancedMesh>;
}

export class InstancedUnitRenderer {
  readonly group = new THREE.Group();
  private readonly byType = new Map<UnitType, TypeRecord>();

  // Per-frame scratch (no per-instance allocation).
  private readonly place = new THREE.Matrix4();
  private readonly world = new THREE.Matrix4();
  private readonly final = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    unitTemplates: ReadonlyMap<UnitType, RigTemplate>,
    material: THREE.Material,
  ) {
    for (const [type, template] of unitTemplates) {
      const parts = new Map<string, THREE.InstancedMesh>();
      for (const [partName, geom] of template.geometries) {
        const mesh = new THREE.InstancedMesh(geom, material, CAPACITY);
        mesh.frustumCulled = false; // instances span the arena; culling by the shared box is wrong
        mesh.count = 0;
        // Enable the per-instance colour buffer (team tint) up front.
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
        parts.set(partName, mesh);
        this.group.add(mesh);
      }
      this.byType.set(type, { template, parts });
    }
    scene.add(this.group);
  }

  /**
   * Repopulate every instance from the live unit list for this frame. Units are packed
   * into instance slots per type in list order; each type's InstancedMesh `count` is
   * set to the number of live units of that type so stale slots are not drawn.
   */
  sync(units: readonly RenderEntity[], typeOf: (e: RenderEntity) => UnitType | null): void {
    const counts = new Map<UnitType, number>();

    for (const u of units) {
      const type = typeOf(u);
      if (type === null) continue;
      const rec = this.byType.get(type);
      if (!rec) continue;
      const i = counts.get(type) ?? 0;
      if (i >= CAPACITY) continue;
      counts.set(type, i + 1);

      // Active animation overlaid on any caller-driven joints, then pose the rig.
      const clip = rec.template.clips.get(u.role) ?? rec.template.clips.get("idle");
      const caller: Record<string, number> = u.caller ? { ...u.caller } : {};
      if (clip) Object.assign(caller, sampleAnimation(clip, u.animMs));
      const posed = poseRig(rec.template.rig, { caller, timeMs: u.animMs });

      placeMatrix(this.place, u.x, u.altitude, u.z, u.yaw, rec.template.bounds);
      instanceColor(this.color, u.team, u.flash ?? 0, u.accent ?? false);

      for (const pp of posed) {
        const mesh = rec.parts.get(pp.name);
        if (!mesh) continue;
        this.world.fromArray(pp.worldMatrix);
        this.final.multiplyMatrices(this.place, this.world);
        mesh.setMatrixAt(i, this.final);
        mesh.setColorAt(i, this.color);
      }
    }

    for (const [type, rec] of this.byType) {
      const c = counts.get(type) ?? 0;
      for (const mesh of rec.parts.values()) {
        mesh.count = c;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
