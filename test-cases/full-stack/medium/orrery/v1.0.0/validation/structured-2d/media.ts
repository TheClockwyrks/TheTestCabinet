// Orrery — where a produced output belongs on disk. CASE-PROVIDED, and the SAME
// FILE in all three engine projects.
//
// A review item declares the media it wants as evidence beside its verdict, and a
// suite writes each output to
// `$TCAB_VALIDATION_MEDIA_DIR/<its own staged path>/<output id>.<ext>`. The staged
// path is the suite's own — the same path the manifest names as the item's
// `script` — so nothing has to be escaped, flattened, or agreed on: a suite
// derives its address from where it is, and two suites of the same name in
// different directories cannot collide.
//
// THE PROJECT ROOT COMES FROM THIS FILE, AND THAT IS SAFE HERE. It is the case's
// own module and it sits directly inside the validator project, so
// `dirname(import.meta.url)` names the project's root in both layouts it lives
// in: the case's `validation/<engine>/` in the checkout, and the `validation/` the
// runner stages it to inside the build's tree. (The shared `case-harness` package
// may NOT do this, because it is staged one directory deeper — which is why it
// takes the root as a parameter.)
//
// NOTHING HERE CAN CHANGE A VERDICT. Outside a run the media directory is unset
// and every write is a no-op; a write that fails is warned about and swallowed,
// because a file that cannot be written says something about the machine the
// validators ran on rather than about the build, and a declared output that never
// turned up is already reported as absent.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/** The environment variable the runner names the media directory in. */
export const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** The directory the runner stages this project to inside the build's tree. */
export const STAGED_PROJECT_DIR = "validation";

/** This validator project's root: the directory this file sits in. */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/`, `src/` and `dist/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 *
 * Throws — rather than answering a plausible-looking path — when the running
 * suite is not inside this project, or when the address that falls out of it
 * leaves the media directory. Both mean the root is wrong, and a wrong root is
 * exactly the failure the writers below cannot report, because they are required
 * not to raise.
 */
export function mediaDestination(
  outputId: string,
  extension: string,
): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;

  const within = relative(PROJECT_ROOT, testPath);
  if (within === "" || within.startsWith("..") || isAbsolute(within)) {
    throw new Error(
      `the running suite \`${testPath}\` is not inside the validator project ` +
        `\`${PROJECT_ROOT}\`, so its outputs would be addressed under some ` +
        `other point's name`,
    );
  }

  const suite = within.split(sep).join("/");
  const destination = join(
    mediaDir,
    STAGED_PROJECT_DIR,
    suite,
    `${outputId}.${extension}`,
  );
  const root = resolve(mediaDir);
  const at = resolve(destination);
  if (at !== root && !at.startsWith(root + sep)) {
    throw new Error(
      `the output \`${outputId}\` would be written to \`${at}\`, outside the ` +
        `media directory \`${root}\` the runner collects`,
    );
  }
  return destination;
}

/**
 * Keep already-encoded bytes as the review item's `outputId` output.
 *
 * What the checks about a PRODUCED FILE leave behind. Those checks drive no game
 * — they read a file off the workspace — so a screenshot of a page would be
 * evidence of nothing; what they show instead is a picture derived from the file
 * itself, painted by the helpers in `assets/`.
 */
export function writeMedia(
  outputId: string,
  extension: string,
  bytes: Uint8Array,
): void {
  const destination = mediaDestination(outputId, extension);
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  } catch (error) {
    console.warn(`orrery: could not write ${destination}: ${String(error)}`);
  }
}

/** Keep PNG bytes as the review item's `outputId` image output. */
export function writeImageBytes(outputId: string, png: Uint8Array): void {
  writeMedia(outputId, "png", png);
}
