// The **evaluator** — the mirrored half of `crates/core/src/gg_query.eval.rs`.
//
// It exists twice because it runs in two places: on the backend for the console, and in
// the browser for the public static site, which has no backend at all. Rust is
// authoritative; every rule below is a transcription, and the shared
// `gg_query.conformance.json` fixture (executed by both suites — see
// `conformance.test.ts`) is the only thing standing between two independent evaluators
// and two different published numbers.
//
// **A change to any rule here must arrive with a fixture case that would have caught
// the drift.**
import type {
  GgAgg,
  GgAggColumn,
  GgBucket,
  GgBucketKeyPart,
  GgCompareOp,
  GgFieldCatalog,
  GgFieldInfo,
  GgFieldKind,
  GgFieldValueCount,
  GgFilter,
  GgGroupKey,
  GgQuery,
  GgQueryResponse,
  GgRunDoc,
  GgSortKey,
  GgStatsStage,
  GgValue,
} from "@clockwyrks/run-record/gg-query";
import {
  GG_DATE_FIELDS,
  GG_FIELD_TOP_VALUES,
  GG_MAX_GROUP_KEYS,
  aggName,
  asDisplay,
  asNumber,
  compareCodePoints,
  compareNumbers,
  intervalFloor,
  quantile,
  totalCompare,
  valueKey,
} from "./values";

/** The value of `field` on `doc`, or `undefined` when the document lacks the key. */
function get(doc: GgRunDoc, field: string): GgValue | undefined {
  // `Object.hasOwn` rather than a bare lookup, so a field literally named
  // `constructor` or `__proto__` reads as absent instead of picking up
  // `Object.prototype`. Rust's `BTreeMap` has no such inherited keys; this is the
  // mirror's cost of using a plain object for the field map.
  return Object.hasOwn(doc.fields, field) ? doc.fields[field] : undefined;
}

/** A document's `id`, or `""` for a malformed document — the tiebreak of the canonical
 *  document order, so it must never throw on something that arrived over the wire. */
function docId(doc: GgRunDoc): string {
  const value = get(doc, "id");
  return typeof value === "string" ? value : "";
}

/**
 * Run a compiled query over a corpus of documents.
 *
 * A pure fold: the caller supplies the documents (the console from the backend's
 * response, the static site from the published snapshot artifact), so the whole
 * language is testable without a database and behaves identically on both hosts.
 *
 * The pipeline, in order:
 *
 * 1. **Impose canonical document order first** — `finished` descending, ties by `id`
 *    ascending, absent timestamp last. Doing this before anything else is what makes
 *    floating-point summation bit-identical: two hosts that fold the same values in
 *    different orders can and do produce different last bits, and a published figure
 *    that disagrees with the console's by an ulp is a support question nobody can
 *    answer.
 * 2. **Filter**, giving `totalRuns` — always the unlimited count, so a `limit` never
 *    makes the denominator lie.
 * 3. **Aggregate** into buckets, or keep the documents.
 * 4. **Sort**, by the explicit stage when there is one and by the default otherwise.
 * 5. **Limit**, recording `truncated`.
 */
export function evaluate(
  docs: readonly GgRunDoc[],
  query: GgQuery,
): GgQueryResponse {
  const ordered = [...docs].sort(documentOrder);
  const matched = query.filter
    ? ordered.filter((doc) => matches(doc, query.filter as GgFilter))
    : ordered;
  const totalRuns = matched.length;
  const sort = query.sort ?? [];

  if (query.stats) {
    const { buckets, columns } = aggregate(matched, query.stats);
    sortBuckets(buckets, query.stats, sort);
    const truncated = truncate(buckets, query.limit);
    return { totalRuns, buckets, columns, documents: [], truncated };
  }

  const documents = [...matched];
  if (sort.length > 0) sortDocuments(documents, sort);
  const truncated = truncate(documents, query.limit);
  return { totalRuns, documents, buckets: [], columns: [], truncated };
}

/**
 * The canonical document order: most recently finished first, ties broken by id
 * ascending, and a document with no `finished` timestamp last **whichever direction
 * the rest is going** — an unfinished or unparseable run is not "infinitely old", it is
 * unplaced, and putting it at the top of every default listing would be actively
 * misleading.
 */
