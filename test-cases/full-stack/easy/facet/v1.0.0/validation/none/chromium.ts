// Facet — finding and launching Chromium. CASE-PROVIDED.
//
// The build is a static site, so every check runs in a real browser, and this is
// the part that has to work on every host these validators run on: the
// devcontainer, CI, and the worker that runs a case's toolchain after a run's
// container is gone. The strategies below are the ones
// `packages/browser-driver/driver.mjs` established, kept here because a case's
// validator project is staged into the build's tree and can depend only on what
// that tree installs.
//
// The tree installs `playwright`, which the case's seeded `package.json` declares
// — the same dependency an engineless build is given for its own browser checks.

import { createRequire } from "node:module";
import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserServer, BrowserType } from "playwright";

/**
 * Import Playwright's `chromium`, across the layouts our hosts produce.
 *
 * A walkable `node_modules/playwright` is what `npm ci` leaves in the build's
 * tree and a bare import already finds it. `playwright-core` is the fallback for
 * a host that installs the automation without the browser-download postinstall.
 * Both are resolved through `createRequire` rather than imported by specifier,
 * because CommonJS resolution honors `NODE_PATH` and ESM bare-specifier
 * resolution does not — which is how Nix's `playwright-driver` exposes the
 * package.
 */
async function importChromium(): Promise<BrowserType> {
  const require = createRequire(import.meta.url);
  const failures: string[] = [];
  for (const pkg of ["playwright", "playwright-core"]) {
    try {
      const entry = require.resolve(pkg);
      const namespace = (await import(pathToFileURL(entry).href)) as {
        chromium?: BrowserType;
        default?: { chromium?: BrowserType };
      };
      const chromium = namespace.chromium ?? namespace.default?.chromium;
      if (chromium) return chromium;
      failures.push(`${pkg}: resolved (${entry}) but exposes no \`chromium\``);
    } catch (error) {
      failures.push(
        `${pkg}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `facet: could not load Playwright (install it, or point NODE_PATH at it); tried:\n${failures
      .map((line) => `  - ${line}`)
      .join("\n")}`,
  );
}

/**
 * Chromium builds Playwright has already downloaded, newest first.
 *
 * Playwright resolves the browser for the exact revision its own version pins;
 * when the installed build is a different revision, or uses the newer
 * `chrome-linux64` layout, that resolution misses although a perfectly good
 * Chromium is sitting in the cache.
 */
function cachedChromium(): string[] {
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(homedir(), ".cache", "ms-playwright");
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  const found: { revision: number; path: string }[] = [];
  for (const name of names) {
    // Full Chromium builds alone (`chromium-<rev>`), not the headless shell.
    const match = /^chromium-(\d+)$/.exec(name);
    if (!match) continue;
    for (const layout of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const candidate = join(base, name, layout);
      try {
        accessSync(candidate, constants.X_OK);
        found.push({ revision: Number(match[1]), path: candidate });
      } catch {
        // Not present in this layout; try the next.
      }
    }
  }
  found.sort((a, b) => b.revision - a.revision);
  return found.map((entry) => entry.path);
}

/**
 * The flags every launch strategy uses.
 *
 * `--no-sandbox` because these run in containers without the kernel namespaces
 * Chromium's sandbox needs; nothing untrusted is loaded, only the build under
 * test. `--disable-dev-shm-usage` because a container's default `/dev/shm` is too
 * small for Chromium's shared memory and a page dies of it rather than saying so.
 *
 * The other three are load-bearing for one check, and it is worth naming which.
 * Chromium throttles a page it believes nobody is looking at: its timers are
 * slowed and its animation frame is all but stopped. The project holds several
 * pages open at once so the suites can overlap, and only one of them can be the
 * foreground page — so without these, every other page's frame loop is throttled
 * by the BROWSER, and `gameplay/advances-in-real-time`, whose whole subject is
 * the build's own loop running in real time, reads a build that is running
 * perfectly well as one that froze. Turning the throttling off is not indulgence
 * toward the build: it removes an artifact of how this project schedules its
 * pages from a measurement of what the build does with a second of real time.
 */
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];

/**
 * Launch Chromium as a SERVER, so every suite worker can connect to the one
 * browser process this project holds.
 *
 * The strategies are tried in order and fall back on failure: an explicitly named
 * binary, the bundled full Chromium under `channel: "chromium"`, then any cached
 * build on disk, newest first.
 */
export async function launchChromiumServer(): Promise<BrowserServer> {
  const chromium = await importChromium();
  const attempts: { label: string; options: Record<string, unknown> }[] = [];
  const explicit = process.env.TCAB_CHROMIUM_EXECUTABLE;
  if (explicit) {
    attempts.push({
      label: `TCAB_CHROMIUM_EXECUTABLE (${explicit})`,
      options: { executablePath: explicit },
    });
  }
  attempts.push({
    label: 'channel "chromium"',
    options: { channel: "chromium" },
  });
  for (const cached of cachedChromium()) {
    attempts.push({
      label: `cached Chromium (${cached})`,
      options: { executablePath: cached },
    });
  }

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launchServer({
        args: CHROMIUM_ARGS,
        ...attempt.options,
      });
    } catch (error) {
      failures.push(
        `  - ${attempt.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `facet: could not launch Chromium; tried:\n${failures.join("\n")}`,
  );
}

/** Connect to the browser `globalSetup` launched, from inside a suite worker. */
export async function connectChromium(wsEndpoint: string) {
  const chromium = await importChromium();
  return chromium.connect(wsEndpoint);
}
