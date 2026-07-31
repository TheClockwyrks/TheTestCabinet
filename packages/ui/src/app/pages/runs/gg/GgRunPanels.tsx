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
import { GgAgentsSummary } from "./GgAgentsSummary";
import { GgModulesExplorer, type GgModuleFocus } from "./GgModulesExplorer";
import { ProjectExplorer } from "./ProjectExplorer";
import { MODULE_CAPABILITY_IDS, anyAgentCapabilityOn } from "./ggCatalog";
import type { AgentEntry } from "./ggAgentEntries";
import { GgExplorerNavContext, type GgExplorerNav } from "./GgExplorerNav";

// The surfaces a gg run is read through. gg is headless, so these are the only
// window into what it did:
//
// - Dashboard is the whole-run read-out — status, the token/cost tally and its
//   caching/reasoning split, an overview of the agents that ran, the configuration.
//   An agent row on that overview links into the Instances explorer, which the panels
//   wire through {@link GgExplorerNavContext}.
// - Agents is the run read per *configured* agent: the profiles the capability set
//   declares, each with its instances summed into one read-out — how many of it ran,
//   what they spent between them, and which files and tools filled their windows.
//   That is the grain a configuration is tuned at (twelve reviewer instances are one
//   arm of the experiment, not twelve), and it is the only view that answers it. It is
//   also where **agent-scoped** module state is read: a store every instance of one
//   profile binds at once belongs to the profile rather than to any of its instances, so
//   its contents are shown there, once, rather than repeated under twelve agents. See
//   {@link GgAgentsSummary}.
// - Instances is the same run read one running agent at a time. The rich per-instance
//   views (the prompt it was given, its activity, its context window, what it spent) are
//   inherently *per instance* — whose window filled, who was told what — so they cannot
//   be shown as one global panel; instead they live inside an explorer that lays the run
//   out as a filesystem (an instance is a folder, the things you can monitor about it are
//   its files, and a subagent is a folder under its spawner). Each instance also carries a
//   `modules` folder holding the module instances it holds — its memories, its task list,
//   its handle on the board — which are no longer per-agent things at all: a store can be
//   shared, carried or copied between instances, so it is read as a store with holders
//   rather than as a property of one agent. See {@link GgAgentsExplorer}.
// - Modules is the run read by the state it *holds* rather than by who holds it: every
//   module instance the run opened, grouped by kind, each with its holders, its lifetime
//   (created, carried, copied, linked, dropped) and what it costs the windows carrying it.
//   It exists because a module instance is no longer in one-to-one correspondence with an
//   agent instance — one store four reviewers share looks exactly like four stores that
//   happen to agree in every per-agent view — and because "is this capability being used
//   the way it was configured to be?" is a question about the store, not about any agent.
//   See {@link GgModulesExplorer}.
// - Project is the run-global epic/issue board, offered only when the
//   project-management capability is on. The board is shared run-wide (issues
//   auto-dispatch to top-level agents), so it is one whole-run surface rather than a
//   per-agent file. See {@link ProjectExplorer}.
export type MonitorTab =
  | "dashboard"
  | "agents"
  | "instances"
  | "modules"
  | "project";

// The order the run is read in: the run, then the profiles, then the instances, then the
// state those instances hold, then the board they share.
const TAB_LABELS: ReadonlyArray<SegmentedOption<MonitorTab>> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "agents", label: "Agents" },
  { value: "instances", label: "Instances" },
  { value: "modules", label: "Modules" },
  { value: "project", label: "Project" },
];

/**
 * The tabs this run justifies. Agents and Instances are unconditional — every run has at
 * least the root agent to read, at either grain. Dashboard is offered only when the host
 * supplies one (`hasDashboard`); both hosts do today, but the panel set is the host's to
 * compose. Project is offered when ANY of the run's agent profiles has the
 * project-management capability on — a run with no board has nothing to show there, but the
 * board is one shared thing, so which profile happens to author it does not decide whether
 * the run has one.
 *
 * Modules is offered on the same terms, over the whole set of module-backed capabilities:
 * a run whose profiles enable none of them holds nothing but one window per instance, and
 * a tab that can only ever list those is worse than no tab. Once the run has earned the
 * surface the windows are shown in it too — a window's lineage across an `exec` is worth
 * reading there.
 */
