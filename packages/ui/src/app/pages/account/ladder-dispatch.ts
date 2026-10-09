import type { DispatchStatus } from "@clockwyrks/backend-api/ladders";

import ladderStyles from "./Ladder.module.scss";

// How a ladder's latest dispatch is read, for the surfaces that show it: the ladder's
// own dashboard, its card on the ladders list, and the editor.

/**
 * Whether a dispatch is still the ladder's running one. One that reads Needs attention
 * is: nothing of it is in flight and its blocked climbers wait on their owner, but Run
 * stays unavailable, Stop ends it, and a climber's Retry resumes the climb.
 */
export function dispatchLive(
  status: DispatchStatus | null | undefined,
): boolean {
  return status === "running" || status === "needsAttention";
}

/** The status badge's colour class, one per reading (see `Ladder.module.scss`). */
export function dispatchBadgeClass(
  status: DispatchStatus | null,
): string | undefined {
  switch (status) {
    case null: {
      return ladderStyles.badgeIdle;
    }
    case "running": {
      return ladderStyles.badgeRunning;
    }
    case "needsAttention": {
      return ladderStyles.badgeAttention;
    }
    case "finished": {
      return ladderStyles.badgeFinished;
    }
    case "stopped": {
      return ladderStyles.badgeStopped;
    }
  }
}
