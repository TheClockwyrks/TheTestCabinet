// The shared image store: a run's captured images, kept once each beside the
// recordings that draw them.
//
// WHY THERE IS ONE AT ALL. A recording carries its images INLINE — a bitmap as a
// `data:image/png;base64,…` URL, a pixel buffer as base64 RGBA — and a run writes
// one recording per capture. So a sprite forty checks draw is written forty
// times, base64 costs a third again on top of the bytes, and PNG is already
// compressed so the gzip every recording lands under buys nothing back on the
// part that dominates it. Measured on one reference's committed baseline: 8292
// image entries across 170 recordings, 1486 of them distinct, 2.2% of the raw
// bytes and 24.4% of the gzipped ones.
//
// WHAT IT IS. A flat set of files sitting DIRECTLY in the media directory the
// runner collects, named for the bytes inside them, and an entry in a recording
// that names one instead of carrying it. Three properties fall out of that and
// each is the reason for a decision below:
//
//  1. THE NAME IS THE CONTENT, so two workers writing the same image write the
//     same file, a re-publish is a no-op, and there is nothing to reconcile.
//  2. THE NAME IS A FLAT FILE NAME IN THE DIRECTORY EVERY OTHER OUTPUT LIVES IN,
//     so it is served, published and resolved by the routes and lookups declared
//     media already travels through, with no new plumbing on any of them.
//  3. NOTHING HERE MAY RAISE OR HANG. This runs inside a check's `finally`, and a
//     store that cannot write costs the run bytes and never a verdict — every
//     refusal here answers `null`, which the caller reads as "keep it inline".
//
// WHAT GOES IN IT IS BITMAPS. A recording's other image kind is a raw RGBA pixel
// buffer, and that one is left inline on purpose: RGBA is the most compressible
// thing a recording carries, so the gzip it already lands under beats any file
// this could write by two orders of magnitude. See `payloadOf` for the arithmetic.
//
// WHY ONE FILE PER IMAGE RATHER THAN ONE SIDECAR DOCUMENT PER RUN. A reviewer
// opens replays one at a time, so a single document would make opening ONE replay
// fetch every image the whole run captured instead of the ones that replay draws.
// And a single document would need a merge across processes: the validator runs
// vitest with eight forked workers and the engine projects declare no global
// setup at all, so there is no shared memory and no after-all hook to merge in.
// One file per unique image is lock-free by construction — identical content,
// identical name, atomic rename — and lets the browser's own cache carry a sprite
// across every replay a session opens.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MEDIA_DIR_ENV } from "../media";

/**
 * What every file of the store is named with.
 *
 * MIRRORED IN RUST as `VALIDATION_IMAGE_PREFIX` in `crates/core/src/validator.rs`,
 * beside `validation_media_name`, which is what the driver's mirror and the
 * backend's snapshot enumerate the store by. The two must agree; there is no
 * shared declaration to derive one from because the producer is TypeScript
 * running inside a validator and the consumers are Rust running outside one.
 *
 * The prefix deliberately carries no `__`: a declared output is always written as
 * `<verdict>__<output>.<ext>`, so a store file cannot collide with one however a
 * case names its items.
 */
export const IMAGE_STORE_PREFIX = "img.";

/**
 * The image bytes ONE RUN's shared store holds.
 *
 * A JUDGEMENT, NOT A MEASUREMENT, and the comment should keep saying so until it
 * is one. The three references measured while this was designed need 4.66, 1.81
 * and 1.45 MB of distinct image payload apiece, so this is some fifty times the
 * worst of them and still several times under the 1.75 GB run that prompted the
 * work. Revisit it against a regenerated corpus rather than defending the number.
 *
 * IT IS APPROXIMATE ACROSS WORKERS. Each worker reads the directory's total when
 * it opens a store and counts its own writes from there, so eight of them may
 * each cross the line before any sees the others' bytes. The overshoot is bounded
 * by workers times the page-side per-recording ceiling rather than by zero. An
 * exact budget wants a lock, and a validator harness is forbidden to hang.
 */
