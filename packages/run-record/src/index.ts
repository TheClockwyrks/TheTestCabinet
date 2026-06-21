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
 * How a run authenticated its harness. `"apiKey"` is billed directly against the
 * provider key; `"subscription"` carries no per-run provider charge (a harness
 * may still report an exact charge, e.g. Claude Code does even on a
 * subscription). This is how a run's cost should be interpreted.
 */
export type AuthMode = "apiKey" | "subscription";

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
  /** Which authentication mode the run used; how its cost should be read. */
  authMode: AuthMode;
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

/**
 * The type of test case a run exercised. The result view branches on this to
 * choose how to present a run. Defaults to `"end-to-end"` for records written
 * before the discriminator existed.
 */
export type TestType = "end-to-end" | "asset-generation" | "adversarial";

/** Identifies what was run: the test case, the harness, and the model. */
export interface RunSubject {
  testCaseSlug: string;
  testCaseVersion: string;
  /** The test type this case belongs to. */
  testType: TestType;
  /** The variant of the test case that was run (e.g. `"base"`). */
  variant: string;
  harnessSlug: HarnessSlug;
  /** Null when the harness does not report a version. */
  harnessVersion: string | null;
  modelId: string;
}

/**
 * Token counts, broken out by accounting category. Each is an integer, or `null`
 * when the harness does not report that category at all — `null` means "could not
 * be determined", which is distinct from `0` ("reported, and was zero"). A
 * consumer aggregating across categories should treat a `null` as missing rather
 * than zero, so a partial total is never compared as if it were complete.
 */
