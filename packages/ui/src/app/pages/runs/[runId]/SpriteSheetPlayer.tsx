import { useEffect, useRef } from "react";
import styles from "./RunDetailPages.module.scss";

// The animated frame is scaled up to fill roughly this box, with crisp
// (nearest-neighbor) sampling so individual pixels stay sharp — the same intent
// as the static sprite panes, but driven on a <canvas> so a named sequence plays.
const DISPLAY = 128;

const BOX: React.CSSProperties = {
  imageRendering: "pixelated",
  background:
    "repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px",
  border: "1px solid var(--tc-border, #444)",
  borderRadius: 4,
};

/**
 * Plays one named animation sequence of a sprite sheet. Each frame is now its own
 * separate image (the sheet is no longer one sliced image), so the player takes
 * the ordered list of per-frame image URLs the sequence names, preloads them, and
 * cycles them on a `requestAnimationFrame` loop at the sequence's fps. Used on an
 * asset-generation run's Verdict tab to animate the regenerated and target frames
 * side by side so a reviewer can judge the motion, not just the static pixels.
 *
 * Renders a "not available" placeholder when the host can serve no frame image.
 */
export function SpriteSheetPlayer({
  label,
  frameUrls,
  frameWidth,
  frameHeight,
  fps,
}: {
  label: string;
  /** The per-frame image URLs in sequence order; an entry is null if unservable. */
  frameUrls: (string | null)[];
  frameWidth: number;
  frameHeight: number;
  fps: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Scale the small frame up to a crisp display box (integer factor so pixels
  // stay square), at least 1:1.
  const scale = Math.max(1, Math.floor(DISPLAY / Math.max(frameWidth, frameHeight)));
  const width = frameWidth * scale;
  const height = frameHeight * scale;

  // A stable dependency for the effect: the ordered URLs as one string.
  const urlsKey = frameUrls.join("|");
  const hasAny = frameUrls.some(Boolean);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasAny) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    // Preload one Image per frame (null for an unservable frame, drawn as blank).
    const images = frameUrls.map((url) => {
      if (!url) return null;
      const image = new Image();
      image.src = url;
      return image;
    });

    let raf = 0;
    let index = 0;
    let last = 0;
    const interval = 1000 / Math.max(fps, 0.001);

    const drawFrame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const image = images[index];
      if (image && image.complete && image.naturalWidth > 0) {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
    };

    const tick = (now: number) => {
      if (!last) last = now;
      // Hold each frame for its full interval; a single-frame sequence is a still.
      if (frameUrls.length > 1 && now - last >= interval) {
        last = now;
        index = (index + 1) % frameUrls.length;
      }
      drawFrame();
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [urlsKey, hasAny, frameUrls, frameWidth, frameHeight, fps]);

  return (
    <figure style={{ margin: 0, textAlign: "center" }}>
      {hasAny ? (
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ ...BOX, width, height }}
          aria-label={label}
        />
      ) : (
        <div
          style={{ ...BOX, width: DISPLAY, height: DISPLAY, display: "grid", placeItems: "center" }}
          aria-label={`${label} unavailable`}
        >
          <span className={styles.secondary}>not available</span>
        </div>
      )}
      <figcaption style={{ marginTop: 6 }}>{label}</figcaption>
    </figure>
  );
}
