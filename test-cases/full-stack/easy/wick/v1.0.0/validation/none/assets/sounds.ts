// assets/sounds — reading the produced sound files off the workspace, and
// painting the pictures a sound point leaves behind. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half of
// the sound points in this category, which are about FILES rather than about a
// drive. specs/assets.md fixes each cue's path — "Produce a distinct sound for
// each of the fourteen cues below, under exactly these file names" — and the
// bed's beside it, so what is read is the file on disk rather than anything the
// game played.
//
// WHY A READER WRITTEN HERE IS THE HONEST ONE. The authoring guide warns against
// a decoder that covers only some of the formats a generator might emit, because
// such a decoder fails a build that did exactly what it was asked. The warning
// does not apply here, because the format space is CLOSED: `sfx-synth`,
// `sfx-sample` and `music` contract to write PCM `.wav` files, so the spellings a
// produced cue can arrive in are the linear-PCM spellings of the RIFF container —
// integer samples at 8, 16, 24 or 32 bits, IEEE floats at 32 or 64, and the
// `WAVE_FORMAT_EXTENSIBLE` wrapper around either. All of those are read below, so
// nothing a generator writes goes unread, and a container carrying something else
// is reported AS that rather than as a file with no sound in it.
//
// The RIFF header is read first either way, because "decodes as a WAV" is part of
// what a point claims and a file merely wearing the extension is not one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { CUE_NAMES, cueFile, type CueName } from "../constants";
import { WORKSPACE } from "./media-out";

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The fourteen cues of the table in specs/assets.md ("The sound"), which is
 * every cue but the bed: "Produce a distinct sound for each of the fourteen cues
 * below". The bed is produced by its own tool under "The music bed", so it is
 * named separately.
 */
export const SOUND_CUES: readonly CueName[] = CUE_NAMES.filter(
  (cue) => cue !== "music",
);

/** Each of the fourteen cues' produced file, in the table's order. */
export const CUE_FILES: readonly string[] = SOUND_CUES.map((cue) =>
  cueFile(cue),
);

/** "`assets/audio/music.wav`", the bed the game plays. */
export const MUSIC_FILE = cueFile("music");

/** "`assets/audio/hum.wav`", the second of the two loops. */
export const HUM_FILE = cueFile("hum");

/**
 * The peak sample a file must reach to be carrying signal rather than silence:
 * a hundredth of full scale, which is 40 dB down.
 *
 * specs/assets.md asks for "a distinct sound for each of the fourteen cues" and
 * fixes no level, so what a check can honestly read is the difference between a
 * sound and no sound. Forty decibels below full scale is inaudible under any
 * mix, so a file that fails this carries nothing a player could hear, while a
 * cue mastered as quietly as anyone would sensibly master one clears it many
 * times over.
 */
export const SILENCE_FLOOR = 0.01;

/* -------------------------------------------------------------------------- */
/* Reading a file                                                             */
/* -------------------------------------------------------------------------- */

/** One decoded `.wav`: every channel's samples, on a full scale of `1`. */
export interface Wav {
  /** The path specs/assets.md fixes for it, relative to the repository root. */
  file: string;
  sampleRate: number;
  /** Straight PCM, one array per channel. */
  channels: Float32Array[];
  /** Sample frames per channel. */
  frames: number;
  /** `frames / sampleRate`, in seconds. */
  duration: number;
  /** The largest absolute sample in any channel. */
  peak: number;
}

/** What a read of a produced file came back with: the sound, or why not. */
export interface WavRead {
  wav: Wav | null;
  reason: string | null;
}

/** `WAVE_FORMAT_PCM`: integer samples. */
const FORMAT_PCM = 0x0001;
/** `WAVE_FORMAT_IEEE_FLOAT`: floating-point samples. */
const FORMAT_FLOAT = 0x0003;
/** `WAVE_FORMAT_EXTENSIBLE`: one of the two above, under a subformat GUID. */
const FORMAT_EXTENSIBLE = 0xfffe;

/** The bytes of a produced file, or `null` where the build shipped none. */
export function soundBytes(file: string): Buffer | null {
  try {
    return readFileSync(join(WORKSPACE, file));
  } catch {
    return null;
  }
}

/** One chunk of a RIFF file: its four-character id and its payload. */
interface Chunk {
  id: string;
  start: number;
  size: number;
}

