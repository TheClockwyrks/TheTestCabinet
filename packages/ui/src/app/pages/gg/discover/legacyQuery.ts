// The **legacy-URL transcoder** — an old `/gg/aggregate…?…` link, as TCQ text.
//
// The widget builder that owned those URLs is gone along with the closed facet/metric
// vocabulary it was built on, but the single best property of that implementation was
// that **the URL was the query**: a ran aggregation lived at its own address, and those
// addresses were pasted into issues, notes and chat. Replacing the surface is a
// deliberate choice; breaking every link that ever pointed at it is not. So an old link
// is transcoded to equivalent query text and redirected into Discover, where the
// operator can see — and edit — exactly what their question became.
//
// The encoding it reads is the one `pages/gg/ggQuery.ts` wrote (deleted with the
// builder): one repeated parameter per clause, `field:target` segments joined with `|`.
//
// | Parameter | Held | Becomes |
// | --- | --- | --- |
// | `case=<slug>` | the single-case narrowing | `case:<slug>` |
// | `ff=<facet>\|<op>\|<value>` | a facet filter | a filter clause |
// | `mf=<metric>\|<op>\|<value>` | a metric filter | a filter clause |
// | `group=<facet>` | a group-by key | a `by` key |
// | `metric=<agg>\|<metric>` | a requested figure | a `stats` aggregation |
// | `chart=<index>` | which figure was charted | dropped |
//
// Decoding is **total**, exactly as the codec it replaces was: an unrecognized facet,
// metric or operator is skipped rather than throwing, because the alternative to a
// slightly narrower query is a broken link, and a stale hand-edited URL was always a
// possibility. A link with no recognizable parameters at all transcodes to the query the
// builder itself opened on, so the redirect always lands on something runnable.
import { formatIdentifier, formatLiteral } from "../query";

/**
 * The query the old builder opened on — group by whether compaction was enabled and
 * average the score, gg's canonical ablation question.
 *
 * A bare `/gg/aggregate` carried no parameters and showed exactly this, so a link to it
 * transcodes to exactly this rather than to an empty editor.
 */
export const LEGACY_DEFAULT_QUERY = "| stats avg(score) by cap.compaction";

/** The parameters the old codec wrote. A URL carrying none of them is not a legacy
 *  aggregate link at all. */
const LEGACY_PARAMS = ["case", "group", "metric", "ff", "mf", "chart"] as const;

/**
 * The old facet ops, as TCQ spells them. `exists`/`absent` have no operator of their own
 * — they are `field:*` and its negation — so they are handled where a clause is built.
 */
const FACET_OPS: Record<string, string> = { eq: ":", ne: "!=" };

