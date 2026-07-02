import { useEffect, useMemo, useState } from "react";
import type { AnimationSpec, JointSpec, ModelSpec } from "@test-cabinet/run-record";
import {
  useVoxelArtifacts,
  type VoxelPartView,
  type VoxelResultView,
} from "../../../data/galleryContext";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import { GuardedVoxelViewer } from "./GuardedVoxelViewer";
import type { VoxelViewMode } from "./VoxelViewer";
import styles from "./RunDetailPages.module.scss";

// Divergence at or above this fraction reads as "drew outside the tool" — the same
// threshold the sprite results use.
const OUTSIDE_TOOL = 0.05;

// A stable empty animations list, so a rig with no predetermined animations doesn't
// hand `buildRigViews`'s memo a fresh array (new identity) every render.
const EMPTY_ANIMATIONS: AnimationSpec[] = [];

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
 * The post-run 3D viewer for a part set: fetches each part's `voxels.json` (only on
 * a WebGL-capable browser whose user hasn't asked for reduced motion) and hands the
 * resolved data to {@link GuardedVoxelViewer}, which mounts the lazy 3D viewer with
 * an expand-to-fullscreen affordance (and falls back to the static PNG otherwise).
 */
function VoxelCanvas({
  parts,
  rig,
  mode,
  autoPlayClip,
  callerJoints,
  animation,
  fallbackUrl,
  label,
  height,
}: {
  parts: VoxelPartView[];
  rig: ModelSpec;
  mode: VoxelViewMode;
  autoPlayClip?: string | null;
  callerJoints?: Record<string, number>;
  animation?: AnimationSpec | null;
  fallbackUrl: string | null;
  label: string;
  height?: number;
}) {
  // Start disabled so the first paint never blocks on capability checks (and SSR
  // never touches WebGL), and so the heavy `voxels.json` fetch is skipped for a
  // browser that will only ever show the static fallback; promote from an effect
  // (client-only). `GuardedVoxelViewer` re-checks the same capability before it
  // mounts three.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);

  const artifacts = useVoxelArtifacts(enabled ? parts : []);

  return (
    <GuardedVoxelViewer
      voxels={artifacts.voxelsByPart}
      rig={rig}
      mode={mode}
      autoPlayClip={autoPlayClip}
      callerJoints={callerJoints}
      animation={animation}
      fallbackUrl={fallbackUrl}
      label={label}
      height={height}
    />
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
 * One selectable entry in the shared rig preview: a predetermined animation, a
 * caller-driven joint (posed by a slider), or an auto-play joint (playing its clip).
 * Every entry drives the *same* {@link VoxelCanvas}, so the whole rig is reviewed
 * through a single WebGL context instead of one per joint/animation (which exhausts
 * the browser's active-context budget and blanks the views — see
 * {@link VoxelAnimationResult}).
 */
type RigView =
  | { kind: "animation"; key: string; name: string; sub: string; animation: AnimationSpec }
  | { kind: "caller"; key: string; name: string; sub: string; joint: JointSpec }
  | { kind: "auto"; key: string; name: string; sub: string; joint: JointSpec };

// The picker's groups, in display order. Each maps to a `RigView.kind`; a group
// with no entries is omitted.
const RIG_VIEW_GROUPS: { kind: RigView["kind"]; label: string }[] = [
  { kind: "animation", label: "Animations" },
  { kind: "caller", label: "Caller-driven joints" },
  { kind: "auto", label: "Auto-play joints" },
];

/** The selectable views for a rig: its predetermined animations, then its
 * caller-driven joints, then its auto-play joints — the flattened superset the old
 * per-section rows rendered, now feeding one shared canvas. */
function buildRigViews(rig: ModelSpec, animations: AnimationSpec[]): RigView[] {
  const views: RigView[] = [];
  for (const animation of animations) {
    const n = animation.tracks.length;
    views.push({
      kind: "animation",
      key: `animation:${animation.name}`,
      name: animation.name,
      sub: `${n} joint${n === 1 ? "" : "s"} · ${animation.periodMs}ms ${animation.looping ? "loop" : "once"}`,
      animation,
    });
  }
  for (const joint of rig.joints.filter((j) => j.drive === "caller")) {
    views.push({
      kind: "caller",
      key: `caller:${joint.name}`,
      name: joint.name,
      sub: joint.kind,
      joint,
    });
  }
  for (const joint of rig.joints.filter((j) => j.drive === "auto")) {
    views.push({
      kind: "auto",
      key: `auto:${joint.name}`,
      name: joint.name,
      sub: `${joint.kind}${joint.auto?.periodMs ? ` · ${joint.auto.periodMs}ms loop` : ""}`,
      joint,
    });
  }
  return views;
}

/** The grouped list of rig views to choose from; the active one drives the shared
 * canvas. Groups with no entries are dropped. */
function RigViewPicker({
  views,
  selectedKey,
  onSelect,
}: {
  views: RigView[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className={styles.voxelPicker}>
      {RIG_VIEW_GROUPS.map((group) => {
        const items = views.filter((v) => v.kind === group.kind);
        if (items.length === 0) return null;
        return (
          <div key={group.kind} className={styles.voxelPickerGroup}>
            <span className={styles.voxelPickerGroupLabel}>{group.label}</span>
            {items.map((view) => (
              <button
                key={view.key}
                type="button"
                className={`${styles.voxelPickerButton} ${
                  view.key === selectedKey ? styles.voxelPickerButtonActive : ""
                }`}
                aria-pressed={view.key === selectedKey}
                onClick={() => onSelect(view.key)}
              >
                <span className={styles.voxelPickerName}>{view.name}</span>
                <span className={styles.voxelPickerSub}>{view.sub}</span>
              </button>
            ))}
          </div>
        );
      })}
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
 * An animated (rigged) voxel model: a single shared 3D view driven by a picker of
 * the rig's predetermined animations, caller-driven joints (posed by a slider), and
 * auto-play joints (playing their clip), then the per-part breakdown — the 3D analog
 * of `SheetResult`.
 *
 * A rig can expose many joints and animations; rendering each in its own
 * {@link VoxelCanvas} spins up one WebGL context apiece, and a rig with a handful of
 * joints quickly exceeds the browser's active-context budget — at which point the
 * browser discards the oldest contexts and (since R3F doesn't restore them) those
 * views blank out a beat after they appear. Funnelling the whole rig through one
 * shared canvas keeps the page to a single context regardless of joint count.
 */
function VoxelAnimationResult({ view }: { view: VoxelResultView }) {
  // The produced rig drives the viewer; fall back to the required rig, then to a
  // trivial single-part rig, so the parts at least render even if no rig resolved.
  const rig = view.rig ?? view.model ?? staticRig(view.parts[0]?.name ?? "model");
  const fallbackUrl =
    view.parts[0]?.regeneratedUrl ?? view.parts[0]?.previewUrl ?? null;
  // Predetermined animations are authored on the case's declared model spec (they
  // are not produced into the rig), so read them from there, falling back to the
  // produced rig for safety.
  const animations = view.model?.animations ?? view.rig?.animations ?? EMPTY_ANIMATIONS;
  const views = useMemo(() => buildRigViews(rig, animations), [rig, animations]);

  const [selectedKey, setSelectedKey] = useState(() => views[0]?.key ?? "");
  const active = views.find((v) => v.key === selectedKey) ?? views[0] ?? null;

  // Caller-joint slider values, keyed by joint name and defaulting to each joint's
  // rest, so posing one joint then switching views (and back) preserves where the
  // reviewer left every slider. The whole map is always fed to the shared canvas, so
  // an auto/animation view still holds the caller joints at their posed values (and
  // the played animation overrides only the joints its tracks drive).
  const [callerValues, setCallerValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      rig.joints.filter((j) => j.drive === "caller").map((j) => [j.name, j.rest]),
    ),
  );

  // Which clip/animation the shared canvas plays for the active view; caller views
  // play nothing and are posed purely by `callerValues`.
  const playback =
    active?.kind === "animation"
      ? { animation: active.animation }
      : active?.kind === "auto"
        ? { autoPlayClip: active.joint.name }
        : {};

  const activeCaller = active?.kind === "caller" ? active.joint : null;
  const activeValue = activeCaller
    ? callerValues[activeCaller.name] ?? activeCaller.rest
    : 0;

  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>Rig preview</h3>
      <p className={styles.secondary}>
        Pick an animation or joint to drive the model — the whole rig plays through
        one shared view. Predetermined animations are the choreographies the case
        authored; caller-driven joints expose a slider a consuming game would drive;
        auto-play joints loop the clip the model defined. Drag the model to orbit it.
      </p>
      <div className={styles.sequenceRow}>
        <div className={styles.sequenceMeta}>
          <RigViewPicker
            views={views}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
          {activeCaller ? (
            <div className={styles.voxelSlider}>
              <span className={styles.sequenceSub}>
                {activeCaller.kind} · {formatJointValue(activeCaller, activeValue)}
              </span>
              <input
                type="range"
                min={activeCaller.min}
                max={activeCaller.max}
                step={(activeCaller.max - activeCaller.min) / 100 || 0.01}
                value={activeValue}
                onChange={(e) =>
                  setCallerValues((prev) => ({
                    ...prev,
                    [activeCaller.name]: Number(e.target.value),
                  }))
                }
                aria-label={`${activeCaller.name} value`}
                style={{ width: "100%" }}
              />
            </div>
          ) : null}
        </div>
        <div className={styles.sequencePlayer}>
          <div style={CANVAS_BOX}>
            <VoxelCanvas
              parts={view.parts}
              rig={rig}
              mode="orbit"
              callerJoints={callerValues}
              {...playback}
              fallbackUrl={fallbackUrl}
              label={active ? `${active.name} preview` : "Rig preview"}
              height={240}
            />
          </div>
        </div>
      </div>

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
