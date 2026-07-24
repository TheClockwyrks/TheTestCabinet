import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Panel } from "@test-cabinet/ui";
import type {
  GgAggregation,
  GgCompareOp,
  GgFacetOp,
  GgSummaryField,
} from "@test-cabinet/run-record/gg-aggregate";
import { useAuth } from "../../../client/auth";
import { useWorkers } from "../../../client/context";
import { PageLayout } from "../../components/PageLayout";
import { PromptHeader } from "../../components/PromptHeader";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useTestCases } from "../../data/useTestCases";
import { routes } from "../../routes";
import {
  CAPABILITIES,
  COMMON_ROLE_SLOTS,
  PRIMARY_SLOT,
  ALL_TOOL_NAMES,
} from "../runs/gg/ggCatalog";
import {
  AGGREGATIONS,
  COMPARE_OPS,
  FACET_KINDS,
  FACET_NEEDS,
  FACET_OPS,
  METRIC_KINDS,
  RUN_STATES,
  SUMMARY_FIELDS,
  blankFacet,
  blankMetric,
  decodeDraft,
  encodeDraft,
  type FacetDraft,
  type FacetFilterDraft,
  type FacetKind,
  type MetricDraft,
  type MetricFilterDraft,
  type MetricKind,
  type MetricSpecDraft,
} from "./ggQuery";
import runExec from "../runs/RunExec.module.scss";
import { GG_CHROME } from "./ggChrome";
import gg from "./GgAnalysis.module.scss";

// The result-aggregation surface: a Kibana-style structured-query builder over the
// recorded gg sessions (`POST /gg/aggregate`). gg is headless — this console is the
// only place these cross-session studies can be run.
//
// The builder only *composes* a query; running it navigates to the results page,
// carrying the whole query in the URL (see `ggQuery`'s encoding). That keeps a ran
// query shareable, keeps results off the page whose controls produced them, and
// lets the results page hand the same parameters back here for revision — this page
// opens on whatever draft its own URL carries.

