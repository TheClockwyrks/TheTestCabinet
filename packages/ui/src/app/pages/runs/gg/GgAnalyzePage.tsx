import { useMemo, useState } from "react";
import { Chart, barChart, type BarPoint, type ChartPalette } from "@test-cabinet/ui";
import type {
  GgAggregateQuery,
  GgAggregateResponse,
  GgAggregation,
  GgBucketKeyPart,
  GgCompareOp,
  GgFacet,
  GgFacetFilter,
  GgFacetOp,
  GgMetric,
  GgMetricFilter,
  GgMetricSpec,
  GgMetricValue,
  GgSummaryField,
} from "@test-cabinet/run-record/gg-aggregate";
import type { RunState } from "@test-cabinet/run-record";
import { useAuth } from "../../../../client/auth";
import { useWorkers } from "../../../../client/context";
import { PageLayout } from "../../../components/PageLayout";
import { PromptHeader } from "../../../components/PromptHeader";
import { describeRunState } from "../../../data/runState";
import { useTestCaseName } from "../../../data/useTestCaseName";
import { useTestCases } from "../../../data/useTestCases";
import {
  CAPABILITIES,
  COMMON_ROLE_SLOTS,
  PRIMARY_SLOT,
  ALL_TOOL_NAMES,
} from "./ggCatalog";
import runExec from "../RunExec.module.scss";
import gg from "./GgAnalyzePage.module.scss";

// The result-aggregation surface: a Kibana-style structured-query builder over the
// recorded gg sessions (`POST /gg/aggregate`). Every dimension a query can slice by
// — the capability-set facets, the summary/resource metrics, the aggregations and
// comparison operators — is enumerated off the generated contract union types
// (`@test-cabinet/run-record/gg-aggregate`) so the builder stays in lockstep with
// what the backend understands, and the capability/tool/slot targets come from the
// shared `ggCatalog`. gg is headless — this console is the only place these
// cross-session studies can be run.

// --- Contract catalogs (enumerated off the generated union types) ---------------

// The facet kinds a query filters or groups by — `GgFacet["kind"]` so this list is a
// compile error away from the contract if a variant is added or removed.
type FacetKind = GgFacet["kind"];
// What extra target a facet kind needs beyond its kind (a capability, a param path,
// a slot, or a tool) — drives which sub-control the builder shows.
type FacetNeeds = "none" | "capability" | "param" | "slot" | "tool";

const FACET_KINDS: ReadonlyArray<{
  kind: FacetKind;
  label: string;
  needs: FacetNeeds;
}> = [
  { kind: "capabilityEnabled", label: "Capability enabled", needs: "capability" },
  {
    kind: "capabilityImplementation",
    label: "Capability implementation",
    needs: "capability",
  },
  { kind: "capabilityParam", label: "Capability param", needs: "param" },
  { kind: "slotModel", label: "Slot → model", needs: "slot" },
  { kind: "toolOffered", label: "Tool offered", needs: "tool" },
  { kind: "preset", label: "Preset", needs: "none" },
  { kind: "terminalStatus", label: "Terminal status", needs: "none" },
  { kind: "testCase", label: "Test case", needs: "none" },
];

const FACET_NEEDS: Record<FacetKind, FacetNeeds> = Object.fromEntries(
  FACET_KINDS.map((f) => [f.kind, f.needs]),
) as Record<FacetKind, FacetNeeds>;

// The metric kinds (`GgMetric["kind"]`) and their labels — `summary` carries a
// further `GgSummaryField`.
type MetricKind = GgMetric["kind"];

const METRIC_KINDS: ReadonlyArray<{ kind: MetricKind; label: string }> = [
  { kind: "score", label: "Score (0–1)" },
  { kind: "cost", label: "Cost (USD)" },
  { kind: "totalTokens", label: "Total tokens" },
  { kind: "runTimeSeconds", label: "Run time (s)" },
  { kind: "summary", label: "Summary field…" },
];

