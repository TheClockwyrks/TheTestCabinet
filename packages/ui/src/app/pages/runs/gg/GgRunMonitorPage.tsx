import { useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import { useWorkers } from "../../../../client/context";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { KillRunControl } from "../../../components/KillRunControl";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { formatEventTime } from "../../../eventFeed";
import { routes } from "../../../routes";
import runExec from "../RunExec.module.scss";
import styles from "./GgRunMonitorPage.module.scss";
import panels from "./GgPanels.module.scss";
import {
  useGgRunState,
  type FeedTone,
  type GgMonitorStatus,
} from "./useGgRunState";
import { ContextFillGraph } from "./ContextFillGraph";
import { AgentTreeView } from "./AgentTreeView";
import { PlanView } from "./PlanView";
import { BoardView } from "./BoardView";
import { TaskDagView } from "./TaskDagView";
import { SkillsList } from "./SkillsList";
import { MemoriesList } from "./MemoriesList";

// The panels the monitor is organized into. gg is headless, so this is the only
// live window into a run: Activity is the gg-native event feed; Context, Plan,
// Board, Tasks, and Knowledge are the views over the context-window breakdown, the
// planning pass, the live epic/issue board, the blocked-by task DAG, and the
// model's skills/memories. Plan sits ahead of the two work tiers (Board and Tasks)
// it precedes.
// Agents sits beside Activity — the subagent tree is the signature multi-agent
// view, and like Activity it is a live window into the run's shape (who spawned
// whom, who is running vs blocked) rather than a work tier.
type MonitorTab =
  | "activity"
  | "agents"
  | "context"
  | "plan"
  | "board"
  | "tasks"
  | "knowledge";
const TABS: ReadonlyArray<SegmentedOption<MonitorTab>> = [
  { value: "activity", label: "Activity" },
  { value: "agents", label: "Agents" },
  { value: "context", label: "Context" },
  { value: "plan", label: "Plan" },
  { value: "board", label: "Board" },
  { value: "tasks", label: "Tasks" },
  { value: "knowledge", label: "Knowledge" },
];

const numberFmt = new Intl.NumberFormat("en-US");
function formatTokens(n: number): string {
  return numberFmt.format(n);
}
function formatCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}

