import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { formatEventTime } from "../../../eventFeed";
import runExec from "../RunExec.module.scss";
import styles from "./GgRunMonitorPage.module.scss";
import panels from "./GgPanels.module.scss";
import type { FeedTone, GgRunState } from "./useGgRunState";
import { ContextFillGraph } from "./ContextFillGraph";
import { AgentTreeView } from "./AgentTreeView";
import { PlanView } from "./PlanView";
import { BoardView } from "./BoardView";
import { TaskDagView } from "./TaskDagView";
import { SkillsList } from "./SkillsList";
import { MemoriesList } from "./MemoriesList";

// The panels a gg run is read through. gg is headless, so these are the only window
// into what it did: Activity is the gg-native event feed; Context, Plan, Board,
// Tasks, and Knowledge are the views over the context-window breakdown, the planning
// pass, the live epic/issue board, the blocked-by task DAG, and the model's
// skills/memories. Plan sits ahead of the two work tiers (Board and Tasks) it
// precedes.
// Agents sits beside Activity — the subagent tree is the signature multi-agent view,
// and like Activity it is a live window into the run's shape (who spawned whom, who
// is running vs blocked) rather than a work tier.
export type MonitorTab =
  | "activity"
  | "agents"
  | "context"
  | "plan"
  | "board"
  | "tasks"
  | "knowledge";

// Which capabilities a panel needs before it has anything to say. A panel is offered
// when *any* of its capabilities is on — Agents covers all three ways a run grows a
// tree, and Knowledge covers skills and memories independently (its two sub-panels
// are gated separately, below).
//
// The whole point of a first-party harness is that The Test Cabinet knows exactly
// what a run can do, so the console shapes itself to the run rather than offering
// surfaces the configuration disabled. Activity is unconditional: every run emits a
// stream.
const TAB_CAPABILITIES: Record<MonitorTab, ReadonlyArray<string>> = {
  activity: [],
  agents: ["subagents", "workflows", "speculative-execution"],
  context: ["context-visibility"],
  plan: ["planning"],
  board: ["epics-and-issues"],
  tasks: ["tasks"],
  knowledge: ["skills", "memories"],
};

const TAB_LABELS: ReadonlyArray<SegmentedOption<MonitorTab>> = [
  { value: "activity", label: "Activity" },
  { value: "agents", label: "Agents" },
  { value: "context", label: "Context" },
  { value: "plan", label: "Plan" },
  { value: "board", label: "Board" },
  { value: "tasks", label: "Tasks" },
  { value: "knowledge", label: "Knowledge" },
];

/** Whether the run's capability set has the named capability on. */
export function capabilityOn(set: GgCapabilitySet | null, id: string): boolean {
  return set?.capabilities.some((c) => c.id === id && c.enabled) ?? false;
}

/**
 * The panels this run's configuration justifies offering. Until the capability set is
 * known — a run still queued, before gg has announced it on `session_started` — only
 * Activity is offered: nothing else can have produced anything yet, and guessing
 * would put back exactly the surfaces this gating exists to remove.
 */
export function ggTabsFor(
  set: GgCapabilitySet | null,
): ReadonlyArray<SegmentedOption<MonitorTab>> {
  return TAB_LABELS.filter(({ value }) => {
    const needed = TAB_CAPABILITIES[value];
    if (needed.length === 0) return true;
    if (!set) return false;
    return needed.some((id) => capabilityOn(set, id));
  });
}

// The slice of a gg run's state the panels render. Both the live monitor and the
// finished run's gg tab reduce the same telemetry stream, so both feed this.
export type GgPanelState = Pick<
  GgRunState,
  | "feed"
  | "agents"
  | "agentTree"
  | "slotUsage"
  | "workflows"
  | "speculations"
  | "contextSeries"
  | "latestContext"
  | "compactions"
  | "skills"
  | "memory"
  | "tasks"
  | "board"
  | "plan"
  | "codeReviews"
>;

interface GgRunPanelsProps {
  state: GgPanelState;
  /** The run's configuration — what gates which panels are offered at all. */
  capabilitySet: GgCapabilitySet | null;
  /**
   * Whether the stream is still arriving. A live feed auto-follows its newest row and
   * says it is waiting on telemetry; a finished one is a fixed record, so it does
   * neither.
   */
  live: boolean;
}

/**
 * The tabbed panel set a gg run is read through, shaped to the run's capability set.
 *
 * Shared by the live monitor (`/runs/gg/:jobId/live`) and a finished run's gg tab
 * (`/runs/:runId/gg`) so a run reads the same way while it happens and afterwards —
 * the rich view is not something that disappears once the run ends.
 */
