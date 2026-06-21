import { Panel } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  useGalleryData,
  type AssetFrameView,
  type AssetResultView,
} from "../../../data/galleryContext";
import type { AssetSheet } from "@test-cabinet/run-record";
import { SpriteSheetPlayer } from "./SpriteSheetPlayer";
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
 * signals. */
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

/** A sprite sheet: each named sequence animated from the regenerated frames,
 * then the per-frame divergence/operations breakdown. */
function SheetResult({
  asset,
  sheet,
}: {
  asset: AssetResultView;
  sheet: AssetSheet;
}) {
  const frameByIndex = new Map(asset.frames.map((f) => [f.index, f]));
  const urls = (indices: number[], pick: (f: AssetFrameView) => string | null) =>
    indices.map((i) => {
      const frame = frameByIndex.get(i);
      return frame ? pick(frame) : null;
    });

  return (
    <>
      <h3 className={styles.section}>Animated sequences</h3>
      <p className={styles.secondary}>
        Each named animation, played from the regenerated frames so the motion can
        be reviewed against the brief.
      </p>
      {sheet.sequences.map((sequence) => (
        <figure key={sequence.slug} style={{ margin: "0 0 20px" }}>
          <figcaption style={{ marginBottom: 8, fontWeight: 600 }}>
            {sequence.name}
            <span className={styles.secondary}>
              {" "}
              — {sequence.frames.length}{" "}
              {sequence.frames.length === 1 ? "frame" : "frames"} @ {sequence.fps}{" "}
              fps
            </span>
          </figcaption>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <SpriteSheetPlayer
              label="Regenerated"
              frameUrls={urls(sequence.frames, (f) => f.regeneratedUrl)}
              frameWidth={sheet.frameWidth}
              frameHeight={sheet.frameHeight}
              fps={sequence.fps}
            />
          </div>
        </figure>
      ))}

      <h3 className={styles.section}>Per-frame details</h3>
      <p className={styles.secondary}>
        Each frame is a separate file; the regenerated image is reviewed against
        the brief.
      </p>
      <table className={styles.checks}>
        <tbody>
          {asset.frames.map((frame) => {
            const drewOutsideTool =
              frame.cheatDivergence !== null && frame.cheatDivergence > 0.05;
            return (
              <tr key={frame.index}>
                <th scope="row" className={styles.checkName}>
                  Frame {frame.index}
                </th>
                <td className={styles.secondary}>
                  {frame.operationCount} ops
                  {frame.cheatDivergence === null
                    ? ""
                    : ` · divergence ${(frame.cheatDivergence * 100).toFixed(
                        1,
                      )}%${drewOutsideTool ? " (drew outside the tool)" : ""}`}
                  {frame.actionsUrl ? (
                    <>
                      {" · "}
                      <a href={frame.actionsUrl} target="_blank" rel="noreferrer">
                        log
                      </a>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/**
 * The asset-generation result, shown at the top of the Verdict tab for an
 * asset-generation run. A single sprite shows the regenerated image beside the
 * model's preview, plus the cheat-divergence signal; a sprite sheet animates each
 * named sequence from its per-frame regenerated images and lists each frame's
 * details. The regenerated asset is reviewed against the brief — there is no
 * target image or fidelity score.
 *
 * Renders nothing for a non-asset-generation run (its `validation.asset` is
 * absent), so it is safe to mount unconditionally.
 */
export function AssetResultSection({ run }: { run: RunRecord }) {
  const gallery = useGalleryData();
  const asset = gallery.assetResultFor(run);
  if (!asset) return null;

  return (
    <Panel>
      <h2 className={styles.section}>Generated asset</h2>
      {asset.sheet ? (
        <SheetResult asset={asset} sheet={asset.sheet} />
      ) : asset.frames[0] ? (
        <SpriteResult frame={asset.frames[0]} />
      ) : null}
      {asset.detail ? <p className={styles.secondary}>{asset.detail}</p> : null}
    </Panel>
  );
}
