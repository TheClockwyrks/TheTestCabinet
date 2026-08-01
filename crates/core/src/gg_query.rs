//! **TCQ** — the gg analysis query language: the *compiled* query contract, the flat
//! [run document](GgRunDoc) it runs over, and the results it produces.
//!
//! Every gg run is reified as one flat map of dotted, typed field names to scalars
//! ([`GgRunDoc`], built by [`build_run_doc`]), and a query is a pipeline over that
//! corpus:
//!
//! ```text
//! <filter>                              → the runs that match
//! <filter> | stats <aggs> by <keys>     → aggregations over them
//! ```
//!
//! **Field resolution is a map lookup, not a `match` arm.** That single property is
//! the design: a number a feature newly emits onto the session summary is queryable,
//! chartable and groupable with no Rust change, no contract regeneration, and no
//! TypeScript label — which is what the closed facet/metric enum vocabulary this
//! module replaced could never offer. See the [design doc] for the full rationale.
//!
//! ## What lives where
//!
//! - **The parser, compiler, completer and formatter are TypeScript only.** They run
//!   on every keystroke to highlight tokens, underline an error span and answer "what
//!   can follow the caret", which a round trip to a compiled artifact cannot serve —
//!   and this crate does not compile to the browser anyway. The backend never parses
//!   query *text*: the client sends the compiled [`GgQuery`], which is the single wire
//!   form, while the URL and the saved object carry the source text.
//! - **The evaluator is mirrored** — authoritative here, twinned in TypeScript —
//!   because it must run on the backend for the console *and* in the browser for the
//!   public static site, which has no backend at all. Cross-implementation drift is
//!   this design's single largest risk, so it is bounded rather than trusted: the
//!   checked-in `gg_query.conformance.json` fixture (documents, queries, expected
//!   results, and the expected [field catalog](field_catalog)) is executed by **both**
//!   suites. **Any change to the semantics below must grow that fixture.**
//!
//! ## The seven semantic rules
//!
//! 1. **Absent means absent, with no exceptions.** A missing key fails every
//!    comparison — including [`Ne`](GgCompareOp::Ne) and one against `false` — and
//!    passes [`Not`](GgFilter::Not). The exception an earlier draft carried was
//!    dropped because it conflated "configured and off", "never mentioned" and "the
//!    block is missing entirely", and it made every average's denominator dishonest.
//!    Two things make it unnecessary: `cap.<id>` is **total** (the builder walks the
//!    whole [capability catalog](GG_CAPABILITY_CATALOG) and stores an explicit `false`
//!    for every capability a run did not enable, so `avg(cap.compaction)` is an honest
//!    enablement rate), and `tool.<name>` stays **sparse** on purpose (the tool
//!    universe is per-run, not a closed catalog, so "never offered this tool" is
//!    written explicitly as `not tool.edit_file` and the field sidebar shows each tool
//!    field's document count so the sparseness is *seen* rather than inferred).
//! 2. **`has.*` markers make denominators explicit.** A gg run that never ran a
//!    session has a capability set but no summary; a non-gg-shaped record has neither.
//!    Every honest rate query scopes on a marker, and every aggregate reports its
//!    [`contributing`](GgAggValue::contributing) count so an unscoped one is still
//!    legible.
//! 3. **Metrics are absent, never zero, on a run that produced nothing.** A failed
//!    record is built with default metrics; flattened naively a `timed_out` run would
//!    report zero run time and zero cost, dragging every average toward zero with
//!    *exactly the runs that burned the most budget*.
//! 4. **Arrays are never flattened positionally** — an array contributes only its
//!    length, under `<path>.count`. Consequence, binding on every other feature: **a
//!    field added to [`GgSessionSummary`](crate::gg::GgSessionSummary) must be a scalar
//!    or a map, never an array**, or it is silently unqueryable.
//! 5. **Booleans project to `1`/`0` in numeric context**, so averaging one is a rate.
//!    There is deliberately no `rate()` function.
//! 6. **Dates are numbers** — epoch milliseconds — so ranges, sorts and histograms
//!    need no date machinery in the evaluator. Everything is UTC.
//! 7. **Non-finite values are dropped at build time**, never stored.
//!
//! ## The seven determinism rules
//!
//! Pinned by the conformance fixture, because two implementations that disagree
//! publish different numbers for the same corpus:
//!
//! - **Document order** is `finished` descending, ties by `id` ascending, absent
//!   timestamp last — imposed *before* filtering so every fold iterates identically
//!   and floating-point summation is bit-identical.
//! - **Bucket order** defaults to count descending, **except** when the first group
//!   key is a [date histogram](GgGroupKey::Bucket), where it is key ascending: a time
//!   bucket has an intrinsic order, "largest bucket first" is meaningless for it, and
//!   a line chart connects points in input order, so a count-descending histogram
//!   draws a zigzag rather than a time series.
//! - **String comparison is by Unicode code point, and Rust is the reference.** Rust's
//!   ordering already *is* code-point order (UTF-8 byte order and code-point order
//!   coincide); the hazard is entirely on the TypeScript side, which must not use
//!   `<`, `>`, or locale collation — both disagree with code-point order above the
//!   BMP. The fixture carries an astral-plane case for exactly this.
//! - **Quantiles use one definition** — the repository's existing linearly
//!   interpolated [`quantile`](crate::comparison_stats::quantile), reused verbatim
//!   rather than reinvented, so gg's box plots match the comparison charts'.
//! - **Bucket alignment is UTC and explicit.** Minute, hour and day intervals floor
//!   against the epoch; **week intervals floor against a Monday**
//!   ([`WEEK_ORIGIN_MS`]), because the epoch was a Thursday and Thursday-to-Wednesday
//!   weeks read as a bug.
//! - **Distinct counts** use the same total order as bucket keys.
//! - **The engine never formats numbers.** Formatting is a UI concern.
//!
//! Regenerate the TypeScript/JSON-Schema bindings with `npm run gen:contract` after
//! any change here. JSON is camelCase.
//!
//! [design doc]: https://docs.testcabinet.ai/gg/analysis/query-language/

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[path = "gg_query.doc.rs"]
mod doc;

