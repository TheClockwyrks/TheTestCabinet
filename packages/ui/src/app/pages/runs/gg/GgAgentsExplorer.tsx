import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  GgAgentApi,
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
  GgCallBreakdown,
  ModuleSnapshot,
} from "./useGgRunState";
import {
  ROOT_ID,
  callRatePhrase,
  callRecordSurface,
  callsPerResponse,
  ggCallBreakdown,
  shortTokens,
} from "./useGgRunState";
import { cx } from "./ggFsTree";
import {
  apiCallSpellings,
  docViewTypesPhrase,
  surfaceCallPhrase,
} from "./ggSurfaceCalls";
import {
  FsExplorer,
  FsFileRow,
  FsFolder,
  useFsFolders,
  type FsFolders,
} from "./GgFsExplorer";
import type { GgModuleIndex, GgModuleInstance } from "./ggModules";
import {
  concurrentHolders,
  isCarried,
  isShared,
  moduleKindLabel,
  useGgModules,
} from "./ggModules";
import type { AgentEntry, AgentFileKind } from "./ggAgentEntries";
import {
  MODULE_ICONS,
  OVERVIEW_ENTRY,
  answersAsCode,
  entriesFor,
  fileIcon,
  fileLabel,
  filesFor,
  sameEntry,
} from "./ggAgentEntries";
import { GgModuleHeader, ModuleContents } from "./GgModuleViews";
import { useGgExplorerNav } from "./GgExplorerNav";
import { pricedSlots, useGgCostBreakdown } from "./ggCost";
import { agentThroughput } from "./ggThroughput";
import {
  ContextUsageRing,
  CostWidget,
  ErrorsWidget,
  TokensWidget,
  formatPercent,
} from "./GgOverviewWidgets";
import {
  AgentIdentity,
  FsmPathStrip,
  arrivalTag,
  classifyArrivals,
  isSuccession,
} from "./AgentTreeView";
import { ContextFillGraph } from "./ContextFillGraph";
import { PromptView } from "./PromptView";
import { RequestsView } from "./RequestsView";
import { ProgramsView } from "./ProgramsView";
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
// instance it holds (see gg/modules). That folder exists because a run's state — its
// memories, its task list, its handle on the board — is not any one agent's. A module
// instance can be held by several agents at once,
// carried whole to a successor across an `exec`, or copied when its holder forks, so
// "root's tasks" was a name for something that might be shared with four other
// instances and could not say so. A module file therefore leads with the store's
// identity — who else holds it, how this holder came by it, whether it reaches the
// prompt, what it costs the windows it is in — and only then shows the contents.

