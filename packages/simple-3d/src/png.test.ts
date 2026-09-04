import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng } from "./png";

/**
 * The PNG decoder against fixtures constructed byte by byte in this file, so
 * every expectation is hand-derivable from the PNG specification rather than
 * from a binary checked in blind. Compressed fixtures deflate through
 * `node:zlib` — the reference encoder, exercising the decoder's fixed and
 * dynamic Huffman paths on real streams — and one fixture hand-builds a
 * stored-block zlib stream to pin the third block type without an encoder in
 * the loop. Chunk CRCs are written as zeros throughout: the decoder
 * deliberately does not verify them (see the module header), and zeroed CRCs
 * are what prove it.
 */

/** One chunk: big-endian length, ASCII type, data, and a zeroed CRC. */
function chunk(type: string, data: Uint8Array | readonly number[]): Uint8Array {
  const body = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

/** An IHDR chunk: size, depth 8 unless overridden, the given color type. */
function ihdr(
  width: number,
  height: number,
  colorType: number,
  options?: { bitDepth?: number; interlace?: number },
): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = options?.bitDepth ?? 8;
  data[9] = colorType;
  data[10] = 0; // compression: deflate
  data[11] = 0; // filter method 0
  data[12] = options?.interlace ?? 0;
  return chunk("IHDR", data);
}

/** Signature plus the given chunks. */
function png(...chunks: readonly Uint8Array[]): Uint8Array {
  const signature = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const total = chunks.reduce((sum, c) => sum + c.length, signature.length);
  const out = new Uint8Array(total);
  out.set(signature, 0);
  let at = signature.length;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Filtered scanlines (each row prefixed by its filter byte), deflated by node:zlib. */
function idat(rows: readonly (readonly number[])[]): Uint8Array {
  const raw = Uint8Array.from(rows.flat());
  return chunk("IDAT", new Uint8Array(deflateSync(raw)));
}

describe("color types", () => {
  it("decodes an 8-bit RGBA image to its own bytes", () => {
    const bytes = png(
      ihdr(2, 2, 6),
      idat([
        [0, 255, 0, 0, 255, 0, 255, 0, 128],
        [0, 0, 0, 255, 64, 10, 20, 30, 40],
      ]),
      chunk("IEND", []),
    );
    const image = decodePng(bytes);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(Array.from(image.pixels)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64, 10, 20, 30, 40,
    ]);
  });

  it("decodes RGB with an opaque alpha filled in", () => {
    const bytes = png(
      ihdr(2, 1, 2),
      idat([[0, 1, 2, 3, 250, 251, 252]]),
      chunk("IEND", []),
    );
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      1, 2, 3, 255, 250, 251, 252, 255,
    ]);
  });

  it("decodes grayscale by spreading the gray across the color channels", () => {
    const bytes = png(
      ihdr(3, 1, 0),
      idat([[0, 0, 128, 255]]),
      chunk("IEND", []),
    );
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ]);
  });

  it("decodes grayscale+alpha, keeping the alpha", () => {
    const bytes = png(
      ihdr(2, 1, 4),
      idat([[0, 100, 200, 50, 0]]),
      chunk("IEND", []),
    );
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      100, 100, 100, 200, 50, 50, 50, 0,
    ]);
  });

  it("decodes a palette image through PLTE, honoring a tRNS alpha", () => {
    const bytes = png(
      ihdr(3, 1, 3),
      chunk("PLTE", [255, 0, 0, 0, 255, 0, 0, 0, 255]),
      // tRNS covers the first two entries; the third defaults to opaque.
      chunk("tRNS", [255, 128]),
      idat([[0, 0, 1, 2]]),
      chunk("IEND", []),
    );
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255,
    ]);
  });
});

