// The two service-client interfaces the console is written against. Each has a
// transport implementation per app:
//   - HTTP  (apps/web): `fetch` against the backend / worker REST APIs.
//   - Tauri (apps/desktop, a later item): `invoke` + Tauri events.
// The console never imports a transport; it only depends on these interfaces and
// reads them from context (see context.tsx).
import type {
  BackendIdentity,
  HarnessEvent,
  LaunchConfig,
  Model,
  PublishResult,
  Rating,
  ReviewItem,
  ReviewVerdict,
  RunJob,
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
}

// Handlers for a live run subscription.
export interface RunSubscription {
  onEvent: (event: HarnessEvent) => void;
  onDone: (outcome: RunOutcome) => void;
  onError?: (error: unknown) => void;
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

  /** Submit a run; resolves to the job id (`POST /runs`). */
  launchRun(config: LaunchConfig): Promise<string>;

  /** The current state of a submitted job (`GET /runs/{job}`). */
  getRun(runId: string): Promise<RunJob>;

  /**
   * Subscribe to a run's live events (`GET /runs/{job}/events`). Returns an
   * unsubscribe function. Replays events so far, then streams new ones until the
   * run reaches a terminal state.
   */
  subscribeToRun(runId: string, handlers: RunSubscription): () => void;

  /**
   * Finished runs this worker produced that are awaiting review/publish. May
   * throw {@link NotSupportedError} where the transport can't enumerate them.
   */
  listRuns(): Promise<StoredRun[]>;

  /** One produced run by id. */
  readRun(id: string): Promise<StoredRun>;

  /** The case-declared reviewer checklist items for a produced run. */
  readReviewItems(id: string): Promise<ReviewItem[]>;

  /** Save a review (writeup + rating + checklist verdicts) for a produced run. */
  saveReview(id: string, review: ReviewDocumentInput): Promise<void>;

  /**
   * Publish a run together with its review (`POST /publish`). The review is
   * supplied inline — a worker keeps no review store, so the rating, writeup and
   * checklist are sent with the run id. Idempotent on the run; resolves the
   * resulting public links.
   */
  publish(id: string, review: ReviewDocumentInput): Promise<PublishResult>;
}

// The reviewer's input when saving a review.
export interface ReviewDocumentInput {
  rating: Rating;
  writeup: string;
  checklist: ReviewVerdict[];
}
