// audio — reading the produced sound files off the workspace, and posing the
// round each one belongs to. CASE-PROVIDED.
//
// NOT a `.test.ts`, so vitest never collects it: it is the shared reading half of
// the six `audio/*-produced` and duration points, which are about FILES rather
// than about a drive. `specs/assets.md` fixes each cue's path and which binary
// makes it, and `specs/ui.md` fixes the event it plays on, so those six read the
// file on disk and the five `*-cue-plays` points next door read the game.
//
// WHY THE FILE IS READ HERE RATHER THAN THROUGH THE ENGINE. The engine's loader
// decodes a sound through a Web Audio context, and this process has none: a cue's
// produced file cannot be loaded through the engine in a Node run whatever its
// bytes are. `specs/assets.md` requires a build that keeps playing when its files
// do not arrive, so the cues still sound and the `*-cue-plays` points still read
// them; what has to happen here instead is the bytes being read where they
// actually live, which is on disk.
//
// WHY A READER WRITTEN HERE IS THE HONEST ONE, WHICH IT IS NOT ALWAYS. The
// authoring guide warns against a decoder that covers only some of the formats a
// generator might emit, because such a decoder fails a build that did exactly
// what it was asked. The warning does not apply here, and the reason is that the
// format space is CLOSED: the generation binaries' own contract is that their
// output is a PCM `.wav`, so the spellings a produced cue can arrive in are the
// linear-PCM spellings of the RIFF container — integer samples at 8, 16, 24 or 32
// bits, IEEE floats at 32 or 64, and the `WAVE_FORMAT_EXTENSIBLE` wrapper around
// either. All of those are read below, so nothing a generator writes goes
// unread, and a container carrying something else is reported AS that rather
// than as a file with no sound in it.
//
// AND THE LENGTH NEEDS NO SAMPLE FORMAT AT ALL. Every WAV's `fmt ` chunk carries
// its average bytes per second, whatever encodes the samples, so a clip's length
// is its `data` chunk divided by that figure. The two points that read a duration
// therefore hold for any WAV a build could ship, and only the peak — which is
// samples — needs the encoding named.
//
// The RIFF header is read first either way, because "decodes as a WAV" is part of
// what the points claim and a file merely wearing the extension is not one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUES, CUE_PATHS } from "../../src/constants";
import { poseScene, type Harness, type Scene } from "../harness";
import { WORKSPACE } from "../harness";

/** Each cue's produced file, as a path under the repository root. */
export const CUE_FILES: Readonly<Record<string, string>> = {
  [CUES.eat]: `assets/${CUE_PATHS[CUES.eat]}`,
  [CUES.comboUp]: `assets/${CUE_PATHS[CUES.comboUp]}`,
  [CUES.death]: `assets/${CUE_PATHS[CUES.death]}`,
  [CUES.music]: `assets/${CUE_PATHS[CUES.music]}`,
};

/**
 * The peak sample a file must reach to be carrying signal rather than silence:
 * a hundredth of full scale, which is 40 dB down.
 *
 * `specs/assets.md` asks for four sounds a player hears and tells apart, and
 * fixes no level, so what a check can honestly read is the difference between a
 * sound and no sound. Forty decibels below full scale is inaudible under any
 * mix, so a file that fails this carries nothing a player could hear, while a
 * file mastered as quietly as anyone would sensibly master a game cue clears it
 * many times over.
 */
export const SILENCE_FLOOR = 0.01;

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
 * A chunk is an eight-byte header and a payload padded to an even length, and a
 * writer is free to put anything between `fmt ` and `data` — a `fact`, a `LIST`
 * of metadata, a cue table — so the chunks are walked rather than assumed.
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
 * signed little-endian integers at sixteen, twenty-four and thirty-two bits, and
 * IEEE floats at thirty-two and sixty-four. A float clip may legitimately exceed
 * full scale, so nothing here clamps: what is reported is what is in the file.
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
 * this reader cannot honour comes back as a `reason` for the point to fail with;
 * the check owns the wording of that failure, because it is the check that knows
 * what it was looking for.
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
        `of the PCM encodings the generation binaries write`,
    };
  }

  // The length comes off the header rather than off a sample count, so it is the
  // same figure whatever encodes the samples; the frame count comes off the
  // block the container declares one frame to be, which is exact.
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
 * Pose the round a cue belongs to and draw one frame of it, so a point that
 * reads a FILE still leaves a picture of the game that plays it.
 *
 * These points drive nothing — they read bytes off disk — so their declared
 * evidence is a still rather than a recording, and the still a reviewer wants
 * beside a cue is the moment of play the cue sounds at. Nothing here is read by
 * an assertion.
 */
export async function showRound(h: Harness, scene: Scene): Promise<void> {
  poseScene(h, scene);
  await h.advance(1);
}
