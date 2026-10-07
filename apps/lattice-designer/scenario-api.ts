// A dev-server API over the Lattice case's committed scenarios, so the designer can
// OPEN one, edit it, and SAVE it back to the file the case grades.
//
// The browser cannot write to the repository, and the designer is a dev-only tool
// run from this checkout, so the vite dev server does the file I/O. The plugin is
// `apply: "serve"` — a static `vite build` has no API and the UI degrades to
// export/download only (see `src/scenarioFiles.ts`).
//
// The write surface is deliberately narrow. Only files that ALREADY exist directly
// inside the case's `cases/` folder can be read or written: no path traversal, no
// creating new files, nothing outside that one directory. A brand-new design is
// still handed over by the toolbar's Export/Copy, which is what that path is for.
//
// A saved file is written VERBATIM as the client sent it (after a parse check), so
// the committed formatting — two-space JSON with a trailing newline, matching what
// `lattice gen` writes — is the client's to control and stays byte-stable.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** The case folder whose `cases/*.json` this API exposes. */
const CASES_DIR = fileURLToPath(
  new URL(
    "../../test-cases/performance/hard/lattice/v1.0.0/cases",
    import.meta.url,
  ),
);

/** The URL prefix every route hangs off. */
const ROUTE = "/api/scenarios";

/** A scenario's file stem, as it appears in a URL. Kept to a strict lowercase slug
 * so a request can never escape `CASES_DIR` — `..` and `/` are not in the set. */
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Refuse a body larger than this. The biggest committed scenario is ~63 KB; the
 * cap is a runaway guard, not a real limit. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** What the picker needs to list a scenario without loading the whole file. */
interface ScenarioSummary {
  name: string;
  ticks: number;
  snapshots: number[];
  grid: { width: number; height: number };
  entities: number;
}

/**
 * The vite plugin. Mounted in `vite.config.ts`; serves:
 * - `GET  /api/scenarios`        — every scenario in the case's `cases/` folder;
 * - `GET  /api/scenarios/<name>` — one scenario's file text;
 * - `PUT  /api/scenarios/<name>` — overwrite that scenario with the request body.
 */
export function scenarioApi(): Plugin {
  return {
    name: "lattice-scenario-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(ROUTE, (req, res, next) => {
        const url = (req.url ?? "/").split("?")[0] ?? "/";
        const method = req.method ?? "GET";

        if (url === "/" || url === "") {
          if (method !== "GET") return methodNotAllowed(res, "GET");
          void list()
            .then((files) => sendJson(res, 200, files))
            .catch((err: unknown) => sendError(res, 500, message(err)));
          return;
        }

        const name = url.slice(1);
        if (!NAME.test(name)) {
          sendError(res, 400, `not a scenario name: ${name}`);
          return;
        }

        if (method === "GET") {
          void read(name)
            .then((text) => sendText(res, 200, text))
            .catch((err: unknown) => sendError(res, 404, message(err)));
          return;
        }

        if (method === "PUT") {
          void readBody(req)
            .then((body) => write(name, body))
            .then(() => sendJson(res, 200, { saved: name }))
            .catch((err: unknown) => sendError(res, 400, message(err)));
          return;
        }

        next();
      });
    },
  };
}

/** Every `*.json` directly inside the case's `cases/` folder, summarised. */
async function list(): Promise<ScenarioSummary[]> {
  const names = await scenarioNames();
  const summaries: ScenarioSummary[] = [];
  for (const name of names) {
    const parsed: unknown = JSON.parse(await read(name));
    if (!isRecord(parsed)) continue;
    const grid = isRecord(parsed.grid) ? parsed.grid : {};
    summaries.push({
      name,
      ticks: typeof parsed.ticks === "number" ? parsed.ticks : 0,
      snapshots: Array.isArray(parsed.snapshots)
        ? parsed.snapshots.filter((t): t is number => typeof t === "number")
        : [],
      grid: {
        width: typeof grid.width === "number" ? grid.width : 0,
        height: typeof grid.height === "number" ? grid.height : 0,
      },
      entities: Array.isArray(parsed.entities) ? parsed.entities.length : 0,
    });
  }
  return summaries;
}

/** One scenario's file text. */
async function read(name: string): Promise<string> {
  await assertExists(name);
  return readFile(join(CASES_DIR, `${name}.json`), "utf8");
}

/**
 * Overwrite an existing scenario with `body`. The body must parse as JSON — a
 * half-written file in the scored set would fail a run with a parse error rather
 * than anything legible — but is otherwise stored exactly as sent.
 */
async function write(name: string, body: string): Promise<void> {
  await assertExists(name);
  try {
    JSON.parse(body);
  } catch (err) {
    throw new Error(`refusing to save invalid JSON: ${message(err)}`);
  }
  await writeFile(join(CASES_DIR, `${name}.json`), body, "utf8");
}

/** The file stems of the scenarios in the case folder. */
async function scenarioNames(): Promise<string[]> {
  const entries = await readdir(CASES_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name.slice(0, -".json".length))
    .filter((name) => NAME.test(name))
    .sort();
}

/** Fail unless `name` is one of the case's existing scenarios. Creating a new file
 * in the scored set is not something this tool should be able to do by accident. */
async function assertExists(name: string): Promise<void> {
  const names = await scenarioNames();
  if (!names.includes(name)) {
    throw new Error(`no such scenario: ${name} (have: ${names.join(", ")})`);
  }
}

/** Collect a request body as UTF-8 text, refusing anything oversized. */
function readBody(req: { on: NodeJS.EventEmitter["on"] }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`body larger than ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (err: Error) => reject(err));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(text);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}

function sendError(res: ServerResponse, status: number, detail: string): void {
  sendJson(res, status, { error: detail });
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader("Allow", allow);
  sendError(res, 405, `only ${allow} is allowed here`);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The slice of `http.ServerResponse` these helpers use. */
interface ServerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}
