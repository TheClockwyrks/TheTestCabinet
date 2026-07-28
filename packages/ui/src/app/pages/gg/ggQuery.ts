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
import { describeRunState } from "../../data/runState";
import {
  CAPABILITIES,
  PRIMARY_SLOT,
  ALL_TOOL_NAMES,
} from "../runs/gg/ggCatalog";

// The gg aggregate query as the console models it: the editable draft the builder
// mutates, the contract catalogs it enumerates its controls from, the labels and
// formatters both the builder and the results page render with, and — because a
// ran query lives at its own shareable URL — the draft's round trip through a
// query string.
//
// Every dimension is enumerated off the generated contract union types
// (`@test-cabinet/run-record/gg-aggregate`) so this stays in lockstep with what the
// backend understands, and the capability/tool/slot targets come from the shared
// `ggCatalog`.

// --- Contract catalogs (enumerated off the generated union types) ---------------

// The facet kinds a query filters or groups by — `GgFacet["kind"]` so this list is a
// compile error away from the contract if a variant is added or removed.
export type FacetKind = GgFacet["kind"];
// What extra target a facet kind needs beyond its kind (a capability, a param path,
// a slot, or a tool) — drives which sub-control the builder shows.
export type FacetNeeds = "none" | "capability" | "param" | "slot" | "tool";

export const FACET_KINDS: ReadonlyArray<{
  kind: FacetKind;
  label: string;
  needs: FacetNeeds;
}> = [
  {
    kind: "capabilityEnabled",
    label: "Capability enabled",
    needs: "capability",
  },
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
  // Which execution ceiling stopped the run — `turns`, `runtime`,
  // `consecutive_errors`, `error_rate`, `cost`, or `none` for a run that hit
  // none. Distinct from the terminal status because two ceilings share one
  // status (`limit_exceeded`) and two have statuses of their own (`exhausted`,
  // `timed_out`), so this is the only facet that answers "which ceiling?".
  { kind: "limitHit", label: "Limit hit", needs: "none" },
  { kind: "testCase", label: "Test case", needs: "none" },
];

export const FACET_NEEDS: Record<FacetKind, FacetNeeds> = Object.fromEntries(
  FACET_KINDS.map((f) => [f.kind, f.needs]),
) as Record<FacetKind, FacetNeeds>;

// The metric kinds (`GgMetric["kind"]`) and their labels — `summary` carries a
// further `GgSummaryField`.
export type MetricKind = GgMetric["kind"];

export const METRIC_KINDS: ReadonlyArray<{ kind: MetricKind; label: string }> =
  [
    { kind: "score", label: "Score (0–1)" },
    { kind: "cost", label: "Cost (USD)" },
    { kind: "totalTokens", label: "Total tokens" },
    { kind: "runTimeSeconds", label: "Run time (s)" },
    { kind: "summary", label: "Summary field…" },
  ];

