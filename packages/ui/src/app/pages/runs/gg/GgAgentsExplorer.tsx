import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { FeedView, type FeedLine } from "../../../components/FeedView";
import { useAppSettings } from "../../../store/appSettings";
import runExec from "../RunExec.module.scss";
import panels from "./GgPanels.module.scss";
import dash from "./GgDashboard.module.scss";
import type {
  AgentNode,
  AgentTreeNode,
  DerivedGgState,
  FeedRow,
  GgToolBreakdown,
  SpeculationState,
  Workflow,
} from "./useGgRunState";
import { ROOT_ID, ggToolBreakdown, shortTokens } from "./useGgRunState";
import { capabilityOn } from "./ggCatalog";
import { soleModelId, useGgCostBreakdown } from "./ggCost";
import { CostWidget, TokensWidget, formatPercent } from "./GgOverviewWidgets";
import {
  AgentIdentity,
  SpeculationPanel,
  WorkflowStrip,
  classifySpeculationRoles,
  type SpeculationRole,
} from "./AgentTreeView";
import { ContextFillGraph, ContextUsageBar } from "./ContextFillGraph";
import { PromptView } from "./PromptView";
import { RequestsView } from "./RequestsView";
import { CompactionView } from "./CompactionView";
import { PlanView } from "./PlanView";
import { TaskDagView } from "./TaskDagView";
import { SkillsList } from "./SkillsList";
import { MemoriesList } from "./MemoriesList";
import {
  ActivityIcon,
  CompactionIcon,
  ContextIcon,
  FolderIcon,
  FolderOpenIcon,
  KnowledgeIcon,
  OverviewIcon,
  PlanIcon,
  PromptIcon,
  RequestsIcon,
  TasksIcon,
} from "./ggIcons";

// The Agents explorer: a gg run read agent by agent, laid out like a filesystem.
//
// gg is headless and multi-agent, so a single globally-merged view cannot say
// *whose* context filled, *whose* task list this is, or what one subagent did in
// isolation — those are per-agent facts (see gg/subagents.md). The explorer makes
// each agent a folder whose "files" are the things a run lets you monitor about it
// (its activity, its context-window fill, its plan, its tasks, its knowledge), and
// nests every agent an agent spawned under a `subagents` folder, so
// the delegation tree *is* the directory tree. The top-level folder is the main
// (root) agent. Selecting a file opens that view for that agent in the content pane
// — the same rich panels a gg run has always been read through, now scoped to one
// agent rather than blurred across all of them.

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// One gg telemetry row as a shared feed line. The tone doubles as the palette key
// (the stylesheet maps gg's tones onto the same `--ttc-event-*` tokens the harness
// event types use). Within a single agent's activity every row is the same agent,
// so no attribution chip is added.
function ggFeedLine(row: FeedRow): FeedLine {
  const line: FeedLine = {
    eventType: row.tone,
    label: row.label.toUpperCase(),
    timestamp: row.timestamp,
    detail: row.detail,
  };
  if (row.args) line.args = row.args;
  return line;
}

// The "files" an agent folder can contain — the things a gg run lets you monitor
// about one agent.
export type AgentFileKind =
  | "overview"
  | "prompt"
  | "activity"
  | "context"
  | "requests"
  | "compaction"
  | "plan"
  | "tasks"
  | "knowledge";

// The order files list in a folder. Prompt sits right after Overview — reading an
// agent starts with what it *is* and then what it was *told* (for a subagent, the
// brief its parent handed it). Requests sits beside Context — it is the itemized,
// message-level companion to the stacked Context graph — and Compaction follows, the
// detail behind the Context graph's compaction markers.
const FILE_ORDER: ReadonlyArray<AgentFileKind> = [
  "overview",
  "prompt",
  "activity",
  "context",
  "requests",
  "compaction",
  "plan",
  "tasks",
  "knowledge",
];

