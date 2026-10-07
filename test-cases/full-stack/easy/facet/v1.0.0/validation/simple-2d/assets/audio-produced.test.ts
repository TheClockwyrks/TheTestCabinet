// assets/audio-produced — the produced sounds and music ship, and none of them
// is silence.
//
// specs/assets.md puts every sound the game plays under `public/assets/audio/`,
// produced by three of the six tools, and names exactly what has to be there:
// `sfx-synth` produces the `select`, `swap`, `refuse`, `land`, `flaw`, `cut`,
// `levelup` and `gameover` cues, and "also produces the chain ladder:
// `MAX_MULTIPLIER` (`8`) tones of one timbre"; `sfx-sample` produces "the shatter
// body"; and `music` produces "two pieces: a title theme with a hook, and a
// slower play bed". Eight plus eight plus one plus two is the count below, and it
// is the specification's arithmetic rather than a figure read off any build.
//
// WHY DISTINCTNESS IS PART OF THE CONTRACT. The ladder is eight tones ASCENDING
// IN PITCH, and each cue has "its own character" — flat and dead for a refusal,
// "a low settling knock" for a landing, rising for a level-up, falling for a
// game-over. A build that renders one tone and ships eight copies of it under
// eight names has produced one sound, so the count here is of distinct PCM
// payloads and not of files: two names over the same bytes count once.
//
// WHY SILENCE IS PART OF THE CONTRACT. specs/assets.md says outright that a
// build that "plays silence or a hand-oscillated Web Audio stand-in in place of
// produced audio has not met this contract", so a `.wav` that decodes to an
// empty waveform is not a produced sound. Each file is decoded to PCM here and
// held to a silence floor far below anything a listener would call audible, so
// what fails it is a file carrying no sound at all rather than a quiet one.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. Which file is which. specs/assets.md
// fixes no filenames and no directory layout below `assets/audio/`, so the tree
// is walked whole and nothing here reads a name; it decides that the sounds
// EXIST and carry sound. The `.mid` scores `music` emits beside its `.wav`s are
// not assets the game plays ("play the `.wav`") and are passed over. Whether the
// build reaches for them at run time is `assets/fx-systems-loaded`'s and
// `assets/no-external-fetch`'s business, not this file's.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { it } from "vitest";
import { assertGreaterThanOrEqual, assertNotNull, assertTrue } from "../assert";
import {
  AUDIO_DIR,
  MAX_MULTIPLIER,
  MUSIC_PIECES,
  SAMPLED_BODIES,
  SYNTH_CUES,
} from "../constants";
import { mediaDestination, siteRoot } from "../harness";

/**
 * How many distinct sounds the specification asks for, added up from its own
 * four sentences rather than counted off a build.
 */
const REQUIRED_SOUNDS =
  SYNTH_CUES.length + MAX_MULTIPLIER + SAMPLED_BODIES + MUSIC_PIECES;

/**
 * The silence floor, as RMS on a full-scale of 1.
 *
 * About -46 dBFS: three orders of magnitude below a rendered cue's own level and
 * still comfortably above the last bit of a 16-bit dither, so the only thing it
 * separates is sound from no sound. A cue mixed quietly is a choice this file
 * does not review.
 */
const SILENCE_RMS = 0.005;

/** The window the floor is measured over, so a sound needs a REGION and not a spike. */
const WINDOW_SECONDS = 0.01;

/** How many waveforms the evidence image holds, and how big each band is. */
const PLOT_LIMIT = 40;
const PLOT_WIDTH = 880;
const PLOT_BAND = 34;

/** One produced sound, as the file names it and as its PCM reads. */
interface Sound {
  /** The path below the served `assets/` root, as the page would name it. */
  name: string;
  /** Why it is not a produced sound, or `null` when it is one. */
  rejected: string | null;
  /** The digest of its PCM payload, so two names over one sound count once. */
  digest: string;
  /** The loudest window in it, as RMS. */
  loudest: number;
  /** Its samples, interleaved, for the evidence image. */
  samples: Float32Array;
}

