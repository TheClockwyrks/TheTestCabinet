import { GIFEncoder, quantize, applyPalette } from "gifenc";

// Sprites are tiny; scale the exported frame up so a downloaded loop is legible
// rather than a 16-px speck — the same intent as the on-screen player, which
// upscales for display. Integer factor only, so pixels stay square and crisp.
const TARGET_LONGEST_SIDE = 256;

export type SpriteGifInput = {
  /** Per-frame image URLs in playback order; a null entry renders transparent. */
  frameUrls: (string | null)[];
  frameWidth: number;
  frameHeight: number;
  /** Playback rate; every frame is held for 1/fps seconds (uniform, per sheet). */
  fps: number;
};

/** The integer upscale factor for an exported frame (≥1, nearest-neighbor). */
export function spriteGifScale(
  frameWidth: number,
  frameHeight: number,
): number {
  const longest = Math.max(frameWidth, frameHeight, 1);
  return Math.max(1, Math.floor(TARGET_LONGEST_SIDE / longest));
}

/**
 * Encode one sprite-sheet sequence into an animated GIF blob, reusing the exact
 * frames the on-screen `SpriteSheetPlayer` draws. Each per-frame PNG is loaded,
 * drawn nearest-neighbor onto an offscreen canvas scaled up by an integer
 * factor, quantized (preserving the sprite's transparent background as 1-bit
 * alpha), and written as one GIF frame held for the sequence's per-frame
 * interval. The GIF loops forever.
 *
 * The frame PNGs are served with permissive CORS, so fetching them and reading
 * the drawn pixels back off the canvas does not taint it. A frame that fails to
 * load renders transparent (as the player draws it blank) rather than aborting
 * the export; only an all-frames-failed sequence throws, since there is then
 * nothing to encode. Also throws if the browser has no 2D canvas.
 */
export async function encodeSpriteGif({
  frameUrls,
  frameWidth,
  frameHeight,
  fps,
}: SpriteGifInput): Promise<Blob> {
  const scale = spriteGifScale(frameWidth, frameHeight);
  const width = Math.max(1, Math.round(frameWidth * scale));
  const height = Math.max(1, Math.round(frameHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  ctx.imageSmoothingEnabled = false;

  const bitmaps = await Promise.all(
    frameUrls.map((url) => (url ? loadBitmap(url).catch(() => null) : null)),
  );
  if (bitmaps.every((bitmap) => bitmap === null)) {
    throw new Error("No animation frames could be loaded");
  }

  const delay = Math.round(1000 / Math.max(fps, 0.001));
  const gif = GIFEncoder();

  for (const bitmap of bitmaps) {
    ctx.clearRect(0, 0, width, height);
    if (bitmap) ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    // rgba4444 + oneBitAlpha keeps the sprite's transparent background out of
    // the GIF; the palette then carries a fully-transparent entry we flag as the
    // frame's transparent index. dispose:2 clears each frame before the next so
    // transparent areas don't ghost the previous frame's pixels.
    const palette = quantize(data, 256, {
      format: "rgba4444",
      oneBitAlpha: true,
    });
    const index = applyPalette(data, palette, "rgba4444");
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
      dispose: 2,
    });
  }

  gif.finish();
  // Copy out of the encoder's working buffer into a standalone, ArrayBuffer-backed
  // array for the blob (also detaches the result from the reused encoder buffer).
  const encoded = gif.bytes();
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return new Blob([bytes], { type: "image/gif" });
}

/**
 * Load an image URL as an `ImageBitmap`, fetching it with CORS so the decoded
 * pixels can be read back off a canvas. Rejects if the fetch or decode fails.
 */
async function loadBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Failed to fetch frame (${response.status})`);
  }
  return createImageBitmap(await response.blob());
}
