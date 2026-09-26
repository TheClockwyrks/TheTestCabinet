// audio — reading the produced sound files off the workspace, and posing the
// round each one belongs to. CASE-PROVIDED.
//
// NOT a `.test.ts`, so vitest never collects it: it is the shared reading half of
// the six `audio/*-produced` and duration points, which are about FILES rather
// than about a drive. `specs/assets.md` fixes each cue's path and which binary
// makes it, and `specs/ui.md` fixes the event it plays on, so those six read the
// file on disk and the five `*-cue-plays` points next door read the game.
//
// WHY THE PAGE DECODES THEM. `.wav` is a container, and `sfx-synth`, `sfx-sample`
// and `music` are free to write any of its several sample formats — sixteen-bit
// integers, twenty-four, thirty-two-bit floats — at any rate, in mono or stereo.
// `specs/assets.md` fixes none of that: it fixes the sound. A decoder written
// here would have to cover every format or it would fail a build whose generator
// happened to emit another, which is exactly the failure the guide names as worse
// than no validator at all. The browser these checks already hold decodes all of
// them, so the bytes are read in Node and decoded through an `OfflineAudioContext`
// — offline because decoding is all that is wanted, and an offline context needs
// no user gesture to open.
//
// The RIFF header is still read here, because "decodes as a WAV" is part of what
// the points claim and a browser would happily decode an MP3 that had been given
// a `.wav` name.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { poseScene, type Harness, type Scene } from "../harness";

/**
 * The root of the repository the build produced.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place in both layouts this project lives in: the case's own
 * `validation/none/audio/`, and the `validation/audio/` the runner stages it to
 * inside the build's tree. Two levels up is the workspace either way.
 */
const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
);

/** One produced sound, as the browser decoded it. */
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

/** The bytes of a produced file, or `null` where the build shipped none. */
export function soundBytes(file: string): Buffer | null {
  try {
    return readFileSync(join(WORKSPACE_ROOT, file));
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

/**
 * Decode a produced sound in the page, or report why it could not be decoded.
 *
 * A file that is absent, that is not a WAV, or that the browser will not decode
 * comes back as a `reason` for the point to fail with; the check owns the
 * wording of that failure, because it is the check that knows what it was
 * looking for.
 */
export async function decodeSound(
  h: Harness,
  file: string,
): Promise<{ sound: Sound | null; reason: string | null }> {
  const bytes = soundBytes(file);
  if (bytes === null) return { sound: null, reason: `no file at ${file}` };
  if (bytes.length === 0) return { sound: null, reason: `${file} is empty` };
  if (!isRiffWave(bytes)) {
    return { sound: null, reason: `${file} is not a RIFF/WAVE file` };
  }

  const decoded = await h.page.evaluate(async (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const context = new OfflineAudioContext(1, 1, 44100);
    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(bytes.buffer);
    } catch {
      return null;
    }
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i += 1) {
        const level = Math.abs(samples[i]);
        if (level > peak) peak = level;
      }
    }
    return {
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      frames: buffer.length,
      peak,
    };
  }, bytes.toString("base64"));

  if (decoded === null) {
    return { sound: null, reason: `${file} did not decode as audio` };
  }
  return { sound: { file, ...decoded }, reason: null };
}

/** Decode several produced sounds, in the order they were named. */
export async function decodeSounds(
  h: Harness,
  files: readonly string[],
): Promise<{ sound: Sound | null; reason: string | null }[]> {
  const read = [];
  for (const file of files) read.push(await decodeSound(h, file));
  return read;
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
  await poseScene(h, scene);
  await h.advance(1);
}
