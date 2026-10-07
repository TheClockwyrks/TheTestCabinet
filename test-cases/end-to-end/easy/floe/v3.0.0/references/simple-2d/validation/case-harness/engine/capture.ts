// Writing a review item's evidence out. DIMENSION-NEUTRAL.
//
// A review item may declare an OUTPUT beside its verdict — a replay a reviewer
// can scrub, a still they can look at — and this is the machinery that puts one
// on disk. What the evidence IS differs by dimension (a 2D engine's replay is a
// draw-op log, a 3D engine's is VP9 video, and a still is a PNG either way), so
// what is here is only the part that is the same: where it goes, and what happens
// when it cannot go there.
//
// FOUR PROPERTIES, EACH DELIBERATE, AND EVERY ONE OF THEM ABOUT NOT CHANGING A
// VERDICT:
//
//  1. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//     back, so a check reads it exactly as it did before capture existed, and a
//     scenario that THROWS still leaves what it had recorded — a failing check is
//     the one whose replay a reviewer most wants.
//  2. IT NEVER RAISES. A directory that cannot be made or a file that cannot be
//     written says something about the machine the validators ran on, and failing
//     the point over it would blame the build for the host's problem. The runner
//     already reports a declared output that never turned up as exactly that,
//     which is the truthful reading.
//  3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. An encoder that answers `null`
//     leaves no file, so the run reports the output absent rather than offering a
//     reviewer a replay of nothing.
//  4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//     directory is unset and the whole thing is a no-op that still runs the
//     scenario, so a suite behaves identically in a shell and in a run and a
//     check cannot pass in one and fail in the other.
//
// THE PROJECT ROOT IS THE CASE'S. This package is staged one directory deeper
// than the case's own files, so a root derived from this module's `import.meta.url`
// would address every output one directory too deep — and silently, because of
// property 2. It arrives from the case; see `../media`, which turns a wrong one
// into a thrown error rather than a quietly misplaced file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mediaDestination } from "../media";

/** What a written output is framed as, which fixes the extension it lands under. */
export type OutputExtension = "png" | "json.gz" | "webm" | "mp4";

/**
 * Write `bytes` as the running suite's `outputId` output, reporting rather than
 * raising anything that goes wrong.
 *
 * `null` bytes write nothing: see property 3 above.
 */
export function writeOutput(
  slug: string,
  destination: string,
  bytes: Uint8Array | null,
): void {
  if (bytes === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  } catch (error) {
    console.warn(`${slug}: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * A thin naming of `../media`'s reading, kept so this module is the one place the
 * engine half asks the question and a case never repeats the three-argument call.
 */
export function outputDestination(
  projectRoot: string,
  outputId: string,
  extension: OutputExtension,
): string | null {
  return mediaDestination(projectRoot, outputId, extension);
}

/**
 * Keep whatever `encode` answers as the review item's `outputId` output.
 *
 * The encoder is a callback rather than a value because encoding is the expensive
 * part — a PNG of a whole backing store, a video muxed out of a renderer — and
 * outside a run there is nothing to encode FOR. It runs only once a destination
 * exists.
 *
 * `null` from the encoder writes nothing, and anything the encoder throws is
 * caught and reported: an encoder that failed is a fact about the host in exactly
 * the way a write that failed is.
 */
export async function captureOutput(
  slug: string,
  projectRoot: string,
  outputId: string,
  extension: OutputExtension,
  encode: () => Uint8Array | null | Promise<Uint8Array | null>,
): Promise<void> {
  const destination = outputDestination(projectRoot, outputId, extension);
  if (destination === null) return;
  let bytes: Uint8Array | null;
  try {
    bytes = await encode();
  } catch (error) {
    console.warn(`${slug}: could not encode ${outputId}: ${String(error)}`);
    return;
  }
  writeOutput(slug, destination, bytes);
}

/**
 * The synchronous twin of {@link captureOutput}, for an encoder that answers now.
 *
 * A 2D still is a `toBuffer` off a canvas that is already rasterized, and 13 of
 * the engine harnesses declare `captureStill` synchronous because of it. A case
 * whose suites call it without an `await` is not asked to grow one: both ship,
 * and a case binds the one its suites were written against. See the README's
 * collision table.
 */
export function captureOutputSync(
  slug: string,
  projectRoot: string,
  outputId: string,
  extension: OutputExtension,
  encode: () => Uint8Array | null,
): void {
  const destination = outputDestination(projectRoot, outputId, extension);
  if (destination === null) return;
  let bytes: Uint8Array | null;
  try {
    bytes = encode();
  } catch (error) {
    console.warn(`${slug}: could not encode ${outputId}: ${String(error)}`);
    return;
  }
  writeOutput(slug, destination, bytes);
}

/**
 * Run `scenario` with something recording around it, and keep what it recorded
 * whatever the scenario did.
 *
 * `arm` opens the recording and `close` answers the bytes to keep. The scenario's
 * value comes straight back, and `close` runs in a `finally` so a scenario that
 * threw still leaves its evidence behind — property 1.
 *
 * RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the caller's
 * scenario and disarmed the moment it returns, so what is kept is the part the
 * check is ABOUT and never the setup that got there: a check that walks half a
 * campaign to reach a mid-course board records the board, not the walk.
 */
export async function captureAround<T>(
  slug: string,
  projectRoot: string,
  outputId: string,
  extension: OutputExtension,
  arm: () => void,
  close: () => Uint8Array | null | Promise<Uint8Array | null>,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const destination = outputDestination(projectRoot, outputId, extension);
  if (destination === null) return scenario();
  arm();
  try {
    return await scenario();
  } finally {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await close();
    } catch (error) {
      console.warn(`${slug}: could not encode ${outputId}: ${String(error)}`);
    }
    writeOutput(slug, destination, bytes);
  }
}
