//! The **document builder**: one gg run's [record](crate::run_record::RunRecord) plus
//! the store's lifecycle columns, reduced to the flat [`GgRunDoc`] every
//! [query](super::GgQuery) runs over.
//!
//! This is the only place in the system that decides what a field is *called*, and a
//! field name is user-visible — it appears in autocomplete and, more importantly,
//! **inside saved queries and dashboards**. So the two standing obligations on every
//! feature that wants to be queryable are: emit scalars, never arrays
//! ([rule 4](crate::gg_query#the-seven-semantic-rules)), and keep field names stable.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::GgRunDoc;
use crate::code_analysis::{CodeAnalysisSummary, CodeLanguage};
use crate::gg::{GgCapabilitySet, GgSessionSummary};
use crate::review::Rating;
use crate::run_record::RunRecord;

/// The capability-id vocabulary the `cap.*` namespace is made total over, re-exported from
/// [`crate::gg`] where it is declared.
///
/// One list, in one place: the launch check reads it to refuse an id gg does not have, and the
/// builder reads it to emit a field per id. A second copy here is exactly the drift that would let
/// a run be configured with a capability no document could report on.
pub use crate::gg::GG_CAPABILITY_CATALOG;

/// The fields that are epoch-millisecond timestamps rather than plain numbers.
///
/// [Rule 6](crate::gg_query#the-seven-semantic-rules) makes a date *be* a number, which is what
/// keeps ranges, sorts and histograms out of the evaluator entirely — but it also
/// means date-ness cannot be observed from the values. This list is how the
/// [field catalog](super::field_catalog) still labels them
/// [`Date`](super::GgFieldKind::Date), so the editor offers a date picker and a
/// histogram interval instead of a raw number box.
pub const GG_DATE_FIELDS: &[&str] = &["started", "finished"];

/// The bucket a run that breached no [execution ceiling](crate::gg::GgLimitKind) falls
/// into on the `limit` field. Deliberately a value rather than an absence: "ran to its
/// own conclusion" is the arm every ceiling comparison is measured against, so it must
/// be groupable.
pub const NO_LIMIT_HIT: &str = "none";

/// The name a capability that selects no implementation reports under `cap.<id>.impl`.
pub const DEFAULT_IMPLEMENTATION: &str = "default";

/// The `code.language` value of a tree the analyzer parsed in **more than one**
/// language.
pub const CODE_LANGUAGE_MIXED: &str = "mixed";

/// The `code.language` value of a tree the analyzer parsed in **no** language — one
/// that is entirely JSON, Markdown, CSS, shaders and HTML, or one where every source
/// file was refused. Deliberately a value rather than an absence, for the same reason
/// [`NO_LIMIT_HIT`] is: "the model wrote nothing either front end could read" is an
/// outcome a group-by must be able to show, not a gap in the data.
pub const CODE_LANGUAGE_NONE: &str = "none";

/// Fields the [public export](redacted_for_public) drops **by name**, whatever they
/// hold.
///
/// One entry today, and it is a standing policy rather than a description of the
/// current builder: `statusDetail` is the run status's free-text failure detail, which
/// is a stack trace, a container error or an assertion message — the console's most
/// useful triage field and precisely the class of string that has no business on a
/// public site even after [scrubbing](crate::redact::SecretScrubber). The builder does
/// not emit it today; the deny-list is here so that the day it does, the export already
/// refuses it rather than shipping it in the first snapshot after the change.
///
/// The list is a *floor*, not the whole control. The length rule below is what catches
/// the free text nobody thought to name — see [`redacted_for_public`].
pub const GG_PRIVATE_FIELDS: &[&str] = &["statusDetail"];

/// The longest string value the [public export](redacted_for_public) keeps.
///
/// Every field the builder writes on purpose is an identifier: a run id, a case slug, a
/// model id, a status token, a capability implementation name. The longest of those —
/// a fully qualified OpenRouter model id — runs to a few dozen characters, so this
/// bound has an order of magnitude of headroom for anything deliberate while still
/// being far below the size of the thing it exists to stop: a **capability parameter**.
/// `cap.<id>.<param>` is flattened straight out of a run's configuration, so an
/// operator who put a system-prompt override, a skill body or a pasted specification in
/// a parameter has put it into every document — and publishing gg documents would
/// publish it verbatim.
pub const GG_PUBLIC_MAX_STRING: usize = 200;