#[path = "gg_query.eval.rs"]
mod eval;

pub use doc::{GG_CAPABILITY_CATALOG, GG_DATE_FIELDS, GgDocLifecycle, build_run_doc, flatten_json};
pub use eval::{evaluate, field_catalog};

/// The most group-by keys one [`stats`](GgStatsStage) stage may carry. Visualizations
/// bind the first two; a third is table-only, and beyond that a bucket table is
/// unreadable and the cardinality explodes. The TypeScript compiler rejects a longer
/// list at parse time; [`evaluate`] clamps to the same bound so a hand-built query
/// cannot get further.
pub const GG_MAX_GROUP_KEYS: usize = 3;

/// How many distinct values [`field_catalog`] reports per field. The sidebar shows
/// these as click-to-insert value suggestions with their counts, so the list is a
/// *starting point*, not an enumeration — a high-cardinality field (a run id, a
/// timestamp) is not meant to be browsed value by value.
pub const GG_FIELD_TOP_VALUES: usize = 10;

/// One scalar in a [run document](GgRunDoc), and the literal side of every
/// [predicate](GgFilter).
///
/// Deliberately only three kinds: a document is *flat and typed*, so a number
/// compares numerically (`cap.compaction.summaryHeadroom > 0.5` works, which the
/// stringify-everything implementation this replaced could not express) and a boolean
/// projects to `1`/`0` so averaging it is a rate. There is no null variant — an
/// absent field is a **missing key**, never a stored null, which is what makes
/// [rule 1](crate::gg_query#the-seven-semantic-rules) enforceable by construction.
///
/// Serialized untagged, so the wire form is a bare JSON scalar and the TypeScript
/// binding is `string | number | boolean`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgValue {
    /// A boolean, projecting to `1.0`/`0.0` in numeric context.
    Bool(bool),
    /// A finite number. A **date is a number** — epoch milliseconds, UTC.
    Number(f64),
    /// A string. Compared case-insensitively by [`Eq`](GgCompareOp::Eq) (with `*`
    /// globs) and by Unicode code point when ordered.
    String(String),
}

