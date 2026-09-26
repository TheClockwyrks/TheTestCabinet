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
import type { Browser, Page, Request } from "playwright";
// The endpoint key is the shared harness's and fixed there: a per-case key
// could not be declared once for a program that type-checks two cases together,
// which is exactly what the per-case keys were trying to avoid.
import { PROVIDE_WS_KEY } from "../case-harness/config";
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
  /** Every same-origin request the page made and was answered on, in order. */
  requests: SiteRequest[];
  /**
   * Resolve once no same-origin request the page opened is still unanswered,
   * so `requests` holds every URL the page has asked for so far. The wait is
   * bounded as a failure cap alone: a request still unanswered at the cap is
   * appended with no status, and the caller reads it as the failure it is.
   */
  settled(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The failure cap on {@link Site.settled}: a request the static server has not
 * answered in this long is never going to be, and is read as unanswered.
 */
const SETTLE_CAP_MS = 10_000;

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

  const browser: Browser = await connectChromium(inject(PROVIDE_WS_KEY), {
    slug: SLUG,
  });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const requests: SiteRequest[] = [];
  /** The same-origin requests the page has opened and not yet been answered on. */
  const inFlight = new Map<Request, string>();
  let onDrained: (() => void) | null = null;
  const answered = (request: Request, status: number | null): void => {
    inFlight.delete(request);
    requests.push({ path: new URL(request.url()).pathname, status });
    if (inFlight.size === 0 && onDrained !== null) onDrained();
  };
  page.on("request", (request) => {
    if (!request.url().startsWith(origin)) return;
    inFlight.set(request, new URL(request.url()).pathname);
  });
  page.on("requestfinished", async (request) => {
    if (!request.url().startsWith(origin)) return;
    const response = await request.response();
    answered(request, response?.status() ?? null);
  });
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(origin)) return;
    answered(request, null);
  });
  await page.goto(`${origin}${prefix}`, { waitUntil: "load" });

  return {
    page,
    requests,
    settled: () =>
      new Promise<void>((done) => {
        if (inFlight.size === 0) {
          done();
          return;
        }
        const cap = setTimeout(() => {
          onDrained = null;
          for (const [request, path] of inFlight) {
            inFlight.delete(request);
            requests.push({ path, status: null });
          }
          done();
        }, SETTLE_CAP_MS);
        onDrained = () => {
          clearTimeout(cap);
          onDrained = null;
          done();
        };
      }),
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
