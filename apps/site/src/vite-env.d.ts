/// <reference types="vite/client" />

// Build-time published dataset, supplied by `vite-plugin-snapshot` from the
// backend's public R2 snapshot. Inlined into the bundle at build time; empty in
// dev and when no snapshot URL is configured.
declare module "virtual:tcab-snapshot" {
  import type { RunRecord } from "@test-cabinet/run-record";
  import type { RunSummary } from "@test-cabinet/run-record/snapshot";
  import type { StoredReview } from "@test-cabinet/ui/client";
  import type { TestCaseSummary } from "@test-cabinet/ui/app";
  import type { Model } from "@test-cabinet/ui/client";

  /** Published run records, newest first (verbatim snapshot blobs). */
  export const runs: RunRecord[];
  /**
   * The flat summary index (`runs.json`), newest first — the bounded run-summary
   * cards the run log and list pages consume.
   */
  export const runSummaries: RunSummary[];
  /**
   * Reconstructed `writeup.md` framing per run id (rating frontmatter + body).
   * The *aggregate* writeup when a run carries more than one review.
   */
  export const writeups: Record<string, string>;
  /** Each published run's individual reviews, keyed by run id. */
  export const reviews: Record<string, StoredReview[]>;
  /** Published test-case catalog metadata. */
  export const testCases: TestCaseSummary[];
  /** The composed model catalog (wire `Model` shape); mapped via `toModelSummary`. */
  export const models: Model[];
  /**
   * Resolved proof-of-implementation media URLs, keyed by run id then by served
   * file name (`<proof-id>.<ext>`).
   */
  export const proofMediaUrls: Record<string, Record<string, string>>;
  /**
   * Resolved asset-generation media URLs, keyed by run id then by served file name
   * — a single sprite's `regenerated.png`/`preview.png`/`target.png`/`actions.json`
   * or a sprite sheet's per-frame `regenerated-<index>.png` (etc.).
   */
  export const assetMediaUrls: Record<string, Record<string, string>>;
}
