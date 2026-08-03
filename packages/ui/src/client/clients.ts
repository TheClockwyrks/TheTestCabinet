// The two service-client interfaces the console is written against. Each has a
// transport implementation per app:
//   - HTTP  (apps/web): `fetch` against the backend / worker REST APIs.
//   - Tauri (apps/desktop, a later item): `invoke` + Tauri events.
// The console never imports a transport; it only depends on these interfaces and
// reads them from context (see context.tsx).
import type {
  Account,
  AssetPreview,
  AuthResult,
  BackendIdentity,
  DomainRating,
  HarnessConfigEntry,
  HarnessEvent,
  InProgressRun,
  LaunchConfig,
  LogoFetchResult,
  Model,
  ModelInput,
  ModelListing,
  ModelSeed,
  MyReviewsPage,
  ProgressCallback,
  PublishProgress,
  PublishResult,
  ReviewItem,
  ReviewStats,
  ReviewVerdict,
  RunEventStreams,
  RunJob,
  RunNotification,
  RunOutcome,
  RunPage,
  Specification,
  StoredRun,
  TestCase,
  VersionInfo,
  WorkerIdentity,
} from "./types";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type {
  GgRunRequest,
  LaunchAck,
} from "@test-cabinet/run-record/jobs-api";
import type {
  GgConfig,
  GgConfigInput,
  GgReplayRecordV1,
} from "@test-cabinet/run-record/gg";
import type { GgReference } from "@test-cabinet/run-record/gg-reference";
import type { GgReplayRecord } from "@test-cabinet/run-record/gg-replay";
import type { CodeAnalysisDocument } from "@test-cabinet/run-record/code-analysis";
import type {
  GgDashboard,
  GgDashboardInput,
  GgFieldCatalog,
  GgQuery,
  GgQueryBatch,
  GgQueryBatchResponse,
  GgQueryResponse,
  GgSavedQuery,
  GgSavedQueryInput,
} from "@test-cabinet/run-record/gg-query";
import type {
  CoverageGroup,
  CoverageGroupInput,
  CoverageMatrix,
  CoveragePlan,
  CoveragePlanInput,
  CoveragePlanSummary,
} from "@test-cabinet/run-record/coverage";
import type {
  Comparison,
  ComparisonInput,
} from "@test-cabinet/run-record/comparison";

// One page of bounded run summary cards from the backend
// (`GET /runs?fields=summary`), newest first — the lightweight projection of
// {@link RunPage} the run log and list pages consume. `nextCursor` is the
// `before` value for the following page, or null when there are none more.
// `total` is the count of all matching rows ignoring the page window — present
// (non-null) only on the numbered-pager (offset) path, so the console can size
// its pager; null on the `before`-cursor drain path (which walks rather than
// jumps).
export interface RunSummaryPage {
  summaries: RunSummary[];
  nextCursor: string | null;
  total: number | null;
}

// The sort column for a summary listing, matching the backend's accepted `sort`
// query tokens exactly (`GET /runs?fields=summary&sort=…`; see the backend's
// `parse_sort`). `date` orders by the run's start time, `runtime`/`tokens`/`cost`
// by the recorded metrics, `rating` by the aggregate quality tier, and the rest
// by the lifted identity columns. Unknown/absent defaults to `date` server-side.
export type RunSort =
  | "date"
  | "runtime"
  | "tokens"
  | "cost"
  | "rating"
  | "testType"
  | "testCase"
  | "harness"
  | "model"
  | "variant";

// The sort direction for a summary listing, matching the backend's accepted `dir`
// query tokens exactly (`asc`/`desc`; unknown/absent defaults to `desc`).
export type SortDir = "asc" | "desc";

// Thrown by a transport for an operation its service doesn't (yet) expose, so
// the console can render a clear "not available here" state rather than a raw
// network error. The HTTP worker transport, for example, throws this for catalog
// and review operations the worker API does not define.
export class NotSupportedError extends Error {
  constructor(operation: string) {
    super(`This connection does not support "${operation}".`);
    this.name = "NotSupportedError";
  }
}

// One arm run a comparison publish could not enqueue, with why (e.g. an
// infrastructure failure, or a review-less run with no automated verdicts to
// stand in for the review) — so a partially-published comparison never reads as
// if every run behind it is inspectable.
export interface SkippedComparisonRun {
  runId: string;
  reason: string;
}

