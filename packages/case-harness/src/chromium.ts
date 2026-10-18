// Finding and launching Chromium.
//
// An engineless build is a static site, so every check runs in a real browser,
// and this is the part that has to work on every host these validators run on:
// the devcontainer, CI, and the worker that runs a case's toolchain after a run's
// container is gone. The strategies below are the ones
// `packages/browser-driver/driver.mjs` established.
//
// Playwright itself comes from the RUNNER, never from the tree this project is
// staged into. A Playwright release launches only the Chromium revision it was
// released with, the runner's host installs the revision of the browser driver's
// own pinned Playwright, and the build's dependencies are the model's to choose:
// a tree that resolved a newer Playwright would ask for a browser the host never
// installed. The runner names its package in `TCAB_PLAYWRIGHT`, and this package
// depends on Playwright for TYPES only.

import { createRequire } from "node:module";
import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserServer, BrowserType } from "playwright";

/** Who to name in a failure, so a reviewer knows whose validators could not run. */
export interface ChromiumOptions {
  /** The case's slug, which prefixes every message. */
  readonly slug: string;
}

/**
 * The environment variable the runner names its own Playwright package in: the
 * absolute path of the package's directory.
 */
export const PLAYWRIGHT_ENV = "TCAB_PLAYWRIGHT";

/**
 * Import Playwright's `chromium` from the package the runner names in
 * {@link PLAYWRIGHT_ENV}, and from nowhere else.
 *
 * The runner leaves the variable unset when it has no Playwright of its own, and
 * that is reported rather than papered over with the tree's: the tree's would
 * reintroduce exactly the version drift the variable exists to remove.
 */
export async function importChromium(
  options: ChromiumOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrowserType> {
  const dir = env[PLAYWRIGHT_ENV];
  if (!dir) {
    throw new Error(
      `${options.slug}: the runner named no Playwright package (${PLAYWRIGHT_ENV} is unset), so the build could not be driven in a browser`,
    );
  }
  let entry: string;
  try {
    entry = createRequire(join(dir, "package.json")).resolve(dir);
  } catch (error) {
    throw new Error(
      `${options.slug}: could not resolve the runner's Playwright package at ${PLAYWRIGHT_ENV}=${dir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const namespace = (await import(pathToFileURL(entry).href)) as {
    chromium?: BrowserType;
    default?: { chromium?: BrowserType };
  };
  const chromium = namespace.chromium ?? namespace.default?.chromium;
  if (!chromium) {
    throw new Error(
      `${options.slug}: the runner's Playwright package (${entry}) exposes no \`chromium\``,
    );
  }
  return chromium;
}

/**
 * The directory layouts a Chromium build is unpacked into, per platform: x86-64
 * (current and older), and arm64.
 */
const CHROMIUM_LAYOUTS: readonly string[] = [
  "chrome-linux64/chrome",
  "chrome-linux/chrome",
  "chrome-linux-arm64/chrome",
];

/**
 * Chromium builds Playwright has already downloaded, newest first.
 *
 * Playwright resolves the browser for the exact revision its own version pins;
 * when the installed build is a different revision, or uses a layout that
 * resolution does not expect, it misses although a perfectly good Chromium is
 * sitting in the cache.
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
    for (const layout of CHROMIUM_LAYOUTS) {
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
 * slowed and its animation frame is all but stopped. A project holds several
 * pages open at once so the suites can overlap, and only one of them can be the
 * foreground page — so without these, every other page's frame loop is throttled
 * by the BROWSER, and the check whose whole subject is the build's own loop
 * running in real time reads a build that is running perfectly well as one that
 * froze. Turning the throttling off is not indulgence toward the build: it
 * removes an artifact of how this project schedules its pages from a measurement
 * of what the build does with a second of real time.
 */
export const CHROMIUM_ARGS: readonly string[] = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];

/**
 * How long Chromium is given to come up, in milliseconds.
 *
 * Playwright's own default here is thirty seconds, and that is a deadline on the
 * HOST: starting a browser is process creation, a sandbox and a first paint, all
 * of which the machine's other work slows down, and none of which is a claim
 * about the build being validated. This launch happens once in `globalSetup`, so
 * crossing that default does not cost a point — it fails the whole project before
 * a single check runs, and every point it decides reads `ran=false`, which is the
 * least informative outcome a validator has.
 *
 * Five minutes, which is the ceiling `vitest-config.ts` gives a check, and which a
 * browser that starts pays none of because `launchServer` returns the moment it is
 * up. The one thing it must stay is FINITE, so a host with no usable Chromium at
 * all still falls through to the next strategy and then to the error below rather
 * than hanging.
 */
export const LAUNCH_TIMEOUT_MS = 300_000;

/**
 * How long a suite worker is given to reach the browser `globalSetup` started.
 *
 * Playwright leaves this one with NO deadline at all, which is the same defect
 * from the other side: a worker that can never reach the browser waits until
 * vitest's hook budget runs out, and what a reviewer is then shown is a hook that
 * expired rather than a browser that was unreachable.
 *
 * Thirty seconds. The endpoint is a loopback WebSocket handshake to a process
 * this project has already watched come up, which costs milliseconds, so this is
 * three orders of magnitude of headroom; and it sits well inside the hook budget
 * `vitest-config.ts` states, so the account a reviewer reads is this project's
 * rather than vitest's. A worker that crosses it has learned nothing about the
 * build, and {@link connectChromium}'s caller reports it as the host fault it is.
 */
export const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Launch Chromium as a SERVER, so every suite worker can connect to the one
 * browser process this project holds.
 *
 * The strategies are tried in order and fall back on failure: an explicitly named
 * binary, the bundled full Chromium under `channel: "chromium"`, then any cached
 * build on disk, newest first.
 */
export async function launchChromiumServer(
  options: ChromiumOptions,
): Promise<BrowserServer> {
  const chromium = await importChromium(options);
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
        args: [...CHROMIUM_ARGS],
        timeout: LAUNCH_TIMEOUT_MS,
        ...attempt.options,
      });
    } catch (error) {
      failures.push(
        `  - ${attempt.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `${options.slug}: could not launch Chromium; tried:\n${failures.join("\n")}`,
  );
}

/** Connect to the browser `globalSetup` launched, from inside a suite worker. */
export async function connectChromium(
  wsEndpoint: string,
  options: ChromiumOptions,
): Promise<Browser> {
  const chromium = await importChromium(options);
  return chromium.connect(wsEndpoint, { timeout: CONNECT_TIMEOUT_MS });
}