// Every `GgSummaryField`, with a human label. Typed as the union so a new field is a
// compile error until it is given a label here.
const SUMMARY_FIELDS: ReadonlyArray<{ field: GgSummaryField; label: string }> = [
  { field: "agents_spawned", label: "Agents spawned" },
  { field: "subagent_count", label: "Subagent count" },
  { field: "max_subagent_depth", label: "Max subagent depth" },
  { field: "compactions", label: "Compactions" },
  { field: "context_overflow_count", label: "Context overflows" },
  { field: "ran_out_of_context", label: "Ran out of context (rate)" },
  { field: "final_fullness", label: "Final fullness" },
  { field: "code_reviews", label: "Code reviews" },
  { field: "review_cycles", label: "Review cycles" },
  { field: "issues_reopened", label: "Issues reopened" },
  { field: "speculations", label: "Speculations" },
  { field: "code_executions", label: "Code executions" },
  { field: "issues_created", label: "Issues created" },
  { field: "issues_completed", label: "Issues completed" },
];

const AGGREGATIONS: ReadonlyArray<GgAggregation> = ["avg", "min", "max", "sum"];
const FACET_OPS: ReadonlyArray<{ op: GgFacetOp; label: string }> = [
  { op: "eq", label: "=" },
  { op: "ne", label: "≠" },
  { op: "exists", label: "exists" },
  { op: "absent", label: "absent" },
];
const COMPARE_OPS: ReadonlyArray<{ op: GgCompareOp; label: string }> = [
  { op: "lt", label: "<" },
  { op: "lte", label: "≤" },
  { op: "gt", label: ">" },
  { op: "gte", label: "≥" },
  { op: "eq", label: "=" },
];

// Every terminal RunState — the `terminalStatus` facet-filter value options.
const RUN_STATES: ReadonlyArray<RunState> = [
  "completed",
  "catastrophic",
  "timed_out",
  "harness_error",
  "hung",
  "infrastructure",
];

// The first capability with a param, used to seed a `capabilityParam` facet so it
// resolves to a real target on the first click.
const FIRST_PARAM_CAP = CAPABILITIES.find((c) => c.params && c.params.length > 0);

// --- Draft state (the builder's editable shape) ---------------------------------

interface FacetDraft {
  kind: FacetKind;
  capability: string;
  param: string;
  slot: string;
  tool: string;
}
interface FacetFilterDraft {
  facet: FacetDraft;
  op: GgFacetOp;
  value: string;
}
interface MetricDraft {
  kind: MetricKind;
  field: GgSummaryField;
}
interface MetricFilterDraft {
  metric: MetricDraft;
  op: GgCompareOp;
  value: string;
}
interface MetricSpecDraft {
  metric: MetricDraft;
  agg: GgAggregation;
}

function blankFacet(kind: FacetKind = "capabilityEnabled"): FacetDraft {
  return {
    kind,
    capability: CAPABILITIES[0]!.id,
    param: FIRST_PARAM_CAP?.params?.[0]?.key ?? "",
    slot: PRIMARY_SLOT,
    tool: ALL_TOOL_NAMES[0] ?? "",
  };
}
function blankMetric(kind: MetricKind = "score"): MetricDraft {
  return { kind, field: SUMMARY_FIELDS[0]!.field };
}

// --- Draft → contract serialization ---------------------------------------------

function toFacet(d: FacetDraft): GgFacet {
  switch (d.kind) {
    case "testCase":
      return { kind: "testCase" };
    case "preset":
      return { kind: "preset" };
    case "terminalStatus":
      return { kind: "terminalStatus" };
    case "capabilityEnabled":
      return { kind: "capabilityEnabled", capability: d.capability };
    case "capabilityImplementation":
      return { kind: "capabilityImplementation", capability: d.capability };
    case "capabilityParam":
      return { kind: "capabilityParam", capability: d.capability, param: d.param };
    case "slotModel":
      return { kind: "slotModel", slot: d.slot };
    case "toolOffered":
      return { kind: "toolOffered", tool: d.tool };
  }
}
function toMetric(d: MetricDraft): GgMetric {
  return d.kind === "summary"
    ? { kind: "summary", field: d.field }
    : { kind: d.kind };
}