/** The old metric-filter ops, as TCQ spells them. */
const COMPARE_OPS: Record<string, string> = {
  eq: ":",
  ne: "!=",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

/** The four aggregations the old surface could request; TCQ spells all four the same. */
const AGGREGATIONS = new Set(["avg", "min", "max", "sum"]);

/**
 * The metric kinds that were not summary fields, and the document field each became.
 *
 * `metric.*` is the namespace the run's resource figures live in now, and they are
 * **absent rather than zero** on a run that produced nothing — which is the fix that
 * makes a transcoded `runTimeSeconds >= 1800` filter finally honest, because the old one
 * compared against a default-constructed zero.
 */
const METRIC_FIELDS: Record<string, string> = {
  score: "score",
  cost: "metric.cost",
  totalTokens: "metric.totalTokens",
  runTimeSeconds: "metric.runTimeSeconds",
};

/**
 * The old `GgSummaryField` tokens whose document field is **not** the token's own
 * camel-cased name.
 *
 * Everything else in that enum flattens to `summary.<camelCase>` directly, because the
 * document carries the whole session summary verbatim. These are the response-healing
 * counters, which lived on a nested `healing` struct and had the prefix folded into their
 * enum name.
 */
const SUMMARY_FIELD_ALIASES: Record<string, string> = {
  responses_healed: "summary.healing.healed",
  healing_applications: "summary.healing.applications",
  healing_strip_fences: "summary.healing.stripFences",
  healing_strip_prose: "summary.healing.stripProse",
  healing_drop_duplicate_program: "summary.healing.dropDuplicateProgram",
  healing_drop_imports: "summary.healing.dropImports",
  healing_unwrap_async: "summary.healing.unwrapAsync",
};

/**
 * The one legacy metric with **no** document field: `healing_rate` was a per-run ratio
 * the aggregator computed (`healed / codeExecutions`), and TCQ deliberately has no
 * `rate()` — averaging a boolean is a rate, and a ratio of two counts is not a scalar the
 * document carries.
 *
 * A clause that names it is dropped rather than silently rewritten to the numerator,
 * which would answer a different question under the original question's label. The
 * redirect lands in an editor showing the transcoded text, so a dropped column is visible
 * rather than assumed.
 */
const INEXPRESSIBLE_METRICS = new Set(["healing_rate"]);

/** Whether this query string is one the old aggregate surface wrote. */
export function isLegacyAggregateQuery(params: URLSearchParams): boolean {
  return LEGACY_PARAMS.some((name) => params.has(name));
}

/**
 * The TCQ text an old aggregate URL stands for.
 *
 * Always returns runnable text: a URL with nothing recognizable in it yields
 * {@link LEGACY_DEFAULT_QUERY}, the query the builder itself opened on.
 */
export function legacyQueryText(params: URLSearchParams): string {
  if (!isLegacyAggregateQuery(params)) return LEGACY_DEFAULT_QUERY;

  const clauses: string[] = [];

  const testCase = params.get("case");
  if (testCase) clauses.push(`case:${quote(testCase)}`);

  for (const raw of params.getAll("ff")) {
    const clause = facetFilterClause(raw);
    if (clause) clauses.push(clause);
  }
  for (const raw of params.getAll("mf")) {
    const clause = metricFilterClause(raw);
    if (clause) clauses.push(clause);
  }

  const groups: string[] = [];
  for (const raw of params.getAll("group")) {
    const field = facetField(raw);
    if (field) groups.push(field);
  }

  const aggs: string[] = [];
  for (const raw of params.getAll("metric")) {
    const agg = aggregation(raw);
    if (agg) aggs.push(agg);
  }

  const filter = clauses.join(" and ");

  // No aggregation and no grouping is not an aggregate query at all — it is the document
  // view, which is precisely what TCQ expresses by omitting the stage. A grouping with no
  // surviving figure still asked "how many per bucket", so it keeps `count()`: every old
  // bucket carried `n` whether or not a metric was requested.
  if (aggs.length === 0 && groups.length === 0) {
    return filter || LEGACY_DEFAULT_QUERY;
  }
  const columns = aggs.length > 0 ? aggs.join(", ") : "count()";
  const by = groups.length > 0 ? ` by ${groups.join(", ")}` : "";
  return `${filter ? `${filter} ` : ""}| stats ${columns}${by}`;
}

/**
 * The document field a legacy facet token names.
 *
 * The mapping is where the redesign's one *new* namespace shows up: the old
 * `terminalStatus` facet read the run's lifecycle state, which is now the plain `state`
 * field, and `limitHit` — the facet that answered "which ceiling stopped it?", a question
 * the terminal status could not — is now `limit`.
 */
function facetField(token: string): string | null {
  const [kind, first, second] = token.split(":");
  switch (kind) {
    case "testCase":
      return "case";
    case "preset":
      return "preset";
    case "terminalStatus":
      return "state";
    case "limitHit":
      return "limit";
    case "capabilityEnabled":
      return first ? path("cap", first) : null;
    case "capabilityImplementation":
      return first ? path("cap", first, "impl") : null;
    case "capabilityParam":
      return first && second ? path("cap", first, second) : null;
    // The facet that keyed on an *agent name* — which is why "which model?" was
    // structurally unaskable before and is now the plain `model` field.
    case "slotModel":
      return first ? path("agent", first, "model") : null;
    case "toolOffered":
      return first ? path("tool", first) : null;
    default:
      return null;
  }
}

/** The document field a legacy metric token names, or `null` when it has none. */
function metricField(token: string): string | null {
  const [kind, field] = token.split(":");
  if (kind !== "summary") return kind ? (METRIC_FIELDS[kind] ?? null) : null;
  if (!field || INEXPRESSIBLE_METRICS.has(field)) return null;
  return SUMMARY_FIELD_ALIASES[field] ?? `summary.${camelCase(field)}`;
}

/** One `ff=<facet>|<op>|<value>` clause. */
function facetFilterClause(raw: string): string | null {
  const [facet = "", op = "", value = ""] = raw.split("|");
  const field = facetField(facet);
  if (!field) return null;
  // `exists`/`absent` ignored the value and have no operator in TCQ: they are the
  // `field:*` predicate, negated for the absent half.
  if (op === "exists") return `${field}:*`;
  if (op === "absent") return `not ${field}:*`;
  const operator = FACET_OPS[op];
  if (!operator) return null;
  return `${field}${operator === ":" ? ":" : ` ${operator} `}${quote(value)}`;
}

/** One `mf=<metric>|<op>|<value>` clause. */
function metricFilterClause(raw: string): string | null {
  const [metric = "", op = "", value = ""] = raw.split("|");
  const field = metricField(metric);
  const operator = COMPARE_OPS[op];
  if (!field || !operator) return null;
  // A metric filter's value was always a number, and it stays unquoted so it compares
  // numerically rather than as the string that happens to spell it.
  const numeric = Number(value);
  const literal = Number.isFinite(numeric) && value.trim() !== "" ? String(numeric) : "0";
  return `${field}${operator === ":" ? ":" : ` ${operator} `}${literal}`;
}

/** One `metric=<agg>|<metric>` aggregation. */
function aggregation(raw: string): string | null {
  const [agg = "", metric = ""] = raw.split("|");
  const func = AGGREGATIONS.has(agg) ? agg : "avg";
  const field = metricField(metric);
  return field ? `${func}(${field})` : null;
}

/** A dotted field name with every segment quoted as the grammar requires — a capability
 *  id like `agent-persistence` or a tool name with a dash does not lex as one bare
 *  word, and the formatter is the one place that decision is made. */
function path(...segments: string[]): string {
  return segments.map(formatIdentifier).join(".");
}

/** A value as a literal, quoted when it would not lex bare. Routed through the formatter
 *  so the transcoder cannot invent a second quoting rule. */
function quote(value: string): string {
  return formatLiteral({ raw: value, quoted: false, span: { start: 0, end: 0 } });
}

/** `context_overflow_count` → `contextOverflowCount`: the session summary serializes
 *  camelCase, while the old enum's wire tokens were snake_case. */
function camelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}
