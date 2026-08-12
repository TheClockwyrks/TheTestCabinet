import type { GgBoardIssue } from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type { DerivedGgState, PooledMessage } from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import type {
  GgModuleHolder,
  GgModuleInstance,
  GgModuleLifetimeEvent,
} from "./ggModules";
import {
  coHolders,
  concurrentHolders,
  isCarried,
  isShared,
  moduleKindLabel,
  moduleOriginLabel,
  moduleScopeLabel,
} from "./ggModules";
import { MODULE_ICONS } from "./ggAgentEntries";
import { ISSUE_STATES, ISSUE_STATE_LABELS, issueState } from "./IssueViews";
import { CONTEXT_SOURCE_LABELS } from "./ContextFillGraph";
import { MemoriesList } from "./MemoriesList";
import { ModuleStat, ModuleStats } from "./ModuleStats";
import { RequestsView } from "./RequestsView";
import { SkillsList } from "./SkillsList";
import { TaskDagView } from "./TaskDagView";
import { useGgExplorerNav } from "./GgExplorerNav";
import { LinkIcon } from "./ggIcons";

// The read-out of ONE module instance: who holds it, how they came by it, what has
// happened to it, what it costs them, and what is in it.
//
// It lives on its own rather than inside the Instances explorer because a module
// instance is not a per-agent thing any more (see gg/modules). The same store can be
// read from three directions — an agent's `modules/` folder, the Modules tab's detail
// pane, and an agent profile's row on the Agents tab — and all three have to answer the
// same questions the same way, in the same words. A module described as "shared by 4
// holders" on one surface and as "scope: shared" on another is two different facts as
// far as a reader is concerned.
//
// What is deliberately NOT here: the derivations. Everything shown is read off a
// {@link GgModuleInstance}, which `ggModules` folds once from the run's rosters,
// transitions and per-module snapshots — so no surface computes sharing, lifetime or
// cost for itself, and no two surfaces can disagree about them.

// --- The header strip --------------------------------------------------------

/**
 * The identity strip every module view leads with: which store this is, whose it is,
 * how this holder came by it, what has happened to it, what it costs, and who else is
 * holding it.
 *
 * `holder` is the holder being read *from* — the agent whose folder this file sits in.
 * It is optional because the Modules tab reads a module from no agent in particular, and
 * where it is absent the strip states the holders' collective position (three of four
 * holders own it) rather than any one holder's.
 */