// Which capabilities a file needs before it is worth offering — a file is shown
// when *any* of its capabilities is on (Knowledge covers skills and memories
// independently). An empty list is unconditional: overview and activity read gg's
// own account of any run, and Context is always offered because every run has a
// window that fills. This mirrors the run's [capability set], so the folder shows a
// file for a capability the run *has* even before that capability has produced
// anything — the file then shows its own "nothing yet" state rather than being
// absent — and hides a file only for a capability the run does not have at all.
const FILE_CAPABILITIES: Record<AgentFileKind, ReadonlyArray<string>> = {
  overview: [],
  // Unconditional: a subagent's brief rides on the (always-present) spawn event, and
  // the root's opening prompt is a first-class thing to read. When the *rendered*
  // prompt isn't recorded (context visibility off), the file shows the brief or says
  // so rather than being absent — the same "offered, may be empty" contract as
  // overview and activity.
  prompt: [],
  activity: [],
  context: [],
  // The message log rides on the same capability as the breakdown graph (see
  // gg/context-visibility): with context visibility off, gg emits neither, so the file
  // is hidden rather than shown perpetually empty.
  requests: ["context-visibility"],
  // The Compaction file rides on the compaction capability itself: with the backstop
  // off, a run never compacts, so the file is hidden rather than shown perpetually
  // empty. Its own record travels on the compaction event, so it needs nothing else.
  compaction: ["compaction"],
  plan: ["planning"],
  tasks: ["tasks"],
  knowledge: ["skills", "memories"],
};

const FILE_LABELS: Record<AgentFileKind, string> = {
  overview: "overview",
  prompt: "prompt",
  activity: "activity",
  context: "context",
  requests: "requests",
  compaction: "compaction",
  plan: "plan",
  tasks: "tasks",
  knowledge: "knowledge",
};

// A leading icon per file kind, drawn from the shared line-art set (see ggIcons)
// so the tree scans like a real file browser rather than by ad-hoc glyphs.
const FILE_ICONS: Record<
  AgentFileKind,
  ComponentType<{ className?: string }>
> = {
  overview: OverviewIcon,
  prompt: PromptIcon,
  activity: ActivityIcon,
  context: ContextIcon,
  requests: RequestsIcon,
  compaction: CompactionIcon,
  plan: PlanIcon,
  tasks: TasksIcon,
  knowledge: KnowledgeIcon,
};

// Which files a folder offers, given the run's configuration. A file is offered
// when the run's capability set justifies it — so a file for an enabled capability
// is always present (showing its own empty state until data arrives) and a file for
// a capability the run does not have is never shown. Before gg announces the set
// (set == null), only the unconditional files are offered.
function filesFor(set: GgCapabilitySet | null): AgentFileKind[] {
  return FILE_ORDER.filter((file) => {
    const needed = FILE_CAPABILITIES[file];
    if (needed.length === 0) return true;
    if (!set) return false;
    return needed.some((id) => capabilityOn(set, id));
  });
}

interface GgAgentsExplorerProps {
  // The delegation forest (from the globally-merged fold), drawn as the directory
  // tree. Led by the main agent, with any board-dispatched issue agents as further
  // top-level folders beside it.
  forest: AgentTreeNode[];
  // Each agent's own reduced slice, keyed by agent id (always including the root).
  perAgent: Map<string, DerivedGgState>;
  // The run's configuration — decides which context bands are worth listing.
  capabilitySet: GgCapabilitySet | null;
  // Run-level delegation structure, shown on the root agent's Overview: declared
  // workflows and best-of-K speculations. (Per-slot usage is a whole-run cost fact,
  // so it reads on the Dashboard beside the token/cost tally, not here.) Empty when
  // the run had none.
  workflows: Workflow[];
  speculations: SpeculationState[];
  // Whether the stream is still arriving — a live activity feed auto-follows its
  // newest row and says it is waiting on telemetry; a finished one does neither.
  live: boolean;
  // An agent to jump to, set when the Dashboard's agent overview is clicked. When it
  // names a known agent the explorer selects that agent's Overview and opens the
  // folders on the path to it, then calls `onFocusHandled` so the request is consumed
  // once (the user is free to navigate away afterwards). Null/undefined most of the
  // time — this is a one-shot request, not a controlled selection.
  focusAgent?: string | null;
  onFocusHandled?: () => void;
}

interface Selection {
  agentId: string;
  file: AgentFileKind;
}

/**
 * The Agents explorer — the sole rich surface a gg run is read through besides the
 * Dashboard. A filesystem sidebar of agents-as-folders and monitor-views-as-files
 * on the left; the selected file's view on the right.
 */
