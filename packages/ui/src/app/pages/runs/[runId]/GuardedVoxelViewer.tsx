import { Suspense, lazy, useEffect, useState } from "react";
import type { AnimationSpec, ModelSpec } from "@test-cabinet/run-record";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import { FullscreenViewport } from "./FullscreenViewport";
import type { VoxelViewMode } from "./VoxelViewer";
import styles from "./RunDetailPages.module.scss";

// `three` (and the drei/runtime bindings) are heavy, so the WebGL viewer is split
// into its own chunk and only fetched when a WebGL-capable browser actually mounts
// it (see the capability guard below).
const VoxelViewer = lazy(() => import("./VoxelViewer"));

/** The fetched/streamed geometry the viewer renders: one {@link PartMesh} for a
 * static model, or a map keyed by part name for a rig. `null`/empty renders the
 * fallback. */
export type ViewerMeshes = Record<string, PartMesh> | PartMesh | null;

// Whether a mesh payload actually carries geometry to render (an empty map, or a
// single mesh with no vertices, has nothing to show yet — fall back to the PNG).
function hasMeshes(meshes: ViewerMeshes): boolean {
  if (!meshes) return false;
  const positions = (meshes as PartMesh).positions;
  if (Array.isArray(positions) || ArrayBuffer.isView(positions)) {
    return positions.length > 0;
  }
  return Object.values(meshes as Record<string, PartMesh>).some(
    (m) => m.positions.length > 0,
  );
}

/** The static PNG shown when WebGL is unavailable, the user prefers reduced motion,
 * or no voxel geometry is available yet — so a run stays reviewable without the 3D
 * view. */
function VoxelFallback({
  url,
  label,
  height,
}: {
  url: string | null;
  label: string;
  height?: number;
}) {
  const box: React.CSSProperties = {
    width: "100%",
    height: height ?? "100%",
    objectFit: "contain",
    imageRendering: "pixelated",
    background: "var(--tc-panel-2, #1c1c1c)",
    borderRadius: 4,
  };
  if (url) return <img src={url} alt={label} style={box} />;
  return (
    <div style={{ ...box, display: "grid", placeItems: "center" }}>
      <span className={styles.secondary}>not available</span>
    </div>
  );
}

// The props shared by the inline viewer and its fullscreen twin (everything but the
// zoom/mode/height that differ between them).
interface ViewerProps {
  meshes: Record<string, PartMesh> | PartMesh;
  rig: ModelSpec;
  callerJoints?: Record<string, number>;
  animation?: AnimationSpec | null;
  label: string;
}

/**
 * The guarded 3D voxel viewer with a fullscreen affordance. Mounts the lazy
 * {@link VoxelViewer} only on a WebGL-capable browser whose user hasn't asked for
 * reduced motion, and only once voxel geometry is available; otherwise it shows the
 * static PNG {@link VoxelFallback}.
 *
 * Zoom is disabled inline (the model rotates but does not zoom); a "Fullscreen"
 * button expands the view into an overlay where both scroll-to-zoom and
 * grab-to-rotate are enabled. Callers pass already-resolved meshes — the post-run
 * view fetches each part's `mesh.json` first, the live view feeds the streamed mesh
 * straight in.
 */
export function GuardedVoxelViewer({
  meshes,
  rig,
  mode,
  callerJoints,
  animation,
  fallbackUrl,
  label,
  height,
  fullscreenable = true,
}: {
  meshes: ViewerMeshes;
  rig: ModelSpec;
  mode: VoxelViewMode;
  callerJoints?: Record<string, number>;
  animation?: AnimationSpec | null;
  fallbackUrl: string | null;
  label: string;
  height?: number;
  /** Whether to offer the expand-to-fullscreen button. On by default. */
  fullscreenable?: boolean;
}) {
  // Start disabled so the first paint never blocks on capability checks (and SSR
  // never touches WebGL); promote from an effect (client-only).
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  const fallback = (
    <VoxelFallback url={fallbackUrl} label={label} height={height} />
  );

  if (!enabled || !hasMeshes(meshes)) return fallback;

  // `hasMeshes` guarantees `meshes` is non-null here.
  const viewer: ViewerProps = {
    meshes: meshes as Record<string, PartMesh> | PartMesh,
    rig,
    callerJoints,
    animation,
    label,
  };

  return (
    <FullscreenViewport
      label={label}
      expandable={fullscreenable}
      renderExpanded={(expandedHeight) => (
        <Suspense fallback={null}>
          <VoxelViewer
            {...viewer}
            mode="orbit"
            enableZoom
            height={expandedHeight}
            label={`${label} (expanded)`}
          />
        </Suspense>
      )}
    >
      <Suspense fallback={fallback}>
        <VoxelViewer {...viewer} mode={mode} height={height} label={label} />
      </Suspense>
    </FullscreenViewport>
  );
}
