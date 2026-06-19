// Typed wrappers over the Tauri commands the desktop shell's core exposes.
//
// Each function mirrors a `#[tauri::command]` in `crates/desktop`. The shapes
// here match the serde DTOs those commands return (camelCase). Tauri's `invoke`
// is imported lazily so the bundle still loads in a plain browser (where the
// commands are absent) for development; `isTauri` gates the calls.
import type { RunRecord } from "@test-cabinet/run-record";
import type { InProgressRun, RunNotification } from "@test-cabinet/ui/client";

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
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

// A rendered reference screenshot for a variant, resolved to a URL the webview
// can load (the backend's reference endpoint).
export interface ReferenceShot {
  view: string;
  kind: "image" | "video";
  url: string;
}

export interface VariantInfo {
  slug: string;
  name: string;
  description: string | null;
  // The variant's prompt, rendered as a real run receives it.
  prompt: string;
  // Rendered reference screenshots (common first, then the variant's own), or
  // empty for a locally-resolved checkout with no backend to serve baselines.
  references: ReferenceShot[];
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

export type Rating = "flawless" | "great" | "scuffed" | "broken";

export type VerdictStatus = "pass" | "fail" | "na";

// A reviewer checklist item a test case declares (its stable id, a short title,
// and the prose a reviewer reads). Surfaced so the reviewer works through every
// major item. The UI prefixes a synthesized number to the title at display time.
export interface ReviewItem {
  id: string;
  title: string;
  text: string;
  reference?: string | null;
  proof?: string | null;
}

// A reviewer's verdict on one declared checklist item. `note` is omitted when
// the reviewer left none.
export interface ReviewVerdict {
  id: string;
  status: VerdictStatus;
  note?: string;
}

export interface ReviewDocument {
  rating: Rating;
  writeup: string;
  checklist: ReviewVerdict[];
}

export interface StoredRun {
  id: string;
  record: RunRecord;
  review: ReviewDocument | null;
}

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
// `type` discriminator and its fields are inlined; we keep it loose here since
// the UI renders the feed generically.
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

export interface LiveEvent {
  runId: string;
  event: HarnessEvent;
}

// One line of recorded raw harness output (the `read_run_events` command's
// `raw` entries), matching the core `RawOutputLine` serde shape.
export interface RawOutputLine {
  stream: "stdout" | "stderr";
  line: string;
}

// A finished run's recorded event streams, returned by `read_run_events`.
export interface RunEventStreams {
  events: HarnessEvent[];
  raw: RawOutputLine[];
}

export type RunOutcome =
  | { kind: "completed"; record: RunRecord }
  | { kind: "failed"; message: string };

// --- Commands ---

export const appVersion = () => invoke<string>("app_version");
export const backendConfigured = () => invoke<boolean>("backend_configured");
export const listModels = () => invoke<Model[]>("list_models");
export const listTestCases = () => invoke<TestCase[]>("list_test_cases");
export const listVersions = (slug: string) =>
  invoke<string[]>("list_versions", { slug });
export const resolveVersion = (slug: string, version: string) =>
  invoke<VersionInfo>("resolve_version", { slug, version });
export const readSpecs = (slug: string, version: string, variant: string) =>
  invoke<Specification>("read_specs", { slug, version, variant });
export const launchRun = (config: LaunchConfig) =>
  invoke<string>("launch_run", { config });
// The runs the shell is currently executing, by launch identity — the desktop
// equivalent of the worker's `GET /runs/active`. The DTO matches `InProgressRun`.
export const listActiveRuns = () =>
  invoke<InProgressRun[]>("list_active_runs");
export const listRuns = () => invoke<StoredRun[]>("list_runs");
export const readRun = (id: string) => invoke<StoredRun>("read_run", { id });
export const readRunEvents = (id: string) =>
  invoke<RunEventStreams>("read_run_events", { id });

// One page of published runs served by the backend (the read side), as the
// `BackendClient` consumes it.
export interface RunPage {
  runs: StoredRun[];
  nextCursor: string | null;
}

export const listPublishedRuns = (opts?: { before?: string; limit?: number }) =>
  invoke<RunPage>("list_published_runs", {
    before: opts?.before ?? null,
    limit: opts?.limit ?? null,
  });
export const readPublishedRun = (id: string) =>
  invoke<StoredRun>("read_published_run", { id });
export const readReviewItems = (slug: string, version: string, variant: string) =>
  invoke<ReviewItem[]>("read_review_items", { slug, version, variant });
export const saveReview = (
  id: string,
  rating: Rating,
  writeup: string,
  checklist: ReviewVerdict[],
) => invoke<void>("save_review", { id, rating, writeup, checklist });
export const publishRun = (id: string) =>
  invoke<PublishResult>("publish_run", { id });

export const eventChannel = (runId: string) => `run://${runId}/event`;
export const doneChannel = (runId: string) => `run://${runId}/done`;

// The worker-wide run-completion channel (a single global event, not per-run) the
// shell emits on each run finishing — mirrors `crates/desktop`'s `NOTIFY_CHANNEL`.
export const notifyChannel = "notifications://run";
// Re-exported so the worker transport can type the listener payload.
export type { RunNotification };
