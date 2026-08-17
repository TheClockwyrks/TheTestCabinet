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
  LaunchOrigin,
  LogoFetchResult,
  Model,
  ModelInput,
  ModelSeed,
  MyReviewsPage,
  ProgressCallback,
  PublishEnqueued,
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
import type { BulkCancelOut } from "@test-cabinet/run-record/jobs-api";
import type {
  CoverageGroup,
  CoverageGroupInput,
  CoverageMatrix,
  CoveragePlanInput,
  CoveragePlanOut,
  CoveragePlanSummary,
  CoverageQueue,
  CoverageSchedule,
  CoverageSettings,
  CoverageSettingsInput,
  HaltResult,
  TopUpResult,
} from "@test-cabinet/run-record/coverage";
import type {
  LadderClimberInput,
  LadderInput,
  LadderOut,
  LadderOverrideInput,
  LadderProgress,
  LadderRung,
  LadderRungOrderInput,
  LadderRungOutcome,
  LadderSchedule,
  StoredClimberOut,
} from "@test-cabinet/run-record/ladders";

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

// The backend: the canonical source of test-case definitions, container image
// references, and published results. Every runner and reporter resolves the
// catalog from here — never from a worker. Mirrors the backend HTTP API
// (components/backend/api.md).
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
   *   its presence selects this mode) with an optional `limit`, `state` (including
   *   `any`, the published + unpublished union the console listings draw from), the
   *   equality filters (`testCase`/`model`/`harness`/`variant`/`version`), the
   *   `latestVersions` current-version restriction, a free-text `q`, and
   *   `sort`/`dir`. Resolves the windowed summaries plus the `total` count of
   *   all matching rows (`nextCursor` is `null`).
   */
  listRunSummaries(opts?: {
    before?: string;
    limit?: number;
    offset?: number;
    state?: string;
    testCase?: string;
    model?: string;
    harness?: string;
    variant?: string;
    version?: string;
    latestVersions?: boolean;
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
  /**
   * The reviewer's coverage plans (`GET /coverage-plans`), each returned as a
   * {@link CoveragePlanOut} — the declaration with its schedule (`outerAxis`,
   * `paused`, `autoTopUp`, `bufferTarget`) flattened alongside, so a listing shows
   * how every plan is being fed without a request per plan.
   */
  listCoveragePlans?(token: string): Promise<CoveragePlanOut[]>;
  /** Create a plan (`POST /coverage-plans`), returning it with its new id. */
  createCoveragePlan?(
    input: CoveragePlanInput,
    token: string,
  ): Promise<CoveragePlanOut>;
  /**
   * Update a plan in place (`PUT /coverage-plans/{id}`). The body's `schedule` is
   * optional and omitting it leaves the schedule untouched — which is why saving an
   * edited member list can never un-pause a plan or reset its buffer target.
   */
  updateCoveragePlan?(
    id: string,
    input: CoveragePlanInput,
    token: string,
  ): Promise<CoveragePlanOut>;
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

  // The account-wide review-buffer setting (`GET`/`PUT /coverage-settings`, Bearer).
  // It lives on the account rather than on any one plan because it describes how much
  // unreviewed work the *reviewer* wants waiting on them; a plan or ladder that needs
  // a different depth overrides it in its own schedule.
  /** The account's review-buffer target, and whether it has ever been chosen. */
  getCoverageSettings?(token: string): Promise<CoverageSettings>;
  /** Store the account's review-buffer target; resolves the stored value. */
  setCoverageSettings?(
    input: CoverageSettingsInput,
    token: string,
  ): Promise<CoverageSettings>;

  // How a plan is **fed**, read and written apart from what it declares
  // (`GET`/`PUT /coverage-plans/{id}/schedule`, Bearer). Separate calls rather than
  // fields on the plan save, so the controls a reviewer reaches for while a plan is
  // running can never be clobbered by a member-list edit saved from another tab.
  /** One plan's schedule (`GET /coverage-plans/{id}/schedule`). */
  getCoveragePlanSchedule?(
    id: string,
    token: string,
  ): Promise<CoverageSchedule>;
  /** Replace one plan's schedule (`PUT /coverage-plans/{id}/schedule`). */
  setCoveragePlanSchedule?(
    id: string,
    schedule: CoverageSchedule,
    token: string,
  ): Promise<CoverageSchedule>;

  /**
   * Refill a plan's review buffer (`POST /coverage-plans/{id}/topup`, Bearer): the
   * server walks the plan's cells in its configured order, skips the ones already at
   * their (globally counted) target, and enqueues whole cells until this account has
   * `bufferTarget` runs outstanding — in flight, or finished and unreviewed by them.
   *
   * There is no background scheduler, so this call **is** the scheduler: the console
   * makes it when a plan is opened and after a review lands. It is idempotent (each
   * call recomputes the shortfall) and serialized server-side, so a double-click or a
   * second tab cannot double-enqueue — the loser reports
   * {@link TopUpResult.skipped} `"busy"` rather than failing.
   */
  topUpCoveragePlan?(id: string, token: string): Promise<TopUpResult>;

  /**
   * A plan's unreviewed-by-me runs **in the plan's own order**
   * (`GET /coverage-plans/{id}/queue`, Bearer) — not newest-first like the global
   * Unreviewed page. The buffer was filled deliberately (a cell's repeats arrive
   * together so they can be judged against each other), and reviewing it in arrival
   * order is the only thing that preserves that.
   */
  getCoveragePlanQueue?(id: string, token: string): Promise<CoverageQueue>;

  /**
   * Suspend or resume topping a plan up (`POST /coverage-plans/{id}/pause`, Bearer),
   * leaving everything already queued alone. The mildest of the three halting
   * controls, and the only one that throws nothing away. Takes the desired state
   * rather than toggling, so a console driving a switch needs no knowledge of which
   * direction it is going. Resolves the plan's updated schedule.
   */
  pauseCoveragePlan?(
    id: string,
    paused: boolean,
    token: string,
  ): Promise<CoverageSchedule>;

  /**
   * Pause a plan **and** cancel the jobs it launched that have not started
   * (`POST /coverage-plans/{id}/halt`, Bearer) — the `queued` and `pending` ones,
   * which have no driver and have spent nothing. The common "stop feeding me" action;
   * it reaches only jobs whose origin is this plan, so a run launched by hand is never
   * swept up. Resolves {@link HaltResult}, whose count the console must report: "the
   * queue was already empty" and "nothing of mine was found" call for opposite next
   * moves and are otherwise indistinguishable.
   */
  haltCoveragePlan?(id: string, token: string): Promise<HaltResult>;

  /**
   * Pause a plan and cancel **every** job it launched, including the ones already
   * dispatched, starting, or running (`POST /coverage-plans/{id}/halt-all`, Bearer).
   * These are partly or wholly paid for, so this is the rare control: the console must
   * confirm before calling it and must never offer it as the default.
   */
  haltAllCoveragePlan?(id: string, token: string): Promise<HaltResult>;

  // Ladders (console-only, Bearer). A ladder is a sibling of the plan, not a mode of
  // it: an ordered climb of pinned cases that each combination advances through on its
  // own, gated on that account's own reviews. Optional for the same reason the plan
  // calls are — a read-only transport omits them and the console hides the surface.
  /** The reviewer's ladders, each with its schedule (`GET /ladders`). */
  listLadders?(token: string): Promise<LadderOut[]>;
  /** One ladder's declaration and schedule (`GET /ladders/{id}`). */
  getLadder?(id: string, token: string): Promise<LadderOut>;
  /**
   * Create a ladder (`POST /ladders`), returning it with its new id and every rung's
   * minted id. Rejects a rung holding an automatically graded or graded-scale test
   * type, whose gate could never resolve.
   */
  createLadder?(input: LadderInput, token: string): Promise<LadderOut>;
  /**
   * Update a ladder's declaration in place (`PUT /ladders/{id}`). Rungs are matched on
   * their stable ids and **reconciled, never replaced** — a rung that is still present
   * keeps every climber's recorded verdicts through a reorder or a version bump, and
   * only a rung genuinely dropped from the climb takes its verdicts with it. As with a
   * plan, an omitted `schedule` leaves the schedule alone.
   */
  updateLadder?(
    id: string,
    input: LadderInput,
    token: string,
  ): Promise<LadderOut>;
  /**
   * Delete a ladder and its rungs, steering, and verdicts (`DELETE /ladders/{id}`).
   * Jobs it launched are deliberately left running — deleting the ladder you launched
   * from is not a reason to discard runs that already cost money — so halt first if
   * that is what was meant.
   */
  deleteLadder?(id: string, token: string): Promise<void>;
  /**
   * Reorder the climb without editing it (`POST /ladders/{id}/rungs/order`), by
   * sending every rung id in its new order. Ids rather than rungs, so a reorder cannot
   * edit a rung in passing and every recorded verdict stays attached to the case that
   * earned it. Resolves the rungs in their new order.
   */
  reorderLadderRungs?(
    id: string,
    input: LadderRungOrderInput,
    token: string,
  ): Promise<LadderRung[]>;

  /** One ladder's schedule (`GET /ladders/{id}/schedule`). */
  getLadderSchedule?(id: string, token: string): Promise<LadderSchedule>;
  /** Replace one ladder's schedule (`PUT /ladders/{id}/schedule`). */
  setLadderSchedule?(
    id: string,
    schedule: LadderSchedule,
    token: string,
  ): Promise<LadderSchedule>;

  /**
   * The ladder's board (`GET /ladders/{id}/progress`, Bearer): every climber's status,
   * the rung it stands on, and the evidence behind each verdict. Progress is held per
   * combination rather than as one ladder-wide pointer, so a model added to a standing
   * ladder starts at rung 1 while the others carry on.
   *
   * A pure read: a verdict the gate has resolved but nobody has written down yet is
   * computed live and flagged not-recorded. It is persisted by the next top-up, so
   * refreshing a dashboard is never itself part of the climb.
   */
  getLadderProgress?(id: string, token: string): Promise<LadderProgress>;

  /**
   * Refill a ladder's review buffer (`POST /ladders/{id}/topup`, Bearer), the ladder
   * analogue of {@link topUpCoveragePlan} and serialized the same way. It resolves
   * where every climber stands first (recording any verdict that has become decidable)
   * and then enqueues only the rung each one is *currently* on — which is what makes a
   * ladder a climb rather than a sweep.
   */
  topUpLadder?(id: string, token: string): Promise<TopUpResult>;

  /**
   * A ladder's unreviewed-by-me runs in the ladder's own order
   * (`GET /ladders/{id}/queue`, Bearer). Order matters more here than anywhere: a
   * rung's repeats arrive together to be judged against each other, and whether a
   * climber is walled is decided by the very next review.
   */
  getLadderQueue?(id: string, token: string): Promise<CoverageQueue>;

  /** Suspend or resume topping a ladder up (`POST /ladders/{id}/pause`, Bearer);
   * the ladder analogue of {@link pauseCoveragePlan}. */
  pauseLadder?(
    id: string,
    paused: boolean,
    token: string,
  ): Promise<LadderSchedule>;
  /** Pause a ladder and cancel the jobs it launched that have not started
   * (`POST /ladders/{id}/halt`, Bearer); the analogue of {@link haltCoveragePlan}. */
  haltLadder?(id: string, token: string): Promise<HaltResult>;
  /** Pause a ladder and cancel **every** job it launched, executing ones included
   * (`POST /ladders/{id}/halt-all`, Bearer). Confirm first; never the default. */
  haltAllLadder?(id: string, token: string): Promise<HaltResult>;

  /**
   * Set one combination's steering (`POST /ladders/{id}/climbers`, Bearer): its climb
   * priority, its focus flag, and whether it is held. Written whole because it is one
   * decision ("climb this one first and watch it"), and a partial update can leave a
   * combination focused but forgotten.
   *
   * This is the **downward** half of manual control: a hold stops the climber where it
   * stands without pretending a rung was decided, so clearing it resumes from exactly
   * where the climb left off.
   */
  setLadderClimber?(
    id: string,
    input: LadderClimberInput,
    token: string,
  ): Promise<StoredClimberOut>;

  /**
   * Apply or clear a manual override of one recorded verdict
   * (`POST /ladders/{id}/outcomes`, Bearer) — promote a climber past a rung its runs
   * failed, wall one its runs passed, or take either back by sending a null outcome.
   *
   * The **upward** half of manual control, and deliberately an override stored *beside*
   * the automatic verdict rather than a rewrite of it: a later recompute can never
   * silently undo it, and clearing it restores exactly what the gate says.
   */
  setLadderOutcome?(
    id: string,
    input: LadderOverrideInput,
    token: string,
  ): Promise<LadderRungOutcome>;

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
   *
   * `origin` names the coverage plan or ladder this run is being launched *on behalf
   * of* ({@link LaunchOrigin}). It is what puts the run inside that plan's or
   * ladder's halt scope, so a per-cell "run these now" button must send it and a
   * hand-launch from the run form must not. The backend rejects an unparseable origin
   * `400` rather than dropping it — a run enqueued under a typo is one no halt would
   * ever reach, and that surfaces much later as "this plan will not stop".
   */
  launchRun(
    config: LaunchConfig,
    token?: string | null,
    origin?: LaunchOrigin | null,
  ): Promise<string>;

  /**
   * Submit many runs in one request (`POST /jobs/batch`, Bearer) — the batch
   * analogue of {@link WorkerClient.launchRun}. Resolves to one result per config,
   * aligned by index: `{ runId }` for an accepted run or `{ error }` for a rejected
   * one, so a single bad config never fails the whole batch. Same account gate as
   * `launchRun`. This is how a fan-out of runs (the coverage matrix's still-missing
   * runs, the new-run form's combinations) is enqueued in a single round-trip
   * instead of one request per run.
   *
   * `origin` attributes the **whole** batch, not a config within it, because a batch
   * is one decision by one plan, ladder, or person; a caller wanting two origins sends
   * two batches. That is also why it is a parameter here rather than a field on
   * {@link LaunchConfig}, which would let a single request carry configs disagreeing
   * about who launched them.
   */
  launchRunBatch(
    configs: LaunchConfig[],
    token?: string | null,
    origin?: LaunchOrigin | null,
  ): Promise<BatchLaunchResult[]>;

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
   * Enqueue a publish (`POST /runs/{id}/publish`, Bearer) and resolve as soon as
   * the backend has accepted it — the gate half of {@link publish} without the
   * wait for the release. It rejects on a refused gate (a run with no reviews, an
   * infrastructure failure) exactly as {@link publish} does, so a caller still
   * learns immediately that a run *cannot* be published; what it does not learn
   * is whether the release later succeeded.
   *
   * This is what a **batch** publish uses. Awaiting each release instead would
   * hold one live NDJSON stream open per selected run for minutes, and the whole
   * point of the batch is to hand the work off and move on — the backend's
   * `publish-failed` notification is what reports a release that did not land.
   */
  enqueuePublish(id: string, token: string): Promise<PublishEnqueued>;

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

  // The Runs page's three global stop controls. They are **global** — every job in
  // the named states, whoever launched it and whatever launched it — which is exactly
  // what makes them different from a plan's or ladder's scoped halt. Each resolves
  // {@link BulkCancelOut}; the console must report its `canceled` count rather than
  // just succeeding quietly, because "the queue was already empty" and "nothing
  // matched" demand opposite next moves and look identical otherwise. Optional, like
  // {@link killRun}: a transport that cannot cancel omits them and the controls are
  // hidden rather than failing when pressed.
  /**
   * "Clear pending": cancel every run that has not started — `queued` and `pending`
   * (`POST /jobs/cancel-waiting`, Bearer). These have no driver and have spent
   * nothing, so this discards no work and needs no confirmation.
   */
  cancelWaitingRuns?(token: string): Promise<BulkCancelOut>;
  /**
   * "Kill active": cancel every run that is already executing — `dispatched`,
   * `starting`, `running` (`POST /jobs/cancel-active`, Bearer). This throws away work
   * that is being paid for, so confirm first. It leaves the waiting queue alone, so
   * the dispatcher immediately starts claiming from it again — pair it with
   * {@link cancelWaitingRuns}, or use {@link cancelAllRuns}, to actually stop
   * everything.
   */
  cancelActiveRuns?(token: string): Promise<BulkCancelOut>;
  /**
   * "Stop all": both of the above in one atomic sweep (`POST /jobs/cancel-all`,
   * Bearer), so nothing queued can be claimed into execution between two separate
   * calls. Destructive; confirm first.
   */
  cancelAllRuns?(token: string): Promise<BulkCancelOut>;

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
