// assets/sounds — the produced sound files this category reads, and the
// pictures it leaves behind. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. `specs/assets.md` fixes each
// cue's file by name — "Produce a distinct sound for each of the fourteen
// cues below, under exactly these file names", all under `assets/audio/` —
// and the bed at `assets/audio/music.wav` with its `assets/audio/music.mid`
// beside it. So the sound points read the files where they live, through
// `harness.ts`'s `readWav`, which walks the RIFF container and returns every
// channel's samples: the generation tools contract to write linear PCM, so
// every spelling they can emit is read, and a container carrying anything
// else is reported AS that rather than as a file with no sound in it.
//
// THE EVIDENCE. These points drive no game, so what they capture is a picture
// of what they read: the waveform of a file, the junction where its end runs
// into its start, or the table of readings a whole set came back with.
// Nothing painted here is read by an assertion.

import { assetFile, CUE_NAMES, CUE_PATHS, type CueName } from "../constants";
import { readWav, type DecodedWav, type Harness } from "../harness";

/** The fourteen cues that are sounds rather than the bed, in cue order. */
export const CUE_SOUNDS: readonly CueName[] = CUE_NAMES.filter(
  (cue) => cue !== "music",
);

/** The repository-relative file `specs/assets.md` lands cue `cue` at. */
export function cueFile(cue: CueName): string {
  return assetFile(CUE_PATHS[cue]);
}

/** What a read of a produced sound came back with: the samples, or why not. */
export interface SoundRead {
  cue: CueName;
  file: string;
  wav: DecodedWav | null;
  reason: string | null;
}

/** Read several produced cues, in the order they were named. */
export function readCues(cues: readonly CueName[]): SoundRead[] {
  return cues.map((cue) => {
    const file = cueFile(cue);
    const { wav, reason } = readWav(file);
    return { cue, file, wav, reason };
  });
}

/** The largest absolute sample in `channel` over `[from, to)`. */
function peakOver(channel: Float32Array, from: number, to: number): number {
  let peak = 0;
  for (let i = Math.max(0, from); i < Math.min(channel.length, to); i += 1) {
    const level = Math.abs(channel[i]);
    if (level > peak) peak = level;
  }
  return peak;
}

/** One line per sound, saying what its container reported. */
export function soundLines(reads: readonly SoundRead[]): string[] {
  return reads.map((read) => {
    if (read.wav === null) return `${read.file} — ${read.reason ?? "unread"}`;
    const { duration, sampleRate, channels, frames } = read.wav;
    let peak = 0;
    for (const channel of channels) {
      peak = Math.max(peak, peakOver(channel, 0, channel.length));
    }
    return (
      `${read.file} — ${duration.toFixed(3)} s, ${frames} frames, ` +
      `peak ${peak.toFixed(3)}, ${sampleRate} Hz x ${channels.length}`
    );
  });
}

/** The ground a sound picture is painted on, its ink, and its trace. */
const SOUND_GROUND = "#0b0d12";
const SOUND_INK = "#c9d4e4";
const SOUND_TRACE = "#7fd4c1";
const SOUND_RULE = "#39424f";

/** The margin around a sound picture, in device pixels. */
const SOUND_MARGIN = 48;

/** Fill the canvas and write a caption across its top. */
function openPicture(h: Harness, caption: string): void {
  const { ctx, canvas } = h;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SOUND_GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = SOUND_INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "18px monospace";
  ctx.fillText(caption, SOUND_MARGIN, SOUND_MARGIN / 2);
}

/**
 * The whole file drawn as a waveform: one vertical bar per column, spanning
 * the least and greatest sample that column covers, mixed across channels.
 */
export function showWaveform(
  h: Harness,
  caption: string,
  wav: DecodedWav,
): void {
  openPicture(h, caption);
  const { ctx, canvas } = h;
  const left = SOUND_MARGIN;
  const width = canvas.width - SOUND_MARGIN * 2;
  const middle = canvas.height / 2;
  const halfHeight = (canvas.height - SOUND_MARGIN * 3) / 2;
  ctx.strokeStyle = SOUND_RULE;
  ctx.beginPath();
  ctx.moveTo(left, middle);
  ctx.lineTo(left + width, middle);
  ctx.stroke();
  ctx.strokeStyle = SOUND_TRACE;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(wav.frames / width));
  for (let column = 0; column < width; column += 1) {
    const from = Math.floor((column / width) * wav.frames);
    let low = 0;
    let high = 0;
    for (let i = from; i < Math.min(from + step, wav.frames); i += 1) {
      for (const channel of wav.channels) {
        low = Math.min(low, channel[i]);
        high = Math.max(high, channel[i]);
      }
    }
    ctx.moveTo(left + column, middle - high * halfHeight);
    ctx.lineTo(left + column, middle - low * halfHeight);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The loop junction: the file's last samples on the left of a rule and its
 * first samples on the right, drawn end to end as a looping source plays
 * them, so the step across the seam is the step the picture shows.
 */
export function showSeam(
  h: Harness,
  caption: string,
  wav: DecodedWav,
  window: number,
): void {
  openPicture(h, caption);
  const { ctx, canvas } = h;
  const left = SOUND_MARGIN;
  const width = canvas.width - SOUND_MARGIN * 2;
  const middle = canvas.height / 2;
  const halfHeight = (canvas.height - SOUND_MARGIN * 3) / 2;
  const span = Math.min(window, Math.floor(wav.frames / 2));
  const shown = span * 2;
  ctx.strokeStyle = SOUND_RULE;
  ctx.beginPath();
  ctx.moveTo(left, middle);
  ctx.lineTo(left + width, middle);
  ctx.moveTo(left + width / 2, SOUND_MARGIN);
  ctx.lineTo(left + width / 2, canvas.height - SOUND_MARGIN);
  ctx.stroke();
  ctx.strokeStyle = SOUND_TRACE;
  ctx.beginPath();
  for (let i = 0; i < shown; i += 1) {
    // The tail first, then the head: the order a loop plays them in.
    const at = i < span ? wav.frames - span + i : i - span;
    let level = 0;
    for (const channel of wav.channels) level += channel[at];
    level /= Math.max(1, wav.channels.length);
    const x = left + (i / shown) * width;
    const y = middle - level * halfHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}
