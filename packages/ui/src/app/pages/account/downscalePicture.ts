// Client-side profile-picture preparation: decode the user's chosen image,
// center-crop it to a square, downscale to a small edge, and re-encode to a
// compact format. Doing this in the browser keeps the bytes the auth service
// stores (and later embeds in the public snapshot) small regardless of the
// original file — the upload endpoint still enforces its own size ceiling.

// The edge length of the stored square avatar, in pixels. Small enough to keep the
// encoded blob tiny; large enough to stay crisp at the sizes it renders (top bar,
// review attribution, profile preview).
const AVATAR_EDGE = 256;

// Decode a picked image file into something drawable. `createImageBitmap` handles
// the common raster formats and honors EXIF orientation; fall back to an
// `HTMLImageElement` for engines/formats it rejects.
async function decode(
  file: File,
): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Could not read that image file."));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Center-crop `file` to a square, downscale to a small edge, and encode to WebP
// (falling back to PNG where WebP encoding is unavailable). Rejects when the file
// is not a decodable image.
export async function downscaleToSquare(file: File): Promise<Blob> {
  const source = await decode(file);
  const size = AVATAR_EDGE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image resizing is not supported in this browser.");

  // Center-crop the largest square that fits the source, then scale it to fill.
  const edge = Math.min(source.width, source.height);
  const sx = (source.width - edge) / 2;
  const sy = (source.height - edge) / 2;
  ctx.drawImage(source, sx, sy, edge, edge, 0, 0, size, size);
  if ("close" in source && typeof source.close === "function") source.close();

  const encode = (type: string): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));

  const webp = await encode("image/webp");
  // Some encoders return a PNG blob when asked for WebP; only accept a real WebP,
  // otherwise fall back to an explicit PNG so the content type is honest.
  if (webp && webp.type === "image/webp") return webp;
  const png = await encode("image/png");
  if (png) return png;
  throw new Error("Could not process that image.");
}