// The result of `BackendClient.publishComparison`: which of the comparison's
// arm runs were enqueued for publishing (one ordinary publish job each) and
// which were skipped. Mirrors the backend's `ComparisonPublishOutcome`
// (`crates/backend/src/api/comparisons.rs`), which is not part of the
// generated contract (it derives only `Serialize`, not `TS`).
export interface ComparisonPublishOutcome {
  enqueued: string[];
  skipped: SkippedComparisonRun[];
}

// The backend: the canonical source of test-case definitions, container image
// references, and published results. Every runner and reporter resolves the
// catalog from here — never from a worker. Mirrors the backend HTTP API
// (components/backend/api.md).
/**
 * The replay-record format this app reads — mirrors `GG_REPLAY_FORMAT_VERSION` in
 * `crates/core/src/gg_replay.rs`.
 *
 * The compatibility contract, and the only identity a reader may branch on: not the
 * recorder's `ggVersion` (a version bump with no prompt change must not invalidate every
 * record on every release) and not its `commit`.
 */
export const GG_REPLAY_FORMAT_VERSION = 2;

/**
 * The format an **absent** `formatVersion` means — mirrors `GG_REPLAY_FORMAT_V1`.
 *
 * Every record captured before the field existed carries no version at all, and the
 * backend stores and serves them as opaque bytes, so this default is what keeps them
 * readable rather than unparseable.
 */
export const GG_REPLAY_FORMAT_V1 = 1;

/**
 * What the run's replay slot (`GET /runs/{id}/replay`) held, tagged by the format it is in.
 *
 * The stored document is **versioned**, and the tag is what keeps a version check from becoming
 * the bug. Every format shares its outer field names — `sessionId`, `capabilitySet`, `entries` —
 * so an untagged cast to whichever shape the app happens to read deserializes without complaint
 * and then renders a full session as an empty one, with nothing raised anywhere. Tagging the read
 * turns that silence into a statement: a legacy record is walked as the transcript it is, and a
 * record from a build newer than this app is refused rather than guessed at.
 */
export type StoredGgReplay =
  /** A pooled [format-v2](https://docs.testcabinet.ai/gg/analysis/replay-records/) record. */
  | { format: "v2"; record: GgReplayRecord }
  /**
   * A legacy transcript record, written before pooling. Walked — the console reads it behind an
   * older-gg banner — but it carries only model I/O and tool results.
   */
  | { format: "v1"; record: GgReplayRecordV1 }
  /**
   * A record from a newer recorder. Carries only the version, because nothing else in it can be
   * trusted to mean what this app would take it to mean.
   */
  | { format: "newer"; formatVersion: number };

export interface BackendClient {
  /** Identify and health-check the backend (`GET /healthz`). */
  identity(): Promise<BackendIdentity>;

  // Catalog. (Harnesses are a fixed, code-defined catalog in the UI — see
  // `app/data/harnesses.ts` — not served by the backend.)
  //
  // The model catalog is served by `GET /models`: curated configs merged with the
  // models derived from recorded runs, each with its observed price history. The
  // config mutations below are optional so a transport that can't reach them (the
  // static site) omits them and the console hides the affordance — the same
  // pattern `deleteRun?`/`killRun?` use.
  listModels(): Promise<Model[]>;
  /** Create a curated model config (`POST /models`, Bearer). */
  createModel?(input: ModelInput, token: string): Promise<Model>;
  /** Update a curated model config (`PUT /models/{slug}`, Bearer). */
  updateModel?(slug: string, input: ModelInput, token: string): Promise<Model>;
  /** Delete a curated model config (`DELETE /models/{slug}`, Bearer). */
  deleteModel?(slug: string, token: string): Promise<void>;
  /** Fetch + sanitize a provider logo from an svgl.app URL (`POST /models/logo`, Bearer). */
  fetchModelLogo?(url: string, token: string): Promise<LogoFetchResult>;
  /** A blank-form seed derived from a run of an unknown model (`GET /models/seed`). */
  seedModelFromRun?(runId: string): Promise<ModelSeed>;
  /** What OpenRouter publishes about a model, so the config form can fill itself
   * in rather than have the operator retype it (`GET /models/openrouter`, Bearer). */
  lookupOpenrouterModel?(slug: string, token: string): Promise<ModelListing>;

  // Per-harness configuration (`GET /harness-config` open; the setter Bearer). The
  // list enumerates every harness with its current knobs (today: max parallelism);
  // the setter upserts one harness's config and returns the refreshed list. Optional
  // so a transport without them (the static site) hides the affordance.
  /** Every harness with its current configuration (`GET /harness-config`). */
  listHarnessConfigs?(): Promise<HarnessConfigEntry[]>;
  /** Set a harness's maximum parallelism (`null` = no limit); resolves to the
   * refreshed list (`POST /harness-config/{slug}`, Bearer). */
  setHarnessMaxParallelism?(
    slug: string,
    maxParallelism: number | null,
    token: string,
  ): Promise<HarnessConfigEntry[]>;

