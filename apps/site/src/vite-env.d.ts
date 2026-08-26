/// <reference types="vite/client" />

// Build-time published dataset, supplied by `vite-plugin-snapshot` from the
// backend's public R2 snapshot. Inlined into the bundle at build time; empty in
// dev and when no snapshot URL is configured.
declare module "virtual:tcab-snapshot" {
  import type { RunSummary } from "@test-cabinet/run-record/snapshot";
  import type { StoredReview } from "@test-cabinet/ui/client";
  import type {
    SeededInput,
    TestCaseDetail,
    TestCaseGroupSummary,
    VariantSummary,
  } from "@test-cabinet/ui/app";
  import type { Model } from "@test-cabinet/ui/client";
  import type { Comparison } from "@test-cabinet/run-record/comparison";
  import type { GgRunDoc } from "@test-cabinet/run-record/gg-query";

  /**
   * The flat summary index (`runs.json`), newest first — the bounded run-summary
   * cards the run log and list pages consume. Full records are NOT inlined; they
   * are fetched lazily by id from the emitted `runs/<id>.json` asset.
   */
  export const runSummaries: RunSummary[];
  /**
   * Reconstructed `writeup.md` framing per run id (rating frontmatter + body).
   * The *aggregate* writeup when a run carries more than one review.
   */
  export const writeups: Record<string, string>;
  /** Each published run's individual reviews, keyed by run id. */
  export const reviews: Record<string, StoredReview[]>;
  /**
   * The published test-case catalog, inlined in FULL at build time. The site has
   * no backend to fetch a case from, so each entry carries the detail
   * (variants, changelog, errata) a case page needs as well as the listing
   * fields; `staticGallery` serves both halves of the contract from this array.
   */
  export const testCases: SnapshotTestCase[];

  /**
   * One variant as the snapshot carries it: the gallery's {@link VariantSummary}
   * (the engineless rendering) plus the same prompt and specs re-rendered for
   * each engine the version declares that vendors a runtime. A case's prompt and
   * `.hbs` specs branch on the selected engine, so a run's Inputs tab reads the
   * entry for the engine its run recorded.
   */
  export interface SnapshotVariant extends VariantSummary {
    engineRenderings: Record<
      string,
      { prompt: string; seededInputs: SeededInput[] }
    >;
  }

  /**
   * One case as the snapshot carries it: the gallery's {@link TestCaseDetail}
   * (whose `variants` are the latest version's) plus every older published
   * version's variants, so a run of an older version resolves the inputs it was
   * itself given.
   */
  export interface SnapshotTestCase extends Omit<TestCaseDetail, "variants"> {
    variants: SnapshotVariant[];
    priorVariantsByVersion: Record<string, SnapshotVariant[]>;
  }
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
  /**
   * Resolved *actual* automated-validation media URLs (the model build's debug-script
   * outputs), keyed by run id then by the flat `<item>__<output>.<ext>` name the
   * reviewer UI requests.
   */
  export const validationMediaUrls: Record<string, Record<string, string>>;
  /**
   * Resolved showcase media URLs (the run's carousel media plus any image the
   * description references), keyed by run id then by the recorded file name (a
   * video's `.webm` request resolving to its published `.mp4`).
   */
  export const showcaseMediaUrls: Record<string, Record<string, string>>;
  /**
   * Resolved code-analysis document URLs, keyed by run id — one per run, since a run
   * has exactly one analysis.
   *
   * A run id **absent** from this map was never analysed, which is most of the corpus:
   * analysis is deliberately not backfilled, so it starts on the day the analyzer
   * shipped. That absence means "not measured", never "wrote no code".
   */
  export const codeAnalysisUrls: Record<string, string>;
  /**
   * Resolved *baseline* automated-validation media URLs (the reference
   * implementation's debug-script outputs), keyed by a `<slug>/<version>/<variant>`
   * subject key then by the flat `<item>__<output>.<ext>` name. Case-scoped.
   */
  export const validationBaselineUrls: Record<string, Record<string, string>>;
  /**
   * Resolved **asset-reference** media URLs (an asset-generation case variant's
   * published reference frames), keyed by a `<slug>/<version>/<variant>` subject key
   * then by the file below that variant's prefix — `frames/<index>.png` and the
   * `frames/<index>.actions.json` log it was drawn from. Case-scoped, like the
   * validation baselines.
   */
  export const referenceMediaUrls: Record<string, Record<string, string>>;
}
