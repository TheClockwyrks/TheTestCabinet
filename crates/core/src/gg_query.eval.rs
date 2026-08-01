//! The **evaluator** — the authoritative half of the mirrored pair.
//!
//! Everything here has a TypeScript twin that must produce identical output for the
//! same corpus, because the console evaluates on the backend and the public static
//! site evaluates in the browser with no backend at all. The
//! `gg_query.conformance.json` fixture beside this module's test is what holds the two
//! together; **a change to any rule below must arrive with a fixture case that would
//! have caught the drift.**

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use super::{
    GG_DATE_FIELDS, GG_FIELD_TOP_VALUES, GG_MAX_GROUP_KEYS, GgAgg, GgAggColumn, GgAggFunc,
    GgAggValue, GgBucket, GgBucketKeyPart, GgCompareOp, GgDistribution, GgFieldCatalog,
    GgFieldInfo, GgFieldKind, GgFieldValueCount, GgFilter, GgGroupKey, GgQuery, GgQueryResponse,
    GgRunDoc, GgSortKey, GgStatsStage, GgValue,
};
use crate::comparison_stats::quantile;

/// A [`GgValue`] under its [total order](GgValue::total_cmp), so it can key an ordered
/// map or a set.
///
/// `GgValue` itself cannot derive `Ord`/`Eq` because it carries an `f64`. Rather than
/// weaken the value type, the total order is attached here — and it is *the same*
/// order everywhere it matters (bucket keys, distinct counts, sort tiebreaks, the
/// catalog's top-value ties), which is what stops "group by model" and "how many
/// models?" from ever disagreeing about whether two values are the same one.
#[derive(Debug, Clone)]
struct OrdValue(GgValue);

impl PartialEq for OrdValue {
    fn eq(&self, other: &Self) -> bool {
        self.0.total_cmp(&other.0) == Ordering::Equal
    }
}

impl Eq for OrdValue {}

impl Ord for OrdValue {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0)
    }
}