// --- Labels ---------------------------------------------------------------------

function summaryLabel(field: GgSummaryField): string {
  return SUMMARY_FIELDS.find((f) => f.field === field)?.label ?? field;
}
function capName(id: string): string {
  return CAPABILITIES.find((c) => c.id === id)?.name ?? id;
}
function facetLabel(f: GgFacet): string {
  switch (f.kind) {
    case "testCase":
      return "Test case";
    case "preset":
      return "Preset";
    case "terminalStatus":
      return "Terminal status";
    case "capabilityEnabled":
      return `${capName(f.capability)} on?`;
    case "capabilityImplementation":
      return `${capName(f.capability)} impl`;
    case "capabilityParam":
      return `${capName(f.capability)}.${f.param}`;
    case "slotModel":
      return `${f.slot} model`;
    case "toolOffered":
      return `${f.tool} offered?`;
  }
}
function metricLabel(m: GgMetric): string {
  switch (m.kind) {
    case "runTimeSeconds":
      return "run time (s)";
    case "totalTokens":
      return "tokens";
    case "cost":
      return "cost (USD)";
    case "score":
      return "score";
    case "summary":
      return summaryLabel(m.field);
  }
}
function metricSpecLabel(spec: GgMetricSpec): string {
  return `${spec.agg} ${metricLabel(spec.metric)}`;
}

const numberFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Format one aggregated metric value for a table cell. A `null`/absent value is
// rendered by the caller as an em dash — never as a misleading 0.
function formatMetric(metric: GgMetric, value: number): string {
  switch (metric.kind) {
    case "score":
      return value.toFixed(2);
    case "cost":
      return `$${value.toFixed(2)}`;
    case "runTimeSeconds":
      return `${numberFmt.format(Math.round(value))}s`;
    case "totalTokens":
      return compactFmt.format(value);
    case "summary":
      // Rates and fullness read best as fractions; the rest are counts.
      return metric.field === "ran_out_of_context" ||
        metric.field === "final_fullness"
        ? value.toFixed(2)
        : numberFmt.format(Math.round(value * 100) / 100);
  }
}

// A bucket's composite key as a single label — one facet value per group-by, joined.
// An empty key is the single grand-total bucket.
function bucketKeyLabel(key: ReadonlyArray<GgBucketKeyPart>): string {
  if (key.length === 0) return "(all runs)";
  return key.map((part) => part.value ?? "(absent)").join(" · ");
}

// A bucket's terminal-state distribution as a compact string ("completed 3 · hung 1").
function stateDistLabel(
  dist: GgAggregateResponse["buckets"][number]["stateDistribution"],
): string {
  if (dist.length === 0) return "—";
  return dist
    .map((s) => `${describeRunState(s.state).chip} ${s.count}`)
    .join(" · ");
}

// The aggregated value of one requested metric in one bucket, matched by position
// (the response returns metric values in request order).
function metricValueAt(
  bucket: GgAggregateResponse["buckets"][number],
  index: number,
): GgMetricValue | undefined {
  return bucket.metrics[index];
}

// --- The four canonical study questions, one click away -------------------------

interface Example {
  label: string;
  build: () => {
    facetFilters: FacetFilterDraft[];
    metricFilters: MetricFilterDraft[];
    groupBy: FacetDraft[];
    metrics: MetricSpecDraft[];
  };
}

