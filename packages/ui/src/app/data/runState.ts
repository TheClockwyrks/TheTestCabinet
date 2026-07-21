import type { RunState } from "@test-cabinet/run-record";

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
   * Whether this is a publishable failure tier (catastrophic, validation-error,
   * timed-out, harness-error, or hung): real model signal that publishes without a
   * review. Infrastructure failures are the Test Cabinet's own fault and are never
   * publishable.
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
          "The model claimed completion, but the output could not be built or evaluated — it produced no playable build. Its broken source is kept so the failure can be inspected.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "validation_error":
      return {
        label: "Validation error",
        chip: "validation",
        description:
          "The output built and loaded, but a required validation script could not run against it — the case mandates a debug API and the model's is missing or non-conformant, so the run could not be automatically validated. The build is still playable and is kept so it can be explored by hand.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "timed_out":
      return {
        label: "Timed out",
        chip: "timed out",
        description:
          "The run hit its maximum runtime and was stopped before the model finished — it never converged on a result.",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "harness_error":
      return {
        label: "Harness error",
        chip: "harness",
        description:
          "The model drove the agent harness to exit early (a non-zero exit). It produced no evaluable output, so it releases no code or build — it is recorded only as a per-model harness-error statistic. (A subscription auth-token refresh can also surface here; those are not published.)",
        isFailure: true,
        isPublishableFailure: true,
      };
    case "hung":
      return {
        label: "Harness hung",
        chip: "hung",
        description:
          "The agent harness stopped producing output entirely and was stopped as hung — it neither finished nor failed. Like a harness error it releases no code or build and is recorded only as a per-model statistic.",
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
  }
}

/**
 * Whether a run in this state has a hostable, playable build. Mirrors
 * `RunState::has_playable_build` in the Rust contract.
 *
 * A completed run produces one, and so does a `validation_error` run: its output
 * built, loaded, and served correctly, and only the *validation* of that output
 * failed — the build is every bit as playable, so the Play tab must still be
 * offered. The remaining tiers genuinely stopped before a usable build existed:
 * `catastrophic` never loaded, `timed_out` never finished, and `harness_error` /
 * `infrastructure` release nothing at all.
 */
export function hasPlayableOutcome(state: RunState): boolean {
  return state === "completed" || state === "validation_error";
}
