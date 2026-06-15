import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// Dev-only plugin: lets the site preview runs that have been produced on disk
// (under `runs/<id>/`) but not yet published. It is active only while the Vite
// dev server is running — it contributes nothing to `vite build`, so the
// production bundle stays a fully static, backend-free site.
//
// It exposes two dev endpoints under `/__local-runs__`:
//   - `index.json` — the parsed `run-record.json` of every on-disk run, with a
//     local `playableBuild` URL synthesized for runs whose build output exists.
//   - `builds/<id>/...` — that run's built implementation, served so the run
//     detail page can embed and play it locally before anything is hosted.

const PREFIX = "/__local-runs__";

// Mirror the validator's accepted build output directory names.
const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

interface LocalRunsOptions {
  /** Absolute path to the directory that holds `<id>/run-record.json` runs. */
  runsDir: string;
}

// A produced run is recognized only if its record matches the current run-record
// contract. Older on-disk records (pre-`checks` validation schema) are skipped
// so a stale record never crashes the gallery.
function isCurrentRecord(value: unknown): value is { id: string; links: Record<string, unknown> } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const validation = record.validation as Record<string, unknown> | undefined;
  return (
    typeof record.id === "string" &&
    typeof record.subject === "object" &&
    typeof record.metrics === "object" &&
    typeof record.links === "object" &&
    typeof record.status === "object" &&
    !!validation &&
    Array.isArray(validation.checks)
  );
}

// The first existing build output dir for a run's implementation, if any.
function findBuildDir(runsDir: string, id: string): string | null {
  const implementation = join(runsDir, id, "implementation");
  for (const name of BUILD_OUTPUTS) {
    const candidate = join(implementation, name);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function collectRuns(runsDir: string): {
  runs: unknown[];
  skipped: string[];
} {
  const runs: unknown[] = [];
  const skipped: string[] = [];
  if (!existsSync(runsDir)) {
    return { runs, skipped };
  }
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const recordPath = join(runsDir, entry.name, "run-record.json");
    if (!existsSync(recordPath)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(recordPath, "utf8"));
    } catch {
      skipped.push(`${entry.name} (unparseable)`);
      continue;
    }
    if (!isCurrentRecord(parsed)) {
      skipped.push(`${entry.name} (outdated record schema)`);
      continue;
    }
    // Synthesize a local playable URL when the build output is present, leaving
    // any already-published link untouched.
    const buildDir = findBuildDir(runsDir, parsed.id);
    if (buildDir && parsed.links.playableBuild == null) {
      parsed.links.playableBuild = `${PREFIX}/builds/${encodeURIComponent(parsed.id)}/`;
    }
    runs.push(parsed);
  }
  return { runs, skipped };
}

const CONTENT_JSON = "application/json; charset=utf-8";
const CONTENT_HTML = "text/html; charset=utf-8";

function sendJson(res: ServerResponse, body: unknown): void {
  const payload = JSON.stringify(body);
  res.setHeader("Content-Type", CONTENT_JSON);
  res.setHeader("Cache-Control", "no-store");
  res.end(payload);
}

// Rewrite a built `index.html` so it can be embedded under the `builds/<id>/`
// subpath. Builds vary: some reference assets relatively (`./assets/x`), some
// root-absolutely (`/assets/x`). We first make root-absolute asset URLs
// base-relative, then inject an absolute <base> so both forms resolve under the
// build's subpath. Order matters: the slash-strip must run before the <base> is
// added, or it would clobber the base href's own leading slash.
function rewriteIndexHtml(html: string, basePath: string): string {
  // Turn src="/assets/x" / href="/favicon" into base-relative refs. Protocol-
  // relative (//) and already-relative (./) refs are left alone.
  const relative = html.replace(/(\s(?:src|href))="\/(?!\/)/gi, '$1="');
  return relative.replace(
    /<head(\s[^>]*)?>/i,
    (match) => `${match}<base href="${basePath}">`,
  );
}

function serveBuild(
  runsDir: string,
  rest: string,
  res: ServerResponse,
): void {
  const slashIndex = rest.indexOf("/");
  const id = decodeURIComponent(
    slashIndex === -1 ? rest : rest.slice(0, slashIndex),
  );
  const assetPath = slashIndex === -1 ? "" : rest.slice(slashIndex + 1);

  const buildDir = findBuildDir(runsDir, id);
  if (!buildDir) {
    res.statusCode = 404;
    res.setHeader("Content-Type", CONTENT_HTML);
    res.end(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#07080a;color:#e8eaee;padding:2rem">` +
        `<h1>Run not built</h1><p>No <code>dist/</code>, <code>build/</code>, or <code>out/</code> directory was found for <code>${id}</code>.</p>` +
        `<p>Build it first, e.g. <code>cd runs/${id}/implementation && npm install && npm run build</code>.</p></body>`,
    );
    return;
  }

  const decoded = decodeURIComponent(assetPath);
  const isIndex = decoded === "" || decoded.endsWith("/");
  const target = isIndex ? "index.html" : decoded;
  const filePath = normalize(join(buildDir, target));

  // Guard against path traversal outside the build directory.
  if (filePath !== buildDir && !filePath.startsWith(buildDir + sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA-style fallback for extensionless navigations; real missing assets 404.
    if (extname(decoded) === "") {
      serveIndexHtml(buildDir, id, res);
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  if (filePath === join(buildDir, "index.html")) {
    serveIndexHtml(buildDir, id, res);
    return;
  }

  res.setHeader("Content-Type", MIME[extname(filePath)] ?? "application/octet-stream");
  createReadStream(filePath).pipe(res);
}

function serveIndexHtml(buildDir: string, id: string, res: ServerResponse): void {
  const html = readFileSync(join(buildDir, "index.html"), "utf8");
  const basePath = `${PREFIX}/builds/${encodeURIComponent(id)}/`;
  res.setHeader("Content-Type", CONTENT_HTML);
  res.setHeader("Cache-Control", "no-store");
  res.end(rewriteIndexHtml(html, basePath));
}

export function localRuns(options: LocalRunsOptions): Plugin {
  const runsDir = resolve(options.runsDir);
  return {
    name: "ttc-local-runs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url ?? "";
          if (!url.startsWith(PREFIX)) {
            next();
            return;
          }
          const path = url.split("?")[0]?.slice(PREFIX.length) ?? "";

          if (path === "/index.json") {
            const { runs, skipped } = collectRuns(runsDir);
            if (skipped.length > 0) {
              server.config.logger.warn(
                `[local-runs] skipped ${skipped.length} record(s): ${skipped.join(", ")}`,
              );
            }
            sendJson(res, { runs, skipped });
            return;
          }

          if (path.startsWith("/builds/")) {
            serveBuild(runsDir, path.slice("/builds/".length), res);
            return;
          }

          next();
        },
      );
    },
  };
}
