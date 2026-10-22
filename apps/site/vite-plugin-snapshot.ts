import type { RunSummary } from "@clockwyrks/backend-api/snapshot";
import type { Plugin } from "vite";
import type {
  AssetKind,
  AssetSheet,
  MediaKind,
  TestType,
} from "@clockwyrks/run-record";
import {
  CONCURRENCY_ENV,
  createSnapshotFetcher,
  forEachOrdered,
  resolveConcurrency,
  SnapshotFetchError,
  type SnapshotFetcher,
} from "./snapshot-fetch";

// Build-time data source: the public R2 snapshot.
//
// The site is fully static and has no live dependency on the backend. The
// backend exports a read-only public snapshot to a Cloudflare R2 bucket
// (see design/v0.2.0-contracts.md §3); this plugin fetches that snapshot once,
// at build time, and writes it into the build in two forms:
//
//   - the INDEX — what a listing shows for every run and every case — as the
//     virtual module `virtual:tcab-snapshot`, inlined into the bundle;
//   - one static file per run (`runs/<id>.json`, `run-events/<id>.json`), per
//     case (`cases/<slug>.json`) and per case version
//     (`cases/<slug>/<version>.json`), which the app fetches from the site's own
//     origin when a page of that run or case opens.
//
// Which form a piece of data takes follows from the kind of data it is, the same
// way for every run and every case. That is what keeps the bundle's size a
// function of how MANY runs and cases there are and independent of how much any
// one of them carries: Cloudflare Pages refuses a deployment holding a file over
// 25 MiB, and a bundle that inlined every run's media listing crossed it.
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
//
// "A network error" and "a 5xx" mean ones that outlast their retries: every
// request goes through `./snapshot-fetch`, which gives each attempt a timeout and
// retries the transient failures, and the per-run documents are fetched several
// at a time. Neither changes what is assembled or which failures are fatal.

const VIRTUAL_ID = "virtual:tcab-snapshot";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

// The engineless run's slug. It mirrors `DEFAULT_ENGINE_SLUG` in
// `ui-common/packages/ui/src/app/data/engines.ts`, restated rather than imported because this
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
  // Where the case showcases live (`<prefix>/case-showcases.json`): the showcases
  // of every non-experimental version of each case with a published run, whichever
  // version that run built. Optional so a snapshot published before the file
  // existed still loads; the catalog then previews each case from its case files.
  caseShowcasesKey?: string;
}

// `case-showcases.json` (`CaseShowcasesFile`): one entry per case version that
// declares a showcase, each with its showcased variants in manifest order.
interface SnapshotCaseShowcasesFile {
  schemaVersion: number;
  showcases: Array<{
    slug: string;
    version: string;
    variants: Array<{
      variant: string;
      showcase: NonNullable<SnapshotCaseFile["variants"][number]["showcase"]>;
    }>;
  }>;
}

interface SnapshotModelsFile {
  schemaVersion: number;
  // Wire `ModelOut` shape; the app maps it via `toModelSummary`.
  models: unknown[];
}

interface SnapshotComparisonsFile {
  schemaVersion: number;
  // Wire `Comparison` shape (`@clockwyrks/backend-api/comparison`); consumed as-is.
  comparisons: unknown[];
}