function documentOrder(a: GgRunDoc, b: GgRunDoc): number {
  const fa = numberOf(get(a, "finished"));
  const fb = numberOf(get(b, "finished"));
  let byTime = 0;
  if (fa !== undefined && fb !== undefined) byTime = compareNumbers(fb, fa);
  else if (fa !== undefined) byTime = -1;
  else if (fb !== undefined) byTime = 1;
  return byTime !== 0 ? byTime : compareCodePoints(docId(a), docId(b));
}

/** `asNumber` lifted over an absent field. */
function numberOf(value: GgValue | undefined): number | undefined {
  return value === undefined ? undefined : asNumber(value);
}

/** Truncate `rows` to `limit` in place, reporting whether anything was cut. */
function truncate(rows: unknown[], limit: number | undefined): boolean {
  if (limit === undefined || limit === null) return false;
  if (rows.length <= limit) return false;
  rows.length = limit;
  return true;
}

// --- filtering ---------------------------------------------------------------

/**
 * Whether `doc` passes `filter`.
 *
 * The one rule worth restating at every call site: **absent means absent**. A missing
 * key fails `compare` (all six operators, `ne` included), `oneOf` and `range`; `not` is
 * the only way to ask about absence. That bluntness is deliberate — the alternative,
 * which an earlier draft carried, was to let a boolean compared against `false` also
 * match an absent field, and it conflated "configured and off", "never mentioned" and
 * "the block is missing entirely" while quietly changing every average's denominator.
 */
export function matches(doc: GgRunDoc, filter: GgFilter): boolean {
  switch (filter.kind) {
    case "and":
      return filter.clauses.every((clause) => matches(doc, clause));
    case "or":
      return filter.clauses.some((clause) => matches(doc, clause));
    case "not":
      return !matches(doc, filter.clause);
    case "exists":
      return get(doc, filter.field) !== undefined;
    case "compare": {
      const observed = get(doc, filter.field);
      return observed === undefined
        ? false
        : compare(observed, filter.op, filter.value);
    }
    case "oneOf": {
      const observed = get(doc, filter.field);
      if (observed === undefined) return false;
      return filter.values.some((value) => compare(observed, "eq", value));
    }
    case "range": {
      const observed = get(doc, filter.field);
      if (observed === undefined) return false;
      if (filter.from !== undefined && !compare(observed, "gte", filter.from)) {
        return false;
      }
      if (filter.to !== undefined && !compare(observed, "lte", filter.to)) {
        return false;
      }
      return true;
    }
    case "text":
      return freeText(doc, filter.text);
  }
}

/**
 * Whether any **string-valued** field of `doc` contains `needle`, case-insensitively.
 *
 * Only string fields: a bare term in the query bar is a *word*, and letting it match
 * the decimal spelling of a cost or a timestamp would make free text unpredictable in
 * exactly the corpus where it is reached for.
 */
function freeText(doc: GgRunDoc, needle: string): boolean {
  const lowered = needle.toLowerCase();
  for (const value of Object.values(doc.fields)) {
    if (typeof value === "string" && value.toLowerCase().includes(lowered)) {
      return true;
    }
  }
  return false;
}

/**
 * Compare an observed value against a query literal.
 *
 * Kinds are reconciled toward the **observed** value, not the literal, because the
 * document is the ground truth and the literal is whatever the source text spelled:
 * `cap.compaction:false` reads the same on a stored boolean as `state:"completed"` does
 * on a stored string, and `metric.cost > "0.5"` still compares numerically. A literal
 * that cannot be read as the observed kind falls back to comparing string renderings,
 * which is the only remaining answer that is not simply "no".
 */
function compare(
  observed: GgValue,
  op: GgCompareOp,
  literal: GgValue,
): boolean {
  switch (op) {
    case "eq":
      return equals(observed, literal);
    case "ne":
      return !equals(observed, literal);
    case "gt":
      return ordering(observed, literal) > 0;
    case "gte":
      return ordering(observed, literal) >= 0;
    case "lt":
      return ordering(observed, literal) < 0;
    case "lte":
      return ordering(observed, literal) <= 0;
  }
}

/**
 * `:`-equality: numeric when both sides read as numbers, otherwise a
 * **case-insensitive** string comparison in which `*` in the literal matches any run of
 * characters.
 *
 * Globbing is what makes `model:"anthropic/*"` a first-class prefix search without
 * adding a second equality operator to reach for — there is exactly one, so there is
 * never a question of which one a query meant.
 */
