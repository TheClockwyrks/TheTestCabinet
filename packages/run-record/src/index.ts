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
  /**
   * The resolved slug of the orchestrator that conducted the harness sessions
   * (e.g. `"one-shot"` or `"ralph"`). For an external orchestrator directory
   * this is the directory's own manifest slug. Defaults to `"one-shot"` for
   * records written before orchestrator selection existed.
   */
  orchestratorSlug: string;
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
 * The regenerate result of an asset-generation run.
 *
 * The run's authoritative output is its recorded action log(s); the validator
 * replays each through the same drawing logic the binary used to produce the
 * **regenerated** image, which a human reviews against the brief (there is no
 * target image and no automated fidelity score). A single sprite has one
 * {@link AssetFrameResult} (index 0); a sprite sheet has one per declared frame,
 * each a completely separate file. All paths are run-root-relative and resolved
 * to media URLs by the gallery host.
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
 * The regenerate result for one frame of an asset-generation run: a single
 * sprite's one frame, or one frame of a sprite sheet (a separate file). An
 * asset-generation run has no target image — the regenerated image is reviewed
 * against the brief by a human. Carries the divergence between the regenerated
 * image and the pixels the model left on disk (a high divergence means the model
 * drew outside the tool).
 */
export interface AssetFrameResult {
  /** The frame index: `0` for a single sprite, the declared index for a sheet. */
  index: number;
  /** Run-root-relative path to the image regenerated from this frame's log. */
  regeneratedImage: string;
  /** Run-root-relative path to the pixels the model left on disk for this frame. */
  previewImage: string;
  /** Run-root-relative path to this frame's recorded action log. */
  actionsLog: string;
  /** How many operations this frame's log recorded. */
  operationCount: number;
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

// ---------------------------------------------------------------------------
// Adversarial arena: head-to-head matches and tournaments.
//
// These mirror the Rust `test_cabinet_core::match_play` types. The arena lets an
// operator pit any two controllers (baselines or controllers built by prior runs)
// head-to-head, or run a field of controllers as a tournament whose standings and
// per-match summaries are persisted so it can be revisited.
// ---------------------------------------------------------------------------

/** Where a controller came from — a committed baseline or a prior run's module. */
export type ControllerKind = "baseline" | "run";

/** A controller that can be pitted: identified, but not yet loaded. */
export interface ControllerRef {
  /** The stable id: a baseline name, or a prior run's id. */
  id: string;
  /** Where it came from. */
  kind: ControllerKind;
  /** An optional human-facing label (e.g. the model id of the run that built it). */
  label?: string | null;
}

/**
 * One match's result, summarized so a tournament list can show the outcome
 * without loading (and replaying) the match.
 */
export interface MatchSummary {
  /** Stable id for this match (also the replay's storage segment): `"{redId}__vs__{blueId}"`. */
  matchId: string;
  /** The controller that played Red (the lower-sorted id in a tournament pair). */
  redId: string;
  /** The controller that played Blue. */
  blueId: string;
  /** The winning controller's id, or null for a draw. */
  winner: string | null;
  /** How the match ended (`"swept"`, `"time_limit"`, or `"forfeit"`). */
  winType: string;
  /** The outcome from Red's perspective. */
  outcomeForRed: AdversarialOutcome;
  /** Red's banked score (the points Red earned this match). */
  redScore: number;
  /** Blue's banked score (the points Blue earned this match). */
  blueScore: number;
  /** How many ticks the match ran for. */
  ticks: number;
  /** Enemy raiders Red tagged ("kills"). */
  redKills: number;
  /** Enemy raiders Blue tagged. */
  blueKills: number;
  /** The storage segment the replay is kept under, or absent when no match ran. */
  replayKey?: string | null;
  /** Why a controller could not be matched (a load failure), or null. */
  detail?: string | null;
}

/** One row of a tournament's standings: a controller's total points and record. */
export interface Standing {
  /** The controller this row ranks. */
  participantId: string;
  /** Total points — the sum of banked seeds the controller earned across all its
   * matches. The standings are ranked by this, highest first. */
  points: number;
  /** Matches won. */
  wins: number;
  /** Matches lost. */
  losses: number;
  /** Matches drawn. */
  draws: number;
  /** 1-based rank (1 is best). */
  rank: number;
}

/**
 * A persisted tournament: the field, the ranked standings, and every match's
 * summary. The per-match replays are stored alongside (keyed by `MatchSummary`'s
 * `replayKey`/`matchId`); this record carries only the summaries so it loads
 * cheaply.
 */
export interface TournamentRecord {
  /** Unique tournament id. */
  id: string;
  /** RFC 3339 timestamp the tournament was run at. */
  createdAt: string;
  /** The test case the field competed under. */
  testCaseSlug: string;
  /** The exact case version. */
  testCaseVersion: string;
  /** The case variant the canonical match used. */
  variant: string;
  /** The competing controllers (identity only). */
  participants: ControllerRef[];
  /** The standings, ranked highest points first. */
  standings: Standing[];
  /** Every match's summary, in the order they were played. */
  matches: MatchSummary[];
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
