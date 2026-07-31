// The memories half of the Knowledge panel: everything the model ever wrote to
// memory (see gg/memories), not only what it is holding now.
//
// A snapshot alone under-reports memory badly. A model that curates well spends its
// budget, prunes, and ends with three short notes — and a panel that shows only the
// live set would read that as a run which barely used memory at all. So this shows
// three things at once:
//
//   * the LIVE budget — how close the set is to the limits this run enforces, which
//     differ by strategy (the scratchpad is bounded by a count and an aggregate body
//     budget, a markdown run by the length of its pinned index, and any limit can be
//     turned off, so the meters are built from the limits actually in force);
//   * the TOTALS and PEAKS — characters and lines held now, and the high-water marks
//     the run reached, so a curated-down store still reports what it once cost;
//   * the RECORD — every memory the agent ever held, deleted ones included, each
//     expandable into its revision history.

import type {
  GgMemoryHistory,
  GgMemoryRevision,
  GgMemoryState,
} from "./useGgRunState";
import { MemoryTreemap, type MemoryTile } from "./MemoryTreemap";
import { ModuleStat, ModuleStats } from "./ModuleStats";
import styles from "./GgPanels.module.scss";

interface MemoriesListProps {
  memory: GgMemoryState | null;
}

const numberFmt = new Intl.NumberFormat("en-US");

// How each strategy is labeled in the panel, and what it means for the window.
// An empty strategy is a record written before memories had more than one, which
// was the scratchpad.
const STRATEGY_LABELS: Record<string, string> = {
  "": "Scratchpad",
  scratchpad: "Scratchpad",
  markdown: "Markdown + index",
  "keyword-search": "Keyword search",
};

// How each memory scope is labeled on the panel's badge. An empty scope is a record
// written before scoping existed, when every instance was its holder's own — which is
// exactly what "isolated" means, so it needs no badge of its own and gets none.
const SCOPE_LABELS: Record<string, string> = {
  shared: "Shared with every instance of this agent",
  inherited: "Inherited from this agent's spawner",
  "read-only": "Inherited from this agent's spawner",
};

// What each kind of revision is called in the history.
const CHANGE_LABELS: Record<GgMemoryRevision["change"], string> = {
  written: "written",
  updated: "revised",
  deleted: "deleted",
};

// The warm-as-it-fills level for a usage fraction, matching the context-fullness
// bar's thresholds so budget proximity reads consistently across the monitor.
function level(fraction: number): "low" | "mid" | "high" {
  return fraction >= 0.9 ? "high" : fraction >= 0.7 ? "mid" : "low";
}