interface SnapshotTestCaseGroupsFile {
  schemaVersion: number;
  // Wire `TestCaseGroupOut` shape (`TestCaseGroupsFile` in
  // `@clockwyrks/backend-api/snapshot`), already in display order; the app
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

// LEGACY: one per-domain AESTHETIC rating of a review, from when the second
// channel was rated per scoring domain. Carried only by a snapshot written
// before the channel became run-wide; a review's tier resolves as
// `aesthetic ?? worst(aesthetics)`.
interface SnapshotDomainAesthetic {
  domain: string;
  rating: string;
}

// One review entry in a run's `reviews[]` array: the reviewer's verdict plus the
// name recorded with it. A run can carry more than one.
interface SnapshotReview {
  reviewer?: string;
  ratings: SnapshotDomainRating[];
  // The reviewer's RUN-WIDE aesthetic tier (a stored legacy row's per-domain
  // entries arrive already collapsed); absent on a legacy run's review — which
  // has no aesthetic channel — and on a snapshot written before the field.
  aesthetic?: string | null;
  // LEGACY: per-domain aesthetic ratings, present only on a not-yet-regenerated
  // snapshot; collapse to the worst tier where `aesthetic` is absent.
  aesthetics?: SnapshotDomainAesthetic[];
  writeup: string;
  checklist?: SnapshotReviewVerdict[];
  reviewedAt?: string | null;
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
  // `failureCap` and `domains`), and reviewers rate the run-wide aesthetic
  // channel (and may override individual verdicts).
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
  // The point's automated-validation driver, carried for its ENGINE SCOPING: the
  // engines the validator decides the point on. A run built on any other engine
  // does not carry the point, so a run-scoped surface filters it out. Absent for a
  // human-judged point and on snapshots written before the field existed.
  validation?: SnapshotReviewValidation | null;
  // The sub-items this item is graded by, each an independently scored pass/fail
  // point. Absent on snapshots written before sub-items existed.
  subItems?: SnapshotSubReviewItem[];
}

// The engine scoping of a point's validator as the snapshot carries it (the
// snapshot publishes no script or media outputs — see `CaseReviewValidationOut`).
interface SnapshotReviewValidation {
  engines?: string[];
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
  // The point's validator and its engine scoping (see `SnapshotReviewItem`).
  validation?: SnapshotReviewValidation | null;
}

interface SnapshotDomain {
  id: string;
  name: string;
  description: string;
}

// ---- The shape the app consumes (mirrors src/data/testCases.ts) -------------

// One assembled review the app consumes (the gallery's `StoredReview`).
interface AssembledReview {
  reviewer: string;
  ratings: SnapshotDomainRating[];
  // The run-wide aesthetic tier; null on a legacy run's review. A stale
  // snapshot's per-domain `aesthetics` are collapsed into this at assembly.
  aesthetic: string | null;
  // LEGACY per-domain tiers, carried through for the app's `reviewAesthetic`
  // fallback; empty on a regenerated snapshot.
  aesthetics: SnapshotDomainAesthetic[];
  writeup: string;
  checklist: SnapshotReviewVerdict[];
  reviewedAt: string | null;
}

// The INDEX: what a listing shows for every run and every case. It is the whole
// of what `virtual:tcab-snapshot` inlines into the bundle, so it is what every
// visitor downloads before the home page renders. Everything that describes one
// run or one case in detail is written to that run's or that case's own file
// instead (`AssembledRunFile`, `AssembledCaseDetail`, `AssembledCaseVersion`),
// and the placement follows the kind of data, never the size of one entry.
interface AssembledSnapshot {
  // The flat summary index (`runs.json`), newest first — the bounded `RunSummary`
  // cards the run log and list pages consume, taken verbatim from the backend's
  // published index (no extra fetches). The app types these as RunSummary[].
  runSummaries: RunSummary[];
  // One listing card per case, mapped to the app's TestCaseSummary shape.
  testCases: AssembledCaseSummary[];
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
  // The media each case's catalog card previews (its `showcase`), resolved to
  // absolute URLs and keyed by the previewed `<slug>/<version>/<variant>` subject
  // then by the authored file name. The catalog is a listing, so this one slice
  // of a case version's showcase media is index data. The previewed version may
  // have no file of its own (no published run built it), so these addresses are
  // the only ones the site holds for it.
  catalogShowcaseMediaUrls: Record<string, Record<string, string>>;
}

// `runs/<id>.json`: everything the gallery reads about ONE run when a page of it
// opens — the record, the reviews, and where each of its published media files
// is. The event log is its own file (`run-events/<id>.json`), because only the
// Events tab reads it.
interface AssembledRunFile {
  // The full RunRecord (camelCase, links populated), verbatim.
  record: unknown;
  // Every review submitted against the run, one per reviewer. Empty for a
  // validator-rated run nobody has rated the aesthetics of.
  reviews: AssembledReview[];
  media: AssembledRunMedia;
}

// Where one run's published media is, each map keyed by the file name the UI
// requests and holding the absolute URL of the published object.
interface AssembledRunMedia {
  // Proof media, keyed by served file name (`<proof-id>.<ext>`).
  proof: Record<string, string>;
  // Asset-generation media, keyed by served file name (`regenerated.png`,
  // `preview.png`, `target.png`, `actions.json`).
  asset: Record<string, string>;
  // The *actual* automated-validation media, keyed by the flat
  // `<item>__<output>.<ext>` name. A recording's shared image store is NOT listed
  // here — see `validationStorePrefix`.
  validation: Record<string, string>;
  // Where the run's shared image store lives, as an absolute URL prefix, or null
  // when the run published none. One string rather than one entry per file: a
  // store holds a distinct file per unique image the run's recordings drew — some
  // fifteen hundred for the busiest case in the corpus — and their names are
  // content-addressed and published verbatim, so the prefix plus the name a
  // recording carries is the URL. The prefix is taken from a published key rather
  // than composed here, so this file learns no key shape it did not already know.
  validationStorePrefix: string | null;
  // Showcase media (the carousel plus any image the description references),
  // keyed by the recorded file name (a video's `.webm` request resolving to its
  // published `.mp4`).
  showcase: Record<string, string>;
  // The run's unbounded code-analysis document, or null for a run that was never
  // analysed — which is most of the corpus, since analysis is deliberately not
  // backfilled. The Code tab reads null as "not measured"; it must never be read
  // as "this model wrote no code".
  codeAnalysisUrl: string | null;
}

// One case's listing card (mirrors `TestCaseSummary` in the UI's testCases).
interface AssembledCaseSummary {
  slug: string;
  name: string;
  testType: TestType;
  // The asset shape an asset-generation case produces, so the catalog can
  // partition its 2D / 3D / Particle / Audio tabs. Null for a non-asset case.
  assetKind: AssetKind | null;
  difficulty: string;
  tags: string[];
  summary: string | null;
  // Every published version, newest first, and the newest of them. A version is
  // listed exactly when its `cases/<slug>/<version>.json` was emitted, so the app
  // asks only for files the build holds.
  versions: string[];
  latestVersion: string;
  // The case's catalog SHOWCASE PREVIEW (mirrors `CatalogShowcase` in the UI's
  // client types): the latest version's first variant (manifest order) that
  // declares a showcase, with the media list the catalog's preview stage loops.
  // Null when no variant declares one, and the catalog renders its placeholder
  // stage.
  showcase: {
    version: string;
    variant: string;
    media: AssembledShowcaseMedia[];
  } | null;
}

// `cases/<slug>.json`: what spans a case's versions and only a page of that case
// reads (the rest of `TestCaseDetail` in the UI's testCases). The variants
// themselves are per version — see `AssembledCaseVersion`.
interface AssembledCaseDetail {
  // The latest version's site-facing description.
  description: string | null;
  // Every version's own description, latest included, keyed by version — a
  // description ships with the version it describes, so the detail page anchored
  // to an older version shows that version's text.
  descriptionsByVersion: Record<string, string | null>;
  // One entry per version that declared a changelog, newest version first.
  changelog: AssembledChangelogEntry[];
  // One entry per version that recorded errata, newest version first.
  errata: AssembledErrataEntry[];
  // Every version's variant identities (slug + name), latest included — the
  // frame the detail header's variant selector is built from.
  variantsByVersion: Record<string, { slug: string; name: string }[]>;
  // The engines each published version's inputs can be read under, keyed by
  // version — the engineless rendering plus every engine the snapshot carries a
  // rendering for.
  enginesByVersion: Record<string, string[]>;
  // The latest version's common scoring domains.
  domains: AssembledDomain[];
  // The latest version's sprite-sheet declaration (frame size + named
  // sequences). Null for a non-sheet case (and for a snapshot that predates the
  // field), in which case the asset Reference tab shows the still reference
  // frames without animating them.
  sheet: AssetSheet | null;
}

// `cases/<slug>/<version>.json`: ONE version of a case — the variants a run of
// that version was given, and where the version's own media is. A file per
// version rather than per case, so a page reads the one version it shows and a
// case's file does not grow with every version it gains.
interface AssembledCaseVersion {
  variants: AssembledVariant[];
  media: AssembledCaseVersionMedia;
}

// Where one case version's media is, each inner map keyed by the file name the
// UI requests and holding the absolute URL of the published object.
interface AssembledCaseVersionMedia {
  // The *baseline* automated-validation media (the reference implementation's
  // declared outputs), keyed by `<engine>/<variant>` then the flat
  // `<item>__<output>.<ext>` name. The engine is in the key because a variant has
  // one reference implementation per engine, and a run is only comparable against
  // the one it was built on. The shared image store is not in here — see
  // `baselineStorePrefixes`.
  baselines: Record<string, Record<string, string>>;
  // Where each committed baseline's image store lives, as an absolute URL prefix,
  // keyed by the same `<engine>/<variant>`. The case-scoped counterpart of a
  // run's `validationStorePrefix`, carried for the same reason: a reference's
  // store is the larger of the two.
  baselineStorePrefixes: Record<string, string>;
  // The authored showcase media (a variant's carousel, captured from the
  // reference implementation), keyed by variant then the authored file name (a
  // video's `.webm` request resolving to its published `.mp4`).
  showcase: Record<string, Record<string, string>>;
  // The **asset-reference** media — a published reference frame's image and the
  // action log it was drawn from — keyed by variant then the file below that
  // variant's prefix (`frames/<index>.png`, `frames/<index>.actions.json`).
  reference: Record<string, Record<string, string>>;
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
  // The engine scoping of this point's validator: the engines it decides the point
  // on. A run built on any other engine does not carry the point, and the app drops
  // it through `reviewItemsForEngine`. Null when the point has no validator or the
  // validator names no engines.
  validation?: { engines?: string[] } | null;
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
  // The engine scoping of this point's validator (see `AssembledReviewItem`).
  validation?: { engines?: string[] } | null;
}

// Combine a case's common review items with a variant's own, merging by id so a
// variant that reuses a common category's id extends that category (folding in its
// items and weight) rather than forming a duplicate group. A fresh-id variant item
// is appended, preserving "common first, then the variant's own". A local mirror of
// `mergeReviewItems` in ui-common/packages/ui/src/ratings.ts (and `merge_review_items` in the
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
// the version and its known-issue errata. `assembleCases` concatenates these across
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
// by its authored file name. The bytes themselves resolve through the version's
// `media.showcase`, which is where the published object keys go.
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
  // and domains, the functional rating and score come from the run's validators
  // (reviewer overrides folded in), and reviewers rate the run-wide aesthetic
  // channel.
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
  // through the version's `media.reference`. Null when the variant has none.
  referenceSheet: { frames: number[] } | null;
  // The variant's authored showcase (description + carousel), or null when it
  // declares none (and for snapshots written before the field existed). The
  // media bytes resolve through the version's `media.showcase`.
  showcase: AssembledShowcase | null;
  // The variant's effective starter-workspace files for the ENGINELESS
  // rendering, each resolved to an absolute snapshot URL fetched lazily by the
  // Inputs tab. The per-engine sets ride on `engineRenderings`. Empty when the
  // case seeds none (and for snapshots written before the field existed).
  workspace: AssembledWorkspaceFile[];
}