describe("scanline filters", () => {
  it("reverses Sub (1): each byte adds the byte one pixel left", () => {
    const bytes = png(
      ihdr(2, 1, 2),
      idat([[1, 10, 20, 30, 5, 6, 7]]),
      chunk("IEND", []),
    );
    // Pixel 0 has no left neighbor; pixel 1 reconstructs to (10+5, 20+6, 30+7).
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      10, 20, 30, 255, 15, 26, 37, 255,
    ]);
  });

  it("reverses Up (2): each byte adds the byte one row up", () => {
    const bytes = png(
      ihdr(2, 2, 2),
      idat([
        [0, 1, 2, 3, 4, 5, 6],
        [2, 10, 10, 10, 10, 10, 10],
      ]),
      chunk("IEND", []),
    );
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255, 11, 12, 13, 255, 14, 15, 16, 255,
    ]);
  });

  it("reverses Average (3): each byte adds the floor of the left/up mean", () => {
    const bytes = png(
      ihdr(2, 2, 2),
      idat([
        [0, 10, 20, 30, 40, 50, 60],
        [3, 4, 4, 4, 4, 4, 4],
      ]),
      chunk("IEND", []),
    );
    // Row 1 pixel 0: left 0, up (10,20,30) -> 4+(5,10,15) = (9,14,19).
    // Row 1 pixel 1: left (9,14,19), up (40,50,60) -> 4+(24,32,39) = (28,36,43).
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255, 9, 14, 19, 255, 28, 36, 43, 255,
    ]);
  });

  it("reverses Paeth (4) with the specification's predictor", () => {
    const bytes = png(
      ihdr(2, 2, 2),
      idat([
        [0, 10, 20, 30, 40, 50, 60],
        [4, 1, 1, 1, 1, 1, 1],
      ]),
      chunk("IEND", []),
    );
    // Row 1 pixel 0 predicts up (no left/corner); pixel 1's p = a+b-c also
    // lands nearest b for every channel here, so the row is up+1 throughout.
    expect(Array.from(decodePng(bytes).pixels)).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255, 11, 21, 31, 255, 41, 51, 61, 255,
    ]);
  });
});

describe("the deflate stream", () => {
  it("decodes a hand-built stored-block zlib stream, no encoder in the loop", () => {
    // 0x78 0x01 is a valid zlib header; 0x01 opens a final stored block; then
    // LEN/NLEN little-endian; then the raw bytes; then four Adler bytes the
    // decoder deliberately ignores.
    const raw = [0, 128]; // filter 0, one gray pixel of 128
    const stream = [0x78, 0x01, 0x01, 2, 0, 0xfd, 0xff, ...raw, 0, 0, 0, 0];
    const bytes = png(ihdr(1, 1, 0), chunk("IDAT", stream), chunk("IEND", []));
    expect(Array.from(decodePng(bytes).pixels)).toEqual([128, 128, 128, 255]);
  });

  it("concatenates split IDAT chunks into one stream, as the format requires", () => {
    const whole = new Uint8Array(deflateSync(Uint8Array.from([0, 7, 8, 9])));
    const bytes = png(
      ihdr(1, 1, 2),
      chunk("IDAT", whole.subarray(0, 3)),
      chunk("IDAT", whole.subarray(3)),
      chunk("IEND", []),
    );
    expect(Array.from(decodePng(bytes).pixels)).toEqual([7, 8, 9, 255]);
  });

  it("refuses a truncated stream rather than inventing pixels", () => {
    const whole = new Uint8Array(deflateSync(Uint8Array.from([0, 7, 8, 9])));
    const bytes = png(
      ihdr(1, 1, 2),
      chunk("IDAT", whole.subarray(0, whole.length - 6)),
      chunk("IEND", []),
    );
    expect(() => decodePng(bytes)).toThrow(Error);
    expect(() => decodePng(bytes)).toThrow(/truncated|corrupt/);
  });
});

describe("refusals", () => {
  it("refuses bytes that are not a PNG, by the missing signature", () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3, 4]))).toThrow(
      /PNG signature/,
    );
  });

  it("refuses a 16-bit image by name, with the fix", () => {
    const bytes = png(
      ihdr(1, 1, 2, { bitDepth: 16 }),
      idat([[0, 0, 0, 0, 0, 0, 0]]),
      chunk("IEND", []),
    );
    expect(() => decodePng(bytes)).toThrow(/bit depth 16.*8 bits per channel/);
  });

  it("refuses an interlaced image by name", () => {
    const bytes = png(
      ihdr(2, 2, 6, { interlace: 1 }),
      idat([[0, 0, 0, 0, 0]]),
      chunk("IEND", []),
    );
    expect(() => decodePng(bytes)).toThrow(/interlaced \(Adam7\)/);
  });

  it("refuses an unknown color type, naming the supported ones", () => {
    const bytes = png(ihdr(1, 1, 5), idat([[0, 0]]), chunk("IEND", []));
    expect(() => decodePng(bytes)).toThrow(/color type 5.*rgba \(6\)/);
  });

  it("refuses a palette image that carries no palette", () => {
    const bytes = png(ihdr(1, 1, 3), idat([[0, 0]]), chunk("IEND", []));
    expect(() => decodePng(bytes)).toThrow(/no PLTE chunk/);
  });

  it("refuses a file with no pixel data", () => {
    const bytes = png(ihdr(1, 1, 6), chunk("IEND", []));
    expect(() => decodePng(bytes)).toThrow(/no IDAT chunk/);
  });
});
