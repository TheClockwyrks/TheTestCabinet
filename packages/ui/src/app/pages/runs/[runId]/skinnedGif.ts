import type { AnimationSpec, ModelSpec } from "@test-cabinet/run-record";
import type { PartMesh, SkinnedMesh } from "@test-cabinet/voxel-runtime";
import { SkinnedVoxelRig } from "@test-cabinet/voxel-runtime/three";
import { encodeRigGif } from "./voxelGif";
import { framing } from "./voxelScene";

export type SkinnedGifInput = {
  /** The decoded skinned mesh (geometry + `JOINTS_0`/`WEIGHTS_0` + skeleton). */
  mesh: SkinnedMesh;
  /** The rig to pose (its parts are the bones; joints/animations drive them). */
  rig: ModelSpec;
  /** The animation to bake (or null to bake the rig's `autoPlay` idle). */
  animation: AnimationSpec | null;
  /** Static caller-joint values held while the animation plays (it overrides only
   * the joints it drives). */
  callerJoints: Record<string, number>;
  /** The loop length in ms — the animation's `periodMs`. */
  periodMs: number;
  /** Solid background color (the preview panel's color), composited behind the
   * model so anti-aliased edges stay clean (a GIF's 1-bit alpha can't). */
  background: string;
};

/**
 * Bake one **skinned** voxel animation into a looping GIF, sharing the offscreen
 * renderer/encoder core with the rigid path (see {@link encodeRigGif}). Builds a
 * {@link SkinnedVoxelRig} from the run's rig and single decoded {@link SkinnedMesh},
 * poses it at the static caller joints, and cues its animation (or `null` for the
 * rig's `autoPlay` idle) — the skin then deforms by linear-blend skinning as the
 * shared core steps it across one period, exactly as the interactive preview shows.
 *
 * The camera is framed from the mesh's bind-pose bounds (a {@link SkinnedMesh} carries
 * the same flat `positions` a {@link PartMesh} does), matching {@link SkinnedVoxelViewer}.
 *
 * Throws if a WebGL context can't be created.
 */
export async function encodeSkinnedGif({
  mesh,
  rig,
  animation,
  callerJoints,
  periodMs,
  background,
}: SkinnedGifInput): Promise<Blob> {
  return encodeRigGif({
    buildRig: () => {
      const skinnedRig = new SkinnedVoxelRig(rig, mesh);
      skinnedRig.pose(callerJoints);
      // A named animation to bake, or `null` to fall back to the `autoPlay` idle.
      skinnedRig.playAnimation(animation);
      return skinnedRig;
    },
    framing: framing(mesh as unknown as PartMesh),
    periodMs,
    background,
  });
}
