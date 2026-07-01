import * as THREE from "three";
import type { JointSpec, ModelSpec, VoxelsFile } from "../contract";
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

const isVoxelsFile = (v: Record<string, VoxelsFile> | VoxelsFile): v is VoxelsFile =>
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

  /** Advance the playback clock by `dtSeconds` and re-pose. */
  update(dtSeconds: number): void {
    this.timeMs += dtSeconds * 1000;
    this.applyPose();
  }

  /** The joint names, optionally filtered to a single drive kind. */
  jointNames(drive?: "caller" | "auto"): string[] {
    const joints = drive ? this.rig.joints.filter((j) => j.drive === drive) : this.rig.joints;
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

  /** Rig posed for the current frame given `activeClip`, holding others at rest. */
  private posableRig(): ModelSpec {
    if (this.activeClip === null) return this.rig;
    const active = this.activeClip;
    return {
      parts: this.rig.parts,
      joints: this.rig.joints.map((j): JointSpec =>
        j.drive === "auto" && j.name !== active
          ? { ...j, drive: "caller", auto: undefined }
          : j,
      ),
    };
  }

  private applyPose(): void {
    const posed = poseRig(this.posableRig(), { caller: this.caller, timeMs: this.timeMs });
    for (const part of posed) {
      const group = this.groups.get(part.name);
      if (group) group.matrix.fromArray(part.worldMatrix);
    }
  }
}
