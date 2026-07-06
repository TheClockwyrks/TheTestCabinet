import { Suspense, lazy, useEffect, useState } from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import {
  useParticleSystem,
  type ParticleResultView,
} from "../../../data/galleryContext";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import type { ParticleBlend } from "./ParticleViewer";
import styles from "./RunDetailPages.module.scss";

// `three` (and the drei/particle-runtime bindings) are heavy, so the live simulator
// is split into its own chunk and only fetched when a WebGL-capable browser mounts it.
const ParticleViewer = lazy(() => import("./ParticleViewer"));

const STAGE_SIZE = 420;

const STAGE_BOX: React.CSSProperties = {
  width: STAGE_SIZE,
  maxWidth: "100%",
  height: STAGE_SIZE,
  background: "var(--tc-panel-2, #1c1c1c)",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  overflow: "hidden",
};

const BLEND_OPTIONS: ReadonlyArray<SegmentedOption<ParticleBlend>> = [
  { value: "additive", label: "Additive" },
  { value: "normal", label: "Normal" },
];

/** The rendered preview GIF (or a static message) shown when WebGL is unavailable,
 * the user prefers reduced motion, or the system is still loading — so a particle run
 * stays reviewable without the live simulator. */
function ParticleFallback({
  previewUrl,
  message,
  label,
}: {
  previewUrl: string | null;
  message: string;
  label: string;
}) {
  if (previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={label}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          borderRadius: 4,
        }}
      />
    );
  }
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
      <span className={styles.secondary}>{message}</span>
    </div>
  );
}

/** The live-simulated stage: fetches the `system.json`, then mounts the lazy
 * {@link ParticleViewer} (or the preview fallback while loading / on a browser that
 * can't paint WebGL). */
function ParticleStage({
  view,
  blend,
}: {
  view: ParticleResultView;
  blend: ParticleBlend;
}) {
  // Start disabled so the first paint never blocks on capability checks (and SSR
  // never touches WebGL); promote from an effect (client-only), mirroring the voxel
  // viewer's guard.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  // Only fetch the system once a capable browser will actually simulate it.
  const { system, error } = useParticleSystem(
    enabled && view.systemUrl ? view.systemUrl : null,
  );

  const fallbackMessage = error
    ? "could not load system"
    : !enabled
      ? "live preview unavailable"
      : "loading…";

  return (
    <div style={STAGE_BOX}>
      {enabled && system ? (
        <Suspense
          fallback={
            <ParticleFallback
              previewUrl={view.previewUrl}
              message="loading…"
              label="Effect preview"
            />
          }
        >
          <ParticleViewer
            system={system}
            blend={blend}
            height={STAGE_SIZE}
            label="Live particle effect"
          />
        </Suspense>
      ) : (
        <ParticleFallback
          previewUrl={view.previewUrl}
          message={fallbackMessage}
          label="Effect preview"
        />
      )}
    </div>
  );
}

/**
 * The generated-asset result for a particle asset-generation run. A particle run is
 * **not** regenerated and there is no bake: its output is the authored `system.json`,
 * which the review UI **simulates live** — a running particle editor, not a replayed
 * clip — so the character of the effect is judged as it will actually play. A
 * reviewer can flip the blend mode (additive for fire/energy, normal for
 * smoke/debris). The rendered preview GIF stands in where WebGL is unavailable.
 *
 * Imported by {@link AssetResultSection}, which mounts it when the run carries
 * `validation.particle`.
 */
export function ParticleResultSection({ view }: { view: ParticleResultView }) {
  const [blend, setBlend] = useState<ParticleBlend>("additive");
  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>
        Live particle effect
      </h3>
      <p className={styles.secondary}>
        The authored system is <strong>simulated live</strong> — a running particle
        editor, not a replayed clip — so a particle effect varies slightly from play
        to play. A looping effect (fire, smoke) loops; a one-shot (an explosion,
        a muzzle flash) replays on its own. Drag to orbit a 3D effect.
      </p>
      <div className={styles.rigModeSwitch}>
        <SegmentedControl
          options={BLEND_OPTIONS}
          value={blend}
          onChange={setBlend}
          ariaLabel="Particle blend mode"
        />
      </div>
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <ParticleStage view={view} blend={blend} />
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "4px 16px",
            margin: 0,
          }}
        >
          <dt>Emitters</dt>
          <dd>{view.emitterCount}</dd>
          <dt>System</dt>
          <dd>
            {view.systemUrl ? (
              <a href={view.systemUrl} target="_blank" rel="noreferrer">
                system.json
              </a>
            ) : (
              <span className={styles.secondary}>not available</span>
            )}
          </dd>
        </dl>
      </div>
      {view.detail ? <p className={styles.secondary}>{view.detail}</p> : null}
    </>
  );
}
