import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  GgCapabilitySet,
  GgModuleKind,
} from "@test-cabinet/run-record/gg";
import { FeedView, type FeedLine } from "../../../components/FeedView";
import { useAppSettings } from "../../../store/appSettings";
import runExec from "../RunExec.module.scss";
import panels from "./GgPanels.module.scss";
import dash from "./GgDashboard.module.scss";
import type {
  AgentNode,
  AgentTransition,
  AgentTreeNode,
  ContextSnapshot,
  DerivedGgState,
  FeedRow,
  FsmVisit,
  GgToolBreakdown,
  ModuleSnapshot,
  SpeculationState,
  Workflow,
} from "./useGgRunState";
import {
  ROOT_ID,
  callRatePhrase,
  ggToolBreakdown,
  shortTokens,
  toolCallsPerResponse,
} from "./useGgRunState";
import { cx } from "./ggFsTree";
import {
  FsExplorer,
  FsFileRow,
  FsFolder,
  useFsFolders,
  type FsFolders,
} from "./GgFsExplorer";
import type { GgModuleIndex, GgModuleInstance } from "./ggModules";
import { isShared, moduleKindLabel, useGgModules } from "./ggModules";
import type { AgentEntry, AgentFileKind } from "./ggAgentEntries";
import {
  FILE_ICONS,
  FILE_LABELS,
  MODULE_ICONS,
  OVERVIEW_ENTRY,
  entriesFor,
  filesFor,
  sameEntry,
} from "./ggAgentEntries";
import { GgModuleHeader, ModuleContents } from "./GgModuleViews";
import { useGgExplorerNav } from "./GgExplorerNav";
import { agentPricedSlots, useGgCostBreakdown } from "./ggCost";
import { agentThroughput } from "./ggThroughput";
import {
  ContextUsageRing,
  CostWidget,
  TokensWidget,
  formatPercent,
} from "./GgOverviewWidgets";
import {
  AgentIdentity,
  FsmPathStrip,
  SpeculationPanel,
  WorkflowStrip,
  arrivalTag,
  classifyArrivals,
  classifySpeculationRoles,
  isSuccession,
  type SpeculationRole,
} from "./AgentTreeView";
import { ContextFillGraph } from "./ContextFillGraph";
import { PromptView } from "./PromptView";
import { RequestsView } from "./RequestsView";
import { RequestMetricsGraphs } from "./RequestMetricsGraphs";
import { CompactionView } from "./CompactionView";
import { LinkIcon, ModulesIcon } from "./ggIcons";

// The Instances explorer: a gg run read agent by agent, laid out like a filesystem.
//
// gg is headless and multi-agent, so a single globally-merged view cannot say
// *whose* context filled, *whose* task list this is, or what one subagent did in
// isolation — those are per-agent facts (see gg/subagents.md). The explorer makes
// each agent a folder whose "files" are the things a run lets you monitor about it
// (its activity, its context-window fill, what it spent), and nests every agent an
// agent spawned under a `subagents` folder, so the delegation tree *is* the directory
// tree. The top-level folder is the main (root) agent. Selecting a file opens that view
// for that agent in the content pane — the same rich panels a gg run has always been
// read through, now scoped to one agent rather than blurred across all of them.
//
// Beside those files each agent carries a `modules` folder: one entry per module
// instance it holds (see gg/modules). That folder exists because the state gg used to
// think of as an agent's — its memories, its task list, its handle on the board — is no
// longer the agent's at all. A module instance can be held by several agents at once,
// carried whole to a successor across an `exec`, or copied when its holder forks, so
// "root's tasks" was a name for something that might be shared with four other
// instances and could not say so. A module file therefore leads with the store's
// identity — who else holds it, how this holder came by it, whether it reaches the
// prompt, what it costs the windows it is in — and only then shows the contents.

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

