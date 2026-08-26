/**
 * A self-contained PNG decoder: bytes in, RGBA8 pixels out.
 *
 * This module is a deliberate, byte-identical COPY carried by both 3D engine
 * packages — `packages/simple-3d/src/png.ts` and
 * `packages/structured-3d/src/png.ts` are the same file, not an import of one
 * another. Each engine package is vendored into run repositories and has to
 * stay self-contained, so neither can depend on the other or on a shared
 * helper package; the two copies are held identical by the recording-parity
 * suites. Change one copy and you must change the other byte for byte.
 *
 * The decoder exists because the docs promise that "a texture is a PNG … and
 * the engine decodes both itself, so a load resolves identically in a browser
 * and in Node": no `Image`, no `ImageBitmap`, no native module — the decoded
 * bytes go straight to `texImage2D`'s `ArrayBufferView` overload, which is
 * the one overload a headless context implements. The subset is the one the
 * asset-generation tools produce and a recording re-embeds: 8-bit grayscale,
 * grayscale+alpha, RGB, palette (with optional `tRNS` alpha), and RGBA,
 * non-interlaced. Everything outside it is refused by name rather than
 * half-decoded, because a wrong texture presents as a build that draws the
 * wrong picture, which is the most expensive kind of failure to trace.
 *
 * Chunk CRCs are not verified. The bytes come from the run's own tree or from
 * a recording the engine itself embedded, so a corrupt stream fails loudly in
 * the inflate or in the scanline walk anyway, and verifying CRCs would buy a
 * second copy of that refusal at the cost of a table this module otherwise
 * does not need.
 */

/** A decoded image: `width * height * 4` bytes of RGBA, rows top to bottom. */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** RGBA8, non-premultiplied, `width * height * 4` bytes. */
  readonly pixels: Uint8Array;
}

/* -------------------------------------------------------------------------- */
/* Inflate (RFC 1950/1951)                                                    */
/* -------------------------------------------------------------------------- */

/** A window over a DEFLATE stream, reading bits LSB-first as the format requires. */
class BitReader {
  private at: number;
  private bit = 0;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
  ) {
    this.at = start;
  }

  /** The next single bit. */
  bit1(): number {
    if (this.at >= this.bytes.length) {
      throw new Error(
        "png: the deflate stream ended mid-block: the file is truncated",
      );
    }
    const value = ((this.bytes[this.at] ?? 0) >> this.bit) & 1;
    this.bit += 1;
    if (this.bit === 8) {
      this.bit = 0;
      this.at += 1;
    }
    return value;
  }

  /** The next `count` bits as an unsigned integer, LSB first. */
  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value |= this.bit1() << i;
    }
    return value;
  }

  /** Discards the rest of the current byte; stored blocks are byte-aligned. */
  align(): void {
    if (this.bit !== 0) {
      this.bit = 0;
      this.at += 1;
    }
  }

  /** The next whole byte, after {@link align}. */
  byte(): number {
    if (this.at >= this.bytes.length) {
      throw new Error(
        "png: the deflate stream ended mid-block: the file is truncated",
      );
    }
    const value = this.bytes[this.at] ?? 0;
    this.at += 1;
    return value;
  }
}

/**
 * A canonical Huffman code, in the counts-and-symbols form: `counts[n]` is
 * how many codes have length `n`, and `symbols` lists the symbols ordered by
 * code. Decoding walks the lengths bit by bit — slower than a lookup table
 * but a fraction of the code, and a texture decodes once per load.
 */
interface Huffman {
  readonly counts: Int32Array;
  readonly symbols: Int32Array;
}

/** Builds the canonical code for `lengths`, where `lengths[i]` codes symbol `i`. */
function buildHuffman(lengths: readonly number[]): Huffman {
  const counts = new Int32Array(16);
  for (const length of lengths) counts[length] = (counts[length] ?? 0) + 1;
  counts[0] = 0;

  const offsets = new Int32Array(16);
  for (let length = 1; length < 15; length += 1) {
    offsets[length + 1] = (offsets[length] ?? 0) + (counts[length] ?? 0);
  }

  const symbols = new Int32Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol] ?? 0;
    if (length !== 0) {
      symbols[offsets[length] ?? 0] = symbol;
      offsets[length] = (offsets[length] ?? 0) + 1;
    }
  }
  return { counts, symbols };
}

