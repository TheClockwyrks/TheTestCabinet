import type { Plugin } from "vite";
import type {
  AssetKind,
  AssetSheet,
  MediaKind,
  TestType,
} from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";

// Build-time data source: the public R2 snapshot.
//
// The site is fully static and has no live dependency on the backend. The
// backend exports a read-only public snapshot to a Cloudflare R2 bucket
// (see design/v0.2.0-contracts.md §3); this plugin fetches that snapshot once,
// at build time, and exposes it to the app as the virtual module
// `virtual:tcab-snapshot`. The fetched data is inlined into the bundle, so the
// shipped output is static — nothing reaches the backend or R2 at runtime.
//
// The snapshot base URL is read from `TCAB_SNAPSHOT_URL` (the public base under
// which `index.json` is served, e.g. `https://snapshot.testcabinet.ai`). When
// it is unset — local dev, or a CI build with no snapshot wired up — the virtual
// module resolves to an empty dataset and the build still succeeds. The
// `localRuns` dev plugin remains the source of on-disk, unpublished runs during
// `vite dev`; this plugin contributes the *published* dataset.
//
// A set URL whose `index.json` 404s is the *fresh-deployment* case: the bucket
// exists but nothing has been published yet (`index.json` is the atomic pointer
// the backend writes last, only on a publish). That, too, resolves to an empty
// dataset and succeeds — otherwise every gallery build would fail until the very
// first publish. Only a *reachable-but-broken* snapshot (a network error, a 5xx,
// or a sub-file that `index.json` references but is missing) fails the build.

const VIRTUAL_ID = "virtual:tcab-snapshot";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

// The engineless run's slug. It mirrors `DEFAULT_ENGINE_SLUG` in
// `packages/ui/src/app/data/engines.ts`, restated rather than imported because this
// plugin runs in the Vite config, outside the app bundle it would have to pull in
// to reach it. A snapshot always carries the engineless rendering (it is a
// variant's own `prompt`/`seededInputs`), so it is always one of the engines a
// version's inputs can be read under.
const NONE_ENGINE_SLUG = "none";

// ---- Snapshot wire shapes (subset of design/v0.2.0-contracts.md §3) ----------

interface SnapshotIndex {
  schemaVersion: number;
  snapshotId: string;
  generatedAt: string;
  runCount: number;
  runsKey: string;
  // The shared, snapshot-independent prefix the per-run documents live under. Purely
  // informational here: a run's document is content-addressed, so it is reached
  // through the `documentKey` on its summary rather than by composing a path.
  runDocumentsPrefix: string;
  casesPrefix: string;
  // Optional so a snapshot published before the model catalog existed still loads
  // (the site then renders an empty Models section).
  modelsKey?: string;
  // Where the published harness comparisons live (`<prefix>/comparisons.json`).
  // Optional so a snapshot published before comparisons existed still loads (the
  // site then has none).
  comparisonsKey?: string;
  // Where the test-case groups live (`<prefix>/test-case-groups.json`).
  // Optional so a snapshot published before groups existed still loads (the home
  // page then renders no group leaderboards).
  testCaseGroupsKey?: string;
  // Where the gg document corpus lives (`<prefix>/gg-runs.json`) — the payload the
  // public Discover surface evaluates in the browser. Optional so a snapshot published
  // before the gg export existed still loads (the site then mounts no analysis
  // surface at all).
  ggRunsKey?: string;
}

interface SnapshotModelsFile {
  schemaVersion: number;
  // Wire `ModelOut` shape; the app maps it via `toModelSummary`.
  models: unknown[];
}

interface SnapshotComparisonsFile {
  schemaVersion: number;
  // Wire `Comparison` shape (`@test-cabinet/run-record/comparison`); consumed as-is.
  comparisons: unknown[];
}

interface SnapshotTestCaseGroupsFile {
  schemaVersion: number;
  // Wire `TestCaseGroupOut` shape (`TestCaseGroupsFile` in
  // `@test-cabinet/run-record/snapshot`), already in display order; the app
  // consumes it as its `TestCaseGroupSummary`.
  groups: unknown[];
}

// The gg document corpus (`gg-runs.json`): every exported gg run as one flat map of
// dotted fields, plus the instant the export was taken. Consumed as-is — the app's
// mirrored evaluator reads `GgRunDoc` directly — and inlined into the bundle like every
// other snapshot payload, so the public analysis surface makes no request at runtime.
//
// The documents arrive already **filtered** (no experimental case) and **field-redacted**;
// neither can be re-checked here, which is why both happen at export time. A replay
// record is never part of this file.
interface SnapshotGgRunsFile {
  schemaVersion: number;
  generatedAt: string;
  documents: unknown[];
}

// The flat summary index (`runs.json`, the snapshot's `ln` key): the full
// `RunSummary` cards the backend publishes, newest first. These ARE the app's
// `runSummaries` — every enriched field is served, so no per-field remapping is
// needed. An older snapshot that predates a field is tolerated the same way the
// UI's optional typing tolerates it.
interface SnapshotRunsFile {
  schemaVersion: number;
  runs: RunSummary[];
}

interface SnapshotReviewVerdict {
  id: string;
  status: string;
  note?: string;
}

interface SnapshotDomainRating {
  domain: string;
  rating: string;
}

// One per-domain AESTHETIC rating of a review — the second channel, carried only
// by a review of a validator-rated run.
interface SnapshotDomainAesthetic {
  domain: string;
  rating: string;
}

// One review entry in a run's `reviews[]` array: the reviewer's verdict plus
// attribution (the public snapshot exposes the display name and id, not the
// username). A run can carry more than one.
interface SnapshotReview {
  reviewerId?: string;
  reviewer?: string;
  ratings: SnapshotDomainRating[];
  // The reviewer's per-domain aesthetic ratings; absent on a legacy run's review.
  aesthetics?: SnapshotDomainAesthetic[];
  writeup: string;
  checklist?: SnapshotReviewVerdict[];
  reviewedAt?: string | null;
  // The snapshot-relative object key of the reviewer's profile picture
  // (`pfp/<reviewer-id>`), when they have one. Resolved to an absolute avatar URL
  // against the snapshot base. Absent for a reviewer with no picture, or a snapshot
  // written before reviewer pictures existed.
  pictureKey?: string | null;
}

// `documents/runs/<run-id>/<digest>.json`: the full run record plus its review and
// links, and the
// recorded normalized event stream when the run captured one (raw harness output
// is never published). The events are emitted as a separate per-run static asset
// rather than inlined into the bundle, so the gallery JS doesn't carry every
// run's full event log.
interface SnapshotRunFile {
  schemaVersion: number;
  record: unknown; // a full RunRecord (camelCase, links populated)
  // Every review submitted against the run (one per reviewer). Only published
  // runs appear in the snapshot, and the publish gate requires at least one.
  reviews: SnapshotReview[];
  links?: { sourceRepo: string | null; playableBuild: string | null };
  events?: unknown; // a JSON array of normalized HarnessEvents, when present
  // The run's uploaded proof-of-implementation media, named by snapshot-relative
  // key. Optional for snapshots written before proofs existed.
  proofMedia?: Array<{ id: string; kind: "image" | "video"; key: string }>;
  // An asset-generation run's media (regenerated/preview/target image + action
  // log), keyed by served file name (`regenerated.png`, `preview.png`,
  // `target.png`, `actions.json`). Absent for a non-asset-generation run and for
  // snapshots written before asset generation existed.
  assetMedia?: Array<{ file: string; key: string }>;
  // The run's synthesized *actual* automated-validation media (the model build's
  // per-review-item debug-script outputs). `file` is the flat `<item>__<output>.<ext>`
  // name the reviewer UI requests (`.png`/`.webm`); `key` is the published object
  // (a video transcoded to `.mp4`, so `key` and `file` differ in extension for a
  // clip). Absent for a run with no debug scripts and for snapshots written before
  // automated validation existed.
  validationMedia?: Array<{ file: string; key: string }>;
  // The run's showcase files — the carousel media plus any image the description
  // references. `file` is the recorded name the UI requests; `key` is the published
  // object (a video transcoded to `.mp4`, so `key` and `file` differ in extension
  // for a clip). Absent for a run whose record carries no showcase and for
  // snapshots written before the showcase existed.
  showcaseMedia?: Array<{ file: string; key: string }>;
  // The snapshot-relative key of the run's unbounded code-analysis document (every
  // authored file, scored function, import edge, cycle and clone group), published as
  // its own generation-keyed object so the Code tab fetches it on demand instead of
  // this document carrying a tier only one tab reads. Absent when the run was never
  // analysed — the corpus is deliberately not backfilled, so that is most of it — and
  // for snapshots written before code analysis existed.
  codeAnalysisKey?: string;
}

