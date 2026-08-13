import { useEffect, useMemo, useState } from "react";
import { Markdown } from "@test-cabinet/ui";
import type { GgBoardIssue, GgReviewer } from "@test-cabinet/run-record/gg";
import type {
  BoardState,
  IssueReviewRound,
  IssueReviewState,
} from "./useGgRunState";
import type { IssueState } from "./IssueViews";
import {
  Blockers,
  ISSUE_STATES,
  ISSUE_STATE_LABELS,
  ReviewItems,
  deriveIssue,
  issueState,
} from "./IssueViews";
import { useGgExplorerNav } from "./GgExplorerNav";
import { cx } from "./ggFsTree";
import {
  FsExplorer,
  FsFileRow,
  FsFolder,
  useFsFolders,
  type FsFolders,
} from "./GgFsExplorer";
import { EpicIcon, IssueIcon } from "./ggIcons";
import panels from "./GgPanels.module.scss";

// The Project explorer: gg's run-global epic/issue board, read like a filesystem.
//
// Unlike the per-agent views in the Instances explorer, the board is *one* thing shared
// by the whole run (see gg/project-management): submitting an issue enqueues it, and
// gg dispatches a top-level agent to implement it once its blockers clear. So the
// board is a whole-run surface, not a per-agent file — this tab lays it out as
// epics-as-folders holding issues-as-folders, each of which holds its own Overview and
// one file per review round. Selecting a file opens that epic's, issue's, or round's
// detail on the right, the same master/detail shape the Instances explorer uses for agents.
//
// Issues are folders rather than files because a review round is a thing worth *opening*:
// the feedback one reviewer gave is what the next attempt was for, and a board that
// showed only the latest verdict threw away why an issue took three rounds. A round is
// therefore its own entry, and it stays readable after the issue has been accepted.

// The synthetic id of the "Ungrouped" bucket — issues with no (known) epic. It is not
// a real epic, so it carries no epic-summary file, just its issues.
const UNGROUPED_ID = "__ungrouped__";

// One epic bucket for rendering: the epic (a real one, or the synthetic Ungrouped
// bucket) and the issues under it, in board order.
interface EpicGroup {
  id: string;
  title: string;
  description: string | null;
  isEpic: boolean;
  issues: GgBoardIssue[];
}

// The lifecycle-status dot an issue shows in the tree — reusing the agent status-dot
// palette so open reads muted, in-progress accent, done positive, and failed negative
// (so a terminally failed issue is visually distinct).
function issueDotStatus(issue: GgBoardIssue): string {
  switch (issue.status) {
    case "in_progress":
      return "running";
    case "in_review":
      return "blocked";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "open";
  }
}

// Bucket the board's issues under their epic, preserving board order within each
// bucket, plus a trailing "Ungrouped" bucket for issues whose epic is unset or
// unknown.
function groupBoard(board: BoardState): EpicGroup[] {
  const { epics, issues } = board;
  const epicIds = new Set(epics.map((e) => e.id));
  const groups: EpicGroup[] = epics.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description || null,
    isEpic: true,
    issues: [],
  }));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const ungrouped: EpicGroup = {
    id: UNGROUPED_ID,
    title: "Ungrouped",
    description: null,
    isEpic: false,
    issues: [],
  };
  for (const issue of issues) {
    const key = issue.epicId && epicIds.has(issue.epicId) ? issue.epicId : null;
    (key ? groupById.get(key)! : ungrouped).issues.push(issue);
  }
  return ungrouped.issues.length ? [...groups, ungrouped] : groups;
}

// A selected "file" in the tree: an epic's overview, one issue's overview, or one round
// of that issue's review.
type Selection =
  | { kind: "epic"; groupId: string }
  | { kind: "issue"; issueId: string }
  | { kind: "review"; issueId: string; round: number };

interface ProjectExplorerProps {
  // The run-global board (latest `board_state` across the whole stream); null when the
  // project-management capability produced no snapshot yet.
  board: BoardState | null;
  // Per-issue review lifecycle, keyed by issue id (see gg/project-management); empty
  // when no issue named reviewers, so no review entries are shown.
  issueReviews: Map<string, IssueReviewState>;
}

