import { describe, expect, it } from "vitest";
import { decodeWav } from "./wav";

/**
 * The WAV decoder against fixtures constructed byte by byte in this file, so
 * every sample expectation is hand-derivable from the RIFF layout. The suite
 * owns the container walk (chunk order, word alignment), the two sample
 * formats and their scaling, and the refusal table; what the audio bus does
 * with a decoded buffer belongs to the audio suite.
 */

/** A RIFF/WAVE file from a fmt description and raw chunk list. */
function wav(chunks: readonly { tag: string; data: Uint8Array }[]): Uint8Array {
  let total = 12;
  for (const c of chunks) total += 8 + c.data.length + (c.data.length % 2);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, total - 8, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  let at = 12;
  for (const c of chunks) {
    for (let i = 0; i < 4; i += 1) out[at + i] = c.tag.charCodeAt(i);
    view.setUint32(at + 4, c.data.length, true);
    out.set(c.data, at + 8);
    at += 8 + c.data.length + (c.data.length % 2); // odd chunks pad a byte
  }
  return out;
}

/** A fmt chunk for `format` (1 = integer PCM, 3 = float PCM). */
function fmt(
  format: number,
  channels: number,
  sampleRate: number,
  bitsPerSample: number,
): { tag: string; data: Uint8Array } {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  const blockAlign = channels * (bitsPerSample / 8);
  view.setUint16(0, format, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, sampleRate, true);
  view.setUint32(8, sampleRate * blockAlign, true);
  view.setUint16(12, blockAlign, true);
  view.setUint16(14, bitsPerSample, true);
  return { tag: "fmt ", data };
}

/** Interleaved 16-bit samples as a data chunk. */
function data16(samples: readonly number[]): { tag: string; data: Uint8Array } {
  const data = new Uint8Array(samples.length * 2);
  const view = new DataView(data.buffer);
  samples.forEach((sample, i) => view.setInt16(i * 2, sample, true));
  return { tag: "data", data };
}

/** Interleaved 32-bit float samples as a data chunk. */
function data32f(samples: readonly number[]): {
  tag: string;
  data: Uint8Array;
} {
  const data = new Uint8Array(samples.length * 4);
  const view = new DataView(data.buffer);
  samples.forEach((sample, i) => view.setFloat32(i * 4, sample, true));
  return { tag: "data", data };
}

describe("16-bit integer PCM", () => {
  it("deinterleaves stereo and scales by 32768, so -32768 lands exactly at -1", () => {
    const bytes = wav([
      fmt(1, 2, 48_000, 16),
      data16([0, 32767, 16384, -16384, -32768, 0]),
    ]);
    const decoded = decodeWav(bytes);

    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.channels).toHaveLength(2);
    const [left, right] = decoded.channels;
    expect(Array.from(left ?? [])).toEqual([0, 0.5, -1]);
    expect(right?.[0]).toBeCloseTo(32767 / 32768, 7);
    expect(right?.[1]).toBe(-0.5);
    expect(right?.[2]).toBe(0);
  });

  it("reports duration as frames over the sample rate", () => {
    const bytes = wav([fmt(1, 1, 8_000, 16), data16([1, 2, 3, 4])]);
    const decoded = decodeWav(bytes);
    expect(decoded.channels[0]).toHaveLength(4);
    expect(decoded.duration).toBe(4 / 8_000);
  });
});

describe("32-bit float PCM", () => {
  it("passes mono float samples through unscaled", () => {
    const bytes = wav([fmt(3, 1, 44_100, 32), data32f([0.25, -0.5, 1])]);
    const decoded = decodeWav(bytes);
    expect(decoded.channels).toHaveLength(1);
    expect(Array.from(decoded.channels[0] ?? [])).toEqual([0.25, -0.5, 1]);
    expect(decoded.duration).toBeCloseTo(3 / 44_100, 12);
  });
});

describe("the container walk", () => {
  it("skips unknown chunks and pads odd lengths to word boundaries", () => {
    // A 3-byte junk chunk between fmt and data: without the pad byte the walk
    // would land off the "data" tag and miss the samples.
    const bytes = wav([
      fmt(1, 1, 8_000, 16),
      { tag: "junk", data: Uint8Array.from([9, 9, 9]) },
      data16([100]),
    ]);
    expect(Array.from(decodeWav(bytes).channels[0] ?? [])).toEqual([
      100 / 32768,
    ]);
  });
});

describe("refusals", () => {
  it("refuses bytes that are not a RIFF/WAVE", () => {
    expect(() => decodeWav(Uint8Array.from([1, 2, 3, 4]))).toThrow(
      /RIFF\/WAVE/,
    );
  });

  it("refuses a compressed format code by number, with the fix", () => {
    const bytes = wav([fmt(6, 1, 8_000, 16), data16([0])]);
    expect(() => decodeWav(bytes)).toThrow(/format code 6.*plain PCM/);
  });

  it("refuses 8-bit integer PCM, naming 16-bit as the supported depth", () => {
    const bytes = wav([
      fmt(1, 1, 8_000, 8),
      { tag: "data", data: Uint8Array.from([128]) },
    ]);
    expect(() => decodeWav(bytes)).toThrow(
      /8-bit integer PCM.*16 bits per sample/,
    );
  });

  it("refuses 64-bit float PCM, naming 32-bit as the supported depth", () => {
    const bytes = wav([
      fmt(3, 1, 8_000, 64),
      { tag: "data", data: new Uint8Array(8) },
    ]);
    expect(() => decodeWav(bytes)).toThrow(
      /64-bit float PCM.*32 bits per sample/,
    );
  });

  it("refuses a file with no data chunk", () => {
    const bytes = wav([fmt(1, 1, 8_000, 16)]);
    expect(() => decodeWav(bytes)).toThrow(/no data chunk/);
  });

  it("refuses a file with no fmt chunk", () => {
    const bytes = wav([data16([0])]);
    expect(() => decodeWav(bytes)).toThrow(/no fmt chunk/);
  });
});
