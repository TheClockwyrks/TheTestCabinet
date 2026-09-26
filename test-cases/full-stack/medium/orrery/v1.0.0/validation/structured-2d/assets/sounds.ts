// Orrery — reading the produced cue files off the workspace, and showing what was
// read as the evidence a sound point leaves behind. CASE-PROVIDED, and the SAME
// FILE in all three engine projects.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half of
// the cue points in `assets/`, which are about FILES rather than about a frame.
// `specs/assets.md` fixes each cue's path — "Produce a distinct sound for each of
// the six one-shot cues below, under exactly these file names", all under
// `assets/audio/` — so what is read is the file on disk rather than anything the
// game played. The music bed is read next door, by `bed-audio.ts`, because what is
// asked of it is different.
//
// WHY A READER WRITTEN HERE IS THE HONEST ONE. The authoring guide warns against a
// decoder that covers only some of the formats a generator might emit, because
// such a decoder fails a build that did exactly what it was asked. The warning does
// not apply here, because the format space is CLOSED: `sfx-synth`, `sfx-sample`
// and `music` contract to write PCM `.wav` files, so the spellings a produced cue
// can arrive in are the linear-PCM spellings of the RIFF container — integer
// samples at 8, 16, 24 or 32 bits, IEEE floats at 32 or 64, and the
// `WAVE_FORMAT_EXTENSIBLE` wrapper around either. All of those are read below, so
// nothing a generator writes goes unread, and a container carrying something else
// is reported AS that rather than as a file with no sound in it.
//
// The RIFF header is read first either way, because "decodes as a WAV" is part of
// what the point claims and a file merely wearing the extension is not one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { WORKSPACE, writeImageBytes } from "../media";
import { CUE_FILES, ONE_SHOT_CUES } from "./files";

export { CUE_FILES, ONE_SHOT_CUES };

/** One produced sound, as its container describes it. */
export interface Sound {
  /** The path `specs/assets.md` fixes for it, relative to the repository root. */
  file: string;
  /** Its length in seconds. */
  duration: number;
  sampleRate: number;
  channels: number;
  /** Its length in sample frames. */
  frames: number;
  /** The largest absolute sample in any channel, on a full scale of `1`. */
  peak: number;
}

/** What a read of a produced file came back with: the sound, or why not. */
export interface SoundRead {
  sound: Sound | null;
  reason: string | null;
}

/** The bytes of a produced file, or `null` where the build shipped none. */
export function soundBytes(file: string): Buffer | null {
  try {
    return readFileSync(join(WORKSPACE, file));
  } catch {
    return null;
  }
}

/**
 * Whether the bytes are a RIFF/WAVE container.
 *
 * The first four bytes are `RIFF` and bytes 8 to 12 are `WAVE`, which is the
 * whole of what makes a file a WAV rather than something else wearing the
 * extension.
 */
export function isRiffWave(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE"
  );
}

/** `WAVE_FORMAT_PCM`: integer samples. */
const FORMAT_PCM = 0x0001;
/** `WAVE_FORMAT_IEEE_FLOAT`: floating-point samples. */
const FORMAT_FLOAT = 0x0003;
/** `WAVE_FORMAT_EXTENSIBLE`: one of the two above, under a subformat GUID. */
const FORMAT_EXTENSIBLE = 0xfffe;

/** One chunk of a RIFF file: its four-character id and its payload. */
interface Chunk {
  id: string;
  start: number;
  size: number;
}

/**
 * Every chunk of the RIFF file, in the order it holds them.
 *
 * A chunk is an eight-byte header and a payload padded to an even length, and
 * a writer is free to put anything between `fmt ` and `data` — a `fact`, a
 * `LIST` of metadata, a cue table — so the chunks are walked rather than
 * assumed.
 */
function chunks(bytes: Buffer): Chunk[] {
  const found: Chunk[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const start = at + 8;
    // Clamped, because a writer that streamed its output may have left the
    // declared size larger than what it actually wrote.
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
  byteRate: number;
  /** Bytes of one sample frame, across every channel. */
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
    // fourteen bytes into the extension.
    if (chunk.size < 40) return null;
    tag = bytes.readUInt16LE(at + 24);
  }
  return {
    tag,
    channels: bytes.readUInt16LE(at + 2),
    sampleRate: bytes.readUInt32LE(at + 4),
    byteRate: bytes.readUInt32LE(at + 8),
    blockAlign: bytes.readUInt16LE(at + 12),
    bits: bytes.readUInt16LE(at + 14),
  };
}

/**
 * The largest absolute sample the payload holds, on a full scale of `1`, or
 * `null` for an encoding outside the PCM contract.
 *
 * Every linear-PCM spelling the container allows is read: unsigned bytes, and
 * signed little-endian integers at sixteen, twenty-four and thirty-two bits,
 * and IEEE floats at thirty-two and sixty-four. A float clip may legitimately
 * exceed full scale, so nothing here clamps: what is reported is what is in
 * the file.
 */
