// assets/asset-requests — watching the URLs the build puts on the transport.
//
// One review item in this category is about the REQUESTS a running build makes
// rather than about what it draws: specs/assets.md has the engine's loader
// resolve every path "relative to the page the build is served from", the build
// asking for "a path written relative to that root ... rather than constructing
// a URL of its own". The harness stands one `fetch` up over the workspace on
// its first open, so the loader's requests land on the committed files; this
// module sits a watcher ON TOP of that transport, recording every URL that
// reaches it and passing each one through to be served, so a suite reads
// exactly what the build asked for while every produced file loads as it
// always does. Nothing here changes a verdict on its own: what a suite makes
// of the record is the suite's reading.

import { openHarness } from "../harness";

export interface RequestWatch {
  /** Every URL that reached the transport, in the order it arrived. */
  readonly urls: string[];
  /** Put the transport back as it was. */
  restore(): void;
}

/** The URL of whatever `fetch` was handed. */
function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  return String(input);
}

/**
 * Watch every request the harnesses opened AFTER this call make.
 *
 * The harness installs its transport on the first open of the process, so one
 * throwaway harness is opened and closed first: the watcher then wraps the
 * installed transport rather than being wrapped by it, which is what lets it
 * see every URL the loader emits instead of only the ones the harness had no
 * file for.
 */
export async function watchRequests(): Promise<RequestWatch> {
  const primer = await openHarness();
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