export function GgModuleHeader({
  module,
  holder,
  detail = "full",
  onOpenHolder,
  onOpenModule,
}: {
  module: GgModuleInstance;
  /** The holder this module is being read from; null when it is read on its own. */
  holder?: GgModuleHolder | null;
  /**
   * How much of the store's context the strip carries itself.
   *
   * `full` (the default) ends it with the store's lifetime, what it costs, and its other
   * holders as chips — which is what a surface reading the store from *inside* one holder
   * needs, since nothing else on that page says who else is in it or how it got there.
   * `identity` stops after the identity and the origin line, for a surface that follows
   * the strip with sections of its own (the Modules tab's Holders, Lifetime and Cost),
   * where carrying them here would state the same facts twice in two densities.
   */
  detail?: "full" | "identity";
  /**
   * Open a co-holder — the same module instance, read from another agent instance.
   * Omitted where there is nowhere to go (no explorer mounted), in which case the
   * co-holders read as plain text rather than as dead buttons.
   */
  onOpenHolder?: (agentId: string) => void;
  /**
   * Open the store on the Modules tab, where it is read as a store rather than as one
   * agent's hold on it — its whole holder set, its lifetime and what it costs the run.
   * Omitted by the Modules tab itself, which is already there.
   */
  onOpenModule?: () => void;
}) {
  const Icon = MODULE_ICONS[module.kind];
  // Shared means held AT ONCE. A store handed to a successor collects holders exactly the
  // way a shared one does, and badging that "2 holders 🔗" is the single most misleading
  // thing this strip could say — so a hand-off gets its own badge instead.
  const shared = isShared(module);
  const carried = isCarried(module);
  const others = holder ? coHolders(module, holder.agentId) : module.holders;
  return (
    <section className={panels.moduleHead} aria-label="Module">
      {/* The identity line: what this store is, and the two things about it that
          change how everything below it reads — whether the holder's prompt carries
          it, and how many agents are in it. */}
      <div className={panels.moduleIdentity}>
        <Icon className={panels.moduleIcon} />
        <span className={panels.moduleId}>{module.id}</span>
        <span className={panels.moduleKind}>
          {moduleKindLabel(module.kind)}
        </span>
        <span
          className={panels.moduleBadge}
          data-ownership={ownership(module, holder)}
        >
          {ownershipLabel(module, holder)}
        </span>
        {shared && (
          <span
            className={panels.moduleBadge}
            data-shared=""
            title={`held at once by ${concurrentHolders(module)
              .map((other) => other.agentId)
              .join(", ")}`}
          >
            <LinkIcon className={panels.moduleBadgeIcon} />
            {concurrentHolders(module).length} holders
          </span>
        )}
        {carried && (
          <span
            className={panels.moduleBadge}
            data-carried=""
            title={`passed through ${module.holders
              .map((other) => other.agentId)
              .join(" → ")} — only ever one of them held it`}
          >
            handed on
          </span>
        )}
        {module.dropped && (
          <span className={panels.moduleBadge} data-dropped="">
            dropped
          </span>
        )}
      </div>

      {/* How this holder stands to it: how it came by it, whether it may write it, and
          — where it declared a scope — what it asked for. The declared scope is worth
          stating beside the observed sharing because they are routinely different in
          legal ways (an `inherited` agent with no spawner quietly gets its own store).
          What it costs rides at the row's far edge rather than under it: the two are a
          fact and its price, and stacking them left-aligned left the pane's whole right
          half empty while the reader scanned two lines for what fits on one. */}
      <div className={panels.moduleFacts}>
        <p className={panels.moduleLine}>
          {holder ? (
            <>
              {capitalize(moduleOriginLabel(module, holder))}
              {" · "}
              {holder.writable ? "read/write" : "read-only"}
              {holder.scope ? ` · declared ${holder.scope}` : ""}
              {" · "}
            </>
          ) : null}
          {moduleScopeLabel(module)}
        </p>
        {detail === "full" && <ModuleCost module={module} holder={holder} />}
      </div>

      {/* The one capability setting whose effect is otherwise invisible everywhere: an
          unowned module is held, read and written exactly as any other — it just never
          reaches the model's window. Said as a sentence, because a badge alone has never
          told anybody what it means. */}
      {ownership(module, holder) === "unowned" && (
        <p className={panels.moduleNote}>
          Unowned — this agent holds it, but its prompt does not carry it: the
          tools are offered and nothing is put in the window.
        </p>
      )}

      {/* The store's life on the left, everyone in it on the right — the same pairing
          the line above uses, for the same reason: they are one row's worth of facts. */}
      {detail === "full" &&
        (module.lifetime.length > 0 || others.length > 0) && (
          <div className={panels.moduleFacts}>
            <ModuleLifetime module={module} />
            {others.length > 0 && (
              <div className={panels.moduleHolders}>
                <span className={panels.moduleHoldersLabel}>
                  {carried
                    ? holder
                      ? "Also passed through"
                      : "Passed through"
                    : holder
                      ? "Also held by"
                      : "Held by"}
                </span>
                {others.map((other) => (
                  <HolderChip
                    key={other.agentId}
                    module={module}
                    holder={other}
                    onOpen={onOpenHolder}
                  />
                ))}
                {holder && (
                  <span className={panels.moduleHolderSelf}>this instance</span>
                )}
              </div>
            )}
          </div>
        )}

      {/* The way out to the store itself. Everything above is this holder's view of it;
          the Modules tab is where the same store is read as a store — every holder it
          ever had, its whole lifetime, and what it costs the run rather than this
          window. */}
      {onOpenModule && (
        <div className={panels.moduleLinks}>
          <button
            type="button"
            className={panels.projAgentLink}
            onClick={onOpenModule}
          >
            Open in Modules
          </button>
        </div>
      )}
    </section>
  );
}