// `cases/<slug>/<version>.json`: the site-facing slice of a test-case version.
interface SnapshotCaseFile {
  schemaVersion: number;
  slug: string;
  version: string;
  name: string;
  // The case's test type. Optional for snapshots written before it was published;
  // defaults to "end-to-end" when absent.
  testType?: TestType;
  // Whether the version is on the ENGINE manifest format — which, with the test
  // type (a game jam never is), makes it VALIDATOR-RATED: its runs' functional
  // rating and score come from the validators (every review item carries a
  // `failureCap` and `domains`) and reviewers rate only the aesthetic channel.
  // Optional for snapshots written before the field existed (legacy).
  engineFormat?: boolean;
  // The asset shape an asset-generation case produces, partitioning the catalog's
  // 2D / 3D / Particle / Audio tabs. Optional for snapshots written before it was
  // published; treated as `sprite` when absent.
  assetKind?: AssetKind;
  // The sprite-sheet frame grid and named sequences a sprite-sheet case declares.
  // Carried so the site's asset Reference tab can play the reference frames as the
  // animations they belong to (the frames alone say nothing about motion). Absent
  // for a non-sheet case, and for snapshots written before the field existed — in
  // which case the tab shows the still frames only.
  sheet?: AssetSheet | null;
  difficulty: string;
  tags: string[];
  summary: string | null;
  description: string | null;
  // This version's own changelog entry (its `changelog.md` body). Optional for
  // snapshots written before changelogs existed.
  changelog?: string | null;
  variants: Array<{
    slug: string;
    name: string;
    description: string | null;
    // The variant's prompt, rendered by the backend as a real run receives it.
    prompt: string;
    // The variant's own seeded spec files (additive to the common ones), bodies
    // inlined. Optional for snapshots written before specs were inlined.
    seededInputs?: SnapshotSeededInput[];
    // The prompt and seeded specs re-rendered for each engine the version declares
    // that vendors a runtime, keyed by engine slug. `prompt`/`seededInputs` above
    // are the engineless rendering, which is also what a run on the `none` engine
    // received, so the engineless engine is deliberately absent here. Absent
    // entirely on a snapshot written before the field existed. Each rendering
    // also carries the variant's effective starter-workspace file set for its
    // engine (`workspaceFiles`, absent on snapshots written before the field) —
    // the per-engine half of the variant-level `workspaceFiles` below.
    engineRenderings?: Record<
      string,
      {
        prompt: string;
        seededInputs?: SnapshotSeededInput[];
        workspaceFiles?: SnapshotWorkspaceFile[];
      }
    >;
    // The variant's own reviewer checklist items (additive to the common ones).
    reviewItems?: SnapshotReviewItem[];
    // The variant's own scoring domains (additive to the common ones), rated only
    // when this variant is selected.
    domains?: SnapshotDomain[];
    // The absolute URLs of this variant's reference-implementation builds, keyed by
    // the engine each was built for (emitted by the Rust snapshot export as
    // camelCase `referenceBuilds`). Absent when the variant declares no
    // `reference_implementation`, and on a snapshot written before the field.
    referenceBuilds?: Record<string, string>;
    // An ASSET-GENERATION variant's published reference frames: the indices whose
    // rendered image and action log `tcab publish-reference` uploaded to this very
    // bucket. Null/absent when the variant has no published asset reference (every
    // end-to-end variant, and any snapshot written before the field existed).
    referenceSheet?: { frames: number[] } | null;
    // The variant's authored SHOWCASE (`CaseShowcaseOut`): the description plus
    // the media carousel captured from the reference implementation, each entry
    // naming the authored file (what the UI keys the entry by) and the published
    // object key (a `.webm` clip published as `.mp4`, everything else verbatim).
    // Null when the variant declares none; absent on snapshots written before
    // the field existed.
    showcase?: {
      description: string;
      media: Array<{
        file: string;
        name: string;
        kind: MediaKind;
        key: string;
      }>;
    } | null;
    // The variant's effective starter-workspace files for the ENGINELESS
    // rendering (`CaseWorkspaceFileOut[]`): the run-root-relative destination
    // each file is seeded at and the published object key its bytes live under
    // (the bytes are fetched lazily — a starter project can be large). The
    // per-engine sets ride on each `engineRenderings` entry. Absent on snapshots
    // written before the field existed.
    workspaceFiles?: SnapshotWorkspaceFile[];
  }>;
  checks?: Array<{ view: string; name: string; referenceView: string | null }>;
  // The runtime packages this case ships into every run (case-level), each with a
  // UI-only description. Optional for snapshots written before the field existed.
  packages?: SnapshotPackage[];
  // Reviewer checklist items shared by every variant, with point weights.
  commonReviewItems?: SnapshotReviewItem[];
  // The case's common scoring domains (shared by every variant; a variant's own
  // additive domains ride on each variant's `domains`).
  domains?: SnapshotDomain[];
  // Optional: reference screenshots exposed as snapshot-relative keys. The
  // contract permits emitting these per case; when present we resolve them to
  // absolute URLs so the References tab can show baselines.
  references?: Array<{
    variant: string | null; // null/`_common` => shown on every variant
    view: string;
    // How the reference is produced: rendered mockup, static image, or static
    // video. Optional for snapshots written before the field existed.
    kind?: "rendered" | "image" | "video";
    key: string; // snapshot-relative object key
  }>;
  // The case's committed **baseline** automated-validation media (a debug script's
  // outputs driven once against the reference implementation), per variant. `file` is
  // the flat `<item>__<output>.<ext>` name the reviewer UI requests (`.png`/`.webm`);
  // `key` is the published object (a video transcoded to `.mp4`). Case-scoped, so the
  // gallery resolves the reviewer's baseline side-by-side from these keyed by
  // slug/version/engine/variant. Optional for snapshots written before automated
  // validation existed.
  validationBaselines?: Array<{
    engine: string;
    variant: string;
    file: string;
    key: string;
  }>;
  // Known-issue errata recorded for this version after it shipped (`CaseErratumOut`).
  // Optional for snapshots written before errata existed.
  errata?: SnapshotErratum[];
}

// One known-issue erratum inlined in case metadata (mirrors `CaseErratumOut` /
// the UI's `Erratum`).
interface SnapshotErratum {
  id: string;
  title: string;
  date: string | null;
  severity: "info" | "minor" | "major";
  affectsScoring: boolean;
  // Whether the linked review point is excluded from scoring for the version.
  // Absent on snapshots written before the field existed; treated as false.
  excludeFromScore?: boolean;
  body: string;
  resolvedIn: string | null;
  variant: string | null;
  review: string | null;
}

// One starter-workspace file in case metadata (`CaseWorkspaceFileOut`): the
// run-root-relative destination it is seeded at and the snapshot-relative object
// key its bytes were published under. Unlike a seeded spec the body is NOT
// inlined — a starter project can be large and most readers never open it, so
// the site fetches a file lazily by its resolved URL.
interface SnapshotWorkspaceFile {
  dest: string;
  key: string;
}

// One seeded spec file inlined in case metadata: the run-workspace path it lands
// at and its text body. The public snapshot inlines these (bodies and all) so the
// fully static site can show the exact specs a run is seeded with.
interface SnapshotSeededInput {
  path: string;
  text: string;
  // The seeded file's role (`spec`/`script`), so the Inputs tab can tag it. Absent
  // on snapshots written before the field existed; treated as "spec".
  kind?: "spec" | "script";
}

// One runtime package a case ships into its runs, inlined in case metadata: its
// npm name and the UI-only description of what it provides.
interface SnapshotPackage {
  name: string;
  description: string;
}

interface SnapshotReviewItem {
  id: string;
  title: string;
  text: string;
  reference?: string | null;
  proof?: string | null;
  sequences?: string[];
  frames?: number[];
  weight: number;
  // Whether the item is graded on the five-level scale (a game-jam category)
  // rather than pass/fail — it is then worth `weight × 10` points and earns its
  // graded tier's points times its weight. Absent on snapshots written before the
  // field existed; treated as false (every pre-jam case is pass/fail).
  graded?: boolean;
  domain?: string | null;
  // On a validator-rated version: the failure cap of a whole-item point and the
  // domain ids a failure lowers (see `AssembledReviewItem`). Absent on a legacy
  // version and on a snapshot written before the fields existed.
  failureCap?: string | null;
  domains?: string[];
  // The sub-items this item is graded by, each an independently scored pass/fail
  // point. Absent on snapshots written before sub-items existed.
  subItems?: SnapshotSubReviewItem[];
}

