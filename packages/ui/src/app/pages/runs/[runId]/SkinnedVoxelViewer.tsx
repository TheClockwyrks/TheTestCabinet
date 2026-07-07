import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import type { AnimationSpec, ModelSpec } from "@test-cabinet/run-record";
import type { PartMesh, SkinnedMesh } from "@test-cabinet/voxel-runtime";
import { SkinnedVoxelRig } from "@test-cabinet/voxel-runtime/three";
import {
  AMBIENT_INTENSITY,
  CAMERA_FOV,
  FILL_LIGHT,
  KEY_LIGHT,
  cameraPosition,
  framing,
  type Vec3,
} from "./voxelScene";
import type { VoxelViewMode } from "./VoxelViewer";
import { useViewportWheelLock } from "./useViewportWheelLock";

/**
 * The scene contents inside the {@link Canvas}: the posed skinned rig (centered at
 * the origin) plus a frame loop that advances any playing animation. Kept as a child
 * so it can call `useFrame`, which only works inside the R3F canvas.
 */
function SkinnedScene({
  rig,
  center,
  animate,
}: {
  rig: SkinnedVoxelRig;
  center: Vec3;
  animate: boolean;
}) {
  useFrame((_, dt) => {
    if (animate) rig.update(dt);
  });
  return (
    <group position={[-center[0], -center[1], -center[2]]}>
      <primitive object={rig.root} />
    </group>
  );
}

/**
 * Interactive 3D view of a produced **skinned** voxel model. Builds a
 * {@link SkinnedVoxelRig} from the run's rig ({@link ModelSpec}, inline in the run
 * record) and the single decoded skinned {@link SkinnedMesh}, then renders it in an
 * R3F {@link Canvas} — the skin deforming by linear-blend skinning as the rig poses,
 * rather than the rigid per-part posing of {@link VoxelViewer}.
 *
 * Default export so it can be `React.lazy`-loaded (see {@link GuardedSkinnedViewer}).
 * The caller gates the mount on WebGL support and reduced-motion.
 */
export default function SkinnedVoxelViewer({
  mesh,
  rig,
  mode,
  callerJoints,
  animation,
  enableZoom,
  height = 320,
  label,
}: {
  /** The decoded skinned mesh (geometry + `JOINTS_0`/`WEIGHTS_0` + skeleton). */
  mesh: SkinnedMesh;
  /** The rig to pose (parts are the bones; joints/animations drive them). */
  rig: ModelSpec;
  /** Whether the camera auto-rotates or is a still drag-to-inspect view. */
  mode: VoxelViewMode;
  /** Caller-driven joint values to pose the rig at. */
  callerJoints?: Record<string, number>;
  /** A model-authored animation to play, or null/omitted for the `autoPlay` idle. */
  animation?: AnimationSpec | null;
  /** Whether scroll-to-zoom is enabled. Off by default (inline views disable it). */
  enableZoom?: boolean;
  /** Canvas height in px. */
  height?: number;
  /** Accessible name for the canvas. */
  label: string;
}) {
  // Build the rig inside an effect (not `useMemo`) so its creation and disposal are
  // balanced under StrictMode's setup→cleanup→setup — mirroring VoxelViewer.
  const [skinnedRig, setSkinnedRig] = useState<SkinnedVoxelRig | null>(null);
  useEffect(() => {
    const built = new SkinnedVoxelRig(rig, mesh);
    setSkinnedRig(built);
    return () => built.dispose();
  }, [rig, mesh]);

  // Frame the camera from the mesh bounds (a SkinnedMesh carries the same flat
  // `positions` a PartMesh does), so the camera is right on the first render.
  const { center, distance, far } = useMemo(
    () => framing(mesh as unknown as PartMesh),
    [mesh],
  );

  useEffect(() => {
    skinnedRig?.playAnimation(animation ?? null);
  }, [skinnedRig, animation]);

  const callerKey = callerJoints ? JSON.stringify(callerJoints) : "";
  useEffect(() => {
    if (callerJoints) skinnedRig?.pose(callerJoints);
    // callerKey captures the values; callerJoints identity may change each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinnedRig, callerKey]);

  const animate =
    animation != null || (rig.animations?.some((a) => a.autoPlay) ?? false);

  // When zoom is on, keep the wheel from scrolling the page while it zooms the camera.
  const containerRef = useViewportWheelLock<HTMLDivElement>(
    enableZoom ?? false,
  );

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}
    >
      <Canvas
        aria-label={label}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        camera={{
          position: cameraPosition(distance),
          fov: CAMERA_FOV,
          near: 0.1,
          far,
        }}
      >
        <ambientLight intensity={AMBIENT_INTENSITY} />
        <directionalLight
          position={KEY_LIGHT.position}
          intensity={KEY_LIGHT.intensity}
        />
        <directionalLight
          position={FILL_LIGHT.position}
          intensity={FILL_LIGHT.intensity}
        />
        {skinnedRig ? (
          <SkinnedScene rig={skinnedRig} center={center} animate={animate} />
        ) : null}
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={enableZoom ?? false}
          autoRotate={mode === "auto-rotate"}
          autoRotateSpeed={1.5}
        />
      </Canvas>
    </div>
  );
}
