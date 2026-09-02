// assets/site — serving the built site under conditions the shared server never
// varies. CASE-PROVIDED.
//
// Three review items in this category are about HOW the built site is served.
// specs/assets.md requires that "the site runs unchanged whether it is served
// from the root of a static host or mounted under a sub-path", that "a load that
// fails leaves the game running", and that "every image is decoded and every
// sound is bound to its cue before the first frame draws". The project's shared
// server (`globalSetup.ts`) serves the build at the root with every file present
// and injects the harness's own probes, so those three suites bring their own
// server: the same handful of lines, with the knobs those requirements vary —
// the path the site is mounted under, the files withheld with a 404, and the
// scripts injected before a line of the build runs.
//
// The page opens in the project's one shared Chromium, in a context of this
// module's own that is closed with the site, so nothing here disturbs the pages
// the rest of the project is driving.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { inject } from "vitest";
import type { Browser, Page } from "playwright";
import { connectChromium } from "../chromium";
import { STAGE_H, STAGE_W } from "../constants";
import { WORKSPACE } from "./media-out";

/**
 * What the built site is served as, matching the shared server's table: a
 * full-stack build commits its own `.wav` cues beside the bundle, and a build
 * that plays one through an `<audio>` element rather than through a decoded
 * buffer needs the type to be right.
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

/** Where `npm run build` may have put the site, in the order the runner looks. */
const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

/** The build output, found the way `globalSetup.ts` finds it. */
function buildOutput(): string {
  for (const name of BUILD_OUTPUTS) {
    const candidate = join(WORKSPACE, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `wick: no build output (${BUILD_OUTPUTS.join(", ")}) under ${WORKSPACE} to serve`,
  );
}

/** One request the page made to this site's own origin. */
export interface SiteRequest {
  /** The URL's path, e.g. `/mounted/deep/assets/ground-abc.png`. */
  path: string;
  /** The response's status, or `null` when the request never got one. */
  status: number | null;
}

/** A served build, open in a page of its own. */
export interface Site {
  page: Page;
  /** Where the site is served, including the mount prefix. */
  url: string;
  /** Every same-origin request the page made, in order. */
  requests: SiteRequest[];
  /** The request paths the `block` pattern answered with a 404. */
  blocked: string[];
  close(): Promise<void>;
}

/** What a site is served under. */
export interface SiteOptions {
  /** The path the site is mounted under, e.g. `/mounted/deep/`. Default `/`. */
  prefix?: string;
  /** Requests whose path matches are answered 404, as an unavailable file. */
  block?: RegExp;
  /** Scripts injected into the page before a line of the build's own runs. */
  initScripts?: readonly string[];
}

/**
 * Serve the build output on a loopback port — optionally mounted under a
 * sub-path, optionally with matching files withheld, optionally with scripts of
 * this category's own injected first — and open it in a fresh page of the
 * project's shared Chromium.
 */
export async function openSite(options: SiteOptions = {}): Promise<Site> {
  const prefix = options.prefix ?? "/";
  const root = resolve(buildOutput());
  const blocked: string[] = [];

  const server: Server = createServer((request, response) => {
    const path = normalize(
      decodeURI(new URL(request.url ?? "/", "http://localhost").pathname),
    );
    if (options.block?.test(path) === true) {
      blocked.push(path);
      response.writeHead(404).end("not found");
      return;
    }
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
    const at = resolve(file);
    if (at !== root && !at.startsWith(root + sep)) {
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
    throw new Error("wick: the static server reported no port");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  const browser: Browser = await connectChromium(inject("tcabBrowserWs"), {
    slug: "wick",
  });
  const context = await browser.newContext({
    viewport: { width: STAGE_W, height: STAGE_H },
    deviceScaleFactor: 1,
  });
  for (const script of options.initScripts ?? []) {
    await context.addInitScript({ path: script });
  }
  const page = await context.newPage();
  const requests: SiteRequest[] = [];
  page.on("requestfinished", (request) => {
    if (!request.url().startsWith(origin)) return;
    void request.response().then((response) => {
      requests.push({
        path: new URL(request.url()).pathname,
        status: response?.status() ?? null,
      });
    });
  });
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(origin)) return;
    requests.push({ path: new URL(request.url()).pathname, status: null });
  });
  const url = `${origin}${prefix}`;
  await page.goto(url, { waitUntil: "load" });

  return {
    page,
    url,
    requests,
    blocked,
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
