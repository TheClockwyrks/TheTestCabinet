// assets/requests — watching the URLs a running build asks for, and
// withholding the ones a check poses as unavailable. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. Two points in this category
// are about the REQUESTS a running build makes rather than about what it
// draws: `specs/assets.md` has the engine's loader resolve every path "under
// one root, `assets/`, relative to the page the build is served from", with
// the build asking "for a path written relative to that root ... rather than
// constructing a URL of its own", and it requires that "a load that fails
// leaves the game running".
//
// `harness.ts` stands one `fetch` up over the workspace on the first harness
// of the process, so the loader's requests land on the committed files. This
// module sits a watcher ON TOP of that transport: it records every URL that
// reaches it and answers the ones a check withholds with the 404 an
// unavailable file gets, while the harness serves everything else as it
// always does. A throwaway harness is opened first so the watcher wraps the
// installed transport rather than being wrapped by it, which is what lets it
// see every URL the loader emits.
//
// Nothing here decides a verdict on its own: what a check makes of the record
// is the check's own reading.

import { createHarness } from "../harness";

export interface RequestWatch {
  /** Every URL that reached the transport, in the order it arrived. */
  readonly urls: string[];
  /** The URLs the `withhold` predicate answered 404. */
  readonly withheld: string[];
  /** Put the transport back as it was. */
  restore(): void;
}

export interface WatchOptions {
  /** Requests this answers `true` for are answered 404, as an absent file. */
  withhold?: (url: string) => boolean;
}

/** The URL of whatever `fetch` was handed. */
function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  return String(input);
}

/**
 * Watch every request the harnesses opened AFTER this call make, and answer
 * the withheld ones 404. `restore` puts the transport back, and every check
 * that opens a watch closes it in its `afterEach`.
 */
export async function watchRequests(
  options: WatchOptions = {},
): Promise<RequestWatch> {
  const primer = await createHarness();
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
    if (options.withhold?.(url) === true) {
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