// One case version as `mapCase` reads it out of its snapshot file: the fields
// `assembleCases` distributes between the case's listing card, its detail file
// and this version's own file.
interface MappedCaseVersion {
  slug: string;
  version: string;
  name: string;
  testType: TestType;
  assetKind: AssetKind | null;
  difficulty: string;
  tags: string[];
  summary: string | null;
  description: string | null;
  // This version's own changelog entry, or null when it declared none.
  changelog: AssembledChangelogEntry | null;
  // This version's errata, or null when it recorded none.
  errata: AssembledErrataEntry | null;
  variants: AssembledVariant[];
  // The engines this version's inputs can be read under — derived from the
  // renderings this snapshot actually carries rather than from the case's
  // declared `engines` (which it does not publish), so the Inputs tab offers
  // exactly the renderings the site can show.
  engines: string[];
  domains: AssembledDomain[];
  sheet: AssetSheet | null;
  // This version's catalog showcase preview: its first variant (manifest order)
  // that declares a showcase with media to show, or null. The catalog previews
  // from `case-showcases.json` when the snapshot has one, which reaches versions
  // no published run built, and falls back to the newest version's preview here.
  showcase: AssembledCaseSummary["showcase"];
  media: AssembledCaseVersionMedia;
}

// One case, split the way the build writes it: the listing card the index
// carries, the detail file a page of the case reads, and one file per version.
interface AssembledCase {
  summary: AssembledCaseSummary;
  detail: AssembledCaseDetail;
  // Newest version first.
  versions: Array<{ version: string; file: AssembledCaseVersion }>;
}

