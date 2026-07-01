import { useMemo, useState } from "react";
import { Panel } from "@test-cabinet/ui";
import type { AssetSheet, ModelSpec, VoxelsFile } from "@test-cabinet/run-record";
import type { AssetPreview } from "../../../../client/types";
import { GuardedVoxelViewer } from "./GuardedVoxelViewer";
import styles from "./RunDetailPages.module.scss";

// The model's sprites are tiny; scale them up with crisp (nearest-neighbor)
// sampling over a checkerboard so transparency reads and pixels stay sharp —
// matching how the finished-run asset view renders them.
const CHECKER =
  "repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px";

const SPRITE_LARGE: React.CSSProperties = {
  width: 240,
  height: 240,
  imageRendering: "pixelated",
  background: CHECKER,
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
};

const SPRITE_THUMB: React.CSSProperties = {
  width: 44,
  height: 44,
  imageRendering: "pixelated",
  background: CHECKER,
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
};

// A base64 PNG (no prefix) as a renderable data URL.
const dataUrl = (image: string) => `data:image/png;base64,${image}`;

/** One slot the case wants the model to fill: a declared frame (for a sprite
 * sheet) or the single sprite. `name` is what the brief asks for in that slot
 * (derived from the sheet's named sequences); `sub` is a short position hint. */
interface Slot {
  index: number;
  name: string;
  sub: string | null;
}

/** Name a sprite-sheet frame from the first sequence that plays it (with its
 * position in that sequence), falling back to "Frame N" for a frame in no
 * sequence. The first sequence to play a frame names it, so each frame reads as
 * the motion it primarily belongs to. */
function sheetSlotName(sheet: AssetSheet, index: number): Slot {
  for (const sequence of sheet.sequences) {
    const position = sequence.frames.indexOf(index);
    if (position === -1) continue;
    return {
      index,
      name: sequence.name,
      sub:
        sequence.frames.length > 1
          ? `${position + 1} of ${sequence.frames.length}`
          : null,
    };
  }
  return { index, name: `Frame ${index}`, sub: null };
}

/**
 * Build one slot per part a voxel-animation run will fill, named from the declared
 * parts (whose declared order is the live preview's `frame` index). Includes any
 * preview index beyond the declared parts, so an unresolved catalog still shows
 * every part a preview arrived for.
 */
function modelSlots(
  model: ModelSpec,
  previews: Map<number, AssetPreview>,
): Slot[] {
  const slots: Slot[] = model.parts.map((part, index) => ({
    index,
    name: part.name,
    sub: null,
  }));
  for (const index of previews.keys()) {
    if (!slots.some((s) => s.index === index)) {
      slots.push({ index, name: `Part ${index}`, sub: null });
    }
  }
  return slots.sort((a, b) => a.index - b.index);
}

/**
 * Build one slot per frame/part the run will fill, so the sidebar is stable from
 * the first render — before the model has drawn into any of them. The slots are the
 * union of the case's declared frames (when the catalog resolved a sprite sheet)
 * or parts (a voxel-animation rig) and any index a preview has already arrived for
 * (so a run still shows every slot even when the catalog couldn't be resolved). A
 * sheet's frames are named from its sequences, a rig's from its parts; a lone frame
 * with neither is the single sprite or static voxel model, named after the case.
 */
function buildSlots(
  sheet: AssetSheet | null,
  model: ModelSpec | null,
  previews: Map<number, AssetPreview>,
  assetLabel: string,
): Slot[] {
  // A voxel-animation rig maps preview slots to its declared parts.
  if (model) return modelSlots(model, previews);

  const indices = new Set<number>();
  if (sheet) for (const frame of sheet.frames) indices.add(frame);
  for (const frame of previews.keys()) indices.add(frame);
  const sorted = [...indices].sort((a, b) => a - b);
  // A single frame with no declared sheet is the single-sprite (or static voxel
  // model) case.
  const isSingle = !sheet && sorted.length <= 1;
  if (sorted.length === 0) return [{ index: 0, name: assetLabel, sub: null }];
  return sorted.map((index) => {
    if (sheet) return sheetSlotName(sheet, index);
    return {
      index,
      name: isSingle ? assetLabel : `Frame ${index}`,
      sub: null,
    };
  });
}

/** A slot's current canvas (the latest preview for it), or a placeholder while
 * the model has not drawn into it yet. */
