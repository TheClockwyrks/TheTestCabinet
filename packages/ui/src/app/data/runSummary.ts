import type { RunRecord } from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type { StoredReview } from "../../client/types";
import { aggregateRating } from "../../ratings";

// Build a lightweight {@link RunSummary} card from a full {@link RunRecord} plus
// its reviews — the TypeScript mirror of the Rust `RunSummary::from_stored`
// (crates/backend/src/snapshot.rs). The console derives its summaries from the
// full records it already loads (an additive step); once the summary/detail
// split lands over the wire (U7) the backend serves these directly. The shape
// mirrors the generated `RunSummary` exactly.
export function toRunSummary(
  record: RunRecord,
  reviews: readonly StoredReview[],
): RunSummary {
  return {
    id: record.id,
    // A console record carries no publish timestamp (it is the run record, not a
    // published-run row), so this is empty here. The wire summary (U7) carries the
    // real value; the snapshot cards always do.
    publishedAt: "",
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    subject: {
      testCaseSlug: record.subject.testCaseSlug,
      testCaseVersion: record.subject.testCaseVersion,
      testType: record.subject.testType,
      variant: record.subject.variant,
      harnessSlug: record.subject.harnessSlug,
      harnessVersion: record.subject.harnessVersion,
      modelId: record.subject.modelId,
    },
    // The display name is resolved from the catalog elsewhere in the UI; fall back
    // to the slug so a summary is self-describing without a catalog lookup.
    caseName: record.subject.testCaseSlug,
    metrics: record.metrics,
    validationLoaded: record.validation.loaded,
    state: record.status.state,
    // The run's overall rating: the worst rating any reviewer gave any domain, or
    // null when the run carries no reviews. Reuses the shared aggregate logic so
    // the rating order matches the Rust core (`aggregate_rating`) and the rest of
    // the UI (cards, leaderboard, badges).
    rating: aggregateRating(reviews.map((r) => r.ratings ?? [])),
    reviewCount: reviews.length,
    // Catalog-free, mirroring the Rust `from_stored`: the score's checklist
    // weights live only in the case catalog, so it stays null here. The wire
    // summary (enriched by the backend against the catalog) carries the real
    // value.
    score: null,
    // The correctness-and-fuel result of a performance run, lifted onto the card
    // so the fuel leaderboard and a run's percentile can rank a local, not-yet-
    // published run too (mirrors the Rust `from_stored`). Null for a non-
    // performance run, which carries no `validation.performance`.
    performance: record.validation.performance
      ? {
          correct: record.validation.performance.correct,
          totalFuel: record.validation.performance.totalFuel,
        }
      : null,
    // The console's records already carry populated links (see the ingest path in
    // useLiveGallery), the same source the full-record path reads.
    links: {
      sourceRepo: record.links.sourceRepo,
      playableBuild: record.links.playableBuild,
    },
  };
}