// One co-holder, as a chip that opens the same module instance read from that agent.
// Its title carries how *that* agent came by the store, which is the question a shared
// module raises the moment you see there is more than one holder.
function HolderChip({
  module,
  holder,
  onOpen,
}: {
  module: GgModuleInstance;
  holder: GgModuleHolder;
  onOpen?: (agentId: string) => void;
}) {
  const title = `${holder.agentId} (${holder.profile}) — ${moduleOriginLabel(
    module,
    holder,
  )}, ${holder.writable ? "read/write" : "read-only"}`;
  const body = (
    <>
      <span
        className={panels.moduleHolderDot}
        data-status={holder.status}
        aria-hidden="true"
      />
      {holder.agentId}
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className={panels.moduleHolderChip}
      title={title}
      onClick={() => onOpen(holder.agentId)}
    >
      {body}
    </button>
  ) : (
    <span className={panels.moduleHolderChip} title={title}>
      {body}
    </span>
  );
}

/**
 * One event in a module instance's life, in words — who did what to it, and by which
 * succession.
 *
 * Exported so the Modules tab's vertical lifetime list and the header strip's one-line
 * summary say it identically: they are the same fact at two densities, and two spellings
 * of "linked into agent-4 by fork" would read as two different events.
 */
export function moduleLifetimeLabel(event: GgModuleLifetimeEvent): string {
  switch (event.kind) {
    case "created":
      return `created by ${event.toAgentId ?? "the run"}`;
    case "carried":
      return `carried to ${event.toAgentId} by ${event.via ?? "a succession"}`;
    case "copied":
      return (
        `copied into ${event.toAgentId} by ${event.via ?? "a fork"}` +
        (event.copiedFromModuleId ? ` from ${event.copiedFromModuleId}` : "")
      );
    case "linked":
      return `linked into ${event.toAgentId} by ${event.via ?? "a fork"}`;
    case "dropped":
      return `dropped by ${event.fromAgentId} on ${event.via ?? "hand-off"}`;
  }
}

/**
 * What a module instance holds, in one phrase — "3 memories · 1.2k chars", "5 tasks, 2
 * done".
 *
 * It is what lets a *list* of module instances be compared without opening any of them,
 * which is the Modules tab's whole job: a capability whose four stores hold nothing is
 * being paid for and not used, and that is only visible side by side.
 *
 * Null means "nothing to summarize", which is TWO different things and a caller must tell
 * them apart with {@link moduleReportsContents}: a store that was never written to (the
 * finding) and a window, which reports no contents at all because it *is* the request. A
 * caller that conflates them reports every window in every run as unused, which is the exact
 * opposite of the truth about the fullest thing an agent holds.
 */
export function moduleContentSummary(module: GgModuleInstance): string | null {
  const content = module.content;
  if (!content) return null;
  switch (content.kind) {
    case "memories": {
      const { count, totalLen } = content.memory;
      return `${count} memor${count === 1 ? "y" : "ies"} · ${shortTokens(totalLen)} chars`;
    }
    case "tasks": {
      const done = content.tasks.filter(
        (task) => task.status === "done",
      ).length;
      return `${content.tasks.length} task${content.tasks.length === 1 ? "" : "s"}, ${done} done`;
    }
    case "board": {
      const { epics, issues } = content.board;
      return `${epics.length} epic${epics.length === 1 ? "" : "s"} · ${issues.length} issue${issues.length === 1 ? "" : "s"}`;
    }
    case "skills": {
      const read = content.skills.filter((skill) => skill.read).length;
      return `${content.skills.length} skill${content.skills.length === 1 ? "" : "s"}, ${read} read`;
    }
    case "archive": {
      const { count, totalLen } = content.archive;
      return `${count} entr${count === 1 ? "y" : "ies"} · ${shortTokens(totalLen)} chars`;
    }
  }
}