function SlotImage({
  preview,
  style,
  alt,
}: {
  preview: AssetPreview | undefined;
  style: React.CSSProperties;
  alt: string;
}) {
  if (preview) return <img src={dataUrl(preview.image)} alt={alt} style={style} />;
  return (
    <div
      style={{ ...style, display: "grid", placeItems: "center" }}
      aria-label={`${alt} — not started`}
    >
      <span className={styles.secondary} style={{ fontSize: "0.7rem" }}>
        not started
      </span>
    </div>
  );
}

/** A trivial single-part rig whose one part carries the whole model's voxels — used
 * for a static voxel model and for each per-part live view. */
function staticRig(partName: string): ModelSpec {
  return { parts: [{ name: partName, pivot: [0, 0, 0] }], joints: [] };
}

/** Whether any streamed preview carries voxel geometry — the signal that this is a
 * voxel run (a voxel-animation case also declares a `model` up front). */
function isVoxelRun(
  previews: Map<number, AssetPreview>,
  model: ModelSpec | null,
): boolean {
  if (model) return true;
  for (const preview of previews.values()) if (preview.voxels) return true;
  return false;
}

/**
 * The live 3D view for an in-progress voxel run. As the model sculpts, each
 * operation streams the part's current voxels (alongside its isometric PNG); this
 * rebuilds the model in 3D and rotates it, exactly as the finished-run view does —
 * no need to wait for the run to complete.
 *
 * Two views are offered for a rigged (animated) model:
 * - **Scene** assembles every part whose mount location is known — i.e. every part
 *   the case declared, posed at rest into the shape the finished instance will
 *   take. A part the model added of its own (a preview beyond the declared parts,
 *   whose mount the scene can't yet place) is left out of the scene until then; it
 *   still appears in the per-part Model view.
 * - **Model** shows one part at a time (the one being sculpted, or a part picked
 *   from the rail), so a single component can be inspected as it takes shape.
 *
 * A static (single-part) model has just the one rotating view. When WebGL is
 * unavailable or the user prefers reduced motion, each view falls back to the
 * streamed isometric PNG so the run stays watchable.
 */
