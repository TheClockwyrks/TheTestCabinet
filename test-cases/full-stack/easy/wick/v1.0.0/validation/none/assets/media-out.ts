// assets/media-out — writing this category's file-derived evidence images.
//
// The Produced Assets category grades COMMITTED FILES, so most of its suites
// read the repository the build produced rather than drive the game, and the
// picture each one leaves behind is derived from the file under test — a sprite
// magnified over a checkerboard, a waveform, a loop junction — rather than a
// frame the harness canvas happened to hold. This module gives those suites the
// same media addressing the harness uses, so an output a review item declares
// lands where the runner collects it whichever module wrote it.
//
// The addressing itself is the shared harness's `mediaDestination`: the suite is
// the one vitest is currently running, and the project root is THIS project's,
// one level up from this directory. Nothing here can change a verdict — outside
// a run there is no media directory and every write is a no-op, and a picture
// that cannot be written is given up rather than raised, because a host that
// cannot write a file is not the build's fault.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Canvas } from "@napi-rs/canvas";
import { mediaDestination } from "../case-harness/media";

/** The validator project's root: the directory this `assets/` folder sits in. */
export const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * The root of the repository the build produced, which is where `assets/` and
 * `src/` sit.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place in both layouts this project lives in: the case's own
 * `validation/none/assets/`, and the `validation/assets/` the runner stages it
 * to inside the build's tree. Two levels up is the workspace either way.
 */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/** Keep `canvas` as the review item's `outputId` image output. */
export function writeImage(outputId: string, canvas: Canvas): void {
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}

/** Keep already-encoded PNG bytes as the review item's `outputId` output. */
export function writeImageBytes(outputId: string, png: Buffer): void {
  let destination: string | null;
  try {
    destination = mediaDestination(PROJECT_ROOT, outputId, "png");
  } catch (error) {
    console.warn(`wick: could not address ${outputId}: ${String(error)}`);
    return;
  }
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, png);
  } catch (error) {
    console.warn(`wick: could not write ${destination}: ${String(error)}`);
  }
}
