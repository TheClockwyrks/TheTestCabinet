// Where a produced output belongs on disk.
//
// A recording or a still is addressed by the STAGED path of the suite that
// produced it — `validation/tracing/extend.test.ts` — because that is the path
// the review item's declared script resolves to, and so the only name the case's
// manifest and the runner both already agree on.
//
// THE PROJECT ROOT IS A PARAMETER, AND THAT IS THE WHOLE POINT OF THIS MODULE.
// It used to be `dirname(fileURLToPath(import.meta.url))` of the file that also
// held the harness, which was the case's own validator project. This package is
// staged one directory deeper than that, so the same expression here would
// resolve to the package's directory, the suite's path would come out relative
// to THAT, and every output would be addressed at the wrong place. It would also
// fail silently: both writers swallow what goes wrong with a write, so the
// outputs would simply stop turning up with nothing failing to say so. So the
// root arrives from the CASE's module, and the two checks below turn a wrong one
// into a thrown error rather than into a quietly misplaced file.

import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { expect } from "vitest";

/** The environment variable the runner names the media directory in. */
export const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages a case's validator project to inside the
 * build's tree.
 *
 * Stating the prefix here is what keeps an output's address the same wherever
 * the project itself is rooted.
 */
export const STAGED_PROJECT_DIR = "validation";

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 *
 * `projectRoot` is the case's own validator-project directory. Throws — rather
 * than returning a plausible-looking path — when the suite does not sit under it,
 * or when the address that falls out of it leaves the media directory: both mean
 * the root is wrong, and a wrong root is exactly the failure the writers cannot
 * report because they are required not to raise.
 */
export function mediaDestination(
  projectRoot: string,
  outputId: string,
  extension: string,
): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;

  const within = relative(projectRoot, testPath);
  if (within === "" || within.startsWith("..") || isAbsolute(within)) {
    throw new Error(
      `the running suite \`${testPath}\` is not inside the validator project ` +
        `\`${projectRoot}\` this harness was configured with, so its outputs ` +
        `would be addressed under some other name — pass \`projectRoot\` from ` +
        `the CASE's own module (\`dirname(fileURLToPath(import.meta.url))\` in ` +
        `its harness), never from the shared package's`,
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
        `media directory \`${root}\` the runner collects — refusing rather ` +
        `than writing somewhere nothing will look`,
    );
  }
  return destination;
}