export function GgAggregatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { active: worker } = useWorkers();
  const { token } = useAuth();
  const { testCases } = useTestCases();
  const testCaseName = useTestCaseName();

  // The draft this page opened on: the query the URL carries (a link back from the
  // results page), or gg's canonical ablation question on a bare visit.
  const [initial] = useState(() => decodeDraft(searchParams));

  const [testCase, setTestCase] = useState(initial.testCase);
  const [facetFilters, setFacetFilters] = useState<FacetFilterDraft[]>(
    initial.facetFilters,
  );
  const [metricFilters, setMetricFilters] = useState<MetricFilterDraft[]>(
    initial.metricFilters,
  );
  const [groupBy, setGroupBy] = useState<FacetDraft[]>(initial.groupBy);
  const [metrics, setMetrics] = useState<MetricSpecDraft[]>(initial.metrics);
  // Which requested metric the results page charts (an index into `metrics`), or -1
  // for the run count `n` that every bucket carries.
  const [chartMetric, setChartMetric] = useState(initial.chartMetric);

  const sortedCases = useMemo(
    () =>
      [...testCases].sort((a, b) =>
        testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
      ),
    [testCases, testCaseName],
  );

  // The same preconditions the results page queries under, checked here so an
  // unrunnable query is caught while it is still being composed rather than after
  // the navigation.
  const mismatched = worker?.backendMatch === "mismatch";
  const signedOut = Boolean(worker && !worker.local && !token);
  const canRun = Boolean(worker && !mismatched && !signedOut);

  // Run the query by *navigating* to it: the whole draft encodes into the results
  // URL, so the result is a page anyone can link to and Back returns here.
  function onRun() {
    const params = encodeDraft({
      testCase,
      facetFilters,
      metricFilters,
      groupBy,
      metrics,
      chartMetric,
    });
    navigate(routes.ggAnalysisAggregateResults(params.toString()));
  }

  // --- Facet-filter mutators ------------------------------------------------
  function addFacetFilter() {
    setFacetFilters((prev) => [
      ...prev,
      { facet: blankFacet(), op: "eq", value: "" },
    ]);
  }
  function updateFacetFilter(i: number, patch: Partial<FacetFilterDraft>) {
    setFacetFilters((prev) =>
      prev.map((f, j) => (i === j ? { ...f, ...patch } : f)),
    );
  }
  function removeFacetFilter(i: number) {
    setFacetFilters((prev) => prev.filter((_, j) => j !== i));
  }

  // --- Metric-filter mutators -----------------------------------------------
  function addMetricFilter() {
    setMetricFilters((prev) => [
      ...prev,
      { metric: blankMetric(), op: "gte", value: "1" },
    ]);
  }
  function updateMetricFilter(i: number, patch: Partial<MetricFilterDraft>) {
    setMetricFilters((prev) =>
      prev.map((f, j) => (i === j ? { ...f, ...patch } : f)),
    );
  }
  function removeMetricFilter(i: number) {
    setMetricFilters((prev) => prev.filter((_, j) => j !== i));
  }

  // --- Group-by mutators ----------------------------------------------------
  function addGroupBy() {
    setGroupBy((prev) => [...prev, blankFacet()]);
  }
  function updateGroupBy(i: number, patch: Partial<FacetDraft>) {
    setGroupBy((prev) =>
      prev.map((f, j) => (i === j ? { ...f, ...patch } : f)),
    );
  }
  function removeGroupBy(i: number) {
    setGroupBy((prev) => prev.filter((_, j) => j !== i));
  }

  // --- Metric mutators ------------------------------------------------------
  function addMetric() {
    setMetrics((prev) => {
      const next = [
        ...prev,
        { metric: blankMetric(), agg: "avg" as GgAggregation },
      ];
      if (chartMetric === -1) setChartMetric(next.length - 1);
      return next;
    });
  }
  function updateMetric(i: number, patch: Partial<MetricSpecDraft>) {
    setMetrics((prev) =>
      prev.map((m, j) => (i === j ? { ...m, ...patch } : m)),
    );
  }
  function removeMetric(i: number) {
    setMetrics((prev) => prev.filter((_, j) => j !== i));
    setChartMetric((prev) => (prev >= i ? prev - 1 : prev));
  }

  return (
    <PageLayout chrome={GG_CHROME}>
      <PromptHeader
        command="--gg aggregate"
        comment={<>// query &amp; slice recorded gg sessions in aggregate</>}
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
          pointed at. Querying is disabled to avoid mixing result sets.
        </p>
      )}
      {signedOut && (
        <p className={`${runExec.notice} ${runExec.warn}`}>
          Sign in to query — the gg aggregate endpoint is account-gated. Use the
          account control in the top bar to log in.
        </p>
      )}

      {/* Optional single-case narrowing — the common "hold the case fixed". */}
      <BuilderPanel title="Query">
        <div className={runExec.fields}>
          <label className={runExec.field}>
            <span className={runExec.fieldLabel}>Test case (optional)</span>
            <select
              className={runExec.select}
              value={testCase}
              onChange={(e) => setTestCase(e.target.value)}
            >
              <option value="">(all cases)</option>
              {sortedCases.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {testCaseName(c.slug)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </BuilderPanel>

      {/* Facet filters: capability-set (and coarse) predicates, ANDed. */}
      <BuilderPanel
        title="Facet filters"
        action={
          <button
            type="button"
            className={runExec.secondary}
            onClick={addFacetFilter}
          >
            + Add facet filter
          </button>
        }
      >
        {facetFilters.length === 0 ? (
          <p className={runExec.muted}>
            No facet filters — every recorded gg run is in scope.
          </p>
        ) : (
          facetFilters.map((f, i) => (
            <div key={i} className={gg.clauseRow}>
              <FacetPicker
                facet={f.facet}
                onChange={(patch) =>
                  updateFacetFilter(i, { facet: { ...f.facet, ...patch } })
                }
              />
              <select
                className={runExec.select}
                value={f.op}
                onChange={(e) =>
                  updateFacetFilter(i, { op: e.target.value as GgFacetOp })
                }
                aria-label="operator"
              >
                {FACET_OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              <FacetValueInput
                facet={f.facet}
                op={f.op}
                value={f.value}
                onChange={(value) => updateFacetFilter(i, { value })}
              />
              <button
                type="button"
                className={gg.clauseRemove}
                onClick={() => removeFacetFilter(i)}
                aria-label="Remove facet filter"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </BuilderPanel>

      {/* Metric filters: numeric summary/resource predicates, ANDed. */}
      <BuilderPanel
        title="Metric filters"
        action={
          <button
            type="button"
            className={runExec.secondary}
            onClick={addMetricFilter}
          >
            + Add metric filter
          </button>
        }
      >
        {metricFilters.length === 0 ? (
          <p className={runExec.muted}>
            No metric filters — no numeric threshold narrows the runs.
          </p>
        ) : (
          metricFilters.map((f, i) => (
            <div key={i} className={gg.clauseRow}>
              <MetricPicker
                metric={f.metric}
                onChange={(patch) =>
                  updateMetricFilter(i, { metric: { ...f.metric, ...patch } })
                }
              />
              <select
                className={runExec.select}
                value={f.op}
                onChange={(e) =>
                  updateMetricFilter(i, { op: e.target.value as GgCompareOp })
                }
                aria-label="operator"
              >
                {COMPARE_OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                className={runExec.input}
                type="number"
                value={f.value}
                onChange={(e) =>
                  updateMetricFilter(i, { value: e.target.value })
                }
                aria-label="threshold"
              />
              <button
                type="button"
                className={gg.clauseRemove}
                onClick={() => removeMetricFilter(i)}
                aria-label="Remove metric filter"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </BuilderPanel>

      {/* Group-by: the slice-by dimensions (one bucket key component per facet). */}
      <BuilderPanel
        title="Group by"
        action={
          <button
            type="button"
            className={runExec.secondary}
            onClick={addGroupBy}
          >
            + Add group-by facet
          </button>
        }
      >
        {groupBy.length === 0 ? (
          <p className={runExec.muted}>
            No group-by — every matching run folds into one grand-total bucket.
          </p>
        ) : (
          groupBy.map((f, i) => (
            <div key={i} className={gg.clauseRow}>
              <FacetPicker
                facet={f}
                onChange={(patch) => updateGroupBy(i, patch)}
              />
              <button
                type="button"
                className={gg.clauseRemove}
                onClick={() => removeGroupBy(i)}
                aria-label="Remove group-by facet"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </BuilderPanel>

      {/* Metrics: what to aggregate per bucket (count is always included). */}
      <BuilderPanel
        title="Metrics"
        action={
          <button
            type="button"
            className={runExec.secondary}
            onClick={addMetric}
          >
            + Add metric
          </button>
        }
      >
        <p className={runExec.muted}>
          Every bucket carries its run count and terminal-state distribution
          regardless; these add aggregated columns.
        </p>
        {metrics.map((m, i) => (
          <div key={i} className={gg.clauseRow}>
            <select
              className={runExec.select}
              value={m.agg}
              onChange={(e) =>
                updateMetric(i, { agg: e.target.value as GgAggregation })
              }
              aria-label="aggregation"
            >
              {AGGREGATIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <MetricPicker
              metric={m.metric}
              onChange={(patch) =>
                updateMetric(i, { metric: { ...m.metric, ...patch } })
              }
            />
            <button
              type="button"
              className={gg.clauseRemove}
              onClick={() => removeMetric(i)}
              aria-label="Remove metric"
            >
              ✕
            </button>
          </div>
        ))}
      </BuilderPanel>

      <div className={runExec.actions}>
        <div className={runExec.actionsEnd}>
          <button
            className={runExec.primary}
            onClick={onRun}
            disabled={!canRun}
          >
            Run query
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

// --- Sub-components --------------------------------------------------------------

// One section of the builder, in its own panel so it reads as a card rather than
// clauses sitting straight on the console's backdrop. `action` is the section's
// add-a-clause control, on the heading's trailing edge.
function BuilderPanel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel className={gg.builderPanel}>
      <div className={gg.builderHead}>
        <span className={gg.builderTitle}>{title}</span>
        {action}
      </div>
      {children}
    </Panel>
  );
}

// The facet picker: a kind select plus the sub-control its `needs` demands (a
// capability, a param path, a slot, or a tool). Shared by facet filters and group-by.
function FacetPicker({
  facet,
  onChange,
}: {
  facet: FacetDraft;
  onChange: (patch: Partial<FacetDraft>) => void;
}) {
  const needs = FACET_NEEDS[facet.kind];
  const paramCap = CAPABILITIES.find((c) => c.id === facet.capability);
  return (
    <>
      <select
        className={runExec.select}
        value={facet.kind}
        onChange={(e) => onChange({ kind: e.target.value as FacetKind })}
        aria-label="facet"
      >
        {FACET_KINDS.map((f) => (
          <option key={f.kind} value={f.kind}>
            {f.label}
          </option>
        ))}
      </select>
      {(needs === "capability" || needs === "param") && (
        <select
          className={runExec.select}
          value={facet.capability}
          onChange={(e) => onChange({ capability: e.target.value })}
          aria-label="capability"
        >
          {CAPABILITIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {needs === "param" &&
        (paramCap?.params && paramCap.params.length > 0 ? (
          <select
            className={runExec.select}
            value={facet.param}
            onChange={(e) => onChange({ param: e.target.value })}
            aria-label="param"
          >
            {paramCap.params.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={runExec.input}
            type="text"
            value={facet.param}
            onChange={(e) => onChange({ param: e.target.value })}
            placeholder="param path"
            aria-label="param"
          />
        ))}
      {needs === "slot" && (
        <>
          <input
            className={runExec.input}
            list="gg-analyze-slots"
            type="text"
            value={facet.slot}
            onChange={(e) => onChange({ slot: e.target.value })}
            placeholder="slot"
            aria-label="slot"
          />
          <datalist id="gg-analyze-slots">
            {[PRIMARY_SLOT, ...COMMON_ROLE_SLOTS].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}
      {needs === "tool" && (
        <select
          className={runExec.select}
          value={facet.tool}
          onChange={(e) => onChange({ tool: e.target.value })}
          aria-label="tool"
        >
          {ALL_TOOL_NAMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

// The value input for a facet filter — a boolean select for `capabilityEnabled`, a
// RunState select for `terminalStatus`, a plain text field otherwise. Disabled (and
// omitted from the query) when the operator is exists/absent.
function FacetValueInput({
  facet,
  op,
  value,
  onChange,
}: {
  facet: FacetDraft;
  op: GgFacetOp;
  value: string;
  onChange: (value: string) => void;
}) {
  if (op === "exists" || op === "absent") {
    return <span className={gg.clauseValueMuted}>(no value)</span>;
  }
  if (facet.kind === "capabilityEnabled" || facet.kind === "toolOffered") {
    return (
      <select
        className={runExec.select}
        value={value || "true"}
        onChange={(e) => onChange(e.target.value)}
        aria-label="value"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (facet.kind === "terminalStatus") {
    return (
      <select
        className={runExec.select}
        value={value || RUN_STATES[0]}
        onChange={(e) => onChange(e.target.value)}
        aria-label="value"
      >
        {RUN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={runExec.input}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      aria-label="value"
    />
  );
}

// The metric picker: a metric-kind select plus a summary-field select when the kind
// is `summary`. Shared by metric filters and the aggregate metric specs.
function MetricPicker({
  metric,
  onChange,
}: {
  metric: MetricDraft;
  onChange: (patch: Partial<MetricDraft>) => void;
}) {
  return (
    <>
      <select
        className={runExec.select}
        value={metric.kind}
        onChange={(e) => onChange({ kind: e.target.value as MetricKind })}
        aria-label="metric"
      >
        {METRIC_KINDS.map((m) => (
          <option key={m.kind} value={m.kind}>
            {m.label}
          </option>
        ))}
      </select>
      {metric.kind === "summary" && (
        <select
          className={runExec.select}
          value={metric.field}
          onChange={(e) =>
            onChange({ field: e.target.value as GgSummaryField })
          }
          aria-label="summary field"
        >
          {SUMMARY_FIELDS.map((f) => (
            <option key={f.field} value={f.field}>
              {f.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