  listTestCases(): Promise<TestCase[]>;
  listVersions(slug: string): Promise<string[]>;
  resolveVersion(slug: string, version: string): Promise<VersionInfo>;
  readSpecs(
    slug: string,
    version: string,
    variant: string,
  ): Promise<Specification>;

  // Published runs (the read side a reporter/gallery consumes).
  /**
   * List published runs, newest first (`GET /runs`), paginated by a `before`
   * cursor and a `limit`. Resolves the page's runs and the cursor for the next
   * page (`null` when there are no more).
   */
  listRuns(opts?: { before?: string; limit?: number }): Promise<RunPage>;

  /**
   * List bounded run summary cards, newest first (`GET /runs?fields=summary`) —
   * the lightweight projection the run log and list pages consume instead of full
   * records. Two paging modes share the endpoint:
   *
   * - The **cursor** drain (public snapshot / worklists): pass a `before` cursor
   *   and a `limit`, optionally narrowed by `state`. Resolves the page's summaries
   *   and `nextCursor` (the `before` value for the following page, `null` when no
   *   more); `total` is `null`.
   * - The **numbered-pager** window (console listings): pass an `offset` (0-based;
   *   its presence selects this mode) with an optional `limit`, `state`, the
   *   equality filters (`testCase`/`model`/`harness`), a free-text `q`, and
   *   `sort`/`dir`. Resolves the windowed summaries plus the `total` count of all
   *   matching rows (`nextCursor` is `null`).
   */
  listRunSummaries(opts?: {
    before?: string;
    limit?: number;
    offset?: number;
    state?: string;
    testCase?: string;
    model?: string;
    harness?: string;
    q?: string;
    sort?: RunSort;
    dir?: SortDir;
  }): Promise<RunSummaryPage>;

  /** One published run by id (`GET /runs/{id}`): record + review + links. */
  readRun(id: string): Promise<StoredRun>;

  /**
   * A published run's recorded normalized event stream (`GET /runs/{id}/events`),
   * for the run-detail Events tab. Raw harness output is never published, so
   * {@link RunEventStreams.raw} is always `null` here. May throw
   * {@link NotSupportedError} where the transport cannot reach published events.
   * `onProgress`, when given, is called with transfer progress as the (possibly
   * large) stream downloads.
   */
  readRunEvents(
    id: string,
    onProgress?: ProgressCallback,
  ): Promise<RunEventStreams>;

  /**
   * A gg run's stored **replay record** (`GET /runs/{id}/replay`), or `null` when the
   * run has none. Backs the console's step-through Replay view: the record pins each
   * agent's model I/O, every tool result and the window gg built each turn, so a
   * developer can walk exactly what each agent saw and did.
   *
   * [Capture is unconditional](https://docs.testcabinet.ai/gg/replay/) from gg 0.7.0
   * onward, so a `null` here means the run predates that (it was recorded only if the
   * `replay` capability happened to be on) or is not a gg run at all — not that the
   * feature was switched off. Optional so a transport that cannot reach per-run debug
   * media (the static site) omits it and the console hides the affordance — the same
   * pattern the other console-only reads use.
   *
   * Resolves to a {@link StoredGgReplay} rather than a bare record because the slot is
   * versioned and the reader must know which version it holds — see that type.
   */
  readGgReplay?(id: string): Promise<StoredGgReplay | null>;

  /**
   * A run's stored **code-analysis document** (`GET /runs/{id}/code-analysis`), or `null`
   * when the run has none. Backs the run-detail Code tab's explorer: the bounded summary
   * rides on the record, and this is the unbounded tier behind it — every authored file,
   * every function with its complexity, every import edge, cycle and clone group.
   *
   * Not harness-specific: analysing a directory involves no harness-specific work, so the
   * tab is offered on every run that carries an analysis. A `null` means the run predates
   * the analyzer — [the corpus is not
   * backfilled](https://docs.testcabinet.ai/gg/analysis/code-analysis/#publishing-and-the-analyzer-version)
   * — not that anything failed. Optional so a transport that cannot reach per-run media
   * omits it and the tab falls back to the summary alone, which is the same pattern the
   * other console-only reads use.
   */
  readCodeAnalysis?(id: string): Promise<CodeAnalysisDocument | null>;

