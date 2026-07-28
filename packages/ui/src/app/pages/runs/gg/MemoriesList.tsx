// The memories half of the Knowledge panel: the notes the model curates for
// itself (see gg/memories.md), each with its description and body length, plus how
// close the set is to gg's limits. Which limits exist depends on the run's memory
// strategy — the scratchpad is bounded by a count and an aggregate body budget, a
// markdown run by the length of its pinned index, and any of them can be turned off
// — so the meters are built from the limits the run actually enforces rather than
// from a fixed pair. A limit that is off is stated as a plain count, not as a meter
// against a cap that does not exist.

import type { GgMemoryState } from "./useGgRunState";
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

export function MemoriesList({ memory }: MemoriesListProps) {
  if (!memory) {
    return (
      <p className={styles.empty}>
        No memories yet — the memories capability streams the model's self-curated
        notes here as it writes them.
      </p>
    );
  }

  const { strategy, memories, count, totalLen, caps } = memory;
  const label = STRATEGY_LABELS[strategy] ?? strategy;
  // The index is a markdown run's binding constraint and the aggregate body length
  // is the scratchpad's; each is shown only where it is the thing that runs out.
  const indexed = caps.maxLenIndex !== null && caps.maxLenIndex !== undefined;

  return (
    <div className={styles.stack}>
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
      {memories.length === 0 ? (
        <p className={styles.empty}>The model has not written any memories yet.</p>
      ) : (
        <ul className={styles.knowledgeList}>
          {memories.map((mem) => {
            const perMemory = caps.maxLenPerMemory ?? null;
            const overLen = perMemory !== null && mem.len >= perMemory;
            return (
              <li key={mem.name} className={styles.knowledgeRow}>
                <div className={styles.knowledgeHead}>
                  <span className={styles.knowledgeName}>{mem.name}</span>
                  <span
                    className={styles.knowledgeBadge}
                    data-over={overLen ? "" : undefined}
                    title={
                      perMemory === null
                        ? "body length"
                        : "body length / per-memory limit"
                    }
                  >
                    {numberFmt.format(mem.len)}
                    {perMemory === null
                      ? ""
                      : ` / ${numberFmt.format(perMemory)}`}
                  </span>
                </div>
                <span className={styles.knowledgeDesc}>{mem.description}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
