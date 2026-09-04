// The one static server and the one browser every suite in a case's validator
// project shares.
//
// WHY THERE IS A GLOBAL SETUP AT ALL. An engineless build is a static site, and
// there is nothing to import: the game is a bundle that runs in a browser, wires
// itself to a canvas and a keyboard, and installs its debug surface on a window
// global. So a check reaches it the only way anything reaches it — over HTTP, in
// Chromium. That is per-project scaffolding rather than per-suite: launching a
// browser costs a couple of hundred milliseconds and holding one costs a couple
// of hundred megabytes, and doing either eighty times over is the difference
// between a suite run that takes a minute and one that takes ten.
//
// So this runs ONCE, before any suite: it serves the build's output directory on
// a loopback port and starts a Chromium server. Vitest runs each suite file in a
// worker of its own, which shares no memory with this process, so both are handed
// over as ADDRESSES — a URL and a WebSocket endpoint — through vitest's
// `provide`, and the harness connects to the browser from inside each worker. One
// browser process for the whole project, and a page per harness inside it.
//
// WHAT IS SERVED. The directory `npm run build` produced, found the same way the
// case's own validator finds it (`dist`, then `build`, then `out`) so this project
// and the runner never disagree about which tree is under test. The server is a
// few lines rather than a dependency because the build is a handful of static
// files with no routing: whatever is asked for is read off disk, and anything
// missing is a 404 the suite will see as a page error.
//
// THE ONE QUESTION THIS ALSO ANSWERS. Everything above is scaffolding, but there
// is a single reading about the BUILD that is far cheaper here than in a worker:
// whether it installs a debug surface at all. Every harness has to know, and the
// ceiling it waits under is deliberately generous, so a surfaceless build would
// have a whole project's worth of harnesses each waiting it out — which is how a
// run stops being "a hundred and six requirements went unmet" and starts being
// "the validators did not run". So `probeSurfaceAbsent` buys the answer once,
// here, on pages of its own, and hands it to the workers with the addresses.
//
// WHERE THE BUILD ROOT COMES FROM, AND WHY IT IS NOT THIS FILE'S URL. Each of the
// four cases this was extracted from derived it as `resolve(dirname(import.meta.url), "..")`
// — correct while the file sat at the top of the staged project, and wrong the
// moment it moved into a package one directory deeper, where it would name the
// staged project itself and find no build output at all. That failure is not a
// quiet one: `globalSetup` throwing takes down the whole project, so every point
// a run's validators decide is left undecided. Vitest hands the setup its
// `TestProject`, whose `config.root` is exactly the root the project's own
// `vitest.config.ts` computed — so the root is READ rather than derived, and this
// module has no idea how deep in the tree it is sitting.

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { TestProject } from "vitest/node";
import { connectChromium, launchChromiumServer } from "./chromium";
import {
  DEFAULT_SURFACE_TIMEOUT_MS,
  PROVIDE_SURFACE_ABSENT_KEY,
  PROVIDE_URL_KEY,
  PROVIDE_WS_KEY,
} from "./config";
import { ABSENCE_LOOKS, waitForSurface } from "./surface";

/** Where `npm run build` may have put the site, in the order the runner looks. */
export const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

/**
 * Content types for what a Vite build emits, and for the produced files a
 * full-stack build commits beside it. Anything else is served as bytes.
 *
 * The audio entries are the superset one of the four cases needs and the other
 * three never ask for: a full-stack build commits its own cues and beds
 * (`specs/assets.md`), and a build that plays one through an `<audio>` element
 * rather than through a decoded buffer needs the type to be right. Serving them
 * to a case that produces none costs that case nothing.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mid": "audio/midi",
};

/**
 * The build output directory under `workspaceRoot`, or a failure naming what was
 * looked for.
 *
 * `workspaceRoot` is a PARAMETER — the whole point of this module. Exported so
 * the package's own suite can prove it probes the root it was handed rather than
 * anything derived from this file's own location.
 */
