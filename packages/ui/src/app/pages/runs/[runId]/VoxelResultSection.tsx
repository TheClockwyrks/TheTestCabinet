import { Suspense, lazy, useEffect, useState } from "react";
import type { JointSpec, ModelSpec } from "@test-cabinet/run-record";
import {
  useVoxelArtifacts,
  type VoxelPartView,
  type VoxelResultView,
} from "../../../data/galleryContext";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import type { VoxelViewMode } from "./VoxelViewer";
import styles from "./RunDetailPages.module.scss";

// `three` (and the drei/runtime bindings) are heavy, so the WebGL viewer is split
// into its own chunk and only fetched when a WebGL-capable browser actually mounts
// it (see the guard in `VoxelCanvas`).
const VoxelViewer = lazy(() => import("./VoxelViewer"));

// Divergence at or above this fraction reads as "drew outside the tool" — the same
// threshold the sprite results use.
const OUTSIDE_TOOL = 0.05;

const CANVAS_BOX: React.CSSProperties = {
  width: 240,
  height: 240,
  background: "var(--tc-panel-2, #1c1c1c)",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  overflow: "hidden",
};

const PREVIEW_IMG: React.CSSProperties = {
  width: 240,
  height: 240,
  objectFit: "contain",
  imageRendering: "pixelated",
  background: "var(--tc-panel-2, #1c1c1c)",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
};

/** The static PNG shown when WebGL is unavailable, the user prefers reduced
 * motion, or the voxel data is still loading — so a run stays reviewable without
 * the 3D view. */
function VoxelFallback({
  url,
  label,
  height,
}: {
  url: string | null;
  label: string;
  height?: number;
}) {
  const box: React.CSSProperties = height
    ? { ...PREVIEW_IMG, width: "100%", height }
    : PREVIEW_IMG;
  if (url) return <img src={url} alt={label} style={box} />;
  return (
    <div style={{ ...box, display: "grid", placeItems: "center" }}>
      <span className={styles.secondary}>not available</span>
    </div>
  );
}

/**
 * The guarded 3D viewer: mounts the lazy {@link VoxelViewer} only on a
 * WebGL-capable browser whose user hasn't asked for reduced motion, and only once
 * the part voxel data has been fetched; otherwise (or while loading) it shows the
 * static PNG fallback. Fetching is skipped entirely when disabled.
 */
function VoxelCanvas({
  parts,
  rig,
  mode,
  autoPlayClip,
  callerJoints,
  fallbackUrl,
  label,
  height,
}: {
  parts: VoxelPartView[];
  rig: ModelSpec;
  mode: VoxelViewMode;
  autoPlayClip?: string | null;
  callerJoints?: Record<string, number>;
  fallbackUrl: string | null;
  label: string;
  height?: number;
}) {
  // Start disabled so the first paint never blocks on capability checks (and SSR
  // never touches WebGL); promote from an effect (client-only).
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  const artifacts = useVoxelArtifacts(enabled ? parts : []);
  const fallback = (
    <VoxelFallback url={fallbackUrl} label={label} height={height} />
  );

  if (!enabled || artifacts.loading || !artifacts.voxelsByPart) return fallback;

  return (
    <Suspense fallback={fallback}>
      <VoxelViewer
        voxels={artifacts.voxelsByPart}
        rig={rig}
        mode={mode}
        autoPlayClip={autoPlayClip}
        callerJoints={callerJoints}
        height={height}
        label={label}
      />
    </Suspense>
  );
}

/** A part's cheat-divergence / operations / voxel-count readout — the voxel analog
 * of the sprite results' `FrameSignals`. */
function VoxelSignals({ part }: { part: VoxelPartView }) {
  const drewOutsideTool =
    part.cheatDivergence !== null && part.cheatDivergence > OUTSIDE_TOOL;
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "4px 16px",
        marginTop: 16,
      }}
    >
      <dt>Cheat divergence</dt>
      <dd>
        {part.cheatDivergence === null ? (
          <span className={styles.secondary}>unmeasured</span>
        ) : (
          <span className={drewOutsideTool ? styles.notLoaded : styles.loaded}>
            {(part.cheatDivergence * 100).toFixed(1)}%
            {drewOutsideTool
              ? " — sculpted outside the tool"
              : " — matches recorded actions"}
          </span>
        )}
      </dd>

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
  );
}

/** A trivial single-part rig for a static model, whose one part carries the whole
 * model's voxels. */