function equals(observed: GgValue, literal: GgValue): boolean {
  const a = asNumber(observed);
  const b = coerceNumber(observed, literal);
  if (a !== undefined && b !== undefined) return a === b;
  const pattern = asDisplay(literal).toLowerCase();
  const value = asDisplay(observed).toLowerCase();
  return pattern.includes("*") ? globMatches(pattern, value) : pattern === value;
}

/**
 * The ordering between an observed value and a literal: numeric when both read as
 * numbers, and otherwise **by Unicode code point** over their string renderings — the
 * same total order bucket keys use, and the second place (after bucket keys) where
 * JavaScript's own string comparison would silently disagree with Rust above the BMP.
 */
function ordering(observed: GgValue, literal: GgValue): number {
  const a = asNumber(observed);
  const b = coerceNumber(observed, literal);
  if (a !== undefined && b !== undefined) return compareNumbers(a, b);
  return compareCodePoints(asDisplay(observed), asDisplay(literal));
}

/**
 * The grammar Rust's `str::parse::<f64>` accepts, restricted to the finite forms.
 *
 * JavaScript's `Number()` is markedly more permissive — it reads `""` as `0`, `"0x10"`
 * as `16` and `"1_0"` as `NaN` where Rust rejects the first two outright — so coercion
 * has to be gated on an explicit shape or `metric.cost >= ""` would quietly become
 * `>= 0`. Rust also accepts `inf`/`nan` spellings, but those are filtered by the
 * finiteness check either way.
 */
const RUST_FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * The padding Rust's `str::trim` strips, spelled out: the Unicode `White_Space`
 * property, which is what `char::is_whitespace` tests.
 *
 * Neither `String.prototype.trim()` nor `\s` is that set, and they differ from it at
 * *both* ends. ECMAScript strips U+FEFF, a byte-order mark, which has
 * `White_Space=No` and which Rust therefore leaves in place; and it does not strip
 * U+0085 (NEL), which Rust does. A literal pasted with a leading BOM — the ordinary way
 * one arrives, off a spreadsheet cell or a UTF-8-signed file — would otherwise coerce to
 * a number in the browser and refuse to on the backend, so `metric.cost:"\uFEFF2"`
 * would match on the console and not on the published site. Both answers look
 * plausible, which is what makes it the worst kind of parity break.
 */
const WHITE_SPACE = "\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
const RUST_WHITESPACE = new RegExp(
  `^[${WHITE_SPACE}]+|[${WHITE_SPACE}]+$`,
  "g",
);

/**
 * Read `literal` as a number **for comparison against a numeric `observed`**: a number
 * or boolean projects directly, and a string is parsed only when the observed side is
 * itself numeric, so a genuinely textual field never starts comparing numerically
 * because one of its values happened to look like a figure.
 */