interface GgAgentsExplorerProps {
  // The delegation forest (from the globally-merged fold), drawn as the directory
  // tree. Led by the main agent, with any board-dispatched issue agents as further
  // top-level folders beside it.
  forest: AgentTreeNode[];
  // Each agent's own reduced slice, keyed by agent id (always including the root).
  perAgent: Map<string, DerivedGgState>;
  // The run's configuration — decides which context bands are worth listing.
  capabilitySet: GgCapabilitySet | null;
  // The latest contents of every module instance the run mentioned, keyed by module id.
  // Cross-agent by construction (a store two agents share has ONE content), so it comes
  // off the whole-run reduction rather than out of any one agent's slice.
  moduleSnapshots: Map<string, ModuleSnapshot>;
  // Run-level delegation structure, shown on the root agent's Overview: declared
  // workflows and best-of-K speculations. (Per-slot spend is a whole-run cost fact,
  // so it reads inside the Dashboard's Cost widget, not here.) Empty when the run had
  // none.
  workflows: Workflow[];
  /** The states an FSM agent walked, and the successions between them. Empty for a
      run that drives no machine, which is almost all of them. */
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];
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
  // Which of that agent's entries to land on, when the caller has one in mind — a
  // module instance's holder chip on some other surface means "this store, read from
  // that instance", and landing on the Overview instead would drop the half of the
  // request that made it worth clicking. Defaults to the Overview.
  focusEntry?: AgentEntry | null;
  onFocusHandled?: () => void;
}

interface Selection {
  agentId: string;
  entry: AgentEntry;
}

/**
 * The Instances explorer — the sole rich surface a gg run is read through besides the
 * Dashboard. A filesystem sidebar of agents-as-folders and monitor-views-as-files
 * on the left; the selected file's view on the right.
 */
