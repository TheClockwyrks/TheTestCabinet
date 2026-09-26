// Arc Foundry — reading a produced cue off disk. CASE-PROVIDED.
//
// `specs/assets.md` fixes twelve `.wav` files under `assets/audio/`, one per cue of
// `specs/ui.md`, and says how each is made: "`sfx-synth`, `sfx-sample`, and `music`
// render a PCM `.wav`." So the two points that read the files decode them as PCM
// and read the samples out — the presence point to show that a cue is bound to a
// sound rather than to silence, and the distinctness point to show that eleven
// events are told apart by eleven sounds.
//
// WHAT IS DECODED. A RIFF/WAVE container's `fmt ` and `data` chunks, walked rather
// than assumed to sit at fixed offsets, and integer PCM at 8, 16, 24 or 32 bits or
// IEEE float at 32, which is every shape the three tools can render and every shape
// a browser will decode. Samples come back normalized to `-1 .. 1` so a cue's peak
// is a figure independent of its bit depth.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../assert";

/** `assets/` at the root of the produced repository, as `specs/assets.md` fixes it. */
export const ASSETS = fileURLToPath(new URL("../../assets/", import.meta.url));

/** One decoded cue file. */
export interface Wave {
  /** The path under `assets/`, as the specification names it. */
  readonly at: string;
  readonly channels: number;
  readonly sampleRate: number;
  /** Every sample of every channel, interleaved, normalized to `-1 .. 1`. */
  readonly samples: Float32Array;
}

/** The path `specs/assets.md` fixes for one cue, under `assets/`. */
export function fileOf(cue: string): string {
  return `audio/${cue}.wav`;
}

/** Whether a produced file is on disk. */
export function present(at: string): boolean {
  return existsSync(ASSETS + at);
}

interface Chunk {
  id: string;
  start: number;
  size: number;
}

/** The RIFF chunks of a WAVE container, walked from the header. */
function chunks(bytes: Buffer): Chunk[] {
  const out: Chunk[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    out.push({ id, start: at + 8, size });
    at += 8 + size + (size % 2);
  }
  return out;
}

/** One produced cue file, decoded, or a failure naming the path and the fault. */
export function readWave(at: string): Wave {
  if (!present(at)) {
    return fail(
      `assets/${at} to be a produced cue rendered as a PCM .wav ` +
        `(specs/assets.md)`,
      "it is not on disk",
    );
  }
  const bytes = readFileSync(ASSETS + at);
  const bad = (what: string): never =>
    fail(
      `assets/${at} to decode as PCM audio (specs/assets.md)`,
      `it is on disk and ${what}`,
    );

  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return bad("is not a RIFF/WAVE container");
  }
  const found = chunks(bytes);
  const format = found.find((chunk) => chunk.id === "fmt ");
  const data = found.find((chunk) => chunk.id === "data");
  if (format === undefined) return bad("carries no `fmt ` chunk");
  if (data === undefined) return bad("carries no `data` chunk");

  const audioFormat = bytes.readUInt16LE(format.start);
  const channels = bytes.readUInt16LE(format.start + 2);
  const sampleRate = bytes.readUInt32LE(format.start + 4);
  const bits = bytes.readUInt16LE(format.start + 14);
  const bytesPer = Math.floor(bits / 8);
  if (channels < 1 || sampleRate < 1 || bytesPer < 1) {
    return bad(
      `declares ${channels} channels at ${sampleRate} Hz and ${bits} bits`,
    );
  }

  const end = Math.min(bytes.length, data.start + data.size);
  const count = Math.floor((end - data.start) / bytesPer);
  const samples = new Float32Array(Math.max(0, count));
  for (let i = 0; i < samples.length; i += 1) {
    const at2 = data.start + i * bytesPer;
    if (audioFormat === 3 && bits === 32) {
      samples[i] = bytes.readFloatLE(at2);
    } else if (audioFormat === 1 || audioFormat === 0xfffe) {
      if (bits === 8) samples[i] = (bytes.readUInt8(at2) - 128) / 128;
      else if (bits === 16) samples[i] = bytes.readInt16LE(at2) / 32768;
      else if (bits === 24) {
        const raw = bytes.readIntLE(at2, 3);
        samples[i] = raw / 8388608;
      } else if (bits === 32) samples[i] = bytes.readInt32LE(at2) / 2147483648;
      else return bad(`declares ${bits}-bit PCM, which is not a PCM depth`);
    } else {
      return bad(`declares audio format ${audioFormat}, which is not PCM`);
    }
  }
  return { at, channels, sampleRate, samples };
}

/** The loudest sample of a cue, `0` to `1`. */
export function peak(wave: Wave): number {
  let loudest = 0;
  for (const sample of wave.samples) {
    const level = Math.abs(sample);
    if (level > loudest) loudest = level;
  }
  return loudest;
}

/** How long a decoded cue sounds for, in seconds. */
export function durationSeconds(wave: Wave): number {
  return wave.samples.length / wave.channels / wave.sampleRate;
}

/** Whether two decoded cues are the same audio, sample for sample. */
export function identical(a: Wave, b: Wave): boolean {
  if (a.samples.length !== b.samples.length) return false;
  if (a.channels !== b.channels || a.sampleRate !== b.sampleRate) return false;
  for (let i = 0; i < a.samples.length; i += 1) {
    if (a.samples[i] !== b.samples[i]) return false;
  }
  return true;
}