function coerceNumber(
  observed: GgValue,
  literal: GgValue,
): number | undefined {
  if (asNumber(observed) === undefined) return undefined;
  if (typeof literal === "string") {
    const trimmed = literal.replace(RUST_WHITESPACE, "");
    if (!RUST_FLOAT.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return asNumber(literal);
}

/**
 * Match a lowercased `*`-glob against a lowercased value.
 *
 * A deliberately tiny matcher — `*` only, no `?` and no character classes — walked
 * greedily with one backtrack point, so it is linear in practice and trivially
 * reproducible on both hosts. Compiling to a regular expression would drag two
 * different regex dialects (and two different escaping rules) into a mirrored evaluator
 * for no expressive gain.
 *
 * Walks **code points**, matching Rust's `chars()`, so an astral character is one unit
 * on both sides and `*` cannot split a surrogate pair.
 */
export function globMatches(pattern: string, value: string): boolean {
  const p = Array.from(pattern);
  const v = Array.from(value);
  let pi = 0;
  let vi = 0;
  // Where to resume if the `*` most recently entered turns out to have consumed too
  // little of the value.
  let star = -1;
  let starValue = 0;
  while (vi < v.length) {
    if (pi < p.length && p[pi] === "*") {
      star = pi;
      starValue = vi;
      pi += 1;
    } else if (pi < p.length && p[pi] === v[vi]) {
      pi += 1;
      vi += 1;
    } else if (star >= 0) {
      pi = star + 1;
      vi = starValue + 1;
      starValue += 1;
    } else {
      return false;
    }
  }
  return p.slice(pi).every((c) => c === "*");
}

// --- aggregation -------------------------------------------------------------

/** Group the matched documents and fold each requested aggregation over every bucket. */
function aggregate(
  docs: readonly GgRunDoc[],
  stats: GgStatsStage,
): { buckets: GgBucket[]; columns: GgAggColumn[] } {
  const keys = (stats.groupBy ?? []).slice(0, GG_MAX_GROUP_KEYS);

  // Grouped under the composite key's encoding, then emitted in key order — Rust
  // groups into a `BTreeMap`, and matching that pre-order keeps the two folds
  // summing in the same sequence even before the final ordering is imposed.
  const groups = new Map<
    string,
    { key: (GgValue | undefined)[]; rows: GgRunDoc[] }
  >();
  for (const doc of docs) {
    const key = keys.map((k) => groupValue(doc, k));
    const encoded = encodeKey(key);
    const existing = groups.get(encoded);
    if (existing) existing.rows.push(doc);
    else groups.set(encoded, { key, rows: [doc] });
  }

  const columns: GgAggColumn[] = stats.aggs.map((agg) => ({
    name: aggName(agg),
    func: agg.func,
    ...(agg.field === undefined ? {} : { field: agg.field }),
  }));

  const buckets = [...groups.values()]
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ key, rows }) => ({
      key: keys.map((k, i): GgBucketKeyPart => {
        const value = key[i];
        return value === undefined
          ? { field: groupField(k) }
          : { field: groupField(k), value };
      }),
      n: rows.length,
      values: stats.aggs.map((agg) => fold(rows, agg)),
    }));

  return { buckets, columns };
}

/** The field a group key groups on — its name in a bucket key part, and what a `sort`
 *  stage binds to. */
function groupField(key: GgGroupKey): string {
  return key.field;
}

/**
 * The bucket key one document contributes for one group-by key: the field's value, or
 * its interval floor for a date histogram. A document lacking the field contributes
 * `undefined` and buckets under absence, which keeps it *visible* rather than silently
 * dropping it out of the totals.
 */
function groupValue(doc: GgRunDoc, key: GgGroupKey): GgValue | undefined {
  if (key.kind === "field") return get(doc, key.field);
  const ms = numberOf(get(doc, key.field));
  if (ms === undefined) return undefined;
  return intervalFloor(key.interval, ms);
}

/**
 * A string that identifies a composite bucket key, standing in for Rust's
 * `BTreeMap<KeyVec, _>`.
 *
 * Each component is length-prefixed, because a plain separator is not safe: a string
 * value may contain any character at all, so `["ab", "c"]` and `["a", "bc"]` have to
 * stay distinguishable however they are joined. Getting that wrong would silently
 * *merge two buckets* on one host only, which is exactly the class of drift this file
 * exists to avoid.
 */
function encodeKey(key: readonly (GgValue | undefined)[]): string {
  let encoded = "";
  for (const value of key) {
    const part = value === undefined ? "-" : `+${valueKey(value)}`;
    encoded += `${part.length}:${part}`;
  }
  return encoded;
}

/**
 * Compare two composite keys component by component, with an **absent component after
 * every present one** — so the "documents that lack this field" bucket lands at the end
 * of a key-ordered result rather than in the middle of it.
 */
function compareKeys(
  a: readonly (GgValue | undefined)[],
  b: readonly (GgValue | undefined)[],
): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const x = a[i];
    const y = b[i];
    let ord = 0;
    if (x !== undefined && y !== undefined) ord = totalCompare(x, y);
    else if (x !== undefined) ord = -1;
    else if (y !== undefined) ord = 1;
    if (ord !== 0) return ord;
  }
  return a.length - b.length;
}

