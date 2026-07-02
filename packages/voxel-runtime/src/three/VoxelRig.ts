import * as THREE from "three";
import type {
  AnimationSpec,
  JointSpec,
  ModelSpec,
  VoxelsFile,
} from "../contract";
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

const isVoxelsFile = (
  v: Record<string, VoxelsFile> | VoxelsFile,
): v is VoxelsFile =>
  Array.isArray((v as VoxelsFile).voxels) &&
  typeof (v as VoxelsFile).dims === "object";

/**
 * A posable three.js voxel rig: one {@link THREE.Group} per part (all parented
 * under {@link VoxelRig.root}) carrying a single culled, vertex-colored mesh.
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
  /** Which auto-play joint animates; `null` plays every auto-play joint. */
  private activeClip: string | null = null;
  /**
   * The named animation playing, or `null`. When set, each of its tracks poses its
   * joint from the animation sampled at {@link timeMs} (overriding caller values and
   * any auto clip on that joint), so `update` walks the animation forward.
   */
  private activeAnimation: AnimationSpec | null = null;

  constructor(
    rig: ModelSpec,
    voxelsByPart: Record<string, VoxelsFile> | VoxelsFile,
    opts: VoxelRigOptions = {},
  ) {
    this.rig = rig;
    this.timeMs = opts.timeMs ?? 0;

    if (opts.material) {
      this.material = opts.material;
      this.ownedMaterial = null;
    } else {
      this.material = new THREE.MeshStandardMaterial({ vertexColors: true });
      this.ownedMaterial = this.material;
    }

    this.root = new THREE.Group();
    this.root.name = "voxel-rig";

    const single = isVoxelsFile(voxelsByPart);
    const rootPart = rig.parts[0];

    for (const part of rig.parts) {
      const group = new THREE.Group();
      group.name = part.name;
      group.matrixAutoUpdate = false;

      const voxels = single
        ? part === rootPart
          ? voxelsByPart
          : undefined
        : voxelsByPart[part.name];

      if (voxels && voxels.voxels.length > 0) {
        const geometry = buildPartGeometry(voxels);
        this.geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = `${part.name}:mesh`;
        group.add(mesh);
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
   * Choose which auto-play joint animates: a joint name to isolate it, or `null`
   * to play every auto-play joint. Non-active auto joints are held at rest.
   */
  play(clipJointName: string | null): void {
    this.activeClip = clipJointName;
    this.applyPose();
  }

  /**
   * Play a named, predetermined {@link AnimationSpec} (or `null` to stop): each of
   * its tracks poses its joint from the animation sampled at the current clock, so
   * driving {@link update} walks the whole animation forward. This is independent of
   * the caller values set by {@link pose} — the animation overrides only the joints
   * it drives — and of the auto clip chosen by {@link play}.
   */
  playAnimation(animation: AnimationSpec | null): void {
    this.activeAnimation = animation;
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

  /**
   * Rig posed for the current frame. An isolated `activeClip` holds every other
   * auto joint at rest, and every joint an `activeAnimation` drives is forced to
   * caller so its sampled value (applied in {@link applyPose}) poses the rig even if
   * the joint would otherwise auto-play. With neither active, the rig is unchanged.
   */
  private posableRig(): ModelSpec {
    const animated = this.activeAnimation
      ? new Set(this.activeAnimation.tracks.map((t) => t.joint))
      : null;
    const active = this.activeClip;
    if (active === null && animated === null) return this.rig;
    return {
      parts: this.rig.parts,
      joints: this.rig.joints.map((j): JointSpec => {
        // A joint the animation drives is posed from the sampled caller value.
        if (animated?.has(j.name) && j.drive === "auto") {
          return { ...j, drive: "caller", auto: undefined };
        }
        // Isolate the active clip: every other auto joint holds at rest.
        if (active !== null && j.drive === "auto" && j.name !== active) {
          return { ...j, drive: "caller", auto: undefined };
        }
        return j;
      }),
      animations: this.rig.animations,
    };
  }

  private applyPose(): void {
    // Overlay the active animation's sampled joint values on the caller values, so
    // an animation drives its joints while any others stay at their caller pose.
    const caller = this.activeAnimation
      ? {
          ...this.caller,
          ...sampleAnimation(this.activeAnimation, this.timeMs),
        }
      : this.caller;
    const posed = poseRig(this.posableRig(), { caller, timeMs: this.timeMs });
    for (const part of posed) {
      const group = this.groups.get(part.name);
      if (group) group.matrix.fromArray(part.worldMatrix);
    }
  }
}