interface SnapshotSubReviewItem {
  id: string;
  title: string;
  // Prose for this point (categories grammar); null/absent for a legacy name-only
  // sub-item.
  description?: string | null;
  // How many points this point is worth; the parent category's weight is the sum
  // of its sub-items' weights. Absent on snapshots written before sub-items
  // carried their own weight; treated as 1.
  weight?: number;
  // The reference view / proof id paired with this point, when it declares them.
  reference?: string | null;
  proof?: string | null;
  // On a validator-rated version: this point's failure cap and the domain ids a
  // failure lowers. Absent on a legacy version.
  failureCap?: string | null;
  domains?: string[];
}

interface SnapshotDomain {
  id: string;
  name: string;
  description: string;
}

// ---- The shape the app consumes (mirrors src/data/testCases.ts) -------------

// One assembled review the app consumes (the gallery's `StoredReview`). The
// public snapshot carries the display name + id, not the username.
interface AssembledReview {
  reviewerId: string;
  reviewer: string;
  ratings: SnapshotDomainRating[];
  aesthetics: SnapshotDomainAesthetic[];
  writeup: string;
  checklist: SnapshotReviewVerdict[];
  reviewedAt: string | null;
  // The reviewer's absolute avatar URL (resolved from `pictureKey` against the
  // snapshot base), or null when they have no picture. Shown beside their name.
  reviewerPictureUrl: string | null;
}

interface AssembledSnapshot {
  // The flat summary index (`runs.json`), newest first — the bounded `RunSummary`
  // cards the run log and list pages consume, taken verbatim from the backend's
  // published index (no extra fetches). The app types these as RunSummary[].
  runSummaries: RunSummary[];
  // `writeups/<runId>` framing reconstructed from each run's reviews (the
  // *aggregate* writeup when there are several), keyed by run id — the same
  // `---\nrating: …\n---\n\n<body>` form the app parses for the cards/badges.
  writeups: Record<string, string>;
  // Each run's individual reviews, keyed by run id — the app's `reviewsFor(runId)`
  // reads this for the run-detail per-reviewer breakdown and the aggregate score.
  reviews: Record<string, AssembledReview[]>;
  // Test-case metadata, mapped to the app's TestCaseSummary shape.
  testCases: AssembledTestCase[];
  // The composed model catalog (wire `ModelOut[]`); the app maps it via
  // `toModelSummary`. Empty when the snapshot predates the model catalog.
  models: unknown[];
  // The published harness comparisons (wire `Comparison[]`), each already the full
  // read model the backend assembled. Empty when the snapshot has none.
  comparisons: unknown[];
  // The test-case groups (wire `TestCaseGroupOut[]`), already in display order —
  // the home page's per-group leaderboards. Empty when the snapshot predates them.
  testCaseGroups: unknown[];
  // The gg document corpus and the instant it was exported, or null when the snapshot
  // carries none — in which case the site mounts no analysis surface. Held whole rather
  // than remapped: the app's evaluator reads these documents as they are.
  ggRuns: { generatedAt: string; documents: unknown[] } | null;
  // Resolved proof media URLs, keyed by run id then by served file name
  // (`<proof-id>.<ext>`). The app's `proofMediaUrl(runId, file)` reads this.
  proofMediaUrls: Record<string, Record<string, string>>;
  // Resolved asset-generation media URLs, keyed by run id then by served file name
  // (`regenerated.png`, `preview.png`, `target.png`, `actions.json`). The app's
  // `assetMediaUrl(runId, file)` reads this.
  assetMediaUrls: Record<string, Record<string, string>>;
  // Resolved *actual* automated-validation media URLs, keyed by run id then by the
  // flat `<item>__<output>.<ext>` name the reviewer UI requests. The app's
  // `validationMediaUrl(runId, file)` reads this.
  validationMediaUrls: Record<string, Record<string, string>>;
  // Resolved showcase media URLs (the run's carousel media plus any image the
  // description references), keyed by run id then by the recorded file name (a
  // video's `.webm` request resolving to its published `.mp4`). The app's
  // `showcaseMediaUrl(runId, file)` reads this.
  showcaseMediaUrls: Record<string, Record<string, string>>;
  // Resolved CASE showcase media URLs (a variant's authored carousel, captured
  // from the reference implementation), keyed by a `<slug>/<version>/<variant>`
  // subject key then by the authored file name (a video's `.webm` request
  // resolving to its published `.mp4`). Case-scoped like the baselines below —
  // the showcase is committed with the version, not produced by a run. The
  // app's `caseShowcaseMediaUrl(slug, version, variant, file)` reads this.
  caseShowcaseMediaUrls: Record<string, Record<string, string>>;
  // Resolved code-analysis document URLs, keyed by run id — one URL per run, not a
  // map of files, because a run has exactly one analysis. The app's
  // `readCodeAnalysis(runId)` fetches this on demand.
  //
  // A run id absent from this map was **never analysed**, which is most of the corpus:
  // analysis is deliberately not backfilled, so it starts on the day the analyzer
  // shipped. The Code tab reads that absence as "not measured" and says so; it must
  // never be read as "this model wrote no code".
  codeAnalysisUrls: Record<string, string>;
  // Resolved *baseline* automated-validation media URLs, keyed by a
  // `<slug>/<version>/<engine>/<variant>` subject key then by the flat
  // `<item>__<output>.<ext>` name. Case-scoped, so keyed by subject rather than run
  // id. The app's `validationBaselineUrl(subject, file)` reads this.
  validationBaselineUrls: Record<string, Record<string, string>>;
  // Resolved **asset-reference** media URLs — a published reference frame's image,
  // and the action log it was drawn from — keyed by a `<slug>/<version>/<variant>`
  // subject key then by the file below that variant's prefix (`frames/<index>.png`,
  // `frames/<index>.actions.json`). Case-scoped like the baselines above, since a
  // reference belongs to a case version rather than to any run. The app's
  // `referenceMediaUrl(slug, version, variant, file)` reads this.
  referenceMediaUrls: Record<string, Record<string, string>>;
}

interface AssembledReference {
  view: string;
  kind: "image" | "video";
  url: string;
}

interface AssembledReviewItem {
  id: string;
  title: string;
  text: string;
  reference: string | null;
  proof: string | null;
  sequences: string[];
  frames: number[];
  weight: number;
  // Whether the item is graded on the five-level scale (a game-jam category). The
  // whole jam presentation hangs off this: the verdict page shows the reviewer's
  // whole-game overall grade in place of a rating, each category is scored
  // `weight × 10` rather than one pass/fail point, and the checklist rows render
  // the grade tier. Omitted (treated as false) for a pass/fail case.
  graded?: boolean;
  domain: string | null;
  // On a VALIDATOR-RATED version, the failure cap of a whole-item point — the
  // highest functional rating its `domains` may reach while its validator fails —
  // and the domain ids a failure lowers. The site derives a validator-rated run's
  // functional rating from these exactly as the console does. Null/empty on a
  // legacy version and on a category (whose points carry their own).
  failureCap?: string | null;
  domains: string[];
  // Whether this item contributes to the run's score. Omitted (treated as true)
  // unless a version erratum's `excludeFromScore` links its verdict id, in which case
  // it is `false` — still shown, just not scored. Mirrors `ReviewItem.scored`.
  scored?: boolean;
  subItems: AssembledSubReviewItem[];
}

interface AssembledSubReviewItem {
  id: string;
  title: string;
  // This point's own prose and point weight (the categories grammar), null/omitted
  // for a legacy name-only sub-item. The weight is what the site scores the point
  // by, so carrying it keeps the public score in step with the backend's.
  description?: string | null;
  weight?: number;
  reference?: string | null;
  proof?: string | null;
  // On a validator-rated version, this point's failure cap and the domain ids a
  // failure lowers (see `AssembledReviewItem`). Null/empty on a legacy version.
  failureCap?: string | null;
  domains: string[];
  // Whether this sub-item contributes to the score (see `AssembledReviewItem.scored`).
  scored?: boolean;
}