const EMPTY: AssembledSnapshot = {
  runSummaries: [],
  testCases: [],
  models: [],
  comparisons: [],
  testCaseGroups: [],
  ggRuns: null,
  catalogShowcaseMediaUrls: {},
};

// Aesthetic tiers, ordered best to worst — the second channel, one run-wide
// tier per review of a validator-rated run. Mirrors `AESTHETIC_RATINGS` in
// `@clockwyrks/run-stats`.
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

// The worst (lowest) aesthetic rating among `tiers`, or null when empty.
function worstAestheticRating(tiers: string[]): string | null {
  return worstOn(AESTHETIC_ORDER, tiers);
}

/**
 * Whether `file` is one of a recording's shared image store rather than a declared
 * validation output.
 *
 * MIRRORS `VALIDATION_IMAGE_PREFIX` / `is_validation_image_name` in
 * `contracts/crates/contracts/src/layout.rs` and `IMAGE_STORE_PREFIX` in
 * `engines/packages/case-harness/src/replay/store.ts`. A declared output's flat name always
 * carries `__` and a store file's never does, which is what keeps the two apart in
 * the one namespace they share.
 */
function isImageStoreFile(file: string): boolean {
  return file.startsWith("img.");
}

/** Everything of a published key up to and including its last `/`. */
function prefixOf(key: string): string {
  const cut = key.lastIndexOf("/");
  return cut < 0 ? "" : key.slice(0, cut + 1);
}

// Join a base URL with a snapshot-relative key, collapsing any double slash.
function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

