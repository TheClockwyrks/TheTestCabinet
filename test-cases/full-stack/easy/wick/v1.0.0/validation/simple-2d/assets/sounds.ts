// assets/sounds — the produced sound files, as this category reads them off the
// workspace and shows them back. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it: it is the shared reading half
// of the cue, music, and loop points, every one of which is about a FILE rather
// than about what the game played. `specs/assets.md` fixes each cue's path —
// "Produce a distinct sound for each of the fourteen cues below, under exactly
// these file names", all under `assets/audio/` — and the bed's, and
// `constants.ts` carries those paths in `CUE_PATHS` and `MUSIC_SCORE_PATH`, so
// what is read here is the committed file at the name the case fixes.
//
// THE DECODE IS THE HARNESS'S. `harness.ts` already stands a decoder up for the
// engine's own audio path, covering the linear-PCM spellings of the RIFF
// container the asset tools write: integer samples at 8, 16, 24 and 32 bits,
// IEEE floats at 32 and 64, plain and under `WAVE_FORMAT_EXTENSIBLE`. Reading a
// file here through that same decoder is what keeps "the file decodes" meaning
// one thing in this project: a cue the game could bind is a cue this reads.
//
// The evidence pictures are painted here too, since a point about a sound file
// drove no game and a screenshot of one would be evidence of nothing.

import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import {
  CUE_NAMES,
  CUE_PATHS,
  LOOPING_CUES,
  MUSIC_SCORE_PATH,
  type CueName,
} from "../constants";
import { decodeWav, producedFile } from "../harness";

/**
 * The peak sample a file must reach to be carrying signal rather than silence:
 * a hundredth of full scale, which is 40 dB down.
 *
 * `specs/assets.md` asks for "a distinct sound for each of the fourteen cues"
 * and fixes no level, so what a check can honestly read is the difference
 * between a sound and no sound. Forty decibels below full scale is inaudible
 * under any mix, so a file that fails this carries nothing a player could hear,
 * while a cue mastered as quietly as anyone would sensibly master one clears it
 * many times over. The reference's quietest cue peaks at about a fifth of full
 * scale.
 */
export const SILENCE_FLOOR = 0.01;

/**
 * The fourteen cue files `specs/assets.md` tabulates under The sound: the
 * thirteen one-shots and `hum`. The bed is its own point, so `music` is not
 * among them.
 */
export const CUE_FILES: readonly CueName[] = CUE_NAMES.filter(
  (cue) => cue !== "music",
);

/** One produced sound, decoded. */
export interface Sound {
  /** The path it is committed at, as `specs/assets.md` writes it. */
  file: string;
  sampleRate: number;
  /** Every channel's samples, on a full scale of `1`. */
  channels: Float32Array[];
  /** Sample frames per channel. */
  frames: number;
  /** `frames / sampleRate`, in seconds. */
  duration: number;
  /** The largest absolute sample in any channel. */
  peak: number;
}

/** What a read of a produced sound came back with: the sound, or why not. */
export interface SoundRead {
  /** The path asked for, as `specs/assets.md` writes it. */
  file: string;
  sound: Sound | null;
  reason: string | null;
}

/** The path a produced file is committed at, as `specs/assets.md` writes it. */
export function committedAudio(path: string): string {
  return `assets/${path}`;
}

/**
 * Read one produced sound, or report why it could not be read: the file is
 * absent, or its container is not one the engine's own decode can carry.
 *
 * `path` is written relative to the `assets/` root, as `CUE_PATHS` holds it.
 */
export function readSound(path: string): SoundRead {
  const file = committedAudio(path);
  const found = producedFile(path);
  if (found === null) return { file, sound: null, reason: `no file at ${file}` };
  let bytes: Buffer;
  try {
    bytes = readFileSync(found);
  } catch (error) {
    return { file, sound: null, reason: `${file} could not be read: ${why(error)}` };
  }
  if (bytes.length === 0) return { file, sound: null, reason: `${file} is empty` };
  let decoded: ReturnType<typeof decodeWav>;
  try {
    decoded = decodeWav(bytes);
  } catch (error) {
    return {
      file,
      sound: null,
      reason: `${file} did not decode as a WAV: ${why(error)}`,
    };
  }
  const channels = decoded.frames;
  const frames = channels[0]?.length ?? 0;
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const level = Math.abs(sample);
      if (level > peak) peak = level;
    }
  }
  return {
    file,
    sound: {
      file,
      sampleRate: decoded.sampleRate,
      channels,
      frames,
      duration: decoded.sampleRate === 0 ? 0 : frames / decoded.sampleRate,
      peak,
    },
    reason: null,
  };
}

/** Read several produced sounds, in the order they were named. */
export function readSounds(paths: readonly string[]): SoundRead[] {
  return paths.map((path) => readSound(path));
}

/** An error's message, for a `reason` line. */
function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the committed `.mid` beside the bed is a Standard MIDI File. */
export function midiHeader(path: string): string | null {
  const found = producedFile(path);
  if (found === null) return null;
  try {
    const bytes = readFileSync(found);
    return bytes.length < 4 ? "" : bytes.toString("ascii", 0, 4);
  } catch {
    return null;
  }
}

/** The `.mid` the bed is committed beside, as `specs/assets.md` writes it. */
export const MUSIC_SCORE_FILE = committedAudio(MUSIC_SCORE_PATH);

