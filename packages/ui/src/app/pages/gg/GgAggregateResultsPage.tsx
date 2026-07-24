import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ChartWidget,
  Panel,
  barChart,
  type BarPoint,
  type ChartPalette,
} from "@test-cabinet/ui";
import type {
  GgAggregateResponse,
  GgMetricSpec,
} from "@test-cabinet/run-record/gg-aggregate";
import { useAuth } from "../../../client/auth";
import { useWorkers } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { routes } from "../../routes";
import {
  CHART_PARAM,
  bucketKeyLabel,
  buildQuery,
  decodeDraft,
  facetLabel,
  formatMetric,
  metricSpecLabel,
  metricValueAt,
  readChartMetric,
  stateDistLabel,
  toFacet,
  toMetric,
  type AggregateDraft,
} from "./ggQuery";
import { GG_CHROME } from "./ggChrome";
import runExec from "../runs/RunExec.module.scss";
import gg from "./GgAnalysis.module.scss";

// One ran gg aggregate query, at its own URL.
//
// The whole query lives in the query string (see `ggQuery`'s encoding), so this
// page is what makes a study *shareable*: paste the link and a colleague sees the
// same buckets, and the Edit query control leads back to the builder with every
// clause still loaded. Results deliberately do not live on the builder page — the
// controls that produced them would push the answer off screen.

