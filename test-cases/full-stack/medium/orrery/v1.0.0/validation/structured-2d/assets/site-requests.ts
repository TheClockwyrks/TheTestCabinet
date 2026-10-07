// Orrery — every URL the BUILT SITE would load, read off the built output.
// CASE-PROVIDED, and the SAME FILE in all three engine projects.
//
// NOT A `.test.ts`, so vitest never collects it: it is the reading half of
// `assets/built-site-fetches-nothing-external`, which is about the site `npm run
// build` emitted rather than about a frame the game drew.
//
// WHY THE BUILT OUTPUT AND NOT THE RUNNING PAGE. `specs/assets.md` puts the
// requirement on the built site — "`npm ci` and `npm run build` invoke no tool,
// and the built site fetches nothing from outside its own `dist/`" — and a
// request the site would make is a URL the site CARRIES, in a position it loads
// from. Reading the emitted files is also the one reading that is the same under
// all three engines: two of the three projects run the build in this process with
// no page and no network at all, so there is no page there whose requests could
// be watched.
//
// WHAT COUNTS AS A REQUEST. A URL in a position the browser fetches from: an
// `src` or `href` attribute, a CSS `url()` or `@import`, and in script a `fetch`,
// a dynamic or static `import`, a `new URL`, a `new Image`/`Audio`/`Worker`, an
// `importScripts`, or an assignment to `.src`/`.href`. A URL that merely appears
// somewhere in the text is not a request: an XML namespace inside an inlined SVG
// and a licence banner's project page are both `https://` and neither is ever
// fetched, so neither is read here.
//
// AND WHAT MAKES ONE EXTERNAL. A scheme that names another origin, or a
// protocol-relative `//host`. A `data:` or `blob:` URL carries its own bytes and
// leaves the site for nothing, and a page-relative or root-absolute path names a
// file of the site itself — where such a path RESOLVES is
// `assets/asset-urls-page-relative`'s point, not this one.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { WORKSPACE, writeImageBytes } from "../media";

/** Where `npm run build` may put the site, in the order the runner looks. */
export const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

/** The file extensions a URL can be written in, and what forms to read them by. */
const TEXT_EXTENSIONS = /\.(?:html?|js|mjs|cjs|css|webmanifest)$/i;

/** Attribute and `url()` forms, for the site's HTML. */
const HTML_FORMS: readonly RegExp[] = [
  /(?:\bsrc|\bhref|\bposter)\s*=\s*["']([^"']*)["']/gi,
  /url\(\s*["']?([^"')]*)/gi,
];

/** The two forms a stylesheet loads by. */
const CSS_FORMS: readonly RegExp[] = [
  /url\(\s*["']?([^"')]*)/gi,
  /@import\s+["']([^"']*)["']/gi,
];

/** Every position a script loads from, minified or not. */
const SCRIPT_FORMS: readonly RegExp[] = [
  /\bfetch\s*\(\s*["'`]([^"'`]*)/g,
  /\bimport\s*\(\s*["'`]([^"'`]*)/g,
  /\bfrom\s*["']([^"']*)["']/g,
  /\bnew\s+URL\s*\(\s*["'`]([^"'`]*)/g,
  /\bnew\s+(?:Image|Audio|Worker|SharedWorker|EventSource|WebSocket)\s*\(\s*["'`]([^"'`]*)/g,
  /\bimportScripts\s*\(\s*["'`]([^"'`]*)/g,
  /\.(?:src|href)\s*=\s*["'`]([^"'`]*)/g,
  /url\(\s*["']?([^"')]*)/g,
];

/** A URL's scheme, when it carries one. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** One URL the built site carries in a position it would load from. */
export interface SiteRequest {
  /** The file that carries it, relative to the built output. */
  from: string;
  /** The URL as written, truncated for a `data:` payload. */
  url: string;
  /** Whether it names a location outside the built site. */
  external: boolean;
}

/**
 * The directory `npm run build` emitted the site into, or `null` when none of
 * the three names holds one.
 */
export function builtOutput(): string | null {
  for (const name of BUILD_OUTPUTS) {
    const output = join(WORKSPACE, name);
    try {
      if (statSync(output).isDirectory() && readdirSync(output).length > 0) {
        return output;
      }
    } catch {
      // The name is not there, which is what the next one is for.
    }
  }
  return null;
}

/** Every file under a directory, in walk order. */
function filesUnder(directory: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(directory);
  return found;
}

/** Whether a URL names a location outside the site that carries it. */
export function isExternal(url: string): boolean {
  if (url.startsWith("//")) return true;
  const scheme = SCHEME.exec(url);
  if (scheme === null) return false;
  const name = (scheme[1] ?? "").toLowerCase();
  return name !== "data" && name !== "blob";
}

/** A `data:` payload is megabytes long; what a reader needs is that it is one. */
function shortened(url: string): string {
  return url.length <= 96 ? url : `${url.slice(0, 93)}...`;
}

/**
 * Every URL the built site would load, in the order the files were walked.
 *
 * Reads nothing but the emitted text: a picture, a sound and a system carry no
 * URL of their own, so they are not opened.
 */
export function siteRequests(output: string): SiteRequest[] {
  const requests: SiteRequest[] = [];
  for (const file of filesUnder(output)) {
    if (!TEXT_EXTENSIONS.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const forms = /\.html?$/i.test(file)
      ? HTML_FORMS
      : /\.css$/i.test(file)
        ? CSS_FORMS
        : SCRIPT_FORMS;
    const from = relative(output, file).split("\\").join("/");
    for (const form of forms) {
      for (const match of text.matchAll(form)) {
        const url = (match[1] ?? "").trim();
        if (url === "") continue;
        requests.push({ from, url: shortened(url), external: isExternal(url) });
      }
    }
  }
  return requests;
}

/**
 * Paint what the built site carries — one row per distinct URL, marked inside or
 * outside the site — and keep it as the review item's `outputId` output.
 *
 * This point drives no game, so a screenshot of one would be evidence of
 * nothing. Nothing painted here is read by an assertion.
 */
export function showSiteRequests(
  outputId: string,
  output: string | null,
  requests: readonly SiteRequest[],
): void {
  const seen = new Set<string>();
  const rows: string[] = [
    output === null
      ? "npm run build emitted no dist/, build/ or out/ directory"
      : `${relative(WORKSPACE, output)}/ — ${requests.length} URL references`,
    "",
  ];
  for (const request of requests) {
    const line = `${request.external ? "OUTSIDE" : "inside "}  ${request.from}  ->  ${request.url}`;
    if (seen.has(line)) continue;
    seen.add(line);
    if (rows.length < 42) rows.push(line);
  }
  if (seen.size > 40) rows.push(`... and ${seen.size - 40} more`);

  const step = 22;
  const canvas = createCanvas(1200, Math.max(120, 40 + rows.length * step));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "13px monospace";
  rows.forEach((row, i) => {
    ctx.fillStyle = row.startsWith("OUTSIDE") ? "#ff9a8a" : "#c9d4e4";
    ctx.fillText(row, 20, 28 + i * step);
  });
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}