/// The run-lifecycle facts that live on the **store**, not on the record: whether the
/// run was published, and what its reviewers concluded.
///
/// These are the fields a review or a publish changes *without* rewriting the record —
/// which is exactly why the backend's document index reconciles on a mutation
/// timestamp rather than on the record's own finish time. Passed in rather than
/// looked up because core has no database: the caller (the backend for the console,
/// the snapshot builder for the public site) resolves them and hands them over.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct GgDocLifecycle {
    /// Whether the run has been published to the public gallery.
    pub published: bool,
    /// The reviewers' overall rating, or `None` for an unreviewed run.
    pub rating: Option<Rating>,
    /// The aggregate reviewer score as a `0.0..=1.0` fraction (mean earned checklist
    /// weight over the total available), or `None` when the run has no reviews or its
    /// case's checklist weights could not be resolved. Computed by the caller, because
    /// the weights live in the case catalog rather than on the run.
    pub score: Option<f64>,
    /// How many reviews the run has.
    pub review_count: u64,
}

/// Flatten a JSON value into `out` under `prefix`, following
/// [rule 4](crate::gg_query#the-seven-semantic-rules).
///
/// - An **object** contributes one dotted field per key, recursively.
/// - An **array** contributes only `<prefix>.count`. Positional keys would be
///   unqueryable (nobody asks about `slotCosts.3.cost`), they duplicate the
///   purpose-built per-model and per-tool namespaces, and they would flood the field
///   sidebar with junk that hides the fields worth finding.
/// - A **null** contributes nothing — an absent value is a missing key, never a
///   stored null.
/// - A **scalar** is stored, with a non-finite number dropped
///   ([rule 7](crate::gg_query#the-seven-semantic-rules)).
///
/// Public because the `code.*` namespace flattens its own typed block through exactly
/// this function: one flattening rule for the whole document, not one per namespace.
pub fn flatten_json(prefix: &str, value: &Value, out: &mut GgRunDoc) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_json(&path, child, out);
            }
        }
        Value::Array(items) => out.insert(format!("{prefix}.count"), items.len() as f64),
        Value::Null => {}
        Value::Bool(b) => out.insert(prefix, *b),
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                out.insert(prefix, f);
            }
        }
        Value::String(s) => out.insert(prefix, s.clone()),
    }
}

