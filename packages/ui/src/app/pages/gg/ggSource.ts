// **Where a gg query is answered** — the one seam between the console's backend index
// and the public site's shipped corpus.
//
// The analysis surface has two hosts and they could not be further apart. The console
// posts a compiled query to `POST /gg/query`, which evaluates it in Rust against an
// in-memory document index. The public static site has no backend at all: it ships the
// snapshot's `gg-runs.json` and evaluates the *same* compiled query in the browser with
// the mirrored TypeScript evaluator. Same language, same compiler, same semantics —
// pinned by the shared `gg_query.conformance.json` fixture both suites execute.
//
// Every page above this hook is written once and knows which host it is on only through
// two fields: {@link GgSource.live} (may this host save things?) and
// {@link GgSource.generatedAt} (how stale is what you are reading?). Everything else —
// the query, the batch, the field catalog — is the same call.
//
// **`generatedAt` is not decoration.** The public corpus is a build-time export and
// legitimately lags the console's by up to a publish cycle, so a figure rendered without
// the instant it was true is a figure that will eventually be argued about.
import { useMemo } from "react";
import type {
  GgFieldCatalog,
  GgQuery,
  GgQueryResponse,
} from "@test-cabinet/run-record/gg-query";
import { useAuth } from "../../../client/auth";
import { useOptionalBackend } from "../../../client/context";
import { useGalleryData } from "../../data/galleryContext";
import { evaluate, fieldCatalog } from "./query";

/** How a gg page asks its question, whichever host it is running on. */
export interface GgSource {
  /**
   * Whether this host has a live backend behind it.
   *
   * The corpus is deployment-wide on both hosts, so this does **not** gate what a query
   * may see. It gates the things that need somewhere to write and someone to write as:
   * saved queries, dashboards, and the per-run links a public corpus mostly cannot
   * resolve.
   */
  live: boolean;
  /**
   * When the answers were true, or `null` on a live backend (where "now" is the only
   * honest answer and a timestamp would be noise).
   */
  generatedAt: string | null;
  /** Evaluate one compiled query. */
  runQuery(query: GgQuery): Promise<GgQueryResponse>;
  /**
   * Evaluate a whole board's worth of queries against **one** corpus, results in
   * request order — or absent on a transport that cannot.
   *
   * One read, not N: on the console that is what stops two panels of the same board
   * coming back from two different index generations, and the static implementation
   * keeps the property for free by folding over one array. Deliberately **optional and
   * never emulated**: answering a board by looping over single queries would silently
   * give back the very hazard the batch exists to remove, so a transport without it
   * has no batch at all and the board says so.
   */
  runBatch?: (queries: GgQuery[]) => Promise<GgQueryResponse[]>;
  /** The corpus's field catalog — what makes the language discoverable. */
  fields(): Promise<GgFieldCatalog>;
}

/**
 * Resolve the gg source for this host, or `null` when it has neither a backend that
 * answers gg queries nor a shipped corpus — in which case the analysis surface is not
 * mounted at all.
 *
 * The console wins where both exist. A console that also happened to hold a snapshot
 * corpus should still answer from its own index: that is the current one, and it is the
 * one its saved queries and dashboards were written against.
 */
export function useGgSource(): GgSource | null {
  const { token } = useAuth();
  const backend = useOptionalBackend()?.client ?? null;
  const { ggData } = useGalleryData();

  return useMemo<GgSource | null>(() => {
    const runQuery = backend?.runGgQuery;
    const runBatch = backend?.runGgQueryBatch;
    const getFields = backend?.getGgFields;
    if (runQuery && token) {
      return {
        live: true,
        generatedAt: null,
        runQuery: (query) => runQuery.call(backend, query, token),
        runBatch: runBatch
          ? (queries) =>
              runBatch
                .call(backend, { queries }, token)
                .then((response) => response.results)
          : undefined,
        // A transport with the query route but not the field route reads as an empty
        // catalog: the sidebar and the completer go quiet, which is a legible
        // degradation, where a rejected promise would surface as an error on a page
        // whose results are fine.
        fields: () =>
          getFields
            ? getFields.call(backend, token)
            : Promise.resolve({ documents: 0, fields: [] }),
      };
    }

    if (!ggData) return null;
    const { documents, generatedAt } = ggData;
    return {
      live: false,
      generatedAt,
      // Synchronous work behind an async signature, deliberately: the interface is the
      // console's, and a page written against a promise cannot tell the two hosts apart.
      runQuery: (query) => Promise.resolve(evaluate(documents, query)),
      runBatch: (queries) =>
        Promise.resolve(queries.map((query) => evaluate(documents, query))),
      fields: () => Promise.resolve(fieldCatalog(documents)),
    };
  }, [backend, token, ggData]);
}
