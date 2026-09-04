// Fathom — the one static server and the one browser every suite in this project
// shares. CASE-PROVIDED.
//
// WHY THERE IS A GLOBAL SETUP AT ALL. An engineless build is a static site, and
// there is nothing to import: the game is a bundle that runs in a browser, wires
// itself to a canvas and a keyboard, and installs `window.__fathom`. So a check
// reaches it the only way anything reaches it — over HTTP, in Chromium. That is
// per-project scaffolding rather than per-suite: launching a browser costs a
// couple of hundred milliseconds and holding one costs a couple of hundred
// megabytes, and doing either seventy-seven times over is the difference between
// a suite run that takes a minute and one that takes ten.
//
// So this runs ONCE, before any suite: it serves the build's output directory on
// a loopback port and starts a Chromium server. Vitest runs each suite file in a
// worker of its own, which shares no memory with this process, so both are handed
// over as addresses — a URL and a WebSocket endpoint — through vitest's `provide`,
// and `harness.ts` connects to the browser from inside each worker. One browser
// process for the whole project, and a page per harness inside it.
//
// WHAT IS SERVED. The directory `npm run build` produced, found the same way the
// case's own validator finds it (`dist`, then `build`, then `out`) so this suite
// and the runner never disagree about which tree is under test. The server is a
// few lines rather than a dependency because the build is a handful of static
// files with no routing: whatever is asked for is read off disk, and anything
// missing is a 404 the suite will see as a page error.

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { connectChromium, launchChromiumServer } from "./chromium";
import { ABSENCE_LOOKS, PAGE_DEADLINE_MS, waitForSurface } from "./surface";

/** Where `npm run build` may have put the site, in the order the runner looks. */
const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

/** Content types for what a Vite build emits. Anything else is served as bytes. */
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
};

/**
 * The workspace root: the directory the build was produced in.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place in both layouts this project lives in — the case's own
 * `validation/none/`, and the `validation/` the runner stages it to inside the
 * build's tree.
 */
const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);

/** The build output directory, or a failure naming what was looked for. */
function findBuildOutput(): string {
  for (const name of BUILD_OUTPUTS) {
    const candidate = join(WORKSPACE_ROOT, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `fathom: no build output to serve — looked for ${BUILD_OUTPUTS.map(
      (name) => `${name}/`,
    ).join(", ")} under ${WORKSPACE_ROOT}. Run \`npm run build\` first.`,
  );
}

/** Serve `root` as a static site on a loopback port the kernel chooses. */
async function serve(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const path = normalize(
      decodeURI(new URL(request.url ?? "/", "http://localhost").pathname),
    );
    const file = join(
      root,
      path === "/" || path.endsWith("/") ? `${path}/index.html` : path,
    );
    // Nothing outside the served tree, whatever the request asked for.
    if (!resolve(file).startsWith(resolve(root))) {
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
    throw new Error("fathom: the static server reported no port");
  }
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

/**
 * Whether this build installs no surface at all — the one question every check in
 * the project asks of it, asked once here instead of once per harness.
 *
 * WHY THE RUNNER ASKS IT. `harness.ts` gives the surface a whole minute to appear
 * because that ceiling is a wait on the HOST and must never fail a build for the
 * load average (`surface.ts` states the reasoning). Paid once per harness, that
 * same generosity is fatal in the other direction: a hundred and twenty-five
 * harnesses across four workers is over half an hour of waiting, past the cap on
 * the whole validator run, and a run stopped at that cap records every point as
 * `ran=false` — "the validators did not run" rather than "a hundred and six
 * requirements went unmet". A reviewer is told strictly less by the first.
 *
 * So the minute is spent here, where it is spent ONCE, on pages of this probe's
 * own and {@link ABSENCE_LOOKS} times before the answer is believed. A build that
 * installs its surface answers the first look the instant its entry module runs
 * and this costs the run one page load; a build that does not is failed on all
 * hundred and six points inside a couple of minutes, which is the verdict rather
 * than the absence of one.
 *
 * INCONCLUSIVE IS NOT ABSENT. Anything that goes wrong in the probe itself — a
 * page that will not open, a browser that will not connect — is reported as `false`
 * and leaves every harness to make its own full-ceiling reading, exactly as it
 * did before this existed. The probe can only ever save time; it can never be the
 * thing that fails a build.
 */
async function probeSurfaceAbsent(
  wsEndpoint: string,
  url: string,
): Promise<boolean> {
  try {
    const browser = await connectChromium(wsEndpoint);
    try {
      for (let look = 0; look < ABSENCE_LOOKS; look += 1) {
        const page = await browser.newPage();
        try {
          // The probe's own page is off Playwright's thirty-second defaults for
          // the same reason a harness's is: they are deadlines on the host.
          page.setDefaultTimeout(PAGE_DEADLINE_MS);
          page.setDefaultNavigationTimeout(PAGE_DEADLINE_MS);
          await page.goto(url, { waitUntil: "load" });
          if (await waitForSurface(page)) return false;
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

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const root = findBuildOutput();
  if (readdirSync(root).length === 0) {
    throw new Error(`fathom: the build output at ${root} is empty`);
  }

  const { server, url } = await serve(root);
  const browser = await launchChromiumServer();

  project.provide("fathomUrl", url);
  project.provide("fathomBrowserWs", browser.wsEndpoint());
  project.provide(
    "fathomSurfaceAbsent",
    await probeSurfaceAbsent(browser.wsEndpoint(), url),
  );

  return async () => {
    await browser.close();
    await new Promise<void>((done) => server.close(() => done()));
  };
}
