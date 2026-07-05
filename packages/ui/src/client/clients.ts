// The two service-client interfaces the console is written against. Each has a
// transport implementation per app:
//   - HTTP  (apps/web): `fetch` against the backend / worker REST APIs.
//   - Tauri (apps/desktop, a later item): `invoke` + Tauri events.
// The console never imports a transport; it only depends on these interfaces and
// reads them from context (see context.tsx).
import type {
  AssetPreview,
  AuthResult,
  BackendIdentity,
  DomainRating,
  HarnessEvent,
  InProgressRun,
  LaunchConfig,
  Model,
  ProgressCallback,
  PublishProgress,
  PublishResult,
  ReviewItem,
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
  listModels(): Promise<Model[]>;
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
   * (catastrophic or timed-out), pending or already published. These never enter
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
}

// The reviewer's input when saving a review.
export interface ReviewDocumentInput {
  // The reviewer's rating for each of the case's scoring domains.
  ratings: DomainRating[];
  writeup: string;
  checklist: ReviewVerdict[];
}
