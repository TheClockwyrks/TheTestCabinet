// Where a produced output belongs on disk — and the wrong root that would put it
// somewhere nothing looks.
//
// This is the silent killer the extraction was most exposed to. The project root
// used to be `dirname(fileURLToPath(import.meta.url))` of the file that also held
// the harness, which WAS the case's validator project; the same expression inside
// this package names the package's own directory, one level deeper, so every
// replay and still would be addressed one directory too deep. And it would fail
// silently: both writers swallow what goes wrong with a write, so the outputs
// would simply stop turning up with nothing failing to say so.
//
// So the root is a parameter, it comes from the CASE's module, and a root that
// does not contain the running suite is a thrown error rather than a plausible
// path.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  MEDIA_DIR_ENV,
  STAGED_PROJECT_DIR,
  mediaDestination,
} from "../src/index";

/** The validator project this suite belongs to: the directory it sits in. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The shared package's own directory, one level deeper than the project. */
const PACKAGE_DIR = fileURLToPath(new URL("../src", import.meta.url));

/** Run `body` with the media directory named, whatever it was before. */
function collecting<T>(mediaDir: string | undefined, body: () => T): T {
  const before = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    return body();
  } finally {
    if (before === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = before;
  }
}

it("addresses an output by the staged path of the suite that produced it", () => {
  const at = collecting("/media", () =>
    mediaDestination(PROJECT_ROOT, "solve", "json.gz"),
  );

  // The staged prefix, then the suite's path within the project — which is the
  // only name the case's manifest and the runner both already agree on.
  expect(at).toBe(
    join("/media", STAGED_PROJECT_DIR, "media.spec.ts", "solve.json.gz"),
  );
});

it("costs nothing when nobody is collecting", () => {
  expect(
    collecting(undefined, () =>
      mediaDestination(PROJECT_ROOT, "solve", "json.gz"),
    ),
  ).toBeNull();
  expect(
    collecting("", () => mediaDestination(PROJECT_ROOT, "solve", "json.gz")),
  ).toBeNull();
});

it("refuses a root the running suite is not inside", () => {
  // The exact mistake: the root taken from the shared package's own module rather
  // than from the case's. The suite is not under it, so there is no honest address
  // to return — and returning a plausible-looking one is what would make the
  // outputs vanish quietly.
  expect(() =>
    collecting("/media", () =>
      mediaDestination(PACKAGE_DIR, "solve", "json.gz"),
    ),
  ).toThrow(/not inside the validator project/);
  expect(() =>
    collecting("/media", () =>
      mediaDestination(PACKAGE_DIR, "solve", "json.gz"),
    ),
  ).toThrow(/dirname\(fileURLToPath\(import\.meta\.url\)\)/);
});

it("moves the whole address when the root is merely wrong rather than outside", () => {
  // A root ABOVE the project cannot be caught — the suite really is inside it —
  // and the address it produces is a perfectly well-formed path to somewhere the
  // runner will never look. This is the case the type makes unrepresentable
  // instead: `projectRoot` is required, and it comes from the case.
  const above = dirname(PROJECT_ROOT);
  const at = collecting("/media", () =>
    mediaDestination(above, "solve", "json.gz"),
  );

  expect(at).toBe(
    join(
      "/media",
      STAGED_PROJECT_DIR,
      "test",
      "media.spec.ts",
      "solve.json.gz",
    ),
  );
  expect(at).not.toBe(
    join("/media", STAGED_PROJECT_DIR, "media.spec.ts", "solve.json.gz"),
  );
});