impl GgValue {
    /// This value's numeric projection, or `None` when it has none: a boolean is
    /// `1.0`/`0.0` ([rule 5](crate::gg_query#the-seven-semantic-rules)), a finite number is
    /// itself, and a string has no numeric meaning even when it happens to look like
    /// one (a field's kind is a property of the corpus, not of one value's spelling).
    ///
    /// A non-finite number also answers `None` — [rule 7](crate::gg_query#the-seven-semantic-rules)
    /// keeps those out of a document in the first place, and this is the second line
    /// of defence for a document that arrived from somewhere else.
    pub fn as_number(&self) -> Option<f64> {
        match self {
            GgValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            GgValue::Number(n) if n.is_finite() => Some(*n),
            GgValue::Number(_) | GgValue::String(_) => None,
        }
    }

    /// This value's string rendering, used when a comparison crosses kinds and when a
    /// free-text term is matched. Numbers render through the shortest round-trip form
    /// (`1` rather than `1.0`) so a document value and a query literal spell the same
    /// number the same way in both implementations.
    pub fn as_display(&self) -> String {
        match self {
            GgValue::Bool(b) => b.to_string(),
            GgValue::Number(n) => format_number(*n),
            GgValue::String(s) => s.clone(),
        }
    }

    /// The kind rank used by [`total_cmp`](Self::total_cmp): booleans before numbers
    /// before strings, because a group-by over a field whose values are of mixed kinds
    /// must bucket in one order on both hosts.
    fn kind_rank(&self) -> u8 {
        match self {
            GgValue::Bool(_) => 0,
            GgValue::Number(_) => 1,
            GgValue::String(_) => 2,
        }
    }

    /// The **total order** over values — the one order bucket keys, distinct counts
    /// and explicit sorts all use.
    ///
    /// Across kinds it is a fixed kind rank (booleans, then numbers, then strings —
    /// any fixed order works, what matters is that both implementations pick the
    /// *same* one); within a kind it is `false`
    /// before `true`, [`f64::total_cmp`] (so `NaN` cannot make the order intransitive
    /// even though a document should never carry one), and — for strings — Rust's own
    /// byte ordering, **which is exactly Unicode code-point order** for UTF-8. That
    /// last equivalence is why Rust is the reference implementation: the TypeScript
    /// twin has to reach for code-point arrays to reproduce it, because both `<` and
    /// `localeCompare` disagree above the BMP.
    pub fn total_cmp(&self, other: &GgValue) -> std::cmp::Ordering {
        use std::cmp::Ordering;
        match self.kind_rank().cmp(&other.kind_rank()) {
            Ordering::Equal => match (self, other) {
                (GgValue::Bool(a), GgValue::Bool(b)) => a.cmp(b),
                (GgValue::Number(a), GgValue::Number(b)) => a.total_cmp(b),
                (GgValue::String(a), GgValue::String(b)) => a.as_bytes().cmp(b.as_bytes()),
                _ => Ordering::Equal,
            },
            other => other,
        }
    }
}

impl From<bool> for GgValue {
    fn from(b: bool) -> Self {
        GgValue::Bool(b)
    }
}

impl From<f64> for GgValue {
    fn from(n: f64) -> Self {
        GgValue::Number(n)
    }
}

impl From<&str> for GgValue {
    fn from(s: &str) -> Self {
        GgValue::String(s.to_string())
    }
}

impl From<String> for GgValue {
    fn from(s: String) -> Self {
        GgValue::String(s)
    }
}