// Combine a case's common review items with a variant's own, merging by id so a
// variant that reuses a common category's id extends that category (folding in its
// items and weight) rather than forming a duplicate group. A fresh-id variant item
// is appended, preserving "common first, then the variant's own". A local mirror of
// `mergeReviewItems` in packages/ui/src/ratings.ts (and `merge_review_items` in the
// Rust core) — duplicated rather than imported so this build-time plugin need not
// pull the React UI package.
function mergeSnapshotReviewItems(
  common: readonly SnapshotReviewItem[],
  variant: readonly SnapshotReviewItem[],
): SnapshotReviewItem[] {
  const result: SnapshotReviewItem[] = common.map((item) => ({ ...item }));
  for (const item of variant) {
    const existing = result.find((candidate) => candidate.id === item.id);
    if (existing) {
      existing.weight += item.weight;
      existing.subItems = [
        ...(existing.subItems ?? []),
        ...(item.subItems ?? []),
      ];
    } else {
      result.push({ ...item });
    }
  }
  return result;
}

interface AssembledDomain {
  id: string;
  name: string;
  description: string;
}

// One changelog entry the app consumes (mirrors `ChangelogEntry` in the UI's
// testCases): the version it describes and that version's `changelog.md` body.
interface AssembledChangelogEntry {
  version: string;
  body: string;
}

// One errata entry the app consumes (mirrors `ErrataEntry` in the UI's testCases):
// the version and its known-issue errata. `collapseCases` concatenates these across
// a slug's versions (newest first) into the case's full errata list.
interface AssembledErrataEntry {
  version: string;
  errata: SnapshotErratum[];
}

// A seeded input the app consumes (mirrors `SeededInput` in the UI's testCases).
// The public snapshot only carries text specs, so `kind` is always "text" here.
interface AssembledSeededInput {
  path: string;
  kind: "text";
  // The seeded file's role, so the Inputs tab can tag a "Script" distinctly from a
  // "Spec". Defaults to "spec" for snapshots that predate the field.
  role: "spec" | "script";
  text: string;
}

// A runtime package the app consumes (mirrors `PackageInput` in the UI's
// testCases): the package name and its UI-only description.
interface AssembledPackage {
  name: string;
  description: string;
}

// One variant's prompt and seeded specs as rendered under one engine — the pair a
// run's Inputs tab shows, chosen by the engine that run recorded — plus the
// variant's effective starter-workspace file set for that engine (a starter
// project is written against a runtime, so the set genuinely differs per engine).
interface AssembledRendering {
  prompt: string;
  seededInputs: AssembledSeededInput[];
  workspace: AssembledWorkspaceFile[];
}

// One starter-workspace file the app consumes (mirrors `WorkspaceFileRef` in the
// UI's client types): the run-root-relative path it is seeded at and the
// absolute snapshot URL its bytes are fetched from lazily.
interface AssembledWorkspaceFile {
  path: string;
  url: string | null;
}

// A variant's authored showcase the app consumes (mirrors `CaseShowcase` in the
// UI's client types): the description plus the media carousel, each entry keyed
// by its authored file name. The bytes themselves resolve through
// `caseShowcaseMediaUrls`, which is where the published object keys go.
interface AssembledShowcase {
  description: string;
  media: AssembledShowcaseMedia[];
}

// One showcase carousel entry (mirrors `ShowcaseMediaRef` in the UI's client
// types) — the addressing only, never the object key.
interface AssembledShowcaseMedia {
  file: string;
  name: string;
  kind: MediaKind;
}

interface AssembledVariant {
  slug: string;
  name: string;
  description: string | null;
  prompt: string;
  seededInputs: AssembledSeededInput[];
  // The same pair re-rendered for each engine the version declares that vendors a
  // runtime, keyed by engine slug. The engineless rendering is `prompt` and
  // `seededInputs` above, so this holds every other engine.
  engineRenderings: Record<string, AssembledRendering>;
  // The runtime packages a run of this variant ships (case-level, so the same on
  // every variant), each with its UI-only description.
  packages: AssembledPackage[];
  referenceScreenshots: AssembledReference[];
  reviewItems: AssembledReviewItem[];
  // The variant's effective scoring domains (common + its own) — the set a run of
  // this variant is rated against.
  domains: AssembledDomain[];
  // Whether a run of this variant is validator-rated (the version is on the engine
  // manifest format and is not a game jam): the items above carry failure caps
  // and domains, the functional rating and score come from the run's validators,
  // and reviewers rate only the aesthetic channel.
  validatorRated: boolean;
  // The absolute URLs of this variant's reference-implementation builds, one per
  // engine, or empty when it declares none. Carried through verbatim from the
  // snapshot (each already a fully-qualified Cloudflare Pages URL), they are the
  // case-variant analogue of a run's playable build and drive whether the
  // case-detail Reference tab appears and what its engine switch offers.
  referenceBuilds: Record<string, string>;
  // An asset-generation variant's published reference frames (indices only). The
  // other shape a reference implementation takes, and the other signal that drives
  // the Reference tab; the frame images and action logs themselves are resolved
  // through `referenceMediaUrls` below. Null when the variant has none.
  referenceSheet: { frames: number[] } | null;
  // The variant's authored showcase (description + carousel), or null when it
  // declares none (and for snapshots written before the field existed). The
  // media bytes resolve through `caseShowcaseMediaUrls`.
  showcase: AssembledShowcase | null;
  // The variant's effective starter-workspace files for the ENGINELESS
  // rendering, each resolved to an absolute snapshot URL fetched lazily by the
  // Inputs tab. The per-engine sets ride on `engineRenderings`. Empty when the
  // case seeds none (and for snapshots written before the field existed).
  workspace: AssembledWorkspaceFile[];
}

interface AssembledTestCase {
  slug: string;
  name: string;
  testType: TestType;
  // The asset shape an asset-generation case produces, so the catalog can
  // partition its 2D / 3D / Particle / Audio tabs. Null for a non-asset case.
  assetKind: AssetKind | null;
  difficulty: string;
  tags: string[];
  summary: string | null;
  description: string | null;
  // This version's own changelog entry, if it declared one — 0 or 1 element per
  // mapped version. `collapseCases` concatenates these across a slug's versions
  // (newest first) into the case's full changelog.
  changelog: AssembledChangelogEntry[];
  // This version's errata entry, if it recorded any — 0 or 1 element per mapped
  // version. `collapseCases` concatenates these across a slug's versions (newest
  // first) into the case's full errata list.
  errata: AssembledErrataEntry[];
  versions: string[];
  latestVersion: string;
  variants: AssembledVariant[];
  // Every version OTHER than the latest, keyed by version, so a run's Inputs tab
  // resolves the inputs the run itself was given rather than the latest version's.
  // The latest version's variants are `variants` above; keeping them out of this
  // map is what stops the bundle carrying them twice.
  priorVariantsByVersion: Record<string, AssembledVariant[]>;
  // Every version's variant identities (slug + name), latest included — the
  // frame the detail header's variant selector is built from. Identities only,
  // so nothing heavy is carried twice. `collapseCases` merges one entry per
  // version into this map.
  variantsByVersion: Record<string, { slug: string; name: string }[]>;
  // The engines each published version's inputs can be read under, keyed by
  // version — the engineless rendering plus every engine the snapshot carries a
  // rendering for. `collapseCases` merges one entry per version into this map.
  enginesByVersion: Record<string, string[]>;
  domains: AssembledDomain[];
  // The case's sprite-sheet declaration (frame size + named sequences), carried
  // through when the snapshot publishes it. Null for a non-sheet case (and for a
  // snapshot that predates the field), in which case the asset Reference tab shows
  // the still reference frames without animating them.
  sheet: AssetSheet | null;
  // The case's catalog SHOWCASE PREVIEW (mirrors `CatalogShowcase` in the UI's
  // client types): the latest version's first variant (manifest order) that
  // declares a showcase, with the media list the catalog's preview stage loops.
  // Each mapped version derives its own; `collapseCases` keeps the newest
  // version's (its spread), which is exactly the latest-version rule. Null when
  // no variant declares one, and the catalog renders its placeholder stage.
  showcase: {
    version: string;
    variant: string;
    media: AssembledShowcaseMedia[];
  } | null;
}

