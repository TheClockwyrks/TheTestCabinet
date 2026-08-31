// assets/bed-audio — reading a produced music bed off disk.
//
// specs/assets.md fixes the two beds as FILES: "Produce two beds with `music`
// ... `music` writes a `.wav` and a `.mid` beside it; the `.wav` is what the
// game plays", at `assets/audio/music-title.wav` and `assets/audio/music-play.wav`.
// So the beds are graded where they live — a decode of the committed bytes —
// and this module is that decode: a plain RIFF/WAVE parser returning each
// channel's samples, the level readings the bed suites assert over, and the
// waveform pictures they keep as evidence. Nothing here touches the game.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { WORKSPACE } from "./media-out";

/** The two beds, by the exact workspace paths specs/assets.md names. */
export const BEDS = [
  { name: "title bed", path: "assets/audio/music-title.wav" },
  { name: "play bed", path: "assets/audio/music-play.wav" },
] as const;

/** One decoded `.wav`: every channel's samples, normalized to [-1, 1]. */
export interface DecodedWav {
  sampleRate: number;
  channels: Float32Array[];
  /** Sample frames per channel. */
  frames: number;
  /** `frames / sampleRate`, in seconds. */
  duration: number;
}

/**
 * Decode one RIFF/WAVE file: integer PCM at 8/16/24/32 bits, float PCM at
 * 32/64, plain or `WAVE_FORMAT_EXTENSIBLE`. Anything a `.wav` header does not
 * announce, or a chunk layout this cannot walk, throws with the reason — the
 * suites turn that into the item's failure, because a bed that does not decode
 * as a WAV is exactly what the item fails on.
 */
export function decodeWav(bytes: Buffer): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || view.getUint32(0, false) !== 0x52494646) {
    throw new Error("no RIFF header");
  }
  if (view.getUint32(8, false) !== 0x57415645) {
    throw new Error("a RIFF file, but not a WAVE file");
  }
  let offset = 12;
  let format: { tag: number; channels: number; rate: number; bits: number } | null =
    null;
  let data: { start: number; size: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      let tag = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its GUID's first
      // two bytes, 24 bytes into the chunk.
      if (tag === 0xfffe && size >= 40) tag = view.getUint16(body + 24, true);
      format = {
        tag,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    }
    if (id === "data") {
      data = { start: body, size: Math.min(size, bytes.length - body) };
    }
    offset = body + size + (size % 2);
  }
  if (format === null) throw new Error("no fmt chunk");
  if (data === null) throw new Error("no data chunk");
  if (format.channels < 1) throw new Error("a fmt chunk naming 0 channels");
  if (format.rate < 1) throw new Error("a fmt chunk naming no sample rate");
  const bytesPer = format.bits / 8;
  if (!Number.isInteger(bytesPer)) {
    throw new Error(`an unreadable bit depth (${format.bits})`);
  }
  const frames = Math.floor(data.size / (bytesPer * format.channels));
  const channels = Array.from(
    { length: format.channels },
    () => new Float32Array(frames),
  );
  const read = (at: number): number => {
    if (format.tag === 3) {
      if (format.bits === 32) return view.getFloat32(at, true);
      if (format.bits === 64) return view.getFloat64(at, true);
      throw new Error(`float PCM at ${format.bits} bits`);
    }
    if (format.tag !== 1) throw new Error(`format tag ${format.tag}`);
    if (format.bits === 8) return (bytes[at] - 128) / 128;
    if (format.bits === 16) return view.getInt16(at, true) / 32768;
    if (format.bits === 24) {
      const raw = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      return ((raw << 8) >> 8) / 8388608;
    }
    if (format.bits === 32) return view.getInt32(at, true) / 2147483648;
    throw new Error(`integer PCM at ${format.bits} bits`);
  };
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < format.channels; channel++) {
      const at = data.start + (frame * format.channels + channel) * bytesPer;
      channels[channel][frame] = read(at);
    }
  }
  return {
    sampleRate: format.rate,
    channels,
    frames,
    duration: frames / format.rate,
  };
}

/** Decode the bed at `path` (workspace-relative), or throw with the reason. */
export function readBed(path: string): DecodedWav {
  return decodeWav(readFileSync(join(WORKSPACE, path)));
}

/** The largest |sample| in `samples[start, end)`. */
export function peak(samples: Float32Array, start = 0, end = samples.length): number {
  let top = 0;
  for (let i = start; i < end; i++) {
    const value = Math.abs(samples[i]);
    if (value > top) top = value;
  }
  return top;
}

