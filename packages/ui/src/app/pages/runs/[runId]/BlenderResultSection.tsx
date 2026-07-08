import { Suspense, lazy, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AnimationSpec } from "@test-cabinet/run-record";
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

/** The static PNG fallback (the model's rendered preview), shown when WebGL is
 * unavailable, the user prefers reduced motion, or before the viewer mounts. */
function BlenderFallback({ url, label }: { url: string | null; label: string }) {
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
 * The generated-asset result for a **Blender character** run (`blender-character`): the
 * emitted skinned + animated glTF, whose animations are baked into the file itself. A
 * single shared 3D view is driven by a picker of the case's required animations, played
 * through a native glTF animation player (rather than posed from an inline `rig.json`
 * the way the CSG-skinned kinds are), so the reviewer can judge how the character reads
 * and how convincingly its skin deforms through each clip.
 *
 * Imported by {@link VoxelResultSection}, which mounts it when the voxel run is
 * `blender`. Falls back to the model's rendered preview PNG without WebGL.
 */
export function BlenderResultSection({ view }: { view: VoxelResultView }) {
  // A Blender character carries its rig inside the glTF, so there is no produced
  // `rig.json` (`view.rig` is null); the required `[model]` animations are the review
  // targets and drive the picker.
  const animations = view.model?.animations ?? EMPTY_ANIMATIONS;
  const fallbackUrl = view.parts[0]?.previewUrl ?? null;
  const meshUrl = view.skinnedMeshUrl;

  // Gate the WebGL viewer on capability + reduced-motion, promoted from an effect so
  // SSR/first paint never touch WebGL or fetch the heavy `.glb`.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  // Default to the idle (the clip that plays on its own), else the first declared
  // animation, so the character is moving the moment the view mounts.
  const [selectedAnimation, setSelectedAnimation] = useState(
    () => (animations.find((a) => a.autoPlay) ?? animations[0])?.name ?? "",
  );
  const activeAnimation =
    animations.find((a) => a.name === selectedAnimation) ??
    animations.find((a) => a.autoPlay) ??
    animations[0] ??
    null;

  const ready = enabled && meshUrl !== null;
  const label = activeAnimation
    ? `${activeAnimation.name} preview`
    : "Blender character preview";

  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>
        Blender character
      </h3>
      <p className={styles.secondary}>
        A skinned, animated character authored in <strong>Blender</strong> and emitted
        as a standard glTF. Its animations are <strong>baked into the file</strong> and
        played by a native glTF player. Pick an animation to play it; drag the model to
        orbit it.
      </p>
      <div
        className={styles.rigPreview}
        style={{ "--rig-preview-size": `${RIG_PREVIEW_SIZE}px` } as CSSProperties}
      >
        <div className={styles.rigPreviewSidebar}>
          <div className={styles.voxelModeList}>
            {animations.length > 0 ? (
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
                  <span className={styles.voxelPickerName}>{animation.name}</span>
                  <span className={styles.voxelPickerSub}>
                    {animationSummary(animation)}
                  </span>
                </button>
              ))
            ) : (
              <p className={styles.secondary}>
                This case declares no required animations.
              </p>
            )}
          </div>
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
                      mode="orbit"
                      enableZoom
                      height={expandedHeight}
                      label={`${label} (expanded)`}
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
                    mode="orbit"
                    height={RIG_PREVIEW_SIZE}
                    label={label}
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
