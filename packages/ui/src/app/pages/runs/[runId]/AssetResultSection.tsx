import { Panel } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import { useGalleryData } from "../../../data/galleryContext";
import styles from "./RunDetailPages.module.scss";

// 64x64 sprites are tiny; scale them up with crisp (nearest-neighbor) sampling so
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

/**
 * The asset-generation result, shown at the top of the Verdict tab for an
 * asset-generation run: the regenerated image (the scored output) beside the
 * target it was scored against and the model's final on-disk preview, plus the
 * fidelity and cheat-divergence signals and a link to the recorded action log.
 *
 * Renders nothing for a non-asset-generation run (its `validation.asset` is
 * absent), so it is safe to mount unconditionally.
 */
export function AssetResultSection({ run }: { run: RunRecord }) {
  const gallery = useGalleryData();
  const asset = gallery.assetResultFor(run);
  if (!asset) return null;

  // A high divergence means the model put pixels on the canvas outside the
  // recorded operations — a sign it tried to bypass the drawing tool. It is an
  // informational flag, never a gate (only the regenerated image is scored).
  const drewOutsideTool =
    asset.cheatDivergence !== null && asset.cheatDivergence > 0.05;

  return (
    <Panel>
      <h2 className={styles.section}>Generated asset</h2>
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <Sprite url={asset.regeneratedUrl} label="Regenerated (scored)" />
        <Sprite url={asset.targetUrl} label="Target" />
        <Sprite url={asset.previewUrl} label="Model's preview" />
      </div>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 16px",
          marginTop: 16,
        }}
      >
        <dt>Fidelity to target</dt>
        <dd>{(asset.fidelity * 100).toFixed(1)}%</dd>

        <dt>Cheat divergence</dt>
        <dd>
          {asset.cheatDivergence === null ? (
            <span className={styles.secondary}>unmeasured</span>
          ) : (
            <span
              className={drewOutsideTool ? styles.notLoaded : styles.loaded}
            >
              {(asset.cheatDivergence * 100).toFixed(1)}%
              {drewOutsideTool
                ? " — drew outside the tool"
                : " — matches recorded actions"}
            </span>
          )}
        </dd>

        <dt>Operations recorded</dt>
        <dd>
          {asset.operationCount}
          {asset.actionsUrl ? (
            <>
              {" — "}
              <a href={asset.actionsUrl} target="_blank" rel="noreferrer">
                action log
              </a>
            </>
          ) : null}
        </dd>
      </dl>

      {asset.detail ? <p className={styles.secondary}>{asset.detail}</p> : null}
    </Panel>
  );
}
