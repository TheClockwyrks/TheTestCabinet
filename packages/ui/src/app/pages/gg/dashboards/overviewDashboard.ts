// The **built-in overview board** — the eight questions a gg corpus is opened to answer.
//
// It is an ordinary `GgDashboard` value, defined as **ordinary TCQ source text**, run
// through exactly the machinery a user's board runs through: the same compiler, the same
// range application, the same single batched request, the same visualization chooser.
// That is the whole point of defining it here rather than as a hardcoded breakdown. A
// hardcoded overview drifts silently the moment a field is renamed or a summary number
// moves — it keeps rendering, just wrong. This one breaks the way a user's board would,
// visibly, in the panel that owns the stale field, and it is fixed by editing a string.
//
// It is **not stored**: it belongs to the deployment rather than to an account, it has no
// id in the `gg_dashboard` table, and it cannot be edited in place. Duplicating it into
// an account's own board is how an operator makes it theirs — the same relationship the
// built-in gg configurations have to the saved ones.
import type { GgDashboard } from "@test-cabinet/run-record/gg-query";

/**
 * The id the built-in board answers to in the URL.
 *
 * A reserved word in the dashboard id space, which is safe because every stored id is a
 * minted CUID2 and no CUID2 spells `overview`.
 */
export const OVERVIEW_DASHBOARD_ID = "overview";

/**
 * The overview board.
 *
 * The panel set is chosen so the eight together answer "what is in this corpus and how is
 * it behaving", in the order a reader wants them: **volume** first (is there data, and is
 * it recent), then **outcome** (did the sessions end well), then the two dimensions every
 * gg question eventually slices by — **model** and **configuration** — and only then the
 * costs and the quality distribution, which are the numbers that need the first four for
 * context.
 *
 * Every panel obeys the rules the language imposes rather than working around them:
 *
 * - The two rate panels carry an explicit `has.summary:true` denominator. A gg run that
 *   died before it produced a session summary has no `summary.*` fields at all, and
 *   averaging a boolean across documents that lack it would report a rate over a
 *   denominator nobody chose.
 * - `metric.*` is **absent, never zero** on a run that produced nothing, so a median and a
 *   sum over it are already restricted to runs that genuinely ran — no filter needed, and
 *   adding one would be wrong twice over.
 * - The histogram's `1d` is a *starting* width. The board's range picker retunes the first
 *   date-histogram key to the range's own interval, so this text reads correctly at every
 *   range without TCQ needing an `auto` interval it cannot compile.
 */
export const OVERVIEW_DASHBOARD: GgDashboard = {
  id: OVERVIEW_DASHBOARD_ID,
  name: "Overview",
  description: "The built-in board: volume, outcomes, models, configurations, cost.",
  rangeId: "all",
  updatedAt: "",
  panels: [
    {
      title: "Sessions over time",
      query: "| stats count() by bucket(started, 1d)",
      width: 12,
    },
    {
      title: "How sessions ended",
      query: "| stats count() by state",
      width: 6,
    },
    {
      title: "Execution ceilings hit",
      query: "has.summary:true | stats count() by limit",
      width: 6,
    },
    {
      title: "Sessions by model",
      query: "| stats count() by model",
      width: 6,
    },
    {
      title: "Sessions by configuration",
      query: "| stats count() by preset",
      width: 6,
    },
    {
      title: "Median session length by model",
      query: "| stats median(metric.runTimeSeconds) as p50_seconds by model",
      width: 6,
    },
    {
      title: "Spend by model",
      query: "| stats sum(metric.cost) as usd by model",
      width: 6,
    },
    {
      title: "Context overflow rate by configuration",
      query:
        "has.summary:true | stats avg(summary.ranOutOfContext) as overflow_rate by preset",
      width: 12,
    },
  ],
};
