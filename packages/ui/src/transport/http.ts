// Small fetch helpers shared by the backend and worker HTTP transports.
//
// None of them carries a credential. The console addresses paths of its own
// origin, so the browser sends the edge's Access cookie with every request and
// the edge turns it into the assertion the services verify; in development the
// Vite dev server adds the local identity header instead.
import { HttpReadError, readTextWithProgress } from "../client";
import type { ProgressCallback } from "../client";

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

// GET a JSON document.
export async function getJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw await httpError(res, path);
  return (await res.json()) as T;
}

// POST a JSON body and parse the JSON reply.
export async function postJson<T>(
  base: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, path);
  return (await res.json()) as T;
}

// PUT a JSON body and parse the JSON reply. Mirrors {@link postJson}.
export async function putJson<T>(
  base: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, path);
  return (await res.json()) as T;
}

// PUT a JSON body to an endpoint that returns no body (`204 No Content`). Used by the coverage-plan upsert, which acknowledges with
// an empty body. Mirrors {@link putJson} without the response parse.
export async function putVoid(
  base: string,
  path: string,
  body: unknown,
): Promise<void> {
  const res = await fetch(joinUrl(base, path), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, path);
}

// POST a JSON body to an endpoint that returns no body (`204 No Content`). Used by the ladder climber retry, which acknowledges with an
// empty body. Mirrors {@link postJson} without the response parse.
export async function postVoid(
  base: string,
  path: string,
  body: unknown,
): Promise<void> {
  const res = await fetch(joinUrl(base, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, path);
}

// DELETE a resource and parse the JSON acknowledgement.
export async function delJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "DELETE",
    headers: {
      accept: "application/json",
    },
  });
  if (!res.ok) throw await httpError(res, path);
  return (await res.json()) as T;
}

// DELETE a resource that returns no body (`204 No Content`). Used by the model-config delete, which acknowledges with an empty body.
export async function delVoid(base: string, path: string): Promise<void> {
  const res = await fetch(joinUrl(base, path), {
    method: "DELETE",
  });
  if (!res.ok) throw await httpError(res, path);
}

export async function getText(base: string, path: string): Promise<string> {
  const res = await fetch(joinUrl(base, path));
  if (!res.ok) throw await httpError(res, path);
  return res.text();
}

// Fetch a document as text, reporting transfer progress as it streams. Backs the
// recorded-events reads, whose payloads can be large; `onProgress` drives the
// Events tab's progress bar.
export async function getTextStreamed(
  base: string,
  path: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const res = await fetch(joinUrl(base, path));
  if (!res.ok) throw await httpError(res, path);
  return readTextWithProgress(res, onProgress);
}

// Fetch a JSON document, reporting transfer progress as it streams.
export async function getJsonStreamed<T>(
  base: string,
  path: string,
  onProgress?: ProgressCallback,
): Promise<T> {
  return JSON.parse(await getTextStreamed(base, path, onProgress)) as T;
}

// Parse an NDJSON body (one JSON value per non-empty line), skipping malformed
// lines. Shared by the streamed and non-streamed NDJSON reads.
function parseNdjson<T>(text: string): T[] {
  const items: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed) as T);
    } catch {
      /* skip a malformed line */
    }
  }
  return items;
}

// Fetch an NDJSON document and parse each non-empty line as JSON. Used for the
// recorded run streams (`events.jsonl` / `raw.jsonl`) the worker serves verbatim
// from disk. A malformed line is skipped rather than failing the whole read.
export async function getNdjson<T>(base: string, path: string): Promise<T[]> {
  return parseNdjson<T>(await getText(base, path));
}

// As {@link getNdjson}, but reporting transfer progress as the body streams.
export async function getNdjsonStreamed<T>(
  base: string,
  path: string,
  onProgress?: ProgressCallback,
): Promise<T[]> {
  return parseNdjson<T>(await getTextStreamed(base, path, onProgress));
}

// Turns a non-2xx response into an `HttpReadError`, preferring the backend's
// error envelope (`{ error: { code, message } }`) when present.
//
// This layer wraps a message the backend already wrote as a sentence, so it adds
// only what it uniquely knows — the path that was requested and the status it
// came back with — and leaves the claim of failure to the detail it carries.
//
// The status also rides on the error as a NUMBER. A caller deciding whether a
// read came back absent or failed (the live gallery's `readRun`, via
// `isAbsence`) reads that field. It used to read the status back out of this
// message with a regular expression, which made `detail` — the backend's own
// words, and free to quote a URL or an upstream's reply — part of the control
// flow: a `500` whose message happened to contain "HTTP 404" rendered as "No run
// found for <id>".
//
// The path is passed rather than read off `res.url`, which a synthesized
// `Response` (every test double, and some polyfills) leaves empty.
async function httpError(res: Response, path: string): Promise<Error> {
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) detail = body.error.message;
  } catch {
    /* non-JSON body; keep the status text */
  }
  return new HttpReadError(path, res.status, detail);
}