  /**
   * The reviewer checklist items a case declares for a variant (`commonReviewItems`
   * plus the variant's own), resolved from the version manifest. These are
   * definitional catalog data — keyed by the case identity a run record carries,
   * not by run id — so the reviewer works through every item the author called out.
   */
  readReviewItems(
    slug: string,
    version: string,
    variant: string,
  ): Promise<ReviewItem[]>;

  // Reviewer coverage groups + plans (console-only, Bearer). Everything is
  // per-account, so every call carries the reviewer's token. These are optional so
  // the static site's read-only transport omits them; the console gates the
  // reviewer surfaces on `canExecute` and a signed-in account, and never calls them
  // otherwise.
  /** The reviewer's reusable groups, both kinds (`GET /coverage-groups`). */
  listCoverageGroups?(token: string): Promise<CoverageGroup[]>;
  /** Create a group (`POST /coverage-groups`), returning it with its new id. */
  createCoverageGroup?(
    input: CoverageGroupInput,
    token: string,
  ): Promise<CoverageGroup>;
  /** Update a group in place (`PUT /coverage-groups/{id}`). */
  updateCoverageGroup?(
    id: string,
    input: CoverageGroupInput,
    token: string,
  ): Promise<CoverageGroup>;
  /** Delete a group (`DELETE /coverage-groups/{id}`). */
  deleteCoverageGroup?(id: string, token: string): Promise<void>;
  /** The reviewer's coverage plans (`GET /coverage-plans`). */
  listCoveragePlans?(token: string): Promise<CoveragePlan[]>;
  /** Create a plan (`POST /coverage-plans`), returning it with its new id. */
  createCoveragePlan?(
    input: CoveragePlanInput,
    token: string,
  ): Promise<CoveragePlan>;
  /** Update a plan in place (`PUT /coverage-plans/{id}`). */
  updateCoveragePlan?(
    id: string,
    input: CoveragePlanInput,
    token: string,
  ): Promise<CoveragePlan>;
  /** Delete a plan (`DELETE /coverage-plans/{id}`). */
  deleteCoveragePlan?(id: string, token: string): Promise<void>;
  /**
   * Per-plan coverage roll-ups for the plans list and the Home widget
   * (`GET /coverage-plans/summary`).
   */
  getCoveragePlansSummary?(token: string): Promise<CoveragePlanSummary[]>;
  /**
   * The coverage matrix computed from one plan
   * (`GET /coverage-plans/{id}/coverage`): every `case × combination` cell with its
   * completed/in-flight/remaining counts and version-staleness flag.
   */
  getCoveragePlanCoverage?(id: string, token: string): Promise<CoverageMatrix>;

  // The operator's saved gg configurations (console-only, Bearer). gg is its own
  // run mode — a named capability set stands where a third-party run's harness
  // does — so these back the account section's gg tab and the new-run form's
  // configuration picker. Optional for the same reason the coverage calls are: the
  // static site's read-only transport omits them.
  /** The operator's saved gg configurations (`GET /gg/configs`). */
  listGgConfigs?(token: string): Promise<GgConfig[]>;
  /**
   * Register a configuration (`POST /gg/configs`), returning it with its new id.
   */
  createGgConfig?(input: GgConfigInput, token: string): Promise<GgConfig>;
  /** Update a configuration in place (`PUT /gg/configs/{id}`). */
  updateGgConfig?(
    id: string,
    input: GgConfigInput,
    token: string,
  ): Promise<GgConfig>;
  /** Delete a configuration (`DELETE /gg/configs/{id}`). */
  deleteGgConfig?(id: string, token: string): Promise<void>;

  // The gg **analysis** query surface (console-only, Bearer). The corpus is *not*
  // account-scoped — a gg run belongs to the deployment, exactly as the run listings
  // and the coverage matrix already treat runs — so the token gates reaching the
  // surface rather than filtering what it returns. Optional like the calls above:
  // the static site's read-only transport omits them and will answer the same two
  // questions from a shipped snapshot with the mirrored browser evaluator instead.
  /**
   * Evaluate one TCQ query over every recorded gg run (`POST /gg/query`).
   *
   * The **compiled** query is the wire form: the client parses and compiles the
   * source text, so the server needs neither a parser nor a clock (a relative
   * `now-30d` is already absolute milliseconds by the time it is sent).
   */
  runGgQuery?(query: GgQuery, token: string): Promise<GgQueryResponse>;
  /**
   * Evaluate a whole dashboard's worth of queries against **one** read of the
   * document index (`POST /gg/query/batch`), results in request order.
   *
   * A board is one request, not one per panel. The panels of a board almost always
   * share a filter and differ only in their aggregation, so answering them
   * separately re-scans the same corpus N times — and because the index refreshes on
   * a timer, two panels of the same board can come back from two different corpora,
   * which reads as a data bug rather than as a stale cache.
   */
  runGgQueryBatch?(
    batch: GgQueryBatch,
    token: string,
  ): Promise<GgQueryBatchResponse>;
  /**
   * The corpus's field catalog (`GET /gg/fields`): every dotted field, its kind, its
   * **document count** and its top values.
   *
   * What makes the language discoverable at all — the sidebar and the completer both
   * read it, and the document count is what makes a deliberately sparse `tool.*`
   * field visible *before* a query returns nothing rather than after.
   */
  getGgFields?(token: string): Promise<GgFieldCatalog>;