// A module instance's life as one line, oldest first: where it came from and every
// hand-over since. Without it a shared store is a set of agent ids with nothing between
// them — which of them made it, which was handed it, and which merely got a link are
// exactly the differences the ids alone cannot show.
function ModuleLifetime({ module }: { module: GgModuleInstance }) {
  if (module.lifetime.length === 0) return null;
  return (
    <p className={panels.moduleLifetime}>
      {module.lifetime.map((event, index) => (
        <span key={index}>
          {index > 0 && <span className={panels.moduleSep}> · </span>}
          <span data-lifetime={event.kind}>{moduleLifetimeLabel(event)}</span>
        </span>
      ))}
    </p>
  );
}

// What the module's band costs the windows it is in, per turn.
//
// It is a rent, not a one-off: an owned module's block is re-sent on every request its
// holder makes, so a shared store that three running agents each carry is being paid for
// three times a turn. That is the figure that decides whether a capability is earning its
// keep, and it is the reason the summed cost is stated beside the holder's own.
function ModuleCost({
  module,
  holder,
}: {
  module: GgModuleInstance;
  holder?: GgModuleHolder | null;
}) {
  // The archive is out of the window by definition, so it has no band and no rent —
  // saying "0 tokens" would read as "free" rather than as "not applicable".
  if (module.kind === "archive") return null;
  const mine = holder?.cost ?? null;
  const total = module.totalCost;
  const live = module.liveHolders.length;
  // The summed figure means something only where several windows carry the store at the
  // same time. A store handed on is paid for once, by whoever holds it now.
  const summable = isShared(module);
  if (!mine && !(total && summable)) return null;
  return (
    // The rent is stated as a bare figure and explained on hover: "in this window every
    // turn" is the *definition* of the number, and a definition re-read on every module
    // file of every agent is a sentence nobody reads twice.
    <p
      className={panels.moduleCost}
      title="What this store costs the windows carrying it every turn — an owned module's block is re-sent on every request its holder makes."
    >
      {mine && (
        <>
          <strong>{shortTokens(mine.latestTokens)}</strong> tokens
          {mine.peakTokens > mine.latestTokens &&
            ` (peak ${shortTokens(mine.peakTokens)})`}
        </>
      )}
      {mine && total && summable && (
        <span className={panels.moduleSep}> · </span>
      )}
      {total && summable && (
        <>
          <strong>{shortTokens(total.latestTokens)}</strong> across{" "}
          {live > 0
            ? `${live} live holder${live === 1 ? "" : "s"}`
            : `${module.holders.length} holders`}
        </>
      )}
    </p>
  );
}

// --- Contents ----------------------------------------------------------------

/**
 * What one module instance *holds*, rendered in the shape that kind is read in.
 *
 * The contents come from the module's own latest snapshot rather than from any one
 * holder's slice of the stream: a shared store has one content, and drawing it once
 * under the module — instead of N times under N agents — is the whole point of module
 * identity. `state` is the holder's own reduction, used only for the things that really
 * are per holder (how many compactions this agent survived, what it reclaimed).
 */
export function ModuleContents({
  module,
  holder,
  state,
  live = false,
}: {
  module: GgModuleInstance;
  holder?: GgModuleHolder | null;
  /** The holding agent's own reduced slice; null when the module is read on its own. */
  state?: DerivedGgState | null;
  /**
   * Whether the run is still streaming — only the window's message log cares, and only
   * for what it says while it is empty ("waiting" rather than "none were recorded").
   */
  live?: boolean;
}) {
  const content = module.content;
  const compactions = state?.compactions.length ?? 0;
  switch (module.kind) {
    case "history":
      return <HistoryContents state={state ?? null} live={live} />;
    case "memories": {
      // The store's contents, but this holder's terms: the snapshot carries the scope
      // and write access of whichever agent last emitted it, which for a shared store is
      // not necessarily the one being read. The roster is authoritative per holder.
      const memory =
        content?.kind === "memories"
          ? holder
            ? {
                ...content.memory,
                scope: holder.scope ?? content.memory.scope,
                writable: holder.writable,
              }
            : content.memory
          : null;
      return (
        <>
          <RetainedNote count={compactions} what="memories" />
          <MemoriesList memory={memory} />
        </>
      );
    }
    case "tasks":
      return (
        <>
          <RetainedNote count={compactions} what="task list" />
          <TaskDagView tasks={content?.kind === "tasks" ? content.tasks : []} />
        </>
      );
    case "skills":
      return (
        <>
          <RetainedNote count={compactions} what="skills" />
          <SkillsList
            skills={content?.kind === "skills" ? content.skills : []}
          />
        </>
      );
    case "board":
      return (
        <BoardContents
          issues={content?.kind === "board" ? content.board.issues : []}
        />
      );
    case "archive":
      return (
        <ArchiveContents
          entries={content?.kind === "archive" ? content.archive.entries : []}
          totalLen={content?.kind === "archive" ? content.archive.totalLen : 0}
          state={state ?? null}
        />
      );
  }
}