export function GgAgentsExplorer({
  forest,
  perAgent,
  capabilitySet,
  workflows,
  speculations,
  live,
  focusAgent,
  onFocusHandled,
}: GgAgentsExplorerProps) {
  // A flat id → tree-node index, so the content pane can resolve the selected agent
  // to its node (for its identity card) without re-walking the forest.
  const nodeById = useMemo(() => {
    const map = new Map<string, AgentTreeNode>();
    const walk = (node: AgentTreeNode) => {
      map.set(node.id, node);
      node.children.forEach(walk);
    };
    forest.forEach(walk);
    return map;
  }, [forest]);

  // Winner/loser marking for the tree (empty when no speculation ran), so the
  // sidebar can star a chosen best-of-K attempt and dim its losing co-attempts.
  const roles = useMemo(
    () => classifySpeculationRoles(forest, speculations),
    [forest, speculations],
  );

  // The open/closed state of the tree's folders, keyed `folder:<id>` (an agent
  // folder) and `sub:<id>` (an agent's subagents folder). Everything is open by
  // default — a gg run's tree is small, and seeing it whole is the point — so the
  // set holds only what the user has explicitly collapsed.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [selection, setSelection] = useState<Selection>({
    agentId: ROOT_ID,
    file: "overview",
  });

  // Keep the selection valid as the live stream grows and reshapes: if the selected
  // agent is gone (a stream re-read) or the selected file is no longer offered (the
  // announced configuration justifies a different set), fall back to the root's
  // overview — which is unconditional, so it is always a valid landing.
  useEffect(() => {
    if (
      nodeById.has(selection.agentId) &&
      filesFor(capabilitySet).includes(selection.file)
    )
      return;
    setSelection({ agentId: ROOT_ID, file: "overview" });
  }, [nodeById, capabilitySet, selection]);

  // Honor a jump-to-agent request from the Dashboard's overview: select the agent's
  // Overview and open every folder on the path down to it so it is visible in the
  // tree, then tell the parent the request was consumed. Guarded on the agent being
  // known, so a request that races ahead of the agent's spawn is simply ignored.
  useEffect(() => {
    if (focusAgent == null || !nodeById.has(focusAgent)) return;
    setSelection({ agentId: focusAgent, file: "overview" });
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let cur: string | null = focusAgent;
      while (cur != null) {
        next.delete(`folder:${cur}`);
        next.delete(`sub:${cur}`);
        cur = nodeById.get(cur)?.parentId ?? null;
      }
      return next.size === prev.size ? prev : next;
    });
    onFocusHandled?.();
  }, [focusAgent, nodeById, onFocusHandled]);

  const selectedState = perAgent.get(selection.agentId);
  const selectedNode = nodeById.get(selection.agentId);

  const ctx: ExplorerCtx = {
    capabilitySet,
    roles,
    collapsed,
    toggle,
    selection,
    onSelect: setSelection,
  };

  return (
    <div className={panels.explorer}>
      <nav className={panels.explorerSidebar} aria-label="Agents">
        <ul className={panels.fsTree}>
          {forest.map((root) => (
            <FolderNode key={root.id} node={root} depth={0} ctx={ctx} />
          ))}
        </ul>
      </nav>
      <div className={panels.explorerContent}>
        {selectedState && selectedNode ? (
          <FileContent
            node={selectedNode}
            state={selectedState}
            file={selection.file}
            role={roles.get(selectedNode.id)}
            capabilitySet={capabilitySet}
            workflows={workflows}
            speculations={speculations}
            live={live}
          />
        ) : (
          <p className={panels.empty}>No agent selected.</p>
        )}
      </div>
    </div>
  );
}

// --- Sidebar (the directory tree) --------------------------------------------

