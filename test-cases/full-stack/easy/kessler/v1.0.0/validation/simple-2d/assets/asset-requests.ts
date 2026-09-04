// assets/asset-requests — watching the URLs the build puts on the transport.
//
// Two review items in this category are about the REQUESTS a running build
// makes rather than about what it draws: specs/assets.md has the engine's
// loader resolve every path "relative to the page the build is served from",
// the build asking for "a path written relative to that root ... rather than
// constructing a URL of its own", and requires that "a load that fails leaves
// the game running". The harness stands one `fetch` up over the workspace on
// its first open, so the loader's requests land on the committed files; this
// module sits a watcher ON TOP of that transport — recording every URL that
// reaches it, and answering the ones a suite withholds with the 404 an
// unavailable file gets — so a suite reads exactly what the build asked for,
// and poses the one file it never gets, while the harness serves everything
// else as it always does. Nothing here changes a verdict on its own: what a
// suite makes of the record is the suite's reading.

import { openHarness } from "../harness";

export interface RequestWatch {
  /** Every URL that reached the transport, in the order it arrived. */
  readonly urls: string[];
  /** The URLs the `withhold` pattern answered 404. */
  readonly withheld: string[];
  /** Put the transport back as it was. */
  restore(): void;
}

export interface WatchOptions {
  /** Requests whose URL matches are answered 404, as an unavailable file. */
  withhold?: RegExp;
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
export async function watchRequests(
  options: WatchOptions = {},
): Promise<RequestWatch> {
  const primer = await openHarness();
  primer.dispose();

  const transport = globalThis.fetch;
  const urls: string[] = [];
  const withheld: string[] = [];
  globalThis.fetch = (async (
    input: unknown,
    init?: unknown,
  ): Promise<Response> => {
    const url = urlOf(input);
    urls.push(url);
    if (options.withhold?.test(url)) {
      withheld.push(url);
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    return transport(input as RequestInfo, init as RequestInit);
  }) as typeof fetch;

  return {
    urls,
    withheld,
    restore: () => {
      globalThis.fetch = transport;
    },
  };
}