/** Reads one symbol coded by `huffman`. */
function decodeSymbol(reader: BitReader, huffman: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let length = 1; length <= 15; length += 1) {
    code |= reader.bit1();
    const count = huffman.counts[length] ?? 0;
    if (code - first < count)
      return huffman.symbols[index + (code - first)] ?? 0;
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error(
    "png: an invalid huffman code appeared in the deflate stream: the file is corrupt",
  );
}

/** Length codes 257–285: base lengths and extra bits, per RFC 1951 §3.2.5. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
] as const;
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
] as const;

/** Distance codes 0–29: base distances and extra bits, per RFC 1951 §3.2.5. */
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
] as const;
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
] as const;

/** The order code-length code lengths arrive in, per RFC 1951 §3.2.7. */
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
] as const;

/** The fixed literal/length code: 0–143 at 8 bits, 144–255 at 9, 256–279 at 7, 280–287 at 8. */
function fixedLiteralHuffman(): Huffman {
  const lengths: number[] = [];
  for (let symbol = 0; symbol < 288; symbol += 1) {
    lengths.push(symbol < 144 ? 8 : symbol < 256 ? 9 : symbol < 280 ? 7 : 8);
  }
  return buildHuffman(lengths);
}

/** The fixed distance code: 32 codes of 5 bits. */
function fixedDistanceHuffman(): Huffman {
  return buildHuffman(new Array<number>(30).fill(5));
}

/**
 * Inflates a zlib stream (2-byte header, DEFLATE body) into exactly
 * `expected` bytes. PNG states the inflated size through its own geometry —
 * `height * (1 + rowBytes)` — so producing more or fewer bytes is a corrupt
 * file, refused rather than padded. The trailing Adler-32 is not verified,
 * for the same reason chunk CRCs are not.
 */
