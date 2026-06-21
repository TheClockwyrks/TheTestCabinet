import { useState } from "react";
import { Panel } from "@test-cabinet/ui";
import type { AssetSheet } from "@test-cabinet/run-record";
import type { AssetPreview } from "../../../../client/types";
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
 * Build one slot per frame the run will fill, so the sidebar is stable from the
 * first render — before the model has drawn into any of them. The slots are the
 * union of the case's declared frames (when the catalog resolved a sprite sheet)
 * and any frame a preview has already arrived for (so a sheet run still shows
 * every frame even when the catalog couldn't be resolved). A sheet's frames are
 * named from its sequences; a lone frame with no sheet is the single sprite,
 * named after the case.
 */
function buildSlots(
  sheet: AssetSheet | null,
  previews: Map<number, AssetPreview>,
  assetLabel: string,
): Slot[] {
  const indices = new Set<number>();
  if (sheet) for (const frame of sheet.frames) indices.add(frame);
  for (const frame of previews.keys()) indices.add(frame);
  const sorted = [...indices].sort((a, b) => a - b);
  // A single frame with no declared sheet is the single-sprite case.
  const isSingleSprite = !sheet && sorted.length <= 1;
  if (sorted.length === 0) return [{ index: 0, name: assetLabel, sub: null }];
  return sorted.map((index) => {
    if (sheet) return sheetSlotName(sheet, index);
    return {
      index,
      name: isSingleSprite ? assetLabel : `Frame ${index}`,
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
  assetLabel,
}: {
  previews: Map<number, AssetPreview>;
  activeFrame: number | null;
  /** The case's declared sprite sheet, when known; null for a single sprite or
   * when the host couldn't resolve the catalog. */
  sheet: AssetSheet | null;
  /** What the single-sprite slot is named after (the case name); unused for a
   * sheet. */
  assetLabel: string;
}) {
  // The user can pin the large view to a slot; until then it follows the frame
  // the model is drawing into.
  const [picked, setPicked] = useState<number | null>(null);

  // Nothing to show for a non-asset run that has streamed no previews.
  if (!sheet && previews.size === 0) return null;

  const slots = buildSlots(sheet, previews, assetLabel);
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
