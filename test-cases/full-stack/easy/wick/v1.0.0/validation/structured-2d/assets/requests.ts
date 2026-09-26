// assets/requests — watching the URLs a running build puts on the transport.
// CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. One point in this category is
// about the REQUESTS a running build makes rather than about what it draws:
// `specs/assets.md` has the engine's loader resolve every path "under one root,
// `assets/`, relative to the page the build is served from", with the build
// asking "for a path written relative to that root ... rather than constructing
// a URL of its own".
//
// `harness.ts` stands one `fetch` up over the workspace on the first harness of
// the process, so the loader's requests land on the committed files. This module
// sits a watcher ON TOP of that transport: it records every URL that reaches it
// and hands each one straight on, so every produced file is served exactly as it
// always is.
//
// WHY A HARNESS IS OPENED AND THROWN AWAY FIRST. The harness installs its
// transport on the first open of the PROCESS. A watcher installed before that
// would be wrapped BY it and would see only the URLs the harness had no file
// for; installed after, it wraps the harness and sees every URL the loader
// emits. The primer harness is disposed at once and nothing reads it.
//
// Nothing here decides a verdict on its own: what a check makes of the record
// is the check's own reading.

import { createHarness } from "../harness";

export interface RequestWatch {
  /** Every URL that reached the transport, in the order it arrived. */
  readonly urls: string[];
  /** Put the transport back as it was. */
  restore(): void;
}

/** The URL of whatever `fetch` was handed. */
function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return String(input);
}

/**
 * Watch every request the harnesses opened AFTER this call make. `restore` puts
 * the transport back, and every check that opens a watch closes it in its
 * `afterEach`.
 */
export async function watchRequests(): Promise<RequestWatch> {
  const primer = await createHarness();
  primer.dispose();

  const transport = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (
    input: unknown,
    init?: unknown,
  ): Promise<Response> => {
    urls.push(urlOf(input));
    return transport(input as RequestInfo, init as RequestInit);
  }) as typeof fetch;

  return {
    urls,
    restore: () => {
      globalThis.fetch = transport;
    },
  };
}