const EMPTY: AssembledSnapshot = {
  runSummaries: [],
  writeups: {},
  reviews: {},
  testCases: [],
  models: [],
  comparisons: [],
  testCaseGroups: [],
  ggRuns: null,
  proofMediaUrls: {},
  assetMediaUrls: {},
  validationMediaUrls: {},
  showcaseMediaUrls: {},
  caseShowcaseMediaUrls: {},
  codeAnalysisUrls: {},
  validationBaselineUrls: {},
  referenceMediaUrls: {},
};

// Rating tiers, ordered best to worst — the worst across reviewers/domains is the
// run's aggregate. Mirrors the `Rating` enum in `packages/ui/src/ratings.ts`.
const RATING_ORDER = ["flawless", "great", "passable", "scuffed", "broken"];

// Aesthetic tiers, ordered best to worst — the second channel, rated per domain
// by reviewers of a validator-rated run. Mirrors `AESTHETIC_RATINGS` in
// `@test-cabinet/run-stats`.
const AESTHETIC_ORDER = ["legendary", "amazing", "good", "okay", "slop"];

// The worst (lowest) tier among `tiers` on the given scale, or null when empty.
function worstOn(order: readonly string[], tiers: string[]): string | null {
  let worst: string | null = null;
  let worstRank = -1;
  for (const tier of tiers) {
    const rank = order.indexOf(tier);
    if (rank > worstRank) {
      worstRank = rank;
      worst = tier;
    }
  }
  return worst;
}

// The worst (lowest) rating among `tiers`, or null when empty.
function worstRating(tiers: string[]): string | null {
  return worstOn(RATING_ORDER, tiers);
}

// The worst (lowest) aesthetic rating among `tiers`, or null when empty.
function worstAestheticRating(tiers: string[]): string | null {
  return worstOn(AESTHETIC_ORDER, tiers);
}

// Join a base URL with a snapshot-relative key, collapsing any double slash.
function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return (await response.json()) as T;
}

