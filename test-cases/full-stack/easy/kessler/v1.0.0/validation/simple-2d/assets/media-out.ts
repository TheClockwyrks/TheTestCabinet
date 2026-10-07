// assets/media-out — writing this category's file-derived evidence images.
//
// The Produced Assets category grades COMMITTED FILES — sprites, particle
// systems, and sounds — so several of its suites read the workspace rather
// than drive the game, and their evidence is a picture derived from the file
// under test (a waveform, a seam, a sprite over a checkerboard) rather than a
// frame the harness canvas happened to hold. This module gives those suites
// the same media addressing `harness.ts` uses — the same environment variable,
// the same staged suite path, the same `<outputId>.png` name — so an output
// declared in the case's manifest lands where the runner collects it whichever
// module wrote it. Nothing here can change a verdict: outside a run (no
// `TCAB_VALIDATION_MEDIA_DIR`) every write is a no-op, and a picture that
// cannot be written is reported as an output that never turned up.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { Canvas } from "@napi-rs/canvas";

/** The validator project's root: the directory this `assets/` folder sits in. */
export const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** The directory the runner stages this project to inside the build's tree. */
const STAGED_PROJECT_DIR = "validation";

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing
 * is collecting media. The suite is the one vitest is currently running rather
 * than one the caller names, exactly as `harness.ts` addresses its media.
 */
export function mediaDestination(
  outputId: string,
  extension: string,
): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/** Keep `canvas` as the review item's `outputId` image output. */
export function writeImage(outputId: string, canvas: Canvas): void {
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}

/** Keep already-encoded PNG bytes as the review item's `outputId` output. */
export function writeImageBytes(outputId: string, png: Buffer): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, png);
  } catch (error) {
    console.warn(`kessler: could not write ${destination}: ${String(error)}`);
  }
}