export function findBuildOutput(workspaceRoot: string, slug: string): string {
  for (const name of BUILD_OUTPUTS) {
    const candidate = join(workspaceRoot, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `${slug}: no build output to serve — looked for ${BUILD_OUTPUTS.map(
      (name) => `${name}/`,
    ).join(", ")} under ${workspaceRoot}. Run \`npm run build\` first.`,
  );
}

/** Serve `root` as a static site on a loopback port the kernel chooses. */
async function serve(
  root: string,
  slug: string,
): Promise<{ server: Server; url: string }> {
  const served = resolve(root);
  const server = createServer((request, response) => {
    const path = normalize(
      decodeURI(new URL(request.url ?? "/", "http://localhost").pathname),
    );
    const file = join(
      root,
      path === "/" || path.endsWith("/") ? `${path}/index.html` : path,
    );
    // Nothing outside the served tree, whatever the request asked for. The
    // comparison is on a path SEGMENT rather than on a string prefix, so a
    // sibling directory whose name merely starts with the served one's is outside
    // it too.
    const at = resolve(file);
    if (at !== served && !at.startsWith(served + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    readFile(file).then(
      (body) => {
        response.writeHead(200, {
          "content-type":
            CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        response.end(body);
      },
      () => {
        response.writeHead(404).end("not found");
      },
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(`${slug}: the static server reported no port`);
  }
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

/** Who to name in a failure, so a reviewer knows whose validators could not run. */
export interface GlobalSetupOptions {
  /** The case's slug, which prefixes every message this prints. */
  readonly slug: string;
  /**
   * The page global an engineless build installs its debug surface on — the same
   * string the case's `CaseConfig.handle` carries.
   *
   * OPTIONAL, AND WHAT IT BUYS IS TIME RATHER THAN A VERDICT. Given it, this
   * setup runs {@link probeSurfaceAbsent} and the workers are handed a run-wide
   * answer. Omitted, the answer provided is `false` and every harness makes its
   * own full-ceiling reading, exactly as it did before the probe existed — which
   * is also what the package's own suite does, since its fixture build is not a
   * case and has no handle of its own.
   *
   * It is stated here rather than read off the case's config because this module
   * is loaded by vite's config path, before the test runtime exists: importing a
   * case's `harness.ts` to reach its config would drag the whole harness into the
   * one bundle whose failure mode is "the project would not load at all".
   */
  readonly handle?: string;
  /**
   * The ceiling one look of the probe waits under, matching the case's
   * `CaseConfig.surfaceTimeoutMs`.
   *
   * A probe that waited LESS than a harness does could call a slow build
   * surfaceless and have every harness agree with it without checking, so a case
   * that raised its own ceiling must raise this one with it. Defaults to
   * {@link DEFAULT_SURFACE_TIMEOUT_MS}, which is what a case that states no
   * ceiling of its own gets in the worker too.
   */
  readonly surfaceTimeoutMs?: number;
}

/**
 * Whether this build installs no surface at all — the one question every check in
 * a project asks of it, asked once here instead of once per harness.
 *
 * WHY THE RUNNER ASKS IT. A harness gives the surface the case's whole ceiling
 * because that ceiling is a wait on the HOST and must never fail a build for the
 * load average (`surface.ts` states the reasoning). Paid once per harness, that
 * same generosity is fatal in the other direction: Carom's project is 147 suite
 * files and more harnesses than that, so 15s apiece over eight workers is some
 * five minutes of pure waiting, and Gantry's 90s ceiling would be nearly half an
 * hour. There is a cap on the whole validator run, and a run stopped at it records
 * every point as `ran=false` — "the validators did not run" rather than "a hundred
 * and six requirements went unmet". A reviewer is told strictly less by the first.
 *
 * So the ceiling is spent here, where it is spent ONCE, on pages of this probe's
 * own and {@link ABSENCE_LOOKS} times before the answer is believed. A build that
 * installs its surface answers the first look the instant its entry module runs
 * and this costs the run one page load; a build that does not is failed on every
 * point inside a couple of minutes, which is a verdict rather than the absence of
 * one.
 *
 * INCONCLUSIVE IS NOT ABSENT. Anything that goes wrong in the probe itself — no
 * handle to look for, a browser that will not connect, a page that will not open
 * — is reported as `false` and leaves every harness to make its own full-ceiling
 * reading. The probe can only ever save time; it can never be the thing that
 * fails a build.
 */
async function probeSurfaceAbsent(
  wsEndpoint: string,
  url: string,
  options: GlobalSetupOptions,
): Promise<boolean> {
  const handle = options.handle;
  if (handle === undefined) return false;
  const timeoutMs = options.surfaceTimeoutMs ?? DEFAULT_SURFACE_TIMEOUT_MS;
  try {
    const browser = await connectChromium(wsEndpoint, { slug: options.slug });
    try {
      for (let look = 0; look < ABSENCE_LOOKS; look += 1) {
        const page = await browser.newPage();
        try {
          // A navigation that does not complete is inconclusive rather than
          // absent: it throws out of here and the whole probe answers `false`.
          // A run-wide claim must not rest on a page that never arrived.
          await page.goto(url, { waitUntil: "load" });
          if (await waitForSurface(page, handle, timeoutMs)) return false;
        } finally {
          await page.close();
        }
      }
      return true;
    } finally {
      await browser.close();
    }
  } catch {
    return false;
  }
}

/** What a case's `globalSetup.ts` default-exports. */
export type GlobalSetup = (
  project: TestProject,
) => Promise<() => Promise<void>>;

/**
 * Build the `globalSetup` a case's validator project default-exports:
 *
 * ```ts
 * // validation/none/globalSetup.ts
 * import { makeGlobalSetup } from "./case-harness/global-setup";
 * export default makeGlobalSetup({ slug: "refract", handle: "__refract" });
 * ```
 *
 * The handle is stated again here rather than imported from the case's
 * `harness.ts` for the reason the whole file exists in isolation: see
 * {@link GlobalSetupOptions.handle}.
 *
 * Imported from its own module rather than through the package's barrel, because
 * this file is loaded by vite's config path before the test runtime exists and
 * the barrel would drag the whole package — the harness, the media writer, the
 * assertions — into the one bundle whose failure mode is "the config would not
 * load".
 */
export function makeGlobalSetup(options: GlobalSetupOptions): GlobalSetup {
  return async function setup(
    project: TestProject,
  ): Promise<() => Promise<void>> {
    // Read from the project, never derived from this file's URL. See the header.
    const root = findBuildOutput(project.config.root, options.slug);
    if (readdirSync(root).length === 0) {
      throw new Error(`${options.slug}: the build output at ${root} is empty`);
    }

    const { server, url } = await serve(root, options.slug);
    const browser = await launchChromiumServer({ slug: options.slug });

    project.provide(PROVIDE_URL_KEY, url);
    project.provide(PROVIDE_WS_KEY, browser.wsEndpoint());
    // Always provided, even when it was never probed for, so a worker reading it
    // gets a boolean rather than `undefined` from a project that did not ask.
    project.provide(
      PROVIDE_SURFACE_ABSENT_KEY,
      await probeSurfaceAbsent(browser.wsEndpoint(), url, options),
    );

    return async () => {
      await browser.close();
      await new Promise<void>((done) => server.close(() => done()));
    };
  };
}
