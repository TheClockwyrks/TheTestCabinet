import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import runExec from "../RunExec.module.scss";
import panels from "./GgPanels.module.scss";
import type { GgRunState } from "./useGgRunState";
import { GgAgentsExplorer } from "./GgAgentsExplorer";

// The two surfaces a gg run is read through. gg is headless, so these are the only
// window into what it did:
//
// - Dashboard is the whole-run read-out — status, the token/cost tally and its
//   caching/reasoning split, how many agents ran, the configuration.
// - Agents is everything else. The rich per-agent views (activity, context, plan,
//   board, tasks, knowledge) are inherently *per agent* — whose window filled,
//   whose task list this is — so they cannot be shown as one global panel; instead
//   they live inside the Agents explorer, which lays the run out as a filesystem
//   (an agent is a folder, the things you can monitor about it are its files, and a
//   subagent is a folder under its spawner). See {@link GgAgentsExplorer}.
export type MonitorTab = "dashboard" | "agents";

const TAB_LABELS: ReadonlyArray<SegmentedOption<MonitorTab>> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "agents", label: "Agents" },
];

/**
 * The tabs this run justifies. Agents is unconditional — every run has at least the
 * root agent to read. Dashboard is offered only when the host supplies one
 * (`hasDashboard`); both hosts do today, but the panel set is the host's to compose.
 */
export function ggTabsFor(
  hasDashboard: boolean,
): ReadonlyArray<SegmentedOption<MonitorTab>> {
  return TAB_LABELS.filter(({ value }) =>
    value === "dashboard" ? hasDashboard : true,
  );
}

// The slice of a gg run's state the panels render. Both the live monitor and the
// finished run's gg tab reduce the same telemetry stream, so both feed this: the
// delegation tree and its run-level structure (per-slot usage, workflows,
// speculations) for the explorer, plus the per-agent reductions its files read.
export type GgPanelState = Pick<
  GgRunState,
  "agentTree" | "slotUsage" | "workflows" | "speculations" | "perAgent"
>;

interface GgRunPanelsProps {
  state: GgPanelState;
  /** The run's configuration — decides which context bands the explorer lists. */
  capabilitySet: GgCapabilitySet | null;
  /**
   * Whether the stream is still arriving. A live activity feed auto-follows its
   * newest row and says it is waiting on telemetry; a finished one is a fixed
   * record, so it does neither.
   */
  live: boolean;
  /**
   * The Dashboard panel's content — the host's run-level read-out (see `GgDashboard`).
   * When given it becomes the first tab offered, and the one selected by default.
   */
  dashboard?: ReactNode;
}

/**
 * The tabbed view a gg run is read through: the whole-run Dashboard, and the
 * per-agent Agents explorer.
 *
 * Shared by the live monitor (`/runs/gg/:jobId/live`) and a finished run's gg tab
 * (`/runs/:runId/gg`) so a run reads the same way while it happens and afterwards —
 * the rich view is not something that disappears once the run ends.
 */
export function GgRunPanels({
  state,
  capabilitySet,
  live,
  dashboard,
}: GgRunPanelsProps) {
  const { agentTree, slotUsage, workflows, speculations, perAgent } = state;

  const hasDashboard = dashboard != null;
  const tabs = useMemo(() => ggTabsFor(hasDashboard), [hasDashboard]);
  const [tab, setTab] = useState<MonitorTab>(() => tabs[0]?.value ?? "agents");
  // If the Dashboard is (un)supplied after mount, keep the selected tab valid.
  useEffect(() => {
    if (!tabs.some((t) => t.value === tab)) setTab(tabs[0]?.value ?? "agents");
  }, [tabs, tab]);

  return (
    <>
      {/* The tab selector, leading the view. */}
      <div className={panels.tabBar}>
        <SegmentedControl
          options={tabs}
          value={tab}
          onChange={setTab}
          ariaLabel="gg panel"
        />
      </div>

      {/* The Dashboard's own content is a set of cards, each already a panel, so it
          is not wrapped in the shared panel body — that would frame a frame. */}
      {tab === "dashboard" && (
        <>
          <span className={runExec.sectionLabel}>dashboard</span>
          {dashboard}
        </>
      )}

      {tab === "agents" && (
        <GgAgentsExplorer
          tree={agentTree}
          perAgent={perAgent}
          capabilitySet={capabilitySet}
          slotUsage={slotUsage}
          workflows={workflows}
          speculations={speculations}
          live={live}
        />
      )}
    </>
  );
}
