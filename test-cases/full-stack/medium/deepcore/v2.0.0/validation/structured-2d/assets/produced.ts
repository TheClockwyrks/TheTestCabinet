// Deepcore — reading the files the build produced, off disk. CASE-PROVIDED.
//
// `specs/assets.md` is a contract about FILES: every sprite, animation, particle
// system and sound the game plays is produced with the six tools, committed to
// this repository, and landed under `assets/` at an exact path. So the points
// about what was produced read the files themselves rather than inferring them
// from a frame — a build that draws a rectangle where a sprite belongs is caught
// by the sprite not being there, and one whose eight miner cycles are eight
// copies of one drawing is caught by the frames being equal.
//
// WHERE THE FILES ARE. The validator project's root is the workspace — the
// directory the build was produced in and `npm run build` ran from — which is this
// module's grandparent whichever of the two layouts the project is running in.
// `assets/` under it is the path `specs/assets.md` states, verbatim.
//
// HOW A PNG IS READ. Through `@napi-rs/canvas`, which is the decoder the harness
// already stands the produced sprites up with and the one the same canvas draws
// them from, so a file this module refuses is a file the build could not have
// drawn either. What comes back is the size, whether any pixel is transparent, and
// a small fixed-size signature of the picture. The signature is what "no two
// frames are identical" is decided on, and averaging each cell of a coarse grid
// keeps it a statement about the DRAWING rather than about one antialiased pixel.
//
// HOW A SOUND IS READ. By parsing the RIFF/WAVE container `specs/assets.md` states
// every produced sound lands in and walking its samples. Node has no Web Audio, so
// there is no browser decoder to hand the bytes to; what a check needs from one is
// the length and the loudest sample, and both are in the file. The two encodings a
// `.wav` writer emits — integer PCM and IEEE float — are read sample by sample; any
// other is reported as its own fault rather than being mistaken for silence.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** The workspace the build was produced in: this project's parent. */
const WORKSPACE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Where `specs/assets.md` says every produced file lands. */
export const ASSETS_ROOT = join(WORKSPACE_ROOT, "assets");

/** A produced file's absolute path, from the path `specs/assets.md` states. */
export function producedPath(...parts: readonly string[]): string {
  return join(ASSETS_ROOT, ...parts);
}

/** Whether a produced file is there at all. */
export function produced(...parts: readonly string[]): boolean {
  return existsSync(producedPath(...parts));
}

/** The names in one produced directory, sorted, or none where there is no such directory. */
export function producedNames(...parts: readonly string[]): string[] {
  const at = producedPath(...parts);
  if (!existsSync(at)) return [];
  return readdirSync(at).sort();
}

/**
 * The frames of a cycle laid out as `specs/assets.md` states: `frameNN.png`,
 * numbered from `frame00.png`, in order.
 *
 * Numbered names sorted as strings happen to be in order too, but the run is
 * walked from `00` rather than taking whatever the directory holds, so a stray
 * file cannot pad the count and a gap ends the cycle where it actually ends.
 */
export function cycleFrames(...parts: readonly string[]): string[] {
  const frames: string[] = [];
  for (let n = 0; ; n += 1) {
    const name = `frame${String(n).padStart(2, "0")}.png`;
    if (!produced(...parts, name)) return frames;
    frames.push(join(...parts, name));
  }
}

/* -------------------------------------------------------------------------- */
/* Pictures                                                                   */
/* -------------------------------------------------------------------------- */

/** How coarse a picture's signature is, per side. */
const SIGNATURE_CELLS = 24;

/** What a decoded picture reports. */
export interface Picture {
  width: number;
  height: number;
  /** Whether any pixel is less than fully opaque. */
  transparent: boolean;
  /** Whether any pixel is not fully transparent. */
  drawn: boolean;
  /** A coarse average of the picture, as `r`, `g`, `b`, `a` per cell. */
  signature: number[];
}

/**
 * Decode one produced PNG and report what it holds.
 *
 * `null` where the file is not there, so a check can say "missing" rather than
 * failing on a read.
 */
export async function readPicture(
  ...parts: readonly string[]
): Promise<Picture | null> {
  const path = producedPath(...parts);
  if (!existsSync(path)) return null;
  const image = await loadImage(readFileSync(path));
  const width = image.width;
  const height = image.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  const cells = SIGNATURE_CELLS;
  const sums = new Float64Array(cells * cells * 4);
  const counts = new Float64Array(cells * cells);
  let transparent = false;
  let drawn = false;
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(cells - 1, Math.floor((y / height) * cells));
    for (let x = 0; x < width; x += 1) {
      const col = Math.min(cells - 1, Math.floor((x / width) * cells));
      const at = (y * width + x) * 4;
      const cell = (row * cells + col) * 4;
      sums[cell] += data[at];
      sums[cell + 1] += data[at + 1];
      sums[cell + 2] += data[at + 2];
      sums[cell + 3] += data[at + 3];
      counts[row * cells + col] += 1;
      if (data[at + 3] < 255) transparent = true;
      if (data[at + 3] > 0) drawn = true;
    }
  }
  const signature: number[] = [];
  for (let cell = 0; cell < cells * cells; cell += 1) {
    const n = Math.max(1, counts[cell]);
    for (let channel = 0; channel < 4; channel += 1) {
      signature.push(sums[cell * 4 + channel] / n);
    }
  }
  return { width, height, transparent, drawn, signature };
}

/** Decode a run of produced PNGs, dropping the ones that are not there. */
export async function readPictures(
  paths: readonly (readonly string[] | string)[],
): Promise<Picture[]> {
  const pictures: Picture[] = [];
  for (const path of paths) {
    const picture = await readPicture(
      ...(typeof path === "string" ? [path] : path),
    );
    if (picture !== null) pictures.push(picture);
  }
  return pictures;
}

