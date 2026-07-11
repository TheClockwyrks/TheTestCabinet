/**
 * A single import barrel for the provided runtimes (specs/assets.md).
 *
 * Sunfront consumes its assets ONLY through `@test-cabinet/voxel-runtime` (the rig
 * posing/clip math and its `/three` binding) and `@test-cabinet/particle-runtime`
 * (the muzzle-flash simulator and its `/three` binding) — the same libraries the
 * rigs and effects were authored against. Funnelling both through this module keeps
 * the package paths in one place and documents that the build writes neither a glTF
 * loader/animation mixer nor a particle simulator of its own.
 */

// Voxel-runtime core — the pure posing math (no three).
export {
  parseGlb,
  poseRig,
  sampleAnimation,
  identity,
  multiply,
  translation,
  rotation,
  eulerRotation,
} from "@test-cabinet/voxel-runtime";
export type {
  ModelSpec,
  PartSpec,
  JointSpec,
  JointKindSpec,
  AxisSpec,
  DriveKindSpec,
  InterpSpec,
  KeyframeSpec,
  AnimationSpec,
  AnimationTrackSpec,
  PartMesh,
  PosedPart,
  PoseInput,
} from "@test-cabinet/voxel-runtime";

// Voxel-runtime three binding — geometry building + the one-off VoxelRig.
export { buildPartGeometry, VoxelRig } from "@test-cabinet/voxel-runtime/three";
export type { VoxelRigOptions } from "@test-cabinet/voxel-runtime/three";

// Particle-runtime — the muzzle-flash system type and its three billboard player.
export type { ParticleSystem } from "@test-cabinet/particle-runtime";
export { ParticleSystemPlayer } from "@test-cabinet/particle-runtime/three";
export type { ParticleSystemPlayerOptions } from "@test-cabinet/particle-runtime/three";
