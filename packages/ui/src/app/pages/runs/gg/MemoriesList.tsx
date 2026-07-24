// The memories half of the Knowledge panel: the notes the model curates for
// itself (see gg/memories.md), each with its description and body length, plus how
// close the set is to gg's caps (count / per-memory / total length). The caps are
// what stop self-curated memory from crowding out the working context, so they are
// surfaced as two small usage meters that warm as the budget fills — the model
// must revise or evict, not simply accrue, once a cap is hit.

import type { GgMemoryState } from "./useGgRunState";
import styles from "./GgPanels.module.scss";

interface MemoriesListProps {
  memory: GgMemoryState | null;
}

const numberFmt = new Intl.NumberFormat("en-US");

// The warm-as-it-fills level for a usage fraction, matching the context-fullness
// bar's thresholds so budget proximity reads consistently across the monitor.
function level(fraction: number): "low" | "mid" | "high" {
  return fraction >= 0.9 ? "high" : fraction >= 0.7 ? "mid" : "low";
}

// One labeled budget meter: a used/cap read-out over a fill bar that warms as it
// approaches the cap.
function CapMeter({
  label,
  used,
  cap,
}: {
  label: string;
  used: number;
  cap: number;
}) {
  const fraction = cap > 0 ? used / cap : 0;
  const pct = Math.round(Math.min(fraction, 1) * 100);
  return (
    <div className={styles.capMeter}>
      <div className={styles.capMeterHead}>
        <span className={styles.capMeterLabel}>{label}</span>
        <span className={styles.capMeterValue}>
          {numberFmt.format(used)} / {numberFmt.format(cap)}
        </span>
      </div>
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

  const { memories, count, totalLen, caps } = memory;

  return (
    <div className={styles.stack}>
      {/* Budget meters: how close the model is to its memory caps. */}
      <div className={styles.capMeters}>
        <CapMeter label="Memories" used={count} cap={caps.maxCount} />
        <CapMeter label="Total length" used={totalLen} cap={caps.maxTotalLen} />
      </div>
      {memories.length === 0 ? (
        <p className={styles.empty}>The model has not written any memories yet.</p>
      ) : (
        <ul className={styles.knowledgeList}>
          {memories.map((mem) => {
            const overLen = mem.len >= caps.maxLenPerMemory;
            return (
              <li key={mem.name} className={styles.knowledgeRow}>
                <div className={styles.knowledgeHead}>
                  <span className={styles.knowledgeName}>{mem.name}</span>
                  <span
                    className={styles.knowledgeBadge}
                    data-over={overLen ? "" : undefined}
                    title="body length / per-memory cap"
                  >
                    {numberFmt.format(mem.len)} /{" "}
                    {numberFmt.format(caps.maxLenPerMemory)}
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
