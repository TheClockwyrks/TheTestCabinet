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
   * Whether this is a publishable failure tier (catastrophic, timed-out, or
   * harness-error): real model signal that publishes without a review.
   * Infrastructure failures are the Test Cabinet's own fault and are never
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
          "The model claimed completion, but the output could not be built or evaluated. Its broken source is kept so the failure can be inspected.",
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

/** Whether a run in this state has a hostable, playable build. Only a completed
 * run produces one — every failure tier stopped before a usable build existed. */
export function hasPlayableOutcome(state: RunState): boolean {
  return state === "completed";
}
