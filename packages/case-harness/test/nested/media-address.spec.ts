// The address of an output produced by a suite ONE DIRECTORY DOWN — which is
// where every real check lives.
//
// A case's suites sit in `validation/<suite>/<name>.test.ts`, never at the
// project root, so the address that matters is the one with a directory in it.
// This file is the package's own version of that: it sits a directory below the
// validator project, exactly as `board/beam-route.test.ts` sits below `refract`'s.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  MEDIA_DIR_ENV,
  STAGED_PROJECT_DIR,
  mediaDestination,
} from "../../src/index";

/** The validator project this suite belongs to: one directory UP from here. */
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

it("keeps the suite's own directory in the output's address", () => {
  const before = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = "/media";
  try {
    expect(mediaDestination(PROJECT_ROOT, "opening", "png")).toBe(
      join(
        "/media",
        STAGED_PROJECT_DIR,
        "nested",
        "media-address.spec.ts",
        "opening.png",
      ),
    );
  } finally {
    if (before === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = before;
  }
});

it("refuses an address that would leave the media directory", () => {
  // Both writers are required not to raise, so a destination outside the
  // directory the runner collects has to be refused HERE or not at all.
  const before = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = "/media";
  try {
    expect(() =>
      mediaDestination(
        PROJECT_ROOT,
        join("..", "..", "..", "..", "escaped"),
        "png",
      ),
    ).toThrow(/outside the media directory/);
  } finally {
    if (before === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = before;
  }
});