/// Build one run's [document](GgRunDoc).
///
/// The namespaces, in the order they are written:
///
/// | Namespace | Holds |
/// | --- | --- |
/// | `id`, `started`, `finished`, `state`, `published`, `rating`, `score`, `reviewCount` | identity, timing, lifecycle |
/// | `case`, `caseVersion`, `variant`, `testType` | what was run |
/// | `model`, `orchestrator`, `engine`, `harnessVersion`, `preset`, `agents`, `agent.<profileId>.model` | how it was configured |
/// | `cap.<id>`, `cap.<id>.impl`, `cap.<id>.<param>`, `agent.<profileId>.cap.<id>` | the capability set, flattened and **typed** |
/// | `tool.<name>` | the effective toolset (sparse — true only for offered tools) |
/// | `status`, `mode`, `limit` | how it ended |
/// | `summary.<path>` | the **whole** session summary, flattened |
/// | `model.<id>.tokens`, `model.<id>.cost` | the per-`(slot, model)` spend rollup |
/// | `metric.*` | run time, tokens and cost — **absent, never zero**, on a run that produced nothing |
/// | `code.<path>`, `code.language` | the [code analysis](crate::code_analysis) summary, flattened, plus one derived scalar |
/// | `has.<block>` | presence markers, so a rate's denominator is expressible |
///
/// Two of those rows carry most of the design. `summary.<path>` **subsumes the entire
/// closed summary-field enum this replaced, and every field nobody ever wrote an enum
/// arm for** — a number a future feature folds onto the summary is queryable the day
/// it lands. And `cap.<id>.<param>` is **typed**, so
/// `cap.compaction.summaryHeadroom > 0.5` works; the implementation this replaced
/// stringified every capability param, which made numeric comparison impossible.
///
/// `cap.<id>` is a **run-wide** read — true when *any* agent has the capability on —
/// because the question the field exists to answer is "was this run configured with
/// X", and `avg(cap.compaction)` is only an honest enablement rate if it is. Reading
/// the root alone would report `false` for a run that enabled a capability on the one
/// subagent under study, which is the same defect
/// [`GgCapabilitySet::any_agent_enabled`](crate::gg::GgCapabilitySet::any_agent_enabled)
/// was introduced to fix. Per-agent detail is not lost either: each
/// agent's own enablements are written **sparsely** as `agent.<profileId>.cap.<id>`, so
/// a per-agent difference is expressible without making every document carry the catalog
/// once per profile.
pub fn build_run_doc(record: &RunRecord, lifecycle: &GgDocLifecycle) -> GgRunDoc {
    let mut doc = GgRunDoc::default();

    // --- identity, timing, lifecycle -------------------------------------------
    doc.insert("id", record.id.clone());
    if let Some(ms) = epoch_millis(&record.started_at) {
        doc.insert("started", ms as f64);
    }
    if let Some(ms) = epoch_millis(&record.finished_at) {
        doc.insert("finished", ms as f64);
    }
    if let Some(state) = enum_str(&record.status.state) {
        doc.insert("state", state);
    }
    doc.insert("published", lifecycle.published);
    if let Some(rating) = lifecycle.rating {
        doc.insert("rating", rating.as_str().to_string());
    }
    if let Some(score) = lifecycle.score {
        doc.insert("score", score);
    }
    doc.insert("reviewCount", lifecycle.review_count as f64);

    // --- what was run -----------------------------------------------------------
    let subject = &record.subject;
    doc.insert("case", subject.test_case_slug.clone());
    doc.insert("caseVersion", subject.test_case_version.clone());
    doc.insert("variant", subject.variant.clone());
    doc.insert("testType", subject.test_type.as_str().to_string());

    // --- how it was configured ---------------------------------------------------
    doc.insert("model", subject.model_id.clone());
    doc.insert("orchestrator", subject.orchestrator_slug.clone());
    // Configuration, not identity: the [engine](crate::engine) is chosen per run
    // beside the harness and the orchestrator, so two documents that agree on
    // `case`/`caseVersion`/`variant` may still describe builds written against
    // different runtimes — and grouping by `engine` is how that shows.
    //
    // Written unconditionally, and therefore **total** over the corpus in the sense
    // [rule 1](crate::gg_query#the-seven-semantic-rules) cares about: an engineless
    // run reports the honest `none` rather than an absence, so `count() by engine`
    // accounts for every run and `engine != none` means what it reads as.
    doc.insert("engine", subject.engine_slug.clone());
    if let Some(version) = &subject.harness_version {
        doc.insert("harnessVersion", version.clone());
    }
    if let Some(set) = &subject.gg_capability_set {
        insert_capability_set(&mut doc, set);
    }

    // --- how it ended, and the whole summary -------------------------------------
    if let Some(summary) = &subject.gg_summary {
        insert_summary(&mut doc, summary);
    }

    // --- resource metrics --------------------------------------------------------
    insert_metrics(&mut doc, record);

    // --- what the model wrote ----------------------------------------------------
    if let Some(code) = &record.code_analysis {
        insert_code_analysis(&mut doc, code);
    }

    // --- presence markers --------------------------------------------------------
    doc.insert("has.capabilitySet", subject.gg_capability_set.is_some());
    doc.insert("has.summary", subject.gg_summary.is_some());
    doc.insert("has.codeAnalysis", record.code_analysis.is_some());

    doc
}

