#!/usr/bin/env node
// Headless-browser driver for The Test Cabinet's validator.
//
// One tool serves two jobs, because both are "open a page at a fixed viewport,
// optionally drive it, and screenshot it":
//
//   * Render a reference mockup    — `--url file://…/menu.html` with no actions.
//   * Capture a produced build     — `--url http://127.0.0.1:PORT/` plus the
//                                     actions that drive it into the view.
//
// Usage:
//   node driver.mjs --url <url> --out <png> [--actions <json>]
//                   [--width <px>] [--height <px>] [--settle <ms>]
//
// `--actions` is a JSON array of steps, each one of:
//   { "type": "wait", "ms": 500 }            pause
//   { "type": "key",  "key": "Enter" }       press and release a key
//   { "type": "hold", "key": "ArrowUp",      hold a key down for a duration
//                     "ms": 300 }
//   { "type": "click", "x": 640, "y": 360 }  click a logical-pixel point
//
// Key names are Playwright key names (e.g. `Enter`, `ArrowUp`, `w`, `Escape`).

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Import Playwright's `chromium`, resolving the package across the layouts our
 * supported hosts produce:
 *
 *   * A walkable `node_modules/playwright` (an `npm install` in the devcontainer
 *     or CI) — a bare `import "playwright"` already finds this.
 *   * Playwright provided only on `NODE_PATH`, as Nix's `playwright-driver`
 *     exposes it. ESM bare-specifier resolution does *not* consult `NODE_PATH`,
 *     so a static `import "playwright"` throws `ERR_MODULE_NOT_FOUND` on such a
 *     host even though the package is right there. CommonJS `require.resolve`
 *     *does* honor `NODE_PATH`, so we resolve through `createRequire` and import
 *     the resolved absolute path — covering the `node_modules` layout too.
 *   * Only `playwright-core` present — it carries the browser automation and,
 *     unlike the full `playwright` package, has no browser-download postinstall,
 *     so it installs cleanly on hosts where that postinstall cannot.
 *
 * The resolved module may be CommonJS; under dynamic `import()` its exports can
 * surface either as named exports or under `default`, so both are checked.
 */
async function importChromium() {
  const require = createRequire(import.meta.url);
  const failures = [];
  for (const pkg of ["playwright", "playwright-core"]) {
    try {
      const entry = require.resolve(pkg);
      const ns = await import(pathToFileURL(entry).href);
      const chromium = ns.chromium ?? ns.default?.chromium;
      if (chromium) {
        return chromium;
      }
      failures.push(`${pkg}: resolved (${entry}) but exposes no \`chromium\``);
    } catch (err) {
      failures.push(`${pkg}: ${err?.message || err}`);
    }
  }
  throw new Error(
    `could not load Playwright (install it, or point NODE_PATH at it); tried:\n${failures
      .map((line) => `  - ${line}`)
      .join("\n")}`,
  );
}

/** Parse `--flag value` pairs into a plain object. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

/**
 * Discover Chromium binaries Playwright has already downloaded, newest first.
 *
 * Playwright resolves the browser for the *exact* revision its own version
 * pins; when the installed build is a different revision (or uses the newer
 * `chrome-linux64` layout), that resolution misses even though a perfectly good
 * Chromium is sitting in the cache. This scans the cache directory for any full
 * `chromium-<rev>` build with a real `chrome` binary so the launch can fall back
 * to it. Both the legacy `chrome-linux` and current `chrome-linux64` layouts are
 * checked; the highest revision wins.
 */
function discoverCachedChromium() {
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(os.homedir(), ".cache", "ms-playwright");

  let entries;
  try {
    entries = fs.readdirSync(base);
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    // Only full Chromium builds (`chromium-<rev>`), not `chromium_headless_shell`.
    const match = /^chromium-(\d+)$/.exec(entry);
    if (!match) {
      continue;
    }
    for (const layout of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const candidate = path.join(base, entry, layout);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        candidates.push({ revision: Number(match[1]), path: candidate });
      } catch {
        // Not present in this layout; try the next.
      }
    }
  }

  candidates.sort((a, b) => b.revision - a.revision);
  return candidates.map((candidate) => candidate.path);
}