const EXAMPLES: ReadonlyArray<Example> = [
  {
    label: "Compaction on/off → context-overflow rate",
    build: () => ({
      facetFilters: [],
      metricFilters: [],
      groupBy: [{ ...blankFacet("capabilityEnabled"), capability: "compaction" }],
      metrics: [
        { metric: { kind: "summary", field: "ran_out_of_context" }, agg: "avg" },
      ],
    }),
  },
  {
    label: "Planning implementation → reopened issues",
    build: () => ({
      facetFilters: [],
      metricFilters: [],
      groupBy: [
        { ...blankFacet("capabilityImplementation"), capability: "planning" },
      ],
      metrics: [
        { metric: { kind: "summary", field: "issues_reopened" }, agg: "sum" },
      ],
    }),
  },
  {
    label: "Subagent depth → score",
    build: () => ({
      facetFilters: [],
      metricFilters: [],
      groupBy: [
        { ...blankFacet("capabilityParam"), capability: "subagents", param: "maxDepth" },
      ],
      metrics: [{ metric: { kind: "score", field: "agents_spawned" }, agg: "avg" }],
    }),
  },
  {
    label: "Speculative on/off → score",
    build: () => ({
      facetFilters: [],
      metricFilters: [],
      groupBy: [
        {
          ...blankFacet("capabilityEnabled"),
          capability: "speculative-execution",
        },
      ],
      metrics: [{ metric: { kind: "score", field: "agents_spawned" }, agg: "avg" }],
    }),
  },
];