// Every `GgSummaryField`, with a human label. Typed as the union so a new field is a
// compile error until it is given a label here.
export const SUMMARY_FIELDS: ReadonlyArray<{
  field: GgSummaryField;
  label: string;
}> = [
  { field: "agents_spawned", label: "Agents spawned" },
  { field: "subagent_count", label: "Subagent count" },
  { field: "max_subagent_depth", label: "Max subagent depth" },
  { field: "compactions", label: "Compactions" },
  { field: "context_overflow_count", label: "Context overflows" },
  { field: "ran_out_of_context", label: "Ran out of context (rate)" },
  { field: "final_fullness", label: "Final fullness" },
  { field: "issue_reviews", label: "Issue reviews" },
  { field: "review_cycles", label: "Review cycles" },
  { field: "issues_reopened", label: "Issues reopened" },
  { field: "speculations", label: "Speculations" },
  { field: "code_executions", label: "Code executions" },
  { field: "issues_created", label: "Issues created" },
  { field: "issues_completed", label: "Issues completed" },
  // Response healing. Every rate below is over `code_executions` (one per
  // code-shaped turn), which is why that field is the denominator and there is
  // no separate "responses" count. The per-strategy figures answer the question
  // the capability exists to measure — "how often does this model still wrap its
  // program in a fence after being told not to?" — so they are labelled by the
  // strategy id an ablation switches off, not by a prettified paraphrase.
  { field: "responses_healed", label: "Responses healed" },
  { field: "healing_rate", label: "Responses healed (rate)" },
  { field: "healing_applications", label: "Healing applications" },
  { field: "healing_strip_fences", label: "Healing: strip-fences" },
  { field: "healing_strip_prose", label: "Healing: strip-prose" },
  {
    field: "healing_drop_duplicate_program",
    label: "Healing: drop-duplicate-program",
  },
  { field: "healing_drop_imports", label: "Healing: drop-imports" },
  { field: "healing_unwrap_async", label: "Healing: unwrap-async" },
  { field: "healing_strip_comment_only", label: "Healing: strip-comment-only" },
  { field: "responses_not_a_program", label: "Replies that weren't programs" },
  { field: "responses_several_blocks", label: "Replies with several programs" },
  // The same count split by how the reply presented its programs, because the two
  // are different instruction-following failures: a fenced reply is a model still
  // formatting a reply it was told not to format, while a bare one is a model
  // sending two answers in one turn. Summed, they are the row above.
  {
    field: "responses_several_blocks_fenced",
    label: "Replies with several programs (fenced)",
  },
  {
    field: "responses_several_blocks_bare",
    label: "Replies with several programs (bare)",
  },
];

export const AGGREGATIONS: ReadonlyArray<GgAggregation> = [
  "avg",
  "min",
  "max",
  "sum",
];
export const FACET_OPS: ReadonlyArray<{ op: GgFacetOp; label: string }> = [
  { op: "eq", label: "=" },
  { op: "ne", label: "≠" },
  { op: "exists", label: "exists" },
  { op: "absent", label: "absent" },
];
export const COMPARE_OPS: ReadonlyArray<{ op: GgCompareOp; label: string }> = [
  { op: "lt", label: "<" },
  { op: "lte", label: "≤" },
  { op: "gt", label: ">" },
  { op: "gte", label: "≥" },
  { op: "eq", label: "=" },
];

// Every terminal RunState — the `terminalStatus` facet-filter value options.
export const RUN_STATES: ReadonlyArray<RunState> = [
  "completed",
  "catastrophic",
  "timed_out",
  "harness_error",
  "hung",
  "infrastructure",
];

// The first capability with a param, used to seed a `capabilityParam` facet so it
// resolves to a real target on the first click.
const FIRST_PARAM_CAP = CAPABILITIES.find(
  (c) => c.params && c.params.length > 0,
);

// --- Draft state (the builder's editable shape) ---------------------------------

export interface FacetDraft {
  kind: FacetKind;
  capability: string;
  param: string;
  slot: string;
  tool: string;
}
export interface FacetFilterDraft {
  facet: FacetDraft;
  op: GgFacetOp;
  value: string;
}
export interface MetricDraft {
  kind: MetricKind;
  field: GgSummaryField;
}
export interface MetricFilterDraft {
  metric: MetricDraft;
  op: GgCompareOp;
  value: string;
}
export interface MetricSpecDraft {
  metric: MetricDraft;
  agg: GgAggregation;
}

/** A whole query as the builder holds it — everything a shared link must carry. */
export interface AggregateDraft {
  /** The optional single-case narrowing (empty for "all cases"). */
  testCase: string;
  facetFilters: FacetFilterDraft[];
  metricFilters: MetricFilterDraft[];
  groupBy: FacetDraft[];
  metrics: MetricSpecDraft[];
  /**
   * Which requested metric the results page charts (an index into `metrics`), or
   * `-1` for the run count `n` every bucket carries.
   */
  chartMetric: number;
}