/** Fold one aggregation over one bucket's documents. */
function fold(
  rows: readonly GgRunDoc[],
  agg: GgAgg,
): GgBucket["values"][number] {
  const name = aggName(agg);
  if (agg.func === "count") {
    return { name, value: rows.length, contributing: rows.length };
  }

  const field = agg.field;
  if (field === undefined) {
    // A non-`count` aggregation with no field has nothing to fold. The compiler
    // rejects this, so reaching it means a hand-built query; report an empty column
    // rather than guessing at a field.
    return { name, contributing: 0 };
  }

  if (agg.func === "distinct") {
    const seen = new Set<string>();
    let contributing = 0;
    for (const doc of rows) {
      const value = get(doc, field);
      if (value === undefined) continue;
      contributing += 1;
      seen.add(valueKey(value));
    }
    return { name, value: seen.size, contributing };
  }

  const values: number[] = [];
  for (const doc of rows) {
    const value = get(doc, field);
    if (value === undefined) continue;
    const n = asNumber(value);
    if (n !== undefined) values.push(n);
  }
  const contributing = values.length;
  if (contributing === 0) {
    // An empty fold is **absent, not zero** — including for `sum`. A bucket in which
    // nothing carried the field did not sum to zero; it has no answer, and a chart
    // that drew a zero bar there would invent a measurement.
    return { name, contributing: 0 };
  }

  switch (agg.func) {
    case "avg":
      return { name, value: sum(values) / values.length, contributing };
    case "sum":
      return { name, value: sum(values), contributing };
    case "min":
      return { name, value: values.reduce((a, b) => Math.min(a, b)), contributing };
    case "max":
      return { name, value: values.reduce((a, b) => Math.max(a, b)), contributing };
    case "median":
    case "p90":
    case "p95": {
      values.sort(compareNumbers);
      const q = agg.func === "median" ? 0.5 : agg.func === "p90" ? 0.9 : 0.95;
      return { name, value: quantile(values, q), contributing };
    }
    case "dist": {
      values.sort(compareNumbers);
      return {
        name,
        // A distribution reduces to no single number without choosing one, so the
        // scalar cell stays absent and every figure is read off `distribution`.
        contributing,
        distribution: {
          n: values.length,
          min: values[0]!,
          q1: quantile(values, 0.25),
          median: quantile(values, 0.5),
          q3: quantile(values, 0.75),
          max: values[values.length - 1]!,
          mean: sum(values) / values.length,
        },
      };
    }
    default:
      return { name, contributing: 0 };
  }
}

/** Sum in input order — the order the canonical document order fixed, which is what
 *  makes the last bit of a floating-point total reproducible across hosts. */
function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

// --- ordering ----------------------------------------------------------------

/**
 * Order the buckets: by an explicit `sort` stage when there is one, and otherwise by
 * the default — **count descending, except when the first group key is a date
 * histogram, where it is key ascending**.
 *
 * The exception is not a nicety. A time bucket has an intrinsic order and "largest
 * bucket first" is meaningless for it; a line chart connects its points in input order,
 * so a count-descending histogram draws a zigzag rather than a time series.
 */
function sortBuckets(
  buckets: GgBucket[],
  stats: GgStatsStage,
  sort: readonly GgSortKey[],
): void {
  if (sort.length > 0) {
    buckets.sort((a, b) => bucketSort(a, b, sort));
    return;
  }
  const chronological = (stats.groupBy ?? [])[0]?.kind === "bucket";
  if (chronological) {
    buckets.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  } else {
    buckets.sort(
      (a, b) => b.n - a.n || compareKeys(keyOf(a), keyOf(b)),
    );
  }
}

/** A bucket's composite key as a comparable component list. */
function keyOf(bucket: GgBucket): (GgValue | undefined)[] {
  return bucket.key.map((part) => part.value);
}

/**
 * Compare two buckets under an explicit `sort` stage. A key names either a group key's
 * field or an aggregation's column name; an unknown name resolves to absent on both
 * sides and is a no-op rather than an error, so a saved dashboard whose column was
 * renamed degrades to the default order instead of failing.
 */
function bucketSort(
  a: GgBucket,
  b: GgBucket,
  sort: readonly GgSortKey[],
): number {
  for (const key of sort) {
    const ord = compareOptional(
      bucketSortValue(a, key.field),
      bucketSortValue(b, key.field),
      key.desc,
    );
    if (ord !== 0) return ord;
  }
  return compareKeys(keyOf(a), keyOf(b));
}

/** The value a bucket sorts by for one sort key: a group key's value first, then an
 *  aggregation column's figure. */
function bucketSortValue(
  bucket: GgBucket,
  field: string,
): GgValue | undefined {
  const part = bucket.key.find((p) => p.field === field);
  if (part) return part.value;
  const column = bucket.values.find((value) => value.name === field);
  return column?.value;
}

