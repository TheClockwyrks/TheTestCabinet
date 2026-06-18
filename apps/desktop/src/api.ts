// Typed wrappers over the Tauri commands the desktop shell's core exposes.
//
// Each function mirrors a `#[tauri::command]` in `crates/desktop`. The shapes
// here match the serde DTOs those commands return (camelCase). Tauri's `invoke`
// is imported lazily so the bundle still loads in a plain browser (where the
// commands are absent) for development; `isTauri` gates the calls.
import type { RunRecord } from "@test-cabinet/run-record";

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

export type Rating = "flawless" | "great" | "scuffed" | "broken";

export interface ReviewDocument {
  rating: Rating;
  writeup: string;
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

export type RunOutcome =
  | { kind: "completed"; record: RunRecord }
  | { kind: "failed"; message: string };

// --- Commands ---

export const appVersion = () => invoke<string>("app_version");
export const backendConfigured = () => invoke<boolean>("backend_configured");
export const listHarnesses = () => invoke<HarnessInfo[]>("list_harnesses");
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
export const listRuns = () => invoke<StoredRun[]>("list_runs");
export const readRun = (id: string) => invoke<StoredRun>("read_run", { id });
export const saveReview = (id: string, rating: Rating, writeup: string) =>
  invoke<void>("save_review", { id, rating, writeup });
export const publishRun = (id: string) =>
  invoke<PublishResult>("publish_run", { id });

export const eventChannel = (runId: string) => `run://${runId}/event`;
export const doneChannel = (runId: string) => `run://${runId}/done`;