impl PartialOrd for OrdValue {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// A composite bucket key.
///
/// Ordered component by component, with an **absent component after every present
/// one** — so the "documents that lack this field" bucket lands at the end of a
/// key-ordered result rather than in the middle of it. `Option`'s own ordering would
/// put `None` first, which is the opposite of what a reader expects from a bucket
/// table whose interesting rows are the ones with values.
#[derive(Debug, Clone, PartialEq, Eq)]
struct KeyVec(Vec<Option<OrdValue>>);

impl Ord for KeyVec {
    fn cmp(&self, other: &Self) -> Ordering {
        for (a, b) in self.0.iter().zip(&other.0) {
            let ord = match (a, b) {
                (Some(a), Some(b)) => a.cmp(b),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => Ordering::Equal,
            };
            if ord != Ordering::Equal {
                return ord;
            }
        }
        self.0.len().cmp(&other.0.len())
    }
}

impl PartialOrd for KeyVec {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Run a compiled [query](GgQuery) over a corpus of [documents](GgRunDoc).
///
/// A pure fold: the caller supplies the documents (the backend from its in-memory
/// index, the static site from the published snapshot artifact), so the whole language
/// is testable without a database and behaves identically on both hosts.
///
/// The pipeline, in order:
///
/// 1. **Impose canonical document order first** — `finished` descending, ties by `id`
///    ascending, absent timestamp last. Doing this before anything else is what makes
///    floating-point summation bit-identical: two hosts that fold the same values in
///    different orders can and do produce different last bits, and a published figure
///    that disagrees with the console's by an ulp is a support question nobody can
///    answer.
/// 2. **Filter**, giving [`total_runs`](GgQueryResponse::total_runs) — always the
///    unlimited count, so a `limit` never makes the denominator lie.
/// 3. **Aggregate** into buckets, or keep the documents.
/// 4. **Sort**, by the explicit stage when there is one and by the default order
///    otherwise.
/// 5. **Limit**, recording [`truncated`](GgQueryResponse::truncated).
pub fn evaluate(docs: &[GgRunDoc], query: &GgQuery) -> GgQueryResponse {
    let mut ordered: Vec<&GgRunDoc> = docs.iter().collect();
    ordered.sort_by(|a, b| document_order(a, b));

    let matched: Vec<&GgRunDoc> = ordered
        .into_iter()
        .filter(|doc| match &query.filter {
            Some(filter) => matches(doc, filter),
            None => true,
        })
        .collect();
    let total_runs = matched.len() as u64;

    match &query.stats {
        Some(stats) => {
            let (mut buckets, columns) = aggregate(&matched, stats);
            sort_buckets(&mut buckets, stats, &query.sort);
            let truncated = truncate(&mut buckets, query.limit);
            GgQueryResponse {
                total_runs,
                documents: Vec::new(),
                buckets,
                columns,
                truncated,
            }
        }
        None => {
            let mut documents: Vec<GgRunDoc> = matched.into_iter().cloned().collect();
            if !query.sort.is_empty() {
                sort_documents(&mut documents, &query.sort);
            }
            let truncated = truncate(&mut documents, query.limit);
            GgQueryResponse {
                total_runs,
                documents,
                buckets: Vec::new(),
                columns: Vec::new(),
                truncated,
            }
        }
    }
}

/// The canonical document order: most recently finished first, ties broken by id
/// ascending, and a document with no `finished` timestamp last **whichever direction
/// the rest is going** — an unfinished or unparseable run is not "infinitely old", it
/// is unplaced, and putting it at the top of every default listing would be actively
/// misleading.
fn document_order(a: &GgRunDoc, b: &GgRunDoc) -> Ordering {
    let fa = a.get("finished").and_then(GgValue::as_number);
    let fb = b.get("finished").and_then(GgValue::as_number);
    let by_time = match (fa, fb) {
        (Some(x), Some(y)) => y.total_cmp(&x),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    };
    by_time.then_with(|| a.id().as_bytes().cmp(b.id().as_bytes()))
}

/// Truncate `rows` to `limit`, reporting whether anything was cut.
fn truncate<T>(rows: &mut Vec<T>, limit: Option<u32>) -> bool {
    let Some(limit) = limit else {
        return false;
    };
    let limit = limit as usize;
    if rows.len() <= limit {
        return false;
    }
    rows.truncate(limit);
    true
}

// --- filtering ---------------------------------------------------------------

/// Whether `doc` passes `filter`.
///
/// The one rule worth restating at every call site:
/// [**absent means absent**](crate::gg_query#the-seven-semantic-rules). A missing key
/// fails `Compare` (all six operators, `!=` included), `OneOf` and `Range`; `Not` is
/// the only way to ask about absence. That bluntness is deliberate — the alternative,
/// which an earlier draft carried, was to let a boolean compared against `false` also
/// match an absent field, and it conflated "configured and off", "never mentioned" and
/// "the block is missing entirely" while quietly changing every average's denominator.
fn matches(doc: &GgRunDoc, filter: &GgFilter) -> bool {
    match filter {
        GgFilter::And { clauses } => clauses.iter().all(|c| matches(doc, c)),
        GgFilter::Or { clauses } => clauses.iter().any(|c| matches(doc, c)),
        GgFilter::Not { clause } => !matches(doc, clause),
        GgFilter::Exists { field } => doc.get(field).is_some(),
        GgFilter::Compare { field, op, value } => match doc.get(field) {
            Some(observed) => compare(observed, *op, value),
            None => false,
        },
        GgFilter::OneOf { field, values } => match doc.get(field) {
            Some(observed) => values
                .iter()
                .any(|value| compare(observed, GgCompareOp::Eq, value)),
            None => false,
        },
        GgFilter::Range { field, from, to } => match doc.get(field) {
            Some(observed) => {
                from.as_ref()
                    .is_none_or(|bound| compare(observed, GgCompareOp::Gte, bound))
                    && to
                        .as_ref()
                        .is_none_or(|bound| compare(observed, GgCompareOp::Lte, bound))
            }
            None => false,
        },
        GgFilter::Text { text } => free_text(doc, text),
    }
}

/// Whether any string-valued field of `doc` contains `needle`, case-insensitively.
///
/// Only string fields: a bare term in the query bar is a *word*, and letting it match
/// the decimal spelling of a cost or a timestamp would make free text unpredictable in
/// exactly the corpus where it is reached for.
fn free_text(doc: &GgRunDoc, needle: &str) -> bool {
    let needle = needle.to_lowercase();
    doc.fields.values().any(|value| match value {
        GgValue::String(s) => s.to_lowercase().contains(&needle),
        GgValue::Bool(_) | GgValue::Number(_) => false,
    })
}

/// Compare an observed value against a query literal.
///
/// Kinds are reconciled toward the **observed** value, not the literal, because the
/// document is the ground truth and the literal is whatever the source text spelled:
/// `cap.compaction:false` reads the same on a stored boolean as `state:"completed"`
/// does on a stored string, and `metric.cost > "0.5"` still compares numerically. A
/// literal that cannot be read as the observed kind falls back to comparing string
/// renderings, which is the only remaining answer that is not simply "no".
fn compare(observed: &GgValue, op: GgCompareOp, literal: &GgValue) -> bool {
    match op {
        GgCompareOp::Eq => equals(observed, literal),
        GgCompareOp::Ne => !equals(observed, literal),
        GgCompareOp::Gt => ordering(observed, literal).is_gt(),
        GgCompareOp::Gte => ordering(observed, literal).is_ge(),
        GgCompareOp::Lt => ordering(observed, literal).is_lt(),
        GgCompareOp::Lte => ordering(observed, literal).is_le(),
    }
}

/// `:`-equality: numeric when both sides read as numbers, otherwise a
/// **case-insensitive** string comparison in which `*` in the literal matches any run
/// of characters.
///
/// Globbing is what makes `model:"anthropic/*"` a first-class prefix search without
/// adding a second equality operator to reach for — there is exactly one, so there is
/// never a question of which one a query meant.
fn equals(observed: &GgValue, literal: &GgValue) -> bool {
    if let (Some(a), Some(b)) = (observed.as_number(), coerce_number(observed, literal)) {
        return a == b;
    }
    let pattern = literal.as_display().to_lowercase();
    let value = observed.as_display().to_lowercase();
    if pattern.contains('*') {
        glob_matches(&pattern, &value)
    } else {
        pattern == value
    }
}

/// The ordering between an observed value and a literal: numeric when both read as
/// numbers, and otherwise by Unicode code point over their string renderings, which is
/// the same total order bucket keys use.
fn ordering(observed: &GgValue, literal: &GgValue) -> Ordering {
    if let (Some(a), Some(b)) = (observed.as_number(), coerce_number(observed, literal)) {
        return a.total_cmp(&b);
    }
    observed
        .as_display()
        .as_bytes()
        .cmp(literal.as_display().as_bytes())
}

/// Read `literal` as a number **for comparison against a numeric `observed`**: a
/// number or boolean projects directly, and a string is parsed only when the observed
/// side is itself numeric, so a genuinely textual field never starts comparing
/// numerically because one of its values happened to look like a figure.
fn coerce_number(observed: &GgValue, literal: &GgValue) -> Option<f64> {
    observed.as_number()?;
    match literal {
        GgValue::String(s) => s.trim().parse::<f64>().ok().filter(|n| n.is_finite()),
        other => other.as_number(),
    }
}

/// Match a lowercased `*`-glob against a lowercased value.
///
/// A deliberately tiny matcher — `*` only, no `?` and no character classes — walked
/// greedily with one backtrack point, so it is linear in practice and trivially
/// reproducible in TypeScript. Compiling to a regular expression would drag two
/// different regex dialects (and two different escaping rules) into a mirrored
/// evaluator for no expressive gain.
fn glob_matches(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let value: Vec<char> = value.chars().collect();
    let (mut p, mut v) = (0usize, 0usize);
    // Where to resume if the `*` most recently entered turns out to have consumed too
    // little of the value.
    let mut star: Option<(usize, usize)> = None;
    while v < value.len() {
        if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, v));
            p += 1;
        } else if p < pattern.len() && pattern[p] == value[v] {
            p += 1;
            v += 1;
        } else if let Some((sp, sv)) = star {
            p = sp + 1;
            v = sv + 1;
            star = Some((sp, sv + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

// --- aggregation -------------------------------------------------------------

/// Group the matched documents and fold each requested aggregation over every bucket.
fn aggregate(docs: &[&GgRunDoc], stats: &GgStatsStage) -> (Vec<GgBucket>, Vec<GgAggColumn>) {
    let keys: &[GgGroupKey] = if stats.group_by.len() > GG_MAX_GROUP_KEYS {
        &stats.group_by[..GG_MAX_GROUP_KEYS]
    } else {
        &stats.group_by
    };

    // A `BTreeMap` keyed on the composite key, so grouping is deterministic before the
    // final ordering is imposed.
    let mut groups: BTreeMap<KeyVec, Vec<&GgRunDoc>> = BTreeMap::new();
    for doc in docs {
        let key = KeyVec(keys.iter().map(|key| group_value(doc, key)).collect());
        groups.entry(key).or_default().push(doc);
    }

    let columns: Vec<GgAggColumn> = stats
        .aggs
        .iter()
        .map(|agg| GgAggColumn {
            name: agg.name(),
            func: agg.func,
            field: agg.field.clone(),
        })
        .collect();

    let buckets = groups
        .into_iter()
        .map(|(KeyVec(values), rows)| GgBucket {
            key: keys
                .iter()
                .zip(values)
                .map(|(key, value)| GgBucketKeyPart {
                    field: key.field().to_string(),
                    value: value.map(|v| v.0),
                })
                .collect(),
            n: rows.len() as u64,
            values: stats.aggs.iter().map(|agg| fold(&rows, agg)).collect(),
        })
        .collect();

    (buckets, columns)
}

/// The bucket key one document contributes for one group-by key: the field's value, or
/// its interval floor for a date histogram. A document lacking the field contributes
/// `None` and buckets under absence, which keeps it *visible* rather than silently
/// dropping it out of the totals.
fn group_value(doc: &GgRunDoc, key: &GgGroupKey) -> Option<OrdValue> {
    match key {
        GgGroupKey::Field { field } => doc.get(field).cloned().map(OrdValue),
        GgGroupKey::Bucket { field, interval } => {
            let ms = doc.get(field).and_then(GgValue::as_number)?;
            Some(OrdValue(GgValue::Number(interval.floor(ms as i64) as f64)))
        }
    }
}

/// Fold one aggregation over one bucket's documents.
fn fold(rows: &[&GgRunDoc], agg: &GgAgg) -> GgAggValue {
    let name = agg.name();
    if agg.func == GgAggFunc::Count {
        return GgAggValue {
            name,
            value: Some(rows.len() as f64),
            contributing: rows.len() as u64,
            distribution: None,
        };
    }

    let Some(field) = agg.field.as_deref() else {
        // A non-`count` aggregation with no field has nothing to fold. The TypeScript
        // compiler rejects this, so reaching it means a hand-built query; report an
        // empty column rather than guessing at a field.
        return GgAggValue {
            name,
            value: None,
            contributing: 0,
            distribution: None,
        };
    };

    if agg.func == GgAggFunc::Distinct {
        let mut seen: BTreeSet<OrdValue> = BTreeSet::new();
        let mut contributing = 0u64;
        for value in rows.iter().filter_map(|doc| doc.get(field)) {
            contributing += 1;
            seen.insert(OrdValue(value.clone()));
        }
        return GgAggValue {
            name,
            value: Some(seen.len() as f64),
            contributing,
            distribution: None,
        };
    }

    let mut values: Vec<f64> = rows
        .iter()
        .filter_map(|doc| doc.get(field))
        .filter_map(GgValue::as_number)
        .collect();
    let contributing = values.len() as u64;
    if values.is_empty() {
        // An empty fold is **absent, not zero** — including for `sum`. A bucket in
        // which nothing carried the field did not sum to zero; it has no answer, and a
        // chart that drew a zero bar there would invent a measurement.
        return GgAggValue {
            name,
            value: None,
            contributing: 0,
            distribution: None,
        };
    }

    match agg.func {
        GgAggFunc::Avg => GgAggValue {
            name,
            value: Some(values.iter().sum::<f64>() / values.len() as f64),
            contributing,
            distribution: None,
        },
        GgAggFunc::Sum => GgAggValue {
            name,
            value: Some(values.iter().sum()),
            contributing,
            distribution: None,
        },
        GgAggFunc::Min => GgAggValue {
            name,
            value: values.iter().copied().reduce(f64::min),
            contributing,
            distribution: None,
        },
        GgAggFunc::Max => GgAggValue {
            name,
            value: values.iter().copied().reduce(f64::max),
            contributing,
            distribution: None,
        },
        GgAggFunc::Median | GgAggFunc::P90 | GgAggFunc::P95 => {
            values.sort_by(f64::total_cmp);
            let q = match agg.func {
                GgAggFunc::Median => 0.5,
                GgAggFunc::P90 => 0.9,
                _ => 0.95,
            };
            GgAggValue {
                name,
                value: Some(quantile(&values, q)),
                contributing,
                distribution: None,
            }
        }
        GgAggFunc::Dist => {
            values.sort_by(f64::total_cmp);
            GgAggValue {
                name,
                // A distribution reduces to no single number without choosing one, so
                // the scalar cell stays absent and every figure is read off
                // `distribution`.
                value: None,
                contributing,
                distribution: Some(GgDistribution {
                    n: values.len() as u64,
                    min: values[0],
                    q1: quantile(&values, 0.25),
                    median: quantile(&values, 0.5),
                    q3: quantile(&values, 0.75),
                    max: values[values.len() - 1],
                    mean: values.iter().sum::<f64>() / values.len() as f64,
                }),
            }
        }
        GgAggFunc::Count | GgAggFunc::Distinct => unreachable!("handled above"),
    }
}

// --- ordering ----------------------------------------------------------------

/// Order the buckets: by an explicit `sort` stage when there is one, and otherwise by
/// the default — **count descending, except when the first group key is a date
/// histogram, where it is key ascending**.
///
/// The exception is not a nicety. A time bucket has an intrinsic order and "largest
/// bucket first" is meaningless for it; a line chart connects its points in input
/// order, so a count-descending histogram draws a zigzag rather than a time series.
fn sort_buckets(buckets: &mut [GgBucket], stats: &GgStatsStage, sort: &[GgSortKey]) {
    if !sort.is_empty() {
        buckets.sort_by(|a, b| bucket_sort(a, b, sort));
        return;
    }
    let chronological = matches!(stats.group_by.first(), Some(GgGroupKey::Bucket { .. }));
    if chronological {
        buckets.sort_by_key(key_of);
    } else {
        buckets.sort_by(|a, b| b.n.cmp(&a.n).then_with(|| key_of(a).cmp(&key_of(b))));
    }
}

/// A bucket's composite key as the comparable [`KeyVec`].
fn key_of(bucket: &GgBucket) -> KeyVec {
    KeyVec(
        bucket
            .key
            .iter()
            .map(|part| part.value.clone().map(OrdValue))
            .collect(),
    )
}

/// Compare two buckets under an explicit `sort` stage. A key names either a group key's
/// field or an aggregation's [column name](GgAgg::name); an unknown name resolves to
/// absent on both sides and is a no-op rather than an error, so a saved dashboard whose
/// column was renamed degrades to the default order instead of failing.
fn bucket_sort(a: &GgBucket, b: &GgBucket, sort: &[GgSortKey]) -> Ordering {
    for key in sort {
        let ord = compare_optional(
            bucket_sort_value(a, &key.field),
            bucket_sort_value(b, &key.field),
            key.desc,
        );
        if ord != Ordering::Equal {
            return ord;
        }
    }
    key_of(a).cmp(&key_of(b))
}

/// The value a bucket sorts by for one sort key: a group key's value first, then an
/// aggregation column's figure.
fn bucket_sort_value(bucket: &GgBucket, field: &str) -> Option<GgValue> {
    if let Some(part) = bucket.key.iter().find(|part| part.field == field) {
        return part.value.clone();
    }
    bucket
        .values
        .iter()
        .find(|value| value.name == field)
        .and_then(|value| value.value)
        .map(GgValue::Number)
}

/// Order documents under an explicit `sort` stage, falling back to the canonical
/// document order as the tiebreak so the result is total.
fn sort_documents(docs: &mut [GgRunDoc], sort: &[GgSortKey]) {
    docs.sort_by(|a, b| {
        for key in sort {
            let ord = compare_optional(
                a.get(&key.field).cloned(),
                b.get(&key.field).cloned(),
                key.desc,
            );
            if ord != Ordering::Equal {
                return ord;
            }
        }
        document_order(a, b)
    });
}

/// Compare two optional values for a sort key: present values by the
/// [total order](GgValue::total_cmp), reversed for a descending key — and an **absent
/// value last in both directions**, because "no value" is not an extreme, it is
/// unplaced. Reversing it with the direction would put the runs with nothing to say at
/// the top of a descending sort, which is precisely where a reader is looking for the
/// most of something.
fn compare_optional(a: Option<GgValue>, b: Option<GgValue>, desc: bool) -> Ordering {
    match (a, b) {
        (Some(a), Some(b)) => {
            let ord = a.total_cmp(&b);
            if desc { ord.reverse() } else { ord }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

// --- the field catalog -------------------------------------------------------

/// Derive the [field catalog](GgFieldCatalog) from a corpus — **the second mirrored
/// function**.
///
/// The union of the documents' keys *is* the field list and the observed values *are*
/// the value suggestions, which is what keeps the field side open: a number a feature
/// newly emits shows up in autocomplete with a document count, no registration
/// anywhere. A drift between the two implementations here is a one-host-only
/// autocomplete regression — far quieter than a wrong number — so the conformance
/// fixture pins this too.
pub fn field_catalog(docs: &[GgRunDoc]) -> GgFieldCatalog {
    // Ordered maps throughout, so the output is a pure function of the corpus rather
    // than of hash iteration order.
    let mut fields: BTreeMap<&str, FieldStats> = BTreeMap::new();
    for doc in docs {
        for (name, value) in &doc.fields {
            let stats = fields.entry(name.as_str()).or_default();
            stats.documents += 1;
            stats.observe(value);
            *stats.values.entry(OrdValue(value.clone())).or_default() += 1;
        }
    }

    GgFieldCatalog {
        documents: docs.len() as u64,
        fields: fields
            .into_iter()
            .map(|(name, stats)| GgFieldInfo {
                name: name.to_string(),
                kind: stats.kind(name),
                documents: stats.documents,
                top_values: stats.top_values(),
            })
            .collect(),
    }
}

/// The per-field accumulator behind [`field_catalog`].
#[derive(Default)]
struct FieldStats {
    documents: u64,
    strings: bool,
    numbers: bool,
    booleans: bool,
    values: BTreeMap<OrdValue, u64>,
}

impl FieldStats {
    fn observe(&mut self, value: &GgValue) {
        match value {
            GgValue::String(_) => self.strings = true,
            GgValue::Number(_) => self.numbers = true,
            GgValue::Bool(_) => self.booleans = true,
        }
    }

    /// The field's kind. Derived from the observed values, except that a
    /// [known date field](GG_DATE_FIELDS) carrying numbers is a
    /// [`Date`](GgFieldKind::Date) — date-ness cannot be observed, because
    /// [rule 6](crate::gg_query#the-seven-semantic-rules) makes a date *be* a number.
    fn kind(&self, name: &str) -> GgFieldKind {
        match (self.strings, self.numbers, self.booleans) {
            (true, false, false) => GgFieldKind::String,
            (false, true, false) => {
                if GG_DATE_FIELDS.contains(&name) {
                    GgFieldKind::Date
                } else {
                    GgFieldKind::Number
                }
            }
            (false, false, true) => GgFieldKind::Boolean,
            _ => GgFieldKind::Mixed,
        }
    }

    /// The most common values, count descending with ties broken by the
    /// [total order](GgValue::total_cmp) so the list is stable across hosts.
    fn top_values(self) -> Vec<GgFieldValueCount> {
        let mut values: Vec<(OrdValue, u64)> = self.values.into_iter().collect();
        values.sort_by(|(av, ac), (bv, bc)| bc.cmp(ac).then_with(|| av.cmp(bv)));
        values
            .into_iter()
            .take(GG_FIELD_TOP_VALUES)
            .map(|(value, count)| GgFieldValueCount {
                value: value.0,
                count,
            })
            .collect()
    }
}