/**
 * Every chunk of the RIFF file, in the order it holds them.
 *
 * A chunk is an eight-byte header and a payload padded to an even length, and a
 * writer is free to put anything between `fmt ` and `data` — a `fact`, a `LIST`
 * of metadata, a cue table — so the chunks are walked rather than assumed. The
 * declared size is clamped, because a writer that streamed its output may have
 * left it larger than what it actually wrote.
 */
function chunks(bytes: Buffer): Chunk[] {
  const found: Chunk[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const start = at + 8;
    found.push({ id, start, size: Math.min(size, bytes.length - start) });
    at = start + size + (size % 2);
  }
  return found;
}

/** The `fmt ` chunk's fields, as the container states them. */
interface Format {
  tag: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bits: number;
}

/** Read the `fmt ` chunk, or `null` where the file carries none. */
function readFormat(bytes: Buffer, found: readonly Chunk[]): Format | null {
  const chunk = found.find((one) => one.id === "fmt ");
  if (chunk === undefined || chunk.size < 16) return null;
  const at = chunk.start;
  let tag = bytes.readUInt16LE(at);
  if (tag === FORMAT_EXTENSIBLE) {
    // The real tag is the first two bytes of the subformat GUID, which sits
    // twenty-four bytes into the chunk.
    if (chunk.size < 40) return null;
    tag = bytes.readUInt16LE(at + 24);
  }
  return {
    tag,
    channels: bytes.readUInt16LE(at + 2),
    sampleRate: bytes.readUInt32LE(at + 4),
    blockAlign: bytes.readUInt16LE(at + 12),
    bits: bytes.readUInt16LE(at + 14),
  };
}

/**
 * One sample of the payload at `at`, on a full scale of `1`, or `null` for an
 * encoding outside the PCM contract.
 *
 * A float clip may legitimately exceed full scale, so nothing here clamps: what
 * is reported is what is in the file.
 */
function sampleReader(
  bytes: Buffer,
  format: Format,
): ((at: number) => number) | null {
  if (format.tag === FORMAT_PCM) {
    if (format.bits === 8) return (at) => (bytes.readUInt8(at) - 128) / 128;
    if (format.bits === 16) return (at) => bytes.readInt16LE(at) / 32768;
    if (format.bits === 24) return (at) => bytes.readIntLE(at, 3) / 8388608;
    if (format.bits === 32) return (at) => bytes.readInt32LE(at) / 2147483648;
    return null;
  }
  if (format.tag === FORMAT_FLOAT) {
    if (format.bits === 32) return (at) => bytes.readFloatLE(at);
    if (format.bits === 64) return (at) => bytes.readDoubleLE(at);
    return null;
  }
  return null;
}

/**
 * Read a produced sound, or report why it could not be read.
 *
 * A file that is absent, that is not a WAV, or whose container says something
 * this reader cannot honour comes back as a `reason` for the point to fail with;
 * the check owns the wording of that failure, because it is the check that knows
 * what it was looking for.
 */
export function readWav(file: string): WavRead {
  const bytes = soundBytes(file);
  if (bytes === null) return { wav: null, reason: `no file at ${file}` };
  if (bytes.length === 0) return { wav: null, reason: `${file} is empty` };
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return { wav: null, reason: `${file} is not a RIFF/WAVE file` };
  }

  const found = chunks(bytes);
  const format = readFormat(bytes, found);
  if (format === null) {
    return { wav: null, reason: `${file} carries no readable fmt chunk` };
  }
  const data = found.find((one) => one.id === "data");
  if (data === undefined) {
    return { wav: null, reason: `${file} carries no data chunk` };
  }
  if (format.channels < 1 || format.sampleRate < 1) {
    return {
      wav: null,
      reason: `${file} declares ${format.channels} channels at ${format.sampleRate} Hz`,
    };
  }
  const read = sampleReader(bytes, format);
  const width = format.bits / 8;
  if (read === null || !Number.isInteger(width) || width < 1) {
    return {
      wav: null,
      reason:
        `${file} is a WAV, but its samples are format 0x${format.tag.toString(16)} ` +
        `at ${format.bits} bits, which is not one of the PCM encodings the ` +
        `generation tools write`,
    };
  }

  const stride = format.blockAlign > 0 ? format.blockAlign : width * format.channels;
  const frames = Math.floor(data.size / stride);
  const channels = Array.from(
    { length: format.channels },
    () => new Float32Array(frames),
  );
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < format.channels; channel += 1) {
      const value = read(data.start + frame * stride + channel * width);
      channels[channel]![frame] = value;
      const level = Math.abs(value);
      if (level > peak) peak = level;
    }
  }
  return {
    wav: {
      file,
      sampleRate: format.sampleRate,
      channels,
      frames,
      duration: frames / format.sampleRate,
      peak,
    },
    reason: null,
  };
}