// One labeled budget meter: a used/cap read-out over a fill bar that warms as it
// approaches the cap. With no cap there is nothing to approach, so the bar is
// dropped and the figure stands on its own.
function CapMeter({
  label,
  used,
  cap,
}: {
  label: string;
  used: number;
  cap: number | null;
}) {
  const fraction = cap && cap > 0 ? used / cap : 0;
  const pct = Math.round(Math.min(fraction, 1) * 100);
  return (
    <div className={styles.capMeter}>
      <div className={styles.capMeterHead}>
        <span className={styles.capMeterLabel}>{label}</span>
        <span className={styles.capMeterValue}>
          {numberFmt.format(used)}
          {cap ? ` / ${numberFmt.format(cap)}` : ""}
        </span>
      </div>
      {cap ? (
        <div
          className={styles.capMeterBar}
          role="meter"
          aria-label={`${label} usage`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={styles.capMeterFill}
            data-level={level(fraction)}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

// One "now / peak" figure, in the shape every module states its figures in: the live
// number large, its label under it, the peak as the sub-line. The peak is the point of
// the tile — a current figure on its own cannot distinguish a store that was never used
// from one that was used hard and then pruned — so it is stated beside the live number
// rather than tucked away.
function StatTile({
  label,
  now,
  peak,
}: {
  label: string;
  now: number;
  peak: number;
}) {
  return (
    <ModuleStat
      value={numberFmt.format(now)}
      label={label}
      sub={`peak ${numberFmt.format(peak)}`}
    />
  );
}

// One memory's full record: what it is now (or was, if deleted) over its revisions,
// collapsed by default — the history is the answer to "how did it get like this",
// which is a question you ask about one memory at a time.
function MemoryRecord({
  entry,
  perMemoryCap,
}: {
  entry: MemoryRow;
  perMemoryCap: number | null;
}) {
  const overLen = perMemoryCap !== null && entry.len >= perMemoryCap;
  return (
    <li
      className={styles.knowledgeRow}
      data-deleted={entry.live ? undefined : ""}
    >
      <div className={styles.knowledgeHead}>
        <span className={styles.knowledgeName}>
          {entry.name}
          {entry.live ? null : (
            <span className={styles.memoryDeletedTag}>deleted</span>
          )}
          {/* A memory this agent holds but did not write. It has no revision history
              here for the same reason: gg attributes a revision to its author, and the
              author is somebody else. */}
          {entry.byAnother && (
            <span
              className={styles.memoryForeignTag}
              title="Written by another agent holding this same memory instance — its revisions are on that agent's stream."
            >
              another holder
            </span>
          )}
        </span>
        <span
          className={styles.knowledgeBadge}
          data-over={overLen ? "" : undefined}
          title={
            perMemoryCap === null
              ? "body length"
              : "body length / per-memory limit"
          }
        >
          {numberFmt.format(entry.len)}
          {perMemoryCap === null ? "" : ` / ${numberFmt.format(perMemoryCap)}`}
          {` · ${numberFmt.format(entry.lines)}L`}
        </span>
      </div>
      <span className={styles.knowledgeDesc}>{entry.description}</span>
      {entry.revisions.length > 0 && (
        <details className={styles.memoryHistory}>
          <summary className={styles.memoryHistorySummary}>
            {entry.revisions.length === 1
              ? "1 revision"
              : `${entry.revisions.length} revisions`}
          </summary>
          <ol className={styles.memoryRevisions}>
            {entry.revisions.map((rev) => (
              <li key={rev.revision} className={styles.memoryRevision}>
                <div className={styles.memoryRevisionHead}>
                  <span
                    className={styles.memoryRevisionTag}
                    data-change={rev.change}
                  >
                    v{rev.revision} {CHANGE_LABELS[rev.change]}
                  </span>
                  {rev.change !== "deleted" && (
                    <span className={styles.memoryRevisionSize}>
                      {numberFmt.format(rev.len)} chars ·{" "}
                      {numberFmt.format(rev.lines)} lines
                    </span>
                  )}
                </div>
                {rev.description && (
                  <span className={styles.knowledgeDesc}>
                    {rev.description}
                  </span>
                )}
                {rev.body && (
                  <pre className={styles.memoryRevisionBody}>{rev.body}</pre>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

// One memory as the panel lists it: its record, plus whether **this** agent is the one
// that wrote it. On a linked instance the two are not the same question — see [records].
interface MemoryRow extends GgMemoryHistory {
  byAnother: boolean;
}

// Whether an agent holding this instance is holding it with somebody else. `isolated`
// (and the empty scope of a record written before scoping existed) is a private
// notebook, where every memory in the snapshot is necessarily this agent's own.
function linked(scope: string): boolean {
  return scope === "shared" || scope === "inherited" || scope === "read-only";
}

// The records to list: this agent's own revision history, plus — on a **linked**
// instance — every memory in the live snapshot it did not write.
//
// The two sources are different by construction. gg attributes a `memory_revision` to
// the agent that performed the write, so a holder's stream carries the history of its
// own writes and nothing else, while the `memory_state` snapshot is the whole store as
// that holder sees it. On an isolated instance those coincide; on a shared or inherited
// one they do not, and listing only the history would report a store of six notes as
// the two this agent happened to type. So the snapshot fills the rest in, marked as
// another holder's — which is also the honest thing to say, since this agent's stream
// has no revisions for them to show.
//
// The same fallback keeps the panel honest on a run recorded before gg streamed
// revisions at all: nothing is marked, because on an isolated store there is nobody
// else it could be.
function records(memory: GgMemoryState): MemoryRow[] {
  const own = memory.history.map((entry) => ({ ...entry, byAnother: false }));
  const mine = new Set(own.map((entry) => entry.name));
  const others = memory.memories
    .filter((mem) => !mine.has(mem.name))
    .map((mem) => ({
      name: mem.name,
      revisions: [],
      live: true,
      description: mem.description,
      len: mem.len,
      lines: mem.lines,
      byAnother: linked(memory.scope),
    }));
  return [...own, ...others];
}

export function MemoriesList({ memory }: MemoriesListProps) {
  if (!memory) {
    return (
      <p className={styles.empty}>
        No memories yet — the memories capability streams the model's
        self-curated notes here as it writes them.
      </p>
    );
  }

  const { strategy, count, totalLen, totalLines, peak, caps, scope, writable } =
    memory;
  const label = STRATEGY_LABELS[strategy] ?? strategy;
  // The scope badge answers a question a snapshot alone cannot: whether this panel and
  // another agent's are showing ONE store. It is shown only when the answer is
  // interesting — an isolated instance is what memory has always been.
  const scopeLabel = SCOPE_LABELS[scope];
  // The index is a markdown run's binding constraint and the aggregate body length
  // is the scratchpad's; each is shown only where it is the thing that runs out.
  const indexed = caps.maxLenIndex !== null && caps.maxLenIndex !== undefined;
  const all = records(memory);
  const tiles: MemoryTile[] = all.map((entry) => ({
    name: entry.name,
    value: entry.len,
    lines: entry.lines,
    live: entry.live,
    byAnother: entry.byAnother,
  }));
  // Peaks are absent on a record written before gg reported them; the live figure is
  // the honest floor for one, and stating it as the peak is better than showing zero.
  const peakCount = Math.max(peak?.count ?? 0, count);
  const peakLen = Math.max(peak?.totalLen ?? 0, totalLen);
  const peakLines = Math.max(peak?.totalLines ?? 0, totalLines);

  return (
    <div className={styles.stack}>
      {/* How this agent holds the store, when it holds it with anyone else. */}
      {scopeLabel ? (
        <div className={styles.memoryScope}>
          {/* The badge is the scope itself, warmed when this holder may not write —
              "read-only" is a scope AND a restriction, so one chip says both. */}
          <span
            className={styles.memoryScopeBadge}
            data-readonly={writable ? undefined : ""}
          >
            {scope}
          </span>
          <span className={styles.memoryScopeNote}>
            {scopeLabel}
            {writable ? "" : " — this agent may read them, not change them"}
          </span>
        </div>
      ) : null}
      {/* Budget meters: how close the model is to the limits this run enforces. */}
      <div className={styles.capMeters}>
        <CapMeter label={label} used={count} cap={caps.maxCount ?? null} />
        {indexed ? null : (
          <CapMeter
            label="Total length"
            used={totalLen}
            cap={caps.maxTotalLen ?? null}
          />
        )}
      </div>
      {/* What is held now against what was held at the run's high-water mark. */}
      <ModuleStats label="Memories">
        <StatTile label="memories" now={count} peak={peakCount} />
        <StatTile label="characters" now={totalLen} peak={peakLen} />
        <StatTile label="lines" now={totalLines} peak={peakLines} />
      </ModuleStats>
      {all.length === 0 ? (
        <p className={styles.empty}>
          The model has not written any memories yet.
        </p>
      ) : (
        <>
          <MemoryTreemap tiles={tiles} />
          <ul className={styles.knowledgeList}>
            {all.map((entry) => (
              <MemoryRecord
                key={entry.name}
                entry={entry}
                perMemoryCap={caps.maxLenPerMemory ?? null}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
