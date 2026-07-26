import { useEffect, useMemo, useState } from "react";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import { FeedView, type FeedLine } from "../../../components/FeedView";
import { useAppSettings } from "../../../store/appSettings";
import runExec from "../RunExec.module.scss";
import panels from "./GgPanels.module.scss";
import type {
  AgentNode,
  AgentTreeNode,
  DerivedGgState,
  FeedRow,
  SlotUsage,
  SpeculationState,
  UsageTally,
  Workflow,
} from "./useGgRunState";
import { ROOT_ID } from "./useGgRunState";
import {
  AgentIdentity,
  SlotUsagePanel,
  SpeculationPanel,
  WorkflowStrip,
  classifySpeculationRoles,
  type SpeculationRole,
} from "./AgentTreeView";
import { ContextFillGraph } from "./ContextFillGraph";
import { PlanView } from "./PlanView";
import { BoardView } from "./BoardView";
import { TaskDagView } from "./TaskDagView";
import { SkillsList } from "./SkillsList";
import { MemoriesList } from "./MemoriesList";

// The Agents explorer: a gg run read agent by agent, laid out like a filesystem.
//
// gg is headless and multi-agent, so a single globally-merged view cannot say
// *whose* context filled, *whose* task list this is, or what one subagent did in
// isolation — those are per-agent facts (see gg/subagents.md). The explorer makes
// each agent a folder whose "files" are the things a run lets you monitor about it
// (its activity, its context-window fill, its plan, its board, its tasks, its
// knowledge), and nests every agent an agent spawned under a `subagents` folder, so
// the delegation tree *is* the directory tree. The top-level folder is the main
// (root) agent. Selecting a file opens that view for that agent in the content pane
// — the same rich panels a gg run has always been read through, now scoped to one
// agent rather than blurred across all of them.

const numberFmt = new Intl.NumberFormat("en-US");
function formatTokens(n: number): string {
  return numberFmt.format(n);
}
function formatCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}
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
// about one agent. `overview` and `activity` are always present (every agent has an
// identity and a stream); the rest appear only when this agent produced that kind
// of data, so an agent's folder lists exactly what there is to read about it.
export type AgentFileKind =
  | "overview"
  | "activity"
  | "context"
  | "plan"
  | "board"
  | "tasks"
  | "knowledge";

const FILE_LABELS: Record<AgentFileKind, string> = {
  overview: "overview",
  activity: "activity",
  context: "context",
  plan: "plan",
  board: "board",
  tasks: "tasks",
  knowledge: "knowledge",
};

// A leading glyph per file kind, so the tree scans like a real file browser.
const FILE_ICONS: Record<AgentFileKind, string> = {
  overview: "◆",
  activity: "≡",
  context: "▨",
  plan: "❑",
  board: "▦",
  tasks: "☑",
  knowledge: "✶",
};

// Which files an agent's folder offers, given its own reduced slice. Overview and
// activity are unconditional; the work views appear only where this agent has the
// data — a capability being off (or an agent never using it) simply means the file
// is absent, keeping each folder honest about what it holds.
function filesFor(state: DerivedGgState): AgentFileKind[] {
  const files: AgentFileKind[] = ["overview", "activity"];
  if (state.contextSeries.length > 0) files.push("context");
  if (state.plan) files.push("plan");
  if (state.board) files.push("board");
  if (state.tasks.length > 0) files.push("tasks");
  if (state.skills.length > 0 || state.memory) files.push("knowledge");
  return files;
}

