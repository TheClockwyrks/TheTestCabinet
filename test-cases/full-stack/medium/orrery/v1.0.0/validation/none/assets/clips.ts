// assets/clips — the produced sounds decoded as waveforms: telling two clips
// apart, and the picture the points that compare them leave.
//
// A PRIVATE MODULE OF THIS DIRECTORY, named for the thing it decodes rather than
// for a review item, and no manifest entry points at it. IT ASSERTS NOTHING: it
// decodes what it is handed and reports what it found, and the suite that called
// it decides the point. It is the same text in all three projects, like
// everything here that is not `harness.ts` or `surface.ts`.
//
// WHY IT SITS BESIDE `sounds.ts` AND `bed-audio.ts`. The case-provided `sounds.ts`
// reads a cue's CONTAINER — its length, its rate, its peak — which is all the
// points about a cue's existence, its decoding and its level need. One point needs
// the SAMPLES: "Produce a distinct sound for each of the six one-shot cues"
// (`specs/assets.md`), and a clip shipped twice under two names is the same
// samples. `bed-audio.ts` already decodes a `.wav` to its channels for the bed's
// sake, so this module is the comparison and the picture over that decode, and
// nothing is decoded twice by two readers.

import { createCanvas } from "@napi-rs/canvas";
import { WORKSPACE, writeImageBytes } from "../media";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeWav, paintWaveform, type DecodedWav } from "./bed-audio";

/**
 * How far two samples may differ and still be the same sample: one step of a
 * sixteen-bit container.
 *
 * A PCM `.wav` carries its samples exactly, so one clip shipped under two names
 * is the same numbers under both. What this tolerance is for is the one honest
 * way two files can hold the same clip and not the same numbers — the same
 * material written at two bit depths — which is still one clip shipped twice.
 */
export const SAMPLE_EPSILON = 1 / 32768;

/** What decoding one produced clip came back with: the samples, or why not. */
export interface ClipRead {
  /** The path `specs/assets.md` fixes for it, relative to the repository root. */
  file: string;
  /** A short name for a failure message, so one sweep tells its cases apart. */
  label: string;
  /** The decoded channels, or `null` where the file could not be decoded. */
  clip: DecodedWav | null;
  /** Why not, worded for the point to fail with. */
  reason: string | null;
}

/** Decode one produced clip, or report why it could not be decoded. */
export function readClip(label: string, file: string): ClipRead {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(WORKSPACE, file));
  } catch {
    return { file, label, clip: null, reason: `no file at ${file}` };
  }
  if (bytes.length === 0) {
    return { file, label, clip: null, reason: `${file} is empty` };
  }
  try {
    return { file, label, clip: decodeWav(bytes), reason: null };
  } catch (error) {
    return {
      file,
      label,
      clip: null,
      reason: `${file} does not decode as a WAV: ${String(error)}`,
    };
  }
}

/**
 * Whether two decoded clips are the same clip: the same channels, the same
 * length, and the same samples to within {@link SAMPLE_EPSILON}.
 *
 * Deliberately blind to the container. What a point about six distinct sounds is
 * asking is whether a player hears six sounds, and a file rewritten at another
 * rate or depth carrying the same material is still one sound; what the reading
 * below can honestly see of that is the samples, so a re-sampled copy is reported
 * as a different clip and a re-encoded one as the same.
 */
export function sameClip(a: DecodedWav, b: DecodedWav): boolean {
  if (a.channels.length !== b.channels.length) return false;
  if (a.frames !== b.frames) return false;
  for (let channel = 0; channel < a.channels.length; channel += 1) {
    const left = a.channels[channel];
    const right = b.channels[channel];
    for (let frame = 0; frame < a.frames; frame += 1) {
      if (Math.abs(left[frame] - right[frame]) > SAMPLE_EPSILON) return false;
    }
  }
  return true;
}

/**
 * The clips stacked one above another as waveforms, each labelled with what was
 * read off it, and kept as the review item's `outputId` output.
 *
 * A clip that would not decode leaves its row carrying the reason, so a failing
 * point leaves the picture that shows why. Nothing painted here is read by an
 * assertion.
 */
export function showClips(outputId: string, reads: readonly ClipRead[]): void {
  const panels = reads.map((read) =>
    read.clip === null
      ? null
      : paintWaveform(`${read.label} — ${read.file}`, read.clip),
  );
  const width = 960;
  const height = 260;
  const canvas = createCanvas(width, Math.max(1, reads.length) * height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  reads.forEach((read, index) => {
    const panel = panels[index];
    if (panel !== null) {
      ctx.drawImage(panel as unknown as never, 0, index * height);
      return;
    }
    ctx.fillStyle = "#ff5a5a";
    ctx.font = "15px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `${read.label} — ${read.reason ?? "unread"}`,
      16,
      index * height + height / 2,
    );
  });
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}