// A window with no holder's stream behind it (the Agents tab reads a store from no
// instance in particular) has no message log to resolve pointers against — a stable
// empty map rather than a fresh one per render, which would re-render the log for
// nothing on every parent update.
const NO_MESSAGES = new Map<string, PooledMessage>();

// The `history` module: how much of the run this window has seen, and the messages
// that are in it.
//
// The messages ARE the contents of a window — a module file that showed everything
// about the store except what it holds was the one kind that answered its own question
// with a link elsewhere. It is the Requests file's own view, fed this holder's stream,
// so a window reads the same wherever it is opened from.
function HistoryContents({
  state,
  live,
}: {
  state: DerivedGgState | null;
  live: boolean;
}) {
  const prompts = state?.prompts ?? [];
  const compactions = state?.compactions ?? [];
  // What the summarizing bought back, summed across the boundaries — the figure that
  // says whether compaction is doing anything, which a bare count cannot.
  const reclaimed = compactions.reduce(
    (sum, boundary) =>
      sum + Math.max(0, boundary.beforeTokens - boundary.afterTokens),
    0,
  );
  const latest = prompts[prompts.length - 1] ?? null;
  return (
    <div className={panels.moduleStack}>
      <ModuleStats label="Window">
        <ModuleStat value={String(state?.turnCount ?? 0)} label="turns" />
        <ModuleStat
          value={String(compactions.length)}
          label="compactions"
          sub={
            compactions.length > 0
              ? `~${shortTokens(reclaimed)} reclaimed`
              : undefined
          }
        />
        <ModuleStat
          value={latest ? String(latest.request.length) : "—"}
          label="messages"
          sub={latest ? "in the latest request" : undefined}
        />
      </ModuleStats>
      <section className={panels.moduleStack} aria-label="Messages">
        <span className={panels.subPanelLabel}>Messages</span>
        <RequestsView
          prompts={prompts}
          pool={state?.messagePool ?? NO_MESSAGES}
          live={live}
        />
      </section>
    </div>
  );
}

// The `board` module, per holder: the run's decomposition tallied by state, and a way
// through to the board itself. Deliberately not a second board — the Project tab *is*
// the board, and two renderings of one run-global thing is exactly the duplication
// module identity exists to stop. What this view adds is the thing the Project tab
// cannot say: that *this* agent holds a handle on it, and on what terms.
function BoardContents({ issues }: { issues: GgBoardIssue[] }) {
  const nav = useGgExplorerNav();
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const state = issueState(issue, byId);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return (
    <div className={panels.moduleStack}>
      {issues.length === 0 ? (
        <p className={panels.empty}>
          Nothing on the board yet — issues appear here as the model decomposes
          the work.
        </p>
      ) : (
        <div className={panels.projStatusSummary}>
          {ISSUE_STATES.map((state) =>
            (counts.get(state) ?? 0) > 0 ? (
              <span
                key={state}
                className={panels.statusBadge}
                data-issue-state={state}
              >
                {counts.get(state)} {ISSUE_STATE_LABELS[state]}
              </span>
            ) : null,
          )}
        </div>
      )}
      {nav && (
        <div className={panels.moduleLinks}>
          <button
            type="button"
            className={panels.projAgentLink}
            onClick={() => nav.openProject()}
          >
            Open the board
          </button>
        </div>
      )}
    </div>
  );
}