/** The path of the bed's `.wav`, relative to the `assets/` root. */
export const MUSIC_FILE_PATH = CUE_PATHS.music;

/** The two cues `specs/assets.md` authors to loop: `hum` and `music`. */
export const LOOPS: readonly CueName[] = LOOPING_CUES;

/**
 * Whether two decoded sounds hold identical samples: the same rate, the same
 * channel count, the same length, and every sample equal.
 */
export function sameSamples(a: Sound, b: Sound): boolean {
  if (a.sampleRate !== b.sampleRate) return false;
  if (a.channels.length !== b.channels.length) return false;
  if (a.frames !== b.frames) return false;
  for (let c = 0; c < a.channels.length; c += 1) {
    const left = a.channels[c];
    const right = b.channels[c];
    for (let i = 0; i < a.frames; i += 1) {
      if (left[i] !== right[i]) return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Evidence: what was read, drawn                                             */
/* -------------------------------------------------------------------------- */

const PAPER = "#0b0d12";
const INK = "#e8ecf2";
const DIM = "#8892a0";
const WAVE = "#5ac8fa";
const MARK = "#ff5a5a";

/** All channels mixed down, for a picture. The readings stay per-channel. */
export function monoMix(sound: Sound): Float32Array {
  const mono = new Float32Array(sound.frames);
  for (const channel of sound.channels) {
    for (let i = 0; i < sound.frames; i += 1) {
      mono[i] += channel[i] / sound.channels.length;
    }
  }
  return mono;
}

/** One run of samples drawn as a min/max envelope inside a rectangle. */
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
    let low = 0;
    let high = 0;
    for (let i = from; i < to && i < samples.length; i += 1) {
      if (samples[i] < low) low = samples[i];
      if (samples[i] > high) high = samples[i];
    }
    const top = mid - high * (h / 2);
    const bottom = mid - low * (h / 2);
    ctx.fillRect(x + column, top, 1, Math.max(1, bottom - top));
  }
}

/**
 * One row per file: the name, what its container reported, and its envelope —
 * or the reason it could not be read, so a point that failed still shows why.
 */
export function sheetOfSounds(
  reads: readonly SoundRead[],
  title: string,
): Canvas {
  const rowHeight = 46;
  const canvas = createCanvas(960, 44 + reads.length * rowHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";
  ctx.font = "14px sans-serif";
  ctx.fillStyle = INK;
  ctx.fillText(title, 16, 12);
  ctx.font = "12px monospace";
  reads.forEach((read, index) => {
    const y = 40 + index * rowHeight;
    ctx.fillStyle = INK;
    ctx.fillText(read.file, 16, y + 2);
    if (read.sound === null) {
      ctx.fillStyle = MARK;
      ctx.fillText(read.reason ?? "unreadable", 300, y + 2);
      return;
    }
    ctx.fillStyle = DIM;
    ctx.fillText(
      `${read.sound.duration.toFixed(3)} s · ${read.sound.sampleRate} Hz · ` +
        `${read.sound.channels.length} ch · peak ${read.sound.peak.toFixed(3)}`,
      300,
      y + 2,
    );
    envelope(ctx, monoMix(read.sound), 620, y, 324, rowHeight - 8);
  });
  return canvas;
}

/** The whole of one sound as an envelope, with its length written on it. */
export function waveformOf(sound: Sound, title: string): Canvas {
  const canvas = createCanvas(960, 220);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";
  ctx.font = "14px sans-serif";
  ctx.fillStyle = INK;
  ctx.fillText(title, 16, 12);
  ctx.font = "12px monospace";
  ctx.fillStyle = DIM;
  ctx.fillText(
    `${sound.duration.toFixed(3)} s · ${sound.sampleRate} Hz · ` +
      `${sound.channels.length} ch · peak ${sound.peak.toFixed(3)}`,
    16,
    32,
  );
  envelope(ctx, monoMix(sound), 16, 56, 928, 140);
  return canvas;
}

/**
 * The loop junction: the sound's final `windowSeconds` running into its first,
 * as the one continuous stretch a looping source plays, with the junction
 * marked and the per-channel step across it written out.
 */
export function seamOf(
  sound: Sound,
  title: string,
  windowSeconds: number,
): Canvas {
  const window = Math.min(
    Math.max(1, Math.round(windowSeconds * sound.sampleRate)),
    Math.floor(sound.frames / 2),
  );
  const mono = monoMix(sound);
  const joined = new Float32Array(window * 2);
  joined.set(mono.subarray(sound.frames - window, sound.frames), 0);
  joined.set(mono.subarray(0, window), window);
  const canvas = createCanvas(960, 240);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";
  ctx.font = "14px sans-serif";
  ctx.fillStyle = INK;
  ctx.fillText(title, 16, 12);
  envelope(ctx, joined, 16, 44, 928, 150);
  ctx.fillStyle = MARK;
  ctx.fillRect(16 + 464, 38, 2, 162);
  ctx.font = "12px monospace";
  ctx.fillText("end → start", 16 + 472, 204);
  ctx.fillStyle = DIM;
  ctx.fillText(`final ${windowSeconds}s`, 16, 204);
  const steps = sound.channels
    .map(
      (channel, index) =>
        `ch${index} ${Math.abs(channel[sound.frames - 1] - channel[0]).toFixed(5)}`,
    )
    .join("   ");
  ctx.fillText(steps, 16, 220);
  return canvas;
}