export const RUN_IMAGE_BUDGET = 256 * 1024 * 1024;

/** The prefix a bitmap's inline payload is carried under. */
const PNG_DATA_URL = "data:image/png;base64,";

/** An image entry that names its bytes beside the recording instead of carrying them. */
export interface StoredImage {
  readonly kind: "bitmap" | "pixels";
  readonly width: number;
  readonly height: number;
  /** The flat file name of the bytes, in the directory the recording lands in. */
  readonly store: string;
}

/** Somewhere to put an image's bytes once, for every recording that draws it. */
export interface ImageStore {
  /**
   * `entry`'s bytes written beside the recording and the reference that names
   * them, or `null` when the entry must stay inline.
   *
   * `null` is the only failure this has: an entry whose payload cannot be
   * decoded, a run past its budget, a write the host refused. The caller keeps
   * what it was handed, so a store that is not working costs bytes and nothing
   * else.
   */
  put(entry: unknown): StoredImage | null;
}

/** How a store is opened when something other than a run is doing the opening. */
export interface ImageStoreOptions {
  /**
   * Where the files go, overriding the runner's media directory.
   *
   * For this package's own suite, which has no run around it. A caller inside a
   * run passes nothing and gets the directory the runner named.
   */
  readonly directory?: string;
  /** The run's ceiling, overriding {@link RUN_IMAGE_BUDGET}. For the suite. */
  readonly budgetBytes?: number;
}

/**
 * The bytes an inline entry carries, with the shape they were carried under, or
 * `null` when there is nothing decodable there.
 *
 * ONLY A BITMAP IS STORABLE, and that is a size decision rather than a limit of
 * the format — an entry that keeps its pixels beside the recording is a
 * first-class member of the union whatever its kind, and the player resolves
 * either. What separates the two is what the bytes are:
 *
 *  - A BITMAP's payload is a PNG, which is already compressed. Inline it costs
 *    base64's third on top of that and then defeats the gzip the recording lands
 *    under, so moving it out is a straight win: the file is smaller than the text
 *    that carried it, and a sprite forty recordings draw is one file rather than
 *    forty copies. That is the whole of the measured duplication this store was
 *    built for.
 *  - A PIXEL BUFFER's payload is raw RGBA, which is the most compressible thing a
 *    recording carries. A flat 640x360 framebuffer is ~1.2 MB of base64 inline and
 *    gzips inside the recording to a few kilobytes; the same buffer written out
 *    raw is 900 KB served uncompressed — two orders of magnitude WORSE, and it
 *    spends the run's budget at the same rate. Nor is there duplication to win
 *    back: a `putImageData` entry is captured afresh at every use, so each one is
 *    a distinct buffer already.
 *
 * So a pixel buffer stays inline, where gzip is already doing the right thing with
 * it. Storing one would want its own compression and a `Content-Encoding` on every
 * route that serves it; if that is ever worth building, this is the function that
 * changes and nothing else has to.
 */