  // The operator's saved **views** over that corpus (console-only, Bearer). The
  // asymmetry is the model: the corpus is deployment-wide, a view over it is
  // personal — so these carry the token as an owner filter while the query calls
  // above carry it only as a gate. Both store query **source text**, so a relative
  // `now-30d` re-resolves on every run and a later grammar addition never
  // invalidates something already saved.
  /** The operator's saved queries (`GET /gg/saved-queries`). */
  listGgSavedQueries?(token: string): Promise<GgSavedQuery[]>;
  /** Save a query (`POST /gg/saved-queries`), returning it with its new id. */
  createGgSavedQuery?(
    input: GgSavedQueryInput,
    token: string,
  ): Promise<GgSavedQuery>;
  /** Update a saved query in place (`PUT /gg/saved-queries/{id}`). */
  updateGgSavedQuery?(
    id: string,
    input: GgSavedQueryInput,
    token: string,
  ): Promise<GgSavedQuery>;
  /** Delete a saved query (`DELETE /gg/saved-queries/{id}`). */
  deleteGgSavedQuery?(id: string, token: string): Promise<void>;
  /** The operator's dashboards (`GET /gg/dashboards`). */
  listGgDashboards?(token: string): Promise<GgDashboard[]>;
  /**
   * One dashboard by id (`GET /gg/dashboards/{id}`), so a board is deep-linkable
   * without loading every board the account owns.
   */
  getGgDashboard?(id: string, token: string): Promise<GgDashboard>;
  /** Create a dashboard (`POST /gg/dashboards`), returning it with its new id. */
  createGgDashboard?(
    input: GgDashboardInput,
    token: string,
  ): Promise<GgDashboard>;
  /** Update a dashboard in place (`PUT /gg/dashboards/{id}`). */
  updateGgDashboard?(
    id: string,
    input: GgDashboardInput,
    token: string,
  ): Promise<GgDashboard>;
  /** Delete a dashboard (`DELETE /gg/dashboards/{id}`). */
  deleteGgDashboard?(id: string, token: string): Promise<void>;

  /**
   * gg's model-facing **reference** (`GET /gg/reference`): every tool's description
   * and parameter schema exactly as they go on the wire, and every
   * responses-as-code function's signature, documentation and referenced types,
   * grouped into gg's own families.
   *
   * The one `/gg` read that takes **no token** — the document is static, identical
   * for every caller and carries no account or run data, so it is documentation of
   * the harness rather than anything of the operator's. Optional like the calls
   * above only because the static site's read-only transport has no backend behind
   * it at all; where a backend exists this always resolves.
   */
  ggReference?(): Promise<GgReference>;

