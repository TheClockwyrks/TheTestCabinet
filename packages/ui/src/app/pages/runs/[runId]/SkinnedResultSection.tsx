import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { AnimationSpec, JointSpec, ModelSpec } from "@test-cabinet/run-record";
import type { SkinnedMesh } from "@test-cabinet/voxel-runtime";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import {
  useSkinnedMesh,
  type VoxelResultView,
} from "../../../data/galleryContext";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import styles from "./RunDetailPages.module.scss";

// `three` (and the drei/runtime bindings) are heavy, so the skinned WebGL viewer is
// split into its own chunk and only fetched when a WebGL-capable browser mounts it.
const SkinnedVoxelViewer = lazy(() => import("./SkinnedVoxelViewer"));

const RIG_PREVIEW_SIZE = 480;
const RIG_PREVIEW_BOX: CSSProperties = {
  width: RIG_PREVIEW_SIZE,
  maxWidth: "100%",
  height: RIG_PREVIEW_SIZE,
  background: "var(--tc-panel-2, #1c1c1c)",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  overflow: "hidden",
};

const EMPTY_ANIMATIONS: AnimationSpec[] = [];

/** The static PNG fallback (the model's rendered preview), shown when WebGL is
 * unavailable, the user prefers reduced motion, or the mesh is still decoding. */
function SkinnedFallback({ url, label }: { url: string | null; label: string }) {
  const box: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
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

/** The guarded skinned viewer: mounts the lazy {@link SkinnedVoxelViewer} only on a
 * WebGL-capable browser once the mesh has decoded, else the PNG fallback. */
function GuardedSkinnedViewer({
  mesh,
  rig,
  callerJoints,
  animation,
  fallbackUrl,
  label,
}: {
  mesh: SkinnedMesh | null;
  rig: ModelSpec;
  callerJoints?: Record<string, number>;
  animation?: AnimationSpec | null;
  fallbackUrl: string | null;
  label: string;
}) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  const ready = enabled && mesh !== null && mesh.positions.length > 0;
  const fallback = <SkinnedFallback url={fallbackUrl} label={label} />;
  if (!ready) return fallback;

  return (
    <Suspense fallback={fallback}>
      <SkinnedVoxelViewer
        mesh={mesh}
        rig={rig}
        mode="orbit"
        callerJoints={callerJoints}
        animation={animation}
        height={RIG_PREVIEW_SIZE}
        label={label}
      />
    </Suspense>
  );
}

/** Format a joint value: degrees for a rotation, voxel units for a translation. */
function formatJointValue(joint: JointSpec, value: number): string {
  if (joint.kind === "rotation") {
    return `${((value * 180) / Math.PI).toFixed(0)}°`;
  }
  return value.toFixed(1);
}

function drivenJointCount(animation: AnimationSpec): number {
  const tracks = animation.tracks ?? [];
  if (tracks.length > 0) return new Set(tracks.map((t) => t.joint)).size;
  return animation.joints.length;
}

function animationSummary(animation: AnimationSpec): string {
  const n = drivenJointCount(animation);
  return `${n} joint${n === 1 ? "" : "s"} · ${animation.periodMs}ms ${
    animation.looping ? "loop" : "once"
  }${animation.autoPlay ? " · idle" : ""}`;
}

type ViewerMode = "animations" | "joints";

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<ViewerMode>> = [
  { value: "animations", label: "Animations" },
  { value: "joints", label: "Joints" },
];

/**
 * The generated-asset result for a **skinned** voxel run
 * (`mc-skinned`/`sn-skinned`/`dc-skinned`): one continuous mesh bound to the rig and
 * deformed by **linear-blend skinning**. A single shared 3D view is driven by a
 * picker of the rig's model-authored animations and its caller-driven joints (posed
 * by a slider), so the reviewer can judge how well the skin deforms — an elbow that
 * bends without tearing, a stride that reads as a walking creature. Mirrors
 * {@link VoxelAnimationResult}, but poses one skinned mesh rather than isolating parts.
 *
 * Imported by {@link VoxelResultSection}, which mounts it when the voxel run is
 * `skinned`. Falls back to the model's rendered preview PNG without WebGL.
 */
