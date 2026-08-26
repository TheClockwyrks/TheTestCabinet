import { useEffect, useMemo, useState } from "react";
import type {
  GgCapabilitySet,
  GgModuleKind,
} from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import { formatEventTime } from "../../../eventFeed";
import type {
  AgentTransition,
  AgentTreeNode,
  DerivedGgState,
  ModuleSnapshot,
} from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import type { GgModuleHolder, GgModuleInstance } from "./ggModules";
import {
  concurrentHolders,
  isCarried,
  isShared,
  moduleKindLabel,
  moduleReportsContents,
  useGgModules,
} from "./ggModules";
import {
  GgModuleHeader,
  ModuleContents,
  moduleContentSummary,
  moduleLifetimeLabel,
} from "./GgModuleViews";
import { ModuleStat, ModuleStats } from "./ModuleStats";
import { MODULE_ICONS } from "./ggAgentEntries";
import { cx } from "./ggFsTree";
import { FsExplorer, FsFileRow, FsFolder, useFsFolders } from "./GgFsExplorer";
import { useGgExplorerNav } from "./GgExplorerNav";
import { LinkIcon, OverviewIcon } from "./ggIcons";
import { formatPercent } from "./GgOverviewWidgets";

// The Modules tab: a gg run read by the **state it holds** rather than by the agents
// holding it.
//
// The other three surfaces are all per agent — the Dashboard sums them, the Agents tab
// groups them by profile, the Instances tab reads one at a time. That was the right and
// only axis while a module belonged to exactly one agent, and it is the wrong one now: a
// module instance can be held by several instances at once (a profile-scoped memory
// store, a spawner's notebook a subagent inherits, the run's one board), carried whole to
// a successor across an `exec`, or copied when its holder forks (see gg/modules). Read
// per agent, one store shared by four reviewers looks exactly like four stores that
// happen to agree — which is the difference between "the shared-memory arm is working"
// and "it silently fell back to private notebooks", and it was invisible.
//
// So this tab inverts the axis. Module instances are grouped by kind, and each is read as
// a thing in its own right: who holds it (and who is still running), how each of them came
// by it, everything that has happened to it since it was created, what it costs the
// windows it is in every turn, and what is actually in it. Each kind's group leads with an
// Overview — the capability's own read-out, across the whole run — because the question
// the tab exists for is asked one capability at a time: *is this capability being used the
// way it was configured to be, and is it earning its keep?*

// What a kind's folder is keyed on in the tree's open/closed map.
function kindKey(kind: GgModuleKind): string {
  return `kind:${kind}`;
}

// A selected entry: one kind's whole-run overview, or one module instance.
//
// The group overview is an entry rather than something drawn above the tree because it is
// the answer to the tab's headline question, and burying it above a scrolling list would
// make "how is this capability being used" the one thing you cannot navigate to. It
// mirrors the Project explorer's epic Overview exactly: a folder whose first child
// summarizes the folder.
type Selection =
  | { kind: "group"; moduleKind: GgModuleKind }
  | { kind: "module"; moduleId: string };

/**
 * What another surface can ask this tab to open: one store, or one kind's whole-run
 * read-out.
 *
 * Both are asked for, and by different questions — a module file's "open in Modules" means
 * *this* store, and a profile whose stores turned out to be one-per-instance means "show me
 * all of them side by side" — so the focus channel carries the selection itself rather than
 * a bare id plus a second, parallel channel that could disagree with it.
 */
export type GgModuleFocus = Selection;

