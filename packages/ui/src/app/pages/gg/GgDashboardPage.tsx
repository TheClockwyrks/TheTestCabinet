import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Chart,
  barChart,
  type BarPoint,
  type ChartPalette,
} from "@test-cabinet/ui";
import type {
  GgAggregateBucket,
  GgAggregateResponse,
  GgFacet,
  GgMetricSpec,
} from "@test-cabinet/run-record/gg-aggregate";
import { useAuth } from "../../../client/auth";
import { useWorkers } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { describeRunState } from "../../data/runState";
import { formatCompact, formatRunTime, formatUsd } from "../../format";
import { GG_CHROME } from "./ggChrome";
import runExec from "../runs/RunExec.module.scss";
import gg from "./GgAnalysis.module.scss";

// The metrics the overview asks for, in request order — the response returns
// aggregated values positionally, so this list *is* the column order below.
const OVERVIEW_METRICS: ReadonlyArray<GgMetricSpec> = [
  { metric: { kind: "score" }, agg: "avg" },
  { metric: { kind: "cost" }, agg: "avg" },
  { metric: { kind: "runTimeSeconds" }, agg: "avg" },
  { metric: { kind: "totalTokens" }, agg: "avg" },
  // A boolean summary field projects to 1/0, so its average across a bucket is a
  // rate — "how often did a session run out of context?".
  { metric: { kind: "summary", field: "ran_out_of_context" }, agg: "avg" },
  { metric: { kind: "summary", field: "agents_spawned" }, agg: "avg" },
  { metric: { kind: "summary", field: "compactions" }, agg: "avg" },
];

// The two breakdowns the dashboard leads with: which configuration produced a run,
// and which model drove it. Both are recorded on every gg run's capability set, so
// they need no extra bookkeeping.
const BREAKDOWNS: ReadonlyArray<{
  key: string;
  title: string;
  hint: string;
  facet: GgFacet;
}> = [
  {
    key: "preset",
    title: "By configuration",
    hint: "Average score per capability set the run was assembled from.",
    facet: { kind: "preset" },
  },
  {
    key: "model",
    title: "By primary model",
    hint: "Average score per model bound to the primary slot.",
    facet: { kind: "slotModel", slot: "primary" },
  },
];

// One aggregated figure with the count of runs that actually carried it, so a tile
// never implies more confidence than the data supports.
interface Stat {
  label: string;
  value: string;
  hint: string;
}

// The bucket an ungrouped query returns: every matching run in one grand total.
function grandTotal(response: GgAggregateResponse): GgAggregateBucket | null {
  return response.buckets[0] ?? null;
}

