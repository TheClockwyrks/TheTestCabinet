import type { RunRecord } from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { useGalleryData } from "./galleryContext";

export interface RunsState {
  /** The runs to display: local (unpublished) first, then published. */
  runs: RunRecord[];
  /** Ids of runs sourced from local disk — i.e. not yet published. */
  localIds: ReadonlySet<string>;
  /** Raw writeups for local runs, keyed by run id, for pre-publish preview. */
  localWriteups: Readonly<Record<string, string>>;
  /** True while runs are still being fetched. */
  loading: boolean;
}

export interface RunSummariesState {
  /** The bounded run summary cards to display, local (unpublished) first. */
  runSummaries: RunSummary[];
  /** Ids of runs sourced from local disk — i.e. not yet published. */
  localIds: ReadonlySet<string>;
  /** Raw writeups for local runs, keyed by run id, for pre-publish preview. */
  localWriteups: Readonly<Record<string, string>>;
  /** True while runs are still being fetched. */
  loading: boolean;
}

// The gallery's run list, read from the injected data source (see
// galleryContext). Each host assembles the list — the static site from the
// build-time snapshot (merging on-disk dev runs), the consoles from a backend
// and worker — so this is now a thin selector over that context. The returned
// shape is unchanged, so every page that consumes it stays the same.
export function useRuns(): RunsState {
  const { runs, localIds, writeups, runsLoading } = useGalleryData();
  return { runs, localIds, localWriteups: writeups, loading: runsLoading };
}

// The gallery's run summary list — the lightweight card shape the run log and
// list pages consume — read from the injected data source alongside the same
// local ids and writeups {@link useRuns} carries (the migrated pages still need
// them to flag unpublished runs and preview local writeups). A thin selector, so
// the pages stay identical regardless of where the summaries come from.
export function useRunSummaries(): RunSummariesState {
  const { runSummaries, localIds, writeups, runsLoading } = useGalleryData();
  return {
    runSummaries,
    localIds,
    localWriteups: writeups,
    loading: runsLoading,
  };
}
