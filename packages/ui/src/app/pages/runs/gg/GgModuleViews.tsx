import type { GgBoardIssue } from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type { DerivedGgState } from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import type { GgModuleHolder, GgModuleInstance } from "./ggModules";
import {
  coHolders,
  isShared,
  moduleKindLabel,
  moduleOriginLabel,
  moduleScopeLabel,
} from "./ggModules";
import { MODULE_ICONS, type AgentFileKind } from "./ggAgentEntries";
import { ISSUE_STATES, ISSUE_STATE_LABELS, issueState } from "./IssueViews";
import { CONTEXT_SOURCE_LABELS } from "./ContextFillGraph";
import { MemoriesList } from "./MemoriesList";
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
  onOpenHolder,
}: {
  module: GgModuleInstance;
  /** The holder this module is being read from; null when it is read on its own. */
  holder?: GgModuleHolder | null;
  /**
   * Open a co-holder — the same module instance, read from another agent instance.
   * Omitted where there is nowhere to go (no explorer mounted), in which case the
   * co-holders read as plain text rather than as dead buttons.
   */
  onOpenHolder?: (agentId: string) => void;
}) {
  const Icon = MODULE_ICONS[module.kind];
  const shared = isShared(module);
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
          <span className={panels.moduleBadge} data-shared="">
            <LinkIcon className={panels.moduleBadgeIcon} />
            {module.holders.length} holders
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
          legal ways (an `inherited` agent with no spawner quietly gets its own store). */}
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

      <ModuleLifetime module={module} />
      <ModuleCost module={module} holder={holder} />

      {others.length > 0 && (
        <div className={panels.moduleHolders}>
          <span className={panels.moduleHoldersLabel}>
            {holder ? "Also held by" : "Held by"}
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
          <span data-lifetime={event.kind}>
            {event.kind === "created" &&
              `created by ${event.toAgentId ?? "the run"}`}
            {event.kind === "carried" &&
              `carried to ${event.toAgentId} by ${event.via ?? "a succession"}`}
            {event.kind === "copied" &&
              `copied into ${event.toAgentId} by ${event.via ?? "a fork"}` +
                (event.copiedFromModuleId
                  ? ` from ${event.copiedFromModuleId}`
                  : "")}
            {event.kind === "linked" &&
              `linked into ${event.toAgentId} by ${event.via ?? "a fork"}`}
            {event.kind === "dropped" &&
              `dropped by ${event.fromAgentId} on ${event.via ?? "hand-off"}`}
          </span>
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
  if (!mine && !total) return null;
  const live = module.liveHolders.length;
  return (
    <p className={panels.moduleCost}>
      {mine && (
        <>
          <strong>{shortTokens(mine.latestTokens)}</strong> tokens in this
          window every turn
          {mine.peakTokens > mine.latestTokens &&
            ` (peak ${shortTokens(mine.peakTokens)})`}
        </>
      )}
      {mine && total && module.holders.length > 1 && (
        <span className={panels.moduleSep}> · </span>
      )}
      {total && module.holders.length > 1 && (
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
  onOpenFile,
}: {
  module: GgModuleInstance;
  holder?: GgModuleHolder | null;
  /** The holding agent's own reduced slice; null when the module is read on its own. */
  state?: DerivedGgState | null;
  /** Open one of the holding agent's own files, where the content points at one. */
  onOpenFile?: (file: AgentFileKind) => void;
}) {
  const content = module.content;
  const compactions = state?.compactions.length ?? 0;
  switch (module.kind) {
    case "history":
      return <HistoryContents state={state ?? null} onOpenFile={onOpenFile} />;
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

// The `history` module: which window this is and where it came from — not how full it
// is. Fullness, composition and the messages themselves are per-turn facts about the
// agent, and they already have two files of their own beside this one; repeating the
// stacked graph here would be a second, staler copy of the surface that answers it.
function HistoryContents({
  state,
  onOpenFile,
}: {
  state: DerivedGgState | null;
  onOpenFile?: (file: AgentFileKind) => void;
}) {
  return (
    <div className={panels.moduleStack}>
      <p className={panels.caption}>
        The agent's conversation window — every message, file view and pinned
        block it opens each request with. A window is never shared: the turn
        loop holds it exclusively, so an agent handed one holds it alone, and a
        fork gets a copy that diverges from the moment it was made.
      </p>
      {/* How much of the run this window has seen. What is *in* it — how full, filled
          by what, and the messages themselves — is the two files below, and the header
          strip above already carries the window's size and its peak. */}
      <dl className={panels.projMeta}>
        <MetaRow label="Turns" value={String(state?.turnCount ?? 0)} />
        <MetaRow
          label="Compactions"
          value={String(state?.compactions.length ?? 0)}
        />
      </dl>
      {onOpenFile && (
        <div className={panels.moduleLinks}>
          <button
            type="button"
            className={panels.projAgentLink}
            onClick={() => onOpenFile("context")}
          >
            What filled it
          </button>
          <button
            type="button"
            className={panels.projAgentLink}
            onClick={() => onOpenFile("requests")}
          >
            The messages in it
          </button>
        </div>
      )}
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
      <p className={panels.caption}>
        The run's single epic/issue board. Every holder holds the same one — two
        boards would each mint their own `ABC-4` — so what this agent has is a
        handle on it, not a copy of it.
      </p>
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
      <p className={panels.caption}>
        {entries.length} entr{entries.length === 1 ? "y" : "ies"} ·{" "}
        {shortTokens(totalLen)} characters out of the window
        {archived.length > 0 &&
          ` · ~${shortTokens(reclaimed)} tokens reclaimed across ${
            archived.length
          } archive${archived.length === 1 ? "" : "s"}`}
      </p>
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

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={panels.projMetaRow}>
      <dt className={panels.projMetaLabel}>{label}</dt>
      <dd className={panels.projMetaValue}>{value}</dd>
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
