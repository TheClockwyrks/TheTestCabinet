// Shared data shapes for the runner/reporter console, independent of transport.
// The HTTP transport (apps/web) and the Tauri transport (apps/desktop, a later
// item) both produce and consume these. Fields are camelCase to match both the
// backend HTTP API and the run-record contract.
import type { MediaKind, RunRecord } from "@test-cabinet/run-record";
import type {
  DomainRating,
  Rating,
  ReviewVerdict,
  VerdictStatus,
} from "../ratings";

export type { DomainRating, Rating, ReviewVerdict, VerdictStatus };
export type { MediaKind };

// --- Catalog (served by the backend) ---

export interface Model {
  slug: string;
  name: string;
  provider: string;
  openrouterSlug: string | null;
  descriptionPath: string | null;
  modelIds: string[];
}

export interface TestCase {
  slug: string;
  versions: string[];
}

// A reference for a view, resolved to an absolute media URL. A rendered mockup or
// static image is `kind: "image"`; a static reference clip is `kind: "video"`.
export interface ReferenceShot {
  view: string;
  kind: MediaKind;
  url: string;
}

// A run's submitted proof-of-implementation media for a declared proof, resolved
// to an absolute media URL. `present` mirrors the run's validation result; `url`
// is set only when the media is available to load.
export interface ProofMedia {
  id: string;
  name: string;
  kind: MediaKind;
  present: boolean;
  url: string | null;
}

export interface VariantInfo {
  slug: string;
  name: string;
  description: string | null;
  // The instruction handed to the harness (prompt.hbs rendered as a real run
  // receives it). The backend renders it for every variant.
  prompt: string;
  // Rendered reference screenshots for this variant (common first, then the
  // variant's own), resolved to loadable URLs. Empty when none are served.
  references: ReferenceShot[];
  // The reviewer checklist items for this variant (common first, then the
  // variant's own), carrying their point weights. Used to score runs.
  reviewItems: ReviewItem[];
}

export interface VersionInfo {
  slug: string;
  version: string;
  name: string;
  difficulty: string;
  tags: string[];
  summary: string | null;
  // The site-facing Markdown description, when the source carries it.
  description?: string | null;
  variants: VariantInfo[];
  // The case's scoring domains (case-level). A reviewer rates each independently;
  // a run's overall rating is the worst across them.
  domains: Domain[];
  maxRuntimeSeconds: number;
}

export interface SpecDocument {
  dest: string;
  body: string;
}

export interface Specification {
  slug: string;
  version: string;
  variant: string;
  description: string | null;
  specs: SpecDocument[];
}

// --- Reviews ---

// A reviewer checklist item a test case declares (its stable id, a short title,
// and the prose a reviewer reads). Surfaced so the reviewer works through every
// major item. The UI prefixes a synthesized number to the title at display time.
export interface ReviewItem {
  id: string;
  title: string;
  text: string;
  // Optional paired reference view shown as the "expected" target, and proof id
  // whose submitted media is shown as "submitted", for this item. Null when the
  // item declares no pairing.
  reference?: string | null;
  proof?: string | null;
  // Points this item is worth toward the run's score: a pass earns this weight, a
  // fail earns none.
  weight: number;
  // Optional scoring domain (by id) this item belongs to, or null/undefined for a
  // general item that belongs to no single domain.
  domain?: string | null;
}

// A scoring domain a test case declares; a reviewer rates each independently and
// the run's overall rating is the worst across them.
export interface Domain {
  id: string;
  name: string;
  description: string;
}

export interface ReviewDocument {
  // The reviewer's rating for each of the case's scoring domains. The run's
  // overall rating is the worst across them.
  ratings: DomainRating[];
  writeup: string;
  checklist: ReviewVerdict[];
}

// A finished run held by a runner (a worker, or the local core in Tauri),
// awaiting review and/or publishing. Also the shape the backend serves for a
// *published* run (`GET /runs/{id}`): its record (links populated) and review.
export interface StoredRun {
  id: string;
  record: RunRecord;
  review: ReviewDocument | null;
}

// One page of published runs from the backend (`GET /runs`), newest first.
// `nextCursor` is the `before` value to pass for the following page, or null
// when there are no more.
export interface RunPage {
  runs: StoredRun[];
  nextCursor: string | null;
}

// --- Run execution (driven against a worker) ---