// Reconstruct a single *aggregate* writeup's `---\nrating.<domain>: …\n---\n\n
// <body>` framing from a run's reviews, so the existing `parseWriteup` path is
// unchanged on the site side and the cards/badges show the aggregate verdict. The
// aggregate rating for a domain is the worst any reviewer gave it — on both
// channels, the aesthetic one framed as `aesthetic.<domain>: …` lines; a checklist
// item reads `pass` only when every reviewer who judged it passed it; the body
// concatenates each reviewer's prose, attributed by display name. Mirrors
// `frameReviews` in `@test-cabinet/ui`. Returns null for no reviews.
function frameWriteup(reviews: SnapshotReview[]): string | null {
  if (reviews.length === 0) return null;

  const ratingsByDomain = new Map<string, string[]>();
  for (const review of reviews) {
    for (const r of review.ratings ?? []) {
      const list = ratingsByDomain.get(r.domain) ?? [];
      list.push(r.rating);
      ratingsByDomain.set(r.domain, list);
    }
  }
  const ratingLines: string[] = [];
  for (const [domain, tiers] of ratingsByDomain) {
    const worst = worstRating(tiers);
    if (worst) ratingLines.push(`rating.${domain}: ${worst}`);
  }
  const aestheticsByDomain = new Map<string, string[]>();
  for (const review of reviews) {
    for (const r of review.aesthetics ?? []) {
      const list = aestheticsByDomain.get(r.domain) ?? [];
      list.push(r.rating);
      aestheticsByDomain.set(r.domain, list);
    }
  }
  for (const [domain, tiers] of aestheticsByDomain) {
    const worst = worstAestheticRating(tiers);
    if (worst) ratingLines.push(`aesthetic.${domain}: ${worst}`);
  }

  const statusesByItem = new Map<string, string[]>();
  for (const review of reviews) {
    for (const v of review.checklist ?? []) {
      const list = statusesByItem.get(v.id) ?? [];
      list.push(v.status);
      statusesByItem.set(v.id, list);
    }
  }
  const verdictLines: string[] = [];
  for (const [id, statuses] of statusesByItem) {
    const status = statuses.every((s) => s === "pass") ? "pass" : "fail";
    verdictLines.push(`review.${id}: ${status}`);
  }

  const body = reviews
    .map((review) => {
      const text = (review.writeup ?? "").trim();
      const who = review.reviewer ?? "Reviewer";
      return text ? `**${who}**\n\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  const frontmatter = [...ratingLines, ...verdictLines].join("\n");
  return `---\n${frontmatter}\n---\n\n${body}`;
}

// Map a snapshot review to the app's StoredReview shape, filling sensible
// defaults for fields an older snapshot may omit. The reviewer's `pictureKey` is
// resolved to an absolute avatar URL against the snapshot `base`.
function toAssembledReview(
  base: string,
  review: SnapshotReview,
): AssembledReview {
  return {
    reviewerId: review.reviewerId ?? "",
    reviewer: review.reviewer ?? "Reviewer",
    ratings: review.ratings ?? [],
    aesthetics: review.aesthetics ?? [],
    writeup: review.writeup ?? "",
    checklist: review.checklist ?? [],
    reviewedAt: review.reviewedAt ?? null,
    reviewerPictureUrl: review.pictureKey
      ? joinUrl(base, review.pictureKey)
      : null,
  };
}

// Inline one rendering's seeded spec bodies. Only text specs are published, so the
// kind is fixed; the role tags a starter script apart from a prose spec.
function mapSeededInputs(
  specs: SnapshotSeededInput[] | undefined,
): AssembledSeededInput[] {
  return (specs ?? []).map((s) => ({
    path: s.path,
    kind: "text",
    role: s.kind ?? "spec",
    text: s.text,
  }));
}

// Resolve one starter-workspace file set to the shape the app consumes: the
// seeded path plus the absolute URL of its published object, fetched lazily by
// the Inputs tab (the bodies are deliberately not inlined — a starter project
// can be large and most readers never open it).
function mapWorkspaceFiles(
  base: string,
  files: SnapshotWorkspaceFile[] | undefined,
): AssembledWorkspaceFile[] {
  return (files ?? []).map((file) => ({
    path: file.dest,
    url: joinUrl(base, file.key),
  }));
}

// The engines one version's inputs can be read under here. A case's prompt and
// `.hbs` specs branch on the selected engine, so a version that supports more than
// one has more than one set of inputs — and the snapshot publishes the engineless
// rendering as the variant's own `prompt`/`seededInputs` plus one entry per other
// engine under `engineRenderings`. The engineless slug is therefore always
// readable, and the rest are exactly the keys the snapshot carries; a declared
// engine the snapshot skipped is not offered, because there would be nothing to
// show for it.
//
// The union runs across the version's variants rather than assuming they agree:
// they are rendered from the same manifest, so in practice they do, but a union
// cannot offer an engine some variant has no rendering for.
function renderableEngines(variants: AssembledVariant[]): string[] {
  const engines = new Set<string>([NONE_ENGINE_SLUG]);
  for (const variant of variants) {
    for (const engine of Object.keys(variant.engineRenderings)) {
      engines.add(engine);
    }
  }
  return [...engines];
}

function mapCase(base: string, file: SnapshotCaseFile): AssembledTestCase {
  // Reference screenshots are optional in the snapshot. Common references
  // (variant null / `_common`) apply to every variant; variant-scoped ones only
  // to their variant. The variant prompt is carried (rendered at ingest), and the
  // seeded spec files are inlined (common ones plus the variant's own), so the
  // static site's Inputs tab shows the prompt, the specs, and the references — the
  // same inputs the backend-connected consoles resolve live.
  const refs = file.references ?? [];
  const commonRefs = refs.filter(
    (r) => r.variant == null || r.variant === "_common",
  );
  const commonItems = file.commonReviewItems ?? [];
  const commonDomains = file.domains ?? [];
  // Case-level packages apply to every variant; carry them onto each so the
  // per-variant Inputs tab can show them alongside the seeded files.
  const packages: AssembledPackage[] = (file.packages ?? []).map((p) => ({
    name: p.name,
    description: p.description,
  }));
  const variants: AssembledVariant[] = file.variants.map((variant) => {
    const own = refs.filter((r) => r.variant === variant.slug);
    const referenceScreenshots = [...commonRefs, ...own].map((r) => ({
      view: r.view,
      kind: (r.kind === "video" ? "video" : "image") as "image" | "video",
      url: joinUrl(base, r.key),
    }));
    // Each variant carries its complete, seed-ordered seeded spec set (the common
    // specs first, then its own), every body already rendered for the variant (a
    // template spec's conditionals resolved) — the same order a run is seeded and
    // the consoles present. Only text specs are inlined.
    const seededInputs: AssembledSeededInput[] = mapSeededInputs(
      variant.seededInputs,
    );
    // The same pair re-rendered under each engine the version declares that vendors
    // a runtime. A case's prompt and `.hbs` specs branch on the selected engine, so
    // this is what lets a run's Inputs tab show the text that run was handed rather
    // than the engineless one.
    const engineRenderings: Record<string, AssembledRendering> = {};
    for (const [engine, rendering] of Object.entries(
      variant.engineRenderings ?? {},
    )) {
      engineRenderings[engine] = {
        prompt: rendering.prompt,
        seededInputs: mapSeededInputs(rendering.seededInputs),
        // The effective starter-workspace set for this engine — a starter
        // project is written against a runtime, so each rendering carries its
        // own.
        workspace: mapWorkspaceFiles(base, rendering.workspaceFiles),
      };
    }
    // The verdict ids this version's errata exclude from scoring for this variant
    // (an erratum with `excludeFromScore` scoped case-wide or to this variant). These
    // points stay on the checklist but are marked non-scoring below, mirroring the
    // Rust `review_items_for` / `apply_score_exclusions`.
    const excludedVerdictIds = new Set<string>();
    for (const erratum of file.errata ?? []) {
      if (!erratum.excludeFromScore) continue;
      if (erratum.variant != null && erratum.variant !== variant.slug) continue;
      if (erratum.review) excludedVerdictIds.add(erratum.review);
    }
    // The common checklist items apply to every variant; the variant's own
    // follow, merged by id so a variant that reuses a common category's id extends
    // that category rather than forming a duplicate group. Each carries the point
    // weight used to score runs.
    const reviewItems: AssembledReviewItem[] = mergeSnapshotReviewItems(
      commonItems,
      variant.reviewItems ?? [],
    ).map((item) => {
      const itemExcluded = excludedVerdictIds.has(item.id);
      return {
        id: item.id,
        title: item.title,
        text: item.text,
        reference: item.reference ?? null,
        proof: item.proof ?? null,
        sequences: item.sequences ?? [],
        frames: item.frames ?? [],
        weight: item.weight,
        graded: item.graded,
        domain: item.domain ?? null,
        failureCap: item.failureCap ?? null,
        domains: item.domains ?? [],
        scored: itemExcluded ? false : undefined,
        subItems: (item.subItems ?? []).map((sub) => ({
          id: sub.id,
          title: sub.title,
          description: sub.description ?? null,
          weight: sub.weight,
          reference: sub.reference ?? null,
          proof: sub.proof ?? null,
          failureCap: sub.failureCap ?? null,
          domains: sub.domains ?? [],
          scored:
            itemExcluded || excludedVerdictIds.has(`${item.id}.${sub.id}`)
              ? false
              : undefined,
        })),
      };
    });
    // The common domains apply to every variant; the variant's own additive
    // domains follow. This effective set is what a run of this variant is rated
    // against.
    const domains: AssembledDomain[] = [
      ...commonDomains,
      ...(variant.domains ?? []),
    ].map((d) => ({ id: d.id, name: d.name, description: d.description }));
    return {
      slug: variant.slug,
      name: variant.name,
      description: variant.description,
      prompt: variant.prompt,
      seededInputs,
      engineRenderings,
      packages,
      referenceScreenshots,
      reviewItems,
      domains,
      // Validator-rated iff the version is on the engine manifest format and is
      // not a game jam — the same rule as the Rust `TestCaseVersion::validator_rated`.
      validatorRated:
        (file.engineFormat ?? false) &&
        (file.testType ?? "end-to-end") !== "game-jam",
      // The reference-implementation build URLs, one per engine, carried through
      // verbatim (empty when the variant declares none).
      referenceBuilds: variant.referenceBuilds ?? {},
      // The published asset-reference frame indices, carried through verbatim. The
      // objects they address are resolved into absolute URLs in `loadSnapshot`,
      // where the snapshot base is in hand.
      referenceSheet: variant.referenceSheet ?? null,
      // The variant's authored showcase — the addressing only (file/name/kind);
      // the published object keys go into `caseShowcaseMediaUrls`, built in
      // `loadSnapshot` from the same per-version case files.
      showcase: variant.showcase
        ? {
            description: variant.showcase.description,
            media: variant.showcase.media.map((media) => ({
              file: media.file,
              name: media.name,
              kind: media.kind,
            })),
          }
        : null,
      // The engineless starter-workspace set (what a run on the `none` engine is
      // seeded with), matching the engineless prompt/specs above; the per-engine
      // sets ride on `engineRenderings`.
      workspace: mapWorkspaceFiles(base, variant.workspaceFiles),
    };
  });
  // The catalog showcase preview: this version's first variant (manifest order)
  // that declares a showcase with media to show. `collapseCases` spreads the
  // newest mapped version into the collapsed case, so the preview the catalog
  // renders is the LATEST version's — the same first-variant-with-a-showcase
  // rule the backend's catalog applies.
  const showcaseVariant = variants.find(
    (variant) => (variant.showcase?.media.length ?? 0) > 0,
  );
  const showcase = showcaseVariant?.showcase
    ? {
        version: file.version,
        variant: showcaseVariant.slug,
        media: showcaseVariant.showcase.media,
      }
    : null;
  return {
    slug: file.slug,
    name: file.name,
    testType: file.testType ?? "end-to-end",
    // Absent on snapshots written before it was published; the catalog treats a
    // missing kind as a 2D sprite (the Rust default), so keep null here and let
    // the classifier fall back.
    assetKind: file.assetKind ?? null,
    difficulty: file.difficulty,
    tags: file.tags,
    summary: file.summary,
    description: file.description,
    // This version's changelog entry, if any — collapseCases merges these across
    // the slug's versions into one newest-first changelog.
    changelog: file.changelog
      ? [{ version: file.version, body: file.changelog }]
      : [],
    // This version's errata, if any — collapseCases merges these across the slug's
    // versions into one newest-first errata list.
    errata:
      file.errata && file.errata.length > 0
        ? [{ version: file.version, errata: file.errata }]
        : [],
    versions: [file.version],
    latestVersion: file.version,
    variants,
    // Filled by `collapseCases`, which is where a slug's other versions are in
    // hand; one mapped file knows only its own.
    priorVariantsByVersion: {},
    // This version's own entry; `collapseCases` merges the slug's versions into
    // one map.
    variantsByVersion: {
      [file.version]: variants.map((v) => ({ slug: v.slug, name: v.name })),
    },
    // This version's own entry; `collapseCases` merges the slug's versions into
    // one map. Derived from the renderings this snapshot actually carries rather
    // than from the case's declared `engines` (which it does not publish), so the
    // Inputs tab offers exactly the renderings the site can show.
    enginesByVersion: { [file.version]: renderableEngines(variants) },
    // The sprite-sheet declaration, so the asset Reference tab can play each named
    // sequence from the published reference frames. Null when the snapshot carries
    // none.
    sheet: file.sheet ?? null,
    domains: (file.domains ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
    })),
    showcase,
  };
}

// Collapse per-(slug, version) case files into one TestCaseSummary per slug,
// newest version first, mirroring the catalog the site renders. Versions seen
// across a slug's published runs are merged; the newest is surfaced.
function collapseCases(
  base: string,
  files: SnapshotCaseFile[],
): AssembledTestCase[] {
  const bySlug = new Map<string, AssembledTestCase[]>();
  for (const file of files) {
    const mapped = mapCase(base, file);
    const list = bySlug.get(file.slug) ?? [];
    list.push(mapped);
    bySlug.set(file.slug, list);
  }
  const result: AssembledTestCase[] = [];
  for (const versions of bySlug.values()) {
    // Newest version first by descending version string (semver-ish vX.Y.Z).
    versions.sort((a, b) =>
      b.latestVersion.localeCompare(a.latestVersion, undefined, {
        numeric: true,
      }),
    );
    const newest = versions[0]!;
    // Every version but the newest, keyed by version, so a run of an older version
    // resolves the inputs it was itself given. The newest version's variants stay on
    // `variants`, so nothing is carried twice.
    const priorVariantsByVersion: Record<string, AssembledVariant[]> = {};
    for (const version of versions.slice(1)) {
      priorVariantsByVersion[version.latestVersion] = version.variants;
    }
    // Unlike the full variants, every version's engines and variant identities
    // are kept — including the newest's — because the detail header looks the
    // selected version up here whichever one it is, and a list of slugs costs
    // nothing to carry twice.
    const enginesByVersion: Record<string, string[]> = {};
    const variantsByVersion: Record<string, { slug: string; name: string }[]> =
      {};
    for (const version of versions) {
      Object.assign(enginesByVersion, version.enginesByVersion);
      Object.assign(variantsByVersion, version.variantsByVersion);
    }
    result.push({
      ...newest,
      priorVariantsByVersion,
      variantsByVersion,
      enginesByVersion,
      versions: versions.map((v) => v.latestVersion),
      // Each version contributes 0 or 1 entry; `versions` is newest-first, so the
      // concatenation is already ordered newest changelog entry first.
      changelog: versions.flatMap((v) => v.changelog),
      // Same aggregation for errata: newest-version-first, versions with none
      // already contribute no entry.
      errata: versions.flatMap((v) => v.errata),
    });
  }
  return result;
}

// Fetch and assemble the published snapshot. Follows the atomic pointer
// `index.json` -> versioned prefix -> `runs.json` -> per-run + per-case files.
// `emitEvents` is called for each run that carries an event stream, so the build
// can write it out as a per-run static asset the Events tab fetches at runtime.
// `emitRecord` is called for every run with its full record JSON, so the build
// can write it out as a runtime-fetchable `runs/<id>.json` asset (the lazy
// per-run detail fetch), mirroring the events emission.
async function loadSnapshot(
  base: string,
  emitEvents: (runId: string, json: string) => void,
  emitRecord: (runId: string, json: string) => void,
): Promise<AssembledSnapshot | null> {
  // `index.json` is the atomic pointer the backend writes last, only after a
  // publish. A 404 here means nothing has been published yet (a fresh
  // deployment), which is the empty-dataset bootstrap case — signal it with
  // `null` so the build succeeds empty. Any other non-OK status is a genuinely
  // broken snapshot and must fail the build.
  const indexUrl = joinUrl(base, "index.json");
  const indexResponse = await fetch(indexUrl);
  if (indexResponse.status === 404) {
    return null;
  }
  if (!indexResponse.ok) {
    throw new Error(
      `${indexResponse.status} ${indexResponse.statusText} for ${indexUrl}`,
    );
  }
  const index = (await indexResponse.json()) as SnapshotIndex;
  const runsFile = await fetchJson<SnapshotRunsFile>(
    joinUrl(base, index.runsKey),
  );

  const writeups: Record<string, string> = {};
  const reviews: Record<string, AssembledReview[]> = {};
  const proofMediaUrls: Record<string, Record<string, string>> = {};
  const assetMediaUrls: Record<string, Record<string, string>> = {};
  const validationMediaUrls: Record<string, Record<string, string>> = {};
  const showcaseMediaUrls: Record<string, Record<string, string>> = {};
  const caseShowcaseMediaUrls: Record<string, Record<string, string>> = {};
  const codeAnalysisUrls: Record<string, string> = {};
  const validationBaselineUrls: Record<string, Record<string, string>> = {};
  const referenceMediaUrls: Record<string, Record<string, string>> = {};
  // The case-version keys referenced by published runs; deduplicated.
  const caseKeys = new Set<string>();

  // Per-run records + reviews, in the snapshot's newest-first order.
  for (const summary of runsFile.runs) {
    // The run's document is content-addressed under a snapshot-independent prefix, so
    // the summary is what names it — the key carries a digest of the document's own
    // bytes and cannot be composed from the run id. A summary in `runs.json` always
    // carries one; a missing key is a malformed snapshot, not a fallback path.
    if (!summary.documentKey) {
      throw new Error(
        `snapshot run summary ${summary.id} carries no documentKey; the snapshot is malformed`,
      );
    }
    const runFile = await fetchJson<SnapshotRunFile>(
      joinUrl(base, summary.documentKey),
    );
    // Emit the full run record as a runtime-fetchable static asset
    // (`runs/<id>.json`), so a summary-first page lazily fetches one run's whole
    // record on demand — the bundle ships the summary index but NOT the array of
    // full records.
    emitRecord(summary.id, JSON.stringify(runFile.record));
    const runReviews = runFile.reviews ?? [];
    if (runReviews.length > 0) {
      reviews[summary.id] = runReviews.map((review) =>
        toAssembledReview(base, review),
      );
      const framed = frameWriteup(runReviews);
      if (framed !== null) writeups[summary.id] = framed;
    }
    // The run's proof media, keyed by served file name (the key's last segment),
    // resolved to absolute URLs the proof/review UI loads.
    if (runFile.proofMedia?.length) {
      const byFile: Record<string, string> = {};
      for (const proof of runFile.proofMedia) {
        const file = proof.key.split("/").pop() ?? proof.key;
        byFile[file] = joinUrl(base, proof.key);
      }
      proofMediaUrls[summary.id] = byFile;
    }
    // The run's asset-generation media, keyed by its served file name, resolved to
    // absolute URLs the asset result view loads.
    if (runFile.assetMedia?.length) {
      const byFile: Record<string, string> = {};
      for (const asset of runFile.assetMedia) {
        byFile[asset.file] = joinUrl(base, asset.key);
      }
      assetMediaUrls[summary.id] = byFile;
    }
    // The run's synthesized *actual* validation media, keyed by the flat
    // `<item>__<output>.<ext>` name the reviewer UI requests (a video's `.webm`
    // request resolving to its published `.mp4` key), resolved to absolute URLs.
    if (runFile.validationMedia?.length) {
      const byFile: Record<string, string> = {};
      for (const media of runFile.validationMedia) {
        byFile[media.file] = joinUrl(base, media.key);
      }
      validationMediaUrls[summary.id] = byFile;
    }
    // The run's showcase media, keyed by the recorded file name the UI requests (a
    // video's `.webm` request resolving to its published `.mp4` key), resolved to
    // absolute URLs the Play tab's showcase view loads.
    if (runFile.showcaseMedia?.length) {
      const byFile: Record<string, string> = {};
      for (const media of runFile.showcaseMedia) {
        byFile[media.file] = joinUrl(base, media.key);
      }
      showcaseMediaUrls[summary.id] = byFile;
    }
    // The run's unbounded code-analysis document, resolved to the absolute URL of its
    // own generation-keyed object. Absent for a run that was never analysed, which is
    // the honest default rather than an empty document.
    if (runFile.codeAnalysisKey) {
      codeAnalysisUrls[summary.id] = joinUrl(base, runFile.codeAnalysisKey);
    }
    // Emit the run's recorded events as a standalone asset (only when present),
    // so the Events tab can fetch `run-events/<id>.json` without the bundle
    // carrying every run's log.
    if (runFile.events != null) {
      emitEvents(summary.id, JSON.stringify(runFile.events));
    }
    const { testCaseSlug, testCaseVersion } = summary.subject;
    caseKeys.add(`${index.casesPrefix}${testCaseSlug}/${testCaseVersion}.json`);
  }

  // Per-case-version metadata for every case a published run references.
  const caseFiles: SnapshotCaseFile[] = [];
  for (const key of caseKeys) {
    try {
      caseFiles.push(await fetchJson<SnapshotCaseFile>(joinUrl(base, key)));
    } catch {
      // A run can reference a historical case-version the snapshot did not
      // emit; skip it rather than failing the whole build (the run still shows,
      // it just lacks framing metadata).
    }
  }

  // The case-scoped *baseline* validation media, keyed by a
  // `<slug>/<version>/<engine>/<variant>` subject key then the flat
  // `<item>__<output>.<ext>` name the reviewer UI requests. Built from the per-version
  // case files (not the collapsed catalog), so a run against any published version
  // resolves the baseline of the reference build it was compared against (a video's
  // `.webm` request resolving to its published `.mp4` key).
  for (const file of caseFiles) {
    for (const baseline of file.validationBaselines ?? []) {
      const subjectKey = `${file.slug}/${file.version}/${baseline.engine}/${baseline.variant}`;
      const byFile = validationBaselineUrls[subjectKey] ?? {};
      byFile[baseline.file] = joinUrl(base, baseline.key);
      validationBaselineUrls[subjectKey] = byFile;
    }
  }

  // The case-scoped SHOWCASE media (a variant's authored carousel), keyed by a
  // `<slug>/<version>/<variant>` subject key then the authored file name the UI
  // requests (a video's `.webm` request resolving to its published `.mp4` key).
  // Built from the per-version case files like the baselines above, so the
  // catalog preview (latest version) and an older version's Play tab both
  // resolve their own media.
  for (const file of caseFiles) {
    for (const variant of file.variants) {
      const media = variant.showcase?.media;
      if (!media?.length) continue;
      const subjectKey = `${file.slug}/${file.version}/${variant.slug}`;
      const byFile = caseShowcaseMediaUrls[subjectKey] ?? {};
      for (const entry of media) {
        byFile[entry.file] = joinUrl(base, entry.key);
      }
      caseShowcaseMediaUrls[subjectKey] = byFile;
    }
  }

  // The case-scoped **asset-reference** media, keyed the same way: subject key then
  // the file below the variant's prefix. Unlike every map above, these keys are not
  // listed in the snapshot — only the published frame INDICES are — so they are
  // reconstructed from the deterministic layout the publisher writes:
  //
  //   media/references/<slug>/<version>/<variant>/frames/<index>.png
  //   media/references/<slug>/<version>/<variant>/frames/<index>.actions.json
  //
  // This MIRRORS the Rust helpers that write them (`reference_prefix` /
  // `reference_image_key` / `reference_actions_key` in
  // `crates/core/src/asset_reference.rs`) and the console's `referenceMediaKey` in
  // `packages/ui/src/transport/httpBackend.ts`; all three must change together. The
  // console's helper is not imported here because this build-time plugin must not
  // pull in the React UI package.
  for (const file of caseFiles) {
    for (const variant of file.variants) {
      const frames = variant.referenceSheet?.frames;
      if (!frames?.length) continue;
      const subjectKey = `${file.slug}/${file.version}/${variant.slug}`;
      const byFile = referenceMediaUrls[subjectKey] ?? {};
      const prefix = `media/references/${file.slug}/${file.version}/${variant.slug}`;
      for (const index of frames) {
        for (const name of [`${index}.png`, `${index}.actions.json`]) {
          byFile[`frames/${name}`] = joinUrl(base, `${prefix}/frames/${name}`);
        }
      }
      referenceMediaUrls[subjectKey] = byFile;
    }
  }

  // The model catalog. Absent from a snapshot published before it existed, in
  // which case the Models section renders empty.
  let models: unknown[] = [];
  if (index.modelsKey) {
    try {
      const modelsFile = await fetchJson<SnapshotModelsFile>(
        joinUrl(base, index.modelsKey),
      );
      models = modelsFile.models;
    } catch {
      // Missing/unreadable catalog file: render an empty Models section rather
      // than failing the whole build.
    }
  }

  // The published harness comparisons. Absent from a snapshot published before
  // they existed, in which case the site simply has none.
  let comparisons: unknown[] = [];
  if (index.comparisonsKey) {
    try {
      const comparisonsFile = await fetchJson<SnapshotComparisonsFile>(
        joinUrl(base, index.comparisonsKey),
      );
      comparisons = comparisonsFile.comparisons;
    } catch {
      // Missing/unreadable comparisons file: render none rather than failing the
      // whole build.
    }
  }

  // The test-case groups. Absent from a snapshot published before they existed,
  // in which case the home page simply renders no group leaderboards.
  let testCaseGroups: unknown[] = [];
  if (index.testCaseGroupsKey) {
    try {
      const groupsFile = await fetchJson<SnapshotTestCaseGroupsFile>(
        joinUrl(base, index.testCaseGroupsKey),
      );
      testCaseGroups = groupsFile.groups;
    } catch {
      // Missing/unreadable groups file: render none rather than failing the
      // whole build.
    }
  }

  // The gg document corpus. Absent from a snapshot published before the gg export
  // existed, in which case the site mounts no analysis surface rather than an empty one.
  let ggRuns: AssembledSnapshot["ggRuns"] = null;
  if (index.ggRunsKey) {
    try {
      const ggRunsFile = await fetchJson<SnapshotGgRunsFile>(
        joinUrl(base, index.ggRunsKey),
      );
      ggRuns = {
        generatedAt: ggRunsFile.generatedAt,
        documents: ggRunsFile.documents,
      };
    } catch {
      // Missing/unreadable corpus: no analysis surface rather than a failed build,
      // matching how every other optional snapshot payload degrades.
    }
  }

  return {
    // The already-fetched summary index — the bounded cards, verbatim. No extra
    // network calls.
    runSummaries: runsFile.runs,
    writeups,
    reviews,
    testCases: collapseCases(base, caseFiles),
    models,
    comparisons,
    testCaseGroups,
    ggRuns,
    proofMediaUrls,
    assetMediaUrls,
    codeAnalysisUrls,
    validationMediaUrls,
    showcaseMediaUrls,
    caseShowcaseMediaUrls,
    validationBaselineUrls,
    referenceMediaUrls,
  };
}

function serialize(data: AssembledSnapshot): string {
  return [
    "// Generated at build time by vite-plugin-snapshot. Do not edit.",
    `export const runSummaries = ${JSON.stringify(data.runSummaries)};`,
    `export const writeups = ${JSON.stringify(data.writeups)};`,
    `export const reviews = ${JSON.stringify(data.reviews)};`,
    `export const testCases = ${JSON.stringify(data.testCases)};`,
    `export const models = ${JSON.stringify(data.models)};`,
    `export const comparisons = ${JSON.stringify(data.comparisons)};`,
    `export const testCaseGroups = ${JSON.stringify(data.testCaseGroups)};`,
    `export const ggRuns = ${JSON.stringify(data.ggRuns)};`,
    `export const proofMediaUrls = ${JSON.stringify(data.proofMediaUrls)};`,
    `export const assetMediaUrls = ${JSON.stringify(data.assetMediaUrls)};`,
    `export const codeAnalysisUrls = ${JSON.stringify(data.codeAnalysisUrls)};`,
    `export const validationMediaUrls = ${JSON.stringify(data.validationMediaUrls)};`,
    `export const showcaseMediaUrls = ${JSON.stringify(data.showcaseMediaUrls)};`,
    `export const caseShowcaseMediaUrls = ${JSON.stringify(data.caseShowcaseMediaUrls)};`,
    `export const validationBaselineUrls = ${JSON.stringify(data.validationBaselineUrls)};`,
    `export const referenceMediaUrls = ${JSON.stringify(data.referenceMediaUrls)};`,
  ].join("\n");
}

export function snapshot(): Plugin {
  // Read once per build. The dev server does not fetch the published snapshot
  // (the localRuns plugin supplies dev data); it resolves to the empty dataset.
  let module: string | null = null;
  let isBuild = false;

  return {
    name: "ttc-snapshot",
    config(_config, env) {
      isBuild = env.command === "build";
    },
    async buildStart() {
      if (!isBuild) {
        module = serialize(EMPTY);
        return;
      }
      const base = process.env.TCAB_SNAPSHOT_URL?.trim();
      if (!base) {
        this.warn(
          "TCAB_SNAPSHOT_URL is not set; building with an empty published dataset.",
        );
        module = serialize(EMPTY);
        return;
      }
      try {
        let eventAssets = 0;
        let recordAssets = 0;
        const data = await loadSnapshot(
          base,
          (runId, json) => {
            // Write each run's events as a stable, predictable asset path the
            // static site fetches at runtime (`run-events/<id>.json`).
            this.emitFile({
              type: "asset",
              fileName: `run-events/${runId}.json`,
              source: json,
            });
            eventAssets += 1;
          },
          (runId, json) => {
            // Write each run's full record as a runtime-fetchable asset
            // (`runs/<id>.json`) for the lazy per-run detail fetch.
            this.emitFile({
              type: "asset",
              fileName: `runs/${runId}.json`,
              source: json,
            });
            recordAssets += 1;
          },
        );
        if (data === null) {
          this.warn(
            `no published snapshot at ${base} yet (index.json 404); building with an empty dataset. The backend's deploy hook will rebuild the gallery once a run is published.`,
          );
          module = serialize(EMPTY);
          return;
        }
        this.info(
          `fetched snapshot from ${base}: ${data.runSummaries.length} run(s), ${data.testCases.length} case(s), ${eventAssets} event log(s), ${recordAssets} run record(s).`,
        );
        module = serialize(data);
      } catch (error) {
        // A reachable-but-broken snapshot must fail the build loudly rather
        // than silently shipping an empty gallery over real data.
        this.error(
          `failed to fetch public snapshot from ${base}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return module ?? serialize(EMPTY);
      }
      return null;
    },
  };
}