/**
 * The Project tab — the run-global epic/issue board, read as a filesystem of
 * epics-as-folders, issues-as-folders, and overview/review detail-as-files. Offered only
 * when the run's configuration has the project-management capability on (see
 * {@link GgRunPanels}).
 */
export function ProjectExplorer({ board, issueReviews }: ProjectExplorerProps) {
  const groups = useMemo(() => (board ? groupBoard(board) : []), [board]);
  const byId = useMemo(
    () => new Map((board?.issues ?? []).map((i) => [i.id, i])),
    [board],
  );

  // The default landing: the first epic's overview, or — if the first bucket is the
  // Ungrouped one (no overview) — its first issue. Recomputed only for the initial
  // selection; `useEffect` below keeps it valid as the live board grows.
  const firstSelection = useMemo<Selection | null>(() => {
    for (const group of groups) {
      if (group.isEpic) return { kind: "epic", groupId: group.id };
      if (group.issues.length)
        return { kind: "issue", issueId: group.issues[0]!.id };
    }
    return null;
  }, [groups]);

  const [selection, setSelection] = useState<Selection | null>(firstSelection);

  // Epics open by default — they are the board's outline, and closed they say nothing —
  // while an issue is a folder you open to read: a decomposed epic has a dozen of them,
  // each holding an Overview and a file per review round, and all of that unfolded at once
  // buries the outline it hangs under. Only the *overrides* of those defaults are held, so
  // an issue the board files mid-run takes its default as it appears rather than springing
  // open the moment gg enqueues it.
  const folders = useFsFolders();

  // Keep the selection valid as the stream reshapes the board: a selected epic that
  // was removed, a selected issue that is gone, or a review round that no longer
  // exists, falls back to the first file.
  useEffect(() => {
    const stillValid =
      selection != null &&
      (selection.kind === "epic"
        ? groups.some((g) => g.isEpic && g.id === selection.groupId)
        : selection.kind === "issue"
          ? byId.has(selection.issueId)
          : byId.has(selection.issueId) &&
            (issueReviews.get(selection.issueId)?.rounds.length ?? 0) >
              selection.round);
    if (!stillValid) setSelection(firstSelection);
  }, [groups, byId, issueReviews, selection, firstSelection]);

  if (!board || (board.epics.length === 0 && board.issues.length === 0)) {
    return (
      <div className={panels.panelBody}>
        <p className={panels.empty}>
          No epics or issues yet — the project-management board streams the
          run's shared epics and issues here as the model decomposes and
          dispatches the work.
        </p>
      </div>
    );
  }

  const selectedIssue =
    selection?.kind === "issue" || selection?.kind === "review"
      ? (byId.get(selection.issueId) ?? null)
      : null;
  const selectedGroup =
    selection?.kind === "epic"
      ? (groups.find((g) => g.id === selection.groupId) ?? null)
      : null;
  const selectedRound =
    selection?.kind === "review"
      ? (issueReviews.get(selection.issueId)?.rounds[selection.round] ?? null)
      : null;

  return (
    <FsExplorer
      sidebarLabel="Project board"
      tree={groups.map((group) => (
        <EpicFolder
          key={group.id}
          group={group}
          issueReviews={issueReviews}
          folders={folders}
          selection={selection}
          onSelect={setSelection}
        />
      ))}
    >
      {selectedIssue && selection?.kind === "review" ? (
        <ReviewDetail
          issue={selectedIssue}
          round={selectedRound}
          index={selection.round}
        />
      ) : selectedIssue ? (
        <IssueDetail
          issue={selectedIssue}
          byId={byId}
          review={issueReviews.get(selectedIssue.id) ?? null}
        />
      ) : selectedGroup ? (
        <EpicDetail group={selectedGroup} byId={byId} />
      ) : (
        <p className={panels.empty}>Select an epic or issue.</p>
      )}
    </FsExplorer>
  );
}