interface GgModulesExplorerProps {
  /** The run's configuration — what each profile *declared* about its modules. */
  capabilitySet: GgCapabilitySet | null;
  /** The delegation forest, whose instances are the holders. */
  forest: AgentTreeNode[];
  /** Each instance's own reduced slice, keyed by agent id. */
  perAgent: Map<string, DerivedGgState>;
  /** The successions — what each of them did to each module (the lifetimes). */
  transitions: AgentTransition[];
  /** The latest contents of every module instance, keyed by module id. */
  moduleSnapshots: Map<string, ModuleSnapshot>;
  /**
   * Whether the stream is still arriving. Only a window's message log reads it — an
   * empty log is "waiting for the first request" on a live run and "none were recorded"
   * on a finished one.
   */
  live: boolean;
  /**
   * A store — or a whole kind — to jump to, set when another surface links here (the
   * Instances tab's module header, an Agents-tab row's "compare in Modules"). Consumed
   * once, through `onFocusHandled`.
   */
  focusModule?: GgModuleFocus | null;
  onFocusHandled?: () => void;
}

/**
 * The Modules panel — every module instance the run held, grouped by kind, with the
 * holders, lifetime, cost and contents of the selected one. Offered only when some agent
 * profile has a module-backed capability on (see {@link GgRunPanels}).
 */
export function GgModulesExplorer({
  capabilitySet,
  forest,
  perAgent,
  transitions,
  moduleSnapshots,
  live,
  focusModule,
  onFocusHandled,
}: GgModulesExplorerProps) {
  const modules = useGgModules(
    capabilitySet,
    forest,
    perAgent,
    transitions,
    moduleSnapshots,
  );
  const folders = useFsFolders();

  // The landing: the first non-history group's overview. History is one instance per
  // agent by construction — the longest group and the least surprising — so the tab opens
  // on the capability whose usage is actually in question. A run that somehow has nothing
  // else falls back to it rather than to nothing.
  const firstSelection = useMemo<Selection | null>(() => {
    const groups = modules.byKind;
    const lead =
      groups.find((group) => group.kind !== "history") ?? groups[0] ?? null;
    return lead ? { kind: "group", moduleKind: lead.kind } : null;
  }, [modules]);

  const [selection, setSelection] = useState<Selection | null>(firstSelection);

  // Keep the selection valid as the live stream grows: a module instance a succession
  // dropped, or a kind whose last instance went with it, falls back to the landing.
  useEffect(() => {
    const stillValid =
      selection != null &&
      (selection.kind === "module"
        ? modules.byId.has(selection.moduleId)
        : modules.byKind.some((group) => group.kind === selection.moduleKind));
    if (!stillValid) setSelection(firstSelection);
  }, [modules, selection, firstSelection]);

  // Honor a jump-to request from elsewhere in the panels — the Instances tab's module
  // header (the same store, read from one of its holders) or an Agents-tab row whose stores
  // turned out to be one per instance (this kind, all of them, side by side). The target's
  // group is forced open on the way, since a group can be closed (history's is, by default)
  // and landing behind a caret would drop half the request.
  const openFolders = folders.open;
  useEffect(() => {
    if (focusModule == null) return;
    if (focusModule.kind === "group") {
      if (
        !modules.byKind.some((group) => group.kind === focusModule.moduleKind)
      )
        return;
      setSelection(focusModule);
      openFolders([kindKey(focusModule.moduleKind)]);
      onFocusHandled?.();
      return;
    }
    const module = modules.byId.get(focusModule.moduleId);
    if (!module) return;
    setSelection({ kind: "module", moduleId: module.id });
    openFolders([kindKey(module.kind)]);
    onFocusHandled?.();
  }, [focusModule, modules, openFolders, onFocusHandled]);

  if (modules.byKind.length === 0) {
    return (
      <div className={panels.panelBody}>
        <p className={panels.empty}>
          No modules yet. The stores the run's agents hold (their memories, task
          lists, skills, its board) appear here as gg opens them.
        </p>
      </div>
    );
  }

  const selectedGroup =
    selection?.kind === "group"
      ? (modules.byKind.find((group) => group.kind === selection.moduleKind) ??
        null)
      : null;
  const selectedModule =
    selection?.kind === "module"
      ? (modules.byId.get(selection.moduleId) ?? null)
      : null;

  return (
    <FsExplorer
      sidebarLabel="Modules"
      tree={modules.byKind.map((group) => (
        <KindFolder
          key={group.kind}
          kind={group.kind}
          instances={group.instances}
          open={folders.isOpen(kindKey(group.kind), group.kind !== "history")}
          onToggle={() =>
            folders.toggle(kindKey(group.kind), group.kind !== "history")
          }
          selection={selection}
          onSelect={setSelection}
        />
      ))}
    >
      {selectedModule ? (
        <ModuleDetail module={selectedModule} perAgent={perAgent} live={live} />
      ) : selectedGroup ? (
        <KindOverview
          kind={selectedGroup.kind}
          instances={selectedGroup.instances}
          onOpenModule={(moduleId) =>
            setSelection({ kind: "module", moduleId })
          }
        />
      ) : (
        <p className={panels.empty}>Select a module.</p>
      )}
    </FsExplorer>
  );
}

