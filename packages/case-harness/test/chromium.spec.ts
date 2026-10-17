// Where the harness gets Playwright: from the package the runner names, and from
// nowhere else. The tree a project is staged into installs whatever Playwright
// the model's dependencies resolved, and a release launches only the Chromium
// revision it was released with, so a tree's Playwright asks for a browser the
// runner's host may never have installed.

import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { PLAYWRIGHT_ENV, importChromium } from "../src/chromium";

/** The package's own pinned Playwright, standing in for the runner's. */
const RUNNER_PLAYWRIGHT = dirname(
  createRequire(import.meta.url).resolve("playwright/package.json"),
);

const OPTIONS = { slug: "case-harness" };

it("loads chromium from the package the runner names", async () => {
  const chromium = await importChromium(OPTIONS, {
    [PLAYWRIGHT_ENV]: RUNNER_PLAYWRIGHT,
  });
  expect(chromium.name()).toBe("chromium");
});

it("refuses to fall back to the tree's Playwright when the runner names none", async () => {
  // The tree this suite runs in DOES install Playwright, so a fallback would
  // succeed here; the refusal is the point.
  await expect(importChromium(OPTIONS, {})).rejects.toThrow(
    `case-harness: the runner named no Playwright package (${PLAYWRIGHT_ENV} is unset)`,
  );
});

it("names the path when the runner's package cannot be resolved", async () => {
  const empty = mkdtempSync(join(tmpdir(), "case-harness-no-playwright-"));
  await expect(
    importChromium(OPTIONS, { [PLAYWRIGHT_ENV]: empty }),
  ).rejects.toThrow(`${PLAYWRIGHT_ENV}=${empty}`);
});
