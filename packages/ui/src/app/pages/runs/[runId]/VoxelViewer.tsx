import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ModelSpec, VoxelsFile } from "@test-cabinet/run-record";
import { VoxelRig } from "@test-cabinet/voxel-runtime/three";

// How the viewer presents the model: `auto-rotate` slowly orbits the camera on
// its own (the static-model gallery view); `orbit` is a still, drag-to-inspect
// view (used beside a caller-joint slider or an auto-play clip, where the motion
// under review is the model's, not the camera's).
export type VoxelViewMode = "auto-rotate" | "orbit";

/** Column-major-agnostic 3-tuple. */
type Vec3 = [number, number, number];

/**
 * The scene contents inside the {@link Canvas}: the posed rig (centered at the
 * origin) plus a frame loop that advances any playing auto-clip. Kept as a child
 * component so it can call `useFrame`, which only works inside the R3F canvas.
 */
function RigScene({
  rig,
  center,
  animate,
}: {
  rig: VoxelRig;
  center: Vec3;
  animate: boolean;
}) {
  // Advance the rig's playback clock only when an auto-play clip is playing; a
  // static or caller-posed model needs no per-frame work (the camera's own
  // auto-rotate, when enabled, is driven by OrbitControls, not the rig).
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
 * Interactive 3D view of a regenerated voxel model. Builds a
 * {@link VoxelRig} from the run's rig structure ({@link ModelSpec}, which travels
 * inline in the run record) and the fetched per-part `voxels.json`, then renders
 * it in an R3F {@link Canvas} with orbit controls and lighting.
 *
 * Default export so it can be `React.lazy`-loaded — `three`, `@react-three/drei`,
 * and the runtime's mesh builder then land in their own chunk instead of the
 * entry bundle. The caller ({@link VoxelResultSection}) gates the mount on WebGL
 * support and reduced-motion, showing a static PNG fallback otherwise, so this
 * component can assume a WebGL-capable browser.
 */
export default function VoxelViewer({
  voxels,
  rig,
  mode,
  autoPlayClip,
  callerJoints,
  height = 320,
  label,
}: {
  /** The regenerated voxel data: one file for a static model, or a map keyed by
   * part name for an animated rig. */
  voxels: Record<string, VoxelsFile> | VoxelsFile;
  /** The rig to pose (parts + joints). A static model passes a trivial single-part
   * rig. */
  rig: ModelSpec;
  /** Whether the camera auto-rotates or is a still drag-to-inspect view. */
  mode: VoxelViewMode;
  /** The auto-play joint to isolate (its name), or `null` to play every auto-play
   * joint; omit for a caller-posed or static view (no clip runs). */
  autoPlayClip?: string | null;
  /** Caller-driven joint values to pose the rig at (e.g. `{ turret_yaw: 0.6 }`). */
  callerJoints?: Record<string, number>;
  /** Canvas height in px. */
  height?: number;
  /** Accessible name for the canvas. */
  label: string;
}) {
  // Build the rig once per (rig, voxels) pair and dispose its GPU resources on
  // unmount or replacement.
  const voxelRig = useMemo(() => new VoxelRig(rig, voxels), [rig, voxels]);
  useEffect(() => () => voxelRig.dispose(), [voxelRig]);

  // Frame the camera from the posed bounding box so any size of model fills the
  // view. Computed once per rig (the rest pose is representative enough for
  // framing; posing a joint doesn't grow the model meaningfully).
  const { center, distance, far } = useMemo(() => {
    voxelRig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(voxelRig.root);
    if (box.isEmpty()) {
      return { center: [0, 0, 0] as Vec3, distance: 32, far: 400 };
    }
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    box.getCenter(c);
    box.getSize(s);
    const size = Math.max(s.x, s.y, s.z, 1);
    const dist = size * 2.2;
    return {
      center: [c.x, c.y, c.z] as Vec3,
      distance: dist,
      far: dist * 20,
    };
  }, [voxelRig]);

  // Isolate the requested auto-play clip (or play them all with `null`); a
  // caller-posed/static view passes no clip, which holds every auto joint at rest.
  useEffect(() => {
    voxelRig.play(autoPlayClip ?? null);
  }, [voxelRig, autoPlayClip]);

  // Re-pose whenever the caller-driven joint values change. Keyed on the values'
  // JSON so a fresh object of the same values doesn't re-pose needlessly.
  const callerKey = callerJoints ? JSON.stringify(callerJoints) : "";
  useEffect(() => {
    if (callerJoints) voxelRig.pose(callerJoints);
    // callerKey captures the values; callerJoints identity may change each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voxelRig, callerKey]);

  const animate = autoPlayClip !== undefined;

  return (
    <div style={{ width: "100%", height, borderRadius: 4, overflow: "hidden" }}>
      <Canvas
        aria-label={label}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        camera={{
          position: [distance, distance * 0.8, distance],
          fov: 45,
          near: 0.1,
          far,
        }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 2, 1]} intensity={1.1} />
        <directionalLight position={[-1, 0.5, -1]} intensity={0.5} />
        <RigScene rig={voxelRig} center={center} animate={animate} />
        <OrbitControls
          makeDefault
          enablePan={false}
          autoRotate={mode === "auto-rotate"}
          autoRotateSpeed={1.5}
        />
      </Canvas>
    </div>
  );
}