/// Write the `preset` / `agents` / `agent.<profileId>.model` / `cap.*` /
/// `agent.<profileId>.cap.<id>` namespaces.
///
/// The per-agent fields are keyed by the profile's [id](crate::gg::GgAgentConfig::id), not its display
/// [name](crate::gg::GgAgentConfig::name): the id is unique within a set by construction, where two profiles
/// may share a name — and two profiles sharing a field key would silently merge into one, so a
/// query would read one profile's configuration as the other's. The id is minted readable
/// (`reviewer`, `reviewer-2`), so a query written by hand still says what it means.
///
/// Two populations, deliberately shaped differently. `cap.<id>` is **total** over the
/// catalog and **run-wide** — the field a comparison of two configurations slices on, so
/// "configured and off" and "never mentioned" must collapse into one honest `false` rather than an
/// absence.
/// `agent.<profileId>.cap.<id>` is **sparse** and per-agent, like `tool.<name>`: writing
/// the catalog once per profile would multiply a five-agent document's capability fields by
/// five to say `false` a hundred times, and the question it answers ("which profile had
/// it") only ever needs the ones that did.
///
/// # A set with no agents
///
/// Such a set is **malformed** — it declares no [root](GgCapabilitySet::root), and both
/// launch paths (gg's own agent validation and the backend's launch body) refuse one by
/// name — so no run can have recorded it. It reaches here only on a hand-written or
/// corrupted stored record. This builder nevertheless has to be **total**: it runs inside
/// the backend's document indexer, where a panic over one bad row would take down the index
/// for every other run. So nothing below reads [`GgCapabilitySet::root`], which asserts a
/// root exists; an agent-less set states what it is — no agents, and an honest `false` for
/// every capability — and the record stays queryable enough to find and fix.
fn insert_capability_set(doc: &mut GgRunDoc, set: &GgCapabilitySet) {
    if let Some(preset) = &set.preset {
        doc.insert("preset", preset.clone());
    }
    doc.insert("agents", set.agents.len() as f64);
    for agent in &set.agents {
        if let Some(model) = agent.resolved_model_id() {
            doc.insert(format!("agent.{}.model", agent.id), model.to_string());
        }
    }

    // The union of the shipped catalog and whatever this run's agents actually declare.
    // A launch refuses an id outside the catalog, so on any run that actually happened the
    // union *is* the catalog; the extension survives for the same reason this builder does
    // not read `GgCapabilitySet::root` — a hand-written or corrupted stored record must stay
    // queryable rather than silently lose the field that would show what is wrong with it.
    // Every agent contributes, not just the root: a capability declared
    // only on a subagent would otherwise produce no field at all, which is the same
    // root-only blind spot the enabled flag itself used to have. Ordering is irrelevant
    // (the document is a `BTreeMap`) but the set must be de-duplicated or a declared
    // catalog capability would be written twice.
    let mut ids: BTreeSet<&str> = GG_CAPABILITY_CATALOG.iter().copied().collect();
    for agent in &set.agents {
        ids.extend(agent.capabilities.iter().map(|cfg| cfg.id.as_str()));
    }

    for id in &ids {
        doc.insert(format!("cap.{id}"), set.any_agent_enabled(id));
        // The implementation and the params describe a capability the set *carries*.
        // A capability that is merely absent has neither, so those two stay absent
        // rather than being invented — only the enabled flag is made total.
        //
        // The first agent that declares it, in declaration order — which is the root
        // whenever the root declares it, because the root *is* the first profile. A set
        // that configures a capability on one subagent has exactly one configuration for
        // it, and reporting `cap.memories = true` beside no `cap.memories.implementation`
        // would make the params look absent from the run rather than absent from the
        // root. Declaration order is stable, so the choice is deterministic — and asking
        // the agents rather than the root keeps this total for a set that declares none.
        let Some(cfg) = set.agents.iter().find_map(|agent| agent.capability(id)) else {
            continue;
        };

        doc.insert(
            format!("cap.{id}.impl"),
            cfg.implementation
                .clone()
                .unwrap_or_else(|| DEFAULT_IMPLEMENTATION.to_string()),
        );
        flatten_json(&format!("cap.{id}"), &cfg.params, doc);
    }

    for agent in &set.agents {
        for id in &ids {
            // Sparse: only the agents that have it, and only as `true`. Read through
            // `is_enabled` so a profile that declares a capability and disables it
            // answers the same question the run-wide flag did.
            if agent.is_enabled(id) {
                doc.insert(format!("agent.{}.cap.{id}", agent.id), true);
            }
        }
    }
}

