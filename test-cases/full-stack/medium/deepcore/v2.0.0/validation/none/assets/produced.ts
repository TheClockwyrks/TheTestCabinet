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
// HOW A PNG IS READ. In the browser the project already holds, rather than through
// a decoder of its own: the bytes go over as a data URL, the page decodes them the
// same way the built site decodes its own sprites, and what comes back is the
// size, whether any pixel is transparent, and a small fixed-size signature of the
// picture. The signature is what "no two frames are identical" is decided on, and
// averaging each cell of a coarse grid keeps it a statement about the DRAWING
// rather than about one antialiased pixel.
//
// HOW A SOUND IS READ. The same way: the bytes go over and the page decodes them
// with the Web Audio API, which is the decoder a build's own playback uses, and
// what comes back is the length and the loudest sample in it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Harness } from "../harness";

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

/** One produced file's bytes as a data URL, for the page to decode. */
function dataUrl(path: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

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
 * Decode one produced PNG in the page and report what it holds.
 *
 * `null` where the file is not there, so a check can say "missing" rather than
 * failing on a read.
 */
export async function readPicture(
  h: Harness,
  ...parts: readonly string[]
): Promise<Picture | null> {
  const path = producedPath(...parts);
  if (!existsSync(path)) return null;
  return h.page.evaluate(
    async ({ url, cells }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx === null)
        throw new Error("deepcore: no 2D context to decode into");
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const sums = new Float64Array(cells * cells * 4);
      const counts = new Float64Array(cells * cells);
      let transparent = false;
      let drawn = false;
      for (let y = 0; y < canvas.height; y += 1) {
        const row = Math.min(
          cells - 1,
          Math.floor((y / canvas.height) * cells),
        );
        for (let x = 0; x < canvas.width; x += 1) {
          const col = Math.min(
            cells - 1,
            Math.floor((x / canvas.width) * cells),
          );
          const at = (y * canvas.width + x) * 4;
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
      return {
        width: canvas.width,
        height: canvas.height,
        transparent,
        drawn,
        signature,
      };
    },
    { url: dataUrl(path, "image/png"), cells: SIGNATURE_CELLS },
  );
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

/** What a decoded sound reports. */
export interface Sound {
  seconds: number;
  channels: number;
  /** The loudest sample anywhere in it, `0` to `1`. */
  peak: number;
}

/**
 * Decode one produced sound in the page and report what it holds.
 *
 * `null` where the file is not there, and a decode the page refuses throws, which
 * is the right answer for a file that is not audio.
 */
export async function readSound(
  h: Harness,
  ...parts: readonly string[]
): Promise<Sound | null> {
  const path = producedPath(...parts);
  if (!existsSync(path)) return null;
  return h.page.evaluate(
    async (url: string) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(bytes);
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const samples = buffer.getChannelData(channel);
        for (let at = 0; at < samples.length; at += 1) {
          const level = Math.abs(samples[at]);
          if (level > peak) peak = level;
        }
      }
      return {
        seconds: buffer.duration,
        channels: buffer.numberOfChannels,
        peak,
      };
    },
    dataUrl(path, "audio/wav"),
  );
}

/** One produced file's text, or `null` where it is not there. */
export function readProducedText(...parts: readonly string[]): string | null {
  const path = producedPath(...parts);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
