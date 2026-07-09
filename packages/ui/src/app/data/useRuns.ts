import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { useGalleryData } from "./galleryContext";

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

// The gallery's run summary list — the lightweight card shape the run log and
// list pages consume — read from the injected data source (see galleryContext)
// alongside the local ids and writeups the migrated pages need to flag unpublished
// runs and preview local writeups. Each host assembles the summaries its own way
// (the static site from the build-time snapshot merging on-disk dev runs, the
// console by draining the backend's summary index and deriving its local runs'
// cards), so this is a thin selector over that context — the pages stay identical
// regardless of where the summaries come from.
export function useRunSummaries(): RunSummariesState {
  const { runSummaries, localIds, writeups, runsLoading } = useGalleryData();
  return {
    runSummaries,
    localIds,
    localWriteups: writeups,
    loading: runsLoading,
  };
}