/** The RMS level of `samples[start, end)`. */
export function rms(samples: Float32Array, start = 0, end = samples.length): number {
  let total = 0;
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i++) total += samples[i] * samples[i];
  return Math.sqrt(total / count);
}

/** The largest step between two ADJACENT samples in `samples[start, end)`. */
export function maxStep(samples: Float32Array): number {
  let top = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs(samples[i] - samples[i - 1]);
    if (step > top) top = step;
  }
  return top;
}

/* ---- Evidence pictures ----------------------------------------------------- */

const INK = "#e8ecf2";
const DIM = "#8892a0";
const PAPER = "#101418";
const WAVE = "#5ac8fa";
const MARK = "#ff5a5a";

function envelope(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  samples: Float32Array,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = WAVE;
  const mid = y + h / 2;
  for (let column = 0; column < w; column++) {
    const from = Math.floor((column / w) * samples.length);
    const to = Math.max(from + 1, Math.floor(((column + 1) / w) * samples.length));
    let low = 1;
    let high = -1;
    for (let i = from; i < to; i++) {
      if (samples[i] < low) low = samples[i];
      if (samples[i] > high) high = samples[i];
    }
    const top = mid - high * (h / 2);
    const bottom = mid - low * (h / 2);
    ctx.fillRect(x + column, top, 1, Math.max(1, bottom - top));
  }
}

/** All channels mixed down, for a picture (the readings stay per-channel). */
export function monoMix(wav: DecodedWav): Float32Array {
  const mono = new Float32Array(wav.frames);
  for (const channel of wav.channels) {
    for (let i = 0; i < wav.frames; i++) mono[i] += channel[i] / wav.channels.length;
  }
  return mono;
}

/**
 * The whole bed as one envelope, labeled with what was read off it, with an
 * optional marker line at `markSeconds` on the time axis.
 */
export function paintWaveform(
  title: string,
  wav: DecodedWav,
  markSeconds?: number,
): Canvas {
  const canvas = createCanvas(960, 260);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, 960, 260);
  ctx.fillStyle = INK;
  ctx.font = "16px sans-serif";
  ctx.fillText(title, 16, 26);
  ctx.fillStyle = DIM;
  ctx.font = "13px sans-serif";
  ctx.fillText(
    `${wav.duration.toFixed(2)} s · ${wav.sampleRate} Hz · ${wav.channels.length} ch`,
    16,
    46,
  );
  envelope(ctx, monoMix(wav), 16, 60, 928, 160);
  ctx.strokeStyle = DIM;
  ctx.beginPath();
  ctx.moveTo(16, 140);
  ctx.lineTo(944, 140);
  ctx.stroke();
  // A seconds ruler under the envelope.
  ctx.fillStyle = DIM;
  for (let second = 0; second <= Math.floor(wav.duration); second++) {
    const x = 16 + (second / wav.duration) * 928;
    ctx.fillRect(x, 222, 1, 6);
    if (second % 2 === 0) ctx.fillText(`${second}s`, x + 2, 244);
  }
  if (markSeconds !== undefined && markSeconds <= wav.duration) {
    const x = 16 + (markSeconds / wav.duration) * 928;
    ctx.fillStyle = MARK;
    ctx.fillRect(x, 54, 2, 176);
    ctx.fillText(`${markSeconds}s`, x + 6, 66);
  }
  return canvas;
}

/**
 * The loop seam: the bed's final `windowSeconds` running into its first, drawn
 * as the one continuous stretch a looping source plays, with the junction
 * marked.
 */
export function paintSeam(
  title: string,
  wav: DecodedWav,
  windowSeconds: number,
): Canvas {
  const window = Math.min(
    Math.round(windowSeconds * wav.sampleRate),
    Math.floor(wav.frames / 2),
  );
  const mono = monoMix(wav);
  const joined = new Float32Array(window * 2);
  joined.set(mono.subarray(wav.frames - window, wav.frames), 0);
  joined.set(mono.subarray(0, window), window);
  const canvas = createCanvas(960, 240);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, 960, 240);
  ctx.fillStyle = INK;
  ctx.font = "16px sans-serif";
  ctx.fillText(title, 16, 26);
  envelope(ctx, joined, 16, 44, 928, 160);
  ctx.fillStyle = MARK;
  ctx.fillRect(16 + 464, 38, 2, 172);
  ctx.font = "13px sans-serif";
  ctx.fillText("end → start", 16 + 470, 226);
  ctx.fillStyle = DIM;
  ctx.fillText(`final ${windowSeconds}s`, 16, 226);
  ctx.fillText(`first ${windowSeconds}s`, 944 - 70, 226);
  return canvas;
}
