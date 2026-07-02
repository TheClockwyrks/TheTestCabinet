// gifenc ships no TypeScript types (and there is no @types/gifenc), so declare
// the subset of its API we use: the streaming encoder plus the quantize /
// applyPalette helpers that turn a frame's RGBA pixels into an indexed image and
// its color table.
declare module "gifenc" {
  /** A color table: one [r,g,b] or [r,g,b,a] entry per color, channels 0–255. */
  export type Palette = number[][];

  /** Pixel packing quantize/applyPalette operate in; "rgba4444" keeps alpha. */
  export type GifFormat = "rgb565" | "rgb444" | "rgba4444";

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: GifFormat;
      /** Collapse alpha to fully-opaque/fully-transparent (adds a clear color). */
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
    },
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: GifFormat,
  ): Uint8Array;

  export interface WriteFrameOpts {
    palette?: Palette;
    /** Frame hold time in milliseconds (gifenc rounds it to GIF centiseconds). */
    delay?: number;
    /** Loop count, written on the first frame: -1 once, 0 forever, >0 a count. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** GIF disposal method; 2 clears the frame before the next is drawn. */
    dispose?: number;
  }

  export interface GifEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOpts,
    ): void;
    finish(): void;
    /** The finished GIF bytes, copied out of the encoder's working buffer. */
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoder;
}