export function GgAggregateResultsPage() {
  const { active: worker } = useWorkers();
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // The query this URL stands for, read from every parameter *except* the charted
  // metric: that one picks a view of the answer, not the question, so switching it
  // must leave the draft's identity — and therefore the query — untouched.
  const querySearch = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.delete(CHART_PARAM);
    return params.toString();
  }, [searchParams]);
  const draft = useMemo<AggregateDraft>(
    () => decodeDraft(new URLSearchParams(querySearch)),
    [querySearch],
  );

  const [response, setResponse] = useState<GgAggregateResponse | null>(null);
  // The draft that produced `response`. The metric values come back positionally,
  // so the table and chart must read them against the query as it was sent.
  const [ran, setRan] = useState<AggregateDraft | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mismatched = worker?.backendMatch === "mismatch";
  const signedOut = Boolean(worker && !worker.local && !token);
  const canRun = Boolean(worker && !mismatched && !signedOut);

  const run = useCallback(async () => {
    if (!worker) return;
    setRunning(true);
    setError(null);
    try {
      const result = await worker.client.aggregateGgRuns(
        buildQuery(draft),
        token ?? "",
      );
      setResponse(result);
      setRan(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResponse(null);
    } finally {
      setRunning(false);
    }
  }, [worker, token, draft]);

  useEffect(() => {
    if (!canRun) {
      setRunning(false);
      return;
    }
    void run();
  }, [canRun, run]);

  // Selecting a different metric to chart rewrites just that parameter (replacing,
  // so the history stays one entry per query) — the shared link then opens on the
  // same figure.
  function setChartMetric(index: number) {
    const params = new URLSearchParams(searchParams);
    params.set(CHART_PARAM, String(index));
    setSearchParams(params, { replace: true });
  }

  // The charted metric, clamped to the metrics the *ran* query carried so a stale
  // index from a shared link can never point past them.
  const chartMetric = readChartMetric(
    searchParams.get(CHART_PARAM),
    (ran ?? draft).metrics.length,
  );

  // The chart's bars: one per bucket, the selected metric (or the run count) as the
  // height. Buckets whose selected metric is absent are dropped, never shown as a
  // misleading 0.
  const chartData = useMemo<BarPoint[]>(() => {
    if (!response) return [];
    if (chartMetric === -1)
      return response.buckets.map((b) => ({
        label: bucketKeyLabel(b.key),
        value: b.n,
      }));
    const points: BarPoint[] = [];
    for (const b of response.buckets) {
      const mv = metricValueAt(b, chartMetric);
      if (mv?.value == null) continue;
      points.push({ label: bucketKeyLabel(b.key), value: mv.value });
    }
    return points;
  }, [response, chartMetric]);

  const metricSpecs = useMemo<GgMetricSpec[]>(
    () =>
      (ran?.metrics ?? []).map((m) => ({
        metric: toMetric(m.metric),
        agg: m.agg,
      })),
    [ran],
  );
  const chartedSpec = metricSpecs[chartMetric];
  const chartTitle =
    chartMetric === -1 || !chartedSpec
      ? "Run count per bucket"
      : `${metricSpecLabel(chartedSpec)} per bucket`;
  const longLabels = chartData.some((d) => d.label.length > 10);
  const chartSpec = useMemo(
    () => (palette: ChartPalette) =>
      barChart(chartData, palette, {
        y: chartMetric === -1 ? "runs" : "value",
        yTickFormat: "~s",
        ...(longLabels ? { xTickRotate: -40 } : {}),
      }),
    [chartData, chartMetric, longLabels],
  );

  const groupFacets = (ran?.groupBy ?? []).map(toFacet);
  const empty =
    response !== null &&
    (response.totalRuns === 0 || response.buckets.length === 0);

  return (
    <PageLayout chrome={GG_CHROME}>
      <PromptHeader
        command="--gg aggregate --run"
        comment={<>// one query&apos;s buckets, at their own shareable URL</>}
      />

      {/* Back to the builder carrying every clause, so revising a query never
          means rebuilding it. */}
      <p className={gg.resultsNav}>
        <Link
          className={runExec.secondary}
          to={routes.ggAnalysisAggregate(searchParams.toString())}
        >
          ← Edit query
        </Link>
      </p>

      {!worker && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          No worker connected — open the connections drawer (the gear in the top
          bar) to add a worker server to query.
        </p>
      )}
      {mismatched && (
        <p className={`${runExec.notice} ${runExec.error}`}>
          The active worker is bound to a different backend than this console is
          pointed at. Querying is disabled to avoid mixing result sets.
        </p>
      )}
      {signedOut && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          Sign in to query — the gg aggregate endpoint is account-gated. Use the
          account control in the top bar to log in.
        </p>
      )}
      {error && <p className={`${runExec.notice} ${runExec.error}`}>{error}</p>}

      {running && <p className={gg.totalRuns}>Running the query…</p>}

      {response && ran && (
        <>
          <Panel className={gg.resultsSummary}>
            <p className={gg.resultsTotal}>
              {response.totalRuns} gg run{response.totalRuns === 1 ? "" : "s"}{" "}
              matched · {response.buckets.length} bucket
              {response.buckets.length === 1 ? "" : "s"}
            </p>
          </Panel>

          {empty ? (
            <Panel>
              <p className={runExec.muted}>
                No gg runs matched this query. Widen the filters, or run some gg
                sessions first — this surface aggregates recorded runs.
              </p>
            </Panel>
          ) : (
            <div className={gg.widgets}>
              <ChartWidget
                title={chartTitle}
                chartTitle={chartTitle}
                spec={chartData.length > 0 ? chartSpec : undefined}
                empty="The chosen metric is absent in every bucket (no run carried it), so there is nothing to plot."
                actions={
                  <label className={runExec.field}>
                    <span className={runExec.fieldLabel}>Chart</span>
                    <select
                      className={runExec.select}
                      value={chartMetric}
                      onChange={(e) => setChartMetric(Number(e.target.value))}
                    >
                      <option value={-1}>Run count (n)</option>
                      {metricSpecs.map((spec, i) => (
                        <option key={i} value={i}>
                          {metricSpecLabel(spec)}
                        </option>
                      ))}
                    </select>
                  </label>
                }
              />

              {/* Table: every bucket, its key, count, metrics, and state mix. */}
              <Panel>
                <div className={gg.tableWrap}>
                  <table className={gg.table}>
                    <thead>
                      <tr>
                        {groupFacets.length === 0 ? (
                          <th>Bucket</th>
                        ) : (
                          groupFacets.map((f, i) => (
                            <th key={i}>{facetLabel(f)}</th>
                          ))
                        )}
                        <th className={gg.numCol}>n</th>
                        {metricSpecs.map((spec, i) => (
                          <th key={i} className={gg.numCol}>
                            {metricSpecLabel(spec)}
                          </th>
                        ))}
                        <th>Terminal states</th>
                      </tr>
                    </thead>
                    <tbody>
                      {response.buckets.map((bucket, bi) => (
                        <tr key={bi}>
                          {groupFacets.length === 0 ? (
                            <td>(all runs)</td>
                          ) : (
                            bucket.key.map((part, ki) => (
                              <td key={ki}>
                                {part.value ?? (
                                  <span className={gg.absent}>(absent)</span>
                                )}
                              </td>
                            ))
                          )}
                          <td className={gg.numCol}>{bucket.n}</td>
                          {metricSpecs.map((spec, mi) => {
                            const mv = metricValueAt(bucket, mi);
                            return (
                              <td key={mi} className={gg.numCol}>
                                {mv?.value == null ? (
                                  <span
                                    className={gg.absent}
                                    title="No run in this bucket carried this metric."
                                  >
                                    —
                                  </span>
                                ) : (
                                  <span
                                    title={
                                      mv.contributing < bucket.n
                                        ? `${mv.contributing} of ${bucket.n} runs contributed`
                                        : undefined
                                    }
                                  >
                                    {formatMetric(spec.metric, mv.value)}
                                    {mv.contributing < bucket.n && (
                                      <span className={gg.contrib}>
                                        {" "}
                                        ({mv.contributing}/{bucket.n})
                                      </span>
                                    )}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className={gg.stateCell}>
                            {stateDistLabel(bucket.stateDistribution)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </PageLayout>
  );
}