function LiveVoxelView({
  previews,
  activeFrame,
  model,
}: {
  previews: Map<number, AssetPreview>;
  activeFrame: number | null;
  model: ModelSpec | null;
}) {
  const animated = model !== null;
  const [view, setView] = useState<"scene" | "model">("scene");
  // The user can pin the per-part view to a slot; until then it follows the part
  // being sculpted.
  const [picked, setPicked] = useState<number | null>(null);

  // A content signature so the voxel objects (and the meshes built from them) are
  // rebuilt only when a new operation arrives, not on every render.
  const signature = [...previews.entries()]
    .map(([index, p]) => `${index}:${p.operationCount}:${p.voxels ? 1 : 0}`)
    .sort()
    .join(",");

  // The streamed voxels for each part, keyed by its preview (part) index.
  const voxelsByIndex = useMemo(() => {
    const map = new Map<number, VoxelsFile>();
    for (const [index, preview] of previews) {
      if (preview.voxels) map.set(index, preview.voxels);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Frame the camera from the fixed volume so it holds steady as the model grows;
  // every part shares the same declared volume, so any streamed part's dims serve.
  const frameDims = useMemo(() => {
    for (const file of voxelsByIndex.values()) return file.dims;
    return null;
  }, [voxelsByIndex]);

  // The slots the case will fill: one per declared part (a rig), or the single model
  // (a static voxel case), unioned with any streamed index beyond them.
  const slots = useMemo(
    () => buildSlots(null, model, previews, "Model"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, signature],
  );

  // The assembled scene: every part whose mount location is known (a declared rig
  // part), keyed by part name for the rig. A model-added part beyond the declared
  // set has no known mount yet, so it is left out of the scene.
  const sceneRig = useMemo<ModelSpec>(() => model ?? staticRig("model"), [model]);
  const sceneVoxels = useMemo(() => {
    const byPart: Record<string, VoxelsFile> = {};
    if (model) {
      model.parts.forEach((part, index) => {
        const file = voxelsByIndex.get(index);
        if (file) byPart[part.name] = file;
      });
    } else {
      const file = voxelsByIndex.get(0);
      if (file) byPart.model = file;
    }
    return byPart;
  }, [model, voxelsByIndex]);

  // The per-part Model view's selected part: the user's pick, else the part being
  // sculpted, else the first slot.
  const selectedIndex = picked ?? activeFrame ?? slots[0]?.index ?? 0;
  const selectedSlot =
    slots.find((s) => s.index === selectedIndex) ?? slots[0] ?? null;
  const selectedName = selectedSlot?.name ?? "model";
  const selectedVoxels = voxelsByIndex.get(selectedIndex) ?? null;
  const partRig = useMemo(() => staticRig(selectedName), [selectedName]);
  const fallbackFor = (index: number): string | null => {
    const preview = previews.get(index);
    return preview ? dataUrl(preview.image) : null;
  };

  // The scene assembles declared parts; the per-part view is only meaningful for a
  // multi-part rig, so a static model always shows the single scene view.
  const showModel = view === "model" && animated;

  return (
    <Panel>
      <h2 className={`${styles.section} ${styles.leadHeading}`}>Live model</h2>
      <p className={styles.secondary}>
        The model's in-progress geometry, rebuilt in 3D after each sculpting
        operation and rotated so you can read it from every side. The recorded action
        log is the run's authoritative output; this preview is just a live look at
        it.
      </p>

      {animated && (
        <div className={styles.viewToggle} role="tablist" aria-label="Live 3D view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "scene"}
            className={`${styles.viewToggleButton}${
              view === "scene" ? ` ${styles.viewToggleActive}` : ""
            }`}
            onClick={() => setView("scene")}
          >
            Scene
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "model"}
            className={`${styles.viewToggleButton}${
              view === "model" ? ` ${styles.viewToggleActive}` : ""
            }`}
            onClick={() => setView("model")}
          >
            Model
          </button>
        </div>
      )}

      {showModel ? (
        <div className={styles.liveLayout}>
          <nav className={styles.slotRail} aria-label="Model parts">
            <p className={styles.slotRailLabel}>
              {voxelsByIndex.size}/{slots.length} sculpted
            </p>
            <ul className={styles.slotList}>
              {slots.map((slot) => {
                const preview = previews.get(slot.index);
                const isDrawing = slot.index === activeFrame;
                const isSelected = slot.index === selectedIndex;
                return (
                  <li key={slot.index}>
                    <button
                      type="button"
                      className={`${styles.slotButton}${
                        isSelected ? ` ${styles.slotButtonSelected}` : ""
                      }`}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => setPicked(slot.index)}
                    >
                      <SlotImage
                        preview={preview}
                        style={SPRITE_THUMB}
                        alt={slot.name}
                      />
                      <span className={styles.slotMeta}>
                        <span className={styles.slotName}>{slot.name}</span>
                        <span className={styles.slotSub}>
                          {preview
                            ? `${preview.operationCount} ${
                                preview.operationCount === 1 ? "op" : "ops"
                              }`
                            : "—"}
                          {isDrawing ? " · sculpting" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <figure className={styles.liveMain}>
            <div className={styles.liveVoxelCanvas}>
              <GuardedVoxelViewer
                voxels={selectedVoxels}
                rig={partRig}
                mode="auto-rotate"
                frameDims={frameDims}
                fallbackUrl={fallbackFor(selectedIndex)}
                label={`${selectedName} (in progress)`}
                height={340}
                fullscreenable={false}
              />
            </div>
            <figcaption className={styles.liveCaption}>
              <strong>{selectedName}</strong>
              {selectedSlot && previews.get(selectedIndex) ? (
                <span className={styles.secondary}>
                  {" · "}
                  {previews.get(selectedIndex)!.operationCount} operations
                </span>
              ) : (
                <span className={styles.secondary}> · not started</span>
              )}
            </figcaption>
          </figure>
        </div>
      ) : (
        <figure className={styles.liveMain}>
          <div className={styles.liveVoxelCanvas}>
            <GuardedVoxelViewer
              voxels={animated ? sceneVoxels : (voxelsByIndex.get(0) ?? null)}
              rig={sceneRig}
              mode="auto-rotate"
              frameDims={frameDims}
              fallbackUrl={fallbackFor(activeFrame ?? 0)}
              label={animated ? "Assembled scene (in progress)" : "Model (in progress)"}
              height={340}
              fullscreenable={false}
            />
          </div>
          <figcaption className={styles.liveCaption}>
            <strong>{animated ? "Assembled scene" : "Model"}</strong>
            <span className={styles.secondary}>
              {" · "}
              {animated
                ? `${Object.keys(sceneVoxels).length}/${model!.parts.length} parts placed`
                : `${voxelsByIndex.get(0)?.voxels.length.toLocaleString() ?? 0} voxels`}
            </span>
          </figcaption>
        </figure>
      )}
    </Panel>
  );
}

/**
 * The live drawing view for an in-progress asset-generation run. As the model
 * issues drawing operations, each re-rendered frame is streamed here (out of band
 * from the event feed); this shows the current canvas updating in real time.
 *
 * The sidebar lists every slot the case declares — one per sprite-sheet frame, or
 * the single sprite — named from the case's sequences, so it stays stable as the
 * model fills them in (slots it hasn't drawn yet show a placeholder). The slot
 * being drawn into is highlighted; the larger view follows it until the user
 * clicks another slot to inspect it. A single-sprite case has just the one
 * canvas, so it skips the sidebar.
 *
 * Renders nothing only when there is no declared sheet and no preview has arrived
 * (a non-asset run), so it is safe to mount for any observed run.
 */
export function LiveAssetView({
  previews,
  activeFrame,
  sheet,
  model,
  assetLabel,
}: {
  previews: Map<number, AssetPreview>;
  activeFrame: number | null;
  /** The case's declared sprite sheet, when known; null for a single sprite or
   * when the host couldn't resolve the catalog. */
  sheet: AssetSheet | null;
  /** The case's declared voxel-animation rig, when known; null for a static voxel
   * model, a 2D sprite/sheet, or when the host couldn't resolve the catalog. Its
   * parts name the live slots (a part's declared order is its preview index). */
  model: ModelSpec | null;
  /** What the single slot is named after (the case name); unused for a sheet or
   * rig. */
  assetLabel: string;
}) {
  // The user can pin the large view to a slot; until then it follows the frame
  // the model is drawing into.
  const [picked, setPicked] = useState<number | null>(null);

  // Nothing to show for a non-asset run that has streamed no previews.
  if (!sheet && !model && previews.size === 0) return null;

  // A voxel run (a declared rig, or any streamed voxel geometry) renders its
  // in-progress model in 3D rather than as a flat sprite canvas.
  if (isVoxelRun(previews, model)) {
    return (
      <LiveVoxelView previews={previews} activeFrame={activeFrame} model={model} />
    );
  }

  const slots = buildSlots(sheet, model, previews, assetLabel);
  const showRail = slots.length > 1;
  // The slot shown large: the user's pick, else the frame being drawn, else the
  // first declared slot.
  const selectedIndex =
    picked ??
    activeFrame ??
    slots[0]?.index ??
    0;
  const selected =
    slots.find((s) => s.index === selectedIndex) ?? slots[0] ?? null;
  const current = previews.get(selectedIndex);

  return (
    <Panel>
      <h2 className={`${styles.section} ${styles.leadHeading}`}>Live drawing</h2>
      <p className={styles.secondary}>
        The model's current canvas, re-rendered after each drawing operation. The
        recorded action log is the run's authoritative output; this preview is just
        a live look at it.
      </p>

      <div className={showRail ? styles.liveLayout : undefined}>
        {showRail && (
          <nav className={styles.slotRail} aria-label="Asset slots">
            <p className={styles.slotRailLabel}>
              {previews.size}/{slots.length} started
            </p>
            <ul className={styles.slotList}>
              {slots.map((slot) => {
                const preview = previews.get(slot.index);
                const isDrawing = slot.index === activeFrame;
                const isSelected = slot.index === selectedIndex;
                return (
                  <li key={slot.index}>
                    <button
                      type="button"
                      className={`${styles.slotButton}${
                        isSelected ? ` ${styles.slotButtonSelected}` : ""
                      }`}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => setPicked(slot.index)}
                    >
                      <SlotImage
                        preview={preview}
                        style={SPRITE_THUMB}
                        alt={slot.name}
                      />
                      <span className={styles.slotMeta}>
                        <span className={styles.slotName}>{slot.name}</span>
                        <span className={styles.slotSub}>
                          {slot.sub ? `${slot.sub} · ` : ""}
                          {preview
                            ? `${preview.operationCount} ${
                                preview.operationCount === 1 ? "op" : "ops"
                              }`
                            : "—"}
                          {isDrawing ? " · drawing" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <figure className={styles.liveMain}>
          <SlotImage
            preview={current}
            style={SPRITE_LARGE}
            alt={selected ? selected.name : "Current sprite"}
          />
          <figcaption className={styles.liveCaption}>
            {selected ? <strong>{selected.name}</strong> : null}
            {selected?.sub ? (
              <span className={styles.secondary}> · {selected.sub}</span>
            ) : null}
            {current ? (
              <span className={styles.secondary}>
                {" · "}
                {current.operationCount}{" "}
                {current.operationCount === 1 ? "operation" : "operations"}
                {current.operation ? ` · ${current.operation}` : ""}
              </span>
            ) : (
              <span className={styles.secondary}> · not started</span>
            )}
          </figcaption>
        </figure>
      </div>
    </Panel>
  );
}