export interface TokenMetrics {
  uncachedInput: number | null;
  cachedInput: number | null;
  output: number | null;
  reasoning: number | null;
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

/** Whether a piece of media is a still image or a video clip. */
export type MediaKind = "image" | "video";

/**
 * The presence result for a single declared proof-of-implementation artifact.
 *
 * A test case can ask the agent to write evidence (a screenshot or short clip)
 * to a known path; validation records whether each turned up. Informational — a
 * missing proof never gates the run's status.
 */
export interface ProofResult {
  /** The proof id this result records under (matches a declared proof). */
  id: string;
  /** Human-readable display name, carried through from the declared proof. */
  name: string;
  /** Whether the proof media is an image or a video. */
  kind: MediaKind;
  /** The run-root-relative path the proof was expected at. */
  dest: string;
  /** Whether the agent produced the proof at its declared `dest`. */
  present: boolean;
  /** Detail about a missing or unreadable proof, or null when present. */
  detail: string | null;
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

/**
 * The regenerate-and-score result of an asset-generation run.
 *
 * The run's authoritative output is its recorded action log(s); the validator
 * replays each through the same drawing logic the binary used to produce the
 * **regenerated** image (the scored output). A single sprite has one
 * {@link AssetFrameResult} (index 0); a sprite sheet has one per declared frame,
 * each a completely separate file scored independently — there is no whole-sheet
 * aggregate. All paths are run-root-relative and resolved to media URLs by the
 * gallery host.
 */
export interface AssetGenResult {
  /**
   * The per-frame results: exactly one for a single sprite (index 0), one per
   * declared frame for a sprite sheet, in declared order.
   */
  frames: AssetFrameResult[];
  /**
   * The sprite-sheet frame dimensions and named sequences, present only when the
   * case draws a sprite sheet (`asset_kind = "sprite-sheet"`). Lets a reviewer
   * play the named animations from the per-frame images. Absent for a
   * single-sprite case.
   */
  sheet?: AssetSheet;
  /** Detail about anything that could not be evaluated at the run level, or null. */
  detail: string | null;
}

/**
 * The regenerate-and-score result for one frame of an asset-generation run: a
 * single sprite's one frame, or one frame of a sprite sheet (a separate file).
 * Carries the fidelity of the regenerated image against this frame's target and
 * the divergence between it and the pixels the model left on disk (a high
 * divergence means the model drew outside the tool).
 */
export interface AssetFrameResult {
  /** The frame index: `0` for a single sprite, the declared index for a sheet. */
  index: number;
  /** Run-root-relative path to the image regenerated from this frame's log. */
  regeneratedImage: string;
  /** Run-root-relative path to the pixels the model left on disk for this frame. */
  previewImage: string;
  /** Run-root-relative path to this frame's seeded target. */
  targetImage: string;
  /** Run-root-relative path to this frame's recorded action log. */
  actionsLog: string;
  /** How many operations this frame's log recorded. */
  operationCount: number;
  /** Similarity of the regenerated frame to its target, in `0..=1`. */
  targetFidelity: number;
  /**
   * Divergence between the regenerated frame and the model's preview, in `0..=1`
   * (0 is identical). Null when the model left no readable preview.
   */
  cheatDivergence: number | null;
  /** Detail about anything that could not be evaluated for this frame, or null. */
  detail: string | null;
}

/**
 * The frame dimensions of a sprite-sheet asset and the named animations played
 * from it. Every frame is a separate image of `frameWidth × frameHeight`; a
 * sequence plays an ordered list of the declared frame indices.
 */
export interface AssetSheet {
  /** Width of one frame in pixels. */
  frameWidth: number;
  /** Height of one frame in pixels. */
  frameHeight: number;
  /** The declared frame indices, in declared order. */
  frames: number[];
  /** The named animation sequences, in declared order. */
  sequences: AssetSheetSequence[];
}

/** One named animation within an {@link AssetSheet}. */
export interface AssetSheetSequence {
  /** Stable slug naming the sequence (e.g. `walk-right`). */
  slug: string;
  /** Human-readable display name. */
  name: string;
  /** The ordered row-major frame indices this sequence plays. */
  frames: number[];
  /** Playback rate in frames per second. */
  fps: number;
}

/**
 * Which side a match outcome is reported from. The validator always runs the
 * submission as `"red"` against the committed baseline opponent as `"blue"`.
 */
export type AdversarialTeam = "red" | "blue";

/** The outcome of an adversarial run's canonical match, from the submission's
 * perspective. */
export type AdversarialOutcome = "win" | "loss" | "draw" | "forfeit";

/**
 * The result of scoring an adversarial run's single canonical match. The
 * submission's compiled wasm controller is loaded as Red, the case's committed
 * baseline opponent as Blue, and one match is run; the replay is published as an
 * ordinary run asset. Present only on an adversarial run's validation.
 */
export interface AdversarialResult {
  /** Run-root-relative path to the published, browser-playable replay. */
  replayJson: string;
  /** The id of the baseline opponent the submission was matched against (Blue). */
  opponent: string;
  /** Which side the submission played (always `"red"` for the canonical match). */
  submissionTeam: AdversarialTeam;
  /** The winning side, or null for a draw. `"red"` is the submission. */
  winner: AdversarialTeam | null;
  /** The submission's (Red's) banked score at the end of the match. */
  redScore: number;
  /** The opponent's (Blue's) banked score at the end of the match. */
  blueScore: number;
  /** How the match ended (`"swept"`, `"time_limit"`, or `"forfeit"`). */
  ended: string;
  /** How many ticks the match ran for. */
  ticks: number;
  /** The outcome from the submission's perspective. */
  outcome: AdversarialOutcome;
  /** Detail about a submission that could not be matched, or null. */
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
  /**
   * Per-proof presence results for the proof-of-implementation artifacts the
   * test case requests. Empty when the case declares none. Informational: a
   * missing proof does not change `loaded`.
   */
  proofs: ProofResult[];
  /**
   * The regenerate-and-score result of an asset-generation run. Absent for an
   * end-to-end run.
   */
  asset?: AssetGenResult;
  /**
   * The canonical-match result of an adversarial run. Absent for any other type.
   */
  adversarial?: AdversarialResult;
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

/** Every valid {@link AuthMode}. */
export const AUTH_MODES: readonly AuthMode[] = ["apiKey", "subscription"];

/** Narrowing type guard for {@link HarnessSlug}. */
export function isHarnessSlug(value: string): value is HarnessSlug {
  return (HARNESS_SLUGS as readonly string[]).includes(value);
}

/** Narrowing type guard for {@link RunState}. */
export function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}

/** Narrowing type guard for {@link AuthMode}. */
export function isAuthMode(value: string): value is AuthMode {
  return (AUTH_MODES as readonly string[]).includes(value);
}
