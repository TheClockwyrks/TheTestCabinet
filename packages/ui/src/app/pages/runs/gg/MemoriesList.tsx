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

// One "now / peak" figure. The peak is the point of the tile — a current figure on
// its own cannot distinguish a store that was never used from one that was used hard
// and then pruned — so it is stated beside the live number rather than tucked away.
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
    <div className={styles.memoryStat}>
      <span className={styles.memoryStatLabel}>{label}</span>
      <span className={styles.memoryStatValue}>{numberFmt.format(now)}</span>
      <span className={styles.memoryStatPeak}>
        peak {numberFmt.format(peak)}
      </span>
    </div>
  );
}

// One memory's full record: what it is now (or was, if deleted) over its revisions,
// collapsed by default — the history is the answer to "how did it get like this",
// which is a question you ask about one memory at a time.
function MemoryRecord({
  entry,
  perMemoryCap,
}: {
  entry: GgMemoryHistory;
  perMemoryCap: number | null;
}) {
  const overLen = perMemoryCap !== null && entry.len >= perMemoryCap;
  return (
    <li className={styles.knowledgeRow} data-deleted={entry.live ? undefined : ""}>
      <div className={styles.knowledgeHead}>
        <span className={styles.knowledgeName}>
          {entry.name}
          {entry.live ? null : (
            <span className={styles.memoryDeletedTag}>deleted</span>
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
                  <span className={styles.memoryRevisionTag} data-change={rev.change}>
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
                  <span className={styles.knowledgeDesc}>{rev.description}</span>
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

// The records to list: the revision history when gg reported one, and otherwise the
// live snapshot lifted into the same shape. The fallback is what keeps this panel
// honest on a run recorded before gg streamed revisions — such a run has no history
// to show, but its live memories are still worth listing.
function records(memory: GgMemoryState): GgMemoryHistory[] {
  if (memory.history.length > 0) return memory.history;
  return memory.memories.map((mem) => ({
    name: mem.name,
    revisions: [],
    live: true,
    description: mem.description,
    len: mem.len,
    lines: mem.lines,
  }));
}

export function MemoriesList({ memory }: MemoriesListProps) {
  if (!memory) {
    return (
      <p className={styles.empty}>
        No memories yet — the memories capability streams the model's self-curated
        notes here as it writes them.
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
      <div className={styles.memoryStats}>
        <StatTile label="Memories" now={count} peak={peakCount} />
        <StatTile label="Characters" now={totalLen} peak={peakLen} />
        <StatTile label="Lines" now={totalLines} peak={peakLines} />
      </div>
      {all.length === 0 ? (
        <p className={styles.empty}>The model has not written any memories yet.</p>
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
