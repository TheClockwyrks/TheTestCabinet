import { useState } from "react";
import { Panel } from "@test-cabinet/ui";
import type { AssetSheet, RunRecord } from "@test-cabinet/run-record";
import {
  useGalleryData,
  type AssetFrameView,
  type AssetResultView,
} from "../../../data/galleryContext";
import { SpriteSheetPlayer } from "./SpriteSheetPlayer";
import { VoxelResultSection } from "./VoxelResultSection";
import styles from "./RunDetailPages.module.scss";

// Small sprites are tiny; scale them up with crisp (nearest-neighbor) sampling so
// individual pixels stay sharp rather than blurring.
const SPRITE: React.CSSProperties = {
  width: 160,
  height: 160,
  imageRendering: "pixelated",
  background:
    "repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
};

function Sprite({ url, label }: { url: string | null; label: string }) {
  return (
    <figure style={{ margin: 0, textAlign: "center" }}>
      {url ? (
        <img src={url} alt={label} style={SPRITE} />
      ) : (
        <div
          style={{ ...SPRITE, display: "grid", placeItems: "center" }}
          aria-label={`${label} unavailable`}
        >
          <span className={styles.secondary}>not available</span>
        </div>
      )}
      <figcaption style={{ marginTop: 6 }}>{label}</figcaption>
    </figure>
  );
}

/** The divergence / operations readout for one frame. */
function FrameSignals({ frame }: { frame: AssetFrameView }) {
  const drewOutsideTool =
    frame.cheatDivergence !== null && frame.cheatDivergence > 0.05;
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
        {frame.cheatDivergence === null ? (
          <span className={styles.secondary}>unmeasured</span>
        ) : (
          <span className={drewOutsideTool ? styles.notLoaded : styles.loaded}>
            {(frame.cheatDivergence * 100).toFixed(1)}%
            {drewOutsideTool
              ? " — drew outside the tool"
              : " — matches recorded actions"}
          </span>
        )}
      </dd>

      <dt>Operations recorded</dt>
      <dd>
        {frame.operationCount}
        {frame.actionsUrl ? (
          <>
            {" — "}
            <a href={frame.actionsUrl} target="_blank" rel="noreferrer">
              action log
            </a>
          </>
        ) : null}
      </dd>
    </dl>
  );
}

/** A single sprite: the regenerated image beside the model's preview, plus its
 * signals. (The two are genuinely different — the regenerated image is rebuilt
 * from the recorded actions, the preview is the model's own on-disk pixels — so
 * each keeps its label.) */
function SpriteResult({ frame }: { frame: AssetFrameView }) {
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
        <Sprite url={frame.regeneratedUrl} label="Regenerated" />
        <Sprite url={frame.previewUrl} label="Model's preview" />
      </div>
      <FrameSignals frame={frame} />
    </>
  );
}

/**
 * One named sequence, laid out as a row: a left column with the sequence name and
 * its frame count + fps, and the animation playing to its right. The row layout
 * keeps each animation compact so a sheet's sequences stack densely instead of
 * each consuming a full-width block. The animation plays the regenerated frames;
 * there is only one asset to show, so it carries no redundant "Regenerated" label.
 */
export function SequenceRow({
  sheet,
  sequence,
  frames,
}: {
  sheet: AssetSheet;
  sequence: AssetSheet["sequences"][number];
  frames: AssetFrameView[];
}) {
  const frameByIndex = new Map(frames.map((f) => [f.index, f]));
  const frameUrls = sequence.frames.map(
    (i) => frameByIndex.get(i)?.regeneratedUrl ?? null,
  );
  return (
    <div className={styles.sequenceRow}>
      <div className={styles.sequenceMeta}>
        <span className={styles.sequenceName}>{sequence.name}</span>
        <span className={styles.sequenceSub}>
          {sequence.frames.length}{" "}
          {sequence.frames.length === 1 ? "frame" : "frames"} @ {sequence.fps}{" "}
          fps
        </span>
      </div>
      <div className={styles.sequencePlayer}>
        <SpriteSheetPlayer
          label={sequence.name}
          frameUrls={frameUrls}
          frameWidth={sheet.frameWidth}
          frameHeight={sheet.frameHeight}
          fps={sequence.fps}
        />
      </div>
    </div>
  );
}

