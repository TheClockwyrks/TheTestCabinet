import type { RunRecord, RunState } from "@clockwyrks/run-record";

/**
 * Where a reader goes for the full contract behind a terminal state — the tier
 * list itself, and what each one means for publishing. Linked rather than
 * restated, so the gallery and the contract cannot drift.
 */
export const RUN_STATE_DOCS_URL =
  "https://docs.testcabinet.ai/components/core/run-records/#status";

// How a run's terminal state reads in the UI. The Rust contract
// (`crates/core/src/run_record.rs`) is the source of truth for the states
// themselves; this is the single place the gallery turns one into user-facing
// copy and the flags the cards, banner, and publish-failures affordance branch on.
export interface RunStatePresentation {
  /** Full label, used as the failure banner's title (e.g. "Catastrophic failure"). */
  label: string;
  /** Compact label for a card's status chip (e.g. "catastrophic"). */
  chip: string;
  /**
   * What went wrong, as one terse declarative clause. It reports the *error*,
   * never what the system decided to do about it, per the failure-detail style
   * in the run-record contract; the tier's consequences live in
   * {@link RunStatePresentation.consequence}. Stands in for the failure banner's
   * body when the record carries no `status.detail` of its own.
   */
  description: string;
  /**
   * What the tier means for the run's outcome: whether it is publishable, what a
   * publish releases, and whether it counts towards a model's statistics. This is
   * documented contract knowledge a reader of the gallery needs, not part of the
   * error, which is why it is a field of its own rather than a tail on
   * {@link RunStatePresentation.description}. Surfaced on demand — a `HelpTip`
   * beside the tier chip on the Publish-failures worklist, and the Verdict tab's
   * failure note — with {@link RUN_STATE_DOCS_URL} behind it for the rest.
   */
  consequence: string;
  /** Whether this state is any failure tier (not a clean completion). */
  isFailure: boolean;
  /**
   * Whether this is a publishable failure tier (catastrophic, timed-out,
   * harness-error, limit-exceeded, or hung): real model signal that publishes
   * without a review. The two never-publishable tiers are excluded — an
   * infrastructure failure is the Test Cabinet's own fault, and a canceled run was
   * stopped by an operator before it reached any outcome.
   */
  isPublishableFailure: boolean;
}

