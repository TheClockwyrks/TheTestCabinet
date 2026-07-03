import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  AnimationSpec,
  JointSpec,
  ModelSpec,
} from "@test-cabinet/run-record";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import {
  fetchMeshesByPart,
  useVoxelArtifacts,
  type VoxelPartView,
  type VoxelResultView,
} from "../../../data/galleryContext";
import { prefersReducedMotion, supportsWebGL } from "../../../components/webgl";
import { GuardedVoxelViewer, type ViewerMeshes } from "./GuardedVoxelViewer";
import { GifDownloadButton } from "./GifDownloadButton";
import { encodeVoxelGif } from "./voxelGif";
import type { VoxelViewMode } from "./VoxelViewer";
import styles from "./RunDetailPages.module.scss";

/** The preview panel's background, resolved from the theme so a baked GIF's solid
 * backdrop matches the on-screen preview box (which uses the same var). */
function panelBackground(): string {
  if (typeof document === "undefined") return "#1c1c1c";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--tc-panel-2")
    .trim();
  return value || "#1c1c1c";
}

/** A filesystem-friendly `<name>.gif` for a downloaded clip. */
function voxelGifFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "animation"}.gif`;
}

// A stable empty animations list used as the fallback when a rig declares none, so
// the fallback is one shared constant rather than a fresh `[]` on every render.
const EMPTY_ANIMATIONS: AnimationSpec[] = [];

const CANVAS_BOX: React.CSSProperties = {
  width: 240,
  height: 240,
  background: "var(--tc-panel-2, #1c1c1c)",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  overflow: "hidden",
};

// The animated rig's shared preview is the section's single interactive view, so it
// is shown at twice the inline canvas size (which also gives the sidebar of joints
// beside it more height to fill).
const RIG_PREVIEW_SIZE = 480;
const RIG_PREVIEW_BOX: React.CSSProperties = {
  width: RIG_PREVIEW_SIZE,
  maxWidth: "100%",
  height: RIG_PREVIEW_SIZE,
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
 * The post-run 3D viewer for a part set: fetches each part's `mesh.json` (only on
 * a WebGL-capable browser whose user hasn't asked for reduced motion) and hands the
 * resolved meshes to {@link GuardedVoxelViewer}, which mounts the lazy 3D viewer
 * with an expand-to-fullscreen affordance (and falls back to the static PNG
 * otherwise).
 */
function VoxelCanvas({
  parts,
  rig,
  mode,
  callerJoints,
  animation,
  fallbackUrl,
  label,
  height,
  meshes,
  enabled,
}: {
  parts: VoxelPartView[];
  rig: ModelSpec;
  mode: VoxelViewMode;
  callerJoints?: Record<string, number>;
  animation?: AnimationSpec | null;
  fallbackUrl: string | null;
  label: string;
  height?: number;
  // When provided, the caller has already fetched (and possibly filtered) the meshes,
  // so this canvas renders them directly instead of fetching its own — used by the
  // animated reviewer, which hoists the fetch to compute geometry stats and isolate a
  // single part. When omitted, the canvas fetches its own (the static-model path).
  meshes?: ViewerMeshes;
  enabled?: boolean;
}) {
  // Start disabled so the first paint never blocks on capability checks (and SSR
  // never touches WebGL), and so the heavy `.glb` fetch is skipped for a browser that
  // will only ever show the static fallback; promote from an effect (client-only).
  // `GuardedVoxelViewer` re-checks the same capability before it mounts three.
  const [selfEnabled, setSelfEnabled] = useState(false);
  useEffect(() => {
    setSelfEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);
  const gate = enabled ?? selfEnabled;

  // Only fetch when the caller didn't hand us meshes. The hook must run every render,
  // so pass an empty part list when we already have meshes (or the view is disabled).
  const provided = meshes !== undefined;
  const artifacts = useVoxelArtifacts(!provided && gate ? parts : []);
  const resolved = provided ? meshes : artifacts.meshesByPart;

  return (
    <GuardedVoxelViewer
      meshes={resolved}
      rig={rig}
      mode={mode}
      callerJoints={callerJoints}
      animation={animation}
      fallbackUrl={fallbackUrl}
      label={label}
      height={height}
    />
  );
}

/** A part's operations / voxel-count readout — the voxel analog of the sprite
 * results' `FrameSignals`. */
function VoxelSignals({ part }: { part: VoxelPartView }) {
  return (
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
              fallbackUrl={part?.previewUrl ?? null}
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

/** The three ways to inspect a rig in the shared preview: play its model-authored
 * animations, pose its caller-driven joints, or isolate individual part meshes. Every
 * mode drives the *same* {@link VoxelCanvas}, so the whole rig is reviewed through a
 * single WebGL context rather than one per joint/animation (which exhausts the
 * browser's active-context budget and blanks the views). */
type ViewerMode = "animations" | "joints" | "meshes";

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<ViewerMode>> = [
  { value: "animations", label: "Animations" },
  { value: "joints", label: "Joints" },
  { value: "meshes", label: "Meshes" },
];

/** How many distinct joints an animation actually drives. A model-authored animation
 * drives its joints through its F-curve `tracks` (its declared `joints` list is empty
 * on the produced rig, so reading that would show "0 joints"); count the distinct
 * joints across the tracks, falling back to the declared list for a bare required
 * declaration with no authored tracks. */
function drivenJointCount(animation: AnimationSpec): number {
  const tracks = animation.tracks ?? [];
  if (tracks.length > 0) {
    return new Set(tracks.map((t) => t.joint)).size;
  }
  return animation.joints.length;
}

/** An animation's one-line summary: the joints it drives, its period, and whether it
 * loops / self-plays. */
function animationSummary(animation: AnimationSpec): string {
  const n = drivenJointCount(animation);
  return `${n} joint${n === 1 ? "" : "s"} · ${animation.periodMs}ms ${
    animation.looping ? "loop" : "once"
  }${animation.autoPlay ? " · idle" : ""}`;
}

/** A part mesh's complexity: vertex and triangle counts (3 floats per vertex in
 * `positions`, 3 indices per triangle). */
function meshComplexity(mesh: PartMesh): { vertices: number; triangles: number } {
  return {
    vertices: Math.floor(mesh.positions.length / 3),
    triangles: Math.floor(mesh.indices.length / 3),
  };
}

/** Whole-model geometry stats across every part: total vertices/triangles and the
 * bounding-box size (in voxel units). `null` while the meshes are still loading. */
function modelStats(
  meshes: Record<string, PartMesh> | null,
): {
  vertices: number;
  triangles: number;
  size: [number, number, number] | null;
} | null {
  if (!meshes) return null;
  let vertices = 0;
  let triangles = 0;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const mesh of Object.values(meshes)) {
    const c = meshComplexity(mesh);
    vertices += c.vertices;
    triangles += c.triangles;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      // In-bounds by the loop guard; `?? 0` only satisfies noUncheckedIndexedAccess.
      const x = p[i] ?? 0;
      const y = p[i + 1] ?? 0;
      const z = p[i + 2] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  const size: [number, number, number] | null = Number.isFinite(minX)
    ? [maxX - minX, maxY - minY, maxZ - minZ]
    : null;
  return { vertices, triangles, size };
}

/** A compact "W×H×D · N verts · M tris" readout of a model's geometry. */
function GeometryStats({
  stats,
}: {
  stats: {
    vertices: number;
    triangles: number;
    size: [number, number, number] | null;
  };
}) {
  const size = stats.size
    ? `${stats.size[0].toFixed(0)}×${stats.size[1].toFixed(0)}×${stats.size[2].toFixed(0)}`
    : "—";
  return (
    <div className={styles.voxelStats}>
      <span title="Bounding-box size (voxel units)">{size}</span>
      <span aria-hidden="true">·</span>
      <span title="Total vertices">{stats.vertices.toLocaleString()} verts</span>
      <span aria-hidden="true">·</span>
      <span title="Total triangles">
        {stats.triangles.toLocaleString()} tris
      </span>
    </div>
  );
}

/** The per-part breakdown as a grid — the voxel analog of the sprite results'
 * `FrameGrid`: each part's voxel count, operation count, and action-log link. */
function PartGrid({ parts }: { parts: VoxelPartView[] }) {
  return (
    <table className={`${styles.checks} ${styles.frameGrid}`}>
      <thead>
        <tr>
          <th scope="col">Part</th>
          <th scope="col">Voxels</th>
          <th scope="col">Ops</th>
          {/* The log column holds only the "log" link, so it needs no header. */}
          <th scope="col" aria-label="Action log" />
        </tr>
      </thead>
      <tbody>
        {parts.map((part) => (
          <tr key={part.name}>
            <th scope="row" className={styles.checkName}>
              {part.name}
            </th>
            <td className={styles.secondary}>
              {part.voxelCount.toLocaleString()}
            </td>
            <td className={styles.secondary}>{part.operationCount}</td>
            <td className={styles.frameLogCell}>
              {part.actionsUrl ? (
                <a href={part.actionsUrl} target="_blank" rel="noreferrer">
                  log
                </a>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * An animated (rigged) voxel model: a single shared 3D view driven by a picker of
 * the rig's model-authored animations and caller-driven joints (posed by a slider),
 * then the per-part breakdown — the 3D analog of `SheetResult`.
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
  const rig =
    view.rig ?? view.model ?? staticRig(view.parts[0]?.name ?? "model");
  const fallbackUrl = view.parts[0]?.previewUrl ?? null;
  // Animations are model-authored and ride in the produced `rig.json`, so read them
  // from the produced rig; fall back to the required declarations (they carry the
  // names even before the model authors tracks) for safety.
  const animations =
    view.rig?.animations ?? view.model?.animations ?? EMPTY_ANIMATIONS;
  const callerJoints = useMemo(
    () => rig.joints.filter((j) => j.drive === "caller"),
    [rig],
  );

  // Hoist the mesh fetch here (rather than inside the canvas) so we can show geometry
  // stats and isolate a single part's mesh in "Meshes" mode. Gated on the same
  // capability the canvas needs, and promoted from an effect so SSR/first paint never
  // touch WebGL or the heavy `.glb` fetch.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(supportsWebGL() && !prefersReducedMotion());
  }, []);
  const artifacts = useVoxelArtifacts(enabled ? view.parts : []);
  const meshes = artifacts.meshesByPart;
  const stats = useMemo(() => modelStats(meshes), [meshes]);

  const [mode, setMode] = useState<ViewerMode>("animations");
  const [selectedAnimation, setSelectedAnimation] = useState(
    () => animations[0]?.name ?? "",
  );
  const activeAnimation =
    animations.find((a) => a.name === selectedAnimation) ??
    animations[0] ??
    null;
  // The part isolated in "Meshes" mode; `""` shows the assembled model.
  const [selectedPart, setSelectedPart] = useState<string>("");

  // Caller-joint slider values, keyed by joint name and defaulting to each joint's
  // rest, so posing one joint then switching modes (and back) preserves where the
  // reviewer left every slider. The whole map is always fed to the shared canvas, so
  // a played animation overrides only the joints its tracks drive.
  const [callerValues, setCallerValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(callerJoints.map((j) => [j.name, j.rest])),
  );

  // Only an animation — which loops over a period — can be baked to a GIF; posed
  // joints and isolated meshes have no motion over time to capture.
  const downloadable =
    mode === "animations" && activeAnimation && activeAnimation.periodMs > 0
      ? activeAnimation
      : null;
  // Baking a GIF renders offscreen with WebGL, so only offer it where WebGL is
  // available (the same capability the preview itself needs).
  const [webglOk, setWebglOk] = useState(false);
  useEffect(() => setWebglOk(supportsWebGL()), []);

  // What the shared canvas plays and shows, by mode: play the selected animation
  // ("animations"); pose the caller sliders with nothing playing ("joints"); or
  // isolate one part at rest ("meshes", `selectedPart` set).
  const playback =
    mode === "animations" && activeAnimation
      ? { animation: activeAnimation }
      : {};
  const selectedMesh =
    mode === "meshes" && selectedPart && meshes
      ? meshes[selectedPart]
      : undefined;
  const viewerMeshes: ViewerMeshes =
    mode === "meshes" && selectedPart && meshes
      ? selectedMesh
        ? { [selectedPart]: selectedMesh }
        : {}
      : meshes;
  const label =
    mode === "meshes" && selectedPart
      ? `${selectedPart} mesh`
      : activeAnimation
        ? `${activeAnimation.name} preview`
        : "Rig preview";

  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>Rig preview</h3>
      <p className={styles.secondary}>
        Switch between the model's <strong>animations</strong> (the F-curve
        choreographies it authored — an idle plays on its own, a named playable a
        game triggers), its game-drivable <strong>joints</strong> (posed by a
        slider), and its individual <strong>meshes</strong> (each part on its
        own). Drag the model to orbit it.
      </p>
      <div
        className={styles.rigPreview}
        style={
          { "--rig-preview-size": `${RIG_PREVIEW_SIZE}px` } as CSSProperties
        }
      >
        <div className={styles.rigPreviewSidebar}>
          <SegmentedControl
            options={MODE_OPTIONS}
            value={mode}
            onChange={setMode}
            ariaLabel="Rig view mode"
          />
          {stats ? <GeometryStats stats={stats} /> : null}
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
            ) : null}

            {mode === "joints" ? (
              callerJoints.length > 0 ? (
                callerJoints.map((joint) => {
                  const value = callerValues[joint.name] ?? joint.rest;
                  return (
                    <div key={joint.name} className={styles.voxelSlider}>
                      <span className={styles.voxelPickerName}>
                        {joint.name}
                      </span>
                      <span className={styles.sequenceSub}>
                        {joint.kind} · {formatJointValue(joint, value)}
                      </span>
                      <input
                        type="range"
                        min={joint.min}
                        max={joint.max}
                        // Continuous posing (`any`) rather than a computed numeric
                        // step: a joint's rest or a game value rarely lands on a
                        // `(max-min)/100` grid, and a browser that doesn't silently
                        // snap (e.g. Safari) then flags it invalid. `any` accepts any
                        // value in range, so there's no grid to violate.
                        step="any"
                        value={value}
                        onChange={(e) =>
                          setCallerValues((prev) => ({
                            ...prev,
                            [joint.name]: Number(e.target.value),
                          }))
                        }
                        aria-label={`${joint.name} value`}
                        style={{ width: "100%" }}
                      />
                    </div>
                  );
                })
              ) : (
                <p className={styles.secondary}>
                  This model exposes no game-drivable joints — its motion lives in
                  the Animations tab.
                </p>
              )
            ) : null}

            {mode === "meshes" ? (
              <>
                <button
                  type="button"
                  className={`${styles.voxelPickerButton} ${
                    selectedPart === "" ? styles.voxelPickerButtonActive : ""
                  }`}
                  aria-pressed={selectedPart === ""}
                  onClick={() => setSelectedPart("")}
                >
                  <span className={styles.voxelPickerName}>All parts</span>
                  {stats ? (
                    <span className={styles.voxelPickerSub}>
                      {stats.vertices.toLocaleString()} verts ·{" "}
                      {stats.triangles.toLocaleString()} tris
                    </span>
                  ) : null}
                </button>
                {view.parts.map((part) => {
                  const mesh = meshes ? meshes[part.name] : undefined;
                  const c = mesh ? meshComplexity(mesh) : null;
                  return (
                    <button
                      key={part.name}
                      type="button"
                      className={`${styles.voxelPickerButton} ${
                        selectedPart === part.name
                          ? styles.voxelPickerButtonActive
                          : ""
                      }`}
                      aria-pressed={selectedPart === part.name}
                      onClick={() => setSelectedPart(part.name)}
                    >
                      <span className={styles.voxelPickerName}>{part.name}</span>
                      <span className={styles.voxelPickerSub}>
                        {c
                          ? `${c.vertices.toLocaleString()} verts · ${c.triangles.toLocaleString()} tris`
                          : "—"}
                      </span>
                    </button>
                  );
                })}
              </>
            ) : null}
          </div>
          {downloadable && webglOk ? (
            <GifDownloadButton
              filename={voxelGifFilename(downloadable.name)}
              encode={async () => {
                const gifMeshes = await fetchMeshesByPart(view.parts);
                return encodeVoxelGif({
                  meshes: gifMeshes,
                  rig,
                  animation: downloadable,
                  callerJoints: callerValues,
                  periodMs: downloadable.periodMs,
                  background: panelBackground(),
                });
              }}
            />
          ) : null}
        </div>
        <div className={styles.rigPreviewStage}>
          <div style={RIG_PREVIEW_BOX}>
            <VoxelCanvas
              parts={view.parts}
              rig={rig}
              mode="orbit"
              meshes={viewerMeshes}
              enabled={enabled}
              callerJoints={callerValues}
              {...playback}
              fallbackUrl={fallbackUrl}
              label={label}
              height={RIG_PREVIEW_SIZE}
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