// --- Sidebar -----------------------------------------------------------------

// One kind's group: its Overview, then one row per instance of that kind, in first-seen
// order.
//
// Groups open by default — they are grouping folders, like `subagents`, and their children
// are leaves so there is no explosion — except `history`, which is one instance per agent
// by construction and is therefore the longest and least interesting group in every run.
function KindFolder({
  kind,
  instances,
  open,
  onToggle,
  selection,
  onSelect,
}: {
  kind: GgModuleKind;
  instances: GgModuleInstance[];
  open: boolean;
  onToggle: () => void;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const Icon = MODULE_ICONS[kind];
  // How widely this kind is shared, at a glance: the holder total says whether four
  // instances are reading four stores or one. Both figures are on the closed row because
  // that comparison is the tab's headline and it should not need a click.
  const holders = instances.reduce(
    (sum, module) => sum + module.holders.length,
    0,
  );
  return (
    <FsFolder
      depth={0}
      open={open}
      onToggle={onToggle}
      // Named for what it groups: an unlabelled "memories" row would be ambiguous
      // against the instance rows inside it.
      ariaLabel={`${kind} modules`}
      icon={<Icon className={panels.fsIcon} />}
      name={kind}
      // A bare count, the way the `subagents` folder carries one — the sidebar is
      // narrow and the distribution behind that count is what the group's Overview is
      // for. The title carries the second half for a reader hovering the row.
      meta={
        <span
          className={panels.fsMeta}
          title={`${instances.length} instance${instances.length === 1 ? "" : "s"}, held between ${holders} agent instance${holders === 1 ? "" : "s"}`}
        >
          {instances.length}
        </span>
      }
    >
      <FsFileRow
        depth={1}
        selected={selection?.kind === "group" && selection.moduleKind === kind}
        onSelect={() => onSelect({ kind: "group", moduleKind: kind })}
        ariaLabel={`${kind} overview`}
        icon={<OverviewIcon className={panels.fsIcon} />}
        name="Overview"
      />
      {instances.map((module) => (
        <FsFileRow
          key={module.id}
          depth={1}
          selected={
            selection?.kind === "module" && selection.moduleId === module.id
          }
          onSelect={() => onSelect({ kind: "module", moduleId: module.id })}
          ariaLabel={`module ${module.id}`}
          icon={<Icon className={panels.fsIcon} />}
          name={module.id}
          meta={
            <>
              {/* The link glyph marks CONCURRENT holding only: a store handed on collects
                  holders the same way and was never shared, and the count beside it is the
                  number that held it at once. The title carries the whole chain. */}
              {isShared(module) && <LinkIcon className={panels.fsShared} />}
              <span
                className={panels.fsMeta}
                title={
                  isCarried(module)
                    ? `passed through ${module.holders
                        .map((holder) => holder.agentId)
                        .join(" → ")}, one at a time`
                    : `held by ${module.holders
                        .map((holder) => holder.agentId)
                        .join(", ")}`
                }
              >
                {`${concurrentHolders(module).length} ${concurrentHolders(module).length === 1 ? "holder" : "holders"}`}
              </span>
              <span className={cx(panels.fsMeta, panels.fsMetaTrailing)}>
                {whose(module)}
              </span>
            </>
          }
        />
      ))}
    </FsFolder>
  );
}

// Whose a module instance is, in the two words a tree row has room for: the profile that
// shares it, "run-global" where it reaches across profiles, "handed on" where it went from
// one instance to the next rather than being shared by both, "(dropped)" where every holder
// has let go of it, and the holding instance's own id where it is nobody's but one agent's.
function whose(module: GgModuleInstance): string {
  // Only once EVERY holder has released it — a `dropped` disposition is one outgoing
  // instance's release, and the run's board is dropped by somebody in most runs while the
  // rest of the run keeps writing it.
  if (module.dropped) return "(dropped)";
  switch (module.scopeKind) {
    case "agent":
      return module.profile ?? "shared";
    case "run":
      return "run-global";
    case "carried":
      return "handed on";
    case "instance":
      return module.holders[0]?.agentId ?? "unheld";
  }
}

// --- The kind overview (a capability's whole-run read-out) --------------------

// One module kind across the whole run: how many stores of it exist, how widely they are
// shared, what they cost every turn, and how much they actually hold.
//
// This is the surface the tab exists for. "Is the memories capability earning its keep?"
// is not answerable from one store — it is answerable from *all* of them side by side: a
// run with twelve private notebooks holding two notes each is paying twelve rents for
// nothing, and a run with one store four agents curate is the arm that worked. Neither
// reads as anything at all one instance at a time.
function KindOverview({
  kind,
  instances,
  onOpenModule,
}: {
  kind: GgModuleKind;
  instances: GgModuleInstance[];
  onOpenModule: (moduleId: string) => void;
}) {
  const holders = instances.flatMap((module) => module.holders);
  const live = instances.flatMap((module) => module.liveHolders);
  // Shared means held at once — see {@link concurrentHolders}. Counted separately from the
  // hand-offs, which look identical in a holder total and are the opposite finding: a store
  // several instances *took turns* with says nothing about whether sharing was configured.
  const shared = instances.filter(isShared);
  const carried = instances.filter(isCarried).length;
  const widest = instances.reduce(
    (max, module) => Math.max(max, concurrentHolders(module).length),
    0,
  );
  // The rent, summed the way it is actually paid: every live holder re-sends its copy of
  // the band on every request, so a store four running agents hold costs four times over,
  // every turn. Instances with no band (the archive) contribute nothing and say so.
  const perTurn = instances.reduce(
    (sum, module) => sum + (module.totalCost?.latestTokens ?? 0),
    0,
  );
  // The windows that figure is actually spread over — the holders that contributed one,
  // which is not the same as the holder count: an instance whose window never reported a
  // breakdown pays an unknown rent, not a zero one, and counting it would quietly divide
  // the total by too much.
  const paying = instances.reduce(
    (count, module) =>
      count +
      (module.liveHolders.length > 0
        ? module.liveHolders
        : module.holders
      ).filter((holder) => holder.cost).length,
    0,
  );
  const dropped = instances.filter((module) => module.dropped).length;
  // Only a kind that HAS contents can be "holding nothing". A window reports itself as a
  // per-turn context breakdown rather than as a snapshot, so counting its missing snapshot
  // as an untouched store would report every window in every run as never written to — the
  // exact inverse of the truth about the fullest thing an agent holds.
  const reportsContents = moduleReportsContents(kind);
  const empty = reportsContents
    ? instances.filter((module) => moduleContentSummary(module) == null).length
    : 0;
  // Whether the rent is a measured zero or simply not measurable/measured yet — three
  // different findings that all render as "no tokens" unless they are told apart. The
  // archive is out of the window by definition and has no band at all.
  const perTurnSub =
    perTurn > 0
      ? `across ${paying} window${paying === 1 ? "" : "s"}`
      : kind === "archive"
        ? "no context band"
        : paying > 0
          ? "measured zero"
          : "not measured yet";

  return (
    <div className={panels.panelBody}>
      <div className={panels.moduleFile}>
        <section className={panels.moduleHead} aria-label="Module kind">
          {/* The kind, and nothing else. The instance and holder totals are the first
              two figures of the stat row immediately below. */}
          <div className={panels.moduleIdentity}>
            <span className={panels.moduleId}>{moduleKindLabel(kind)}</span>
          </div>
        </section>

        <ModuleStats label="Usage">
          <ModuleStat
            label="instances"
            value={String(instances.length)}
            sub={dropped > 0 ? `${dropped} dropped` : undefined}
          />
          <ModuleStat
            label="holders"
            value={String(holders.length)}
            sub={`${live.length} still running`}
          />
          <ModuleStat
            label="shared"
            value={`${shared.length} of ${instances.length}`}
            sub={
              widest > 1
                ? `widest: ${widest} holders`
                : carried > 0
                  ? `none shared · ${carried} handed on`
                  : "none shared"
            }
            title="How many of this kind's stores more than one instance held AT ONCE. A store passed from one instance to its successor is counted as handed on rather than shared: it collects holders the same way and only ever had one. A capability configured to share whose stores are all private is the divergence worth finding."
          />
          <ModuleStat
            label="per turn"
            value={
              perTurn > 0 || (paying > 0 && kind !== "archive")
                ? shortTokens(perTurn)
                : "—"
            }
            sub={perTurnSub}
            title="What this kind costs the windows carrying it, every turn. A module's block in the window is re-sent on every request its holder makes, so a store three running agents hold is paid for three times a turn."
          />
          {reportsContents && (
            <ModuleStat
              label="holding nothing"
              value={`${empty} of ${instances.length}`}
              sub={empty > 0 ? "never written to" : "all in use"}
              title="Stores whose contents never arrived: the capability was given, the tools were offered, and nothing was put in them."
            />
          )}
        </ModuleStats>

        {/* The distribution: every store of this kind side by side, so "one shared or
            twelve private?" is read down a column rather than assembled from twelve
            visits. */}
        <section className={panels.moduleStack} aria-label="Instances">
          <span className={panels.subPanelLabel}>Instances</span>
          <ul className={panels.modDist}>
            {instances.map((module) => {
              const contents = moduleContentSummary(module);
              return (
                <li key={module.id} className={panels.modDistRow}>
                  <button
                    type="button"
                    className={panels.modDistId}
                    onClick={() => onOpenModule(module.id)}
                  >
                    {module.id}
                  </button>
                  <span className={panels.modDistWhose}>
                    {isShared(module) && (
                      <LinkIcon className={panels.moduleBadgeIcon} />
                    )}
                    {whose(module)}
                  </span>
                  <span className={panels.modDistHolders}>
                    {module.holders
                      .map((holder) => holder.agentId)
                      .join(" · ") || "—"}
                  </span>
                  {/* An empty column would read the same for a store nobody wrote to and
                      for a window, which has no contents to report at all. */}
                  <span className={panels.modDistContents}>
                    {contents ?? (reportsContents ? "never written to" : "—")}
                  </span>
                  <span className={panels.modDistCost}>
                    {module.totalCost
                      ? `${shortTokens(module.totalCost.latestTokens)}/turn`
                      : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

// --- The instance detail ------------------------------------------------------

// One module instance in full: identity, holders, lifetime, cost, contents — in that
// order, because it is the order the questions get asked. What is this store; who is in
// it; how did it get that way; what is it costing; what does it hold.
function ModuleDetail({
  module,
  perAgent,
  live,
}: {
  module: GgModuleInstance;
  perAgent: Map<string, DerivedGgState>;
  /** Whether the stream is still arriving — the window's message log says so. */
  live: boolean;
}) {
  // The holder whose slice the contents are read against — used only by the two kinds
  // whose read-out genuinely needs one (a window's turn count, an archive's reclaim
  // figures), and both of those belong to exactly one live instance by construction. Every
  // other kind's contents come wholly from the module's own snapshot, which is the whole
  // point of a store having one content rather than N.
  const current = module.holders[module.holders.length - 1] ?? null;
  const holderState =
    (module.kind === "history" || module.kind === "archive") && current
      ? (perAgent.get(current.agentId) ?? null)
      : null;

  return (
    <div className={panels.panelBody}>
      <div className={panels.moduleFile}>
        {/* Identity only: the three sections below carry the holders, the lifetime and
            the cost in full, and the strip's own one-line versions of them over the top
            would be the same facts said twice in two densities. */}
        <GgModuleHeader module={module} holder={null} detail="identity" />
        <HoldersSection module={module} />
        <LifetimeSection module={module} />
        <CostSection module={module} />
        <section className={panels.moduleStack} aria-label="Contents">
          <span className={panels.subPanelLabel}>Contents</span>
          <ModuleContents
            module={module}
            holder={null}
            state={holderState}
            live={live}
          />
        </section>
      </div>
    </div>
  );
}

// Who holds this store, and on what terms. The section the tab exists for: an id, the
// profile it runs under, how it came by the store, whether it may write it, whether its
// prompt carries it, and what the store costs that window every turn.
//
// Both names are links out, because they are two different follow-up questions: the agent
// id asks "what was *that instance* doing with it" (the Instances tab) and the profile
// asks "is this how that *arm* is configured" (the Agents tab).
function HoldersSection({ module }: { module: GgModuleInstance }) {
  const nav = useGgExplorerNav();
  return (
    <section className={panels.moduleStack} aria-label="Holders">
      <span className={panels.subPanelLabel}>
        Holders · {module.holders.length}
      </span>
      <ul className={panels.modHolders}>
        {module.holders.map((holder) => (
          <li key={holder.agentId} className={panels.modHolderRow}>
            <span
              className={panels.moduleHolderDot}
              data-status={holder.status}
              aria-hidden="true"
            />
            {nav ? (
              <button
                type="button"
                className={panels.modHolderId}
                onClick={() =>
                  nav.openAgent(holder.agentId, {
                    kind: "module",
                    module: module.kind,
                  })
                }
              >
                {holder.agentId}
              </button>
            ) : (
              <span className={panels.modHolderId}>{holder.agentId}</span>
            )}
            {nav ? (
              <button
                type="button"
                className={panels.modHolderProfile}
                onClick={() => nav.openProfile(holder.profileId)}
              >
                {holder.profile}
              </button>
            ) : (
              <span className={panels.modHolderProfile}>{holder.profile}</span>
            )}
            <span className={panels.modHolderOrigin}>
              {holderOrigin(module, holder)}
            </span>
            <span className={panels.modHolderAccess}>
              <span className={panels.moduleBadge}>
                {holder.writable ? "read/write" : "read-only"}
              </span>
              {holder.scope && (
                <span className={panels.moduleBadge}>{holder.scope}</span>
              )}
            </span>
            <span className={panels.modHolderCost}>
              {holder.cost
                ? `${shortTokens(holder.cost.latestTokens)}/turn`
                : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// How one holder came by the store, said in the holder list's shorter register than the
// header strip's sentence — the same fact, sized for a table cell.
function holderOrigin(
  module: GgModuleInstance,
  holder: GgModuleHolder,
): string {
  switch (holder.origin) {
    case "created":
      return "created it";
    case "inherited":
      return `inherited from ${module.holders[0]?.agentId ?? "its spawner"}`;
    case "profile":
      return `bound ${module.profile ?? holder.profile}'s store`;
    case "run":
      return "bound the run's store";
    case "transferred":
      return "carried from its predecessor";
    case "forked":
      return "received in a fork";
  }
}

// Everything that has happened to the store, oldest first: created, carried to a
// successor, copied or linked into a fork, dropped.
//
// Vertical rather than a horizontal chain, and in the same direction the activity feed
// runs: a lineage strip reads well for four states and badly for twelve events, and this
// list is the one place a family of forked stores can be walked (a `copied` row names the
// store it was copied *from*, so the family is navigable in both directions).
function LifetimeSection({ module }: { module: GgModuleInstance }) {
  if (module.lifetime.length === 0) return null;
  return (
    <section className={panels.moduleStack} aria-label="Lifetime">
      <span className={panels.subPanelLabel}>Lifetime</span>
      <ol className={panels.modLifetime}>
        {module.lifetime.map((event, index) => (
          <li key={index} className={panels.modLifetimeRow}>
            <span className={panels.modLifetimeTime}>
              {formatEventTime(event.timestamp) || "—"}
            </span>
            <span
              className={panels.modLifetimeDot}
              data-lifetime={event.kind}
              aria-hidden="true"
            />
            <span className={panels.modLifetimeText} data-lifetime={event.kind}>
              {moduleLifetimeLabel(event)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// What the store costs the windows it is in, per holder and summed.
//
// It is a *rent*, not a one-off: a module's block in the window is re-sent on every
// request its holder makes, so this is the figure that decides whether a capability is
// earning its keep — and it belongs on the module rather than on any one agent, because
// the answer for a shared store is the sum over its holders, which no per-agent view
// can state.
function CostSection({ module }: { module: GgModuleInstance }) {
  // The archive is out of the window by definition — that is what it is *for* — so it has
  // no rent at all, and a "0 tokens" row would read as "free" rather than "not
  // applicable".
  if (module.kind === "archive") return null;
  const withCost = module.holders.filter((holder) => holder.cost);
  if (withCost.length === 0) return null;
  // Bars scale to the largest peak on show, not to the window: a module's band is a small
  // share of a big window, and scaling to the whole would leave every bar a sliver.
  const scale = withCost.reduce(
    (max, holder) => Math.max(max, holder.cost!.peakTokens),
    0,
  );
  const total = module.totalCost;
  const live = module.liveHolders.length;
  return (
    <section className={panels.moduleStack} aria-label="Cost">
      <span className={panels.subPanelLabel}>Cost</span>
      <ul className={panels.modCostList}>
        {withCost.map((holder) => {
          const cost = holder.cost!;
          return (
            <li key={holder.agentId} className={panels.modCostRow}>
              <span className={panels.modCostWho}>{holder.agentId}</span>
              <span className={panels.modCostBar} aria-hidden="true">
                <span
                  className={panels.modCostBarPeak}
                  style={{
                    width: `${scale > 0 ? (cost.peakTokens / scale) * 100 : 0}%`,
                  }}
                />
                <span
                  className={panels.modCostBarFill}
                  style={{
                    width: `${scale > 0 ? (cost.latestTokens / scale) * 100 : 0}%`,
                  }}
                />
              </span>
              <span className={panels.modCostFigure}>
                {shortTokens(cost.latestTokens)}
                {cost.peakTokens > cost.latestTokens &&
                  ` · peak ${shortTokens(cost.peakTokens)}`}
              </span>
              <span className={panels.modCostShare}>
                {cost.share != null ? formatPercent(cost.share) : "—"}
              </span>
            </li>
          );
        })}
      </ul>
      {total && (
        <p className={panels.moduleCost}>
          <strong>{shortTokens(total.latestTokens)}</strong> tokens every turn
          across{" "}
          {live > 0
            ? `${live} live holder${live === 1 ? "" : "s"}`
            : `${module.holders.length} holder${module.holders.length === 1 ? "" : "s"}`}
          .
        </p>
      )}
    </section>
  );
}