function staticRig(partName: string): ModelSpec {
  return { parts: [{ name: partName, pivot: [0, 0, 0] }], joints: [] };
}

/**
 * A static voxel model: an auto-rotating interactive 3D view beside the model's
 * own isometric preview PNG, plus its cheat-divergence signal — the 3D analog of
 * `SpriteResult`.
 */
function VoxelModelResult({ view }: { view: VoxelResultView }) {
  const part = view.parts[0];
  const partName = part?.name ?? "model";
  const rig = view.rig ?? staticRig(partName);
  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <figure style={{ margin: 0, textAlign: "center" }}>
          <div style={CANVAS_BOX}>
            <VoxelCanvas
              parts={view.parts}
              rig={rig}
              mode="auto-rotate"
              fallbackUrl={part?.regeneratedUrl ?? part?.previewUrl ?? null}
              label="Interactive model"
              height={240}
            />
          </div>
          <figcaption style={{ marginTop: 6 }}>Interactive model</figcaption>
        </figure>
        <figure style={{ margin: 0, textAlign: "center" }}>
          <VoxelFallback
            url={part?.previewUrl ?? null}
            label="Model's preview"
          />
          <figcaption style={{ marginTop: 6 }}>Model's preview</figcaption>
        </figure>
      </div>
      {part ? <VoxelSignals part={part} /> : null}
    </>
  );
}

/** Format a joint value for display: degrees for a rotation, voxel units for a
 * translation. */
function formatJointValue(joint: JointSpec, value: number): string {
  if (joint.kind === "rotation") {
    return `${((value * 180) / Math.PI).toFixed(0)}°`;
  }
  return value.toFixed(1);
}

/**
 * One caller-driven joint: a still, drag-to-inspect 3D view with a range slider
 * that poses just this joint (e.g. the tank's `turret_yaw`), laid out as a row
 * mirroring the sprite sheet's `SequenceRow`.
 */