  // The operator's saved harness/gg-config/model comparisons (console-only,
  // Bearer) — the A/B-testing capability that fixes every controlled variable and
  // varies exactly one dimension (the harness, a gg configuration, or the model)
  // across a set of arms (docs/comparisons/experiments.md). Per-account, like the
  // coverage plans and gg configurations above, and optional for the same reason:
  // the static site's read-only transport omits them (a published comparison is
  // read there off the snapshot, never this live endpoint).
  /** The operator's saved comparisons, each fully aggregated (`GET /comparisons`). */
  listComparisons?(token: string): Promise<Comparison[]>;
  /** One comparison by id, fully aggregated (`GET /comparisons/{id}`). */
  getComparison?(id: string, token: string): Promise<Comparison>;
  /** Create a comparison (`POST /comparisons`), returning it with its new id. */
  createComparison?(input: ComparisonInput, token: string): Promise<Comparison>;
  /** Update a comparison's controls/arms/`N` in place (`PUT /comparisons/{id}`). */
  updateComparison?(
    id: string,
    input: ComparisonInput,
    token: string,
  ): Promise<Comparison>;
  /** Delete a comparison (`DELETE /comparisons/{id}`). */
  deleteComparison?(id: string, token: string): Promise<void>;
  /**
   * Publish a comparison to the public site (`POST /comparisons/{id}/publish`,
   * `crates/backend/src/api/comparisons.rs::publish_comparison`). Marks the
   * comparison published (the next snapshot folds it in) and best-effort
   * enqueues one ordinary publish job per publishable arm run — publishing a run
   * is a real pod/repo/deploy, so this is never a bulk flag flip (see
   * docs/comparisons/publishing.md). Resolves the outcome: which run ids were
   * enqueued and which were skipped (with why) — a partially-published
   * comparison must never read as if every run is inspectable. This response
   * shape is backend-internal (hand-typed here, not part of the generated
   * `@test-cabinet/run-record` contract, since the Rust type derives only
   * `Serialize`) — mirrors how `PublishStreamLine` below is hand-typed for the
   * same reason. The comparison itself is *not* returned; re-fetch (or
   * optimistically flip `published`) to see the updated record.
   */
  publishComparison?(
    id: string,
    token: string,
  ): Promise<ComparisonPublishOutcome>;

  /**
   * The signed-in account's own submitted reviews, newest-first, with a numbered
   * pager (`GET /account/reviews`). Backs the account page's Reviews tab; each entry
   * pairs a reviewed run's summary card with this account's review of it.
   */
  listMyReviews?(
    opts: { limit?: number; offset?: number } | undefined,
    token: string,
  ): Promise<MyReviewsPage>;

  /**
   * Aggregate breakdowns of the signed-in account's recent reviews
   * (`GET /account/review-stats`): reviews per test case, per model, and per rating
   * given. Backs the account page's Profile-tab charts.
   */
  getReviewStats?(token: string): Promise<ReviewStats>;
}

// Handlers for a live run subscription.
export interface RunSubscription {
  onEvent: (event: HarnessEvent) => void;
  onDone: (outcome: RunOutcome) => void;
  // An asset-generation run streams live drawing frames here as the model works,
  // so a viewer can watch the sprite take shape; other run types never call it.
  onPreview?: (preview: AssetPreview) => void;
  onError?: (error: unknown) => void;
}

// Handlers for the worker-wide notification subscription. `onNotification` fires
// once per run completion across the whole worker; `onError` reports a transport
// fault (the web `EventSource` reconnects on its own afterward); `onOpen` fires
// each time the channel (re)connects. The feed is live-only (no backlog), so a
// completion that fired during a gap is never replayed — `onOpen` lets the console
// reconcile against the active list on every (re)connect to recover it.
export interface NotificationSubscription {
  onNotification: (notification: RunNotification) => void;
  onError?: (error: unknown) => void;
  onOpen?: () => void;
}

// One entry of a batch launch's result (`WorkerClient.launchRunBatch`), aligned by
// index to the submitted configs. Exactly one of `runId` (accepted; the enqueued
// job's id, what a caller tracks the in-flight run under) or `error` (rejected;
// why) is set.
export interface BatchLaunchResult {
  runId?: string;
  error?: string;
}

// A worker: a runner that executes a test case and produces a run record. It
// owns run jobs and publishing; it does NOT serve the catalog. Mirrors the
// worker HTTP API (components/worker/overview.md). In Tauri the "local worker"
// is the embedded core behind this same interface.
export interface WorkerClient {
  /**
   * The worker's identity, including the backend it is bound to, for the
   * backend-consistency check. Best-effort — resolves `backendId: null` when the
   * worker exposes no info endpoint.
   */
  identity(): Promise<WorkerIdentity>;

  /**
   * Submit a run; resolves to the job id (`POST /jobs`, Bearer). The backend
   * attributes the enqueued run to the launching account, so a signed-in
   * account's `token` is required on the service-driven path (the embedded
   * in-process worker ignores it). A missing/invalid token is rejected `401`.
   */
  launchRun(config: LaunchConfig, token?: string | null): Promise<string>;

  /**
   * Submit many runs in one request (`POST /jobs/batch`, Bearer) — the batch
   * analogue of {@link WorkerClient.launchRun}. Resolves to one result per config,
   * aligned by index: `{ runId }` for an accepted run or `{ error }` for a rejected
   * one, so a single bad config never fails the whole batch. Same account gate as
   * `launchRun`. This is how a fan-out of runs (the coverage matrix's still-missing
   * runs, the new-run form's combinations) is enqueued in a single round-trip
   * instead of one request per run.
   */
  launchRunBatch(
    configs: LaunchConfig[],
    token?: string | null,
  ): Promise<BatchLaunchResult[]>;

