/**
 * The contract types the voxel runtime operates on, re-exported from the
 * generated `@test-cabinet/run-record` package so there is a single source of
 * truth for the wire shapes. Nothing here is voxel-runtime-specific except the
 * {@link Vec3} tuple alias used by the posing math.
 */

export type {
  // Regenerated voxel data (`voxels.json`).
  VoxelsFile,
  VoxelDims,
  VoxelCell,
  // The rig (`rig.json` / resolved `ModelSpec`).
  ModelSpec,
  PartSpec,
  JointSpec,
  JointKindSpec,
  AxisSpec,
  DriveKindSpec,
  // The model-authored F-curve animations (`rig.animations`).
  InterpSpec,
  KeyframeSpec,
  AnimationSpec,
  AnimationTrackSpec,
} from "@test-cabinet/run-record";

/** An integer or real 3-vector `[x, y, z]`. */
export type Vec3 = [number, number, number];