export function GgAgentsExplorer({
  forest,
  perAgent,
  capabilitySet,
  moduleSnapshots,
  workflows,
  fsmPath,
  transitions,
  speculations,
  live,
  focusAgent,
  focusEntry,
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

  // How each instance arrived, for the instances that arrived by a succession rather
  // than by a spawn (empty for the great majority of runs). It decides both how a node
  // is marked and *where* it hangs: a successor is the same agent continuing, so it
  // reads as the next link of a lineage rather than as something its predecessor
  // delegated to.
  const arrivals = useMemo(() => classifyArrivals(transitions), [transitions]);

  // The run read by module instance: which store each agent is a holder of, who else
  // holds it, and what happened to it. Folded once here and read by every module row
  // and every module file, so the tree's "4 holders" badge and the file's holder list
  // can never be two different answers.
  const modules = useGgModules(
    capabilitySet,
    forest,
    perAgent,
    transitions,
    moduleSnapshots,
  );

  // The open/closed state of the tree's folders, keyed `folder:<id>` (an agent
  // folder), `sub:<id>` (an agent's subagents folder) and `mod:<id>` (an agent's
  // modules folder). Only the *overrides* are held: a folder the reader has not
  // touched reads its default, which is what keeps a fleet's worth of agents arriving
  // mid-run collapsed as they appear rather than each one springing open the moment it
  // spawns.
  const folders = useFsFolders();

  const [selection, setSelection] = useState<Selection>({
    agentId: ROOT_ID,
    entry: OVERVIEW_ENTRY,
  });

  // Select one entry and make sure it can be *seen*: every folder on the path down to
  // the agent is forced open, as is the agent's own modules folder when the entry is a
  // module. Forced rather than cleared back to the default, because a subagent folder
  // and a modules folder both default to *closed* — clearing them would leave the thing
  // the reader just asked for hidden behind two carets.
  const openFolders = folders.open;
  const reveal = useCallback(
    (agentId: string, entry: AgentEntry) => {
      setSelection({ agentId, entry });
      const keys: string[] = [];
      let cur: string | null = agentId;
      while (cur != null) {
        keys.push(`folder:${cur}`, `sub:${cur}`);
        cur = nodeById.get(cur)?.parentId ?? null;
      }
      if (entry.kind === "module") keys.push(`mod:${agentId}`);
      openFolders(keys);
    },
    [nodeById, openFolders],
  );

  // Keep the selection valid as the live stream grows and reshapes: if the selected
  // agent is gone (a stream re-read), the selected file is no longer offered by *that
  // agent's* profile (the announced configuration justifies a different set), or the
  // selected module is no longer one it holds (a succession dropped it), fall back to
  // the root's overview — which is unconditional, so it is always a valid landing.
  useEffect(() => {
    const selected = nodeById.get(selection.agentId);
    if (
      selected &&
      entriesFor(
        capabilitySet,
        selected.slot,
        modules.byAgent.get(selected.id) ?? [],
      ).some((entry) => sameEntry(entry, selection.entry))
    )
      return;
    setSelection({ agentId: ROOT_ID, entry: OVERVIEW_ENTRY });
  }, [nodeById, capabilitySet, modules, selection]);

  // Honor a jump-to-agent request from elsewhere in the panels — the Dashboard's agent
  // overview, an instance chip, a module's holder list: select the requested entry
  // (its Overview when none was named), reveal it, then tell the parent the request was
  // consumed. Guarded on the agent being known, so a request that races ahead of the
  // agent's spawn is simply ignored.
  useEffect(() => {
    if (focusAgent == null || !nodeById.has(focusAgent)) return;
    reveal(focusAgent, focusEntry ?? OVERVIEW_ENTRY);
    onFocusHandled?.();
  }, [focusAgent, focusEntry, nodeById, reveal, onFocusHandled]);

  const selectedState = perAgent.get(selection.agentId);
  const selectedNode = nodeById.get(selection.agentId);
  const selectedEntry = selection.entry;

  const ctx: ExplorerCtx = {
    capabilitySet,
    modules,
    roles,
    arrivals,
    folders,
    selection,
    onSelect: setSelection,
  };

  return (
    <FsExplorer
      sidebarLabel="Agents"
      tree={forest.map((root) => (
        <FolderNode key={root.id} node={root} depth={0} ctx={ctx} />
      ))}
    >
      {selectedState && selectedNode ? (
        selectedEntry.kind === "module" ? (
          <ModuleFile
            agentId={selectedNode.id}
            kind={selectedEntry.module}
            modules={modules}
            state={selectedState}
            // A co-holder chip opens the same store read from the other instance —
            // the same module file, one folder over — so it stays inside the explorer
            // rather than routing through the panels' one-shot focus channel.
            onOpenHolder={(agentId) =>
              reveal(agentId, {
                kind: "module",
                module: selectedEntry.module,
              })
            }
            onOpenFile={(file) =>
              setSelection({
                agentId: selectedNode.id,
                entry: { kind: "file", file },
              })
            }
          />
        ) : (
          <FileContent
            node={selectedNode}
            state={selectedState}
            file={selectedEntry.file}
            role={roles.get(selectedNode.id)}
            arrival={arrivals.get(selectedNode.id)}
            capabilitySet={capabilitySet}
            workflows={workflows}
            fsmPath={fsmPath}
            transitions={transitions}
            speculations={speculations}
            live={live}
          />
        )
      ) : (
        <p className={panels.empty}>No agent selected.</p>
      )}
    </FsExplorer>
  );
}

// --- Sidebar (the directory tree) --------------------------------------------

interface ExplorerCtx {
  capabilitySet: GgCapabilitySet | null;
  /** The run read by module instance — what each agent holds, and with whom. */
  modules: GgModuleIndex;
  roles: Map<string, SpeculationRole>;
  /** How each instance arrived, for the ones that arrived by a succession. */
  arrivals: Map<string, AgentTransition>;
  /** The tree's open/closed bookkeeping, shared by every folder in it. */
  folders: FsFolders;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

// One agent's folder: its own files, then a `modules` folder holding what it holds,
// then — when it handed off — the instance it continued as, then — when it spawned any
// — a `subagents` folder holding their folders (recursively). The main agent is the
// depth-0 folder.
//
// That order is the order an instance is read in: what it *is*, then what it *holds*,
// then what it *became* and whom it *put to work*.
function FolderNode({
  node,
  depth,
  ctx,
}: {
  node: AgentTreeNode;
  depth: number;
  ctx: ExplorerCtx;
}) {
  // This agent's own files — read off the profile it runs under, not the run's Root —
  // and the module instances it holds, in the contract's kind order.
  const files = filesFor(ctx.capabilitySet, node.slot);
  const held = ctx.modules.byAgent.get(node.id) ?? [];
  // A succession's successor is parented to its predecessor (a fresh id, the same
  // depth) — so it arrives here as a child, and would otherwise read as something this
  // agent delegated to. It is the same agent, so it hangs directly off this folder as
  // the next link of the lineage, and only what this agent really *spawned* goes into
  // the subagents folder. A fork is a spawn: it is a second worker, and it belongs
  // there with the rest.
  const successors = node.children.filter((child) =>
    isSuccession(ctx.arrivals.get(child.id)),
  );
  const spawned = node.children.filter(
    (child) => !isSuccession(ctx.arrivals.get(child.id)),
  );
  const folderKey = `folder:${node.id}`;
  // The main agent is the "root" folder; a board-dispatched issue agent is also
  // top-level (parentless) but reads by its own id, so key on the id rather than
  // on being parentless.
  const isRoot = node.id === ROOT_ID;
  // Only the main agent opens by default. A gg run routinely fields dozens of
  // instances, and every one of them opened is a sidebar of a hundred rows to scroll
  // past — so an agent is a closed folder you open to read, and the run's entry point
  // (its root) is the one already open.
  const openByDefault = isRoot;
  const open = ctx.folders.isOpen(folderKey, openByDefault);
  const label = isRoot ? "root" : node.id;
  const role = ctx.roles.get(node.id);
  const arrival = ctx.arrivals.get(node.id);

  return (
    <FsFolder
      depth={depth}
      open={open}
      onToggle={() => ctx.folders.toggle(folderKey, openByDefault)}
      // Named as the folder it is, the way an issue folder is: without this the row's
      // accessible name is its id run together with its profile ("agent-0 reviewer"),
      // which reads as two loose tokens rather than as the thing being opened.
      ariaLabel={`agent ${label}`}
      // An agent's lifecycle dot stands where a folder icon would: the caret already
      // says the row is a folder, so the glyph is spent on the one thing worth reading
      // at a glance in a fleet of agents — who is running, waiting, done, or failed.
      icon={
        <span
          className={panels.fsAgentDot}
          data-status={node.status}
          aria-hidden="true"
        />
      }
      name={label}
      meta={
        <>
          {role === "winner" && (
            <span className={panels.fsWinner} title="chosen best-of-K attempt">
              ★
            </span>
          )}
          {/* How this instance arrived, when it arrived by a succession: the state it
              entered, or the move that produced it. Without it a lineage is N unrelated
              ids, which is the one thing about a machine (or an exec) nobody can infer. */}
          {arrival && (
            <span
              className={panels.fsArrival}
              title={`${arrival.kind === "fork" ? "forked from" : "continued from"} ${arrival.fromAgentId}`}
            >
              {arrivalTag(arrival)}
            </span>
          )}
          {/* The trailing annotation — "main agent", or the profile the agent runs
              under — pushed to the row's far edge, so it lines up down the tree instead
              of jittering with each agent's name length. */}
          {isRoot ? (
            <span className={cx(panels.fsMeta, panels.fsMetaTrailing)}>
              main agent
            </span>
          ) : (
            node.slot && (
              <span className={cx(panels.fsMeta, panels.fsMetaTrailing)}>
                {node.slot}
              </span>
            )
          )}
        </>
      }
    >
      {files.map((file) => {
        const FileIcon = FILE_ICONS[file];
        return (
          <FsFileRow
            key={file}
            depth={depth + 1}
            selected={
              ctx.selection.agentId === node.id &&
              sameEntry(ctx.selection.entry, { kind: "file", file })
            }
            onSelect={() =>
              ctx.onSelect({
                agentId: node.id,
                entry: { kind: "file", file },
              })
            }
            // Name the agent so a file row is unambiguous on its own — a screen reader
            // (and the eye scanning a deep tree) should not have to infer which folder
            // an "activity" row belongs to.
            ariaLabel={`${label} ${FILE_LABELS[file]}`}
            icon={<FileIcon className={panels.fsIcon} />}
            name={FILE_LABELS[file]}
          />
        );
      })}
      {/* What this instance holds. Guarded rather than unconditional: every instance
          has a window, so in practice the folder always has at least the `history` row —
          but an instance the module index has not caught up with yet would otherwise
          draw an empty folder. */}
      {held.length > 0 && (
        <ModulesFolder
          agentId={node.id}
          label={label}
          held={held}
          depth={depth + 1}
          ctx={ctx}
        />
      )}
      {/* The next incarnation of this same agent, in line with its own files — not
          nested under `subagents`, which it is not one of. */}
      {successors.map((successor) => (
        <FolderNode
          key={successor.id}
          node={successor}
          depth={depth + 1}
          ctx={ctx}
        />
      ))}
      {spawned.length > 0 && (
        <SubagentsFolder
          node={node}
          label={label}
          spawned={spawned}
          depth={depth + 1}
          ctx={ctx}
        />
      )}
    </FsFolder>
  );
}

// The `subagents` folder under an agent that delegated: it holds a folder per agent
// this one spawned, so the delegation tree nests exactly like directories.
//
// `spawned` is the agent's children minus its successors — an `exec`'d or transitioned
// instance is parented to its predecessor but is not something the predecessor put to
// work, so it hangs off the folder itself (see [FolderNode]) rather than in here.
function SubagentsFolder({
  node,
  label,
  spawned,
  depth,
  ctx,
}: {
  node: AgentTreeNode;
  /** How the agent this folder hangs under is named in the tree ("root", an id). */
  label: string;
  spawned: AgentTreeNode[];
  depth: number;
  ctx: ExplorerCtx;
}) {
  const subKey = `sub:${node.id}`;
  // The grouping folder itself stays open by default: it is not an agent, and closing it
  // would hide the *list* of agents the reader then has to open one of.
  const open = ctx.folders.isOpen(subKey, true);
  return (
    <FsFolder
      depth={depth}
      open={open}
      onToggle={() => ctx.folders.toggle(subKey, true)}
      // Named for the agent it hangs under, like every other row in the tree: there is
      // one of these per instance that delegated, so a bare "subagents" is ambiguous the
      // moment a run has two.
      ariaLabel={`${label} subagents`}
      name="subagents"
      meta={<span className={panels.fsMeta}>{spawned.length}</span>}
    >
      {spawned.map((child) => (
        <FolderNode key={child.id} node={child} depth={depth + 1} ctx={ctx} />
      ))}
    </FsFolder>
  );
}

// The `modules` folder under every agent: one row per module instance it holds, in the
// contract's kind order (history, memories, tasks, board, skills, archive), so a reader
// who has seen a succession's transfer list reads the folder in the same order.
//
// Closed by default, unlike `subagents`. That grouping folder opens because closing it
// would hide the *list* of agents you then have to open one of; this one is up to six
// rows per instance across a fleet of dozens, and the same fleet-scannability rationale
// that keeps agent folders closed governs here.
//
// Sharing is marked in the tree rather than only inside the files, because "is this
// store shared, and with how many?" is the one thing about a module worth knowing before
// you have decided to read it.
function ModulesFolder({
  agentId,
  label,
  held,
  depth,
  ctx,
}: {
  agentId: string;
  /** How the agent this folder hangs under is named in the tree ("root", an id). */
  label: string;
  held: readonly GgModuleInstance[];
  depth: number;
  ctx: ExplorerCtx;
}) {
  const modKey = `mod:${agentId}`;
  const open = ctx.folders.isOpen(modKey, false);
  return (
    <FsFolder
      depth={depth}
      open={open}
      onToggle={() => ctx.folders.toggle(modKey, false)}
      // Named for its agent, for the same reason its rows are: there is one modules
      // folder per instance, so an unlabelled "modules" is ambiguous in every run.
      ariaLabel={`${label} modules`}
      icon={<ModulesIcon className={panels.fsIcon} />}
      name="modules"
      meta={<span className={panels.fsMeta}>{held.length}</span>}
    >
      {held.map((module) => {
        const ModuleIcon = MODULE_ICONS[module.kind];
        return (
          <FsFileRow
            key={module.kind}
            depth={depth + 1}
            selected={
              ctx.selection.agentId === agentId &&
              sameEntry(ctx.selection.entry, {
                kind: "module",
                module: module.kind,
              })
            }
            onSelect={() =>
              ctx.onSelect({
                agentId,
                entry: { kind: "module", module: module.kind },
              })
            }
            ariaLabel={`${label} modules ${module.kind}`}
            icon={<ModuleIcon className={panels.fsIcon} />}
            name={module.kind}
            meta={
              isShared(module) && (
                <>
                  <LinkIcon className={panels.fsShared} />
                  {/* The count reads at a glance and the title names the store and the
                      holders, because "shared with whom?" is the next question and the
                      file that answers it in full is one click further. */}
                  <span
                    className={cx(panels.fsMeta, panels.fsMetaTrailing)}
                    title={`${module.id} — held by ${module.holders
                      .map((holder) => holder.agentId)
                      .join(", ")}`}
                  >
                    {module.holders.length} holders
                  </span>
                </>
              )
            }
          />
        );
      })}
    </FsFolder>
  );
}

// --- Content pane (the selected entry's view) --------------------------------

// One module instance, read from one of its holders: the shared identity strip (who
// else holds it, how this one came by it, whether its prompt carries it, what it costs)
// over the contents in the shape that kind is read in.
//
// The contents come from the module's own snapshot rather than this agent's slice —
// a shared store has one content — while the per-holder facts come from the roster this
// instance reported. See {@link GgModuleHeader}.
function ModuleFile({
  agentId,
  kind,
  modules,
  state,
  onOpenHolder,
  onOpenFile,
}: {
  agentId: string;
  kind: GgModuleKind;
  modules: GgModuleIndex;
  state: DerivedGgState;
  onOpenHolder: (agentId: string) => void;
  onOpenFile: (file: AgentFileKind) => void;
}) {
  // The way out to the store read as a store, on the Modules tab. Read from the context
  // rather than passed down, for the same reason every other cross-tab link is: the tab
  // selection is the panels' state, and this file is rendered several components below
  // them.
  const nav = useGgExplorerNav();
  const module = (modules.byAgent.get(agentId) ?? []).find(
    (held) => held.kind === kind,
  );
  if (!module) {
    return (
      <div className={panels.panelBody}>
        <p className={panels.empty}>
          This instance is not holding a {moduleKindLabel(kind).toLowerCase()}{" "}
          module — a succession may have dropped it, or its profile may never
          have enabled one.
        </p>
      </div>
    );
  }
  const holder =
    module.holders.find((entry) => entry.agentId === agentId) ?? null;
  return (
    <div className={panels.panelBody}>
      <div className={panels.moduleFile}>
        <GgModuleHeader
          module={module}
          holder={holder}
          onOpenHolder={onOpenHolder}
          onOpenModule={nav ? () => nav.openModule(module.id) : undefined}
        />
        <ModuleContents
          module={module}
          holder={holder}
          state={state}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}

function FileContent({
  node,
  state,
  file,
  role,
  arrival,
  capabilitySet,
  workflows,
  fsmPath,
  transitions,
  speculations,
  live,
}: {
  node: AgentNode;
  state: DerivedGgState;
  file: AgentFileKind;
  role?: SpeculationRole;
  /** The succession this instance arrived by, when it arrived by one. */
  arrival?: AgentTransition;
  capabilitySet: GgCapabilitySet | null;
  workflows: Workflow[];
  /** The states an FSM agent walked, and the successions between them. Empty for a
      run that drives no machine, which is almost all of them. */
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];
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
          arrival={arrival}
          isRoot={isRoot}
          workflows={workflows}
          fsmPath={fsmPath}
          transitions={transitions}
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
            agent={node.slot}
            compactions={state.compactions}
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
    case "metrics":
      return (
        <div className={panels.panelBody}>
          <RequestMetricsGraphs
            prompts={state.prompts}
            timings={state.turnTimings}
          />
        </div>
      );
    case "compaction":
      return (
        <div className={panels.panelBody}>
          <CompactionView compactions={state.compactions} />
        </div>
      );
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
        // The gg activity view leads the explorer pane directly, so drop the shared
        // feed header's top margin here (scoped via `panels.activityHeader`) — it is
        // meant to space the header from fields above it on the full-page feeds.
        <div className={cx(runExec.feedHeader, panels.activityHeader)}>
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
// session-scoped card (status, the agent overview, the configuration) has no place on
// one agent, so none appears here — those read on the Dashboard, as does the whole
// run's spend per slot and per model (this agent is one slot on one model, so the same
// split here would only restate its own total).
function OverviewFile({
  node,
  state,
  role,
  arrival,
  isRoot,
  workflows,
  fsmPath,
  transitions,
  speculations,
}: {
  node: AgentNode;
  state: DerivedGgState;
  role?: SpeculationRole;
  /** The succession this instance arrived by, when it arrived by one. */
  arrival?: AgentTransition;
  isRoot: boolean;
  workflows: Workflow[];
  /** The states an FSM agent walked, and the successions between them. Empty for a
      run that drives no machine, which is almost all of them. */
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];
  speculations: SpeculationState[];
}) {
  // Price this agent's own usage: its own per-(profile, model) tallies, summed from the
  // attributed `usage` deltas on its own stream, falling back to its aggregate tally at
  // the model its spawn bound it to when a stream carried no attribution.
  const pricedSlots = useMemo(
    () => agentPricedSlots(state.slotUsage, state.usage, node.modelId),
    [state.slotUsage, state.usage, node.modelId],
  );
  const costBreakdown = useGgCostBreakdown(pricedSlots);
  // How fast this one instance generated, across every call it made — the run-wide rate on
  // the Dashboard narrowed to the instance whose tokens these are.
  const throughput = useMemo(() => agentThroughput(state), [state]);
  // The agent's tool usage — the breakdown behind the Dashboard overview's chips.
  const tools = useMemo(() => ggToolBreakdown(state), [state]);
  // The high-water context snapshot — the turn the window was fullest — for the peak
  // gauge beside the current one. The snapshot with the most tokens carries its own
  // window limit and fullness, so the ring reads it the same way as the latest.
  const peakContext = useMemo<ContextSnapshot | null>(() => {
    let peak: ContextSnapshot | null = null;
    for (const snap of state.contextSeries) {
      if (peak == null || snap.totalTokens > peak.totalTokens) peak = snap;
    }
    return peak;
  }, [state.contextSeries]);
  return (
    <div className={panels.panelBody}>
      <div className={panels.overview}>
        <AgentIdentity
          node={node}
          role={role}
          turns={state.turnCount}
          arrival={arrival}
        />
        {/* The context-window gauges on their own row: how full the window is now,
            and its peak fullness at any point in the run, side by side. */}
        {(state.latestContext || peakContext) && (
          <div className={panels.contextRow}>
            <ContextUsageRing latest={state.latestContext} />
            <ContextUsageRing
              latest={peakContext}
              label="Peak context window"
            />
          </div>
        )}
        {/* The pane-responsive grid, not the Dashboard's viewport bento: this pane
            is narrower than the window, so the widgets must stack on the pane's own
            width. `bare` drops the widgets' card chrome — the panel already frames
            them, so a bordered card would read as a widget-in-a-widget. */}
        <div className={dash.overviewCards}>
          <TokensWidget usage={state.usage} throughput={throughput} bare />
          <CostWidget usage={state.usage} breakdown={costBreakdown} bare />
        </div>
        {tools.tools.length > 0 && (
          <AgentToolsPanel breakdown={tools} responses={state.turnCount} />
        )}
        {/* The run's delegation structure hangs off the main agent — it is a
            whole-run fact, not one subagent's, so it reads on the root. */}
        {isRoot && fsmPath.length > 0 && (
          <FsmPathStrip path={fsmPath} transitions={transitions} />
        )}
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
// same tools as bare chips; this is the itemized version behind them. Its caption line
// also carries the instance's call rate — how many calls it got out of each response —
// which is a fact about the agent rather than about any tool in the list, so it sits on
// the header beside the caption instead of being wedged in as a first row.
function AgentToolsPanel({
  breakdown,
  responses,
}: {
  breakdown: GgToolBreakdown;
  /** This instance's assistant responses — one per turn — the rate's denominator. */
  responses: number;
}) {
  const { tools, totalContextTokens, outputTokensKnown, totalCalls } =
    breakdown;
  // The instance's own calls over its own turns, both counted from its own partition of
  // the stream (never the whole-run `slot_usage` rollups, which the per-agent reduction
  // drops for exactly this reason). Null before it has taken a turn, so an agent whose
  // first call is streamed ahead of its first turn reads as calls with no rate yet.
  const perResponse = toolCallsPerResponse(breakdown, responses);
  return (
    <section className={panels.agentSection}>
      <div className={panels.toolsHead}>
        <span className={panels.subPanelLabel}>Tools</span>
        <span
          className={panels.toolsRate}
          title={
            "Tool and function calls per assistant response — " +
            `${callRatePhrase(totalCalls, responses)}. A proxy for efficiency: ` +
            "an agent that does more per round trip spends fewer responses, less latency, " +
            "and less context reaching the same place."
          }
        >
          {perResponse != null
            ? `${perResponse.toFixed(1)} calls per response`
            : `${totalCalls} call${totalCalls === 1 ? "" : "s"}`}
        </span>
      </div>
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
    </section>
  );
}