  /**
   * Launch a **gg** run; resolves to the enqueue ack (`POST /gg/runs`, Bearer).
   * gg is its own run mode — configured by a {@link GgRunRequest.capabilitySet}
   * (which capabilities are on, their implementations/params, and the model-slot
   * bindings) rather than a `(harness, model, orchestrator)` tuple — so it does
   * not go through {@link launchRun}. The backend gates it on the same signed-in
   * account as `POST /jobs` (a missing/invalid `token` is rejected `401`) and
   * requires the capability set to bind a model to the `primary` slot. The ack's
   * `jobId` is what the console tracks the in-flight run under and streams live
   * from the existing `GET /jobs/{id}/live` relay — gg needs no new live route.
   */
  launchGgRun(req: GgRunRequest, token: string): Promise<LaunchAck>;

  /** The current state of a submitted job (`GET /runs/{job}`). */
  getRun(runId: string): Promise<RunJob>;

  /**
   * Subscribe to a run's live events (`GET /runs/{job}/events`). Returns an
   * unsubscribe function. Replays events so far, then streams new ones until the
   * run reaches a terminal state.
   */
  subscribeToRun(runId: string, handlers: RunSubscription): () => void;

  /**
   * The runs this worker is currently executing (`GET /runs/active`), each by its
   * launch identity. The console seeds its in-progress list from this so a run it
   * is watching survives a page reload. A worker that can't enumerate them
   * resolves an empty list.
   */
  listActiveRuns(): Promise<InProgressRun[]>;

  /**
   * Subscribe to the worker-wide run-completion stream (`GET /notifications`),
   * for raising completion alerts without polling or a per-run subscription.
   * Returns an unsubscribe function. The stream is live-only — it does not replay
   * completions that happened before connecting.
   */
  subscribeToNotifications(handlers: NotificationSubscription): () => void;

  /**
   * Finished runs this worker produced that are awaiting review/publish. May
   * throw {@link NotSupportedError} where the transport can't enumerate them.
   */
  listRuns(): Promise<StoredRun[]>;

  /**
   * Finished runs this worker produced that are publishable failures
   * (catastrophic or timed-out), pending or already published.
   * These never enter
   * the review worklist {@link listRuns} returns, so the console fetches them
   * separately to keep them visible and offer the Publish-failures affordance.
   * May throw {@link NotSupportedError} where the transport can't enumerate them.
   */
  listFailures(): Promise<StoredRun[]>;

  /** One produced run by id. */
  readRun(id: string): Promise<StoredRun>;

  /**
   * A produced run's recorded event streams from the worker's output directory:
   * the normalized stream (`GET /runs/{id}/events.jsonl`) and the raw harness
   * output (`GET /runs/{id}/raw.jsonl`). Both back the run-detail Events tab for
   * a finished run; `raw` is null only when the worker has no raw log on disk.
   * `onProgress`, when given, reports the transfer of the (primary) normalized
   * stream as it downloads.
   */
  readRunEvents(
    id: string,
    onProgress?: ProgressCallback,
  ): Promise<RunEventStreams>;

  // --- Accounts (the worker proxies the standalone auth service) ---

  /**
   * Register a new account (`POST /auth/register`) and resolve a bearer token
   * plus the created account. The token authorizes the mutating run-lifecycle
   * calls below.
   */
  register(
    username: string,
    password: string,
    displayName: string,
  ): Promise<AuthResult>;

  /**
   * Log in (`POST /auth/login`) and resolve a bearer token plus the account it
   * belongs to.
   */
  login(username: string, password: string): Promise<AuthResult>;

  /**
   * Set or replace the signed-in account's profile picture (`PUT
   * /auth/profile/picture`, Bearer): `picture` is the already-downscaled image blob
   * and its `type` names the content type. Resolves the updated account (with a
   * fresh avatar URL). Optional: a transport that cannot set a picture omits it, and
   * the profile page hides the control.
   */
  setProfilePicture?(picture: Blob, token: string): Promise<Account>;

  /**
   * Clear the signed-in account's profile picture (`DELETE /auth/profile/picture`,
   * Bearer). Resolves the updated (picture-less) account. Optional, like
   * {@link setProfilePicture}.
   */
  removeProfilePicture?(token: string): Promise<Account>;

