import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { AnimationSpec, JointSpec } from "@test-cabinet/run-record";
import { type VoxelResultView } from "../../../data/galleryContext";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import { FullscreenViewport } from "./FullscreenViewport";
import styles from "./RunDetailPages.module.scss";

// `three` (and the drei/glTF bindings) are heavy, so the Blender glTF viewer is split
// into its own chunk and only fetched when a WebGL-capable browser mounts it.
const BlenderCharacterViewer = lazy(() => import("./BlenderCharacterViewer"));

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
const EMPTY_JOINTS: JointSpec[] = [];

/** A caller DOF's current value, formatted for its kind: degrees for a rotation (radians
 * in the contract), raw world units for a translation. */
function formatDofValue(joint: JointSpec, value: number): string {
  if (joint.kind === "rotation")
    return `${Math.round((value * 180) / Math.PI)}°`;
  return value.toFixed(2);
}

/** The static PNG fallback (the model's rendered preview), shown when WebGL is
 * unavailable, the user prefers reduced motion, or before the viewer mounts. */
function BlenderFallback({
  url,
  label,
}: {
  url: string | null;
  label: string;
}) {
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

/** An animation's one-line summary: whether it loops or plays once, and whether it is
 * the decorative idle that plays on its own. A Blender character's clips are baked into
 * the glTF, so there are no F-curve tracks to count joints from. */
function animationSummary(animation: AnimationSpec): string {
  return `${animation.looping ? "loops" : "plays once"}${
    animation.autoPlay ? " · idle" : ""
  }`;
}

/**
 * The generated-asset result for a **Blender** run (`blender-character`/`blender-prop`/
 * `blender-mechanism`): the emitted native glTF, loaded whole and played through a native
 * glTF player (rather than posed from an inline `rig.json` the way the CSG-skinned kinds
 * are). The three members share one 3D view, differing only in what drives it:
 *
 * - a **character** (skinned) and a **mechanism** (rigid node-hierarchy animations) are
 *   driven by a picker of the case's required animations, so a reviewer can play each
 *   clip and judge how it reads (and, for a character, how the skin deforms);
 * - a **prop** is static (no `[model]` animations), so there is no picker — the view
 *   auto-rotates the model as a turntable.
 *
 * Imported by {@link VoxelResultSection}, which mounts it when the voxel run is
 * `blender`. Falls back to the model's rendered preview PNG without WebGL.
 */
export function BlenderResultSection({ view }: { view: VoxelResultView }) {
  // A Blender run carries its rig inside the glTF, so there is no produced `rig.json`
  // (`view.rig` is null); the required `[model]` animations (absent for a static prop)
  // are the review targets and drive the picker.
  const animations = view.model?.animations ?? EMPTY_ANIMATIONS;
  const fallbackUrl = view.parts[0]?.previewUrl ?? null;
  const meshUrl = view.skinnedMeshUrl;

  // Which member this is, from the markers alone: a character is `skinned`; a mechanism
  // is a non-skinned run with required animations; a prop is a non-skinned run with none.
  const isStatic = animations.length === 0;
  const kindLabel = view.skinned
    ? "Blender character"
    : isStatic
      ? "Blender prop"
      : "Blender mechanism";
  const blurb = view.skinned
    ? "A skinned, animated character authored in Blender and emitted as a standard glTF. Its animations are baked into the file and played by a native glTF player. Pick an animation to play it; drag the model to orbit it."
    : isStatic
      ? "A static, hard-surface model authored in Blender and emitted as a standard glTF. Drag to orbit it; the view turntables the model."
      : "A rigidly-articulated model authored in Blender and emitted as a standard glTF. Its motion is baked into the file as glTF node animations and played by a native glTF player. Pick an animation to play it; drag the model to orbit it.";

  // Gate the WebGL viewer on capability + reduced-motion, promoted from an effect so
  // SSR/first paint never touch WebGL or fetch the heavy `.glb`.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  // Default to the idle (the clip that plays on its own), else the first declared
  // animation, so the asset is moving the moment the view mounts. A static prop has none.
  const [selectedAnimation, setSelectedAnimation] = useState(
    () => (animations.find((a) => a.autoPlay) ?? animations[0])?.name ?? "",
  );
  const activeAnimation = isStatic
    ? null
    : (animations.find((a) => a.name === selectedAnimation) ??
      animations.find((a) => a.autoPlay) ??
      animations[0] ??
      null);

  // The case's required **caller DOFs** — the game-facing procedural joints (a turret's
  // `turret_yaw`, a character's `aim_pitch`) a game drives at runtime. A reviewer drives
  // them here with a slider each, exactly as a game would, proving the emitted glTF is
  // runtime-controllable (not just a bag of baked clips).
  const callerDofs = useMemo(
    () =>
      (view.model?.joints ?? EMPTY_JOINTS).filter((j) => j.drive === "caller"),
    [view.model],
  );
  const [dofValues, setDofValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(callerDofs.map((j) => [j.name, j.rest])),
  );

  // A static prop turntables; an animated member orbits under drag while it plays.
  const viewerMode = isStatic ? "auto-rotate" : "orbit";
  const ready = enabled && meshUrl !== null;
  const label = activeAnimation
    ? `${activeAnimation.name} preview`
    : `${kindLabel} preview`;

  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>{kindLabel}</h3>
      <p className={styles.secondary}>{blurb}</p>
      <div
        className={styles.rigPreview}
        style={
          { "--rig-preview-size": `${RIG_PREVIEW_SIZE}px` } as CSSProperties
        }
      >
        <div className={styles.rigPreviewSidebar}>
          <div className={styles.voxelModeList}>
            {isStatic ? (
              <p className={styles.secondary}>
                A static model — no animations to play.
              </p>
            ) : (
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
            )}
          </div>
          {callerDofs.length > 0 && (
            <div className={styles.blenderDofControls}>
              <p className={styles.voxelPickerName}>Game controls</p>
              <p className={styles.secondary}>
                Drivable at runtime — a game sets these from its own state (aim
                a turret, pitch a soldier). Baked into the glTF as node{" "}
                <code>extras</code>.
              </p>
              {callerDofs.map((joint) => {
                const value = dofValues[joint.name] ?? joint.rest;
                return (
                  <label key={joint.name} className={styles.blenderDof}>
                    <span className={styles.voxelPickerSub}>
                      {joint.name} · {joint.kind} {joint.axis}
                      {" · "}
                      {formatDofValue(joint, value)}
                    </span>
                    <input
                      type="range"
                      min={joint.min}
                      max={joint.max}
                      step={(joint.max - joint.min) / 100 || 0.01}
                      value={value}
                      aria-label={`${joint.name} (${joint.kind} about ${joint.axis})`}
                      onChange={(event) =>
                        setDofValues((prev) => ({
                          ...prev,
                          [joint.name]: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className={styles.rigPreviewStage}>
          <div style={RIG_PREVIEW_BOX}>
            {ready ? (
              <FullscreenViewport
                label={label}
                renderExpanded={(expandedHeight) => (
                  <Suspense fallback={null}>
                    <BlenderCharacterViewer
                      url={meshUrl}
                      animationName={activeAnimation?.name ?? null}
                      loop={activeAnimation?.looping ?? true}
                      mode={viewerMode}
                      enableZoom
                      height={expandedHeight}
                      label={`${label} (expanded)`}
                      callerDofs={callerDofs}
                      dofValues={dofValues}
                    />
                  </Suspense>
                )}
              >
                <Suspense
                  fallback={<BlenderFallback url={fallbackUrl} label={label} />}
                >
                  <BlenderCharacterViewer
                    url={meshUrl}
                    animationName={activeAnimation?.name ?? null}
                    loop={activeAnimation?.looping ?? true}
                    mode={viewerMode}
                    height={RIG_PREVIEW_SIZE}
                    label={label}
                    callerDofs={callerDofs}
                    dofValues={dofValues}
                  />
                </Suspense>
              </FullscreenViewport>
            ) : (
              <BlenderFallback url={fallbackUrl} label={label} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