/// Render a number the way both implementations must: an integral value with no
/// fractional part (`1`, not `1.0`), everything else through Rust's shortest
/// round-tripping form, which agrees with JavaScript's `Number.prototype.toString`
/// over the range a document carries.
fn format_number(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// One gg run as the query language sees it: a flat map of dotted field names to
/// [scalars](GgValue).
///
/// Built once per run by [`build_run_doc`] from its
/// [run record](crate::run_record::RunRecord) plus the store's lifecycle columns, and
/// then never re-derived — the backend holds an index of these and the public static
/// site ships them as a snapshot artifact, where the *same* mirrored evaluator runs
/// in the browser with no backend at all.
///
/// A document is an order of magnitude smaller than the structures it derives from
/// and carries configuration ids and outcome numbers only — **no source, no prompts,
/// no model output** — which is what makes publishing it a redaction question rather
/// than a disclosure one. See [`build_run_doc`] for the namespaces.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRunDoc {
    /// The run's fields, keyed by dotted name. A `BTreeMap` so serialization is
    /// key-ordered and two builds of the same run are byte-identical.
    #[serde(default)]
    pub fields: BTreeMap<String, GgValue>,
}

impl GgRunDoc {
    /// The value of `field`, or `None` when the document does not carry the key.
    pub fn get(&self, field: &str) -> Option<&GgValue> {
        self.fields.get(field)
    }

    /// The run's id (the `id` field), or `""` for a malformed document. Read by the
    /// canonical [document order](crate::gg_query#the-seven-determinism-rules) as the tiebreak,
    /// so it must never panic on a document that arrived over the wire.
    pub fn id(&self) -> &str {
        match self.fields.get("id") {
            Some(GgValue::String(s)) => s,
            _ => "",
        }
    }

    /// Insert `value` under `field`, dropping a non-finite number rather than storing
    /// it ([rule 7](crate::gg_query#the-seven-semantic-rules)).
    pub fn insert(&mut self, field: impl Into<String>, value: impl Into<GgValue>) {
        let value = value.into();
        if let GgValue::Number(n) = &value
            && !n.is_finite()
        {
            return;
        }
        self.fields.insert(field.into(), value);
    }
}

/// The comparison operators of a [`Compare`](GgFilter::Compare) predicate.
///
/// [`Eq`](Self::Eq) is what the language spells `:`, and it is **equality, not an
/// analyzed match**: case-insensitive with `*` globs, which is strictly more
/// predictable than a match while still covering prefix search
/// (`model:"anthropic/*"`). There is exactly one equality operator, so there is no
/// ambiguity about which to reach for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgCompareOp {
    /// `:` — equal. Case-insensitive over strings, with `*` matching any run of
    /// characters.
    Eq,
    /// `!=` — not equal. An **absent** field fails this like every other comparison
    /// ([rule 1](crate::gg_query#the-seven-semantic-rules)); `not field:value` is how "absent or
    /// different" is asked.
    Ne,
    /// `>` — strictly greater.
    Gt,
    /// `>=` — greater or equal.
    Gte,
    /// `<` — strictly less.
    Lt,
    /// `<=` — less or equal.
    Lte,
}

/// The compiled filter tree — the `<filter>` half of a query.
///
/// Boolean composition is the point of the redesign: the all-AND engine this replaced
/// could not express "hung or timed out", which is half of "terminated abnormally".
/// A predicate tree costs about forty lines of evaluator and makes the whole
/// vocabulary composable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgFilter {
    /// Every clause must pass. Juxtaposition in the source text compiles to this, as
    /// does an explicit `and`. An empty clause list passes everything.
    And {
        /// The conjuncts, in source order.
        clauses: Vec<GgFilter>,
    },
    /// Any clause may pass. An empty clause list passes nothing.
    Or {
        /// The disjuncts, in source order.
        clauses: Vec<GgFilter>,
    },
    /// The clause must not pass. An absent field passes `not` — that is the *only*
    /// way to ask for absence, and it is why [rule 1](crate::gg_query#the-seven-semantic-rules)
    /// can be so blunt about comparisons.
    Not {
        /// The negated clause.
        clause: Box<GgFilter>,
    },
    /// `field:*` — the field is present, whatever its value.
    Exists {
        /// The field to test.
        field: String,
    },
    /// `field <op> literal`.
    Compare {
        /// The field to test.
        field: String,
        /// The comparison to apply.
        op: GgCompareOp,
        /// The literal to compare against.
        value: GgValue,
    },
    /// `field:(a or b or c)` — the field equals any listed literal, on
    /// [`Eq`](GgCompareOp::Eq)'s terms (so globs work inside a one-of).
    OneOf {
        /// The field to test.
        field: String,
        /// The accepted literals, in source order. An empty list passes nothing.
        values: Vec<GgValue>,
    },
    /// `field:[from to to]` — an **inclusive** range on both ends, with either bound
    /// open (`*`). A bare date as the upper bound means end of day, but that is
    /// resolved by the client compiler: by the time a range reaches here both bounds
    /// are absolute.
    Range {
        /// The field to test.
        field: String,
        /// The inclusive lower bound, or `None` for an open start.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        from: Option<GgValue>,
        /// The inclusive upper bound, or `None` for an open end.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        to: Option<GgValue>,
    },
    /// A bare literal in the source text: matches when **any** string-valued field of
    /// the document contains the term, case-insensitively. The escape hatch for "I
    /// know a word from it but not which field it is in"; every other predicate names
    /// its field.
    Text {
        /// The term to look for.
        text: String,
    },
}