// Map a snapshot review to the app's StoredReview shape, filling sensible
// defaults for fields an older snapshot may omit.
function toAssembledReview(review: SnapshotReview): AssembledReview {
  return {
    reviewer: review.reviewer ?? "Reviewer",
    ratings: review.ratings ?? [],
    // Resolve the run-wide tier here so the app reads one field either way; the
    // legacy entries ride along untouched for its own fallback.
    aesthetic:
      review.aesthetic ??
      worstAestheticRating((review.aesthetics ?? []).map((r) => r.rating)),
    aesthetics: review.aesthetics ?? [],
    writeup: review.writeup ?? "",
    checklist: review.checklist ?? [],
    reviewedAt: review.reviewedAt ?? null,
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

function mapCase(base: string, file: SnapshotCaseFile): MappedCaseVersion {
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
        validation: item.validation ?? null,
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
          validation: sub.validation ?? null,
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
      // objects they address are resolved into absolute URLs by `mapCaseMedia`.
      referenceSheet: variant.referenceSheet ?? null,
      // The variant's authored showcase — the addressing only (file/name/kind);
      // the published object keys are resolved by `mapCaseMedia`.
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
  // that declares a showcase with media to show.
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
    version: file.version,
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
    changelog: file.changelog
      ? { version: file.version, body: file.changelog }
      : null,
    errata:
      file.errata && file.errata.length > 0
        ? { version: file.version, errata: file.errata }
        : null,
    variants,
    engines: renderableEngines(variants),
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
    media: mapCaseMedia(base, file),
  };
}

// Resolve where one case version's media is. Every map is built from this
// version's own file, so a run against any published version resolves the media
// of the version it was compared against.
function mapCaseMedia(
  base: string,
  file: SnapshotCaseFile,
): AssembledCaseVersionMedia {
  const media: AssembledCaseVersionMedia = {
    baselines: {},
    baselineStorePrefixes: {},
    showcase: {},
    reference: {},
  };

  // The *baseline* validation media, keyed by `<engine>/<variant>` then the flat
  // `<item>__<output>.<ext>` name the reviewer UI requests (a video's `.webm`
  // request resolving to its published `.mp4` key).
  for (const baseline of file.validationBaselines ?? []) {
    const subjectKey = `${baseline.engine}/${baseline.variant}`;
    // A recording's shared image store contributes ONE prefix rather than one
    // entry per file. A committed reference's store holds an entry for every
    // image the whole baseline corpus of that engine and variant drew; the names
    // are content-addressed and published verbatim, so a prefix taken from any
    // one of its keys resolves all of them.
    if (isImageStoreFile(baseline.file)) {
      media.baselineStorePrefixes[subjectKey] ??= joinUrl(
        base,
        prefixOf(baseline.key),
      );
      continue;
    }
    const byFile = media.baselines[subjectKey] ?? {};
    byFile[baseline.file] = joinUrl(base, baseline.key);
    media.baselines[subjectKey] = byFile;
  }

  for (const variant of file.variants) {
    // The authored showcase carousel, keyed by the authored file name the UI
    // requests (a video's `.webm` request resolving to its published `.mp4` key).
    const carousel = variant.showcase?.media;
    if (carousel?.length) {
      const byFile: Record<string, string> = {};
      for (const entry of carousel) {
        byFile[entry.file] = joinUrl(base, entry.key);
      }
      media.showcase[variant.slug] = byFile;
    }

    // The asset-reference media. Unlike every map above, these keys are not
    // listed in the snapshot — only the published frame INDICES are — so they
    // are reconstructed from the deterministic layout the publisher writes:
    //
    //   media/references/<slug>/<version>/<variant>/frames/<index>.png
    //   media/references/<slug>/<version>/<variant>/frames/<index>.actions.json
    //
    // This MIRRORS the Rust helpers that write them (`reference_prefix` /
    // `reference_image_key` / `reference_actions_key` in
    // `contracts/crates/contracts/src/asset_reference.rs`) and the console's
    // `referenceMediaKey` in `ui-common/packages/ui/src/transport/httpBackend.ts`;
    // all three must change together. The console's helper is not imported here
    // because this build-time plugin must not pull in the React UI package.
    const frames = variant.referenceSheet?.frames;
    if (frames?.length) {
      const byFile: Record<string, string> = {};
      const prefix = `media/references/${file.slug}/${file.version}/${variant.slug}`;
      for (const index of frames) {
        for (const name of [`${index}.png`, `${index}.actions.json`]) {
          byFile[`frames/${name}`] = joinUrl(base, `${prefix}/frames/${name}`);
        }
      }
      media.reference[variant.slug] = byFile;
    }
  }
  return media;
}

// Group the per-(slug, version) case files into one case per slug, newest
// version first, and split each into the three places the build writes it: the
// listing card, the detail that spans its versions, and one file per version.
// Cases come out in the order the files first named them.
function assembleCases(
  base: string,
  files: SnapshotCaseFile[],
): AssembledCase[] {
  const bySlug = new Map<string, MappedCaseVersion[]>();
  for (const file of files) {
    const list = bySlug.get(file.slug) ?? [];
    list.push(mapCase(base, file));
    bySlug.set(file.slug, list);
  }
  const result: AssembledCase[] = [];
  for (const versions of bySlug.values()) {
    // Newest version first by descending version string (semver-ish vX.Y.Z).
    versions.sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
    // The newest version is the one the catalog lists the case as.
    const newest = versions[0]!;
    const descriptionsByVersion: Record<string, string | null> = {};
    const variantsByVersion: Record<string, { slug: string; name: string }[]> =
      {};
    const enginesByVersion: Record<string, string[]> = {};
    for (const mapped of versions) {
      descriptionsByVersion[mapped.version] = mapped.description;
      variantsByVersion[mapped.version] = mapped.variants.map((variant) => ({
        slug: variant.slug,
        name: variant.name,
      }));
      enginesByVersion[mapped.version] = mapped.engines;
    }
    result.push({
      summary: {
        slug: newest.slug,
        name: newest.name,
        testType: newest.testType,
        assetKind: newest.assetKind,
        difficulty: newest.difficulty,
        tags: newest.tags,
        summary: newest.summary,
        versions: versions.map((mapped) => mapped.version),
        latestVersion: newest.version,
        showcase: newest.showcase,
      },
      detail: {
        description: newest.description,
        descriptionsByVersion,
        // Each version contributes at most one entry, and `versions` is
        // newest-first, so both lists are already ordered newest first.
        changelog: versions.flatMap((mapped) =>
          mapped.changelog ? [mapped.changelog] : [],
        ),
        errata: versions.flatMap((mapped) =>
          mapped.errata ? [mapped.errata] : [],
        ),
        variantsByVersion,
        enginesByVersion,
        domains: newest.domains,
        sheet: newest.sheet,
      },
      versions: versions.map((mapped) => ({
        version: mapped.version,
        file: { variants: mapped.variants, media: mapped.media },
      })),
    });
  }
  return result;
}

/**
 * Where `loadSnapshot` hands each static file's content as it assembles it. The
 * plugin writes each to the path the app fetches it from; the tests collect them.
 */
export interface SnapshotEmitter {
  /** One run's file (`runs/<id>.json`): its record, reviews and media. */
  run(runId: string, json: string): void;
  /** One run's event log (`run-events/<id>.json`), for a run that recorded one. */
  events(runId: string, json: string): void;
  /** One case's detail (`cases/<slug>.json`). */
  caseDetail(slug: string, json: string): void;
  /** One case version (`cases/<slug>/<version>.json`). */
  caseVersion(slug: string, version: string, json: string): void;
}

// The showcase a case's catalog card previews: the first variant (manifest order)
// with media to show, of the case's newest version that has one. Null when no
// version of the case carries a showcase.
function newestCaseShowcase(
  file: SnapshotCaseShowcasesFile,
  slug: string,
): {
  version: string;
  variant: string;
  media: NonNullable<SnapshotCaseFile["variants"][number]["showcase"]>["media"];
} | null {
  const versions = file.showcases
    .filter((entry) => entry.slug === slug)
    .sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  for (const entry of versions) {
    const variant = entry.variants.find(
      (candidate) => candidate.showcase.media.length > 0,
    );
    if (variant) {
      return {
        version: entry.version,
        variant: variant.variant,
        media: variant.showcase.media,
      };
    }
  }
  return null;
}

// Fetch and assemble the published snapshot. Follows the atomic pointer
// `index.json` -> versioned prefix -> `runs.json` -> per-run + per-case files.
// It returns the INDEX, which the plugin inlines, and hands everything that
// describes one run or one case to `emit`, which the plugin writes out as the
// static files the app fetches when a page of that run or case opens.
//
// Every document is read through `fetcher`, and the per-run and per-case
// documents `concurrency` at a time. The emitter is still called in the
// snapshot's own order — a run's file before its events and one run after
// another, then one case after another, its detail before its versions — so
// what is assembled and emitted is independent of the concurrency.
//
// Exported for the plugin's tests, which drive it with a scripted `fetch`.
export async function loadSnapshot(
  base: string,
  emit: SnapshotEmitter,
  fetcher: SnapshotFetcher,
  concurrency: number,
): Promise<AssembledSnapshot | null> {
  // `index.json` is the atomic pointer the backend writes last, only after a
  // publish. A 404 here means nothing has been published yet (a fresh
  // deployment), which is the empty-dataset bootstrap case — signal it with
  // `null` so the build succeeds empty. Any other non-OK status is a genuinely
  // broken snapshot and must fail the build.
  let index: SnapshotIndex;
  try {
    index = await fetcher.json<SnapshotIndex>(joinUrl(base, "index.json"));
  } catch (error) {
    if (error instanceof SnapshotFetchError && error.status === 404) {
      return null;
    }
    throw error;
  }
  const runsFile = await fetcher.json<SnapshotRunsFile>(
    joinUrl(base, index.runsKey),
  );

  // The case-version keys referenced by published runs; deduplicated.
  const caseKeys = new Set<string>();

  // The run's document is content-addressed under a snapshot-independent prefix, so
  // the summary is what names it — the key carries a digest of the document's own
  // bytes and cannot be composed from the run id. A summary in `runs.json` always
  // carries one; a missing key is a malformed snapshot, not a fallback path. Checked
  // for every run before the first document is requested, so a malformed index fails
  // the build without a download.
  const runDocuments = runsFile.runs.map((summary) => {
    if (!summary.documentKey) {
      throw new Error(
        `snapshot run summary ${summary.id} carries no documentKey; the snapshot is malformed`,
      );
    }
    return { summary, url: joinUrl(base, summary.documentKey) };
  });

  // One file per run. The documents are fetched several at a time and assembled
  // in the snapshot's newest-first order, one run after another.
  const assembleRun = (
    runFile: SnapshotRunFile,
    { summary }: { summary: RunSummary },
  ): void => {
    const media: AssembledRunMedia = {
      proof: {},
      asset: {},
      validation: {},
      validationStorePrefix: null,
      showcase: {},
      // Absent for a run that was never analysed, which is the honest default
      // rather than an empty document.
      codeAnalysisUrl: runFile.codeAnalysisKey
        ? joinUrl(base, runFile.codeAnalysisKey)
        : null,
    };
    // Proof media is keyed by served file name, the key's last segment.
    for (const proof of runFile.proofMedia ?? []) {
      const file = proof.key.split("/").pop() ?? proof.key;
      media.proof[file] = joinUrl(base, proof.key);
    }
    for (const asset of runFile.assetMedia ?? []) {
      media.asset[asset.file] = joinUrl(base, asset.key);
    }
    for (const entry of runFile.validationMedia ?? []) {
      // A recording's shared image store contributes ONE prefix rather than one
      // entry per file: the names are content-addressed and published verbatim,
      // so a prefix taken from any one of the run's store keys resolves all of
      // them.
      if (isImageStoreFile(entry.file)) {
        media.validationStorePrefix ??= joinUrl(base, prefixOf(entry.key));
        continue;
      }
      media.validation[entry.file] = joinUrl(base, entry.key);
    }
    for (const entry of runFile.showcaseMedia ?? []) {
      media.showcase[entry.file] = joinUrl(base, entry.key);
    }
    const assembled: AssembledRunFile = {
      record: runFile.record,
      reviews: (runFile.reviews ?? []).map(toAssembledReview),
      media,
    };
    emit.run(summary.id, JSON.stringify(assembled));
    // The recorded events are a file of their own (only when present), so a page
    // of the run does not download a log only its Events tab reads.
    if (runFile.events != null) {
      emit.events(summary.id, JSON.stringify(runFile.events));
    }
    const { testCaseSlug, testCaseVersion } = summary.subject;
    caseKeys.add(`${index.casesPrefix}${testCaseSlug}/${testCaseVersion}.json`);
  };
  await forEachOrdered(
    runDocuments,
    concurrency,
    ({ url }) => fetcher.json<SnapshotRunFile>(url),
    assembleRun,
  );

  // Per-case-version metadata for every case a published run references, in the
  // order the runs first referenced them.
  const caseFiles: SnapshotCaseFile[] = [];
  await forEachOrdered(
    [...caseKeys],
    concurrency,
    async (key) => {
      try {
        return await fetcher.json<SnapshotCaseFile>(joinUrl(base, key));
      } catch {
        // A run can reference a historical case-version the snapshot did not
        // emit; skip it rather than failing the whole build (the run still shows,
        // it just lacks framing metadata).
        return null;
      }
    },
    (file) => {
      if (file !== null) caseFiles.push(file);
    },
  );

  // The case showcases, which a case's catalog preview is taken from: its newest
  // version's, whether or not a run of that version is published. Absent from a
  // snapshot published before the file existed, and unreadable is treated the
  // same way — the preview then falls back to the newest case file's showcase.
  let caseShowcases: SnapshotCaseShowcasesFile | null = null;
  if (index.caseShowcasesKey) {
    try {
      caseShowcases = await fetcher.json<SnapshotCaseShowcasesFile>(
        joinUrl(base, index.caseShowcasesKey),
      );
    } catch {
      // Missing/unreadable: preview from the case files rather than failing the
      // whole build.
    }
  }

  // One detail file per case and one file per version of it; the listing card
  // and the media its catalog preview shows are all the index keeps of a case.
  const testCases: AssembledCaseSummary[] = [];
  const catalogShowcaseMediaUrls: Record<string, Record<string, string>> = {};
  for (const assembled of assembleCases(base, caseFiles)) {
    const { summary } = assembled;
    testCases.push(summary);
    emit.caseDetail(summary.slug, JSON.stringify(assembled.detail));
    for (const { version, file } of assembled.versions) {
      emit.caseVersion(summary.slug, version, JSON.stringify(file));
    }
    if (caseShowcases) {
      const preview = newestCaseShowcase(caseShowcases, summary.slug);
      summary.showcase = preview
        ? {
            version: preview.version,
            variant: preview.variant,
            media: preview.media.map(({ file, name, kind }) => ({
              file,
              name,
              kind,
            })),
          }
        : null;
      if (preview) {
        const byFile: Record<string, string> = {};
        for (const entry of preview.media) {
          byFile[entry.file] = joinUrl(base, entry.key);
        }
        catalogShowcaseMediaUrls[
          `${summary.slug}/${preview.version}/${preview.variant}`
        ] = byFile;
      }
    } else if (summary.showcase) {
      const { version, variant } = summary.showcase;
      const previewed = assembled.versions.find(
        (entry) => entry.version === version,
      )?.file.media.showcase[variant];
      if (previewed) {
        catalogShowcaseMediaUrls[`${summary.slug}/${version}/${variant}`] =
          previewed;
      }
    }
  }

  // The model catalog. Absent from a snapshot published before it existed, in
  // which case the Models section renders empty.
  let models: unknown[] = [];
  if (index.modelsKey) {
    try {
      const modelsFile = await fetcher.json<SnapshotModelsFile>(
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
      const comparisonsFile = await fetcher.json<SnapshotComparisonsFile>(
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
      const groupsFile = await fetcher.json<SnapshotTestCaseGroupsFile>(
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
      const ggRunsFile = await fetcher.json<SnapshotGgRunsFile>(
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
    testCases,
    models,
    comparisons,
    testCaseGroups,
    ggRuns,
    catalogShowcaseMediaUrls,
  };
}

// The index as the source of `virtual:tcab-snapshot`. Exported for the plugin's
// tests, which compare two loads byte for byte.
export function serialize(data: AssembledSnapshot): string {
  return [
    "// Generated at build time by vite-plugin-snapshot. Do not edit.",
    `export const runSummaries = ${JSON.stringify(data.runSummaries)};`,
    `export const testCases = ${JSON.stringify(data.testCases)};`,
    `export const models = ${JSON.stringify(data.models)};`,
    `export const comparisons = ${JSON.stringify(data.comparisons)};`,
    `export const testCaseGroups = ${JSON.stringify(data.testCaseGroups)};`,
    `export const ggRuns = ${JSON.stringify(data.ggRuns)};`,
    `export const catalogShowcaseMediaUrls = ${JSON.stringify(data.catalogShowcaseMediaUrls)};`,
  ].join("\n");
}

/** The largest file a Cloudflare Pages deployment accepts, in bytes (25 MiB). */
export const PAGES_FILE_LIMIT_BYTES = 25 * 1024 * 1024;

/** One file of the build's output and its size on disk. */
export interface BuiltFile {
  fileName: string;
  bytes: number;
}

/** What the build reports about the sizes of the files it wrote. */
export interface SizeReport {
  /** The largest JavaScript file — the bundle the index is inlined into. */
  bundle: BuiltFile | null;
  /** The largest of the per-run and per-case data files. */
  data: BuiltFile | null;
  /** Every file over `limit`, largest first. A deployment holding one is refused. */
  oversized: BuiltFile[];
}

/**
 * Measure a build's files against the per-file limit of the host it deploys to.
 *
 * Exported for the plugin's tests.
 */
export function reportSizes(
  files: Iterable<BuiltFile>,
  limit: number = PAGES_FILE_LIMIT_BYTES,
): SizeReport {
  const largest = (a: BuiltFile | null, b: BuiltFile): BuiltFile =>
    a === null || b.bytes > a.bytes ? b : a;
  const report: SizeReport = { bundle: null, data: null, oversized: [] };
  for (const file of files) {
    if (file.fileName.endsWith(".js")) {
      report.bundle = largest(report.bundle, file);
    } else if (DATA_FILE.test(file.fileName)) {
      report.data = largest(report.data, file);
    }
    if (file.bytes > limit) report.oversized.push(file);
  }
  report.oversized.sort((a, b) => b.bytes - a.bytes);
  return report;
}

// The static files this plugin emits, by the directories it writes them under.
const DATA_FILE = /^(runs|run-events|cases)\/.*\.json$/;

function mebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
      let concurrency: number;
      try {
        concurrency = resolveConcurrency(process.env[CONCURRENCY_ENV]);
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
      const fetcher = createSnapshotFetcher();
      const started = performance.now();
      try {
        // Each file is written at the stable, predictable path the static site
        // fetches it from at runtime.
        const emitted = { runs: 0, events: 0, cases: 0, caseVersions: 0 };
        const write = (fileName: string, source: string): void => {
          this.emitFile({ type: "asset", fileName, source });
        };
        const data = await loadSnapshot(
          base,
          {
            run: (runId, json) => {
              write(`runs/${runId}.json`, json);
              emitted.runs += 1;
            },
            events: (runId, json) => {
              write(`run-events/${runId}.json`, json);
              emitted.events += 1;
            },
            caseDetail: (slug, json) => {
              write(`cases/${slug}.json`, json);
              emitted.cases += 1;
            },
            caseVersion: (slug, version, json) => {
              write(`cases/${slug}/${version}.json`, json);
              emitted.caseVersions += 1;
            },
          },
          fetcher,
          concurrency,
        );
        if (data === null) {
          this.warn(
            `no published snapshot at ${base} yet (index.json 404); building with an empty dataset. The backend's deploy hook will rebuild the gallery once a run is published.`,
          );
          module = serialize(EMPTY);
          return;
        }
        this.info(
          `fetched snapshot from ${base}: ${data.runSummaries.length} run(s), ${data.testCases.length} case(s) in ${emitted.caseVersions} version(s), ${emitted.events} event log(s), ${emitted.runs} run file(s).`,
        );
        this.info(
          `fetched ${fetcher.fetched} snapshot document(s), ${fetcher.retried} of them after a retry, in ${((performance.now() - started) / 1000).toFixed(1)} s (${concurrency} at a time).`,
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
    // Every file is final here (chunks are already minified), so this is where
    // the build's sizes are what the deployment will hold. Cloudflare Pages
    // refuses a deployment with a file over its limit and keeps serving the last
    // one it accepted, so the gallery goes stale without anything looking broken;
    // failing here names the file in the build that produced it.
    generateBundle(_options, bundle) {
      if (!isBuild) return;
      const report = reportSizes(
        Object.values(bundle).map((file) => ({
          fileName: file.fileName,
          bytes:
            file.type === "chunk"
              ? Buffer.byteLength(file.code)
              : Buffer.byteLength(file.source),
        })),
      );
      const describe = (file: BuiltFile | null): string =>
        file === null ? "none" : `${file.fileName} (${mebibytes(file.bytes)})`;
      this.info(
        `largest bundle file: ${describe(report.bundle)}; largest data file: ${describe(report.data)}; the limit per file is ${mebibytes(PAGES_FILE_LIMIT_BYTES)}.`,
      );
      if (report.oversized.length > 0) {
        this.error(
          `${report.oversized
            .map(describe)
            .join(
              ", ",
            )} exceeds the ${mebibytes(PAGES_FILE_LIMIT_BYTES)} a Cloudflare Pages deployment accepts per file, so this build cannot be deployed. The bundle inlines the snapshot's index (see AssembledSnapshot in vite-plugin-snapshot.ts): data about one run or one case belongs in that run's or that case's own file.`,
        );
      }
    },
  };
}