// One requested metric's value, matched positionally against `OVERVIEW_METRICS`.
function metricAt(
  bucket: GgAggregateBucket | null,
  index: number,
): number | null {
  const value = bucket?.metrics[index]?.value;
  return value === undefined ? null : value;
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatAvg(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

// The gg analysis section's default tab: general metrics across the gg runs
// recorded so far.
//
// Everything here is one shape of the same `POST /gg/aggregate` query the
// Aggregate tab builds by hand — an ungrouped query for the headline figures, then
// one grouped query per breakdown. The dashboard is the "what is going on across
// my runs" view; the Aggregate tab is where a specific study question gets asked.
export function GgDashboardPage() {
  const { active: worker } = useWorkers();
  const { token } = useAuth();

  const [overview, setOverview] = useState<GgAggregateResponse | null>(null);
  const [breakdowns, setBreakdowns] = useState<
    Record<string, GgAggregateResponse>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mismatched = worker?.backendMatch === "mismatch";
  const needsAuth = Boolean(worker && !worker.local);
  const signedOut = needsAuth && !token;
  const canQuery = Boolean(worker && !mismatched && !signedOut);

  const load = useCallback(async () => {
    if (!worker) return;
    setLoading(true);
    setError(null);
    try {
      const [total, ...grouped] = await Promise.all([
        worker.client.aggregateGgRuns(
          { metrics: [...OVERVIEW_METRICS] },
          token ?? "",
        ),
        ...BREAKDOWNS.map((b) =>
          worker.client.aggregateGgRuns(
            {
              groupBy: [b.facet],
              metrics: [{ metric: { kind: "score" }, agg: "avg" }],
            },
            token ?? "",
          ),
        ),
      ]);
      setOverview(total ?? null);
      const byKey: Record<string, GgAggregateResponse> = {};
      BREAKDOWNS.forEach((b, i) => {
        const response = grouped[i];
        if (response) byKey[b.key] = response;
      });
      setBreakdowns(byKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [worker, token]);

  useEffect(() => {
    if (!canQuery) {
      setLoading(false);
      return;
    }
    void load();
  }, [canQuery, load]);

  const bucket = overview ? grandTotal(overview) : null;
  const runs = overview?.totalRuns ?? 0;

  const stats: Stat[] = [
    {
      label: "gg runs recorded",
      value: formatCompact(runs),
      hint: "Every persisted gg session.",
    },
    {
      label: "avg score",
      value: formatAvg(metricAt(bucket, 0)),
      hint: "Mean reviewer score across scored runs.",
    },
    {
      label: "avg cost",
      value: formatUsd(metricAt(bucket, 1)),
      hint: "Mean spend per session.",
    },
    {
      label: "avg runtime",
      value:
        metricAt(bucket, 2) === null
          ? "—"
          : formatRunTime(Math.round(metricAt(bucket, 2)!)),
      hint: "Mean wall-clock per session.",
    },
    {
      label: "avg tokens",
      value:
        metricAt(bucket, 3) === null
          ? "—"
          : formatCompact(Math.round(metricAt(bucket, 3)!)),
      hint: "Mean total tokens per session.",
    },
    {
      label: "ran out of context",
      value: formatRate(metricAt(bucket, 4)),
      hint: "Share of sessions that exhausted their window.",
    },
    {
      label: "avg agents",
      value: formatAvg(metricAt(bucket, 5)),
      hint: "Mean agents spawned per session.",
    },
    {
      label: "avg compactions",
      value: formatAvg(metricAt(bucket, 6)),
      hint: "Mean compaction passes per session.",
    },
  ];

  return (
    <PageLayout chrome={GG_CHROME}>
      <PromptHeader
        command="--gg dashboard"
        comment={<>// how gg is doing across every recorded session</>}
      />

      {!worker && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          No worker connected — open the connections drawer (the gear in the top
          bar) to add a worker server to query.
        </p>
      )}
      {mismatched && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          The active worker is bound to a different backend than this console is
          pointed at, so its gg sessions are not the ones shown here.
        </p>
      )}
      {signedOut && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          Sign in to query gg sessions — the aggregate surface is account-gated.
        </p>
      )}
      {error && <p className={`${runExec.notice} ${runExec.error}`}>{error}</p>}

      {canQuery && (
        <>
          <p className={gg.totalRuns}>
            {loading
              ? "Loading gg sessions…"
              : `${runs} gg run${runs === 1 ? "" : "s"} recorded`}
          </p>

          <div className={gg.statGrid}>
            {stats.map((stat) => (
              <div key={stat.label} className={gg.statTile} title={stat.hint}>
                <span className={gg.statValue}>{stat.value}</span>
                <span className={gg.statLabel}>{stat.label}</span>
              </div>
            ))}
          </div>

          {bucket && bucket.stateDistribution.length > 0 && (
            <>
              <p
                className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}
              >
                How they ended
              </p>
              <div className={gg.stateStrip}>
                {bucket.stateDistribution.map((entry) => (
                  <span key={entry.state} className={gg.stateChip}>
                    <span className={gg.stateName}>
                      {describeRunState(entry.state).chip}
                    </span>
                    <span className={gg.stateCount}>{entry.count}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          {BREAKDOWNS.map((breakdown) => (
            <Breakdown
              key={breakdown.key}
              title={breakdown.title}
              hint={breakdown.hint}
              response={breakdowns[breakdown.key]}
            />
          ))}
        </>
      )}
    </PageLayout>
  );
}

// One grouped breakdown as a bar chart of average score per bucket, ordered
// best-first so the leading arm reads off the left edge. Each bar's tooltip
// carries the bucket's run count, so a tall bar standing on a single run can't be
// mistaken for a settled result.
function Breakdown({
  title,
  hint,
  response,
}: {
  title: string;
  hint: string;
  response: GgAggregateResponse | undefined;
}) {
  const data = useMemo<BarPoint[]>(() => {
    if (!response) return [];
    return response.buckets
      .map((b) => ({
        label: b.key[0]?.value ?? "(unset)",
        value: b.metrics[0]?.value ?? 0,
        title: `${b.key[0]?.value ?? "(unset)"}\n${b.n} run${
          b.n === 1 ? "" : "s"
        }`,
      }))
      .sort((a, b) => b.value - a.value);
  }, [response]);

  const longLabels = data.some((d) => d.label.length > 10);
  const spec = useMemo(
    () => (palette: ChartPalette) =>
      barChart(data, palette, {
        y: "avg score",
        yTickFormat: "~s",
        ...(longLabels ? { xTickRotate: -40 } : {}),
      }),
    [data, longLabels],
  );

  return (
    <>
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        {title}
      </p>
      <p className={gg.totalRuns}>{hint}</p>
      {data.length === 0 ? (
        <p className={gg.totalRuns}>No sessions to break down yet.</p>
      ) : (
        <Chart title={title} spec={spec} className={gg.chart} />
      )}
    </>
  );
}
