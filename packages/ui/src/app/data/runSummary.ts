import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type { StoredRun } from "../../client/types";
import {
  aggregateAestheticRating,
  aggregateRating,
  reviewAesthetic,
} from "../../ratings";

// Build a lightweight {@link RunSummary} card from a full {@link StoredRun} — its
// record, its reviews, and the store's word on its rating channels — the
// TypeScript mirror of the Rust `RunSummary::from_stored`
// (crates/backend/src/snapshot.rs). The console derives its summaries from the
// full records it already loads (an additive step); once the summary/detail
// split lands over the wire (U7) the backend serves these directly. The shape
// mirrors the generated `RunSummary` exactly.
export function toRunSummary(stored: StoredRun): RunSummary {
  const { record } = stored;
  const reviews = stored.reviews ?? [];
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
      // The engine the build was written against, and the runtime version vendored
      // into the run repository. Lifted onto the card exactly as the variant is: the
      // engine is a run dimension chosen beside it, and two runs of the same variant
      // on different engines are not the same run to compare.
      engineSlug: record.subject.engineSlug,
      engineVersion: record.subject.engineVersion ?? null,
      modelId: record.subject.modelId,
      // The gg configuration the run was launched from, lifted off its capability
      // set exactly as the Rust `SubjectOut::from` does — a gg row in the run log
      // is identified by its configuration, not by the one representative model
      // `modelId` carries. Null for every third-party-harness run (no capability
      // set) and for a gg run assembled by hand rather than from a named
      // configuration.
      ggPreset: record.subject.ggCapabilitySet?.preset ?? null,
    },
    // The display name is resolved from the catalog elsewhere in the UI; fall back
    // to the slug so a summary is self-describing without a catalog lookup.
    caseName: record.subject.testCaseSlug,
    metrics: record.metrics,
    validationLoaded: record.validation.loaded,
    state: record.status.state,
    // The run's FUNCTIONAL rating. On a validator-rated run it is the store's
    // validator-decided rating (present from completion, untouched by reviews);
    // on a legacy run it is the worst rating any reviewer gave any domain, or
    // null while unreviewed. Reuses the shared aggregate logic so the rating order
    // matches the Rust core (`aggregate_rating`) and the rest of the UI.
    rating: stored.validatorRated
      ? stored.rating
      : aggregateRating(reviews.map((r) => r.ratings ?? [])),
    // The aggregate AESTHETIC rating — the worst run-wide tier any reviewer gave
    // — or null when no review rated the channel (every legacy run). Derived from
    // the reviews rather than read off the store so a review submitted this
    // session shows before the store's lifted column is re-read.
    aesthetic: aggregateAestheticRating(reviews.map((r) => reviewAesthetic(r))),
    validatorRated: stored.validatorRated,
    reviewCount: reviews.length,
    // The store's score against the case catalog (the same figure the wire
    // summary cards carry): on a validator-rated run the validator-decided score,
    // present from completion with `reviews` 0, so a run this console produced
    // shows its points in the run log and ranks on the case leaderboard the
    // moment it completes; on a legacy run the mean across reviews. Null when
    // the host holds no catalog for the run's case version.
    score: stored.score,
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
