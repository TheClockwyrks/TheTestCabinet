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
 * Plays one named animation sequence out of a sprite sheet: it loads the sheet
 * image once, slices the frame cells the sequence names, and cycles them on a
 * `requestAnimationFrame` loop at the sequence's fps. Used on an asset-generation
 * run's Verdict tab to animate the regenerated and target sheets side by side so a
 * reviewer can judge the motion, not just the static pixels.
 *
 * Renders a "not available" placeholder when the host cannot serve the sheet.
 */
export function SpriteSheetPlayer({
  url,
  label,
  frameWidth,
  frameHeight,
  columns,
  frames,
  fps,
}: {
  url: string | null;
  label: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  frames: number[];
  fps: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Scale the small frame up to a crisp display box (integer factor so pixels
  // stay square), at least 1:1.
  const scale = Math.max(1, Math.floor(DISPLAY / Math.max(frameWidth, frameHeight)));
  const width = frameWidth * scale;
  const height = frameHeight * scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const image = new Image();
    let raf = 0;
    let index = 0;
    let last = 0;
    const interval = 1000 / Math.max(fps, 0.001);

    const drawFrame = () => {
      const frame = frames[index] ?? 0;
      const sx = (frame % columns) * frameWidth;
      const sy = Math.floor(frame / columns) * frameHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        image,
        sx,
        sy,
        frameWidth,
        frameHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    };

    const tick = (now: number) => {
      if (!last) last = now;
      // Hold each frame for its full interval; a single-frame sequence is a still.
      if (frames.length > 1 && now - last >= interval) {
        last = now;
        index = (index + 1) % frames.length;
        drawFrame();
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      drawFrame();
      raf = requestAnimationFrame(tick);
    };
    if (image.complete && image.naturalWidth > 0) {
      image.src = url;
      start();
    } else {
      image.onload = start;
      image.src = url;
    }

    return () => {
      cancelAnimationFrame(raf);
      image.onload = null;
    };
  }, [url, frameWidth, frameHeight, columns, frames, fps]);

  return (
    <figure style={{ margin: 0, textAlign: "center" }}>
      {url ? (
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
