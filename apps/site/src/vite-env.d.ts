/// <reference types="vite/client" />

// The INDEX of the published dataset, supplied by `vite-plugin-snapshot` from the
// backend's public R2 snapshot and inlined into the bundle at build time; empty
// in dev and when no snapshot URL is configured.
//
// It holds what a listing shows for every run and every case, and nothing else.
// A run's record, reviews and media and a case's variants, changelog, errata and
// media are static files the build writes beside the bundle, read through
// `static-files.ts` when a page of that run or case opens.
declare module "virtual:tcab-snapshot" {
  import type { Comparison } from "@clockwyrks/backend-api/comparison";
  import type { RunSummary } from "@clockwyrks/backend-api/snapshot";
  import type { GgRunDoc } from "@clockwyrks/run-record/gg-query";
  import type {
    TestCaseGroupSummary,
    TestCaseSummary,
  } from "@clockwyrks/ui/app";
  import type { Model } from "@clockwyrks/ui/client";

  /**
   * The flat summary index (`runs.json`), newest first — the bounded run-summary
   * cards the run log and list pages consume.
   */
  export const runSummaries: RunSummary[];
  /**
   * One listing card per published case. A version is listed in a card's
   * `versions` exactly when the build wrote its `cases/<slug>/<version>.json`.
   */
  export const testCases: TestCaseSummary[];
  /** The composed model catalog (wire `Model` shape); mapped via `toModelSummary`. */
  export const models: Model[];
  /** The published harness comparisons, each the full read model (rendered read-only). */
  export const comparisons: Comparison[];
  /**
   * The test-case groups (the wire `TestCaseGroupOut` shape, consumed as the
   * app's {@link TestCaseGroupSummary}), already in display order — the home
   * page renders one leaderboard per group. Empty when the snapshot predates
   * them.
   */
  export const testCaseGroups: TestCaseGroupSummary[];
  /**
   * The exported gg **document corpus** and the instant it was taken, or null when the
   * snapshot carries none — in which case the site mounts no analysis surface.
   *
   * These documents are what the public Discover surface evaluates, in the browser, with
   * the mirrored evaluator: no backend, no query endpoint, no request. They arrive
   * already filtered (no experimental case) and field-redacted, and they never contain a
   * replay record.
   */
  export const ggRuns: { generatedAt: string; documents: GgRunDoc[] } | null;
  /**
   * The media each case's catalog card previews (its `showcase`), resolved to
   * absolute URLs and keyed by the previewed `<slug>/<version>/<variant>` subject
   * then by the authored file name (a video's `.webm` request resolving to its
   * published `.mp4`). The catalog is a listing, so this one slice of a case
   * version's showcase media is index data. The previewed version may have no
   * file of its own (no published run built it), so these addresses are the
   * only ones the site holds for it.
   */
  export const catalogShowcaseMediaUrls: Record<string, Record<string, string>>;
}
