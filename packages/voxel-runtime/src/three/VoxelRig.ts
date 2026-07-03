import * as THREE from "three";
import type { AnimationSpec, ModelSpec, PartMesh } from "../contract";
import { sampleAnimation } from "../clips";
import { poseRig } from "../hierarchy";
import { buildPartGeometry } from "./buildMesh";

/** Options for {@link VoxelRig}. */
export interface VoxelRigOptions {
  /**
   * Material used for every part mesh. Defaults to a `MeshStandardMaterial`
   * with `vertexColors: true` (the scene must supply lighting). The rig takes
   * ownership only of the default material (it is disposed by
   * {@link VoxelRig.dispose}); a caller-supplied material is left alone.
   */
  material?: THREE.Material;
  /** Initial playback clock, in milliseconds. Defaults to `0`. */
  timeMs?: number;
}

// A single (static-model) `PartMesh` versus a by-part map: a `PartMesh` carries the
// geometry arrays directly, whereas the map is keyed by part name and its values are
// the meshes. Testing for the mesh's own `positions`/`indices` arrays distinguishes
// them (a part is never named `positions`).
const isPartMesh = (v: Record<string, PartMesh> | PartMesh): v is PartMesh =>
  Array.isArray((v as PartMesh).indices) ||
  ArrayBuffer.isView((v as PartMesh).indices);

/**
 * A posable three.js voxel rig: one {@link THREE.Group} per part (all parented
 * under {@link VoxelRig.root}) carrying a single vertex-colored mesh, loaded
 * straight from that part's {@link PartMesh} (`mesh.json`) — the runtime never
 * re-meshes.
 *
 * `pose`/`update` run {@link poseRig} and write each part's **world** matrix onto
 * its group (`matrixAutoUpdate = false`), so the groups are held flat under
 * `root` and the resolved world transforms compose correctly beneath whatever
 * transform the consumer applies to `root`.
 */
export class VoxelRig {
  /** The scene node to add to your three.js scene. */
  readonly root: THREE.Group;

  private readonly rig: ModelSpec;
  private readonly groups = new Map<string, THREE.Group>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterial: THREE.Material | null;
  private readonly material: THREE.Material;

  private caller: Record<string, number> = {};
  private timeMs: number;
  /**
   * The animation playing, or `null`. When set, each of its tracks poses its joint
   * from the F-curve sampled at {@link timeMs} (overlaid onto the caller values), so
   * `update` walks the animation forward. Defaults to the rig's `autoPlay` animation
   * (a decorative idle) so it plays continuously without being triggered.
   */
  private activeAnimation: AnimationSpec | null = null;

  /**
   * @param rig the parts, joints, and animations to pose.
   * @param meshesByPart each part's produced {@link PartMesh} (`mesh.json`), keyed
   *   by part name — or a single `PartMesh` for a static model (assigned to the
   *   first part). A part with no entry, or an empty mesh, renders as an empty
   *   group (an attach socket).
   */
  constructor(
    rig: ModelSpec,
    meshesByPart: Record<string, PartMesh> | PartMesh,
    opts: VoxelRigOptions = {},
  ) {
    this.rig = rig;
    this.timeMs = opts.timeMs ?? 0;
    // An `autoPlay` animation (a decorative idle) plays continuously by default,
    // until the game triggers a named playable with `playAnimation`.
    this.activeAnimation = rig.animations?.find((a) => a.autoPlay) ?? null;

    if (opts.material) {
      this.material = opts.material;
      this.ownedMaterial = null;
    } else {
      this.material = new THREE.MeshStandardMaterial({ vertexColors: true });
      this.ownedMaterial = this.material;
    }

    this.root = new THREE.Group();
    this.root.name = "voxel-rig";

    const single = isPartMesh(meshesByPart);
    const rootPart = rig.parts[0];

    for (const part of rig.parts) {
      const group = new THREE.Group();
      group.name = part.name;
      group.matrixAutoUpdate = false;

      const mesh = single
        ? part === rootPart
          ? meshesByPart
          : undefined
        : meshesByPart[part.name];

      if (mesh && mesh.indices.length > 0) {
        const geometry = buildPartGeometry(mesh);
        this.geometries.push(geometry);
        const meshNode = new THREE.Mesh(geometry, this.material);
        meshNode.name = `${part.name}:mesh`;
        group.add(meshNode);
      }

      this.groups.set(part.name, group);
      this.root.add(group);
    }

    this.applyPose();
  }

