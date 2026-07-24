// The board panel: gg's epic/issue board rendered live (see gg/epics-and-issues).
// The board is the heavyweight work tier above the tasks list — issues grouped
// under epics, each issue carrying the structured brief (in-scope / out-of-scope /
// completion criteria) that makes it safe to dispatch to a subagent. gg re-emits
// the whole board on each mutation, so `useGgRunState` keeps the latest snapshot
// and this view renders it: issues bucketed under their epic (plus an "Ungrouped"
// bucket for issues with no epic), each showing its status, a READY/BLOCKED
// indicator, its blocked-by edges, and an expandable brief.
//
// An issue is READY when it is not done and every blocker is done; BLOCKED when a
// blocker is still incomplete (matching gg's backend semantics — the same
// blocked-by relation as tasks); and DONE once its status is done. The status
// badge (open / in progress / done) is orthogonal to that derived readiness.

import type {
  GgBoardIssue,
  GgCodeReviewPhase,
  GgIssueStatus,
} from "@test-cabinet/run-record/gg";
import type { BoardState, CodeReviewState } from "./useGgRunState";
import styles from "./GgPanels.module.scss";

interface BoardViewProps {
  board: BoardState | null;
  // Per-issue Code Review lifecycle, keyed by issue id (see gg/code-reviews); empty
  // when the code-reviews capability is off, so no review badges are shown.
  codeReviews: Map<string, CodeReviewState>;
}

// The derived readiness of an issue: done issues are done; otherwise an incomplete
// blocker makes it blocked (and names which), and everything else is ready to be
// picked up (or dispatched to a subagent).
type Readiness = "ready" | "blocked" | "done";

function deriveIssue(
  issue: GgBoardIssue,
  byId: Map<string, GgBoardIssue>,
): { readiness: Readiness; incomplete: string[] } {
  if (issue.status === "done") return { readiness: "done", incomplete: [] };
  const incomplete = issue.blockedBy.filter(
    (id) => byId.get(id)?.status !== "done",
  );
  return {
    readiness: incomplete.length ? "blocked" : "ready",
    incomplete,
  };
}

const STATUS_LABELS: Record<GgIssueStatus, string> = {
  open: "open",
  in_progress: "in progress",
  done: "done",
};

const READINESS_LABELS: Record<Readiness, string> = {
  ready: "ready",
  blocked: "blocked",
  done: "done",
};

// The Code Review badge label per phase (see gg/code-reviews): a review gates an
// issue's acceptance, so "in review" while the reviewer inspects the diff, "changes
// requested" while a fix agent works the actionable items, "approved" once the issue
// may finally be accepted.
const REVIEW_LABELS: Record<GgCodeReviewPhase, string> = {
  requested: "in review",
  changes_requested: "changes requested",
  approved: "approved",
};

// One epic bucket for rendering: the epic (null for the synthetic "Ungrouped"
// bucket) and the issues under it, in board order.
interface EpicGroup {
  id: string;
  title: string;
  description: string | null;
  issues: GgBoardIssue[];
}