/// The aggregation functions a [`stats`](GgStatsStage) stage may request.
///
/// There is no `rate()`: averaging a boolean **is** a rate
/// ([rule 5](crate::gg_query#the-seven-semantic-rules)) and
/// [`contributing`](GgAggValue::contributing) is its denominator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgAggFunc {
    /// `count()` — how many documents fell in the bucket. Takes no field.
    Count,
    /// `distinct(f)` — how many distinct values of `f` the bucket's documents carry,
    /// counted under the same [total order](GgValue::total_cmp) bucket keys use.
    Distinct,
    /// `avg(f)` — the arithmetic mean of the contributing values.
    Avg,
    /// `sum(f)`.
    Sum,
    /// `min(f)`.
    Min,
    /// `max(f)`.
    Max,
    /// `median(f)` — the 0.5 quantile, on the repository's one interpolated
    /// definition.
    Median,
    /// `p90(f)`.
    P90,
    /// `p95(f)`.
    P95,
    /// `dist(f)` — the whole [distribution](GgDistribution) rather than one figure,
    /// for a box plot. Reports its figures in
    /// [`distribution`](GgAggValue::distribution), leaving
    /// [`value`](GgAggValue::value) absent, because there is no single number a
    /// distribution reduces to without choosing one.
    Dist,
}

impl GgAggFunc {
    /// The name this function goes by in the source text, and the first half of an
    /// [aggregation's default column name](GgAgg::name).
    pub fn as_str(self) -> &'static str {
        match self {
            GgAggFunc::Count => "count",
            GgAggFunc::Distinct => "distinct",
            GgAggFunc::Avg => "avg",
            GgAggFunc::Sum => "sum",
            GgAggFunc::Min => "min",
            GgAggFunc::Max => "max",
            GgAggFunc::Median => "median",
            GgAggFunc::P90 => "p90",
            GgAggFunc::P95 => "p95",
            GgAggFunc::Dist => "dist",
        }
    }
}

/// One requested aggregation — `avg(score) as mean_score`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAgg {
    /// The function to apply.
    pub func: GgAggFunc,
    /// The field to apply it to. Absent for [`Count`](GgAggFunc::Count), which
    /// aggregates the documents themselves; ignored if supplied anyway.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub field: Option<String>,
    /// The `as` alias this column is reported under, or `None` to use the derived
    /// [`name`](Self::name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub alias: Option<String>,
}

impl GgAgg {
    /// The column name this aggregation reports under: its [`alias`](Self::alias) when
    /// it has one, otherwise the source spelling (`avg(score)`, `count()`).
    ///
    /// Derived rather than stored so an un-aliased column names itself the same way in
    /// both implementations and in a saved dashboard — a column name is what a `sort`
    /// stage and a visualization bind to, so it must be a pure function of the query.
    pub fn name(&self) -> String {
        if let Some(alias) = &self.alias {
            return alias.clone();
        }
        match (self.func, &self.field) {
            (GgAggFunc::Count, _) => "count()".to_string(),
            (func, Some(field)) => format!("{}({field})", func.as_str()),
            (func, None) => format!("{}()", func.as_str()),
        }
    }
}