/** The four characters a RIFF chunk is identified by. */
function fourCC(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

/** One sample as a number in -1..1, for the encodings a `.wav` carries PCM in. */
function sampleAt(
  view: DataView,
  at: number,
  format: number,
  bits: number,
): number {
  if (format === 3) {
    return bits === 64 ? view.getFloat64(at, true) : view.getFloat32(at, true);
  }
  if (bits === 8) return (view.getUint8(at) - 128) / 128;
  if (bits === 16) return view.getInt16(at, true) / 32_768;
  if (bits === 24) {
    const low = view.getUint8(at);
    const mid = view.getUint8(at + 1);
    const high = view.getInt8(at + 2);
    return ((high << 16) | (mid << 8) | low) / 8_388_608;
  }
  return view.getInt32(at, true) / 2_147_483_648;
}

/** A decoded `.wav`, or the sentence saying why it is not one. */
type Decoded =
  | {
      pcm: true;
      channels: number;
      sampleRate: number;
      samples: Float32Array;
      payload: Uint8Array;
    }
  | { pcm: false; why: string };

/**
 * Walk a `.wav`'s chunks and decode its PCM.
 *
 * Chunk-walked rather than read at fixed offsets, because a rendered `.wav` is
 * entitled to carry a `LIST`, a `fact` or a `cue ` chunk between its header and
 * its samples, and a decoder that assumed `data` at byte 44 would call a
 * perfectly good file broken.
 */
function decodeWav(bytes: Uint8Array): Decoded {
  if (bytes.byteLength < 12)
    return { pcm: false, why: "shorter than a RIFF header" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourCC(view, 0) !== "RIFF") return { pcm: false, why: "no RIFF header" };
  if (fourCC(view, 8) !== "WAVE") return { pcm: false, why: "not a WAVE file" };

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: { at: number; length: number } | null = null;

  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const id = fourCC(view, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= bytes.byteLength) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE states the real encoding in its sub-format GUID,
      // whose first two bytes are the format tag the rest of this reads.
      if (format === 0xfffe && body + 26 <= bytes.byteLength) {
        format = view.getUint16(body + 24, true);
      }
    } else if (id === "data") {
      data = { at: body, length: Math.min(size, bytes.byteLength - body) };
    }
    // Chunks are padded to an even length, and the pad byte is not counted in
    // the size — so a walk that ignored it would land one byte short of the next.
    at = body + size + (size % 2);
  }

  if (data === null) return { pcm: false, why: "no data chunk" };
  if (format !== 1 && format !== 3) {
    return { pcm: false, why: `a compressed encoding (format ${format})` };
  }
  if (![8, 16, 24, 32, 64].includes(bits) || (format === 3 && bits < 32)) {
    return { pcm: false, why: `an unreadable sample width (${bits} bits)` };
  }
  if (channels < 1 || sampleRate < 1)
    return { pcm: false, why: "no fmt chunk" };

  const width = bits / 8;
  const count = Math.floor(data.length / width);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = sampleAt(view, data.at + i * width, format, bits);
  }
  return {
    pcm: true,
    channels,
    sampleRate,
    samples,
    payload: bytes.subarray(data.at, data.at + data.length),
  };
}

/** The loudest window in a decoded sound, as RMS on a full-scale of 1. */
function loudestWindow(
  samples: Float32Array,
  channels: number,
  sampleRate: number,
): number {
  const span = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS)) * channels;
  let loudest = 0;
  for (let start = 0; start < samples.length; start += span) {
    const end = Math.min(start + span, samples.length);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    if (rms > loudest) loudest = rms;
  }
  return loudest;
}

