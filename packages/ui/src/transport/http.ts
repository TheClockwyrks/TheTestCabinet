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

// GET a JSON document. `token`, when given, is sent as `Authorization: Bearer
// <token>` — the reviewer coverage-plan reads are account-scoped and supply it;
// the open reads (catalog, published runs) omit it.
export async function getJson<T>(
  base: string,
  path: string,
  token?: string | null,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    headers: { accept: "application/json", ...bearer(token) },
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

// PUT a JSON body, sending `token` as `Authorization: Bearer <token>` — the
// mutating model-config update supplies it. Mirrors {@link postJson}.
export async function putJson<T>(
  base: string,
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "PUT",
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

// PUT a JSON body to an endpoint that returns no body (`204 No Content`), sending
// `token` as a bearer. Used by the coverage-plan upsert, which acknowledges with
// an empty body. Mirrors {@link putJson} without the response parse.
export async function putVoid(
  base: string,
  path: string,
  body: unknown,
  token?: string | null,
): Promise<void> {
  const res = await fetch(joinUrl(base, path), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...bearer(token),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res);
}

// PUT raw bytes (not JSON) with an explicit content type, sending `token` as a
// bearer, and parse the JSON acknowledgement. Used by the profile-picture upload,
// whose body is the image bytes themselves and whose `Content-Type` names their
// image type. Mirrors {@link putJson} but sends a binary body.
export async function putBytes<T>(
  base: string,
  path: string,
  body: BodyInit,
  contentType: string,
  token?: string | null,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "PUT",
    headers: {
      "content-type": contentType,
      accept: "application/json",
      ...bearer(token),
    },
    body,
  });
  if (!res.ok) throw await httpError(res);
  return (await res.json()) as T;
}

// DELETE a resource. `token` is sent as `Authorization: Bearer <token>` — the
// run-delete call (the only DELETE the console issues) is mutating and supplies
// it. Parses and returns the JSON acknowledgement.
export async function delJson<T>(
  base: string,
  path: string,
  token?: string | null,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "DELETE",
    headers: {
      accept: "application/json",
      ...bearer(token),
    },
  });
  if (!res.ok) throw await httpError(res);
  return (await res.json()) as T;
}

// DELETE a resource that returns no body (`204 No Content`), sending `token` as a
// bearer. Used by the model-config delete, which acknowledges with an empty body.
export async function delVoid(
  base: string,
  path: string,
  token?: string | null,
): Promise<void> {
  const res = await fetch(joinUrl(base, path), {
    method: "DELETE",
    headers: { ...bearer(token) },
  });
  if (!res.ok) throw await httpError(res);
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