/// Write the `status` / `mode` / `limit` / `tool.*` / `summary.*` / `model.<id>.*`
/// namespaces off the session summary.
fn insert_summary(doc: &mut GgRunDoc, summary: &GgSessionSummary) {
    doc.insert("status", summary.terminal_status.clone());
    doc.insert("mode", summary.execution_mode.clone());
    doc.insert(
        "limit",
        match &summary.limit_hit {
            Some(breach) => breach.limit.as_str().to_string(),
            None => NO_LIMIT_HIT.to_string(),
        },
    );

    // The effective toolset is **sparse on purpose**: the tool universe is per-run, not
    // a closed catalog, so there is no honest set of names to write `false` for. "Never
    // offered this tool" is asked as `not tool.<name>`, and the field sidebar's
    // per-field document count is what makes that sparseness visible rather than
    // something an operator has to infer from an empty result.
    for tool in &summary.effective_tools {
        doc.insert(format!("tool.{tool}"), true);
    }

    // The per-(slot, model) rollup, folded to per-model so a run whose subagents ran on
    // a cheaper slot is still sliceable by model spend. Folded rather than flattened
    // because `slot_costs` is an array, and an array contributes only its length.
    let mut tokens: BTreeMap<&str, u64> = BTreeMap::new();
    let mut costs: BTreeMap<&str, f64> = BTreeMap::new();
    for entry in &summary.slot_costs {
        if let Some(total) = entry.tokens.total() {
            *tokens.entry(entry.model_id.as_str()).or_default() += total;
        }
        if let Some(cost) = entry.cost.and_then(|c| c.comparable) {
            *costs.entry(entry.model_id.as_str()).or_default() += cost;
        }
    }
    for (model, total) in tokens {
        doc.insert(format!("model.{model}.tokens"), total as f64);
    }
    for (model, cost) in costs {
        doc.insert(format!("model.{model}.cost"), cost);
    }

    // Then the whole summary verbatim, which is what makes a field a future feature
    // adds queryable with no change here.
    if let Ok(value) = serde_json::to_value(summary) {
        flatten_json("summary", &value, doc);
    }
}

/// Write the `metric.*` namespace, honouring
/// [rule 3](crate::gg_query#the-seven-semantic-rules): **absent, never zero**.
///
/// A record built for a failed run carries default metrics — zero seconds, no tokens,
/// no cost. Flattened naively, a `timed_out` run would report a run time of zero,
/// which drags an average toward zero with *exactly the runs that burned the most
/// budget* and excludes the longest runs from a `metric.runTimeSeconds >= 1800`
/// filter. The token and cost classes are already `Option`, so they answer for
/// themselves; run time is a bare `f64`, so a positive value is the proxy for "this
/// run genuinely probed a container".
fn insert_metrics(doc: &mut GgRunDoc, record: &RunRecord) {
    let metrics = &record.metrics;
    if metrics.run_time_seconds > 0.0 {
        doc.insert("metric.runTimeSeconds", metrics.run_time_seconds);
    }
    if let Some(total) = metrics.tokens.total() {
        doc.insert("metric.totalTokens", total as f64);
    }
    let tokens = &metrics.tokens;
    for (name, value) in [
        ("uncachedInput", tokens.uncached_input),
        ("cachedInput", tokens.cached_input),
        ("output", tokens.output),
        ("reasoning", tokens.reasoning),
    ] {
        if let Some(value) = value {
            doc.insert(format!("metric.tokens.{name}"), value as f64);
        }
    }
    if let Some(cost) = metrics.cost.comparable {
        doc.insert("metric.cost", cost);
    }
    if let Some(cost) = metrics.cost.actual {
        doc.insert("metric.costActual", cost);
    }
}

/// Write the `code.*` namespace off the run's [code-analysis
/// summary](CodeAnalysisSummary), plus the one field that cannot be flattened.
///
/// The whole typed block goes through [`flatten_json`] verbatim — one flattening rule
/// for the document, not one per namespace — which is what makes a figure the analyzer
/// starts emitting queryable the day it lands, with no change here and no contract
/// regeneration. So `code.size.giniCodeLines`, `code.complexity.maxCyclomatic`,
/// `code.notes.truncated` and the rest exist because the struct has those fields, not
/// because anybody enumerated them.
///
/// The exception is `languages`, and it is the exception
/// [rule 4](crate::gg_query#the-seven-semantic-rules) predicts: it is a `Vec`, so
/// flattening contributes only the useless `code.languages.count`. The question people
/// actually ask of it — "does this model write TypeScript or Rust, and does it mix
/// them?" — needs a **scalar** to group by, so the builder derives one:
///
/// | Parsed languages | `code.language` |
/// | --- | --- |
/// | none | `"none"` |
/// | exactly one | that language's [token](CodeLanguage::as_str) |
/// | more than one | `"mixed"` |
///
/// Spelled through [`CodeLanguage::as_str`] rather than a local match, so a query, a
/// chart legend and the Code tab cannot disagree about how a language is written.
fn insert_code_analysis(doc: &mut GgRunDoc, code: &CodeAnalysisSummary) {
    if let Ok(value) = serde_json::to_value(code) {
        flatten_json("code", &value, doc);
    }

    // Derived from the deduplicated list the analyzer reports, so a tree parsed in one
    // language a hundred times is still that one language.
    let mut languages: Vec<CodeLanguage> = code.languages.clone();
    languages.sort_unstable();
    languages.dedup();
    let language = match languages.as_slice() {
        [] => CODE_LANGUAGE_NONE.to_string(),
        [only] => only.as_str().to_string(),
        _ => CODE_LANGUAGE_MIXED.to_string(),
    };
    doc.insert("code.language", language);
}

