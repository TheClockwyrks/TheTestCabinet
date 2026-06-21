// Typed wrappers over the Tauri commands the desktop shell's core exposes.
//
// Each function mirrors a `#[tauri::command]` in `crates/desktop`. The shapes
// here match the serde DTOs those commands return (camelCase). Tauri's `invoke`
// is imported lazily so the bundle still loads in a plain browser (where the
// commands are absent) for development; `isTauri` gates the calls.
import type {
  ControllerRef,
  MatchSummary,
  RunRecord,
  TestType,
  TournamentRecord,
} from "@test-cabinet/run-record";
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
  // The reviewer checklist items for this variant (common first, then the
  // variant's own), carrying their point weights.
  reviewItems: ReviewItem[];
}

export interface VersionInfo {
  slug: string;
  version: string;
  name: string;
  difficulty: string;
  tags: string[];
  summary: string | null;
  // The case's test type. Drives type-specific UI affordances — notably the
  // run-launch orchestrator selector, offered only for "end-to-end".
  testType: TestType;
  variants: VariantInfo[];
  // The case's scoring domains (case-level).
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

export type Rating = "flawless" | "great" | "scuffed" | "broken";

export type VerdictStatus = "pass" | "fail";

// A reviewer's rating for one of the case's scoring domains.
export interface DomainRating {
  domain: string;
  rating: Rating;
}

// A scoring domain a case declares; rated independently, the run's overall rating
// is the worst across them.
export interface Domain {
  id: string;
  name: string;
  description: string;
}

// A reviewer checklist item a test case declares (its stable id, a short title,
// the prose a reviewer reads, and the points it is worth). Surfaced so the
// reviewer works through every major item. The UI prefixes a synthesized number
// to the title at display time.
export interface ReviewItem {
  id: string;
  title: string;
  text: string;
  reference?: string | null;
  proof?: string | null;
  weight: number;
  domain?: string | null;
}

// A reviewer's verdict on one declared checklist item. `note` is omitted when
// the reviewer left none.
export interface ReviewVerdict {
  id: string;
  status: VerdictStatus;
  note?: string;
}

export interface ReviewDocument {
  ratings: DomainRating[];
  writeup: string;
  checklist: ReviewVerdict[];
}

// One submitted review on a stored run, attributed to the account that wrote it.
export interface StoredReview extends ReviewDocument {
  reviewerId: string;
  reviewer: string;
  username?: string | null;
  reviewedAt?: string | null;
}

export interface StoredRun {
  id: string;
  record: RunRecord;
  reviews: StoredReview[];
  published: boolean;
}

// A user account, as the auth service returns it (the core proxies the call).
export interface Account {
  id: string;
  username: string;
  displayName: string;
}

// The auth `register`/`login` result: a bearer token plus its account.
export interface AuthResult {
  token: string;
  account: Account;
}

export interface LaunchConfig {
  testCase: string;
  version: string;
  variant: string;
  harness: string;
  modelId: string;
  // The built-in orchestrator slug that conducts the harness sessions. Defaults
  // to "one-shot"; a non-default orchestrator is accepted only for end-to-end.
  orchestrator: string;
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
  ratings: DomainRating[],
  writeup: string,
  checklist: ReviewVerdict[],
) => invoke<void>("save_review", { id, ratings, writeup, checklist });
// The desktop's solo publish: push + the locally-saved review + publish in one
// step, authorized by the signed-in account's bearer token.
export const publishRun = (id: string, token: string) =>
  invoke<PublishResult>("publish_run", { id, token });

// Account auth: the local core proxies the standalone auth service. Both resolve
// a bearer token plus the account.
export const register = (
  username: string,
  password: string,
  displayName: string,
) => invoke<AuthResult>("register", { username, password, displayName });
export const login = (username: string, password: string) =>
  invoke<AuthResult>("login", { username, password });

export const eventChannel = (runId: string) => `run://${runId}/event`;
export const doneChannel = (runId: string) => `run://${runId}/done`;
// One live asset-generation preview frame for a run — mirrors `crates/desktop`'s
// `preview_channel`. The payload is a bare `AssetPreview`.
export const previewChannel = (runId: string) => `run://${runId}/preview`;

// The worker-wide run-completion channel (a single global event, not per-run) the
// shell emits on each run finishing — mirrors `crates/desktop`'s `NOTIFY_CHANNEL`.
export const notifyChannel = "notifications://run";
// Re-exported so the worker transport can type the listener payload.
export type { RunNotification };

// --- Adversarial arena ------------------------------------------------------

// A quick (transient) head-to-head match configuration. The command arg is keyed
// `config`, matching `run_adversarial_match(config: MatchConfig)`.
export interface MatchConfig {
  testCase: string;
  version: string;
  red: ControllerRef;
  blue: ControllerRef;
}

// The quick match's result: the replay (for immediate playback) and the summary.
export interface MatchResult {
  replay: unknown | null;
  summary: MatchSummary;
}

// A tournament configuration, keyed `config` to match
// `run_tournament_match(app, config: TournamentConfig)`.
export interface TournamentConfig {
  testCase: string;
  version: string;
  variant: string;
  participants: ControllerRef[];
}

// One completed match emitted live on a tournament's progress channel.
export interface TournamentProgress {
  played: number;
  total: number;
  summary: MatchSummary;
}

// A tournament's terminal outcome, emitted on its done channel.
export type TournamentOutcome =
  | { kind: "completed"; record: TournamentRecord }
  | { kind: "failed"; message: string };

export const runAdversarialMatch = (config: MatchConfig) =>
  invoke<MatchResult>("run_adversarial_match", { config });
export const listAdversarialControllers = (slug: string, version: string) =>
  invoke<ControllerRef[]>("list_adversarial_controllers", { slug, version });
export const runTournamentMatch = (config: TournamentConfig) =>
  invoke<string>("run_tournament_match", { config });
export const listTournaments = () =>
  invoke<TournamentRecord[]>("list_tournaments");
export const readTournament = (id: string) =>
  invoke<TournamentRecord>("read_tournament", { id });

// A tournament's live per-match progress and terminal outcome channels — mirror
// `crates/desktop/src/arena.rs`'s `progress_channel`/`done_channel`.
export const tournamentProgressChannel = (id: string) =>
  `tournament://${id}/progress`;
export const tournamentDoneChannel = (id: string) => `tournament://${id}/done`;