  /** Set caller-driven joint values (clamped to range) and re-pose. */
  pose(caller: Record<string, number>): void {
    this.caller = caller;
    this.applyPose();
  }

  /**
   * Play one of the model's {@link AnimationSpec} animations — by its
   * {@link AnimationSpec} object or its `name` — or `null` to stop (falling back to
   * the rig's `autoPlay` idle if it has one). Each of the animation's tracks poses
   * its joint from the F-curve sampled at the current clock, overlaying only the
   * joints it drives — every other joint holds at its caller/rest pose — so driving
   * {@link update} walks the whole choreography forward independently of the caller
   * values set by {@link pose}.
   */
  playAnimation(animation: AnimationSpec | string | null): void {
    if (animation === null) {
      this.activeAnimation = this.rig.animations?.find((a) => a.autoPlay) ?? null;
    } else if (typeof animation === "string") {
      this.activeAnimation =
        this.rig.animations?.find((a) => a.name === animation) ?? null;
    } else {
      this.activeAnimation = animation;
    }
    this.applyPose();
  }

  /** Advance the playback clock by `dtSeconds` and re-pose. */
  update(dtSeconds: number): void {
    this.timeMs += dtSeconds * 1000;
    this.applyPose();
  }

  /**
   * Seek the playback clock to an absolute time (in milliseconds) and re-pose.
   * Unlike {@link update}, which advances by a delta driven off a wall clock,
   * this poses the rig at an exact time — so a caller can sample deterministic,
   * evenly-spaced frames of a clip (e.g. baking an animation to a GIF or glTF)
   * independent of real time.
   */
  seek(timeMs: number): void {
    this.timeMs = timeMs;
    this.applyPose();
  }

  /** The joint names, optionally filtered to a single drive kind. */
  jointNames(drive?: "caller" | "auto"): string[] {
    const joints = drive
      ? this.rig.joints.filter((j) => j.drive === drive)
      : this.rig.joints;
    return joints.map((j) => j.name);
  }

  /** The `{ min, max, rest }` range of a named joint. */
  jointRange(name: string): { min: number; max: number; rest: number } {
    const joint = this.rig.joints.find((j) => j.name === name);
    if (!joint) throw new Error(`voxel-runtime: unknown joint "${name}"`);
    return { min: joint.min, max: joint.max, rest: joint.rest };
  }

  /** Release GPU geometry and the default material, and detach the groups. */
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.length = 0;
    this.ownedMaterial?.dispose();
    for (const group of this.groups.values()) group.removeFromParent();
    this.groups.clear();
    this.root.removeFromParent();
  }

  private applyPose(): void {
    // Overlay the active animation's sampled joint values onto the caller values, so
    // the animation drives its joints (both `caller` and `auto` alike) while every
    // joint it does not touch stays at its caller/rest pose. `poseRig` reads every
    // joint from this one map, so no per-joint drive rewriting is needed.
    const caller = this.activeAnimation
      ? {
          ...this.caller,
          ...sampleAnimation(this.activeAnimation, this.timeMs),
        }
      : this.caller;
    const posed = poseRig(this.rig, { caller, timeMs: this.timeMs });
    for (const part of posed) {
      const group = this.groups.get(part.name);
      if (group) group.matrix.fromArray(part.worldMatrix);
    }
  }
}
