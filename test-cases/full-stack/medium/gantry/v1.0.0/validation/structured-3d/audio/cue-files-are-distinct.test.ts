// audio/cue-wavs-distinct — the twelve produced sounds are twelve different
// sounds.
//
// specs/ui.md § Audio: "Each cue is a distinct sound." specs/assets.md § The sound
// says which files those are and where they live: "Produce one `.wav` per cue in
// `specs/ui.md`", "committed as `assets/audio/<cue>.wav`", with the music bed
// "committed as `assets/audio/music.wav`". So the deliverable is twelve files at
// twelve fixed paths, and "distinct" is a claim about the AUDIO in them: eleven
// cues a player can tell apart by ear, not one sound committed under several
// names.
//
// SO IT READS THE COMMITTED FILES AND COMPARES THEM, which is the only place the
// claim can be decided. Every one of the twelve is decoded to a mono waveform,
// scaled to its own peak — so a sound committed twice at two gains is still the
// same sound — and every pair is compared. Two files count as the same audio only
// when they carry the same number of frames at the same rate AND agree sample for
// sample; anything else is two sounds, whatever they were made with. The scaling
// is what keeps the reading honest in both directions: it will not let a
// duplicate through on a volume change, and it cannot call two genuinely
// different waveforms the same.
//
// NOTHING HERE IS ABOUT HOW A SOUND WAS MADE. specs/assets.md names a tool for
// each cue and a character for each, and none of that is measurable; what is
// measurable is that the twelve files are twelve different waveforms, which is
// what "each cue is a distinct sound" asks for at the file level.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertLength, fail } from "../assert";
import { CUES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The workspace: this suite sits at `<workspace>/validation/audio/`. */
const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The twelve produced sounds, at the paths specs/assets.md commits them to. */
const SOUNDS = [...CUES, "music"] as const;

/** How far apart two peak-scaled samples must be for the sounds to differ. */
const EPSILON = 1e-4;

/** One decoded sound: its rate, and its channels mixed down to one. */
interface Wave {
  rate: number;
  mono: Float64Array;
}

/** The `fmt ` chunk's fields this reading needs. */
interface Format {
  code: number;
  channels: number;
  rate: number;
  bits: number;
}

/** One sample of `bits` bits at `at`, brought into -1..1. */
function sampleAt(
  bytes: Buffer,
  at: number,
  bits: number,
  float: boolean,
): number {
  if (float) return bits === 64 ? bytes.readDoubleLE(at) : bytes.readFloatLE(at);
  if (bits === 8) return (bytes.readUInt8(at) - 128) / 128;
  if (bits === 16) return bytes.readInt16LE(at) / 32768;
  if (bits === 24) {
    const raw =
      bytes.readUInt8(at) |
      (bytes.readUInt8(at + 1) << 8) |
      (bytes.readInt8(at + 2) << 16);
    return raw / 8388608;
  }
  return bytes.readInt32LE(at) / 2147483648;
}

/** A committed `.wav`, decoded to one channel and scaled to its own peak. */
function readWave(name: string): Wave {
  const path = join(WORKSPACE, "assets", "audio", `${name}.wav`);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return fail(
      `a produced sound committed at assets/audio/${name}.wav ` +
        "(specs/assets.md)",
      "no such file",
    );
  }
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return fail(`assets/audio/${name}.wav to be a RIFF/WAVE file`, "it is not");
  }

  let format: Format | null = null;
  let data: Buffer | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    const end = Math.min(body + size, bytes.length);
    if (id === "fmt " && size >= 16) {
      let code = bytes.readUInt16LE(body);
      // WAVE_FORMAT_EXTENSIBLE carries the real code in its sub-format GUID.
      if (code === 0xfffe && size >= 40) code = bytes.readUInt16LE(body + 24);
      format = {
        code,
        channels: bytes.readUInt16LE(body + 2),
        rate: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = bytes.subarray(body, end);
    }
    at = body + size + (size % 2);
  }
  if (format === null || data === null) {
    return fail(
      `assets/audio/${name}.wav to carry a fmt and a data chunk`,
      `fmt: ${format === null ? "missing" : "present"}, data: ${
        data === null ? "missing" : "present"
      }`,
    );
  }
  const float = format.code === 3;
  if ((format.code !== 1 && !float) || format.channels < 1) {
    return fail(
      `assets/audio/${name}.wav to carry PCM audio`,
      `format code ${format.code}, ${format.channels} channels`,
    );
  }

  const width = format.bits / 8;
  const stride = width * format.channels;
  const frames = Math.floor(data.length / stride);
  const mono = new Float64Array(frames);
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += sampleAt(data, frame * stride + channel * width, format.bits, float);
    }
    const value = sum / format.channels;
    mono[frame] = value;
    const size = Math.abs(value);
    if (size > peak) peak = size;
  }
  if (peak > 0) for (let at = 0; at < frames; at += 1) mono[at]! /= peak;
  return { rate: format.rate, mono };
}

/** Whether two decoded sounds are the same audio. */
function sameAudio(one: Wave, other: Wave): boolean {
  if (one.rate !== other.rate || one.mono.length !== other.mono.length) {
    return false;
  }
  for (let at = 0; at < one.mono.length; at += 1) {
    if (Math.abs(one.mono[at]! - other.mono[at]!) > EPSILON) return false;
  }
  return true;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("commits a different sound for every cue and for the music bed", async () => {
  // The picture is taken before the waveforms are compared: what it shows is the
  // yard the sounds are heard over, which is the same yard whether they differ or
  // not, so a comparison that fails still leaves it behind.
  await openSite(h, 0);
  await h.advance(1);
  await h.capture("files", "The yard the produced sounds are heard over");

  const waves = SOUNDS.map((name) => ({ name, wave: readWave(name) }));
  assertLength(
    waves,
    CUES.length + 1,
    "the produced sounds read: one per cue in specs/ui.md, and the music bed " +
      "(specs/assets.md)",
  );

  const same: string[] = [];
  for (let one = 0; one < waves.length; one += 1) {
    for (let other = one + 1; other < waves.length; other += 1) {
      if (sameAudio(waves[one]!.wave, waves[other]!.wave)) {
        same.push(`${waves[one]!.name} = ${waves[other]!.name}`);
      }
    }
  }
  if (same.length > 0) {
    fail(
      `the ${waves.length} produced sounds to be ${waves.length} different ` +
        "waveforms: each cue is a distinct sound (specs/ui.md)",
      `these carry the same audio: ${same.join(", ")}`,
    );
  }
});