/** Describe a run's terminal state for presentation. */
export function describeRunState(state: RunState): RunStatePresentation {
  switch (state) {
    case "completed":
      return {
        label: "Completed",
        chip: "completed",
        description: "The run produced a usable, evaluable implementation.",
        consequence:
          "Scored on the reviewer checklist: by its validators on a validator-rated run, overlaid with any reviewer overrides, and by its reviewers on a legacy run. A validator-rated run is publishable the moment it completes; a legacy run publishes through review.",
        isFailure: false,
        isPublishableFailure: false,
      };
    case "catastrophic":
      return {
        label: "Catastrophic failure",
        chip: "catastrophic",
        description:
          "The harness exited cleanly, claiming completion, but the output did not build or load.",
        consequence:
          "Publishable model signal with no review checklist, reported as a per-model catastrophic-failure statistic. A publish releases the generated source and no playable build.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "timed_out":
      return {
        label: "Timed out",
        chip: "timed out",
        description:
          "The run hit its maximum runtime before the harness finished, so the model never converged.",
        consequence:
          "Publishable model signal with no review checklist, unscored and reported as a per-model timeout statistic. A publish releases the generated source and no playable build.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "harness_error":
      return {
        label: "Harness error",
        chip: "harness",
        description:
          "The agent harness, or the orchestrator runner driving it, exited non-zero.",
        consequence:
          "Publishable without a review, releasing no source repository and no playable build, and recorded only as a per-model harness-error statistic. A subscription auth-token refresh also surfaces as a non-zero exit, so each publish is deliberate: record the real harness errors and leave the auth-refresh ones unpublished.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "limit_exceeded":
      return {
        label: "Execution ceiling reached",
        chip: "ceiling",
        description:
          "The model spent an execution ceiling its configuration armed without finishing: a turn count, a wall-clock budget, a spend, or a tolerance for failing turns.",
        consequence:
          "Published exactly like a harness error — no source repository, no playable build, recorded only as a per-model statistic. It is the one harness stop that is never retried, because a breached ceiling is a property of the configuration and a second attempt reaches the same bound. Only a gg run reaches this tier.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "hung":
      return {
        label: "Harness hung",
        chip: "hung",
        description:
          "The agent harness stopped producing output altogether: a provider request that never returned, or a subagent that never reported back.",
        consequence:
          "Published exactly like a harness error, with no exit code to report — no source repository, no playable build, recorded only as a per-model statistic. The idle watchdog sits well below the platform's own idle limits, so a run's fate is decided here rather than by its maximum runtime.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "infrastructure":
      return {
        label: "Infrastructure failure",
        chip: "infra",
        description:
          "The Test Cabinet's own infrastructure failed before the model's output could be judged.",
        consequence:
          "Not a model result: never publishable, and excluded from every model statistic. The run is retained with a diagnostic detail naming the reason, and one that reached the dependency install keeps its collected tree and validation summary.",
        isFailure: true,
        isPublishableFailure: false,
      };
    case "canceled":
      return {
        label: "Canceled",
        chip: "canceled",
        description: "An operator killed the run before it finished.",
        consequence:
          "Not a model result: never publishable, and excluded from every model statistic, because nothing about the model can be concluded from a run a human ended. A killed gg run is retained for inspection with its metrics, its collected tree as it stood at the last completed turn, and everything it streamed; a killed run of any other harness leaves no record at all.",
        isFailure: true,
        isPublishableFailure: false,
      };
  }
}

/**
 * The color a run's terminal state reads in as a chart segment or swatch, as a
 * `--tcab-*` token reference so it tracks a live theme swap.
 *
 * The tones mirror {@link ReliabilityRingWidget}'s fixed outcome palette —
 * completed reads positive, the loud failures negative/accent, and the quiet ones
 * (a hang, our own infrastructure, an operator's cancel) muted, because nothing
 * about the model happened there.
 */
export function runStateColor(state: RunState): string {
  switch (state) {
    case "completed":
      return "var(--tcab-positive)";
    case "catastrophic":
      return "var(--tcab-negative)";
    case "harness_error":
      return "var(--tcab-accent-2)";
    case "timed_out":
      return "var(--tcab-accent)";
    case "limit_exceeded":
      // Adjacent to the timeout tone, because a spent ceiling and a spent clock
      // are the same kind of outcome, and distinguishable from it so a
      // distribution chart carrying both can still be read.
      return "color-mix(in srgb, var(--tcab-accent) 60%, var(--tcab-accent-2))";
    case "hung":
      return "var(--tcab-muted)";
    case "infrastructure":
      return "var(--tcab-border)";
    case "canceled":
      // Quiet like the two above, but distinguishable from them: a dimmed muted
      // rather than a second use of the border tone, so a distribution chart that
      // carries both an infrastructure and a canceled segment can still be read.
      return "color-mix(in srgb, var(--tcab-muted) 50%, var(--tcab-bg))";
  }
}

/**
 * Whether a run in this state has a hostable, playable build. Mirrors
 * `RunState::has_playable_build` in the Rust contract.
 *
 * Only a completed run produces one — a run that built and loaded is completed
 * however badly it validated, since a validation script that could not be driven
 * fails the checklist point it backs rather than diverting the run. The remaining
 * tiers genuinely stopped before a usable build existed: `catastrophic` never
 * loaded, `timed_out` never finished, and `harness_error` / `limit_exceeded` /
 * `hung` / `infrastructure` / `canceled` release nothing at all.
 */
export function hasPlayableOutcome(state: RunState): boolean {
  return state === "completed";
}

/**
 * Whether a run has a playable build to host on its Play tab. None of an
 * asset-generation run (a static asset), an adversarial run (a match replay), or
 * a performance run (a wasm engine scored on fuel) produces a hostable playable
 * build, whatever its state; and a run of any type whose state produced no build
 * (see {@link hasPlayableOutcome}) likewise has nothing to play.
 *
 * The single gate for the run detail's Play tab: the tab strip offers Play (and
 * leads with it) exactly when this is true, and the bare run URL redirects to the
 * Verdict tab exactly when it is false.
 */
export function hasPlayableBuild(run: RunRecord): boolean {
  return (
    hasPlayableOutcome(run.status.state) &&
    run.subject.testType !== "asset-generation" &&
    run.subject.testType !== "adversarial" &&
    run.subject.testType !== "performance"
  );
}