function inflate(
  bytes: Uint8Array,
  start: number,
  expected: number,
): Uint8Array {
  if (bytes.length - start < 2) {
    throw new Error(
      "png: the compressed data ended before its zlib header: the file is truncated",
    );
  }
  const cmf = bytes[start] ?? 0;
  const flg = bytes[start + 1] ?? 0;
  if ((cmf & 0x0f) !== 8) {
    throw new Error(
      `png: zlib compression method ${cmf & 0x0f} is not deflate (8): the file is not a PNG a conforming encoder wrote`,
    );
  }
  if ((flg & 0x20) !== 0) {
    throw new Error(
      "png: a zlib preset dictionary is not supported: re-export the texture without one",
    );
  }

  const out = new Uint8Array(expected);
  let produced = 0;
  const reader = new BitReader(bytes, start + 2);

  const write = (value: number): void => {
    if (produced >= expected) {
      throw new Error(
        "png: the compressed data inflates past the image's own size: the file is corrupt",
      );
    }
    out[produced] = value;
    produced += 1;
  };

  let final = 0;
  do {
    final = reader.bit1();
    const type = reader.bits(2);

    if (type === 0) {
      // Stored: byte-aligned length, its complement, then raw bytes.
      reader.align();
      const len = reader.byte() | (reader.byte() << 8);
      const nlen = reader.byte() | (reader.byte() << 8);
      if ((len ^ 0xffff) !== nlen) {
        throw new Error(
          "png: a stored deflate block's length check failed: the file is corrupt",
        );
      }
      for (let i = 0; i < len; i += 1) write(reader.byte());
      continue;
    }

    let literal: Huffman;
    let distance: Huffman;
    if (type === 1) {
      literal = fixedLiteralHuffman();
      distance = fixedDistanceHuffman();
    } else if (type === 2) {
      // Dynamic: the two codes are themselves coded by a third.
      const hlit = reader.bits(5) + 257;
      const hdist = reader.bits(5) + 1;
      const hclen = reader.bits(4) + 4;

      const codeLengths = new Array<number>(19).fill(0);
      for (let i = 0; i < hclen; i += 1) {
        codeLengths[CODE_LENGTH_ORDER[i] ?? 0] = reader.bits(3);
      }
      const codeHuffman = buildHuffman(codeLengths);

      const lengths: number[] = [];
      while (lengths.length < hlit + hdist) {
        const symbol = decodeSymbol(reader, codeHuffman);
        if (symbol < 16) {
          lengths.push(symbol);
        } else if (symbol === 16) {
          const previous = lengths[lengths.length - 1];
          if (previous === undefined) {
            throw new Error(
              "png: a deflate code-length repeat had nothing to repeat: the file is corrupt",
            );
          }
          const repeat = 3 + reader.bits(2);
          for (let i = 0; i < repeat; i += 1) lengths.push(previous);
        } else if (symbol === 17) {
          const repeat = 3 + reader.bits(3);
          for (let i = 0; i < repeat; i += 1) lengths.push(0);
        } else {
          const repeat = 11 + reader.bits(7);
          for (let i = 0; i < repeat; i += 1) lengths.push(0);
        }
      }
      literal = buildHuffman(lengths.slice(0, hlit));
      distance = buildHuffman(lengths.slice(hlit));
    } else {
      throw new Error(
        "png: deflate block type 3 is reserved: the file is corrupt",
      );
    }

    for (;;) {
      const symbol = decodeSymbol(reader, literal);
      if (symbol < 256) {
        write(symbol);
      } else if (symbol === 256) {
        break;
      } else {
        const lengthIndex = symbol - 257;
        if (lengthIndex >= LENGTH_BASE.length) {
          throw new Error(
            "png: an invalid deflate length code appeared: the file is corrupt",
          );
        }
        const length =
          (LENGTH_BASE[lengthIndex] ?? 0) +
          reader.bits(LENGTH_EXTRA[lengthIndex] ?? 0);
        const distanceSymbol = decodeSymbol(reader, distance);
        if (distanceSymbol >= DISTANCE_BASE.length) {
          throw new Error(
            "png: an invalid deflate distance code appeared: the file is corrupt",
          );
        }
        const dist =
          (DISTANCE_BASE[distanceSymbol] ?? 0) +
          reader.bits(DISTANCE_EXTRA[distanceSymbol] ?? 0);
        if (dist > produced) {
          throw new Error(
            "png: a deflate back-reference reached before the output's start: the file is corrupt",
          );
        }
        for (let i = 0; i < length; i += 1) {
          write(out[produced - dist] ?? 0);
        }
      }
    }
  } while (final === 0);

  if (produced !== expected) {
    throw new Error(
      `png: the compressed data inflated to ${produced} bytes where the image's geometry needs ${expected}: the file is corrupt`,
    );
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* PNG structure                                                              */
/* -------------------------------------------------------------------------- */

/** The eight signature bytes every PNG opens with. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Channels per pixel for each supported color type, at bit depth 8. */
const CHANNELS: Readonly<Record<number, number>> = {
  0: 1, // grayscale
  2: 3, // rgb
  3: 1, // palette index
  4: 2, // grayscale + alpha
  6: 4, // rgba
};

/** The Paeth predictor, per the PNG specification §9.4. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes a PNG to RGBA8 pixels.
 *
 * Supported: bit depth 8, color types 0 (grayscale), 2 (RGB), 3 (palette,
 * honoring a `tRNS` alpha chunk), 4 (grayscale+alpha), and 6 (RGBA),
 * non-interlaced. Anything else throws an `Error` naming what the file is and
 * what to re-export it as.
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  if (
    bytes.length < 8 ||
    SIGNATURE.some((expected, i) => bytes[i] !== expected)
  ) {
    throw new Error(
      "png: the bytes do not open with the PNG signature: the file is not a PNG",
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let colorType = -1;
  let sawHeader = false;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  // Walk the chunks: length, type, data, CRC (unverified — see module header).
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(
      bytes[at + 4] ?? 0,
      bytes[at + 5] ?? 0,
      bytes[at + 6] ?? 0,
      bytes[at + 7] ?? 0,
    );
    const dataStart = at + 8;
    if (dataStart + length + 4 > bytes.length) {
      throw new Error(
        `png: the "${type}" chunk runs past the end of the file: the file is truncated`,
      );
    }

    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      const bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? 0;
      const compression = bytes[dataStart + 10] ?? 0;
      const filter = bytes[dataStart + 11] ?? 0;
      const interlace = bytes[dataStart + 12] ?? 0;

      if (bitDepth !== 8) {
        throw new Error(
          `png: bit depth ${bitDepth} is not supported: re-export the texture at 8 bits per channel`,
        );
      }
      if (!(colorType in CHANNELS)) {
        throw new Error(
          `png: color type ${colorType} is not supported: grayscale (0), rgb (2), palette (3), grayscale+alpha (4), and rgba (6) are`,
        );
      }
      if (compression !== 0) {
        throw new Error(
          `png: compression method ${compression} is not deflate (0): the file is corrupt`,
        );
      }
      if (filter !== 0) {
        throw new Error(
          `png: filter method ${filter} is not the standard method (0): the file is corrupt`,
        );
      }
      if (interlace !== 0) {
        throw new Error(
          "png: interlaced (Adam7) images are not supported: re-export the texture non-interlaced",
        );
      }
      if (width === 0 || height === 0) {
        throw new Error(
          `png: the image measures ${width}x${height}: a texture needs at least one pixel`,
        );
      }
      sawHeader = true;
    } else if (type === "PLTE") {
      palette = bytes.subarray(dataStart, dataStart + length);
    } else if (type === "tRNS") {
      paletteAlpha = bytes.subarray(dataStart, dataStart + length);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    // Every other chunk is ancillary to a texture decode and skipped.

    at = dataStart + length + 4;
  }

  if (!sawHeader) {
    throw new Error(
      "png: the file carries no IHDR chunk: the file is not a PNG",
    );
  }
  if (idat.length === 0) {
    throw new Error(
      "png: the file carries no IDAT chunk: there are no pixels to decode",
    );
  }
  if (colorType === 3 && palette === null) {
    throw new Error(
      "png: a palette image carries no PLTE chunk: the file is corrupt",
    );
  }

  // Inflate the concatenated IDAT data into the filtered scanlines.
  let compressedLength = 0;
  for (const part of idat) compressedLength += part.length;
  const compressed = new Uint8Array(compressedLength);
  let offset = 0;
  for (const part of idat) {
    compressed.set(part, offset);
    offset += part.length;
  }

  const channels = CHANNELS[colorType] ?? 0;
  const rowBytes = width * channels;
  const raw = inflate(compressed, 0, height * (1 + rowBytes));

  // Unfilter in place into `scanlines`: each row opens with its filter byte.
  const scanlines = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (1 + rowBytes)] ?? 0;
    const rowIn = y * (1 + rowBytes) + 1;
    const rowOut = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[rowIn + x] ?? 0;
      const left = x >= channels ? (scanlines[rowOut + x - channels] ?? 0) : 0;
      const up = y > 0 ? (scanlines[rowOut - rowBytes + x] ?? 0) : 0;
      const upLeft =
        y > 0 && x >= channels
          ? (scanlines[rowOut - rowBytes + x - channels] ?? 0)
          : 0;
      let raw8: number;
      switch (filter) {
        case 0:
          raw8 = value;
          break;
        case 1:
          raw8 = value + left;
          break;
        case 2:
          raw8 = value + up;
          break;
        case 3:
          raw8 = value + Math.floor((left + up) / 2);
          break;
        case 4:
          raw8 = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(
            `png: scanline filter ${filter} is not a filter the format defines: the file is corrupt`,
          );
      }
      scanlines[rowOut + x] = raw8 & 0xff;
    }
  }

  // Expand to RGBA8.
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const from = i * channels;
    const to = i * 4;
    if (colorType === 0) {
      const gray = scanlines[from] ?? 0;
      pixels[to] = gray;
      pixels[to + 1] = gray;
      pixels[to + 2] = gray;
      pixels[to + 3] = 255;
    } else if (colorType === 2) {
      pixels[to] = scanlines[from] ?? 0;
      pixels[to + 1] = scanlines[from + 1] ?? 0;
      pixels[to + 2] = scanlines[from + 2] ?? 0;
      pixels[to + 3] = 255;
    } else if (colorType === 3) {
      const index = scanlines[from] ?? 0;
      if (palette === null || index * 3 + 2 >= palette.length) {
        throw new Error(
          `png: palette index ${index} reaches past the palette's ${(palette?.length ?? 0) / 3} entries: the file is corrupt`,
        );
      }
      pixels[to] = palette[index * 3] ?? 0;
      pixels[to + 1] = palette[index * 3 + 1] ?? 0;
      pixels[to + 2] = palette[index * 3 + 2] ?? 0;
      pixels[to + 3] =
        paletteAlpha !== null && index < paletteAlpha.length
          ? (paletteAlpha[index] ?? 255)
          : 255;
    } else if (colorType === 4) {
      const gray = scanlines[from] ?? 0;
      pixels[to] = gray;
      pixels[to + 1] = gray;
      pixels[to + 2] = gray;
      pixels[to + 3] = scanlines[from + 1] ?? 0;
    } else {
      pixels[to] = scanlines[from] ?? 0;
      pixels[to + 1] = scanlines[from + 1] ?? 0;
      pixels[to + 2] = scanlines[from + 2] ?? 0;
      pixels[to + 3] = scanlines[from + 3] ?? 0;
    }
  }

  return { width, height, pixels };
}