/// The document as the **public static site** may carry it.
///
/// The [export](https://docs.testcabinet.ai/gg/analysis/) is deliberately *not* gated on
/// run publication — a document holds configuration ids and outcome numbers, no source
/// and no model output, and restricting it to published runs would publish almost
/// nothing and defeat the point. **Redaction is the control instead**, and it is a rule
/// about the document rather than about any one exporter: it is applied by the composer
/// that builds the public corpus *and* again by the snapshot builder that turns that
/// corpus into a public object, which is free because it is idempotent. Two applications
/// rather than one on purpose — the second is the object boundary, and an exporter written
/// tomorrow reaches that boundary whether or not it has read this.
///
/// Two rules, and the second is the load-bearing one:
///
/// 1. **Named fields go** ([`GG_PRIVATE_FIELDS`]) — the deny-list, which only covers
///    what somebody thought of.
/// 2. **Anything longer than [`GG_PUBLIC_MAX_STRING`] goes**, whatever it is called — the
///    *value* when it is a string, and the field **name** too. Every field the builder
///    writes deliberately is an identifier or a token; a long string in a document is, in
///    practice, a **capability parameter** carrying free text an operator pasted into a
///    configuration. The name is bounded for the same reason and not as an afterthought:
///    [`flatten_json`] mints field names from arbitrary configuration keys
///    (`cap.<id>.<key>` all the way down), so a name is operator-authored text exactly as a
///    value is, and a rule that covered only half of it would not be the construction
///    argument it claims to be. This is what makes the export safe by *construction*
///    rather than by review: a namespace nobody has written yet is already covered.
///
/// What this is **not**: it is not secret scrubbing. A leaked API key is short and
/// deliberately shaped, and it is caught downstream by
/// [`SecretScrubber::scrub_json`](crate::redact::SecretScrubber::scrub_json) over the
/// serialized export object. The two run in sequence and neither subsumes the other.
///
/// Nor does it decide *which* runs are exported: dropping an unreleased case's
/// documents is the caller's job, because "is this case experimental" is a fact about
/// the definition store rather than about the document.
///
/// Numbers and booleans are never dropped. They are the corpus.
pub fn redacted_for_public(doc: &GgRunDoc) -> GgRunDoc {
    let mut out = GgRunDoc::default();
    for (field, value) in &doc.fields {
        if GG_PRIVATE_FIELDS.contains(&field.as_str()) {
            continue;
        }
        // The name is checked as well as the value. A field name is a path built out of
        // configuration keys, so an operator can put free text in one just as readily as
        // in a value — and a dropped name takes its value with it.
        if field.chars().count() > GG_PUBLIC_MAX_STRING {
            continue;
        }
        if let super::GgValue::String(text) = value
            && text.chars().count() > GG_PUBLIC_MAX_STRING
        {
            continue;
        }
        out.fields.insert(field.clone(), value.clone());
    }
    out
}

/// Parse an RFC 3339 timestamp to epoch milliseconds, or `None` when it is not a
/// timestamp at all. A record whose timestamps are unparseable simply carries no
/// `started`/`finished` — which sorts it last in
/// [document order](crate::gg_query#the-seven-determinism-rules) rather than pretending it
/// happened at the epoch.
fn epoch_millis(rfc3339: &str) -> Option<i64> {
    let parsed = OffsetDateTime::parse(rfc3339, &Rfc3339).ok()?;
    i64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).ok()
}

/// The serde wire token of a small enum (`RunState`, `TestType`), read through serde
/// rather than a hand-written match so the document can never spell a state
/// differently from the record it came from.
fn enum_str<T: Serialize>(value: &T) -> Option<String> {
    match serde_json::to_value(value).ok()? {
        Value::String(s) => Some(s),
        _ => None,
    }
}