export function blankFacet(kind: FacetKind = "capabilityEnabled"): FacetDraft {
  return {
    kind,
    capability: CAPABILITIES[0]!.id,
    param: FIRST_PARAM_CAP?.params?.[0]?.key ?? "",
    slot: PRIMARY_SLOT,
    tool: ALL_TOOL_NAMES[0] ?? "",
  };
}
export function blankMetric(kind: MetricKind = "score"): MetricDraft {
  return { kind, field: SUMMARY_FIELDS[0]!.field };
}

/**
 * The query the builder opens on: group by whether compaction was enabled and
 * average the score — the shape of gg's canonical ablation question, so the first
 * click on Run query already asks something meaningful.
 */
export function defaultDraft(): AggregateDraft {
  return {
    testCase: "",
    facetFilters: [],
    metricFilters: [],
    groupBy: [{ ...blankFacet("capabilityEnabled"), capability: "compaction" }],
    metrics: [{ metric: blankMetric("score"), agg: "avg" }],
    chartMetric: -1,
  };
}

// --- Draft → contract serialization ---------------------------------------------

export function toFacet(d: FacetDraft): GgFacet {
  switch (d.kind) {
    case "testCase":
      return { kind: "testCase" };
    case "preset":
      return { kind: "preset" };
    case "terminalStatus":
      return { kind: "terminalStatus" };
    case "limitHit":
      return { kind: "limitHit" };
    case "capabilityEnabled":
      return { kind: "capabilityEnabled", capability: d.capability };
    case "capabilityImplementation":
      return { kind: "capabilityImplementation", capability: d.capability };
    case "capabilityParam":
      return {
        kind: "capabilityParam",
        capability: d.capability,
        param: d.param,
      };
    case "slotModel":
      return { kind: "slotModel", slot: d.slot };
    case "toolOffered":
      return { kind: "toolOffered", tool: d.tool };
  }
}
export function toMetric(d: MetricDraft): GgMetric {
  return d.kind === "summary"
    ? { kind: "summary", field: d.field }
    : { kind: d.kind };
}

/** The whole draft as the `POST /gg/aggregate` body it stands for. */
export function buildQuery(draft: AggregateDraft): GgAggregateQuery {
  const query: GgAggregateQuery = {};
  if (draft.testCase) query.testCase = draft.testCase;
  if (draft.facetFilters.length)
    query.facetFilters = draft.facetFilters.map<GgFacetFilter>((f) => {
      const out: GgFacetFilter = { facet: toFacet(f.facet), op: f.op };
      // exists/absent ignore the value; eq/ne carry it.
      if ((f.op === "eq" || f.op === "ne") && f.value.trim())
        out.value = f.value.trim();
      return out;
    });
  if (draft.metricFilters.length)
    query.metricFilters = draft.metricFilters.map<GgMetricFilter>((f) => ({
      metric: toMetric(f.metric),
      op: f.op,
      value: Number(f.value) || 0,
    }));
  if (draft.groupBy.length) query.groupBy = draft.groupBy.map(toFacet);
  if (draft.metrics.length)
    query.metrics = draft.metrics.map<GgMetricSpec>((m) => ({
      metric: toMetric(m.metric),
      agg: m.agg,
    }));
  return query;
}

// --- Draft ↔ query string --------------------------------------------------------
//
// A ran query lives at its own URL so it can be pasted to a colleague, and the
// results page hands the same parameters back to the builder when the operator
// goes to revise it. The encoding is compact and legible rather than an opaque
// JSON blob: one repeated param per clause, each `field:target` segments joined
// with `|`. Decoding is total — anything unrecognized falls back to a blank draft
// clause, so a hand-edited or stale link degrades to a sensible query instead of
// erroring.