export function SkinnedResultSection({ view }: { view: VoxelResultView }) {
  const rig = view.rig ?? view.model ?? { parts: [], joints: [] };
  const fallbackUrl = view.parts[0]?.previewUrl ?? null;
  const animations =
    view.rig?.animations ?? view.model?.animations ?? EMPTY_ANIMATIONS;
  const callerJoints = useMemo(
    () => rig.joints.filter((j) => j.drive === "caller"),
    [rig],
  );

  // Fetch and decode the single skinned mesh, gated on the same capability the
  // viewer needs, promoted from an effect so SSR/first paint never touch WebGL.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);
  const { mesh } = useSkinnedMesh(
    enabled ? view.skinnedMeshUrl : null,
  );

  const [mode, setMode] = useState<ViewerMode>("animations");
  const [selectedAnimation, setSelectedAnimation] = useState(
    () => animations[0]?.name ?? "",
  );
  const activeAnimation =
    animations.find((a) => a.name === selectedAnimation) ??
    animations[0] ??
    null;

  const [callerValues, setCallerValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(callerJoints.map((j) => [j.name, j.rest])),
  );

  const playback =
    mode === "animations" && activeAnimation
      ? { animation: activeAnimation }
      : { animation: null };

  const part = view.parts[0];

  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>Skinned rig</h3>
      <p className={styles.secondary}>
        One continuous mesh bound to the rig and deformed by{" "}
        <strong>linear-blend skinning</strong>. Switch between the model&rsquo;s{" "}
        <strong>animations</strong> and its game-drivable <strong>joints</strong>{" "}
        (posed by a slider) to judge how cleanly the skin deforms. Drag the model to
        orbit it.
      </p>
      <div className={styles.rigModeSwitch}>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          ariaLabel="Rig view mode"
        />
      </div>
      <div
        className={styles.rigPreview}
        style={
          { "--rig-preview-size": `${RIG_PREVIEW_SIZE}px` } as CSSProperties
        }
      >
        <div className={styles.rigPreviewSidebar}>
          <div className={styles.voxelModeList}>
            {mode === "animations" ? (
              animations.length > 0 ? (
                animations.map((animation) => (
                  <button
                    key={animation.name}
                    type="button"
                    className={`${styles.voxelPickerButton} ${
                      animation.name === activeAnimation?.name
                        ? styles.voxelPickerButtonActive
                        : ""
                    }`}
                    aria-pressed={animation.name === activeAnimation?.name}
                    onClick={() => setSelectedAnimation(animation.name)}
                  >
                    <span className={styles.voxelPickerName}>
                      {animation.name}
                    </span>
                    <span className={styles.voxelPickerSub}>
                      {animationSummary(animation)}
                    </span>
                  </button>
                ))
              ) : (
                <p className={styles.secondary}>
                  This model authored no animations.
                </p>
              )
            ) : callerJoints.length > 0 ? (
              callerJoints.map((joint) => {
                const value = callerValues[joint.name] ?? joint.rest;
                return (
                  <div key={joint.name} className={styles.voxelSlider}>
                    <span className={styles.voxelPickerName}>{joint.name}</span>
                    <span className={styles.sequenceSub}>
                      {joint.kind} · {formatJointValue(joint, value)}
                    </span>
                    <input
                      type="range"
                      min={joint.min}
                      max={joint.max}
                      step="any"
                      value={value}
                      onChange={(e) =>
                        setCallerValues((prev) => ({
                          ...prev,
                          [joint.name]: Number(e.target.value),
                        }))
                      }
                      aria-label={`${joint.name} value`}
                      className={styles.voxelRange}
                    />
                  </div>
                );
              })
            ) : (
              <p className={styles.secondary}>
                This model exposes no game-drivable joints — its motion lives in the
                Animations tab.
              </p>
            )}
          </div>
        </div>
        <div className={styles.rigPreviewStage}>
          <div style={RIG_PREVIEW_BOX}>
            <GuardedSkinnedViewer
              mesh={mesh}
              rig={rig}
              callerJoints={callerValues}
              {...playback}
              fallbackUrl={fallbackUrl}
              label={
                activeAnimation && mode === "animations"
                  ? `${activeAnimation.name} preview`
                  : "Skinned rig preview"
              }
            />
          </div>
        </div>
      </div>

      {part ? (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "4px 16px",
            marginTop: 16,
          }}
        >
          <dt>Voxels</dt>
          <dd>{part.voxelCount.toLocaleString()}</dd>
          <dt>Operations recorded</dt>
          <dd>
            {part.operationCount}
            {part.actionsUrl ? (
              <>
                {" — "}
                <a href={part.actionsUrl} target="_blank" rel="noreferrer">
                  action log
                </a>
              </>
            ) : null}
          </dd>
        </dl>
      ) : null}
    </>
  );
}
