import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SegmentedControl, type SegmentedOption } from "@test-cabinet/ui";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type { GgRunState } from "./useGgRunState";
import { GgAgentsExplorer } from "./GgAgentsExplorer";
import { ProjectExplorer } from "./ProjectExplorer";
import { anyAgentCapabilityOn } from "./ggCatalog";
import { GgExplorerNavContext, type GgExplorerNav } from "./GgExplorerNav";

// The two surfaces a gg run is read through. gg is headless, so these are the only
// window into what it did:
//
// - Dashboard is the whole-run read-out — status, the token/cost tally and its
//   caching/reasoning split, an overview of the agents that ran, the configuration.
//   An agent row on that overview links into the Agents explorer, which the panels
//   wire through {@link GgExplorerNavContext}.
// - Agents is everything else. The rich per-agent views (the prompt the agent was
//   given, activity, context, plan, tasks, knowledge) are inherently *per agent* —
//   whose window filled, whose task list this is — so they cannot be shown as one
//   global panel; instead they live inside the Agents explorer, which lays the run out
//   as a filesystem (an agent is a folder, the things you can monitor about it are its
//   files, and a subagent is a folder under its spawner). See {@link GgAgentsExplorer}.
// - Project is the run-global epic/issue board, offered only when the
//   project-management capability is on. The board is shared run-wide (issues
//   auto-dispatch to top-level agents), so it is one whole-run surface rather than a
//   per-agent file. See {@link ProjectExplorer}.
export type MonitorTab = "dashboard" | "agents" | "project";

const TAB_LABELS: ReadonlyArray<SegmentedOption<MonitorTab>> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "agents", label: "Agents" },
  { value: "project", label: "Project" },
];

/**
 * The tabs this run justifies. Agents is unconditional — every run has at least the
 * root agent to read. Dashboard is offered only when the host supplies one
 * (`hasDashboard`); both hosts do today, but the panel set is the host's to compose.
 * Project is offered when ANY of the run's agent profiles has the project-management
 * capability on — a run with no board has nothing to show there, but the board is one
 * shared thing, so which profile happens to author it does not decide whether the run
 * has one.
 */
export function ggTabsFor(
  hasDashboard: boolean,
  capabilitySet: GgCapabilitySet | null,
): ReadonlyArray<SegmentedOption<MonitorTab>> {
  return TAB_LABELS.filter(({ value }) => {
    if (value === "dashboard") return hasDashboard;
    if (value === "project")
      return anyAgentCapabilityOn(capabilitySet, "project-management");
    return true;
  });
}

// The slice of a gg run's state the panels render. Both the live monitor and the
// finished run's gg tab reduce the same telemetry stream, so both feed this: the
// delegation tree and its run-level structure (workflows, speculations) for the
// explorer, plus the per-agent reductions its files read. (The run's per-slot spend is
// the Dashboard's, which each host composes itself and hands in as `dashboard`.)
export type GgPanelState = Pick<
  GgRunState,
  | "agentForest"
  | "workflows"
  | "speculations"
  | "perAgent"
  | "board"
  | "issueReviews"
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
  const {
    agentForest,
    workflows,
    speculations,
    perAgent,
    board,
    issueReviews,
  } = state;

  const hasDashboard = dashboard != null;
  const tabs = useMemo(
    () => ggTabsFor(hasDashboard, capabilitySet),
    [hasDashboard, capabilitySet],
  );
  const [tab, setTab] = useState<MonitorTab>(() => tabs[0]?.value ?? "agents");
  // If the Dashboard is (un)supplied after mount, keep the selected tab valid.
  useEffect(() => {
    if (!tabs.some((t) => t.value === tab)) setTab(tabs[0]?.value ?? "agents");
  }, [tabs, tab]);

  // The agent to focus when the Dashboard's overview jumps to one: switching to the
  // Agents tab and handing the explorer the id to select. A one-shot request the
  // explorer clears once it has revealed the agent.
  const [focusAgent, setFocusAgent] = useState<string | null>(null);
  const nav: GgExplorerNav = useMemo(
    () => ({
      openAgent: (agentId) => {
        setTab("agents");
        setFocusAgent(agentId);
      },
    }),
    [],
  );
  const onFocusHandled = useCallback(() => setFocusAgent(null), []);

  return (
    <GgExplorerNavContext.Provider value={nav}>
      {/* The panels own their own vertical rhythm (see `.panelsRoot`) so the space
          below the selector reads the same on both hosts — the live monitor's gapless
          fill column and the finished run's gapped section — rather than inheriting
          whichever gap the host container happens to carry. */}
      <div className={panels.panelsRoot}>
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
            is not wrapped in the shared panel body — that would frame a frame. The tab
            selector directly above already reads "Dashboard", so no section label
            restates it here. */}
        {tab === "dashboard" && dashboard}

        {tab === "agents" && (
          <GgAgentsExplorer
            forest={agentForest}
            perAgent={perAgent}
            capabilitySet={capabilitySet}
            workflows={workflows}
            speculations={speculations}
            live={live}
            focusAgent={focusAgent}
            onFocusHandled={onFocusHandled}
          />
        )}

        {tab === "project" && (
          <ProjectExplorer board={board} issueReviews={issueReviews} />
        )}
      </div>
    </GgExplorerNavContext.Provider>
  );
}