/// The calendar unit of a [date histogram](GgGroupKey::Bucket) interval.
///
/// Deliberately stops at the week. A month is not a fixed number of milliseconds, so
/// bucketing by one needs a civil calendar in **both** implementations — by some
/// distance the most drift-prone construct that could enter a mirrored evaluator, for
/// a bucket width a `4w` interval approximates. The grammar is
/// [frozen for v1](crate::gg_query#what-lives-where); if a month bucket is ever added it must
/// arrive with its own conformance cases across a leap year.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgIntervalUnit {
    /// `m` — 60 000 ms.
    Minute,
    /// `h` — 3 600 000 ms.
    Hour,
    /// `d` — 86 400 000 ms.
    Day,
    /// `w` — 604 800 000 ms, floored against [`WEEK_ORIGIN_MS`] rather than the epoch.
    Week,
}

impl GgIntervalUnit {
    /// This unit's width in milliseconds.
    pub fn millis(self) -> i64 {
        match self {
            GgIntervalUnit::Minute => 60_000,
            GgIntervalUnit::Hour => 3_600_000,
            GgIntervalUnit::Day => 86_400_000,
            GgIntervalUnit::Week => 604_800_000,
        }
    }
}

/// The floor origin for a [`Week`](GgIntervalUnit::Week) interval: `1969-12-29T00:00:00Z`,
/// the **Monday** before the epoch.
///
/// The Unix epoch was a Thursday, so flooring weeks against it produces
/// Thursday-to-Wednesday buckets, which every reader reports as a bug. Both
/// implementations must use this constant; it is pinned by a conformance case.
pub const WEEK_ORIGIN_MS: i64 = -259_200_000;

/// A date-histogram interval — `1d`, `15m`, `2w`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgInterval {
    /// How many units wide each bucket is. Zero is treated as one.
    pub count: u32,
    /// The unit.
    pub unit: GgIntervalUnit,
}

impl GgInterval {
    /// The interval's width in milliseconds (at least one unit).
    pub fn millis(self) -> i64 {
        self.unit.millis() * self.count.max(1) as i64
    }

    /// The origin every bucket boundary is measured from: the epoch, except for
    /// [weeks](GgIntervalUnit::Week), which measure from [`WEEK_ORIGIN_MS`].
    pub fn origin(self) -> i64 {
        match self.unit {
            GgIntervalUnit::Week => WEEK_ORIGIN_MS,
            _ => 0,
        }
    }

    /// Floor an epoch-millisecond timestamp onto this interval's grid.
    ///
    /// Uses a true floor (not a truncating division) so a pre-epoch timestamp lands in
    /// the bucket that *contains* it rather than the one after — the week origin is
    /// itself negative, so truncation would be wrong for the first week of 1970.
    pub fn floor(self, ms: i64) -> i64 {
        let width = self.millis();
        let origin = self.origin();
        let delta = ms - origin;
        // Euclidean division floors toward negative infinity for a positive divisor,
        // which is exactly the bucket-containment rule.
        origin + delta.div_euclid(width) * width
    }
}

/// One group-by key of a [`stats`](GgStatsStage) stage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgGroupKey {
    /// Group on a field's exact value. Documents lacking the field share one bucket
    /// keyed by absence, so they are visible rather than silently dropped.
    Field {
        /// The field to group on.
        field: String,
    },
    /// `bucket(started, 1d)` — group on a numeric field floored onto a fixed-width
    /// grid. When this is the **first** key the whole result is ordered by key
    /// ascending instead of by count, so a line chart draws a time series.
    Bucket {
        /// The field to bucket (epoch milliseconds for a date histogram).
        field: String,
        /// The bucket width.
        interval: GgInterval,
    },
}

impl GgGroupKey {
    /// The field this key groups on — its name in a [`GgBucketKeyPart`] and what a
    /// `sort` stage binds to.
    pub fn field(&self) -> &str {
        match self {
            GgGroupKey::Field { field } | GgGroupKey::Bucket { field, .. } => field,
        }
    }
}