export function ggTabsFor(
  hasDashboard: boolean,
  capabilitySet: GgCapabilitySet | null,
): ReadonlyArray<SegmentedOption<MonitorTab>> {
  return TAB_LABELS.filter(({ value }) => {
    if (value === "dashboard") return hasDashboard;
    if (value === "modules")
      return [...MODULE_CAPABILITY_IDS.values()].some((id) =>
        anyAgentCapabilityOn(capabilitySet, id),
      );
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
  | "fsmPath"
  | "transitions"
  | "speculations"
  | "perAgent"
  | "board"
  | "issueReviews"
  // The latest contents of every module instance the run mentioned, keyed by module id.
  // Cross-agent by construction — a store two agents share has one content — so it comes
  // off the whole-run reduction rather than off any one agent's slice.
  | "moduleSnapshots"
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
 * The tabbed view a gg run is read through: the whole-run Dashboard, the per-configured-agent
 * Agents panel, and the per-instance Instances explorer.
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
    fsmPath,
    transitions,
    speculations,
    perAgent,
    board,
    issueReviews,
    moduleSnapshots,
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

  // The instance to focus when an agent link jumps to one — the Dashboard's overview, an
  // instance chip on the Agents panel, an issue's assigned agent: switching to the
  // Instances tab and handing the explorer the id to select, plus the entry to land on
  // when the caller named one. A one-shot request the explorer clears once it has
  // revealed the instance.
  const [focusAgent, setFocusAgent] = useState<string | null>(null);
  const [focusEntry, setFocusEntry] = useState<AgentEntry | null>(null);
  // The same one-shot channel for the other two explorers a surface can hand a reader
  // through to: one module instance on the Modules tab (a module file's "open in Modules",
  // which is the store read as a store rather than as this agent's hold on it) and one
  // configured agent's row on the Agents tab (a holder's profile — "is this how that arm is
  // configured?"). Each is cleared through its own handler, so consuming one request cannot
  // silently drop another that arrived in the same render.
  const [focusModule, setFocusModule] = useState<GgModuleFocus | null>(null);
  const [focusProfile, setFocusProfile] = useState<string | null>(null);
  // Whether there is a Modules tab to hand anybody through to. Every instance of every run
  // holds a `history` module — the window has no capability behind it — so a module file
  // and a profile's module row both exist in runs this tab is (rightly) not offered for,
  // and an unconditional link would switch to a tab the validity effect below immediately
  // falls back out of. The two module openers are therefore withheld rather than dead: a
  // caller with no `openModule` renders no button at all.
  const hasModules = tabs.some((option) => option.value === "modules");
  const nav: GgExplorerNav = useMemo(
    () => ({
      openAgent: (agentId, entry) => {
        setTab("instances");
        setFocusAgent(agentId);
        setFocusEntry(entry ?? null);
      },
      openModule: hasModules
        ? (moduleId) => {
            setTab("modules");
            setFocusModule({ kind: "module", moduleId });
          }
        : undefined,
      openModuleKind: hasModules
        ? (moduleKind) => {
            setTab("modules");
            setFocusModule({ kind: "group", moduleKind });
          }
        : undefined,
      openProfile: (name) => {
        setTab("agents");
        setFocusProfile(name);
      },
      openProject: () => setTab("project"),
    }),
    [hasModules],
  );
  const onAgentFocusHandled = useCallback(() => {
    setFocusAgent(null);
    setFocusEntry(null);
  }, []);
  const onModuleFocusHandled = useCallback(() => setFocusModule(null), []);
  const onProfileFocusHandled = useCallback(() => setFocusProfile(null), []);

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

        {/* The Agents panel is a set of cards, like the Dashboard's, so it is not wrapped
            in the shared panel body — the cards are already the frame. */}
        {tab === "agents" && (
          <GgAgentsSummary
            capabilitySet={capabilitySet}
            agentForest={agentForest}
            perAgent={perAgent}
            transitions={transitions}
            moduleSnapshots={moduleSnapshots}
            focusProfile={focusProfile}
            onFocusHandled={onProfileFocusHandled}
          />
        )}

        {tab === "instances" && (
          <GgAgentsExplorer
            forest={agentForest}
            perAgent={perAgent}
            capabilitySet={capabilitySet}
            moduleSnapshots={moduleSnapshots}
            workflows={workflows}
            fsmPath={fsmPath}
            transitions={transitions}
            speculations={speculations}
            live={live}
            focusAgent={focusAgent}
            focusEntry={focusEntry}
            onFocusHandled={onAgentFocusHandled}
          />
        )}

        {tab === "modules" && (
          <GgModulesExplorer
            capabilitySet={capabilitySet}
            forest={agentForest}
            perAgent={perAgent}
            transitions={transitions}
            moduleSnapshots={moduleSnapshots}
            focusModule={focusModule}
            onFocusHandled={onModuleFocusHandled}
          />
        )}

        {tab === "project" && (
          <ProjectExplorer board={board} issueReviews={issueReviews} />
        )}
      </div>
    </GgExplorerNavContext.Provider>
  );
}