export function GgRunPanels({ state, capabilitySet, live }: GgRunPanelsProps) {
  const {
    feed,
    agents,
    agentTree,
    slotUsage,
    workflows,
    speculations,
    contextSeries,
    latestContext,
    compactions,
    skills,
    memory,
    tasks,
    board,
    plan,
    codeReviews,
  } = state;

  const tabs = ggTabsFor(capabilitySet);
  const [tab, setTab] = useState<MonitorTab>("activity");
  // The offered set grows the moment gg announces its configuration. A tab that is no
  // longer offered (a configuration resolved differently than the one last watched)
  // must not leave the panel body showing something the strip no longer selects.
  useEffect(() => {
    if (!tabs.some((t) => t.value === tab)) setTab("activity");
  }, [tabs, tab]);

  // Whether the Activity feed auto-follows the newest row. On by default while live;
  // scrolling up turns it off, and toggling it back on snaps to the bottom and
  // resumes.
  const [following, setFollowing] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!live || !following) return;
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length, following, tab, live]);

  const onFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    // Within a row's height of the bottom counts as "at the bottom".
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setFollowing(atBottom);
  };

  // Whether the run went multi-agent. When it did, feed rows carry a small agent
  // chip so a line is attributable to its node in the tree; a root-only run stays
  // unchanged (no chips), keeping the common case unobtrusive.
  const multiAgent = agents.size > 1;
  const showSkills = capabilityOn(capabilitySet, "skills");
  const showMemories = capabilityOn(capabilitySet, "memories");

  return (
    <>
      {/* The panel selector, carrying only what this run's configuration turned on. */}
      <div className={panels.tabBar}>
        <SegmentedControl
          options={tabs}
          value={tab}
          onChange={setTab}
          ariaLabel="gg panel"
        />
      </div>

      {tab === "activity" && (
        <>
          <div className={styles.feedHeader}>
            <span className={runExec.sectionLabel}>gg activity</span>
            {live && (
              <button
                type="button"
                className={styles.followButton}
                data-active={following ? "" : undefined}
                aria-pressed={following}
                onClick={() => setFollowing((on) => !on)}
              >
                Follow
              </button>
            )}
          </div>
          <div className={styles.feed} ref={feedRef} onScroll={onFeedScroll}>
            {feed.length === 0 ? (
              <p className={styles.empty}>
                {live ? "Waiting for telemetry…" : "No telemetry was recorded."}
              </p>
            ) : (
              feed.map((row) => (
                <div
                  key={row.key}
                  className={`${styles.row} ${toneClass(row.tone)}`}
                >
                  <div className={styles.rowGutter}>
                    <span className={styles.rowLabel}>{row.label}</span>
                    {multiAgent && row.agentId && (
                      <span className={styles.rowAgent}>
                        {row.agentId === "root" ? "root" : row.agentId}
                      </span>
                    )}
                    <span className={styles.rowTime}>
                      {formatEventTime(row.timestamp)}
                    </span>
                  </div>
                  <div className={styles.rowBody}>
                    {row.detail}
                    {row.args && (
                      <div className={styles.rowArgs}>{row.args}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {tab === "agents" && (
        <>
          <span className={runExec.sectionLabel}>agent tree</span>
          <div className={panels.panelBody}>
            <AgentTreeView
              tree={agentTree}
              slotUsage={slotUsage}
              workflows={workflows}
              speculations={speculations}
            />
          </div>
        </>
      )}

      {tab === "context" && (
        <>
          <span className={runExec.sectionLabel}>context window</span>
          <div className={panels.panelBody}>
            <ContextFillGraph
              series={contextSeries}
              latest={latestContext}
              compactions={compactions}
              planImplementTurn={plan?.implementTurn ?? null}
            />
          </div>
        </>
      )}

      {tab === "plan" && (
        <>
          <span className={runExec.sectionLabel}>plan</span>
          <RetainedNote count={compactions.length} what="submitted plan" />
          <div className={panels.panelBody}>
            <PlanView plan={plan} />
          </div>
        </>
      )}

      {tab === "board" && (
        <>
          <span className={runExec.sectionLabel}>board</span>
          <RetainedNote count={compactions.length} what="epic/issue board" />
          <div className={panels.panelBody}>
            <BoardView board={board} codeReviews={codeReviews} />
          </div>
        </>
      )}

      {tab === "tasks" && (
        <>
          <span className={runExec.sectionLabel}>tasks</span>
          <RetainedNote count={compactions.length} what="task list" />
          <div className={panels.panelBody}>
            <TaskDagView tasks={tasks} />
          </div>
        </>
      )}

      {tab === "knowledge" && (
        <>
          <span className={runExec.sectionLabel}>knowledge</span>
          <RetainedNote
            count={compactions.length}
            what={knowledgeLabel(showSkills, showMemories)}
          />
          <div className={panels.panelBody}>
            {/* Each half is shown only when its own capability is on, so a
                memories-only run reads as a memories panel, not a half-empty split. */}
            <div className={panels.knowledgeSplit}>
              {showSkills && (
                <div className={panels.subPanel}>
                  <span className={panels.subPanelLabel}>Skills</span>
                  <SkillsList skills={skills} />
                </div>
              )}
              {showMemories && (
                <div className={panels.subPanel}>
                  <span className={panels.subPanelLabel}>Memories</span>
                  <MemoriesList memory={memory} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// What the Knowledge panel's retention note calls what it kept, named for the halves
// this run actually has.
function knowledgeLabel(skills: boolean, memories: boolean): string {
  if (skills && memories) return "skills and memories";
  return skills ? "skills" : "memories";
}

// A reassurance line shown on the Plan / Board / Tasks / Knowledge panels once a run
// has crossed a compaction boundary: the retention contract kept this state verbatim,
// so it never blanked out when the window was summarized. Renders nothing before any
// compaction.
function RetainedNote({ count, what }: { count: number; what: string }) {
  if (count === 0) return null;
  return (
    <p className={panels.retainedNote}>
      Retained verbatim across {count} compaction{count === 1 ? "" : "s"} — the{" "}
      {what} carried over.
    </p>
  );
}

function toneClass(tone: FeedTone): string {
  switch (tone) {
    case "agent":
      return styles.toneAgent ?? "";
    case "tool":
      return styles.toneTool ?? "";
    case "ok":
      return styles.toneOk ?? "";
    case "fail":
      return styles.toneFail ?? "";
    case "warn":
      return styles.toneWarn ?? "";
    case "compact":
      return styles.toneCompact ?? "";
    case "plan":
      return styles.tonePlan ?? "";
    case "fsm":
      return styles.toneFsm ?? "";
    case "system":
      return "";
  }
}