/// The `stats` stage: what to aggregate, and what to group by.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgStatsStage {
    /// The aggregations, in source order — the result's columns.
    #[serde(default)]
    pub aggs: Vec<GgAgg>,
    /// The group-by keys, in source order. Empty produces the single grand-total
    /// bucket. Clamped to [`GG_MAX_GROUP_KEYS`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub group_by: Vec<GgGroupKey>,
}

/// One key of an explicit `sort` stage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSortKey {
    /// What to sort on: a document field when the query has no
    /// [`stats`](GgQuery::stats) stage, and otherwise either a group key's field or an
    /// aggregation's [column name](GgAgg::name).
    pub field: String,
    /// Descending when set, ascending otherwise.
    #[serde(default)]
    pub desc: bool,
}

/// A **compiled TCQ query** — the single wire form.
///
/// The client parses the source text and sends this; the URL and the saved object
/// carry the text, so a relative date (`now-30d`) re-resolves on every run while the
/// server sees only absolute milliseconds and needs no clock of its own.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgQuery {
    /// The filter tree, or `None` for a bare pipeline that matches every document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub filter: Option<GgFilter>,
    /// The `stats` stage, or `None` to return the matching documents themselves (the
    /// document view, which is what the old Sessions tab becomes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub stats: Option<GgStatsStage>,
    /// An explicit `sort` stage, overriding the default
    /// [document](crate::gg_query#the-seven-determinism-rules) or bucket order. Empty keeps the
    /// default.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sort: Vec<GgSortKey>,
    /// A `limit` stage: at most this many rows (documents or buckets). `None` returns
    /// everything, so a caller serving an unbounded corpus imposes its own ceiling.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub limit: Option<u32>,
}

/// The five-number summary plus the mean of a [`dist()`](GgAggFunc::Dist) column.
///
/// Deliberately carries **no confidence interval**. Reproducing a seeded bootstrap
/// resample bit-for-bit in the browser would need 64-bit integer arithmetic across
/// thousands of iterations per bucket — by far the most drift-prone construct that
/// could enter a mirrored evaluator, for a decoration on an exploratory chart. The
/// [comparisons](https://docs.testcabinet.ai/comparisons/statistics/) surface, which
/// is where inferential claims are actually made, keeps its interval untouched.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgDistribution {
    /// How many values contributed.
    pub n: u64,
    /// The smallest value.
    pub min: f64,
    /// The first quartile.
    pub q1: f64,
    /// The median.
    pub median: f64,
    /// The third quartile.
    pub q3: f64,
    /// The largest value.
    pub max: f64,
    /// The arithmetic mean (its gap from the median reveals skew).
    pub mean: f64,
}

/// One aggregated column in one bucket.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAggValue {
    /// The column's [name](GgAgg::name).
    pub name: String,
    /// The figure, or `None` when nothing in the bucket contributed one (so a whole
    /// column can be absent even though the bucket has documents) and always for
    /// [`dist()`](GgAggFunc::Dist), which reports through
    /// [`distribution`](Self::distribution) instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub value: Option<f64>,
    /// How many of the bucket's documents contributed a value (`<= n`). **The
    /// denominator**: a view renders it whenever it is less than the bucket's `n`,
    /// which is how an average over a sparse field stays honest without a `has.*`
    /// scope in the query.
    pub contributing: u64,
    /// The distribution, for a [`dist()`](GgAggFunc::Dist) column only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub distribution: Option<GgDistribution>,
}

/// One component of a bucket's composite key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBucketKeyPart {
    /// The field this component groups on.
    pub field: String,
    /// The shared value — the floored bucket start for a
    /// [date histogram](GgGroupKey::Bucket) — or `None` when the bucket's documents
    /// all *lack* the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub value: Option<GgValue>,
}