// The live gg run monitor (`/runs/gg/:jobId/live`, consoles only). gg is
// headless, so this is the ONLY live window into a run. It reads the run's live
// state from `useGgRunState` (which owns the `GET /jobs/{id}/live` subscription and
// folds gg's first-party `GgTelemetryEvent` stream into typed state) and lays it
// out as a cockpit (run status + a running token/cost tally summed from the usage
// deltas) over a tabbed set of panels: the gg-native Activity feed plus the
// Phase-1 Context / Tasks / Knowledge views. Each panel is fed a slice of the
// state and shows a tidy empty state when its capability produced no events. On a
// terminal state it links to the produced run so the scored artifact and the
// recorded capability set can be inspected.
export function GgRunMonitorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { active: worker } = useWorkers();
  const state = useGgRunState(jobId);
  const {
    status,
    error,
    sawSession,
    sessionEndStatus,
    feed,
    usage,
    slotUsage,
    agents,
    agentTree,
    workflows,
    contextSeries,
    latestContext,
    compactions,
    skills,
    memory,
    tasks,
    board,
    plan,
    capabilitySet,
  } = state;

  // Whether the run went multi-agent. When it did, feed rows carry a small agent
  // chip so a line is attributable to its node in the tree; a root-only run stays
  // unchanged (no chips), keeping the common case unobtrusive.
  const multiAgent = agents.size > 1;

  const [tab, setTab] = useState<MonitorTab>("activity");

  // Whether the Activity feed auto-follows the newest row. On by default;
  // scrolling up turns it off, and toggling it back on snaps to the bottom and
  // resumes.
  const [following, setFollowing] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!following) return;
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length, following, tab]);

  const onFeedScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    // Within a row's height of the bottom counts as "at the bottom".
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setFollowing(atBottom);
  };

  // --- Status presentation --------------------------------------------------
  const phase = statusPhase(status, sawSession);

  return (
    <PageLayout fill>
      <PromptHeader
        command="--gg watch"
        comment={<>// live telemetry for a gg run</>}
        arg={jobId ?? ""}
      />

      {!worker && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          No worker connected — the live stream comes from the worker that ran
          this job.
        </p>
      )}

      {/* The cockpit: run status + the running token/cost tally. */}
      <div className={styles.cockpit}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Status</span>
          <div className={styles.statusLine}>
            <span className={`${styles.pill} ${phase.pillClass}`}>
              {phase.label}
            </span>
            {phase.detail && (
              <span className={styles.statusDetail}>{phase.detail}</span>
            )}
            {status.kind === "running" && jobId && (
              <span className={styles.statusKill}>
                <KillRunControl runId={jobId} />
              </span>
            )}
          </div>
          {sessionEndStatus && status.kind === "running" && (
            <span className={styles.statusDetail}>
              gg session ended: {sessionEndStatus} — finalizing…
            </span>
          )}
        </div>

        <div className={styles.card}>
          <span className={styles.cardLabel}>Tokens &amp; cost</span>
          <span className={styles.metricValue}>
            {usage.anyTokens ? formatTokens(usage.totalTokens) : "—"}{" "}
            <span className={styles.rowArgs}>tokens</span>
          </span>
          <div className={styles.breakdown}>
            <span>
              <span className={styles.breakdownKey}>in</span>
              {formatTokens(usage.uncachedInput)}
            </span>
            <span>
              <span className={styles.breakdownKey}>cached</span>
              {formatTokens(usage.cachedInput)}
            </span>
            <span>
              <span className={styles.breakdownKey}>out</span>
              {formatTokens(usage.output)}
            </span>
            <span>
              <span className={styles.breakdownKey}>reasoning</span>
              {formatTokens(usage.reasoning)}
            </span>
          </div>
          <span className={styles.metricCost}>
            {formatCost(usage.comparable)}
            {usage.actual != null && usage.actual !== usage.comparable && (
              <span className={styles.rowArgs}>
                {" "}
                (actual {formatCost(usage.actual)})
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Terminal outcome + a link to the produced run. */}
      {status.kind === "done" && status.outcome.kind === "completed" && (
        <p className={`${runExec.notice} ${runExec.ok}`}>
          Run complete — state {status.outcome.record.status.state}.{" "}
          <Link to={routes.runDetail(status.outcome.record.id)}>
            Open the run
          </Link>{" "}
          to review it, or{" "}
          <Link to={routes.runMetrics(status.outcome.record.id)}>
            see its metrics
          </Link>
          .
        </p>
      )}
      {status.kind === "done" && status.outcome.kind === "canceled" && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          Run canceled
          {status.outcome.message ? `: ${status.outcome.message}` : ""}.{" "}
          {jobId && (
            <Link to={routes.runDetail(jobId)}>
              Open the run to see what was recorded.
            </Link>
          )}
        </p>
      )}
      {status.kind === "done" && status.outcome.kind === "failed" && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          Run failed: {status.outcome.message}
          {jobId && (
            <>
              {" "}
              <Link to={routes.runDetail(jobId)}>
                Open the run to see what was recorded.
              </Link>
            </>
          )}
        </p>
      )}
      {error && <p className={`${runExec.notice} ${runExec.error}`}>{error}</p>}

      {/* The recorded capability set, once the run has one — the run's exact,
          reproducible configuration (its independent variable). */}
      {capabilitySet && <CapabilitySummary set={capabilitySet} />}

      {/* The panel selector: gg-native activity plus the Phase-1 views. */}
      <div className={panels.tabBar}>
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={setTab}
          ariaLabel="gg monitor panel"
        />
      </div>

      {tab === "activity" && (
        <>
          <div className={styles.feedHeader}>
            <span className={runExec.sectionLabel}>gg activity</span>
            <button
              type="button"
              className={styles.followButton}
              data-active={following ? "" : undefined}
              aria-pressed={following}
              onClick={() => setFollowing((on) => !on)}
            >
              Follow
            </button>
          </div>
          <div className={styles.feed} ref={feedRef} onScroll={onFeedScroll}>
            {feed.length === 0 ? (
              <p className={styles.empty}>
                {status.kind === "running"
                  ? "Waiting for telemetry…"
                  : "No telemetry was recorded."}
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
            <BoardView board={board} />
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
          <RetainedNote count={compactions.length} what="skills and memories" />
          <div className={panels.panelBody}>
            <div className={panels.knowledgeSplit}>
              <div className={panels.subPanel}>
                <span className={panels.subPanelLabel}>Skills</span>
                <SkillsList skills={skills} />
              </div>
              <div className={panels.subPanel}>
                <span className={panels.subPanelLabel}>Memories</span>
                <MemoriesList memory={memory} />
              </div>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}

// The status pill's label, detail, and cue for the current phase. Queued (no gg
// session yet) and running are the two live phases; a terminal state reflects the
// transport outcome — and, where gg reported it, the session's own end status.
function statusPhase(
  status: GgMonitorStatus,
  sawSession: boolean,
): { label: string; detail: string | null; pillClass: string } {
  const live = styles.pillLive ?? "";
  if (status.kind === "running") {
    return sawSession
      ? { label: "Running", detail: "the agent is working", pillClass: live }
      : {
          label: "Queued",
          detail: "waiting for a runner and container",
          pillClass: live,
        };
  }
  switch (status.outcome.kind) {
    case "completed":
      return {
        label: "Completed",
        detail: `state ${status.outcome.record.status.state}`,
        pillClass: styles.pillOk ?? "",
      };
    case "canceled":
      return {
        label: "Canceled",
        detail: "stopped by an operator",
        pillClass: styles.pillFail ?? "",
      };
    case "failed":
      return {
        label: "Failed",
        detail: status.outcome.message,
        pillClass: styles.pillFail ?? "",
      };
  }
}

// A reassurance line shown on the Tasks / Knowledge tabs once a run has crossed a
// compaction boundary: the retention contract kept this state verbatim, so it never
// blanked out when the window was summarized. Renders nothing before any compaction.
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
    case "system":
      return "";
  }
}

// A compact read-out of a completed gg run's recorded capability set — its exact
// configuration: the preset it came from (when named), which capabilities were on,
// and the model bound to each slot.
function CapabilitySummary({ set }: { set: GgCapabilitySet }) {
  const enabled = set.capabilities.filter((c) => c.enabled).map((c) => c.id);
  const primary = set.slots.find((s) => s.slot === "primary") ?? set.slots[0];
  return (
    <div className={`${runExec.notice}`}>
      <div className={styles.capSummary}>
        {set.preset && (
          <span>
            <span className={styles.capSummaryKey}>preset</span>
            {set.preset}
          </span>
        )}
        <span>
          <span className={styles.capSummaryKey}>capabilities</span>
          {enabled.length ? enabled.join(", ") : "none"}
        </span>
        {primary && (
          <span>
            <span className={styles.capSummaryKey}>primary model</span>
            {primary.modelId}
            {primary.provider ? ` (${primary.provider})` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