/** Every `.wav` under a directory, at any depth, named by its path below it. */
function findWavs(root: string): { path: string; name: string }[] {
  const found: { path: string; name: string }[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, `${prefix}${entry.name}/`);
      else if (entry.name.toLowerCase().endsWith(".wav")) {
        found.push({ path, name: `${prefix}${entry.name}` });
      }
    }
  };
  visit(root, "");
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read one file and say everything this check wants to know about it. */
function readSound(file: { path: string; name: string }): Sound {
  const bytes = new Uint8Array(readFileSync(file.path));
  const decoded = decodeWav(bytes);
  if (!decoded.pcm) {
    return {
      name: file.name,
      rejected: decoded.why,
      digest: "",
      loudest: 0,
      samples: new Float32Array(0),
    };
  }
  const loudest = loudestWindow(
    decoded.samples,
    decoded.channels,
    decoded.sampleRate,
  );
  return {
    name: file.name,
    rejected:
      loudest >= SILENCE_RMS
        ? null
        : `silence (loudest ${WINDOW_SECONDS * 1000} ms window is ${loudest.toFixed(6)} RMS)`,
    digest: createHash("sha256").update(decoded.payload).digest("hex"),
    loudest,
    samples: decoded.samples,
  };
}

/**
 * Draw every waveform the check read into one picture, as the item's evidence.
 *
 * Reviewer-facing only: it asserts nothing, and it writes nothing at all unless
 * the run is collecting media.
 */
function writeWaveforms(sounds: readonly Sound[]): void {
  const destination = mediaDestination("waveforms", "png");
  if (destination === null) return;
  const drawn = sounds.slice(0, PLOT_LIMIT);
  const canvas = createCanvas(
    PLOT_WIDTH,
    Math.max(1, drawn.length) * PLOT_BAND,
  );
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111318";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawn.forEach((sound, band) => {
    const top = band * PLOT_BAND;
    const middle = top + PLOT_BAND / 2;
    ctx.fillStyle = "#2a2f3a";
    ctx.fillRect(0, middle, PLOT_WIDTH, 1);
    ctx.fillStyle = sound.rejected === null ? "#7fd6a2" : "#e0655f";
    const per = Math.max(1, sound.samples.length / PLOT_WIDTH);
    for (let column = 0; column < PLOT_WIDTH; column += 1) {
      const from = Math.floor(column * per);
      const to = Math.min(sound.samples.length, Math.floor((column + 1) * per));
      let low = 0;
      let high = 0;
      for (let i = from; i < to; i += 1) {
        if (sound.samples[i] < low) low = sound.samples[i];
        if (sound.samples[i] > high) high = sound.samples[i];
      }
      const scale = (PLOT_BAND / 2 - 2) * -1;
      const y0 = middle + high * scale;
      const y1 = middle + low * scale;
      ctx.fillRect(column, y0, 1, Math.max(1, y1 - y0));
    }
  });
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

it("ships at least the sounds and music the production contract lists", () => {
  const root = siteRoot();
  assertNotNull(root, "the built site on disk");
  const audio = join(root as string, ...AUDIO_DIR);
  assertTrue(existsSync(audio), `a produced ${AUDIO_DIR.join("/")}/ directory`);

  const sounds = findWavs(audio).map(readSound);
  writeWaveforms(sounds);

  // Two names over one payload are one sound, and a file that decodes to
  // nothing audible is not a produced sound at all — so what is counted is the
  // set of distinct payloads that carry sound.
  const carrying = sounds.filter((sound) => sound.rejected === null);
  const distinct = new Set(carrying.map((sound) => sound.digest));

  assertGreaterThanOrEqual(
    distinct.size,
    REQUIRED_SOUNDS,
    `distinct non-silent .wav files under ${AUDIO_DIR.join("/")}/ — ${
      sounds.length
    } found, ${carrying.length} carrying sound${
      sounds.length === carrying.length
        ? ""
        : `, rejected: ${sounds
            .filter((sound) => sound.rejected !== null)
            .map((sound) => `${sound.name} (${sound.rejected})`)
            .join("; ")}`
    }`,
  );
});