function CallerJointRow({
  joint,
  rig,
  parts,
  fallbackUrl,
}: {
  joint: JointSpec;
  rig: ModelSpec;
  parts: VoxelPartView[];
  fallbackUrl: string | null;
}) {
  const [value, setValue] = useState(joint.rest);
  const step = (joint.max - joint.min) / 100 || 0.01;
  return (
    <div className={styles.sequenceRow}>
      <div className={styles.sequenceMeta}>
        <span className={styles.sequenceName}>{joint.name}</span>
        <span className={styles.sequenceSub}>
          caller · {joint.kind} · {formatJointValue(joint, value)}
        </span>
        <input
          type="range"
          min={joint.min}
          max={joint.max}
          step={step}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          aria-label={`${joint.name} value`}
          style={{ marginTop: 8, width: "100%" }}
        />
      </div>
      <div className={styles.sequencePlayer}>
        <div style={CANVAS_BOX}>
          <VoxelCanvas
            parts={parts}
            rig={rig}
            mode="orbit"
            callerJoints={{ [joint.name]: value }}
            fallbackUrl={fallbackUrl}
            label={`${joint.name} control`}
            height={240}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * One auto-play joint: a still, drag-to-inspect 3D view playing that joint's clip,
 * laid out as a row mirroring the sprite sheet's `SequenceRow`.
 */
function AutoJointRow({
  joint,
  rig,
  parts,
  fallbackUrl,
}: {
  joint: JointSpec;
  rig: ModelSpec;
  parts: VoxelPartView[];
  fallbackUrl: string | null;
}) {
  const period = joint.auto?.periodMs;
  return (
    <div className={styles.sequenceRow}>
      <div className={styles.sequenceMeta}>
        <span className={styles.sequenceName}>{joint.name}</span>
        <span className={styles.sequenceSub}>
          auto-play · {joint.kind}
          {period ? ` · ${period}ms loop` : ""}
        </span>
      </div>
      <div className={styles.sequencePlayer}>
        <div style={CANVAS_BOX}>
          <VoxelCanvas
            parts={parts}
            rig={rig}
            mode="orbit"
            autoPlayClip={joint.name}
            fallbackUrl={fallbackUrl}
            label={`${joint.name} animation`}
            height={240}
          />
        </div>
      </div>
    </div>
  );
}

/** The per-part breakdown as a grid — the voxel analog of the sprite results'
 * `FrameGrid`: each part's voxel count, operation count, cheat divergence, and
 * action-log link. */
function PartGrid({ parts }: { parts: VoxelPartView[] }) {
  return (
    <table className={`${styles.checks} ${styles.frameGrid}`}>
      <thead>
        <tr>
          <th scope="col">Part</th>
          <th scope="col">Voxels</th>
          <th scope="col">Ops</th>
          <th scope="col">Divergence</th>
          {/* The log column holds only the "log" link, so it needs no header. */}
          <th scope="col" aria-label="Action log" />
        </tr>
      </thead>
      <tbody>
        {parts.map((part) => {
          const drewOutsideTool =
            part.cheatDivergence !== null &&
            part.cheatDivergence > OUTSIDE_TOOL;
          return (
            <tr key={part.name}>
              <th scope="row" className={styles.checkName}>
                {part.name}
              </th>
              <td className={styles.secondary}>
                {part.voxelCount.toLocaleString()}
              </td>
              <td className={styles.secondary}>{part.operationCount}</td>
              <td>
                {part.cheatDivergence === null ? (
                  <span className={styles.secondary}>unmeasured</span>
                ) : (
                  <span
                    className={
                      drewOutsideTool ? styles.notLoaded : styles.loaded
                    }
                    title={
                      drewOutsideTool
                        ? "sculpted outside the tool"
                        : "matches recorded actions"
                    }
                  >
                    {(part.cheatDivergence * 100).toFixed(1)}%
                    {drewOutsideTool ? " — outside tool" : ""}
                  </span>
                )}
              </td>
              <td className={styles.frameLogCell}>
                {part.actionsUrl ? (
                  <a href={part.actionsUrl} target="_blank" rel="noreferrer">
                    log
                  </a>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * An animated (rigged) voxel model: one row per caller-driven joint (a slider that
 * poses the rig) and one per auto-play joint (playing its clip), then the per-part
 * breakdown — the 3D analog of `SheetResult`.
 */
function VoxelAnimationResult({ view }: { view: VoxelResultView }) {
  // The produced rig drives the viewer; fall back to the required rig, then to a
  // trivial single-part rig, so the parts at least render even if no rig resolved.
  const rig = view.rig ?? view.model ?? staticRig(view.parts[0]?.name ?? "model");
  const fallbackUrl =
    view.parts[0]?.regeneratedUrl ?? view.parts[0]?.previewUrl ?? null;
  const callerJoints = rig.joints.filter((j) => j.drive === "caller");
  const autoJoints = rig.joints.filter((j) => j.drive === "auto");

  return (
    <>
      {callerJoints.length > 0 ? (
        <>
          <h3 className={`${styles.section} ${styles.leadHeading}`}>
            Caller-driven joints
          </h3>
          <p className={styles.secondary}>
            The game-facing controls a consuming game drives at runtime. Drag the
            slider to pose the rig; drag the model to orbit it.
          </p>
          <div className={styles.sequenceGrid}>
            {callerJoints.map((joint) => (
              <CallerJointRow
                key={joint.name}
                joint={joint}
                rig={rig}
                parts={view.parts}
                fallbackUrl={fallbackUrl}
              />
            ))}
          </div>
        </>
      ) : null}

      {autoJoints.length > 0 ? (
        <>
          <h3 className={styles.section}>Auto-play joints</h3>
          <p className={styles.secondary}>
            Motion the model defined as a looping clip, played from the regenerated
            rig so it can be reviewed against the brief.
          </p>
          <div className={styles.sequenceGrid}>
            {autoJoints.map((joint) => (
              <AutoJointRow
                key={joint.name}
                joint={joint}
                rig={rig}
                parts={view.parts}
                fallbackUrl={fallbackUrl}
              />
            ))}
          </div>
        </>
      ) : null}

      <h3 className={styles.section}>Per-part details</h3>
      <p className={styles.secondary}>
        Each part is sculpted separately; its regenerated voxels are reviewed
        against the brief.
      </p>
      <PartGrid parts={view.parts} />
    </>
  );
}

/**
 * The generated-asset result for a voxel asset-generation run, shown at the top of
 * the Verdict tab. A static model (`voxel-model`) auto-rotates beside its preview;
 * an animated model (`voxel-animation`) exposes its caller and auto-play joints and
 * a per-part breakdown. Imported by {@link AssetResultSection}, which mounts it
 * when the run carries `validation.voxel`.
 */
export function VoxelResultSection({ view }: { view: VoxelResultView }) {
  return view.animated ? (
    <VoxelAnimationResult view={view} />
  ) : (
    <VoxelModelResult view={view} />
  );
}