export interface LaunchConfig {
  testCase: string;
  version: string;
  variant: string;
  harness: string;
  modelId: string;
  maxRuntimeOverride: number | null;
}

export interface PublishResult {
  sourceRepo: string;
  playableBuild: string | null;
  newlyPublished: boolean;
}

// A normalized harness event (the run-record contract's HarnessEvent shape). The
// `type` discriminator and its fields are inlined; the feed renders it
// generically.
export interface HarnessEvent {
  timestamp: string;
  sessionId?: string;
  type: string;
  message?: string;
  command?: string;
  path?: string;
  query?: string;
  raw?: unknown;
  [key: string]: unknown;
}

// One line of raw harness output, as recorded in a run's `raw.jsonl`. Mirrors
// the Rust `RawOutputLine` (crates/core/src/execution.rs). This is UI-only — it
// is not part of the run-record contract — and feeds the Events tab's raw view.
export interface RawOutputLine {
  stream: "stdout" | "stderr";
  line: string;
}

// A finished run's recorded event streams, for the run-detail Events tab. `events`
// is the normalized (TTC) stream the live feed renders. `raw` is the raw harness
// output it was mapped from, present only where a host can supply it (the runner
// hosts) and `null` where it isn't (the public site, which publishes TTC events
// only) — the tab hides the raw toggle whenever it is null.
export interface RunEventStreams {
  events: HarnessEvent[];
  raw: RawOutputLine[] | null;
}

// Transfer progress for a streamed download, reported as a recorded run's events
// load. `received` is the number of bytes read so far; `total` is the expected
// size from the response's `Content-Length`, or `null` when the server sends
// none (so the bar shows indeterminate progress rather than a false percentage).
export interface LoadProgress {
  received: number;
  total: number | null;
}

// A sink for {@link LoadProgress} ticks, passed into a streamed read so the
// caller can drive a progress bar. A transport that can't observe the transfer
// (e.g. Tauri IPC, which buffers the whole payload) simply never calls it.
export type ProgressCallback = (progress: LoadProgress) => void;

export type RunOutcome =
  | { kind: "completed"; record: RunRecord }
  | { kind: "failed"; message: string };

// The live state of a submitted run job.
export interface RunJob {
  runId: string;
  state: "running" | "completed" | "failed";
  record: RunRecord | null;
  message: string | null;
}

// A run a worker is currently executing, as `listActiveRuns` returns it (the web
// worker's `GET /runs/active`, the desktop `list_active_runs` command). A run only
// gains a RunRecord at completion, so an in-progress run is described by its launch
// identity instead. `state` is "running" off the wire; the console widens it to
// "failed" for a run it has locally observed fail before it dropped out of the
// list. This is the canonical shape; the gallery re-exports it as `InProgressRun`.
export interface InProgressRun {
  runId: string;
  testCaseSlug: string;
  variant: string;
  harnessSlug: string;
  modelId: string;
  state: "running" | "failed";
}

// A worker-wide run-completion notification, pushed to the console without
// polling (SSE over `GET /notifications` on web; a global Tauri event on desktop).
// Mirrors the worker's `WorkerNotification` / desktop `RunNotification` field for
// field, so both transports deserialize into this one type. `recordId` (the run to
// open) is present when `outcome` is "completed"; `message` (the reason) when
// "failed".
export interface RunNotification {
  kind: "run-completed";
  jobId: string;
  testCaseSlug: string;
  variant: string;
  harnessSlug: string;
  modelId: string;
  outcome: "completed" | "failed";
  recordId?: string | null;
  message?: string | null;
}

// --- Service identity (for the backend-consistency check) ---

// The backend a UI is pointed at, from `GET /healthz`. `id` identifies the
// backend instance so workers can be checked against it; it falls back to the
// normalized URL when the service reports none.
export interface BackendIdentity {
  id: string;
  url: string;
  version: string | null;
  storeReady: boolean;
}

// A worker's identity, including the backend it resolves definitions from and
// publishes to. Best-effort: the worker exposes no info endpoint yet, so this is
// often unavailable and the UI treats the worker's backend as unverified.
export interface WorkerIdentity {
  url: string;
  version: string | null;
  backendId: string | null;
}

// Whether a worker is bound to the same backend the UI is pointed at.
export type BackendMatch = "match" | "mismatch" | "unverified";
