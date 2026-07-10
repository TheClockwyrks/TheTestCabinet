/**
 * Sunfront — one-off singletons via `VoxelRig` (specs/assets.md).
 *
 * The many small units are GPU-instanced ({@link InstancedUnitRenderer}); the few
 * large one-offs — the two bases, two Reliquaries, the placed Solar Extractors and
 * spawners, and the lone Aegis — are rendered with the runtime's `VoxelRig` directly,
 * one scene subtree each. There are only a handful on the field, so per-instance
 * Groups cost nothing and keep this path simple. Each carries its own tinted material
 * (registered for the F4 wireframe toggle), is placed with the shared placement math,
 * and animates its idle / emit / attack clip through the rig's own posing.
 */

import * as THREE from "three";
import { VoxelRig } from "../runtime";
import type { PartMesh } from "../runtime";
import type { RigTemplate, Team } from "../types";
import { MaterialRegistry, createTintedMaterial, teamTint } from "./materials";
import { applyPlacement } from "./placement";

/** One placed, animating singleton (a base, Reliquary, extractor, spawner, or Aegis). */
export class SingletonActor {
  readonly rig: VoxelRig;
  private readonly template: RigTemplate;

  constructor(
    scene: THREE.Scene,
    template: RigTemplate,
    team: Team | "neutral",
    registry: MaterialRegistry,
  ) {
    this.template = template;
    const material = createTintedMaterial(registry, teamTint(team));
    const meshes: Record<string, PartMesh> = {};
    for (const [name, mesh] of template.meshes) meshes[name] = mesh;
    this.rig = new VoxelRig(template.rig, meshes, { material });
    scene.add(this.rig.root);
  }

  /** Place on the ground plane facing `yaw` (specs/playfield.md). */
  place(x: number, z: number, yaw: number, altitude = 0): this {
    applyPlacement(this.rig.root, x, altitude, z, yaw, this.template.bounds);
    return this;
  }

  /** Play the clip for a game role (idle / emit / attack), if the rig has one. */
  setRole(role: string): this {
    this.rig.playAnimation(this.template.clips.get(role) ?? null);
    return this;
  }

  /** Drive caller joints (e.g. Aegis turret yaw/pitch); composes over the active clip. */
  poseCaller(caller: Record<string, number>): this {
    this.rig.pose(caller);
    return this;
  }

  /** Advance this singleton's animation clock. */
  update(dtSeconds: number): void {
    this.rig.update(dtSeconds);
  }

  /** Remove from the scene and release GPU resources. */
  dispose(): void {
    this.rig.root.parent?.remove(this.rig.root);
    this.rig.dispose();
  }
}
