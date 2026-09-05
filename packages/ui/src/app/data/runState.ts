import type { RunRecord, RunState } from "@clockwyrks/run-record";

// How a run's terminal state reads in the UI. The Rust contract
// (`crates/core/src/run_record.rs`) is the source of truth for the states
// themselves; this is the single place the gallery turns one into user-facing
// copy and the flags the cards, banner, and publish-failures affordance branch on.
export interface RunStatePresentation {
  /** Full label, used as the failure banner's title (e.g. "Catastrophic failure"). */
  label: string;
  /** Compact label for a card's status chip (e.g. "catastrophic"). */
  chip: string;
  /** One-line explanation for the failure banner body. */
  description: string;
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
        isFailure: false,
        isPublishableFailure: false,
      };
    case "catastrophic":
      return {
        label: "Catastrophic failure",
        chip: "catastrophic",
        description:
          "The model claimed completion, but the output could not be built or evaluated, so it produced no playable build. Its broken source is kept so the failure can be inspected.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "timed_out":
      return {
        label: "Timed out",
        chip: "timed out",
        description:
          "The run hit its maximum runtime and was stopped before the model finished. It never converged on a result.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "harness_error":
      return {
        label: "Harness error",
        chip: "harness",
        description:
          "The model drove the agent harness to exit early (a non-zero exit). It produced no evaluable output, so it releases no code or build and is recorded only as a per-model harness-error statistic. A subscription auth-token refresh can also surface here; those are not published.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "limit_exceeded":
      return {
        label: "Execution ceiling reached",
        chip: "ceiling",
        description:
          "The harness stopped the run on one of the execution ceilings its configuration armed: a turn count, a wall-clock budget, a spend, or a tolerance for failing turns. The model spent its whole allowance without finishing, so the run releases no code or build and is recorded as a per-model statistic. It is never retried, because a second attempt on the same configuration reaches the same ceiling.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "hung":
      return {
        label: "Harness hung",
        chip: "hung",
        description:
          "The agent harness stopped producing output entirely and was stopped as hung, having neither finished nor failed. Like a harness error it releases no code or build and is recorded only as a per-model statistic.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "infrastructure":
      return {
        label: "Infrastructure failure",
        chip: "infra",
        description:
          "The Test Cabinet's own infrastructure failed before the model's output could be judged. This is not a model result and is never published.",
        isFailure: true,
        isPublishableFailure: false,
      };
    case "canceled":
      return {
        label: "Canceled",
        chip: "canceled",
        description:
          "An operator stopped this run before it finished. Everything it streamed up to that point is kept so it can be inspected, but it reached no outcome. It is not a model result and is never published.",
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
