// Small fetch helpers shared by the backend and worker HTTP transports.

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export async function getJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw await httpError(res);
  return (await res.json()) as T;
}

export async function postJson<T>(
  base: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(joinUrl(base, path), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
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

// Fetch an NDJSON document and parse each non-empty line as JSON. Used for the
// recorded run streams (`events.jsonl` / `raw.jsonl`) the worker serves verbatim
// from disk. A malformed line is skipped rather than failing the whole read.
export async function getNdjson<T>(base: string, path: string): Promise<T[]> {
  const text = await getText(base, path);
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