/**
 * Launch Chromium, trying each strategy in order of preference and falling back
 * on failure:
 *
 *  1. `TCAB_CHROMIUM_EXECUTABLE` — an explicit Chromium binary. Managed installs
 *     whose on-disk layout does not match what Playwright's path resolution
 *     expects (notably Nix's `playwright-driver.browsers`) can fail to find the
 *     bundled browser; pointing straight at a real Chromium (for example
 *     `${pkgs.chromium}/bin/chromium`) sidesteps that entirely.
 *  2. `channel: "chromium"` — the full bundled Chromium in the new headless mode,
 *     rather than Playwright's default `chromium-headless-shell` (a separate
 *     download some installs omit). This is what resolves on a host whose cache
 *     matches Playwright's pinned revision.
 *  3. Any cached `chromium-<rev>` build found on disk, newest first — covers an
 *     environment whose installed Chromium revision differs from the one
 *     Playwright pins (e.g. a newer `chrome-linux64` build in a container).
 *
 * Earlier strategies keep working exactly as before; the cache fallback only
 * runs when they fail, so existing hosts are unaffected.
 */
async function launchBrowser(chromium) {
  const attempts = [];
  const explicit = process.env.TCAB_CHROMIUM_EXECUTABLE;
  if (explicit) {
    attempts.push({ label: `TCAB_CHROMIUM_EXECUTABLE (${explicit})`, options: { executablePath: explicit } });
  }
  attempts.push({ label: 'channel "chromium"', options: { channel: "chromium" } });
  for (const cached of discoverCachedChromium()) {
    attempts.push({ label: `cached Chromium (${cached})`, options: { executablePath: cached } });
  }

  const failures = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ args: ["--no-sandbox"], ...attempt.options });
    } catch (err) {
      failures.push(`  - ${attempt.label}: ${err?.message || err}`);
    }
  }
  throw new Error(`could not launch Chromium; tried:\n${failures.join("\n")}`);
}

/** Run one action step against the page. */
async function runStep(page, step) {
  switch (step.type) {
    case "wait":
      await page.waitForTimeout(Number(step.ms) || 0);
      break;
    case "key":
      await page.keyboard.press(String(step.key));
      break;
    case "hold":
      await page.keyboard.down(String(step.key));
      await page.waitForTimeout(Number(step.ms) || 0);
      await page.keyboard.up(String(step.key));
      break;
    case "click":
      await page.mouse.click(Number(step.x) || 0, Number(step.y) || 0);
      break;
    default:
      throw new Error(`unknown action step type: ${JSON.stringify(step.type)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.out) {
    throw new Error("both --url and --out are required");
  }

  const width = Number(args.width) || 1280;
  const height = Number(args.height) || 720;
  // A short settle pause after load (and after the actions) lets a first
  // animation frame paint and webfonts settle before the screenshot.
  const settle = args.settle === undefined ? 400 : Number(args.settle);

  const actions = args.actions ? JSON.parse(args.actions) : [];
  if (!Array.isArray(actions)) {
    throw new Error("--actions must be a JSON array");
  }

  // Load Playwright first (see `importChromium` for why a bare import is not
  // enough on every host), then choose and launch the browser binary, falling
  // back across strategies so the same driver works on hosts whose Chromium
  // matches Playwright's pinned revision and in environments where it does not.
  // See `launchBrowser`.
  const chromium = await importChromium();
  const browser = await launchBrowser(chromium);
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    // `load` rather than `networkidle`: a game loop keeps the network quiet but
    // never idles in the sense Playwright waits for, and self-contained builds
    // have nothing left to fetch once loaded.
    await page.goto(args.url, { waitUntil: "load", timeout: 30_000 });
    if (settle > 0) {
      await page.waitForTimeout(settle);
    }
    for (const step of actions) {
      await runStep(page, step);
    }
    if (settle > 0) {
      await page.waitForTimeout(settle);
    }
    // Encode as PNG explicitly rather than letting Playwright infer the format
    // from the path's extension: the validator captures to a temp file (e.g.
    // `.view.png.<uuid>.tmp`) and atomically renames it into place, so the path
    // handed to `--out` does not necessarily end in `.png`.
    await page.screenshot({ path: args.out, type: "png" });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