/// One bucket of an aggregated result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBucket {
    /// The composite key, one part per group-by key in stage order. Empty for the
    /// grand-total bucket of an ungrouped `stats`.
    #[serde(default)]
    pub key: Vec<GgBucketKeyPart>,
    /// How many documents fell into this bucket.
    pub n: u64,
    /// The aggregated columns, in stage order.
    #[serde(default)]
    pub values: Vec<GgAggValue>,
}

/// A column header of an aggregated result — what was asked for, so a view can label
/// and format a column without re-reading the query.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAggColumn {
    /// The column's [name](GgAgg::name), matching the
    /// [values](GgAggValue::name) in every bucket.
    pub name: String,
    /// The function that produced it.
    pub func: GgAggFunc,
    /// The field it was applied to, absent for [`Count`](GgAggFunc::Count).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub field: Option<String>,
}

/// The result of [`evaluate`]: either the matching documents or the aggregated
/// buckets, never both.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgQueryResponse {
    /// How many documents the filter matched — **before** any `limit`, and equal to
    /// the sum of every bucket's `n` for an aggregated query. The denominator every
    /// figure on the page is read against.
    pub total_runs: u64,
    /// The matching documents, in [document order](crate::gg_query#the-seven-determinism-rules)
    /// unless an explicit `sort` overrode it. Empty for an aggregated query.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub documents: Vec<GgRunDoc>,
    /// The aggregated buckets. Empty for a document query.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buckets: Vec<GgBucket>,
    /// The aggregated columns, in stage order. Empty for a document query.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<GgAggColumn>,
    /// Whether a `limit` stage cut rows off the result, so a view can say "showing the
    /// first N" rather than implying it showed everything.
    #[serde(default)]
    pub truncated: bool,
}

/// What kind of values a field carries across the corpus.
///
/// Derived from the observed documents rather than declared, which is what keeps the
/// field side open — except [`Date`](Self::Date), which cannot be derived (a date *is*
/// a number, [rule 6](crate::gg_query#the-seven-semantic-rules)) and comes from the
/// [known date fields](GG_DATE_FIELDS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgFieldKind {
    /// Every observed value is a string.
    String,
    /// Every observed value is a number.
    Number,
    /// Every observed value is a boolean.
    Boolean,
    /// A number that is an epoch-millisecond timestamp — offered a date picker and a
    /// histogram interval rather than a raw number box.
    Date,
    /// Values of more than one kind were observed. A corpus spanning a field rename or
    /// a type change lands here; the editor still offers the field, and the
    /// [total order](GgValue::total_cmp) still groups it deterministically.
    Mixed,
}

/// One observed value of a field and how many documents carry it — the value
/// suggestions the editor offers after a colon, with their counts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgFieldValueCount {
    /// The value.
    pub value: GgValue,
    /// How many documents carry it.
    pub count: u64,
}

/// One field of the corpus, as the field sidebar and the completer see it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgFieldInfo {
    /// The dotted field name.
    pub name: String,
    /// What kind of values it carries.
    pub kind: GgFieldKind,
    /// **How many documents carry it** — the number that makes a sparse field visible.
    /// A `tool.*` field is deliberately sparse ([rule 1](crate::gg_query#the-seven-semantic-rules)),
    /// and without this count an operator would have to *infer* that from an empty
    /// result rather than see it before running the query.
    pub documents: u64,
    /// The most common values, count descending and ties by the
    /// [total order](GgValue::total_cmp), capped at [`GG_FIELD_TOP_VALUES`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub top_values: Vec<GgFieldValueCount>,
}

/// The field catalog: the union of every key across the corpus, with each field's
/// kind, document count and top values.
///
/// **The second mirrored function**, and the reason the conformance fixture covers it
/// too: a drift here is a one-host-only autocomplete regression, which is far harder
/// to notice than a wrong number.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgFieldCatalog {
    /// How many documents the catalog was derived from — the denominator for every
    /// field's [`documents`](GgFieldInfo::documents).
    pub documents: u64,
    /// The fields, by name ascending (Unicode code point).
    #[serde(default)]
    pub fields: Vec<GgFieldInfo>,
}

#[cfg(test)]
#[path = "gg_query.test.rs"]
mod tests;
