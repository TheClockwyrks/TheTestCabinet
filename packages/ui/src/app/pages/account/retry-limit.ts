import {
  useNumberFieldState,
  type NumberFieldState,
} from "../../components/NumberField";

// The retry limit a coverage plan and a ladder each carry: how many automatic retries
// every run they launch gets. The two editors declare the field here so they can never
// disagree on its default, its range, or what it tells the operator.

/** The retry limit of a new plan or ladder, mirroring the backend's default. */
export const DEFAULT_RETRY_LIMIT = 1;
/** The most retries the backend honours for any launch. */
export const MAX_RETRY_LIMIT = 10;

/** The field's label. */
export const RETRY_LIMIT_LABEL = "Retry limit";

/** What the limit is, in one line beside the field. */
export const RETRY_LIMIT_DESCRIPTION =
  "How many times a failed run is retried automatically before its result stands.";

/** The rest of it, behind the field's help: turning retries off, and what blocks. */
export function retryLimitHelp(subject: "plan" | "ladder"): string {
  const unit = subject === "plan" ? "cell" : "climber";
  return `A run is retried when it fails on infrastructure, a harness error, a hang or a build that will not load. 0 turns retries off. A run that uses its retries up without a result that counts blocks its ${unit} until it is retried by hand.`;
}

/**
 * The retry limit as a form-owned field: a whole number from 0 to
 * {@link MAX_RETRY_LIMIT}, seeded with the default. The save is refused while it holds
 * anything else.
 */
export function useRetryLimitField(): NumberFieldState {
  return useNumberFieldState(DEFAULT_RETRY_LIMIT, {
    label: RETRY_LIMIT_LABEL,
    min: 0,
    max: MAX_RETRY_LIMIT,
    integer: true,
  });
}
