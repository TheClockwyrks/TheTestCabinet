// The Compaction view: one agent's summarize-and-restart boundaries in detail.
//
// Compaction is gg's context backstop — when the window fills it summarizes the
// ephemeral history and restarts the thread from the summary, carrying the pinned
// state across verbatim (see gg/compaction). This view records each boundary so the
// summarization strategies can be compared: which strategy ran, how much window it
// reclaimed, the per-source composition just before and just after, and the summary
// text the strategy actually produced. It is the detail behind the Context graph's
// compaction markers — the graph shows where the window was dropped, this shows what
// each drop kept.

import type {
  GgContextSource,
  GgContextSourceUsage,
} from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type { CompactionBoundary } from "./useGgRunState";
import { retainedSummary, shortTokens } from "./useGgRunState";
import {
  CONTEXT_SOURCES,
  CONTEXT_SOURCE_COLORS,
  CONTEXT_SOURCE_LABELS,
} from "./ContextFillGraph";

// Friendly labels for the built-in strategies; an unknown id (a study naming a
// not-yet-built strategy, which gg runs as the default) shows verbatim.
const STRATEGY_LABELS: Record<string, string> = {
  "self-summarization": "Self-summarization",
  "self-compaction": "Self-compaction",
  "handoff-summarization": "Handoff summarization",
  "handoff-compaction": "Handoff compaction",
  "memory-compaction": "Memory compaction",
};

function strategyLabel(strategy: string): string {
  return STRATEGY_LABELS[strategy] ?? strategy;
}

// The percent of the pre-compaction window a boundary reclaimed.
function reclaimPct(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 100);
}

function totalTokens(bySource: GgContextSourceUsage[]): number {
  return bySource.reduce((sum, b) => sum + b.tokens, 0);
}

// One horizontal stacked bar of a per-source composition: segments in the fixed
// `CONTEXT_SOURCES` order, colored to match the Context graph, each sized by its
// share of the total. A zero band draws nothing, so the ephemeral bands collapsing
// into the summary reads at a glance between the Before and After bars.
function CompositionBar({
  label,
  bySource,
}: {
  label: string;
  bySource: GgContextSourceUsage[];
}) {
  const total = totalTokens(bySource);
  const tokensOf = (source: GgContextSource) =>
    bySource.find((b) => b.source === source)?.tokens ?? 0;
  return (
    <div className={panels.compBarRow}>
      <span className={panels.compBarLabel}>{label}</span>
      <span
        className={panels.compBar}
        role="img"
        aria-label={`${label}: ${shortTokens(total)} tokens`}
      >
        {total > 0 &&
          CONTEXT_SOURCES.map((source) => {
            const tokens = tokensOf(source);
            if (tokens <= 0) return null;
            return (
              <span
                key={source}
                className={panels.compBarSeg}
                style={{
                  width: `${(tokens / total) * 100}%`,
                  background: CONTEXT_SOURCE_COLORS[source],
                }}
                title={`${CONTEXT_SOURCE_LABELS[source]}: ${shortTokens(tokens)}`}
              />
            );
          })}
      </span>
    </div>
  );
}

// The per-agent Compaction file: one card per boundary, in the order they fired.
export function CompactionView({
  compactions,
}: {
  compactions: CompactionBoundary[];
}) {
  if (compactions.length === 0) {
    return (
      <p className={panels.empty}>
        No compactions yet. When the window nears its limit, gg summarizes the
        thread and restarts it from the summary. Each boundary is recorded here.
      </p>
    );
  }
  return (
    <ul className={panels.compactionList}>
      {compactions.map((c) => (
        <li key={c.key} className={panels.compactionCard}>
          <div className={panels.compactionHead}>
            <span className={panels.compactionTurn}>Turn {c.turn}</span>
            <span className={panels.strategyBadge}>
              {strategyLabel(c.strategy)}
            </span>
            <span className={panels.compactionTrigger}>
              triggered at {Math.round(c.triggerFullness * 100)}% full
            </span>
          </div>

          <div className={panels.compactionReclaim}>
            {shortTokens(c.beforeTokens)} → {shortTokens(c.afterTokens)} tokens{" "}
            <span className={panels.compactionReclaimPct}>
              (reclaimed {reclaimPct(c.beforeTokens, c.afterTokens)}%)
            </span>
          </div>
          <div className={panels.compactionRetained}>
            retained {retainedSummary(c.retained)}
          </div>

          <div className={panels.compBars}>
            <CompositionBar label="Before" bySource={c.beforeBySource} />
            <CompositionBar label="After" bySource={c.afterBySource} />
          </div>

          <span className={panels.summaryLabel}>Summary</span>
          {c.summaryFallback && (
            <span className={panels.summaryFallback}>
              Summarization failed, so the summary degraded to gg&rsquo;s
              fallback note.
            </span>
          )}
          <p className={panels.summaryText}>{c.summary}</p>
        </li>
      ))}
    </ul>
  );
}