// One epic folder: its autogenerated Overview file (real epics only) followed by each of
// its issues as a folder of their own.
function EpicFolder({
  group,
  issueReviews,
  folders,
  selection,
  onSelect,
}: {
  group: EpicGroup;
  issueReviews: Map<string, IssueReviewState>;
  folders: FsFolders;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const folderKey = `epic:${group.id}`;
  const open = folders.isOpen(folderKey, true);
  const done = group.issues.filter((i) => i.status === "done").length;
  const epicSelected =
    selection?.kind === "epic" && selection.groupId === group.id;

  return (
    <FsFolder
      depth={0}
      open={open}
      onToggle={() => folders.toggle(folderKey, true)}
      name={group.title}
      meta={
        <span className={panels.fsMeta}>
          {done}/{group.issues.length}
        </span>
      }
    >
      {group.isEpic && (
        <FsFileRow
          depth={1}
          selected={epicSelected}
          onSelect={() => onSelect({ kind: "epic", groupId: group.id })}
          ariaLabel={`${group.title} overview`}
          icon={<EpicIcon className={panels.fsIcon} />}
          name="Overview"
        />
      )}
      {group.issues.map((issue) => (
        <IssueFolder
          key={issue.id}
          issue={issue}
          rounds={issueReviews.get(issue.id)?.rounds ?? []}
          folders={folders}
          selection={selection}
          onSelect={onSelect}
        />
      ))}
    </FsFolder>
  );
}

// One issue folder, named `ID: title` so the tree reads as the board's own vocabulary —
// gg assigns those ids (`AUTH-1`), so the id is what every log line, brief, and agent
// name for this work is built from. Inside: its Overview, then one entry per review
// round, so a round's feedback is always one click away rather than only visible while
// it is the latest.
function IssueFolder({
  issue,
  rounds,
  folders,
  selection,
  onSelect,
}: {
  issue: GgBoardIssue;
  rounds: IssueReviewRound[];
  folders: FsFolders;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const folderKey = `issue:${issue.id}`;
  const open = folders.isOpen(folderKey, false);
  const overviewSelected =
    selection?.kind === "issue" && selection.issueId === issue.id;

  return (
    <FsFolder
      depth={1}
      open={open}
      onToggle={() => folders.toggle(folderKey, false)}
      ariaLabel={`issue ${issue.id}`}
      name={`${issue.id}: ${issue.title}`}
      meta={
        <span
          className={panels.fsStatusDot}
          data-status={issueDotStatus(issue)}
          aria-hidden="true"
        />
      }
    >
      <FsFileRow
        depth={2}
        selected={overviewSelected}
        onSelect={() => onSelect({ kind: "issue", issueId: issue.id })}
        ariaLabel={`${issue.id} overview`}
        icon={<IssueIcon className={panels.fsIcon} />}
        name="Overview"
      />
      {rounds.map((round, index) => (
        <FsFileRow
          key={index}
          depth={2}
          selected={
            selection?.kind === "review" &&
            selection.issueId === issue.id &&
            selection.round === index
          }
          onSelect={() =>
            onSelect({ kind: "review", issueId: issue.id, round: index })
          }
          ariaLabel={`${issue.id} review ${index + 1}`}
          icon={<IssueIcon className={panels.fsIcon} />}
          name={`Review ${index + 1}`}
          meta={
            <span
              className={panels.fsStatusDot}
              data-status={roundDotStatus(round)}
              aria-hidden="true"
            />
          }
        />
      ))}
    </FsFolder>
  );
}

// The dot a review round carries: still running (muted-accent), sent back for changes
// (warm), or approved (positive) — the round's own outcome, not the issue's.
function roundDotStatus(round: IssueReviewRound): string {
  switch (round.phase) {
    case "approved":
      return "done";
    case "changes_requested":
      return "failed";
    default:
      return "running";
  }
}

// An epic's overview: its id, title, description, and a tally of its issues by state —
// the epic carries no status of its own, so its progress is read off the issues under it.
function EpicDetail({
  group,
  byId,
}: {
  group: EpicGroup;
  byId: Map<string, GgBoardIssue>;
}) {
  const counts = countByState(group.issues, byId);
  return (
    <div className={panels.panelBody}>
      <div className={panels.projDetail}>
        <header className={panels.projDetailHead}>
          <h3 className={panels.projDetailTitle}>{group.title}</h3>
          <span className={panels.issueId}>{group.id}</span>
        </header>
        {group.description && (
          <Markdown breaks className={panels.issueDesc}>
            {group.description}
          </Markdown>
        )}
        {group.issues.length === 0 ? (
          <p className={panels.empty}>No issues yet.</p>
        ) : (
          <div className={panels.projStatusSummary}>
            {ISSUE_STATES.map((state) =>
              counts[state] > 0 ? (
                <span
                  key={state}
                  className={panels.statusBadge}
                  data-issue-state={state}
                >
                  {counts[state]} {ISSUE_STATE_LABELS[state]}
                </span>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// One issue's overview: its single state badge, the assigned agent (a link into the
// Instances explorer) and retry count, its blocked-by edges, and its full structured brief
// (shown open, since the detail pane is where you read it). Deliberately *not* the
// feedback a review round returned — each round is its own entry beside this one, which
// is where that is read.
function IssueDetail({
  issue,
  byId,
  review,
}: {
  issue: GgBoardIssue;
  byId: Map<string, GgBoardIssue>;
  review: IssueReviewState | null;
}) {
  const nav = useGgExplorerNav();
  const { incomplete } = deriveIssue(issue, byId);
  const state = issueState(issue, byId, review?.phase === "requested");
  return (
    <div className={panels.panelBody}>
      <div className={panels.projDetail}>
        {/* Headed `ID: title`, the board's own name for this work, with the state badge
            trailing right — and one badge, not three: the issue's state already folds in
            whether its blockers are clear and whether a review is in flight, so a reader
            has one thing to read rather than a row of chips to reconcile. */}
        <header className={panels.projDetailHead}>
          <h3 className={panels.projDetailTitle} data-status={issue.status}>
            {issue.id}: {issue.title}
          </h3>
          <span className={panels.statusBadge} data-issue-state={state}>
            {ISSUE_STATE_LABELS[state]}
          </span>
        </header>

        {issue.description && (
          <Markdown breaks className={panels.issueDesc}>
            {issue.description}
          </Markdown>
        )}

        <dl className={panels.projMeta}>
          {/* The profile the issue was filed *against* — the agent whoever filed it
              chose to dispatch it to — as distinct from the agent id gg then spawned
              under that profile, below. */}
          <div className={panels.projMetaRow}>
            <dt className={panels.projMetaLabel}>Assigned to</dt>
            <dd className={panels.projMetaValue}>{issue.agent}</dd>
          </div>
          {issue.reviewers && issue.reviewers.length > 0 && (
            <div className={panels.projMetaRow}>
              <dt className={panels.projMetaLabel}>Reviewers</dt>
              <dd className={panels.projMetaValue}>
                {issue.reviewers.join(", ")}
              </dd>
            </div>
          )}
          <div className={panels.projMetaRow}>
            <dt className={panels.projMetaLabel}>Assigned agent</dt>
            <dd className={panels.projMetaValue}>
              {issue.assignedAgentId ? (
                nav ? (
                  <button
                    type="button"
                    className={panels.projAgentLink}
                    onClick={() => nav.openAgent(issue.assignedAgentId!)}
                  >
                    {issue.assignedAgentId}
                  </button>
                ) : (
                  issue.assignedAgentId
                )
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className={panels.projMetaRow}>
            <dt className={panels.projMetaLabel}>Retries</dt>
            <dd className={panels.projMetaValue}>{issue.retries}</dd>
          </div>
          {review && review.rounds.length > 0 && (
            <div className={panels.projMetaRow}>
              <dt className={panels.projMetaLabel}>Reviews</dt>
              <dd className={panels.projMetaValue}>{review.rounds.length}</dd>
            </div>
          )}
        </dl>

        {issue.blockedBy.length > 0 && (
          <Blockers
            issue={issue}
            byId={byId}
            incomplete={new Set(incomplete)}
          />
        )}

        <dl className={panels.briefGrid}>
          <BriefField label="In scope" body={issue.inScope} />
          <BriefField label="Out of scope" body={issue.outOfScope} />
          <BriefField
            label="Completion criteria"
            body={issue.completionCriteria}
          />
        </dl>
      </div>
    </div>
  );
}

// One review round's detail: what the round concluded, and **who** concluded it. A round
// that sent the issue back names the reviewer that ended it and lists the items it
// returned (the brief the next attempt was dispatched with); a round that approved names
// the reviewers that approved, since acceptance needs all of them.
function ReviewDetail({
  issue,
  round,
  index,
}: {
  issue: GgBoardIssue;
  round: IssueReviewRound | null;
  index: number;
}) {
  if (!round) {
    return (
      <div className={panels.panelBody}>
        <p className={panels.empty}>
          This review round is no longer on the board.
        </p>
      </div>
    );
  }
  return (
    <div className={panels.panelBody}>
      <div className={panels.projDetail}>
        {/* No verdict badge: what the round concluded is already the thing the body says
            — who requested changes or who approved, and the items — so a badge repeating
            it in front of the title only crowded the header. */}
        <header className={panels.projDetailHead}>
          <h3 className={panels.projDetailTitle}>Review {index + 1}</h3>
          <span className={panels.issueId}>{issue.id}</span>
        </header>

        {round.phase === "requested" && (
          <p className={panels.empty}>
            The reviewers are looking at this attempt's diff — no verdict yet.
          </p>
        )}

        {round.reviewer && (
          <ReviewerList
            label="Changes requested by"
            reviewers={[round.reviewer]}
          />
        )}
        {round.approvals.length > 0 && (
          <ReviewerList label="Approved by" reviewers={round.approvals} />
        )}

        {round.items.length > 0 && <ReviewItems items={round.items} />}
      </div>
    </div>
  );
}

// The reviewers behind one verdict: each as the agent gg dispatched (whose id names the
// issue, the attempt, and the review pass — `AUTH-1.0i.0r`) with the profile it ran
// under, so a verdict is attributable to a specific pass rather than to "the review".
function ReviewerList({
  label,
  reviewers,
}: {
  label: string;
  reviewers: GgReviewer[];
}) {
  const nav = useGgExplorerNav();
  return (
    <div className={panels.projMetaRow}>
      {/* A wider label than the issue meta rows carry: "Changes requested by" does not
          fit the width an issue's one-word labels are sized to, and wrapping it onto a
          second line pulls the row apart. */}
      <span className={cx(panels.projMetaLabel, panels.projMetaLabelWide)}>
        {label}
      </span>
      <span className={panels.projMetaValue}>
        {reviewers.map((reviewer, i) => (
          <span key={reviewer.agentId}>
            {i > 0 && ", "}
            {nav ? (
              <button
                type="button"
                className={panels.projAgentLink}
                onClick={() => nav.openAgent(reviewer.agentId)}
              >
                {reviewer.agentId}
              </button>
            ) : (
              reviewer.agentId
            )}{" "}
            <span className={panels.issueId}>({reviewer.profile})</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// One field of an issue's brief. The body is the model's own prose — it writes these as
// Markdown (bulleted scope lists, backticked identifiers), so it is rendered as Markdown
// rather than shown as source.
function BriefField({ label, body }: { label: string; body: string }) {
  return (
    <div className={panels.briefField}>
      <dt className={panels.briefLabel}>{label}</dt>
      <dd className={panels.briefText}>
        {body ? <Markdown breaks>{body}</Markdown> : "—"}
      </dd>
    </div>
  );
}

// Count a bucket of issues by the state each one shows, so an epic reads its progress in
// the same vocabulary its issues do.
function countByState(
  issues: GgBoardIssue[],
  byId: Map<string, GgBoardIssue>,
): Record<IssueState, number> {
  const counts = {
    blocked: 0,
    ready: 0,
    in_progress: 0,
    in_review: 0,
    approved: 0,
    failed: 0,
  };
  for (const issue of issues) counts[issueState(issue, byId)] += 1;
  return counts;
}