interface GgAgentsExplorerProps {
  // The rooted delegation tree (from the globally-merged fold), drawn as the
  // directory tree. Always rooted at the main agent.
  tree: AgentTreeNode;
  // Each agent's own reduced slice, keyed by agent id (always including the root).
  perAgent: Map<string, DerivedGgState>;
  // The run's configuration — decides which context bands are worth listing.
  capabilitySet: GgCapabilitySet | null;
  // Run-level delegation structure, shown on the root agent's Overview: per-slot
  // usage/cost, declared workflows, best-of-K speculations. Empty when the run had
  // none.
  slotUsage: SlotUsage[];
  workflows: Workflow[];
  speculations: SpeculationState[];
  // Whether the stream is still arriving — a live activity feed auto-follows its
  // newest row and says it is waiting on telemetry; a finished one does neither.
  live: boolean;
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
  tree,
  perAgent,
  capabilitySet,
  slotUsage,
  workflows,
  speculations,
  live,
}: GgAgentsExplorerProps) {
  // A flat id → tree-node index, so the content pane can resolve the selected agent
  // to its node (for its identity card) without re-walking the tree.
  const nodeById = useMemo(() => {
    const map = new Map<string, AgentTreeNode>();
    const walk = (node: AgentTreeNode) => {
      map.set(node.id, node);
      node.children.forEach(walk);
    };
    walk(tree);
    return map;
  }, [tree]);

  // Winner/loser marking for the tree (empty when no speculation ran), so the
  // sidebar can star a chosen best-of-K attempt and dim its losing co-attempts.
  const roles = useMemo(
    () => classifySpeculationRoles(tree, speculations),
    [tree, speculations],
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
  // agent or file has gone away (a stream re-read, or an agent that had not yet
  // produced that file), fall back to the root's overview.
  useEffect(() => {
    const state = perAgent.get(selection.agentId);
    if (state && filesFor(state).includes(selection.file)) return;
    setSelection({ agentId: ROOT_ID, file: "overview" });
  }, [perAgent, selection]);

  const selectedState = perAgent.get(selection.agentId);
  const selectedNode = nodeById.get(selection.agentId);

  const ctx: ExplorerCtx = {
    perAgent,
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
          <FolderNode node={tree} depth={0} ctx={ctx} />
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
            slotUsage={slotUsage}
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
  perAgent: Map<string, DerivedGgState>;
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
  const state = ctx.perAgent.get(node.id);
  const files = state ? filesFor(state) : ["overview" as const];
  const folderKey = `folder:${node.id}`;
  const open = !ctx.collapsed.has(folderKey);
  const isRoot = node.parentId == null;
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
        <span className={panels.fsIcon} aria-hidden="true">
          📁
        </span>
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
                  <span className={panels.fsIcon} aria-hidden="true">
                    {FILE_ICONS[file]}
                  </span>
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
        <span className={panels.fsIcon} aria-hidden="true">
          📁
        </span>
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
  slotUsage,
  workflows,
  speculations,
  live,
}: {
  node: AgentNode;
  state: DerivedGgState;
  file: AgentFileKind;
  role?: SpeculationRole;
  capabilitySet: GgCapabilitySet | null;
  slotUsage: SlotUsage[];
  workflows: Workflow[];
  speculations: SpeculationState[];
  live: boolean;
}) {
  const isRoot = node.parentId == null;
  const label = isRoot ? "root" : node.id;

  switch (file) {
    case "overview":
      return (
        <>
          <span className={runExec.sectionLabel}>{label} · overview</span>
          <div className={panels.panelBody}>
            <div className={panels.overview}>
              <AgentIdentity node={node} role={role} />
              <AgentUsageSummary usage={state.usage} />
              {/* The run's delegation structure hangs off the main agent — it is a
                  whole-run fact, not one subagent's, so it reads on the root. */}
              {isRoot && workflows.length > 0 && (
                <WorkflowStrip workflows={workflows} />
              )}
              {isRoot && speculations.length > 0 && (
                <SpeculationPanel speculations={speculations} />
              )}
              {isRoot && slotUsage.length > 0 && (
                <SlotUsagePanel slotUsage={slotUsage} />
              )}
            </div>
          </div>
        </>
      );
    case "activity":
      return (
        <>
          <span className={runExec.sectionLabel}>{label} · activity</span>
          <ActivityFeed feed={state.feed} live={live} />
        </>
      );
    case "context":
      return (
        <>
          <span className={runExec.sectionLabel}>{label} · context window</span>
          <div className={panels.panelBody}>
            <ContextFillGraph
              series={state.contextSeries}
              latest={state.latestContext}
              capabilitySet={capabilitySet}
              compactions={state.compactions}
              planImplementTurn={state.plan?.implementTurn ?? null}
            />
          </div>
        </>
      );
    case "plan":
      return (
        <>
          <span className={runExec.sectionLabel}>{label} · plan</span>
          <RetainedNote
            count={state.compactions.length}
            what="submitted plan"
          />
          <div className={panels.panelBody}>
            <PlanView plan={state.plan} />
          </div>
        </>
      );
    case "board":
      return (
        <>
          <span className={runExec.sectionLabel}>{label} · board</span>
          <RetainedNote
            count={state.compactions.length}
            what="epic/issue board"
          />
          <div className={panels.panelBody}>
            <BoardView board={state.board} codeReviews={state.codeReviews} />
          </div>
        </>
      );
    case "tasks":
      return (
        <>
          <span className={runExec.sectionLabel}>{label} · tasks</span>
          <RetainedNote count={state.compactions.length} what="task list" />
          <div className={panels.panelBody}>
            <TaskDagView tasks={state.tasks} />
          </div>
        </>
      );
    case "knowledge": {
      const showSkills = state.skills.length > 0;
      const showMemories = state.memory != null;
      return (
        <>
          <span className={runExec.sectionLabel}>{label} · knowledge</span>
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

// The agent's own token/cost tally — the sum of its usage, so a subagent's cost is
// legible on its Overview rather than only folded into the run total.
function AgentUsageSummary({ usage }: { usage: UsageTally }) {
  return (
    <div className={panels.agentUsage}>
      <span className={panels.subPanelLabel}>Tokens &amp; cost</span>
      <span className={panels.agentUsageTotal}>
        {usage.anyTokens ? formatTokens(usage.totalTokens) : "—"}{" "}
        <span className={panels.agentUsageUnit}>tokens</span>
        <span className={panels.agentUsageCost}>
          {" · "}
          {formatCost(usage.comparable)}
        </span>
      </span>
      <div className={panels.agentUsageBreakdown}>
        <span>
          <span className={panels.agentUsageKey}>in</span>
          {formatTokens(usage.uncachedInput)}
        </span>
        <span>
          <span className={panels.agentUsageKey}>cached</span>
          {formatTokens(usage.cachedInput)}
        </span>
        <span>
          <span className={panels.agentUsageKey}>out</span>
          {formatTokens(usage.output)}
        </span>
        <span>
          <span className={panels.agentUsageKey}>reasoning</span>
          {formatTokens(usage.reasoning)}
        </span>
      </div>
    </div>
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
