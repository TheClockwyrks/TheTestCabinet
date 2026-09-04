// Floe — the one static server and the one browser every suite in this project
// shares. CASE-PROVIDED.
//
// WHY THERE IS A GLOBAL SETUP AT ALL. An engineless build is a static site, and
// there is nothing to import: the game is a bundle that runs in a browser, wires
// itself to a canvas and a keyboard, and installs `window.__floe`. So a check
// reaches it the only way anything reaches it — over HTTP, in Chromium. That is
// per-project scaffolding rather than per-suite: launching a browser costs a
// couple of hundred milliseconds and holding one costs a couple of hundred
// megabytes, and doing either two hundred times over is the difference between
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
import type { Browser } from "playwright";
import type { TestProject } from "vitest/node";
import { connectChromium, launchChromiumServer } from "./chromium";
import { HANDLE } from "./constants";

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
    `floe: no build output to serve — looked for ${BUILD_OUTPUTS.map(
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
    throw new Error("floe: the static server reported no port");
  }
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

/**
 * How long the probe below gives the build to load and install its surface.
 *
 * Two minutes, and it is spent ONCE for the whole project rather than once per
 * suite. It is not a measurement of anything: what it bounds is how long this
 * project waits before concluding that the build has no debug surface at all, and
 * that conclusion has to be safe against a host that is merely busy. A conforming
 * build resolves it in a second or two and never pays it.
 */
const SURFACE_PROBE_MS = 120_000;

/**
 * Whether the build installs its debug surface — asked ONCE, patiently, here.
 *
 * WHY THE ANSWER IS WORTH KNOWING UP FRONT. Every check opens a page and waits
 * for `window.__floe`, and the deadline on that wait is a WALL CLOCK on a host
 * this project does not own. Too short and a busy machine reports a conforming
 * build as one that installed no surface, which is a verdict about the host
 * wearing a build's name. Too long and a build that really has no surface costs
 * two hundred suites a deadline each, which is the whole run.
 *
 * Asking once settles both. A build that answers here is given a patient deadline
 * in every suite, which it never spends because its surface is already there; a
 * build that does not answer here is given a short one, because the question has
 * already been decided and the wait would buy nothing. See `harness.ts`'s
 * `browserBudget`.
 */
async function surfaceInstalls(
  browser: Browser,
  url: string,
): Promise<boolean> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: SURFACE_PROBE_MS });
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: SURFACE_PROBE_MS },
    );
    return true;
  } catch {
    return false;
  } finally {
    await context.close().catch(() => undefined);
  }
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const root = findBuildOutput();
  if (readdirSync(root).length === 0) {
    throw new Error(`floe: the build output at ${root} is empty`);
  }

  const { server, url } = await serve(root);
  const browser = await launchChromiumServer();

  project.provide("floeUrl", url);
  project.provide("floeBrowserWs", browser.wsEndpoint());
  // Asked here, once, over a connection of this process's own — the suites reach
  // the same browser through the endpoint above.
  const client = await connectChromium(browser.wsEndpoint());
  try {
    project.provide("floeSurfacePresent", await surfaceInstalls(client, url));
  } finally {
    await client.close().catch(() => undefined);
  }

  return async () => {
    await browser.close();
    await new Promise<void>((done) => server.close(() => done()));
  };
}
