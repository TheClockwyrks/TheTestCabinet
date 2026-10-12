import type { RunSummary } from "@clockwyrks/run-record/snapshot";

// Whether a run's artifact tree is stored, as a console knows it.
//
// A run is released from the tree its driver uploaded to the artifact service, so
// a run whose tree is not stored can never be published. The backend reports the
// runs it knows this about beside the cards of every response that returns them
// (a summary page, a plan's runs, an account's reviews), as a list of ids
// (`artifactsNotStored`), because the card itself is the shape the public
// snapshot ships and says nothing about it.
//
// The wording says what is known, which is that the artifact service holds no
// tree. Why is not known: an upload that failed and a run pushed from a machine
// that never uploads one read the same.
//
// The transport folds that list back onto the cards it hands out, and everything
// downstream asks `artifactsNotStored(summary)`. Both halves live here so the one
// field a console adds to a card is written and read in one place. A card from
// any other source (the static gallery's snapshot, a worker's produced list)
// carries no mark, and reads as "not known to be missing".

/** A summary card as a console holds it, with the console-only presence mark. */
type RunSummaryWithPresence = RunSummary & { artifactsStored?: false };

/**
 * Mark each of `summaries` whose id is in `notStored` as a run whose artifact
 * tree is not stored. Cards outside the list are returned as they are.
 */
export function markArtifactsNotStored(
  summaries: RunSummary[],
  notStored: readonly string[] | null | undefined,
): RunSummary[] {
  if (!notStored || notStored.length === 0) return summaries;
  const ids = new Set(notStored);
  return summaries.map((summary): RunSummary => {
    if (!ids.has(summary.id)) return summary;
    const marked: RunSummaryWithPresence = {
      ...summary,
      artifactsStored: false,
    };
    return marked;
  });
}

/**
 * Whether `summary` is known to have no stored artifact tree, which means the run
 * cannot be published. False for a run whose presence is unknown.
 */
export function artifactsNotStored(summary: RunSummary): boolean {
  return (summary as RunSummaryWithPresence).artifactsStored === false;
}

/** What a console says about a run whose artifact tree is not stored. */
export const ARTIFACTS_NOT_STORED_LABEL =
  "No stored artifacts: the artifact service holds no source or build for this run, so it cannot be published";