export function GgAnalyzePage() {
  const { active: worker } = useWorkers();
  const { token } = useAuth();
  const { testCases } = useTestCases();
  const testCaseName = useTestCaseName();

  const [testCase, setTestCase] = useState("");
  const [facetFilters, setFacetFilters] = useState<FacetFilterDraft[]>([]);
  const [metricFilters, setMetricFilters] = useState<MetricFilterDraft[]>([]);
  const [groupBy, setGroupBy] = useState<FacetDraft[]>(() => [
    { ...blankFacet("capabilityEnabled"), capability: "compaction" },
  ]);
  const [metrics, setMetrics] = useState<MetricSpecDraft[]>(() => [
    { metric: blankMetric("score"), agg: "avg" },
  ]);
  // Which requested metric to chart (an index into the ran query's metrics), or -1
  // for the run count `n` that every bucket carries.
  const [chartMetric, setChartMetric] = useState<number>(-1);

  // The last query that actually ran, snapshotting the group-by + metrics it used
  // alongside the response. The response returns metric values positionally (in
  // request order), so the table must read them against the query as it was sent —
  // not the live builder, which the operator may have since edited.
  const [result, setResult] = useState<{
    response: GgAggregateResponse;
    groupBy: FacetDraft[];
    metrics: MetricSpecDraft[];
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedCases = useMemo(
    () =>
      [...testCases].sort((a, b) =>
        testCaseName(a.slug).localeCompare(testCaseName(b.slug)),
      ),
    [testCases, testCaseName],
  );

  const mismatched = worker?.backendMatch === "mismatch";
  const needsAuth = Boolean(worker && !worker.local);
  const signedOut = needsAuth && !token;
  const canRun = Boolean(worker && !mismatched && !signedOut && !running);

  function applyExample(ex: Example) {
    const built = ex.build();
    setFacetFilters(built.facetFilters);
    setMetricFilters(built.metricFilters);
    setGroupBy(built.groupBy);
    setMetrics(built.metrics);
    setChartMetric(built.metrics.length ? 0 : -1);
  }

  function buildQuery(): GgAggregateQuery {
    const query: GgAggregateQuery = {};
    if (testCase) query.testCase = testCase;
    if (facetFilters.length)
      query.facetFilters = facetFilters.map<GgFacetFilter>((f) => {
        const out: GgFacetFilter = { facet: toFacet(f.facet), op: f.op };
        // exists/absent ignore the value; eq/ne carry it.
        if ((f.op === "eq" || f.op === "ne") && f.value.trim())
          out.value = f.value.trim();
        return out;
      });
    if (metricFilters.length)
      query.metricFilters = metricFilters.map<GgMetricFilter>((f) => ({
        metric: toMetric(f.metric),
        op: f.op,
        value: Number(f.value) || 0,
      }));
    if (groupBy.length) query.groupBy = groupBy.map(toFacet);
    if (metrics.length)
      query.metrics = metrics.map<GgMetricSpec>((m) => ({
        metric: toMetric(m.metric),
        agg: m.agg,
      }));
    return query;
  }

  async function onRun() {
    if (!worker) return;
    setRunning(true);
    setError(null);
    try {
      const response = await worker.client.aggregateGgRuns(
        buildQuery(),
        token ?? "",
      );
      // Snapshot the group-by + metrics as sent, so the table/chart stay aligned to
      // this response even if the builder is edited afterwards.
      setResult({ response, groupBy: [...groupBy], metrics: [...metrics] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
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
    setGroupBy((prev) => prev.map((f, j) => (i === j ? { ...f, ...patch } : f)));
  }
  function removeGroupBy(i: number) {
    setGroupBy((prev) => prev.filter((_, j) => j !== i));
  }

  // --- Metric mutators ------------------------------------------------------
  function addMetric() {
    setMetrics((prev) => {
      const next = [...prev, { metric: blankMetric(), agg: "avg" as GgAggregation }];
      if (chartMetric === -1) setChartMetric(next.length - 1);
      return next;
    });
  }
  function updateMetric(i: number, patch: Partial<MetricSpecDraft>) {
    setMetrics((prev) => prev.map((m, j) => (i === j ? { ...m, ...patch } : m)));
  }
  function removeMetric(i: number) {
    setMetrics((prev) => prev.filter((_, j) => j !== i));
    setChartMetric((prev) => (prev >= i ? prev - 1 : prev));
  }

  // --- The chart's bars: one per bucket, the selected metric (or run count) as
  //     the height. Buckets whose selected metric is absent are dropped, never
  //     shown as a misleading 0.
  const chartData = useMemo<BarPoint[]>(() => {
    if (!result) return [];
    if (chartMetric === -1)
      return result.response.buckets.map((b) => ({
        label: bucketKeyLabel(b.key),
        value: b.n,
      }));
    const points: BarPoint[] = [];
    for (const b of result.response.buckets) {
      const mv = metricValueAt(b, chartMetric);
      if (mv?.value == null) continue;
      points.push({ label: bucketKeyLabel(b.key), value: mv.value });
    }
    return points;
  }, [result, chartMetric]);

  const chartedSpec = result?.metrics[chartMetric];
  const chartTitle =
    chartMetric === -1 || !chartedSpec
      ? "Run count per bucket"
      : `${metricSpecLabel({ metric: toMetric(chartedSpec.metric), agg: chartedSpec.agg })} per bucket`;
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

  return (
    <PageLayout>
      <PromptHeader
        command="--gg analyze"
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

      {/* Examples: the four canonical study questions, one click away. */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Example studies
      </p>
      <div className={gg.exampleRow}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            className={runExec.secondary}
            onClick={() => applyExample(ex)}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Optional single-case narrowing — the common "hold the case fixed". */}
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Query
      </p>
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

      {/* Facet filters: capability-set (and coarse) predicates, ANDed. */}
      <div className={gg.builderSection}>
        <div className={gg.builderHead}>
          <span className={gg.builderTitle}>Facet filters</span>
          <button type="button" className={runExec.secondary} onClick={addFacetFilter}>
            + Add facet filter
          </button>
        </div>
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
      </div>

      {/* Metric filters: numeric summary/resource predicates, ANDed. */}
      <div className={gg.builderSection}>
        <div className={gg.builderHead}>
          <span className={gg.builderTitle}>Metric filters</span>
          <button type="button" className={runExec.secondary} onClick={addMetricFilter}>
            + Add metric filter
          </button>
        </div>
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
                onChange={(e) => updateMetricFilter(i, { value: e.target.value })}
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
      </div>

      {/* Group-by: the slice-by dimensions (one bucket key component per facet). */}
      <div className={gg.builderSection}>
        <div className={gg.builderHead}>
          <span className={gg.builderTitle}>Group by</span>
          <button type="button" className={runExec.secondary} onClick={addGroupBy}>
            + Add group-by facet
          </button>
        </div>
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
      </div>

      {/* Metrics: what to aggregate per bucket (count is always included). */}
      <div className={gg.builderSection}>
        <div className={gg.builderHead}>
          <span className={gg.builderTitle}>Metrics</span>
          <button type="button" className={runExec.secondary} onClick={addMetric}>
            + Add metric
          </button>
        </div>
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
      </div>

      <div className={runExec.actions}>
        <div className={runExec.actionsEnd}>
          <button className={runExec.primary} onClick={onRun} disabled={!canRun}>
            {running ? "Running…" : "Run query"}
          </button>
        </div>
      </div>

      {error && <p className={`${runExec.notice} ${runExec.error}`}>{error}</p>}

      {result && (
        <Results
          result={result.response}
          groupBy={result.groupBy}
          metrics={result.metrics}
          chartMetric={chartMetric}
          setChartMetric={setChartMetric}
          chartData={chartData}
          chartTitle={chartTitle}
          chartSpec={chartSpec}
        />
      )}
    </PageLayout>
  );
}

// --- Sub-components --------------------------------------------------------------

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
          onChange={(e) => onChange({ field: e.target.value as GgSummaryField })}
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

// The result surface: the total, a bar chart of a chosen metric (or run count) per
// bucket, and the bucket table (key, n, each metric, terminal-state distribution).
function Results({
  result,
  groupBy,
  metrics,
  chartMetric,
  setChartMetric,
  chartData,
  chartTitle,
  chartSpec,
}: {
  result: GgAggregateResponse;
  groupBy: FacetDraft[];
  metrics: MetricSpecDraft[];
  chartMetric: number;
  setChartMetric: (i: number) => void;
  chartData: BarPoint[];
  chartTitle: string;
  chartSpec: (palette: ChartPalette) => ReturnType<typeof barChart>;
}) {
  const groupFacets = groupBy.map(toFacet);
  const metricSpecs = metrics.map<GgMetricSpec>((m) => ({
    metric: toMetric(m.metric),
    agg: m.agg,
  }));

  return (
    <div className={gg.results}>
      <p className={`${runExec.sectionLabel} ${runExec.sectionLabelBackdrop}`}>
        Results
      </p>
      <p className={gg.totalRuns}>
        {result.totalRuns} gg run{result.totalRuns === 1 ? "" : "s"} matched ·{" "}
        {result.buckets.length} bucket
        {result.buckets.length === 1 ? "" : "s"}
      </p>

      {result.totalRuns === 0 || result.buckets.length === 0 ? (
        <p className={runExec.muted}>
          No gg runs matched this query. Widen the filters, or run some gg
          sessions first — this surface aggregates recorded runs.
        </p>
      ) : (
        <>
          {/* Chart: one bar per bucket, the selected metric (or run count). */}
          <div className={gg.chartControls}>
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
          </div>
          {chartData.length > 0 ? (
            <Chart title={chartTitle} spec={chartSpec} className={gg.chart} />
          ) : (
            <p className={runExec.muted}>
              The chosen metric is absent in every bucket (no run carried it), so
              there is nothing to plot.
            </p>
          )}

          {/* Table: every bucket, its key, count, metrics, and state mix. */}
          <div className={gg.tableWrap}>
            <table className={gg.table}>
              <thead>
                <tr>
                  {groupFacets.length === 0 ? (
                    <th>Bucket</th>
                  ) : (
                    groupFacets.map((f, i) => <th key={i}>{facetLabel(f)}</th>)
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
                {result.buckets.map((bucket, bi) => (
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
        </>
      )}
    </div>
  );
}