// A small, crisp thumbnail of one regenerated frame, shown in the per-frame grid
// so each frame's details sit beside the actual image they describe.
const THUMB: React.CSSProperties = {
  width: 56,
  height: 56,
  imageRendering: "pixelated",
  background:
    "repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 10px 10px",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
  display: "block",
};

/**
 * The per-frame breakdown as a grid: each row pairs the frame number and the
 * actual regenerated image with that frame's recorded signals (operation count,
 * cheat divergence, action log). Showing the image inline is the point — the old
 * table reported the numbers but never showed which frame they belonged to.
 */
export function FrameGrid({ frames }: { frames: AssetFrameView[] }) {
  return (
    <table className={`${styles.checks} ${styles.frameGrid}`}>
      <thead>
        <tr>
          <th scope="col">Frame</th>
          <th scope="col">Image</th>
          <th scope="col">Ops</th>
          <th scope="col">Divergence</th>
          {/* The log column holds only the "log" link, so it needs no header. */}
          <th scope="col" aria-label="Action log" />
        </tr>
      </thead>
      <tbody>
        {frames.map((frame) => {
          const drewOutsideTool =
            frame.cheatDivergence !== null && frame.cheatDivergence > 0.05;
          return (
            <tr key={frame.index}>
              <th scope="row" className={styles.checkName}>
                {frame.index}
              </th>
              <td className={styles.frameThumbCell}>
                {frame.regeneratedUrl ? (
                  <img
                    src={frame.regeneratedUrl}
                    alt={`Frame ${frame.index}`}
                    style={THUMB}
                  />
                ) : (
                  <div
                    style={{ ...THUMB, display: "grid", placeItems: "center" }}
                    aria-label={`Frame ${frame.index} unavailable`}
                  >
                    <span className={styles.secondary}>n/a</span>
                  </div>
                )}
              </td>
              <td className={styles.secondary}>{frame.operationCount}</td>
              <td>
                {frame.cheatDivergence === null ? (
                  <span className={styles.secondary}>unmeasured</span>
                ) : (
                  <span
                    className={drewOutsideTool ? styles.notLoaded : styles.loaded}
                    title={
                      drewOutsideTool
                        ? "drew outside the tool"
                        : "matches recorded actions"
                    }
                  >
                    {(frame.cheatDivergence * 100).toFixed(1)}%
                    {drewOutsideTool ? " — outside tool" : ""}
                  </span>
                )}
              </td>
              <td className={styles.frameLogCell}>
                {frame.actionsUrl ? (
                  <a href={frame.actionsUrl} target="_blank" rel="noreferrer">
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

// The two ways to inspect a referenced subset of a sheet: the animations playing,
// or the still frames with their signals.
type AssetView = "animation" | "frames";

function ViewToggle({
  view,
  onChange,
}: {
  view: AssetView;
  onChange: (view: AssetView) => void;
}) {
  return (
    <div className={styles.viewToggle} role="group" aria-label="Asset view">
      {(["animation", "frames"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.viewToggleButton}${
            view === option ? ` ${styles.viewToggleActive}` : ""
          }`}
          aria-pressed={view === option}
          onClick={() => onChange(option)}
        >
          {option === "animation" ? "Animation" : "Frames"}
        </button>
      ))}
    </div>
  );
}

/**
 * The asset(s) a single review item is about, resolved from the run's sprite sheet
 * so a reviewer sees exactly the relevant animations/frames beside the item — no
 * scrolling to the generated-asset section to find them. The item names sequence
 * slugs and/or explicit frame indices; the animation view plays the named
 * sequences and the frames view shows every referenced frame (the explicit ones
 * plus those the named sequences cover). A toggle switches between them so a
 * reviewer can check specific frames without the animation playing over them.
 * Renders nothing when the run is not a sprite sheet or the item references
 * nothing servable.
 */
export function ReviewItemAssets({
  asset,
  sequences,
  frames,
}: {
  asset: AssetResultView;
  /** Referenced sequence slugs (the animations to play). */
  sequences: string[];
  /** Referenced explicit frame indices. */
  frames: number[];
}) {
  const sheet = asset.sheet;
  const animSequences =
    sheet?.sequences.filter((s) => sequences.includes(s.slug)) ?? [];
  // Every referenced frame, in the sheet's declared order: the explicit indices
  // plus those the named sequences cover.
  const referenced = new Set<number>([
    ...frames,
    ...animSequences.flatMap((s) => s.frames),
  ]);
  const gridFrames = asset.frames.filter((f) => referenced.has(f.index));
  const canAnimate = animSequences.length > 0;

  const [view, setView] = useState<AssetView>(
    canAnimate ? "animation" : "frames",
  );

  if (!sheet || (!canAnimate && gridFrames.length === 0)) return null;
  const showing: AssetView = canAnimate ? view : "frames";

  return (
    <div className={styles.itemAssets}>
      {canAnimate && <ViewToggle view={showing} onChange={setView} />}
      {showing === "animation" ? (
        <div className={styles.sequenceList}>
          {animSequences.map((sequence) => (
            <SequenceRow
              key={sequence.slug}
              sheet={sheet}
              sequence={sequence}
              frames={asset.frames}
            />
          ))}
        </div>
      ) : (
        <FrameGrid frames={gridFrames} />
      )}
    </div>
  );
}

/** A sprite sheet: each named sequence animated in a compact row, then the
 * per-frame grid pairing each frame's image with its signals. */
function SheetResult({
  asset,
  sheet,
}: {
  asset: AssetResultView;
  sheet: AssetSheet;
}) {
  return (
    <>
      <h3 className={`${styles.section} ${styles.leadHeading}`}>
        Animated sequences
      </h3>
      <p className={styles.secondary}>
        Each named animation, played from the regenerated frames so the motion can
        be reviewed against the brief.
      </p>
      <div className={styles.sequenceGrid}>
        {sheet.sequences.map((sequence) => (
          <SequenceRow
            key={sequence.slug}
            sheet={sheet}
            sequence={sequence}
            frames={asset.frames}
          />
        ))}
      </div>

      <h3 className={styles.section}>Per-frame details</h3>
      <p className={styles.secondary}>
        Each frame is a separate file; the regenerated image is reviewed against
        the brief.
      </p>
      <FrameGrid frames={asset.frames} />
    </>
  );
}

/**
 * The asset-generation result, shown at the top of the Verdict tab for an
 * asset-generation run. A single sprite shows the regenerated image beside the
 * model's preview, plus the cheat-divergence signal; a sprite sheet animates each
 * named sequence in a compact row from its per-frame regenerated images and lists
 * each frame's image and details. The regenerated asset is reviewed against the
 * brief — there is no target image or fidelity score.
 *
 * Renders nothing for a non-asset-generation run (its `validation.asset` is
 * absent), so it is safe to mount unconditionally.
 */
export function AssetResultSection({ run }: { run: RunRecord }) {
  const gallery = useGalleryData();
  // A 3D voxel run leads with the interactive voxel viewer; a 2D sprite/sheet run
  // with the pixel result. The two are mutually exclusive (a run carries either
  // `validation.voxel` or `validation.asset`), so voxel takes precedence here.
  const voxel = gallery.voxelResultFor(run);
  if (voxel) {
    return (
      <Panel>
        <h2 className={`${styles.section} ${styles.leadHeading}`}>
          Generated asset
        </h2>
        <VoxelResultSection view={voxel} />
        {voxel.detail ? (
          <p className={styles.secondary}>{voxel.detail}</p>
        ) : null}
      </Panel>
    );
  }

  const asset = gallery.assetResultFor(run);
  if (!asset) return null;

  return (
    <Panel>
      <h2 className={`${styles.section} ${styles.leadHeading}`}>
        Generated asset
      </h2>
      {asset.sheet ? (
        <SheetResult asset={asset} sheet={asset.sheet} />
      ) : asset.frames[0] ? (
        <SpriteResult frame={asset.frames[0]} />
      ) : null}
      {asset.detail ? <p className={styles.secondary}>{asset.detail}</p> : null}
    </Panel>
  );
}