interface ExplorerCtx {
  capabilitySet: GgCapabilitySet | null;
  roles: Map<string, SpeculationRole>;
  collapsed: ReadonlySet<string>;
  toggle: (key: string) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

// A nesting-depth indent, so a child folder sits under its parent like a file tree.
function indent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${0.5 + depth * 0.85}rem` };
}

// One agent's folder: its files, then — when it spawned any — a `subagents` folder
// holding their folders (recursively). The main agent is the depth-0 folder.
function FolderNode({
  node,
  depth,
  ctx,
}: {
  node: AgentTreeNode;
  depth: number;
  ctx: ExplorerCtx;
}) {
  const files = filesFor(ctx.capabilitySet);
  const folderKey = `folder:${node.id}`;
  const open = !ctx.collapsed.has(folderKey);
  // The main agent is the "root" folder; a board-dispatched issue agent is also
  // top-level (parentless) but reads by its own id, so key on the id rather than
  // on being parentless.
  const isRoot = node.id === ROOT_ID;
  const label = isRoot ? "root" : node.id;
  const role = ctx.roles.get(node.id);

  return (
    <li className={panels.fsNode}>
      <button
        type="button"
        className={panels.fsRow}
        style={indent(depth)}
        aria-expanded={open}
        onClick={() => ctx.toggle(folderKey)}
      >
        <span className={panels.fsCaret} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {open ? (
          <FolderOpenIcon className={panels.fsIcon} />
        ) : (
          <FolderIcon className={panels.fsIcon} />
        )}
        <span className={panels.fsName}>{isRoot ? "root" : node.id}</span>
        {isRoot && <span className={panels.fsMeta}>main agent</span>}
        {node.slot && !isRoot && (
          <span className={panels.fsMeta}>{node.slot}</span>
        )}
        {role === "winner" && (
          <span className={panels.fsWinner} title="chosen best-of-K attempt">
            ★
          </span>
        )}
        <span
          className={panels.fsStatusDot}
          data-status={node.status}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul className={panels.fsChildren}>
          {files.map((file) => {
            const selected =
              ctx.selection.agentId === node.id && ctx.selection.file === file;
            const FileIcon = FILE_ICONS[file];
            return (
              <li key={file}>
                <button
                  type="button"
                  className={cx(
                    panels.fsRow,
                    panels.fsFile,
                    selected && panels.fsRowActive,
                  )}
                  style={indent(depth + 1)}
                  // Name the agent so a file row is unambiguous on its own — a
                  // screen reader (and the eye scanning a deep tree) should not have
                  // to infer which folder an "activity" row belongs to.
                  aria-label={`${label} ${FILE_LABELS[file]}`}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => ctx.onSelect({ agentId: node.id, file })}
                >
                  <FileIcon className={panels.fsIcon} />
                  <span className={panels.fsName}>{FILE_LABELS[file]}</span>
                </button>
              </li>
            );
          })}
          {node.children.length > 0 && (
            <SubagentsFolder node={node} depth={depth + 1} ctx={ctx} />
          )}
        </ul>
      )}
    </li>
  );
}

// The `subagents` folder under an agent that delegated: it holds a folder per agent
// this one spawned, so the delegation tree nests exactly like directories.
function SubagentsFolder({
  node,
  depth,
  ctx,
}: {
  node: AgentTreeNode;
  depth: number;
  ctx: ExplorerCtx;
}) {
  const subKey = `sub:${node.id}`;
  const open = !ctx.collapsed.has(subKey);
  return (
    <li className={panels.fsNode}>
      <button
        type="button"
        className={panels.fsRow}
        style={indent(depth)}
        aria-expanded={open}
        onClick={() => ctx.toggle(subKey)}
      >
        <span className={panels.fsCaret} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {open ? (
          <FolderOpenIcon className={panels.fsIcon} />
        ) : (
          <FolderIcon className={panels.fsIcon} />
        )}
        <span className={panels.fsName}>subagents</span>
        <span className={panels.fsMeta}>{node.children.length}</span>
      </button>
      {open && (
        <ul className={panels.fsChildren}>
          {node.children.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// --- Content pane (the selected file's view) ---------------------------------

function FileContent({
  node,
  state,
  file,
  role,
  capabilitySet,
  workflows,
  speculations,
  live,
}: {
  node: AgentNode;
  state: DerivedGgState;
  file: AgentFileKind;
  role?: SpeculationRole;
  capabilitySet: GgCapabilitySet | null;
  workflows: Workflow[];
  speculations: SpeculationState[];
  live: boolean;
}) {
  // Only the main agent carries the run-level delegation structure on its Overview; a
  // dispatched top-level issue agent is parentless too but is not the run's root.
  const isRoot = node.id === ROOT_ID;

  // No file view restates "<agent> · <file>" over its content: the sidebar's active
  // row already names the agent and the file being read, so a header here would only
  // echo it. Each view leads straight into its own content.
  switch (file) {
    case "overview":
      return (
        <OverviewFile
          node={node}
          state={state}
          role={role}
          isRoot={isRoot}
          capabilitySet={capabilitySet}
          workflows={workflows}
          speculations={speculations}
        />
      );
    case "prompt":
      return (
        <div className={panels.panelBody}>
          <PromptView
            node={node}
            prompts={state.prompts}
            pool={state.messagePool}
            live={live}
          />
        </div>
      );
    case "activity":
      return <ActivityFeed feed={state.feed} live={live} />;
    case "context":
      return (
        <div className={panels.panelBody}>
          <ContextFillGraph
            series={state.contextSeries}
            latest={state.latestContext}
            capabilitySet={capabilitySet}
            compactions={state.compactions}
            planImplementTurn={state.plan?.implementTurn ?? null}
          />
        </div>
      );
    case "requests":
      return (
        <div className={panels.panelBody}>
          <RequestsView
            prompts={state.prompts}
            pool={state.messagePool}
            live={live}
          />
        </div>
      );
    case "compaction":
      return (
        <div className={panels.panelBody}>
          <CompactionView compactions={state.compactions} />
        </div>
      );
    case "plan":
      return (
        <>
          <RetainedNote
            count={state.compactions.length}
            what="submitted plan"
          />
          <div className={panels.panelBody}>
            <PlanView plan={state.plan} />
          </div>
        </>
      );
    case "tasks":
      return (
        <>
          <RetainedNote count={state.compactions.length} what="task list" />
          <div className={panels.panelBody}>
            <TaskDagView tasks={state.tasks} />
          </div>
        </>
      );
    case "knowledge": {
      // Each half is shown when its own capability is on (its list carries its own
      // empty state until entries arrive), so a memories-only run reads as a
      // memories panel rather than a half-empty split.
      const showSkills = capabilityOn(capabilitySet, "skills");
      const showMemories = capabilityOn(capabilitySet, "memories");
      return (
        <>
          <RetainedNote
            count={state.compactions.length}
            what={knowledgeLabel(showSkills, showMemories)}
          />
          <div className={panels.panelBody}>
            <div className={panels.knowledgeSplit}>
              {showSkills && (
                <div className={panels.subPanel}>
                  <span className={panels.subPanelLabel}>Skills</span>
                  <SkillsList skills={state.skills} />
                </div>
              )}
              {showMemories && (
                <div className={panels.subPanel}>
                  <span className={panels.subPanelLabel}>Memories</span>
                  <MemoriesList memory={state.memory} />
                </div>
              )}
            </div>
          </div>
        </>
      );
    }
  }
}

// One agent's activity feed, rendered through the same shared feed every other
// harness uses so it honors the layout the user picked in Appearance. Auto-follows
// the newest row while the run is live.
function ActivityFeed({ feed, live }: { feed: FeedRow[]; live: boolean }) {
  const feedStyle = useAppSettings((s) => s.eventFeedStyle);
  const [following, setFollowing] = useState(true);
  const lines = useMemo(() => feed.map((row) => ggFeedLine(row)), [feed]);
  return (
    <>
      {live && (
        <div className={runExec.feedHeader}>
          <span className={runExec.sectionLabel}>gg activity</span>
          <button
            type="button"
            className={runExec.followButton}
            data-active={following ? "" : undefined}
            aria-pressed={following}
            onClick={() => setFollowing((on) => !on)}
          >
            Follow
          </button>
        </div>
      )}
      <FeedView
        lines={lines}
        feedStyle={feedStyle}
        fill
        follow={live ? following : undefined}
        onFollowChange={live ? setFollowing : undefined}
        emptyLabel={
          live ? "Waiting for telemetry…" : "No telemetry was recorded."
        }
      />
    </>
  );
}

// An agent's Overview file: the same read-out the whole-run Dashboard gives, scoped
// to this one agent. Its identity card, how full its context window is, its own
// Tokens and Cost widgets (the very components the Dashboard uses, fed this agent's
// usage) — so a subagent's cost is legible in the same shape as the run's, not a
// different-looking summary — and its tool-usage breakdown (the itemized version of
// the Dashboard row's tool chips). The run's delegation structure (workflows,
// speculations) is a whole-run fact, so it hangs off the root agent only; a
// session-scoped card (status, the agent overview, the configuration, the per-slot
// usage tally) has no place on one agent, so none appears here — those read on the
// Dashboard.
function OverviewFile({
  node,
  state,
  role,
  isRoot,
  capabilitySet,
  workflows,
  speculations,
}: {
  node: AgentNode;
  state: DerivedGgState;
  role?: SpeculationRole;
  isRoot: boolean;
  capabilitySet: GgCapabilitySet | null;
  workflows: Workflow[];
  speculations: SpeculationState[];
}) {
  // Price this agent's own usage: prefer its per-slot rollups, falling back to its
  // aggregate tally at the agent's model (the run's sole model on the root, when it
  // carries none of its own).
  const costBreakdown = useGgCostBreakdown(
    state.slotUsage,
    state.usage,
    node.modelId ?? soleModelId(capabilitySet),
  );
  // The agent's tool usage — the breakdown behind the Dashboard overview's chips.
  const tools = useMemo(() => ggToolBreakdown(state), [state]);
  return (
    <div className={panels.panelBody}>
      <div className={panels.overview}>
        <AgentIdentity node={node} role={role} />
        <ContextUsageBar latest={state.latestContext} />
        {/* The pane-responsive grid, not the Dashboard's viewport bento: this pane
            is narrower than the window, so the widgets must stack on the pane's own
            width. */}
        <div className={dash.overviewCards}>
          <TokensWidget usage={state.usage} />
          <CostWidget usage={state.usage} breakdown={costBreakdown} />
        </div>
        {tools.tools.length > 0 && <AgentToolsPanel breakdown={tools} />}
        {/* The run's delegation structure hangs off the main agent — it is a
            whole-run fact, not one subagent's, so it reads on the root. */}
        {isRoot && workflows.length > 0 && (
          <WorkflowStrip workflows={workflows} />
        )}
        {isRoot && speculations.length > 0 && (
          <SpeculationPanel speculations={speculations} />
        )}
      </div>
    </div>
  );
}

// An agent's tool-usage breakdown, shown on its Overview: every tool it called, most
// used first, with how many times it called it and — where the message log recorded
// it — how many tokens that tool's results added to the window, as a share of all the
// tokens that entered the agent's context. The Dashboard's agent overview shows the
// same tools as bare chips; this is the itemized version behind them.
function AgentToolsPanel({ breakdown }: { breakdown: GgToolBreakdown }) {
  const { tools, totalContextTokens, outputTokensKnown } = breakdown;
  return (
    <section className={panels.agentSection}>
      <span className={panels.subPanelLabel}>Tools</span>
      <ul className={panels.toolList}>
        {tools.map((tool) => {
          const share =
            outputTokensKnown && totalContextTokens > 0
              ? tool.outputTokens / totalContextTokens
              : null;
          return (
            <li key={tool.name} className={panels.toolRow}>
              <span className={panels.toolName}>{tool.name}</span>
              <span className={panels.toolCalls}>
                {tool.calls}
                {"×"}
              </span>
              <span className={panels.toolBar} aria-hidden="true">
                <span
                  className={panels.toolBarFill}
                  style={{ width: `${(share ?? 0) * 100}%` }}
                />
              </span>
              <span className={panels.toolTokens}>
                {share != null
                  ? `${shortTokens(tool.outputTokens)} · ${formatPercent(share)}`
                  : "—"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={panels.toolNote}>
        {outputTokensKnown
          ? "Calls, and each tool’s result tokens as a share of all tokens that entered this agent’s window."
          : "Call counts only — result-token attribution needs the context-visibility capability."}
      </p>
    </section>
  );
}

// What the Knowledge file's retention note calls what it kept, named for the halves
// this agent actually has.
function knowledgeLabel(skills: boolean, memories: boolean): string {
  if (skills && memories) return "skills and memories";
  return skills ? "skills" : "memories";
}

// A reassurance line shown on the Plan / Board / Tasks / Knowledge files once this
// agent has crossed a compaction boundary: the retention contract kept this state
// verbatim, so it never blanked out when the window was summarized. Renders nothing
// before any compaction.
function RetainedNote({ count, what }: { count: number; what: string }) {
  if (count === 0) return null;
  return (
    <p className={panels.retainedNote}>
      Retained verbatim across {count} compaction{count === 1 ? "" : "s"} — the{" "}
      {what} carried over.
    </p>
  );
}
