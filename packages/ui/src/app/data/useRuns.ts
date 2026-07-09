import { useEffect, useMemo, useState } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { useGalleryData } from "./galleryContext";
import type { RunQuery, RunQueryResult } from "./runQuery";

// One case's runs are few enough to hold whole, so its leaderboard/metrics/runs
// tabs fetch them in one bounded, case-scoped query rather than draining the whole
// cabinet. This caps a single request; a case with more runs than this is drained
// a window at a time (still bounded to the one case).
const CASE_PAGE_LIMIT = 1000;

export interface CaseRunSummariesState {
  /** Every summary for the case, produced (unpublished) first then published. */
  summaries: RunSummary[];
  /** Ids of runs sourced from local disk — i.e. not yet published. */
  localIds: ReadonlySet<string>;
  /** Raw writeups for local runs, keyed by run id, for pre-publish preview. */
  localWriteups: Readonly<Record<string, string>>;
  /** True while the case's runs are still being fetched. */
  loading: boolean;
}

// Fetch every published run summary of one test case, draining the case-scoped
// query a bounded window at a time (a single case never holds enough runs to
// matter). Host-agnostic: the console forwards each window to the backend's offset
// endpoint, the static site slices its in-memory index — same param shape, same
// result.
async function drainCaseSummaries(
  query: (q: RunQuery) => Promise<RunQueryResult>,
  slug: string,
): Promise<RunSummary[]> {
  const acc: RunSummary[] = [];
  for (let offset = 0; ; offset += CASE_PAGE_LIMIT) {
    const { summaries, total } = await query({
      state: "published",
      testCase: slug,
      offset,
      limit: CASE_PAGE_LIMIT,
    });
    acc.push(...summaries);
    if (summaries.length === 0 || acc.length >= total) break;
  }
  return acc;
}

// A single test case's run summaries — every published run of the case, merged
// with the console's produced (local) runs of the same case pinned first (the
// backend's numbered listing never returns unpublished runs). The case's runs are
// bounded, so the leaderboard/metrics/runs tabs rank, aggregate, and page over
// this set client-side (including the per-variant narrowing the server can't do).
// Host-agnostic: both galleries answer the same `queryRunSummaries`, so a tab
// behaves identically wherever it renders.
export function useCaseRunSummaries(slug: string): CaseRunSummariesState {
  const { queryRunSummaries, producedSummaries, localIds, writeups } =
    useGalleryData();
  const [published, setPublished] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    drainCaseSummaries(queryRunSummaries, slug)
      .then((rows) => {
        if (!active) return;
        setPublished(rows);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setPublished([]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [queryRunSummaries, slug]);

  const producedForCase = useMemo(
    () =>
      producedSummaries.filter((s) => s.subject.testCaseSlug === slug),
    [producedSummaries, slug],
  );
  const summaries = useMemo(
    () => [
      ...producedForCase,
      ...published.filter((s) => !localIds.has(s.id)),
    ],
    [producedForCase, published, localIds],
  );

  return { summaries, localIds, localWriteups: writeups, loading };
}