const PARAM_CASE = "case";
const PARAM_GROUP = "group";
const PARAM_METRIC = "metric";
const PARAM_FACET_FILTER = "ff";
const PARAM_METRIC_FILTER = "mf";
/**
 * The charted metric's parameter. Exported because it is the one parameter that
 * does **not** describe the query: switching the charted metric must not re-issue
 * it, so the results page strips this before deciding whether the query changed.
 */
export const CHART_PARAM = "chart";

// A facet as one token: its kind, plus the target its kind needs.
function encodeFacet(d: FacetDraft): string {
  switch (FACET_NEEDS[d.kind]) {
    case "capability":
      return `${d.kind}:${d.capability}`;
    case "param":
      return `${d.kind}:${d.capability}:${d.param}`;
    case "slot":
      return `${d.kind}:${d.slot}`;
    case "tool":
      return `${d.kind}:${d.tool}`;
    case "none":
      return d.kind;
  }
}

function decodeFacet(token: string): FacetDraft {
  const [rawKind, first, second] = token.split(":");
  const kind = FACET_KINDS.find((f) => f.kind === rawKind)?.kind;
  if (!kind) return blankFacet();
  const draft = blankFacet(kind);
  switch (FACET_NEEDS[kind]) {
    case "capability":
      return { ...draft, capability: first || draft.capability };
    case "param":
      return {
        ...draft,
        capability: first || draft.capability,
        param: second || draft.param,
      };
    case "slot":
      return { ...draft, slot: first || draft.slot };
    case "tool":
      return { ...draft, tool: first || draft.tool };
    case "none":
      return draft;
  }
}

// A metric as one token: its kind, plus the summary field when it has one.
function encodeMetric(d: MetricDraft): string {
  return d.kind === "summary" ? `summary:${d.field}` : d.kind;
}

function decodeMetric(token: string): MetricDraft {
  const [rawKind, field] = token.split(":");
  const kind = METRIC_KINDS.find((m) => m.kind === rawKind)?.kind;
  if (!kind) return blankMetric();
  if (kind !== "summary") return blankMetric(kind);
  const known = SUMMARY_FIELDS.find((f) => f.field === field)?.field;
  return { kind: "summary", field: known ?? blankMetric().field };
}

/** The draft as a query string — the shareable form of a ran query. */
export function encodeDraft(draft: AggregateDraft): URLSearchParams {
  const params = new URLSearchParams();
  if (draft.testCase) params.set(PARAM_CASE, draft.testCase);
  for (const f of draft.groupBy) params.append(PARAM_GROUP, encodeFacet(f));
  for (const m of draft.metrics)
    params.append(PARAM_METRIC, `${m.agg}|${encodeMetric(m.metric)}`);
  for (const f of draft.facetFilters)
    params.append(
      PARAM_FACET_FILTER,
      `${encodeFacet(f.facet)}|${f.op}|${f.value}`,
    );
  for (const f of draft.metricFilters)
    params.append(
      PARAM_METRIC_FILTER,
      `${encodeMetric(f.metric)}|${f.op}|${f.value}`,
    );
  // The charted metric rides along so a shared link opens on the same figure.
  params.set(CHART_PARAM, String(draft.chartMetric));
  return params;
}

/**
 * The draft a query string stands for. Total: an absent, malformed, or stale
 * parameter falls back to the blank clause (or, with no parameters at all, the
 * {@link defaultDraft}), so a shared link always opens on a runnable query.
 */