/** Order documents under an explicit `sort` stage, falling back to the canonical
 *  document order as the tiebreak so the result is total. */
function sortDocuments(docs: GgRunDoc[], sort: readonly GgSortKey[]): void {
  docs.sort((a, b) => {
    for (const key of sort) {
      const ord = compareOptional(
        get(a, key.field),
        get(b, key.field),
        key.desc,
      );
      if (ord !== 0) return ord;
    }
    return documentOrder(a, b);
  });
}

/**
 * Compare two optional values for a sort key: present values by the total order,
 * reversed for a descending key — and an **absent value last in both directions**,
 * because "no value" is not an extreme, it is unplaced. Reversing it with the direction
 * would put the runs with nothing to say at the top of a descending sort, which is
 * precisely where a reader is looking for the most of something.
 */
function compareOptional(
  a: GgValue | undefined,
  b: GgValue | undefined,
  desc: boolean,
): number {
  if (a !== undefined && b !== undefined) {
    const ord = totalCompare(a, b);
    return desc ? -ord : ord;
  }
  if (a !== undefined) return -1;
  if (b !== undefined) return 1;
  return 0;
}

// --- the field catalog -------------------------------------------------------

/** The per-field accumulator behind {@link fieldCatalog}. */
interface FieldStats {
  documents: number;
  strings: boolean;
  numbers: boolean;
  booleans: boolean;
  /** Distinct observed values, keyed by their total-order encoding so `-0` and `0`
   *  stay apart exactly as they do in Rust's `BTreeMap<OrdValue, _>`. */
  values: Map<string, { value: GgValue; count: number }>;
}

/**
 * Derive the field catalog from a corpus — **the second mirrored function**.
 *
 * The union of the documents' keys *is* the field list and the observed values *are*
 * the value suggestions, which is what keeps the field side open: a number a feature
 * newly emits shows up in autocomplete with a document count, no registration anywhere.
 * A drift between the two implementations here is a one-host-only autocomplete
 * regression — far quieter than a wrong number — so the conformance fixture pins this
 * too.
 */
export function fieldCatalog(docs: readonly GgRunDoc[]): GgFieldCatalog {
  const fields = new Map<string, FieldStats>();
  for (const doc of docs) {
    for (const [name, value] of Object.entries(doc.fields)) {
      let stats = fields.get(name);
      if (!stats) {
        stats = {
          documents: 0,
          strings: false,
          numbers: false,
          booleans: false,
          values: new Map(),
        };
        fields.set(name, stats);
      }
      stats.documents += 1;
      if (typeof value === "string") stats.strings = true;
      else if (typeof value === "number") stats.numbers = true;
      else stats.booleans = true;
      const key = valueKey(value);
      const seen = stats.values.get(key);
      if (seen) seen.count += 1;
      else stats.values.set(key, { value, count: 1 });
    }
  }

  const names = [...fields.keys()].sort(compareCodePoints);
  return {
    documents: docs.length,
    fields: names.map((name): GgFieldInfo => {
      const stats = fields.get(name) as FieldStats;
      const topValues = topValuesOf(stats);
      return {
        name,
        kind: fieldKind(name, stats),
        documents: stats.documents,
        ...(topValues.length === 0 ? {} : { topValues }),
      };
    }),
  };
}

/**
 * A field's kind. Derived from the observed values, except that a known date field
 * carrying numbers is a `date` — date-ness cannot be observed, because rule 6 makes a
 * date *be* a number.
 */
function fieldKind(name: string, stats: FieldStats): GgFieldKind {
  const { strings, numbers, booleans } = stats;
  if (strings && !numbers && !booleans) return "string";
  if (!strings && numbers && !booleans) {
    return GG_DATE_FIELDS.includes(name) ? "date" : "number";
  }
  if (!strings && !numbers && booleans) return "boolean";
  return "mixed";
}

/** The most common values, count descending with ties broken by the total order so the
 *  list is stable across hosts, capped at `GG_FIELD_TOP_VALUES`. */
function topValuesOf(stats: FieldStats): GgFieldValueCount[] {
  return [...stats.values.values()]
    .sort((a, b) => b.count - a.count || totalCompare(a.value, b.value))
    .slice(0, GG_FIELD_TOP_VALUES)
    .map(({ value, count }) => ({ value, count }));
}
