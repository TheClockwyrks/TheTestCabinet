// Small fetch helpers shared by the backend and worker HTTP transports.
import { readTextWithProgress } from "../client";
import type { ProgressCallback } from "../client";

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

// Build the `Authorization: Bearer <token>` header for a mutating call, or an
// empty object when there is no token (an unauthenticated read). Merge it into a
// request's headers so any helper can attach the current account's token.
export function bearer(token?: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function getJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw await httpError(res);
  return (await res.json()) as T;
}

// POST a JSON body. `token`, when given, is sent as `Authorization: Bearer
// <token>` — every mutating worker call (push/review/publish) supplies it; the
// account register/login calls do not (they produce the token).
export async function postJson<T>(
  base: string,
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...bearer(token),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res);
  return (await res.json()) as T;
}

export async function getText(base: string, path: string): Promise<string> {
  const res = await fetch(joinUrl(base, path));
  if (!res.ok) throw await httpError(res);
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
  if (!res.ok) throw await httpError(res);
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

// Turns a non-2xx response into an Error, preferring the backend's error
// envelope (`{ error: { code, message } }`) when present.
async function httpError(res: Response): Promise<Error> {
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) detail = body.error.message;
  } catch {
    /* non-JSON body; keep the status text */
  }
  return new Error(`${res.status} ${detail}`);
}