/** Read several produced sounds, in the order they were named. */
export function readWavs(files: readonly string[]): WavRead[] {
  return files.map((file) => readWav(file));
}

/** The RMS level of `samples[start, end)`. */
export function rms(
  samples: Float32Array,
  start = 0,
  end = samples.length,
): number {
  let total = 0;
  const count = Math.max(1, end - start);
  for (let i = start; i < end; i += 1) total += samples[i]! * samples[i]!;
  return Math.sqrt(total / count);
}

/** Every channel mixed down, for a picture; the readings stay per-channel. */
export function monoMix(wav: Wav): Float32Array {
  const mono = new Float32Array(wav.frames);
  for (const channel of wav.channels) {
    for (let i = 0; i < wav.frames; i += 1) {
      mono[i]! += channel[i]! / wav.channels.length;
    }
  }
  return mono;
}

/**
 * Whether two decoded sounds hold identical samples: the same rate, the same
 * channel count, the same length, and every sample equal.
 *
 * What "decode to identical samples" means, read off the samples rather than off
 * the bytes, so two containers that differ only in a metadata chunk are still
 * the one sound shipped twice.
 */
export function sameSamples(a: Wav, b: Wav): boolean {
  if (
    a.sampleRate !== b.sampleRate ||
    a.channels.length !== b.channels.length ||
    a.frames !== b.frames
  ) {
    return false;
  }
  for (const [index, channel] of a.channels.entries()) {
    const other = b.channels[index]!;
    for (let i = 0; i < a.frames; i += 1) {
      if (channel[i] !== other[i]) return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* The evidence                                                               */
/* -------------------------------------------------------------------------- */

const PAPER = "#0b0d12";
const INK = "#e8ecf2";
const DIM = "#8892a0";
const WAVE = "#5ac8fa";
const MARK = "#ff5a5a";

/** The peak-to-trough envelope of `samples`, drawn into the given box. */
function envelope(
  ctx: SKRSContext2D,
  samples: Float32Array,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = WAVE;
  const mid = y + h / 2;
  for (let column = 0; column < w; column += 1) {
    const from = Math.floor((column / w) * samples.length);
    const to = Math.max(
      from + 1,
      Math.floor(((column + 1) / w) * samples.length),
    );
    let low = 1;
    let high = -1;
    for (let i = from; i < to && i < samples.length; i += 1) {
      if (samples[i]! < low) low = samples[i]!;
      if (samples[i]! > high) high = samples[i]!;
    }
    if (high < low) continue;
    const top = mid - high * (h / 2);
    const bottom = mid - low * (h / 2);
    ctx.fillRect(x + column, top, 1, Math.max(1, bottom - top));
  }
}

/**
 * The whole file as one envelope, labelled with what was read off it, with an
 * optional marker line at `markSeconds` on the time axis.
 */
export function paintWaveform(
  title: string,
  wav: Wav,
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
    `${wav.duration.toFixed(2)} s · ${wav.sampleRate} Hz · ` +
      `${wav.channels.length} ch · peak ${wav.peak.toFixed(3)}`,
    16,
    46,
  );
  envelope(ctx, monoMix(wav), 16, 60, 928, 160);
  ctx.fillStyle = DIM;
  ctx.fillRect(16, 140, 928, 1);
  const seconds = Math.max(1, Math.floor(wav.duration));
  for (let second = 0; second <= seconds; second += 1) {
    const x = 16 + (second / Math.max(wav.duration, 1e-6)) * 928;
    if (x > 944) break;
    ctx.fillRect(x, 222, 1, 6);
    if (second % Math.max(1, Math.round(seconds / 12)) === 0) {
      ctx.fillText(`${second}s`, x + 2, 244);
    }
  }
  if (markSeconds !== undefined) {
    const x = 16 + (Math.min(markSeconds, wav.duration) / Math.max(wav.duration, 1e-6)) * 928;
    ctx.fillStyle = MARK;
    ctx.fillRect(x, 54, 2, 176);
    ctx.fillText(`${markSeconds}s`, x + 6, 66);
  }
  return canvas;
}

/**
 * The loop junction: the file's final `windowSeconds` running into its first,
 * drawn as the one continuous stretch a looping source plays, with the seam
 * marked and the two samples the point reads printed beside it.
 */
export function paintSeam(
  title: string,
  wav: Wav,
  windowSeconds: number,
): Canvas {
  const window = Math.max(
    1,
    Math.min(
      Math.round(windowSeconds * wav.sampleRate),
      Math.floor(wav.frames / 2),
    ),
  );
  const mono = monoMix(wav);
  const joined = new Float32Array(window * 2);
  joined.set(mono.subarray(wav.frames - window, wav.frames), 0);
  joined.set(mono.subarray(0, window), window);

  const canvas = createCanvas(960, 260);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, 960, 260);
  ctx.fillStyle = INK;
  ctx.font = "16px sans-serif";
  ctx.fillText(title, 16, 26);
  ctx.fillStyle = DIM;
  ctx.font = "13px sans-serif";
  const steps = wav.channels
    .map(
      (channel, index) =>
        `ch${index} |first − last| = ` +
        `${Math.abs(channel[0]! - channel[wav.frames - 1]!).toFixed(5)}`,
    )
    .join("   ");
  ctx.fillText(steps, 16, 46);
  envelope(ctx, joined, 16, 60, 928, 160);
  ctx.fillStyle = MARK;
  ctx.fillRect(16 + 464, 54, 2, 176);
  ctx.fillStyle = DIM;
  ctx.fillText(`final ${windowSeconds}s`, 16, 244);
  ctx.fillText("end → start", 16 + 470, 244);
  return canvas;
}

/** A sheet of rows of text: what a point read, file by file. */
export function paintReadings(title: string, rows: readonly string[]): Canvas {
  const line = 22;
  const canvas = createCanvas(880, 60 + rows.length * line + 20);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.font = "16px sans-serif";
  ctx.fillText(title, 20, 32);
  ctx.font = "13px monospace";
  for (const [index, row] of rows.entries()) {
    ctx.fillStyle = row.includes(" — ") ? MARK : DIM;
    ctx.fillText(row, 20, 60 + index * line);
  }
  return canvas;
}

/** One row of {@link paintReadings} for a file that was read, or for one that was not. */
export function readingRow(file: string, read: WavRead): string {
  if (read.wav === null) return `${file} — ${read.reason ?? "unread"}`;
  const { duration, peak, sampleRate, channels } = read.wav;
  return (
    `${file.padEnd(32)} ${duration.toFixed(3)} s  peak ${peak.toFixed(3)}  ` +
    `${sampleRate} Hz x ${channels.length}`
  );
}

/** A grid of every named file's envelope, for a point that compared several. */
export function paintWaveGrid(
  title: string,
  entries: readonly { label: string; read: WavRead }[],
): Canvas {
  const columns = 2;
  const cellW = 440;
  const cellH = 90;
  const rows = Math.ceil(entries.length / columns);
  const canvas = createCanvas(
    40 + columns * (cellW + 20),
    56 + rows * (cellH + 18),
  );
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.font = "16px sans-serif";
  ctx.fillText(title, 20, 30);
  ctx.font = "12px monospace";
  for (const [index, one] of entries.entries()) {
    const x = 20 + (index % columns) * (cellW + 20);
    const y = 48 + Math.floor(index / columns) * (cellH + 18);
    if (one.read.wav === null) {
      ctx.fillStyle = MARK;
      ctx.fillText(`${one.label} — ${one.read.reason ?? "unread"}`, x, y + 20);
      continue;
    }
    envelope(ctx, monoMix(one.read.wav), x, y, cellW, cellH - 18);
    ctx.fillStyle = DIM;
    ctx.fillText(
      `${one.label}  ${one.read.wav.duration.toFixed(3)} s  ` +
        `peak ${one.read.wav.peak.toFixed(3)}`,
      x,
      y + cellH,
    );
  }
  return canvas;
}