// The `archive` module: what this agent put out of its window, and what that bought it.
// Entries carry metadata and a bounded preview, never the archived text — the archive
// exists precisely so that material is out of the request, and a second copy of the
// thread in the record would serve nobody (see gg/agent-managed-context).
function ArchiveContents({
  entries,
  totalLen,
  state,
}: {
  entries: ReadonlyArray<{
    seq: number;
    source: string;
    role: string;
    len: number;
    preview: string;
  }>;
  totalLen: number;
  state: DerivedGgState | null;
}) {
  // What the archiving actually reclaimed, from this holder's own stream — the archive
  // has no context band of its own, so this is the only cost figure it has.
  const archived = (state?.contextActions ?? []).filter(
    (action) => action.action === "archive_thread",
  );
  const reclaimed = archived.reduce(
    (sum, action) => sum + action.reclaimedTokens,
    0,
  );
  if (entries.length === 0) {
    return (
      <p className={panels.empty}>
        Nothing archived — the agent has not moved any of its thread out of the
        window yet.
      </p>
    );
  }
  return (
    <div className={panels.moduleStack}>
      {/* What left the window, and what leaving bought — the same figures the caption
          used to run together in a sentence, read as a row of numbers instead. */}
      <ModuleStats label="Archive">
        <ModuleStat value={String(entries.length)} label="entries" />
        <ModuleStat
          value={shortTokens(totalLen)}
          label="characters"
          sub="out of the window"
        />
        <ModuleStat
          value={archived.length > 0 ? `~${shortTokens(reclaimed)}` : "—"}
          label="reclaimed"
          sub={
            archived.length > 0
              ? `across ${archived.length} archive${archived.length === 1 ? "" : "s"}`
              : "not measured"
          }
        />
      </ModuleStats>
      <ul className={panels.archiveList}>
        {entries.map((entry) => (
          <li key={entry.seq} className={panels.archiveRow}>
            <span className={panels.archiveSeq}>#{entry.seq}</span>
            <span className={panels.archiveTags}>
              <span className={panels.moduleBadge}>{entry.role}</span>
              <span className={panels.moduleBadge}>
                {CONTEXT_SOURCE_LABELS[
                  entry.source as keyof typeof CONTEXT_SOURCE_LABELS
                ] ?? entry.source}
              </span>
            </span>
            <span className={panels.archivePreview}>{entry.preview}</span>
            <span className={panels.archiveLen}>
              {shortTokens(entry.len)} ch
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A reassurance line shown on a module file once its holder has crossed a compaction
 * boundary: the retention contract kept this state verbatim, so it never blanked out
 * when the window was summarized. Renders nothing before any compaction.
 */
export function RetainedNote({ count, what }: { count: number; what: string }) {
  if (count === 0) return null;
  return (
    <p className={panels.retainedNote}>
      Retained verbatim across {count} compaction{count === 1 ? "" : "s"} — the{" "}
      {what} carried over.
    </p>
  );
}

// --- Ownership, read across holders ------------------------------------------

// Whether the module reaches the model's window: this holder's answer where there is
// one, and the holders' majority answer where there is not. Holders CAN disagree — a
// module transferred into a profile that configures it differently is held owned by one
// instance and unowned by the next — and that disagreement is itself a finding, so it is
// stated rather than averaged away (see `ownershipLabel`).
function ownership(
  module: GgModuleInstance,
  holder?: GgModuleHolder | null,
): "owned" | "unowned" {
  if (holder) return holder.ownership === "unowned" ? "unowned" : "owned";
  const owned = module.holders.filter((h) => h.ownership === "owned").length;
  return owned >= module.holders.length - owned ? "owned" : "unowned";
}

function ownershipLabel(
  module: GgModuleInstance,
  holder?: GgModuleHolder | null,
): string {
  if (holder) return holder.ownership;
  const owned = module.holders.filter((h) => h.ownership === "owned").length;
  if (owned === module.holders.length) return "owned";
  if (owned === 0) return "unowned";
  return `owned by ${owned} of ${module.holders.length}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