/**
 * How far apart two pictures are, averaged over every channel of every cell.
 *
 * `0` for two copies of one drawing. Two drawings a person would call different
 * are several units apart at least, because a signature cell averages a
 * twenty-fourth of the picture and a change anywhere inside one moves it.
 */
export function pictureDistance(a: Picture, b: Picture): number {
  const count = Math.min(a.signature.length, b.signature.length);
  if (count === 0) return 0;
  let total = 0;
  for (let at = 0; at < count; at += 1) {
    total += Math.abs(a.signature[at] - b.signature[at]);
  }
  return total / count;
}

/**
 * How far apart two pictures must be to count as different drawings.
 *
 * Two copies of one file are exactly `0`, and a signature averages away a stray
 * pixel, so this only has to sit above the rounding a decode can introduce.
 */
export const PICTURE_DISTINCT = 0.5;

/**
 * How many different drawings a set of pictures holds.
 *
 * A cycle is free to come back on itself — an `A, B, A` bob and an `A, B, A, B`
 * brace are both ordinary animations, and both ship a frame that equals an
 * earlier one — so what says a cycle animates is how many DRAWINGS it carries
 * rather than whether any two of its files match.
 */
export function distinctCount(pictures: readonly Picture[]): number {
  const kept: Picture[] = [];
  for (const picture of pictures) {
    const seen = kept.some(
      (other) => pictureDistance(picture, other) <= PICTURE_DISTINCT,
    );
    if (!seen) kept.push(picture);
  }
  return kept.length;
}

/** Whether every one of a set of pictures is a different drawing from the rest. */
export function allDistinct(pictures: readonly Picture[]): boolean {
  for (const [at, one] of pictures.entries()) {
    for (const other of pictures.slice(at + 1)) {
      if (pictureDistance(one, other) <= PICTURE_DISTINCT) return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Sounds                                                                     */
/* -------------------------------------------------------------------------- */

/** What a decoded sound reports. */
export interface Sound {
  seconds: number;
  channels: number;
  /** The loudest sample anywhere in it, `0` to `1`. */
  peak: number;
}

/** A four-character RIFF chunk id at `at`. */
function chunkId(bytes: Buffer, at: number): string {
  return bytes.toString("ascii", at, at + 4);
}

/**
 * Decode one produced `.wav` and report what it holds.
 *
 * `null` where the file is not there. A file that is not a RIFF/WAVE document, or
 * whose sample encoding this reader does not carry, throws with what is wrong —
 * which a check reports as its own fault rather than as silence.
 */
export function readSound(...parts: readonly string[]): Sound | null {
  const path = producedPath(...parts);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  if (bytes.length < 12 || chunkId(bytes, 0) !== "RIFF") {
    throw new Error("not a RIFF document");
  }
  if (chunkId(bytes, 8) !== "WAVE") throw new Error("not a WAVE document");

  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: Buffer | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = chunkId(bytes, at);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    const end = Math.min(bytes.length, body + size);
    if (id === "fmt " && size >= 16) {
      format = bytes.readUInt16LE(body);
      channels = bytes.readUInt16LE(body + 2);
      rate = bytes.readUInt32LE(body + 4);
      bits = bytes.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE carries the real encoding in its sub-format's
      // first two bytes, which is where an extended header puts it.
      if (format === 0xfffe && size >= 40)
        format = bytes.readUInt16LE(body + 24);
    } else if (id === "data") {
      data = bytes.subarray(body, end);
    }
    // Chunks are word-aligned: an odd size is followed by one pad byte.
    at = body + size + (size % 2);
  }

  if (channels === 0 || rate === 0 || data === null) {
    throw new Error("no fmt or data chunk");
  }
  const bytesPerSample = Math.floor(bits / 8);
  if (bytesPerSample === 0) throw new Error("no sample width");

  let peak = 0;
  const read = sampleReader(format, bits);
  const samples = Math.floor(data.length / bytesPerSample);
  for (let at = 0; at < samples; at += 1) {
    const level = Math.abs(read(data, at * bytesPerSample));
    if (level > peak) peak = level;
  }
  return {
    seconds: samples / channels / rate,
    channels,
    peak: Math.min(1, peak),
  };
}

/** One sample, as a number in `[-1, 1]`, for the encodings a `.wav` writer emits. */
function sampleReader(
  format: number,
  bits: number,
): (data: Buffer, at: number) => number {
  // 1 is integer PCM, 3 is IEEE float.
  if (format === 3 && bits === 32) {
    return (data, at) => data.readFloatLE(at);
  }
  if (format === 3 && bits === 64) {
    return (data, at) => data.readDoubleLE(at);
  }
  if (format === 1 && bits === 8) {
    // 8-bit PCM is unsigned, centred on 128.
    return (data, at) => (data.readUInt8(at) - 128) / 128;
  }
  if (format === 1 && bits === 16) {
    return (data, at) => data.readInt16LE(at) / 32768;
  }
  if (format === 1 && bits === 24) {
    return (data, at) => {
      const raw =
        data.readUInt8(at) |
        (data.readUInt8(at + 1) << 8) |
        (data.readInt8(at + 2) << 16);
      return raw / 8388608;
    };
  }
  if (format === 1 && bits === 32) {
    return (data, at) => data.readInt32LE(at) / 2147483648;
  }
  throw new Error(`unsupported encoding: format ${format}, ${bits} bits`);
}

/** One produced file's text, or `null` where it is not there. */
export function readProducedText(...parts: readonly string[]): string | null {
  const path = producedPath(...parts);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