export function decodeDraft(params: URLSearchParams): AggregateDraft {
  if (![...params.keys()].some((key) => KNOWN_PARAMS.has(key)))
    return defaultDraft();

  const groupBy = params.getAll(PARAM_GROUP).map(decodeFacet);
  const metrics = params.getAll(PARAM_METRIC).map<MetricSpecDraft>((token) => {
    const [rawAgg, metric = ""] = token.split("|");
    const agg = AGGREGATIONS.find((a) => a === rawAgg) ?? "avg";
    return { metric: decodeMetric(metric), agg };
  });
  const facetFilters = params
    .getAll(PARAM_FACET_FILTER)
    .map<FacetFilterDraft>((token) => {
      const [facet = "", rawOp, value = ""] = token.split("|");
      const op = FACET_OPS.find((o) => o.op === rawOp)?.op ?? "eq";
      return { facet: decodeFacet(facet), op, value };
    });
  const metricFilters = params
    .getAll(PARAM_METRIC_FILTER)
    .map<MetricFilterDraft>((token) => {
      const [metric = "", rawOp, value = ""] = token.split("|");
      const op = COMPARE_OPS.find((o) => o.op === rawOp)?.op ?? "gte";
      return { metric: decodeMetric(metric), op, value };
    });

  return {
    testCase: params.get(PARAM_CASE) ?? "",
    facetFilters,
    metricFilters,
    groupBy,
    metrics,
    chartMetric: readChartMetric(params.get(CHART_PARAM), metrics.length),
  };
}

const KNOWN_PARAMS = new Set([
  PARAM_CASE,
  PARAM_GROUP,
  PARAM_METRIC,
  PARAM_FACET_FILTER,
  PARAM_METRIC_FILTER,
  CHART_PARAM,
]);

/**
 * The charted metric index a `chart=` parameter stands for, clamped to the metrics
 * the link actually carries so a stale index can never point past them (that would
 * chart nothing at all); `-1` (the run count) is always valid.
 */
export function readChartMetric(
  raw: string | null,
  metricCount: number,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return -1;
  return parsed < metricCount ? parsed : -1;
}

// --- Labels & formatting ---------------------------------------------------------

export function summaryLabel(field: GgSummaryField): string {
  return SUMMARY_FIELDS.find((f) => f.field === field)?.label ?? field;
}
export function capName(id: string): string {
  return CAPABILITIES.find((c) => c.id === id)?.name ?? id;
}
export function facetLabel(f: GgFacet): string {
  switch (f.kind) {
    case "testCase":
      return "Test case";
    case "preset":
      return "Preset";
    case "terminalStatus":
      return "Terminal status";
    case "limitHit":
      return "Limit hit";
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
export function metricLabel(m: GgMetric): string {
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
export function metricSpecLabel(spec: GgMetricSpec): string {
  return `${spec.agg} ${metricLabel(spec.metric)}`;
}

const numberFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Format one aggregated metric value for a table cell. A `null`/absent value is
// rendered by the caller as an em dash — never as a misleading 0.
export function formatMetric(metric: GgMetric, value: number): string {
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
      // Rates and fullness read best as fractions; the rest are counts. An
      // averaged `healing_rate` is a fraction of a fraction, so rounding it to a
      // whole number would collapse "a third of replies needed repair" to "0".
      return metric.field === "ran_out_of_context" ||
        metric.field === "final_fullness" ||
        metric.field === "healing_rate"
        ? value.toFixed(2)
        : numberFmt.format(Math.round(value * 100) / 100);
  }
}

// A bucket's composite key as a single label — one facet value per group-by, joined.
// An empty key is the single grand-total bucket.
export function bucketKeyLabel(key: ReadonlyArray<GgBucketKeyPart>): string {
  if (key.length === 0) return "(all runs)";
  return key.map((part) => part.value ?? "(absent)").join(" · ");
}

// A bucket's terminal-state distribution as a compact string ("completed 3 · hung 1").
export function stateDistLabel(
  dist: GgAggregateResponse["buckets"][number]["stateDistribution"],
): string {
  if (dist.length === 0) return "—";
  return dist
    .map((s) => `${describeRunState(s.state).chip} ${s.count}`)
    .join(" · ");
}

// The aggregated value of one requested metric in one bucket, matched by position
// (the response returns metric values in request order).
export function metricValueAt(
  bucket: GgAggregateResponse["buckets"][number],
  index: number,
): GgMetricValue | undefined {
  return bucket.metrics[index];
}
