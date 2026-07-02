import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import type {
  AnimationSpec,
  ModelSpec,
  VoxelDims,
  VoxelsFile,
} from "@test-cabinet/run-record";
import { VoxelRig } from "@test-cabinet/voxel-runtime/three";

// How the viewer presents the model: `auto-rotate` slowly orbits the camera on
// its own (the static-model gallery view); `orbit` is a still, drag-to-inspect
// view (used beside a caller-joint slider or an auto-play clip, where the motion
// under review is the model's, not the camera's).
export type VoxelViewMode = "auto-rotate" | "orbit";

/** Column-major-agnostic 3-tuple. */
type Vec3 = [number, number, number];

/**
 * Camera framing — the model's center, the camera distance that fits it, and a far
 * plane — derived from the raw voxel bounds (or a fixed `frameDims` volume when the
 * caller pins the frame). Computed from the data rather than the built
 * {@link VoxelRig} so it's correct on the very first render, before the rig is built
 * in an effect. Each voxel occupies the unit cube `[x, x+1]`, so the far corner is
 * `max + 1`; the rest pose is representative, so posing a joint doesn't reframe.
 */
function framing(
  voxels: Record<string, VoxelsFile> | VoxelsFile,
  frameDims: VoxelDims | null | undefined,
): { center: Vec3; distance: number; far: number } {
  if (frameDims) {
    const size = Math.max(frameDims.width, frameDims.height, frameDims.depth, 1);
    const dist = size * 2.2;
    return {
      center: [frameDims.width / 2, frameDims.height / 2, frameDims.depth / 2],
      distance: dist,
      far: dist * 20,
    };
  }
  const files = Array.isArray((voxels as VoxelsFile).voxels)
    ? [voxels as VoxelsFile]
    : Object.values(voxels as Record<string, VoxelsFile>);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const file of files) {
    for (const v of file.voxels) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  if (minX > maxX) {
    // No voxels to frame yet — a neutral default.
    return { center: [0, 0, 0], distance: 32, far: 400 };
  }
  const center: Vec3 = [
    (minX + maxX + 1) / 2,
    (minY + maxY + 1) / 2,
    (minZ + maxZ + 1) / 2,
  ];
  const size = Math.max(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1, 1);
  const dist = size * 2.2;
  return { center, distance: dist, far: dist * 20 };
}

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
  animation,
  enableZoom,
  frameDims,
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
  /** A predetermined animation to play (its tracks drive their joints over time),
   * or `null`/omitted for none. */
  animation?: AnimationSpec | null;
  /** Whether scroll-to-zoom is enabled. Off by default: the inline gallery views
   * disable zoom, and only the expanded (fullscreen) view turns it on. */
  enableZoom?: boolean;
  /** Frame the camera from this fixed volume instead of the posed bounding box.
   * Used by the live view so the camera stays steady as the model is sculpted
   * (the bounding box grows operation by operation); omit for post-run views. */
  frameDims?: VoxelDims | null;
  /** Canvas height in px. */
  height?: number;
  /** Accessible name for the canvas. */
  label: string;
}) {
  // Build the rig inside an effect (not `useMemo`) so its creation and disposal are
  // balanced: each mount builds a fresh rig and the matching cleanup disposes *that*
  // rig. React's dev StrictMode double-invokes effects (setup → cleanup → setup); a
  // rig built in `useMemo` and disposed in a cleanup gets torn down and then reused —
  // its geometry freed and its part groups detached — so the model appears for one
  // frame and then vanishes. Building it in the effect makes the second setup produce
  // a new, live rig instead.
  const [voxelRig, setVoxelRig] = useState<VoxelRig | null>(null);
  useEffect(() => {
    const built = new VoxelRig(rig, voxels);
    setVoxelRig(built);
    return () => built.dispose();
  }, [rig, voxels]);

  // Frame the camera so any size of model fills the view. When `frameDims` is given
  // (the live view) frame the fixed volume so the camera holds steady as the model
  // grows; otherwise frame the voxel bounds. Derived from the data, not the rig, so
  // the camera is correct on the first render even though the rig builds a tick later
  // in the effect above.
  const { center, distance, far } = useMemo(
    () => framing(voxels, frameDims),
    [voxels, frameDims],
  );

  // Isolate the requested auto-play clip (or play them all with `null`); a
  // caller-posed/static view passes no clip, which holds every auto joint at rest.
  useEffect(() => {
    voxelRig?.play(autoPlayClip ?? null);
  }, [voxelRig, autoPlayClip]);

  // Play the requested predetermined animation (or stop it with `null`).
  useEffect(() => {
    voxelRig?.playAnimation(animation ?? null);
  }, [voxelRig, animation]);

  // Re-pose whenever the caller-driven joint values change. Keyed on the values'
  // JSON so a fresh object of the same values doesn't re-pose needlessly.
  const callerKey = callerJoints ? JSON.stringify(callerJoints) : "";
  useEffect(() => {
    if (callerJoints) voxelRig?.pose(callerJoints);
    // callerKey captures the values; callerJoints identity may change each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voxelRig, callerKey]);

  // Advance the playback clock each frame when an auto-play clip or a predetermined
  // animation is running; a static or caller-posed model needs no per-frame work.
  const animate = autoPlayClip !== undefined || animation != null;

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
        {voxelRig ? (
          <RigScene rig={voxelRig} center={center} animate={animate} />
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