function payloadOf(
  entry: unknown,
): { kind: "bitmap" | "pixels"; extension: string; bytes: Buffer } | null {
  if (entry === null || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (record.kind !== "bitmap") return null;
  const src = record.src;
  // Only a PNG data URL is decodable here. The recorder produces nothing else,
  // and an entry that somehow named a remote URL has no bytes to address by.
  if (typeof src !== "string" || !src.startsWith(PNG_DATA_URL)) return null;
  return {
    kind: "bitmap",
    extension: "png",
    bytes: Buffer.from(src.slice(PNG_DATA_URL.length), "base64"),
  };
}

/** An entry's declared size, or `null` when it does not carry one. */
function sizeOf(entry: unknown): { width: number; height: number } | null {
  if (entry === null || typeof entry !== "object") return null;
  const { width, height } = entry as Record<string, unknown>;
  if (typeof width !== "number" || !Number.isFinite(width)) return null;
  if (typeof height !== "number" || !Number.isFinite(height)) return null;
  return { width, height };
}

/**
 * The file name `bytes` of that kind and size are addressed by.
 *
 * The kind and the dimensions are inside the hash rather than only in the name so
 * that a name means one image whatever the store comes to hold: a payload with no
 * header of its own — a bare RGBA run, say — would otherwise let two differently
 * shaped images of the same length share a name. Half a sha256 is 128 bits, which
 * is far past the point where a collision across a run's few thousand images is
 * worth reasoning about, and it keeps the name short enough to read in a directory
 * listing.
 */
function nameFor(
  kind: string,
  width: number,
  height: number,
  extension: string,
  bytes: Buffer,
): string {
  const digest = createHash("sha256")
    .update(`${kind}|${width}x${height}|`, "utf8")
    .update(bytes)
    .digest("hex")
    .slice(0, 32);
  return `${IMAGE_STORE_PREFIX}${digest}.${extension}`;
}

/**
 * Somewhere to put this run's captured images, or `null` when nothing is
 * collecting media.
 *
 * `null` MEANS "INLINE EVERYTHING", which is what a recording written outside a
 * run gets and what it has always got: a suite driven from a shell, a hand-written
 * showcase recording, this package's own suite. That is the property which keeps
 * a recording that nobody will publish the store beside from acquiring references
 * to files nobody will publish.
 *
 * Opening reads the directory once to learn what the run has already spent, so a
 * worker that starts late counts the workers that started before it. It is
 * reopened per recording rather than held for the process precisely for that: the
 * total is refreshed from the shared directory each time, which is as close to a
 * shared counter as eight forked processes get without one.
 */
export function openImageStore(
  options: ImageStoreOptions = {},
): ImageStore | null {
  const directory = options.directory ?? process.env[MEDIA_DIR_ENV];
  if (directory === undefined || directory === "") return null;
  const budget = options.budgetBytes ?? RUN_IMAGE_BUDGET;

  let spent = 0;
  try {
    mkdirSync(directory, { recursive: true });
    for (const file of readdirSync(directory)) {
      if (!file.startsWith(IMAGE_STORE_PREFIX)) continue;
      spent += statSync(join(directory, file)).size;
    }
  } catch {
    // A media directory that cannot be read or made is a fact about the host, and
    // the truthful response is the one that costs nothing: keep every entry
    // inline, exactly as a recording written outside a run does.
    return null;
  }

  return {
    put(entry) {
      const size = sizeOf(entry);
      const payload = payloadOf(entry);
      if (size === null || payload === null) return null;
      const file = nameFor(
        payload.kind,
        size.width,
        size.height,
        payload.extension,
        payload.bytes,
      );
      const reference: StoredImage = {
        kind: payload.kind,
        width: size.width,
        height: size.height,
        store: file,
      };

      const target = join(directory, file);
      // Asked BEFORE the budget, so a store that is over its ceiling still
      // resolves everything it already holds. That is what makes running out
      // degrade a run partially — the images captured before the line are still
      // drawn — rather than all at once.
      if (existsSync(target)) return reference;
      if (spent + payload.bytes.length > budget) return null;

      // Written under a name of its own and moved into place, because a reader may
      // be fetching this file while another worker writes it: a rename inside one
      // directory is atomic on every filesystem the runner uses, so a name either
      // does not exist or holds the whole file. Two workers writing the same image
      // write the same bytes, so the race between them has no wrong outcome.
      const temporary = join(
        directory,
        `.img-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
      );
      try {
        writeFileSync(temporary, payload.bytes);
        renameSync(temporary, target);
      } catch {
        try {
          unlinkSync(temporary);
        } catch {
          // Best effort. A temp file left behind is named so that neither the
          // driver's mirror nor the backend's snapshot will carry it.
        }
        return null;
      }
      spent += payload.bytes.length;
      return reference;
    },
  };
}
