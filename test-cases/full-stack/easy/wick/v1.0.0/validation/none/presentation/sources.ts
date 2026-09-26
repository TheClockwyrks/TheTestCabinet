// presentation/sources — which PRODUCED FILE a frame drew, decided by the file's
// own pixels.
//
// WHY A CHECK EVER HAS TO ASK. Several points in this category turn on the frame
// INDEX of a sheet: `specs/assets.md` fixes the lamplighter's walk frame as
// "`floor(m x TICK_DT / WALK_FRAME_TIME) mod 6`", an enemy's as
// "`floor(age / WALK_FRAME_TIME) mod 4`", and a puff's, a strike's, a burst's and
// a sconce's the same way — and an index means nothing until it is tied to a
// file, which that document does: the walk sheet is
// `assets/sprites/lamplighter/walk/0.png` to `5.png`, numbered from `0`. So a
// check that asserts "frame `2`" has to be able to say which of the four files
// the frame drew.
//
// WHY NOT THE URL. The recorder names a source by its per-page identity, its
// natural size, and a hash of wherever it came from, and never by a path under
// `assets/`: `specs/assets.md` has the build resolve every produced file through
// the bundler, and a bundler renames a file it emits and inlines a small one as a
// `data:` URI. Neither survives as a path, so neither can be matched against one.
//
// WHAT IS COMPARED INSTEAD. The committed file's own pixels. The produced files
// are at the paths `specs/assets.md` names, in the repository this validator
// project sits in, so each is read off disk, decoded IN THE PAGE, and held
// against the pixels of the source the frame actually drew, which the recorder
// reads back at its natural size. Both go through one browser's PNG decode and
// one canvas read, so a build that drew the committed file matches it, and a
// build that drew something else does not.
//
// THE TOLERANCE, AND WHY IT IS NOT ZERO. A canvas stores colour premultiplied by
// alpha and un-premultiplies it on the way back out, so a pixel drawn at low
// alpha comes back rounded. The two readings take the same route, so the rounding
// is the same one — but a build that keeps its sprites in a pre-rendered surface
// of its own pays it twice. {@link CHANNEL_TOL} of `4` on a 0-255 channel and
// {@link MISMATCH_MAX} of one pixel in two hundred cover that round trip, and sit
// far below any difference between two frames of a sheet, which are drawn to be
// told apart at a glance.
//
// A FILE THAT IS ABSENT, OR A SOURCE THAT MATCHES NONE OF THEM, IS A FAILURE OF
// THE POINT THAT ASKED. `writing-debug-apis-and-validators` puts every verdict on
// the build: a frame drawing something other than the file `specs/assets.md`
// names for it is exactly the miss the point is about.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fail } from "../assert";
import type { Harness } from "../harness";

/**
 * The repository the build produced its files into.
 *
 * This module sits at `validation/presentation/` inside the project vitest was
 * given as its root, so two levels up is the root `specs/assets.md` addresses
 * every produced file from ("Every produced file sits under `assets/` at the root
 * of this repository").
 */
export const BUILD_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** How far one channel of a decoded pixel may differ and still be the same pixel. */
const CHANNEL_TOL = 4;

/** The share of a sprite's pixels that may differ and still be the same sprite. */
const MISMATCH_MAX = 0.005;

/** The page global this module caches decoded produced files under. */
const CACHE_GLOBAL = "__wickProduced";

/** The files primed into one page, so a path is read and decoded once per harness. */
const primed = new WeakMap<Harness, Set<string>>();

/** The bytes of a committed produced file as a `data:` URL, or a failure. */
function producedDataUrl(path: string): string {
  try {
    return `data:image/png;base64,${readFileSync(join(BUILD_ROOT, path)).toString("base64")}`;
  } catch {
    return fail(
      `the produced file ${path}, committed at the path specs/assets.md names it at`,
      "no such file in the repository",
    );
  }
}

/**
 * Decode `paths` inside the page and keep them, so a later question about a
 * drawn source is one lookup.
 *
 * Called before a scenario is driven rather than during it: a decode creates a
 * scratch canvas, and a check that films its frames should spend none of them
 * here.
 */
export async function primeSources(
  h: Harness,
  paths: readonly string[],
): Promise<void> {
  const done = primed.get(h) ?? new Set<string>();
  primed.set(h, done);
  const wanted = paths.filter((path) => !done.has(path));
  if (wanted.length === 0) return;
  const files = wanted.map((path) => [path, producedDataUrl(path)] as const);
  await h.page.evaluate(
    async ([cacheName, entries]) => {
      const globals = window as unknown as Record<string, unknown>;
      const cache = (globals[cacheName] ?? {}) as Record<
        string,
        { width: number; height: number; data: number[] } | null
      >;
      globals[cacheName] = cache;
      for (const [path, url] of entries) {
        if (cache[path] !== undefined) continue;
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const scratch = document.createElement("canvas");
          scratch.width = image.naturalWidth;
          scratch.height = image.naturalHeight;
          const ctx = scratch.getContext("2d", { willReadFrequently: true });
          if (ctx === null) {
            cache[path] = null;
            continue;
          }
          ctx.drawImage(image, 0, 0);
          const read = ctx.getImageData(0, 0, scratch.width, scratch.height);
          cache[path] = {
            width: read.width,
            height: read.height,
            data: Array.from(read.data),
          };
        } catch {
          cache[path] = null;
        }
      }
    },
    [CACHE_GLOBAL, files] as const,
  );
  for (const path of wanted) done.add(path);
}