// Grouped digits for the counts this explorer states as bare figures (an offered
// entry's call count), so an instance that called one tool four thousand times reads
// as "4,000×" rather than "4000×".
const numberFmt = new Intl.NumberFormat("en-US");

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
  if (row.collapsible) line.collapsible = true;
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
  /** The states an FSM agent walked, and the successions between them. Empty for a
      run that drives no machine, which is almost all of them. */
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];
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
  fsmPath,
  transitions,
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
        selected.profileId,
        modules.byAgent.get(selected.id) ?? [],
        selected.surface,
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
            live={live}
          />
        ) : (
          <FileContent
            node={selectedNode}
            state={selectedState}
            file={selectedEntry.file}
            arrival={arrivals.get(selectedNode.id)}
            capabilitySet={capabilitySet}
            fsmPath={fsmPath}
            transitions={transitions}
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
  // This agent's own files — read off the profile it runs under, not the run's Root,
  // and off what this very instance reported it was offered — and the module instances
  // it holds, in the contract's kind order.
  const files = filesFor(ctx.capabilitySet, node.profileId, node.surface);
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
            node.profileId && (
              <span
                className={cx(panels.fsMeta, panels.fsMetaTrailing)}
                // Two profiles may read alike, so the id the row really joins on rides
                // in the tooltip rather than crowding a tree already dense with ids.
                title={node.profileId}
              >
                {node.profile ?? node.profileId}
              </span>
            )
          )}
        </>
      }
    >
      {files.map((file) => {
        // Both the mark and the name are resolved against this instance: the surface
        // file is `tools` under a wrench for an agent that names its tools, and `apis`
        // under angle brackets for one that calls them as code.
        const FileIcon = fileIcon(file, node.surface);
        const fileName = fileLabel(file, node.surface);
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
            ariaLabel={`${label} ${fileName}`}
            icon={<FileIcon className={panels.fsIcon} />}
            name={fileName}
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
              /* Shared means held AT ONCE. A store carried across a succession collects
                 holders exactly the way a shared one does and was never shared by anybody,
                 so it is annotated as the hand-off it is rather than counted. */
              isShared(module) ? (
                <>
                  <LinkIcon className={panels.fsShared} />
                  {/* The count reads at a glance and the title names the store and the
                      holders, because "shared with whom?" is the next question and the
                      file that answers it in full is one click further. */}
                  <span
                    className={cx(panels.fsMeta, panels.fsMetaTrailing)}
                    title={`${module.id} — held at once by ${concurrentHolders(
                      module,
                    )
                      .map((holder) => holder.agentId)
                      .join(", ")}`}
                  >
                    {concurrentHolders(module).length} holders
                  </span>
                </>
              ) : (
                isCarried(module) && (
                  <span
                    className={cx(panels.fsMeta, panels.fsMetaTrailing)}
                    title={`${module.id} — passed through ${module.holders
                      .map((holder) => holder.agentId)
                      .join(" → ")}, one at a time`}
                  >
                    handed on
                  </span>
                )
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
  live,
}: {
  agentId: string;
  kind: GgModuleKind;
  modules: GgModuleIndex;
  state: DerivedGgState;
  onOpenHolder: (agentId: string) => void;
  /** Whether the stream is still arriving — the window's message log says so. */
  live: boolean;
}) {
  // The way out to the store read as a store, on the Modules tab. Read from the context
  // rather than passed down, for the same reason every other cross-tab link is: the tab
  // selection is the panels' state, and this file is rendered several components below
  // them.
  const nav = useGgExplorerNav();
  // Withheld in a run with no Modules tab — see {@link GgExplorerNav.openModule}.
  const openModule = nav?.openModule;
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
          onOpenModule={openModule ? () => openModule(module.id) : undefined}
        />
        <ModuleContents
          module={module}
          holder={holder}
          state={state}
          live={live}
        />
      </div>
    </div>
  );
}

function FileContent({
  node,
  state,
  file,
  arrival,
  capabilitySet,
  fsmPath,
  transitions,
  live,
}: {
  node: AgentNode;
  state: DerivedGgState;
  file: AgentFileKind;
  /** The succession this instance arrived by, when it arrived by one. */
  arrival?: AgentTransition;
  capabilitySet: GgCapabilitySet | null;
  /** The states an FSM agent walked, and the successions between them. Empty for a
      run that drives no machine, which is almost all of them. */
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];
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
          arrival={arrival}
          isRoot={isRoot}
          fsmPath={fsmPath}
          transitions={transitions}
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
    case "surface":
      return (
        <div className={panels.panelBody}>
          <SurfaceFile node={node} state={state} />
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
            agent={node.profileId}
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
    case "programs":
      return (
        <div className={panels.panelBody}>
          <ProgramsView
            programs={state.programs}
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
            className={cx(runExec.followButton, runExec.followButtonCompact)}
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
// Tokens, Cost and Errors widgets (the very components the Dashboard uses, fed this
// agent's own partition of the stream) — so a subagent's spend and its failures are
// legible in the same shape as the run's, not a different-looking summary — and its
// call breakdown (the itemized version of
// the Dashboard row's chips, on the surface this instance called on). The run's process structure is a whole-run fact,
// so it hangs off the root agent only; a
// session-scoped card (status, the agent overview, the configuration) has no place on
// one agent, so none appears here — those read on the Dashboard, as does the whole
// run's spend per profile and per model (this agent is one profile on one model, so the same
// split here would only restate its own total).
function OverviewFile({
  node,
  state,
  arrival,
  isRoot,
  fsmPath,
  transitions,
}: {
  node: AgentNode;
  state: DerivedGgState;
  /** The succession this instance arrived by, when it arrived by one. */
  arrival?: AgentTransition;
  isRoot: boolean;
  /** The states an FSM agent walked, and the successions between them. Empty for a
      run that drives no machine, which is almost all of them. */
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];
}) {
  // Price this agent's own usage: its own per-(profile, model) tallies, summed from the
  // attributed `usage` deltas on its own stream.
  const priced = useMemo(() => pricedSlots(state.slotUsage), [state.slotUsage]);
  const costBreakdown = useGgCostBreakdown(priced);
  // How fast this one instance generated, across every call it made — the run-wide rate on
  // the Dashboard narrowed to the instance whose tokens these are.
  const throughput = useMemo(() => agentThroughput(state), [state]);
  // What this instance CALLED — the breakdown behind the Dashboard overview's chips, taken
  // on the record its own execution mode says it made calls on (see `callRecordSurface`).
  // A code instance's calls are the functions its programs wrote; a tool-calling one's are
  // its tools, which is every call it could possibly have made.
  const calls = useMemo(
    () =>
      ggCallBreakdown(
        state,
        callRecordSurface(state.apiCalls, node.surface?.executionMode),
        node.surface ? apiCallSpellings(node.surface.apis) : undefined,
      ),
    [state, node.surface],
  );
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
        <AgentIdentity node={node} turns={state.turnCount} arrival={arrival} />
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
          {/* What this instance's turns FAILED at, beside what they spent — the same
              widget the Dashboard's error row is folded from, narrowed to one instance.
              It belongs on the Overview and not only on the Dashboard because the
              whole-run figure is a sum: an instance that failed every turn it took and
              one that failed none are indistinguishable in it, and the run's own
              consecutive-error peak names no agent. Here the streak is a real streak —
              one instance's turns are sequential, where the run's interleave.

              Its execution mode rides along because the widget's second ranking — the
              calls that failed — has two records to draw from and they count different
              things (see `callFailureSurface`). This instance's own surface is what says
              which of them it fought, and the instance is the only scope that can answer
              it: a run mixing tool-calling and responses-as-code agents has no one
              answer. */}
          <ErrorsWidget
            errors={state.errors}
            executionMode={node.surface?.executionMode}
            bare
          />
        </div>
        {calls.calls.length > 0 && (
          <AgentCallsPanel breakdown={calls} responses={state.turnCount} />
        )}
        {/* The run's delegation structure hangs off the main agent — it is a
            whole-run fact, not one subagent's, so it reads on the root. */}
        {isRoot && fsmPath.length > 0 && (
          <FsmPathStrip path={fsmPath} transitions={transitions} />
        )}
      </div>
    </div>
  );
}

// An agent's call breakdown, shown on its Overview: everything it CALLED, most used
// first, with how many times it called it and — where the message log recorded it — how
// many tokens that call's results added to the window, as a share of all the tokens that
// entered the agent's context.
//
// It reads on the surface the instance actually made calls on, and says which in its
// caption: "Tool calls" for a tool-calling instance, "API calls" for one that answers its
// turns as code, whose programs called `fs.readFile` and never uttered the name of the
// tool underneath it. The alternative — one caption over the tool layer for everybody —
// headed a panel "Tool calls" for an agent that makes none, and itemized the run in a
// vocabulary the model never used. It is the same choice `ErrorsWidget` makes one widget
// over, resolved the same way so the console reads as one system.
//
// Captioned "…calls" rather than "Tools"/"APIs" because the instance's own surface file
// answers what it was *offered*, and a list of what it used named the same thing as the
// list of what it had would quietly answer the wrong question. The Dashboard's agent
// overview shows the same entries as bare chips; this is the itemized version behind them.
// Its caption line also carries the instance's call rate — how many calls it got out of
// each response — which is a fact about the agent rather than about any entry in the list,
// so it sits on the header beside the caption instead of being wedged in as a first row.
//
// The token-share columns are dropped on the API surface, and their absence is the honest
// reading rather than a gap: a responses-as-code turn produces no tool-role messages at
// all, so there is no per-function material in the window to attribute and the bar would
// be pinned at zero on every row beside a `0 · 0%` (see `ggCallBreakdown`).
function AgentCallsPanel({
  breakdown,
  responses,
}: {
  breakdown: GgCallBreakdown;
  /** This instance's assistant responses — one per turn — the rate's denominator. */
  responses: number;
}) {
  const { surface, calls, totalContextTokens, outputTokensKnown, totalCalls } =
    breakdown;
  const asApis = surface === "api";
  // The instance's own calls over its own turns, both counted from its own partition of
  // the stream (never the whole-run `slot_usage` rollups, which the per-agent reduction
  // drops for exactly this reason). Null before it has taken a turn, so an agent whose
  // first call is streamed ahead of its first turn reads as calls with no rate yet.
  const perResponse = callsPerResponse(breakdown, responses);
  return (
    <section className={panels.agentSection}>
      <div className={panels.toolsHead}>
        <span className={panels.subPanelLabel}>
          {asApis ? "API calls" : "Tool calls"}
        </span>
        <span
          className={panels.toolsRate}
          title={
            (asApis
              ? "API function calls per assistant response — "
              : "Tool and function calls per assistant response — ") +
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
        {calls.map((entry) => {
          const share =
            outputTokensKnown && totalContextTokens > 0
              ? entry.outputTokens / totalContextTokens
              : null;
          return (
            <li
              key={entry.name}
              className={cx(panels.toolRow, asApis && panels.callRowBare)}
            >
              <span className={panels.toolName}>{entry.name}</span>
              <span className={panels.toolCalls}>
                {entry.calls}
                {"×"}
              </span>
              {!asApis && (
                <>
                  <span className={panels.toolBar} aria-hidden="true">
                    <span
                      className={panels.toolBarFill}
                      style={{ width: `${(share ?? 0) * 100}%` }}
                    />
                  </span>
                  <span className={panels.toolTokens}>
                    {share != null
                      ? `${shortTokens(entry.outputTokens)} · ${formatPercent(share)}`
                      : "—"}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// What one instance was OFFERED to call, over what it actually called: every gg tool it
// was given — or, for an agent that answers its turns as code, every function bound on
// the API objects its programs run against — each carrying its own call count.
//
// The contrast is the reason the file exists. A call listed here that the model never
// reached for was offered and ignored, which is a fact about the model; a call that is
// missing was never on the table, which is a fact about the run — a capability off, a name
// the agent's allowlist never granted, a module unbound, or an FSM state that gates it.
// Those are opposite findings, and no other read-out of a run can tell them apart, because
// a call count on its own cannot say what the agent had to choose from.
//
// Both halves come off the instance's own reported surface rather than being re-derived
// from the configuration: gg resolves it per incarnation, and a re-derivation here could
// not know which modules bound, which state of a machine the instance sat in, or which
// calls its role's ending added. What is NOT on the page is a roster of the calls the
// configuration held back, and its absence is the same decision: the offered set is what gg
// resolved, and the calls outside it are outside it for reasons this file cannot rank — a
// capability left off and a name left out of an allowlist are one absence, said twice.
function SurfaceFile({
  node,
  state,
}: {
  node: AgentNode;
  state: DerivedGgState;
}) {
  // This instance's own tool calls — its partition of the stream, keyed by gg tool name.
  // Asked for explicitly rather than through `callRecordSurface`: the question this file
  // asks is "what became of each tool I was offered", and a code instance is read against
  // its API modules a few lines below instead.
  const toolCalls = useMemo(() => new Map(state.toolCalls), [state.toolCalls]);
  const surface = node.surface;
  if (!surface) {
    // Unreachable through the sidebar, which does not offer the file to an instance that
    // reported no surface — but the pane is rendered from a selection, and a selection
    // outliving its instance must say what is missing rather than assert an empty toolset.
    return (
      <p className={panels.empty}>
        This instance never reported what it was offered.
      </p>
    );
  }
  // A code agent is read through its modules; a tool-calling one through the flat list —
  // decided by the same predicate that named the row, so the file always opens what its
  // name promised. The modules have to actually be there: an instance that bound none is
  // read on the other surface, which for a code instance is empty and says so.
  const asCode = answersAsCode(surface) && surface.apis.length > 0;
  return (
    <div className={panels.surfaceFile}>
      {asCode ? (
        // A code instance is read against what its programs CALLED — one figure per
        // function, on the function's own identity. There is no tool record to read it
        // against: a program's calls are streamed on this surface and on no other.
        <ApiSurface
          apis={surface.apis}
          calls={state.apiCalls}
          docViewTypes={surface.docViewTypes}
        />
      ) : (
        <ToolSurface tools={surface.tools} calls={toolCalls} />
      )}
    </div>
  );
}

// The flat offered set of a tool-calling instance, in the order the model was shown it —
// the registry's own order, which is the order the tools appear in its system prompt, so
// the file reads the way the agent was addressed rather than by anything this view sorts
// by. The caption says how much of the set was used at all, which is the one number worth
// having before reading a row of it.
function ToolSurface({
  tools,
  calls,
}: {
  tools: readonly string[];
  calls: ReadonlyMap<string, number>;
}) {
  const used = tools.filter((tool) => (calls.get(tool) ?? 0) > 0).length;
  return (
    <section className={panels.agentSection} aria-label="offered tools">
      <div className={panels.toolsHead}>
        <span className={panels.subPanelLabel}>Tools</span>
        <span
          className={panels.toolsRate}
          title={
            "Every tool this instance was offered, after its capabilities, its allowlist " +
            "and the modules it bound were resolved. A tool it did not use reads a real 0× " +
            "and is dimmed, not dropped — offered and unused is a different finding from " +
            "never offered."
          }
        >
          {used} of {tools.length} called
        </span>
      </div>
      <ul className={panels.toolList}>
        {tools.map((tool) => (
          <SurfaceRow key={tool} name={tool} count={calls.get(tool) ?? 0} />
        ))}
      </ul>
    </section>
  );
}

// The offered set of a responses-as-code instance, grouped the way its programs address
// it: one card per capability module, carrying the same one-line description the agent's
// own system prompt introduced the module by, over the functions this instance actually
// binds. A module it was not given is absent entirely rather than listed empty, which is
// gg's own reporting and not a choice this view makes.
//
// A row reads by the arm's own spelling and counts by gg's operation id — the two names
// every surface row carries, and the reason a count survives an arm that spells the call
// differently.
function ApiSurface({
  apis,
  calls,
  docViewTypes,
}: {
  apis: readonly GgAgentApi[];
  calls: ReadonlyMap<string, number>;
  /**
   * Which SDK types this instance's documentation lookups opened beside a function, as gg
   * resolved it — the arm of a per-agent comparison. Null for a tool-calling instance, which
   * opens no documentation.
   */
  docViewTypes: string | null;
}) {
  const functions = apis.reduce(
    (total, api) => total + api.functions.length,
    0,
  );
  return (
    <section className={panels.agentSection} aria-label="offered apis">
      <div className={panels.toolsHead}>
        <span className={panels.subPanelLabel}>APIs</span>
        {/* The documentation arm this instance was on. It belongs on this file rather than
            on the run's header for the reason it is per agent at all: two instances of one
            run may be on two arms, and the tokens each spent on documentation are its own.
            Read beside its own agent's context breakdown, this is what says which mode
            those tokens belong to. */}
        {docViewTypes && (
          <span
            className={panels.toolsRate}
            title={docViewTypesPhrase(docViewTypes)}
          >
            docs: {docViewTypes}
          </span>
        )}
        <span
          className={panels.toolsRate}
          title={
            "The modules this instance's programs are bound against. Every call a program " +
            "makes is recorded under the function the model wrote, so each row carries its " +
            "own figure — a view, an ending and a documentation lookup are counted exactly " +
            "as a file read is — and a function it was offered and did not use reads a " +
            "real 0× rather than an absence."
          }
        >
          {apis.length} module{apis.length === 1 ? "" : "s"} · {functions}{" "}
          function{functions === 1 ? "" : "s"}
        </span>
      </div>
      <ul className={panels.knowledgeList}>
        {apis.map((api) => (
          <li key={api.module || api.path} className={panels.knowledgeRow}>
            <div className={panels.knowledgeHead}>
              <span className={panels.knowledgeName}>{api.path}</span>
              <span className={panels.knowledgeBadge}>
                {api.functions.length} fn
              </span>
            </div>
            <p className={panels.knowledgeDesc}>{api.description}</p>
            <ul className={cx(panels.toolList, panels.surfaceFunctions)}>
              {api.functions.map((fn) => (
                <SurfaceRow
                  key={fn.name}
                  name={`${api.path}.${fn.name}`}
                  // On gg's OWN identity for the call, which is what its records name it
                  // by — every bound function states one, so every row carries a figure.
                  count={calls.get(fn.operation) ?? 0}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// One offered thing and what became of it: how often it was called, then what it was.
//
// The count leads because the count is what the file is read down. Every row here names
// something the agent was given, so the names are the column that repeats and the figures
// are the column that differs — and a figure in a fixed leading column can be scanned
// straight down the list, where a trailing one hangs off names of every length and has to
// be hunted along each row.
//
// Two states, and keeping them visually distinct is the feature: used (its count), and
// offered and not used — a real `0×`, dimmed. The second state is a bare zero rather than
// words, because it IS
// a measurement, and an exact one: gg records every model-facing call under its own
// identity, so a zero here is the same kind of fact as a three, taken the same way, and
// spelling one of them out in prose made the two rows impossible to compare down a column
// they now share. The dimming carries the finding, and the tooltip carries the sentence.
//
// There is deliberately no third state for "nothing counts this". Every model-facing call
// is recorded under its own identity, tool or no tool, so a view call and an ending call
// have figures exactly as a file read does, and every row on this list carries one.
function SurfaceRow({ name, count }: { name: string; count: number }) {
  return (
    <li
      className={`${panels.toolRow} ${panels.surfaceRow}`}
      data-uncalled={count === 0 ? "" : undefined}
      title={surfaceCallPhrase(name, count)}
    >
      <span className={panels.toolCallCount}>{numberFmt.format(count)}×</span>
      <span className={panels.toolName}>{name}</span>
    </li>
  );
}
