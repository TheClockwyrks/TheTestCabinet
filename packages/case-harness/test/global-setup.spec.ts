// The one static server and the one browser the whole project shares — and the
// root it looks for the build under.
//
// THIS IS THE OTHER SILENT KILLER, and it is worse than the media one. The four
// cases derived the build root from `globalSetup.ts`'s own URL, which was correct
// while that file sat at the top of the staged project and wrong the moment the
// code moved into a package one directory deeper: it would name the staged
// project itself, find no `dist/`, and throw. `globalSetup` throwing does not
// fail one check — it takes down the whole project, so EVERY point a run's
// validators decide is left undecided. So the root is read off vitest's own
// `TestProject`, which is the value the project's `vitest.config.ts` already
// computed, and this module has no idea how deep in the tree it is sitting.

import { fileURLToPath } from "node:url";
import { expect, inject, it } from "vitest";
import { BUILD_OUTPUTS, findBuildOutput } from "../src/global-setup";

/** The root this project was given: the directory holding the fixture build. */
const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));

/** The shared package's own directory, where `global-setup.ts` actually lives. */
const PACKAGE_DIR = fileURLToPath(new URL("../src", import.meta.url));

it("probes the root it was handed", () => {
  expect(findBuildOutput(PROJECT_ROOT, "case-harness")).toBe(
    fileURLToPath(new URL("./build", import.meta.url)).replace(/\/$/, ""),
  );
});

it("finds nothing under the directory the module itself lives in", () => {
  // The whole point. Had the root stayed module-relative, THIS is the directory
  // it would have probed, and this is the failure every run would have taken.
  expect(() => findBuildOutput(PACKAGE_DIR, "case-harness")).toThrow(
    /no build output to serve/,
  );
  // And the failure names what was looked for and where, so the fix is readable
  // from the message rather than from the source.
  expect(() => findBuildOutput(PACKAGE_DIR, "case-harness")).toThrow(
    new RegExp(BUILD_OUTPUTS.map((name) => `${name}/`).join(", ")),
  );
  expect(() => findBuildOutput(PACKAGE_DIR, "case-harness")).toThrow(
    /case-harness:/,
  );
});

it("serves the build the project was rooted at", async () => {
  const url = inject("tcabUrl");
  const response = await fetch(url);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  // Never cached: two harnesses in one run load the same page and must both get
  // the tree as it is on disk now.
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain("__fixture");
});

it("serves a produced asset under a type the browser will play", async () => {
  // A full-stack build commits its own cues and beds, and a build that plays one
  // through an `<audio>` element rather than through a decoded buffer needs the
  // type to be right.
  const response = await fetch(new URL("silence.wav", inject("tcabUrl")));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("audio/wav");
});

it("answers 404 for a file the build did not produce", async () => {
  // Which the suite sees as a page error rather than as a hang.
  const response = await fetch(new URL("no-such-bundle.js", inject("tcabUrl")));

  expect(response.status).toBe(404);
});

it("serves nothing outside the tree it was pointed at", async () => {
  // The served root is the build output, and the repository sits above it. A
  // request that walks out of the tree gets a refusal or a miss, never a file.
  for (const path of [
    "../package.json",
    "..%2Fpackage.json",
    "%2e%2e/package.json",
    "%2e%2e%2f%2e%2e%2fpackage.json",
    "../../../../etc/passwd",
  ]) {
    const response = await fetch(new URL(path, inject("tcabUrl")));
    expect([403, 404], path).toContain(response.status);
    expect(await response.text(), path).not.toContain("@clockwyrks");
  }
});