/**
 * Which of `paths` the source with `imageId` is, counted from `0`, or `-1` when
 * it is none of them.
 *
 * The best match wins, so two frames of a sheet that differ by a handful of
 * pixels are still told apart; a source that matches none within the tolerance
 * answers `-1`, which is what a point about a drawn frame fails on.
 *
 * With `mirrored`, each file is compared REFLECTED across its vertical axis,
 * which is what tells a build that draws a mirrored copy of a sprite it produced
 * itself from one that mirrors it through the transform. `specs/assets.md` states
 * its mirrored pictures as reflections of a produced file — "the lamplighter
 * drawn facing left is that sprite reflected across its vertical axis" — and
 * leaves the route to either build.
 */
export async function sourceIndex(
  h: Harness,
  imageId: number,
  paths: readonly string[],
  mirrored = false,
): Promise<number> {
  await primeSources(h, paths);
  return (await h.page.evaluate(
    ([cacheName, recorderName, wanted, id, channelTol, mismatchMax, flip]) => {
      const globals = window as unknown as Record<string, unknown>;
      const cache = (globals[cacheName] ?? {}) as Record<
        string,
        { width: number; height: number; data: number[] } | null
      >;
      const recorder = globals[recorderName] as {
        imagePixels(
          n: number,
        ): { width: number; height: number; data: number[] } | null;
      };
      const drawn = recorder.imagePixels(id);
      if (drawn === null) return -1;
      let best = -1;
      let fewest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < wanted.length; index += 1) {
        const file = cache[wanted[index]!];
        if (
          file === null ||
          file === undefined ||
          file.width !== drawn.width ||
          file.height !== drawn.height
        ) {
          continue;
        }
        const pixels = file.data.length / 4;
        const allowed = Math.ceil(pixels * mismatchMax);
        let bad = 0;
        for (let py = 0; py < file.height && bad <= allowed; py += 1) {
          for (let px = 0; px < file.width; px += 1) {
            const at = (py * file.width + px) * 4;
            const qx = flip ? file.width - 1 - px : px;
            const to = (py * file.width + qx) * 4;
            const fileAlpha = file.data[at + 3]!;
            const drawnAlpha = drawn.data[to + 3]!;
            if (Math.abs(fileAlpha - drawnAlpha) > channelTol) {
              bad += 1;
            } else if (fileAlpha >= 8 || drawnAlpha >= 8) {
              if (
                Math.abs(file.data[at]! - drawn.data[to]!) > channelTol ||
                Math.abs(file.data[at + 1]! - drawn.data[to + 1]!) >
                  channelTol ||
                Math.abs(file.data[at + 2]! - drawn.data[to + 2]!) > channelTol
              ) {
                bad += 1;
              }
            }
            if (bad > allowed) break;
          }
        }
        if (bad <= allowed && bad < fewest) {
          fewest = bad;
          best = index;
        }
      }
      return best;
    },
    [
      CACHE_GLOBAL,
      h.config.recorderGlobal,
      paths,
      imageId,
      CHANNEL_TOL,
      MISMATCH_MAX,
      mirrored,
    ] as const,
  )) as number;
}

/**
 * For each of `paths`, the lowest index of a file with the same pixels.
 *
 * WHY A POINT ABOUT A SHEET NEEDS THIS. `specs/assets.md` fixes the number of
 * frames a sheet carries and the animation's index into them, and nowhere
 * requires two of those frames to differ — a walk cycle whose second half repeats
 * its first is a sheet an artist draws on purpose. Two frames drawn from the same
 * picture cannot be told apart by anything looking at the canvas, and a bundler
 * that emits one file for two identical sources makes them one image besides. So
 * a check that reads a sheet's frame index reads it UP TO this classing: the
 * cadence, the order, and the wrap are all still decided, and a build that
 * advanced its cycle at the wrong rate or played it out of order still fails,
 * while a build whose own sheet repeats a frame is not failed for the repeat.
 */
export async function fileClasses(
  h: Harness,
  paths: readonly string[],
): Promise<number[]> {
  await primeSources(h, paths);
  return (await h.page.evaluate(
    ([cacheName, wanted, channelTol, mismatchMax]) => {
      const globals = window as unknown as Record<string, unknown>;
      const cache = (globals[cacheName] ?? {}) as Record<
        string,
        { width: number; height: number; data: number[] } | null
      >;
      const same = (
        a: { width: number; height: number; data: number[] },
        b: { width: number; height: number; data: number[] },
      ): boolean => {
        if (a.width !== b.width || a.height !== b.height) return false;
        const allowed = Math.ceil((a.data.length / 4) * mismatchMax);
        let bad = 0;
        for (let at = 0; at < a.data.length; at += 4) {
          const aa = a.data[at + 3]!;
          const ba = b.data[at + 3]!;
          if (Math.abs(aa - ba) > channelTol) bad += 1;
          else if (
            (aa >= 8 || ba >= 8) &&
            (Math.abs(a.data[at]! - b.data[at]!) > channelTol ||
              Math.abs(a.data[at + 1]! - b.data[at + 1]!) > channelTol ||
              Math.abs(a.data[at + 2]! - b.data[at + 2]!) > channelTol)
          ) {
            bad += 1;
          }
          if (bad > allowed) return false;
        }
        return true;
      };
      return wanted.map((path, index) => {
        const here = cache[path];
        if (here === null || here === undefined) return index;
        for (let before = 0; before < index; before += 1) {
          const other = cache[wanted[before]!];
          if (other !== null && other !== undefined && same(here, other)) {
            return before;
          }
        }
        return index;
      });
    },
    [CACHE_GLOBAL, paths, CHANNEL_TOL, MISMATCH_MAX] as const,
  )) as number[];
}
