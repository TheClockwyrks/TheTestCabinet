// Shared data shapes for the runner/reporter console, independent of transport.
// The HTTP transport (apps/web) and the Tauri transport (apps/desktop, a later
// item) both produce and consume these. Fields are camelCase to match both the
// backend HTTP API and the run-record contract.
import type { RunRecord } from "@test-cabinet/run-record";
import type { Rating, ReviewVerdict, VerdictStatus } from "../ratings";

export type { Rating, ReviewVerdict, VerdictStatus };

// --- Catalog (served by the backend) ---

export interface HarnessInfo {
  slug: string;
  displayName: string;
}

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

export interface VariantInfo {
  slug: string;
  name: string;
  description: string | null;
}

export interface VersionInfo {
  slug: string;
  version: string;
  name: string;
  difficulty: string;
  tags: string[];
  summary: string | null;
  variants: VariantInfo[];
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

// A reviewer checklist item a test case declares (its stable id and the prose a
// reviewer reads). Surfaced so the reviewer works through every major item.
export interface ReviewItem {
  id: string;
  text: string;
}

export interface ReviewDocument {
  rating: Rating;
  writeup: string;
  checklist: ReviewVerdict[];
}

// A finished run held by a runner (a worker, or the local core in Tauri),
// awaiting review and/or publishing.
export interface StoredRun {
  id: string;
  record: RunRecord;
  review: ReviewDocument | null;
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