function peakOf(bytes: Buffer, data: Chunk, format: Format): number | null {
  const end = data.start + data.size;
  let peak = 0;
  const note = (sample: number): void => {
    const level = Math.abs(sample);
    if (level > peak) peak = level;
  };

  if (format.tag === FORMAT_PCM) {
    if (format.bits === 8) {
      for (let at = data.start; at < end; at += 1) {
        note((bytes.readUInt8(at) - 128) / 128);
      }
      return peak;
    }
    if (format.bits === 16) {
      for (let at = data.start; at + 2 <= end; at += 2) {
        note(bytes.readInt16LE(at) / 32768);
      }
      return peak;
    }
    if (format.bits === 24) {
      for (let at = data.start; at + 3 <= end; at += 3) {
        note(bytes.readIntLE(at, 3) / 8388608);
      }
      return peak;
    }
    if (format.bits === 32) {
      for (let at = data.start; at + 4 <= end; at += 4) {
        note(bytes.readInt32LE(at) / 2147483648);
      }
      return peak;
    }
    return null;
  }

  if (format.tag === FORMAT_FLOAT) {
    if (format.bits === 32) {
      for (let at = data.start; at + 4 <= end; at += 4) {
        note(bytes.readFloatLE(at));
      }
      return peak;
    }
    if (format.bits === 64) {
      for (let at = data.start; at + 8 <= end; at += 8) {
        note(bytes.readDoubleLE(at));
      }
      return peak;
    }
    return null;
  }

  return null;
}

/**
 * Read a produced sound, or report why it could not be read.
 *
 * A file that is absent, that is not a WAV, or whose container says something
 * this reader cannot honour comes back as a `reason` for the point to fail
 * with; the check owns the wording of that failure, because it is the check
 * that knows what it was looking for.
 */
export function readSound(file: string): SoundRead {
  const bytes = soundBytes(file);
  if (bytes === null) return { sound: null, reason: `no file at ${file}` };
  if (bytes.length === 0) return { sound: null, reason: `${file} is empty` };
  if (!isRiffWave(bytes)) {
    return { sound: null, reason: `${file} is not a RIFF/WAVE file` };
  }

  const found = chunks(bytes);
  const format = readFormat(bytes, found);
  if (format === null) {
    return { sound: null, reason: `${file} carries no readable fmt chunk` };
  }
  const data = found.find((one) => one.id === "data");
  if (data === undefined) {
    return { sound: null, reason: `${file} carries no data chunk` };
  }
  if (format.byteRate <= 0 || format.channels <= 0 || format.sampleRate <= 0) {
    return {
      sound: null,
      reason:
        `${file} declares ${format.channels} channels at ` +
        `${format.sampleRate} Hz and ${format.byteRate} bytes a second`,
    };
  }

  const peak = peakOf(bytes, data, format);
  if (peak === null) {
    return {
      sound: null,
      reason:
        `${file} is a WAV, but its samples are format 0x` +
        `${format.tag.toString(16)} at ${format.bits} bits, which is not one ` +
        `of the PCM encodings the generation tools write`,
    };
  }

  // The length comes off the header rather than off a sample count, so it is
  // the same figure whatever encodes the samples; the frame count comes off
  // the block the container declares one frame to be, which is exact.
  const duration = data.size / format.byteRate;
  const frames =
    format.blockAlign > 0
      ? Math.floor(data.size / format.blockAlign)
      : Math.floor(duration * format.sampleRate);
  return {
    sound: {
      file,
      duration,
      sampleRate: format.sampleRate,
      channels: format.channels,
      frames,
      peak,
    },
    reason: null,
  };
}

/** Read several produced sounds, in the order they were named. */
export function readSounds(files: readonly string[]): SoundRead[] {
  return files.map((file) => readSound(file));
}

/**
 * Paint what was read — one row per cue, with the length and peak the container
 * reported, or the reason a file could not be read — and keep it as the review
 * item's `outputId` output.
 *
 * A cue point drives no game, so a screenshot of one would be evidence of nothing.
 * Nothing painted here is read by an assertion.
 */
export function showSoundReadings(
  outputId: string,
  reads: readonly SoundRead[],
  files: readonly string[],
): void {
  const rows = reads.map((read, i) => {
    if (read.sound === null) return `${files[i]} — ${read.reason ?? "unread"}`;
    const { duration, peak, sampleRate, channels } = read.sound;
    return (
      `${files[i]} — ${duration.toFixed(2)} s, peak ${peak.toFixed(3)}, ` +
      `${sampleRate} Hz x ${channels}`
    );
  });
  const step = 28;
  const canvas = createCanvas(960, Math.max(120, 48 + rows.length * step));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#c9d4e4";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "14px monospace";
  rows.forEach((row, i) => {
    ctx.fillText(row, 24, 32 + i * step);
  });
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}