  // --- Run lifecycle: review -> publish ---
  //
  // A produced run's record is pushed to the backend by the driver when the run
  // finishes, so it is already stored and reviewable by the time a console sees
  // it; there is no console-driven push step.

  /**
   * Submit a review against a run (`POST /review`, Bearer), attributed to the
   * token's account. Multiple reviews are allowed — one per account; submitting
   * again from the same account replaces that account's review.
   */
  submitReview(
    id: string,
    review: ReviewDocumentInput,
    token: string,
  ): Promise<void>;

  /**
   * Publish a run (`POST /publish`, Bearer): **enqueue** the release and observe it
   * to completion. Publishing is asynchronous — the backend gates the run (it
   * refuses one carrying zero reviews, or an infrastructure failure), enqueues a
   * per-publish job, and the gh/wrangler release runs in a `tcab-publisher` Job. The
   * transport subscribes to the live stream and resolves with the terminal
   * {@link PublishResult} once the run is published (rejecting with the publisher's
   * reason on failure). `onProgress`, when given, is called with each progress line
   * as the release advances so the console can show live "Publishing…" status.
   */
  publish(
    id: string,
    token: string,
    onProgress?: (progress: PublishProgress) => void,
  ): Promise<PublishResult>;

  /**
   * Permanently delete a produced run (`DELETE /runs/{id}`, Bearer): remove its
   * record, its reviews, and its stored media. The backend **refuses a published
   * run** (`422`) — a public run is in the gallery and snapshot and cannot be
   * deleted — so this only applies to a run that has not been published. Optional:
   * a transport that cannot delete simply omits it, and the console hides the
   * delete affordance where it is absent.
   */
  deleteRun?(id: string, token: string): Promise<void>;

  /**
   * Kill an in-flight run (`POST /jobs/{id}/cancel`, Bearer): the backend moves it
   * to the terminal `canceled` state and closes its live stream, and the driver
   * tears its sandbox down and exits. The backend **refuses a run that already
   * finished** (`409`), so this only applies to a run still queued, dispatched, or
   * running. Optional: a transport that cannot cancel simply omits it, and the
   * console hides the kill affordance where it is absent.
   */
  killRun?(id: string, token: string): Promise<void>;

  /**
   * The URL to load one of a produced run's proof-of-implementation media files
   * (`<proof-id>.<ext>`) from, or null when this worker cannot serve it. Optional:
   * a worker reachable over HTTP needs no override — the gallery resolves the file
   * against the worker's base URL — but the built-in Tauri worker has no HTTP base,
   * so it implements this to return its custom proof URI scheme.
   */
  proofMediaUrl?(runId: string, file: string): string | null;
  /**
   * The URL to load one of an asset-generation run's media files — a single
   * sprite's `regenerated.png`/`preview.png`/`target.png`/`actions.json` or a
   * sprite sheet's per-frame `regenerated-<index>.png` (etc.) — or null when this
   * worker cannot serve it. Optional, mirroring
   * {@link proofMediaUrl}: the Tauri worker implements it to return its custom
   * `tcab-asset://` scheme.
   */
  assetMediaUrl?(runId: string, file: string): string | null;
  /**
   * The URL to load one of a run's automated-validation media files — a debug
   * script's synthesized `<item>__<output>.<ext>` (the model's build) or
   * `<item>__<output>.baseline.<ext>` (the reference implementation) — or null
   * when this worker cannot serve it. Optional, mirroring {@link proofMediaUrl}
   * and {@link assetMediaUrl}: a worker reachable over HTTP needs no override.
   */
  validationMediaUrl?(runId: string, file: string): string | null;
  /**
   * The URL to download a run's entire produced tree from as one gzip tar, or null
   * when this worker cannot serve it. Unlike the media resolvers above this is not
   * loaded into the page — it is handed to a download link, so the reviewer gets
   * the whole run (source, build, media, logs) in a single transfer instead of
   * driving `scripts/extract-cluster-assets.sh`, which can only move it through a
   * deployed cluster in ~320 KiB base64 chunks. Optional, mirroring
   * {@link proofMediaUrl}: a host that cannot serve the tree omits it and the
   * console offers no download.
   */
  runArchiveUrl?(runId: string): string | null;
}

// The reviewer's input when saving a review.
export interface ReviewDocumentInput {
  // The reviewer's rating for each of the case's scoring domains.
  ratings: DomainRating[];
  writeup: string;
  checklist: ReviewVerdict[];
  // A note explaining what changed, required when this submission edits an existing
  // review (a first submission needs none). The backend enforces it — it alone knows
  // whether a prior review exists and whether the content actually changed.
  editNote?: string;
}
