// What a pixel reading is, and how a rectangle of them crosses out of the page.
//
// Split out of the harness because both halves of the package read them: the
// harness produces them, and the colour readings consume them.

/** A device pixel, as `[r, g, b, a]`. */
export type Pixel = [number, number, number, number];

/**
 * A rectangle of pixels, read back as RGBA rows.
 *
 * `data` is four bytes per pixel, row-major, so the pixel at `(x, y)` starts at
 * `(y * width + x) * 4`.
 *
 * IT TRAVELS AS BYTES RATHER THAN AS NUMBERS. A whole field is 960 x 540 x 4 —
 * two million entries, which as a JSON array costs about five seconds to cross
 * out of the page and lands as sixteen megabytes of boxed numbers. Encoded as
 * base64 and decoded here it costs under two tenths of a second and two
 * megabytes, and the reading is identical, so a point that compares two whole
 * frames is affordable.
 */
export interface PixelRect {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

/** A pixel rectangle as it crosses out of the page. */
export interface EncodedRect {
  width: number;
  height: number;
  /** The RGBA bytes, base64. */
  b64: string;
}

/** An encoded rectangle as a {@link PixelRect}. */
export function decodeRect(encoded: EncodedRect): PixelRect {
  return {
    width: encoded.width,
    height: encoded.height,
    data: new Uint8ClampedArray(Buffer.from(encoded.b64, "base64")),
  };
}
