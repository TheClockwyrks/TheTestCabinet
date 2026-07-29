// The shared vocabulary and small parts for reading one of gg's board issues (see
// gg/project-management), used by the Project explorer.
//
// An issue carries two facts that a reader wants as one: its lifecycle status, and
// whether its blockers are clear. Showing them as separate badges made the header a row
// of chips that had to be read together to mean anything, so they are folded here into a
// single `IssueState` — the one badge an issue shows — and everything else (the blocked-by
// edges, a review's actionable items) is a part rendered beneath it.

import type { GgBoardIssue } from "@test-cabinet/run-record/gg";
import styles from "./GgPanels.module.scss";

// The derived readiness of an issue: a done issue is done and a failed one is failed
// (both terminal); otherwise an incomplete blocker makes it blocked (and names
// which), and everything else is ready to be picked up (or dispatched to an agent).
export type Readiness = "ready" | "blocked" | "done" | "failed";

export function deriveIssue(
  issue: GgBoardIssue,
  byId: Map<string, GgBoardIssue>,
): { readiness: Readiness; incomplete: string[] } {
  if (issue.status === "done") return { readiness: "done", incomplete: [] };
  if (issue.status === "failed") return { readiness: "failed", incomplete: [] };
  const incomplete = issue.blockedBy.filter(
    (id) => byId.get(id)?.status !== "done",
  );
  return {
    readiness: incomplete.length ? "blocked" : "ready",
    incomplete,
  };
}

// The single state an issue is shown as — its status, with the one thing its status
// cannot say folded in: an `open` issue is *ready* only if its blockers are clear, and
// *blocked* otherwise. `approved` rather than "done" because that is what reaching it
// means on this board: every reviewer approved and the work merged (see
// gg/project-management), and an issue never gets there any other way.
export type IssueState =
  | "blocked"
  | "ready"
  | "in_progress"
  | "in_review"
  | "approved"
  | "failed";

export const ISSUE_STATE_LABELS: Record<IssueState, string> = {
  blocked: "Blocked",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  approved: "Approved",
  failed: "Failed",
};

// The order the states are tallied in (an epic's progress row), oldest-to-newest in the
// lifecycle so a glance reads left as work not started and right as work landed.
export const ISSUE_STATES: IssueState[] = [
  "blocked",
  "ready",
  "in_progress",
  "in_review",
  "approved",
  "failed",
];

export function issueState(
  issue: GgBoardIssue,
  byId: Map<string, GgBoardIssue>,
  // Whether a review round is open on the issue right now — an `issue_review` said
  // `requested` and nothing has closed it yet. The board snapshot alone is not enough:
  // gg does move a submitted issue to `in_review`, but the review stream says so first,
  // so an issue whose reviewers are already on the diff read as "In Progress" until the
  // next `board_state` caught up.
  reviewing = false,
): IssueState {
  if (issue.status === "done") return "approved";
  if (issue.status === "failed") return "failed";
  if (reviewing) return "in_review";
  switch (issue.status) {
    case "in_review":
      return "in_review";
    case "in_progress":
      return "in_progress";
    default:
      return deriveIssue(issue, byId).readiness === "blocked"
        ? "blocked"
        : "ready";
  }
}

// The actionable items a review round returned, listed so the gate's remaining work is
// visible — precisely what the issue's own agent, re-dispatched with the original brief
// plus these items, addresses.
export function ReviewItems({
  items,
  label = "Changes requested",
}: {
  items: string[];
  label?: string;
}) {
  return (
    <div className={styles.reviewItems}>
      <span className={styles.reviewItemsLabel}>{label}</span>
      <ul className={styles.reviewItemList}>
        {items.map((item, i) => (
          <li key={i} className={styles.reviewItem}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The blocked-by edges of one issue, as named chips — same treatment as the task
// DAG's blockers: an outstanding blocker reads warm (the reason the issue can't
// start), a satisfied one reads muted with its check. The label is "blocked by"
// while any edge is outstanding, "depends on" once all are satisfied.
export function Blockers({
  issue,
  byId,
  incomplete,
}: {
  issue: GgBoardIssue;
  byId: Map<string, GgBoardIssue>;
  incomplete: Set<string>;
}) {
  const anyOutstanding = incomplete.size > 0;
  return (
    <div className={styles.taskBlockers}>
      <span className={styles.taskBlockersLabel}>
        {anyOutstanding ? "blocked by" : "depends on"}
      </span>
      <span className={styles.taskBlockerChips}>
        {issue.blockedBy.map((id) => {
          const done = !incomplete.has(id);
          return (
            <span
              key={id}
              className={styles.taskBlocker}
              data-done={done ? "" : undefined}
            >
              {done ? "✓ " : ""}
              {byId.get(id)?.title ?? id}
            </span>
          );
        })}
      </span>
    </div>
  );
}
