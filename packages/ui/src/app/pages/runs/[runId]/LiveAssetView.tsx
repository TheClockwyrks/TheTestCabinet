import { Panel } from "@test-cabinet/ui";
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
  width: 72,
  height: 72,
  imageRendering: "pixelated",
  background: CHECKER,
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
};

// A base64 PNG (no prefix) as a renderable data URL.
const dataUrl = (image: string) => `data:image/png;base64,${image}`;

/**
 * The live drawing view for an in-progress asset-generation run. As the model
 * issues drawing operations, each re-rendered frame is streamed here (out of band
 * from the event feed); this shows the current canvas updating in real time.
 *
 * A single sprite is always frame 0, so it just shows that one canvas. A sprite
 * sheet shows the most-recently-modified frame large, plus a grid of every frame
 * seen so far with its operation count — the "status of all sprites" — with the
 * active frame highlighted. Frames the model has not drawn into yet appear once
 * their first operation arrives.
 *
 * Renders nothing until the first frame arrives, so it is safe to mount for any
 * run: only an observed asset-generation run ever streams previews.
 */
export function LiveAssetView({
  previews,
  activeFrame,
}: {
  previews: Map<number, AssetPreview>;
  activeFrame: number | null;
}) {
  if (previews.size === 0) return null;

  const frames = [...previews.values()].sort((a, b) => a.frame - b.frame);
  // Show the frame last drawn into; fall back to the highest-indexed one before
  // any frame has been singled out as active.
  const current =
    (activeFrame !== null ? previews.get(activeFrame) : undefined) ??
    frames[frames.length - 1];
  // `previews` is non-empty (guarded above), so `current` is always set; this
  // narrows it for the type checker.
  if (!current) return null;
  // A sprite sheet draws into more than just frame 0; a single sprite never does.
  const isSheet = frames.length > 1 || frames.some((f) => f.frame !== 0);

  return (
    <Panel>
      <h2 className={styles.section}>Live drawing</h2>
      <p className={styles.secondary}>
        The model's current canvas, re-rendered after each drawing operation. The
        recorded action log is the run's authoritative output; this preview is just
        a live look at it.
      </p>

      <figure style={{ margin: 0, textAlign: "center" }}>
        <img
          src={dataUrl(current.image)}
          alt={isSheet ? `Frame ${current.frame}` : "Current sprite"}
          style={SPRITE_LARGE}
        />
        <figcaption style={{ marginTop: 6 }}>
          {isSheet ? `Frame ${current.frame} · ` : ""}
          {current.operationCount}{" "}
          {current.operationCount === 1 ? "operation" : "operations"}
          {current.operation ? ` · ${current.operation}` : ""}
        </figcaption>
      </figure>

      {isSheet && (
        <>
          <h3 className={styles.section}>All frames</h3>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              justifyContent: "center",
            }}
          >
            {frames.map((frame) => {
              const isActive = frame.frame === current.frame;
              return (
                <figure
                  key={frame.frame}
                  style={{ margin: 0, textAlign: "center" }}
                >
                  <img
                    src={dataUrl(frame.image)}
                    alt={`Frame ${frame.frame}`}
                    style={{
                      ...SPRITE_THUMB,
                      outline: isActive
                        ? "2px solid var(--tc-accent, #c46bff)"
                        : "none",
                    }}
                  />
                  <figcaption className={styles.secondary} style={{ marginTop: 4 }}>
                    #{frame.frame} · {frame.operationCount} ops
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
