// assets/site — serving the built site under conditions the shared server
// never varies.
//
// One review item in this category is about HOW the built site is served:
// specs/assets.md requires that "the site runs unchanged whether it is served
// from the root of a static host or mounted under a sub-path". The project's
// shared server (`globalSetup.ts`) serves `dist/` at the root, so that suite
// brings its own: the same handful of lines, with the one knob the requirement
// varies — the path the site is mounted under. Every produced file is served
// exactly as the shared server serves it. The page opens in the project's one
// shared Chromium, in a context of this module's own that is closed with the
// site.

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { inject } from "vitest";
import type { Browser, Page } from "playwright";
import { connectChromium } from "../chromium";
import { WORKSPACE } from "./media-out";

/** The case this project validates, which prefixes what the harness prints. */
const SLUG = "kessler";

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

/** The build output, found the way `globalSetup.ts` finds it. */
function buildOutput(): string {
  for (const name of ["dist", "build", "out"]) {
    const candidate = join(WORKSPACE, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("kessler: no build output (dist/, build/, out/) to serve");
}

/** One request the page made to this site's own origin. */
export interface SiteRequest {
  /** The URL's path, e.g. `/mounted/deep/assets/planet-abc.png`. */
  path: string;
  /** The response's status, or `null` when the request never got one. */
  status: number | null;
}

export interface Site {
  page: Page;
  /** Every same-origin request the page made, in order. */
  requests: SiteRequest[];
  close(): Promise<void>;
}

export interface SiteOptions {
  /** The path the site is mounted under, e.g. `/mounted/deep/`. Default `/`. */
  prefix?: string;
}

/**
 * Serve the build output on a loopback port — optionally mounted under a
 * sub-path — and open it in a fresh page of the project's shared Chromium.
 */
export async function openSite(options: SiteOptions = {}): Promise<Site> {
  const prefix = options.prefix ?? "/";
  const root = buildOutput();

  const server: Server = createServer((request, response) => {
    const path = normalize(
      decodeURI(new URL(request.url ?? "/", "http://localhost").pathname),
    );
    if (path === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    if (!path.startsWith(prefix)) {
      response.writeHead(404).end("not found");
      return;
    }
    const under = path.slice(prefix.length);
    const file = join(
      root,
      under === "" || under.endsWith("/") ? `${under}index.html` : under,
    );
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
      () => response.writeHead(404).end("not found"),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("kessler: the static server reported no port");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  const browser: Browser = await connectChromium(inject("kesslerBrowserWs"), {
    slug: SLUG,
  });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const requests: SiteRequest[] = [];
  page.on("requestfinished", async (request) => {
    if (!request.url().startsWith(origin)) return;
    const response = await request.response();
    requests.push({
      path: new URL(request.url()).pathname,
      status: response?.status() ?? null,
    });
  });
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(origin)) return;
    requests.push({ path: new URL(request.url()).pathname, status: null });
  });
  await page.goto(`${origin}${prefix}`, { waitUntil: "load" });

  return {
    page,
    requests,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