export function BoardView({ board, codeReviews }: BoardViewProps) {
  if (!board || (board.epics.length === 0 && board.issues.length === 0)) {
    return (
      <p className={styles.empty}>
        No board yet — the epics-and-issues capability streams the model's board
        here, grouping issues under epics with their scope and completion
        criteria as it decomposes the work.
      </p>
    );
  }

  const { epics, issues } = board;
  const byId = new Map(issues.map((i) => [i.id, i]));

  // Bucket issues under their epic, preserving board order within each bucket. An
  // issue whose `epicId` names no known epic (or is unset) falls into "Ungrouped".
  const epicIds = new Set(epics.map((e) => e.id));
  const groups: EpicGroup[] = epics.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description || null,
    issues: [],
  }));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const ungrouped: EpicGroup = {
    id: "__ungrouped__",
    title: "Ungrouped",
    description: null,
    issues: [],
  };
  for (const issue of issues) {
    const key = issue.epicId && epicIds.has(issue.epicId) ? issue.epicId : null;
    (key ? groupById.get(key)! : ungrouped).issues.push(issue);
  }
  // Show the Ungrouped bucket last, and only when it holds anything.
  const rendered = ungrouped.issues.length ? [...groups, ungrouped] : groups;

  return (
    <div className={styles.board}>
      {rendered.map((group) => (
        <section key={group.id} className={styles.epic}>
          <header className={styles.epicHead}>
            <h3 className={styles.epicTitle}>{group.title}</h3>
            <span className={styles.epicCount}>
              {group.issues.filter((i) => i.status === "done").length}/
              {group.issues.length}
            </span>
          </header>
          {group.description && (
            <p className={styles.epicDesc}>{group.description}</p>
          )}
          {group.issues.length === 0 ? (
            <p className={styles.epicEmpty}>No issues yet.</p>
          ) : (
            <ul className={styles.issueList}>
              {group.issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  byId={byId}
                  review={codeReviews.get(issue.id) ?? null}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// One issue on the board: the readiness chip, the title with its status badge and
// id, the blocked-by edges when any, and the structured brief in an expandable
// secondary section (kept collapsed so the board stays scannable, since the brief
// is what makes an issue dispatchable rather than what you scan by).
function IssueCard({
  issue,
  byId,
  review,
}: {
  issue: GgBoardIssue;
  byId: Map<string, GgBoardIssue>;
  review: CodeReviewState | null;
}) {
  const { readiness, incomplete } = deriveIssue(issue, byId);
  return (
    <li className={styles.issueRow} data-readiness={readiness}>
      <span className={styles.taskBadge} data-task-state={readiness}>
        {READINESS_LABELS[readiness]}
      </span>
      <div className={styles.issueBody}>
        <div className={styles.issueHead}>
          <span className={styles.issueTitle} data-status={issue.status}>
            {issue.title}
          </span>
          <span className={styles.statusBadge} data-status={issue.status}>
            {STATUS_LABELS[issue.status]}
          </span>
          {/* The Code Review badge — shown only when a review was dispatched for
              this issue, so a code-reviews-off run carries no badge. It makes the
              acceptance gate legible: the issue is not accepted until it approves. */}
          {review && (
            <span
              className={styles.reviewBadge}
              data-review-phase={review.phase}
            >
              {REVIEW_LABELS[review.phase]}
            </span>
          )}
          <span className={styles.issueId}>{issue.id}</span>
        </div>
        {issue.description && (
          <span className={styles.issueDesc}>{issue.description}</span>
        )}
        {issue.blockedBy.length > 0 && (
          <Blockers
            issue={issue}
            byId={byId}
            incomplete={new Set(incomplete)}
          />
        )}
        {/* The actionable items the reviewer returned — what a fix agent must
            address before re-review. Only present on the `changes_requested`
            phase. */}
        {review?.phase === "changes_requested" && review.items.length > 0 && (
          <ReviewItems items={review.items} />
        )}
        <IssueBrief issue={issue} />
      </div>
    </li>
  );
}

// The actionable items a Code Review's `changes_requested` returned, listed under
// the issue so the gate's remaining work is visible on the board — it is precisely
// what a fix agent, dispatched with the original task plus these items, addresses.
function ReviewItems({ items }: { items: string[] }) {
  return (
    <div className={styles.reviewItems}>
      <span className={styles.reviewItemsLabel}>Changes requested</span>
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
function Blockers({
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

// The structured brief — in-scope / out-of-scope / completion criteria — in a
// collapsed `<details>`. The scope boundaries and acceptance criteria are what
// make an issue safe to hand to a subagent, so they are always available but kept
// out of the scan by default.
function IssueBrief({ issue }: { issue: GgBoardIssue }) {
  return (
    <details className={styles.brief}>
      <summary className={styles.briefSummary}>Brief</summary>
      <dl className={styles.briefGrid}>
        <BriefField label="In scope" body={issue.inScope} />
        <BriefField label="Out of scope" body={issue.outOfScope} />
        <BriefField
          label="Completion criteria"
          body={issue.completionCriteria}
        />
      </dl>
    </details>
  );
}

function BriefField({ label, body }: { label: string; body: string }) {
  return (
    <div className={styles.briefField}>
      <dt className={styles.briefLabel}>{label}</dt>
      <dd className={styles.briefText}>{body || "—"}</dd>
    </div>
  );
}
