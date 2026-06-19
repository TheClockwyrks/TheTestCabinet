// The run record is the central data contract for The Test Cabinet. It has an
// identical shape in Rust (test_cabinet_core) and here in TypeScript. JSON uses
// camelCase. Do NOT change this shape without updating the Rust definition and
// the JSON Schema in this package's `schema/` directory in lockstep.

/**
 * The set of agent harnesses a run can be attributed to. Serialized as the
 * lowercase slug (e.g. `"claude"`, `"opencode"`).
 */
export type HarnessSlug =
  | "claude"
  | "codex"
  | "cline"
  | "antigravity"
  | "goose"
  | "kilo"
  | "opencode"
  | "pi";

/** Lifecycle outcome of a run. */
export type RunState = "completed" | "failed" | "unevaluable";

/**
 * The container environment a run executed in. Sourced from inside the run
 * container, not the host. Probes are best-effort with sensible fallbacks.
 */
export interface RunEnvironment {
  /** Container OS, from `/etc/os-release` PRETTY_NAME; `"unknown"` on failure. */
  os: string;
  /**
   * The run-container image — the single shared base image, the same for every
   * harness — pinned to its registry digest where it has one,
   * e.g. `"ghcr.io/theclockwyrks/test-cabinet-base@sha256:…"`.
   */
  containerImage: string;
  /** Trimmed `node --version` inside the container; null if undeterminable. */
  nodeVersion: string | null;
}

/**
 * Provenance for the Test Cabinet build that orchestrated a run. Distinct from
 * {@link RunSubject.harnessVersion}, which describes the agent harness: this
 * identifies the Test Cabinet orchestrator itself.
 */
export interface RunTooling {
  /**
   * The Test Cabinet commit the run's binary was built from, with a `-dirty`
   * suffix when built from a modified working tree. Null when the build could
   * not determine it.
   */
  testCabinetCommit: string | null;
}

/** Identifies what was run: the test case, the harness, and the model. */
export interface RunSubject {
  testCaseSlug: string;
  testCaseVersion: string;
  /** The variant of the test case that was run (e.g. `"base"`). */
  variant: string;
  harnessSlug: HarnessSlug;
  /** Null when the harness does not report a version. */
  harnessVersion: string | null;
  modelId: string;
}

/** Token counts, broken out by accounting category. All integers. */
export interface TokenMetrics {
  uncachedInput: number;
  cachedInput: number;
  output: number;
  reasoning: number;
}

/** Cost figures in USD. */
export interface CostMetrics {
  /** Normalized cost used for apples-to-apples comparison across providers. */
  comparable: number;
  /** Cost actually billed for this run. */
  actual: number;
}

/** Quantitative metrics captured for a run. */
export interface RunMetrics {
  runTimeSeconds: number;
  tokens: TokenMetrics;
  cost: CostMetrics;
}

/** The result of a single opt-in validation check. */
export interface CheckResult {
  view: string;
  /** Human-readable display name for the check (defaults derived from `view`). */
  name: string;
  /** Whether the implementation could be driven into the view and captured. */
  reached: boolean;
  /** Similarity signal in `0..=1` against the reference baseline. */
  similarity: number;
  /** Detail about a check that could not be completed. */
  detail: string | null;
}

/**
 * The outcome of a single required build step — dependency install or the static
 * build — that every run performs before the load check. Each is reported in its
 * own right rather than folded silently into the load signal.
 */
export interface StepResult {
  /** The command that was run (the manifest's `install` or `build` command). */
  command: string;
  /** Whether the command exited successfully. */
  succeeded: boolean;
  /** Detail about a failure, or null when the step succeeded. */
  detail: string | null;
}

/** Validation signals derived from running the produced artifact. */
export interface RunValidation {
  loaded: boolean;
  /** Detail about a fatal load failure, when one occurred. */
  detail: string | null;
  /**
   * Outcome of the required dependency-install step, or null if the build never
   * reached it (for example, no `package.json` was found).
   */
  install: StepResult | null;
  /**
   * Outcome of the required static-build step, or null if it was never reached
   * (the install failed, or there was no `package.json`).
   */
  build: StepResult | null;
  /** Per-check results for the checks the test case declares. */
  checks: CheckResult[];
}

/** Outbound links for a run. Either may be null when not published. */
export interface RunLinks {
  sourceRepo: string | null;
  playableBuild: string | null;
}

/** Final status of a run with optional human-readable detail. */
export interface RunStatus {
  state: RunState;
  detail: string | null;
}

/** The complete record for a single benchmark run. */
export interface RunRecord {
  id: string;
  /** RFC 3339 timestamp. */
  startedAt: string;
  /** RFC 3339 timestamp. */
  finishedAt: string;
  subject: RunSubject;
  tooling: RunTooling;
  environment: RunEnvironment;
  metrics: RunMetrics;
  validation: RunValidation;
  links: RunLinks;
  status: RunStatus;
}

/** Every valid {@link HarnessSlug}, in contract order. */
export const HARNESS_SLUGS: readonly HarnessSlug[] = [
  "claude",
  "codex",
  "cline",
  "antigravity",
  "goose",
  "kilo",
  "opencode",
  "pi",
];

/** Every valid {@link RunState}. */
export const RUN_STATES: readonly RunState[] = [
  "completed",
  "failed",
  "unevaluable",
];

/** Narrowing type guard for {@link HarnessSlug}. */
export function isHarnessSlug(value: string): value is HarnessSlug {
  return (HARNESS_SLUGS as readonly string[]).includes(value);
}

/** Narrowing type guard for {@link RunState}. */
export function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}
