//! **The launch refusal**: the one pass that proves a gg run can be conducted exactly as it is
//! written, before the first turn and before a single token is spent.
//!
//! # The policy
//!
//! A gg run **refuses to start if any configured value cannot be honoured exactly as written**.
//! There is no such thing in gg as resolving a configured value to a default: an experiment
//! measured on one arm while its record names another is worse than no experiment, and a fallback
//! is precisely the mechanism that produces one. The refusal is the alternative.
//!
//! Four consequences follow, and they are the whole of the contract:
//!
//! 1. **Absence is never a value.** gg substitutes nothing. A configured value is either written in
//!    the document or the thing it configures is **off** — gg never chooses a number, a name or a
//!    mode on an operator's behalf. So an **enabled capability is fully specified**: it names its
//!    arm wherever the capability offers arms to choose between (see [`CAPABILITIES_WITH_ARMS`]),
//!    and it writes every param the [table](CAPABILITY_PARAMS) marks
//!    [required](Requirement::Required). A required value that is absent or `null` is refused at its
//!    own locus, on exactly the terms an unreadable one is. The table's second classification,
//!    [off when absent](Requirement::OffWhenAbsent), is where the absence *is* the setting — no
//!    summarizer model, no reviewer requirement — and gg records it as such rather than standing a
//!    figure in for it. Leaving a capability out of the profile's list is the one way to leave it
//!    unconfigured, and it means off.
//!
//!    The table's third classification,
//!    [default when absent](Requirement::DefaultWhenAbsent), is the single exception to the rule,
//!    and it is bounded by the [authoring catalog](test_cabinet_core::gg::gg_authoring_catalog)
//!    writing the figure into every new document: the value a run was conducted under is in that
//!    run's record whether or not the operator had an opinion about the key. The
//!    [context-usage signal's threshold](PARAM_SIGNAL_THRESHOLD_PERCENT) is read that way.
//! 2. **A disabled capability requires nothing of itself.** It configures nothing, so there is
//!    nothing for it to be short of; what it carries is the configuration the arm *would* have used,
//!    which is what keeps the on and off arms of one comparison the same document with one switch
//!    moved. Values written on one are still read, and still refused if gg cannot honour them, which
//!    is what keeps those two arms symmetric.
//! 3. **Every defect at once, and each of them once.** A refusal names *every* offending value, not
//!    the first one — an operator fixing a sweep's one shared configuration document wants every
//!    typo in one pass, not a dozen launches each revealing the next — and names each value a single
//!    time, however many readers of the document noticed it.
//! 4. **What cannot be seen before the run kills the run.** A value that can only be discovered
//!    mid-run and cannot be honoured becomes a gg *internal error* that ends the session, never a
//!    fallback.
//!
//! # What is still a warning
//!
//! Only a configuration gg honours **exactly as written**, where nothing is substituted and gg's
//! behaviour matches the document:
//!
//! - `errorRateWindow >= maxTurns` — both honoured; the ceiling can just only fire on the last turn.
//! - `minOffenders > windowWords` — armed exactly as declared, provably inert.
//! - `windowLimit` above the model's own window — a ceiling honoured exactly as declared that
//!   narrows nothing; the agent is measured against the model's window, which is what the record
//!   holds (`window_ceiling_notes` in [`crate::agent`]).
//! - An allowlist entry naming a real gg tool or operation that *this* agent's capabilities do not
//!   offer. It grants nothing, it is not a typo, and it is the legitimate shared-document case.
//! - An `openingTurn` entry naming a real gg module or operation that *this* agent does not hold —
//!   the same shared-document case, dropped at seed time with a line naming it. What **refuses**
//!   there is a module id or operation id gg has no vocabulary for, and a function held by role or
//!   placement (an ending call, the machine transition), which no document can promise a window
//!   will open on (`check_opening_turn` in [`crate::agent`]). Two lists that come out empty are a
//!   configuration, not a defect: the agent is seeded no opening program at all.
//! - A `params` key known to the capability but unused by the arm its `implementation` selected —
//!   the deliberate "one shared params block per sweep" case.
//! - The `info` lines reporting what *is* in force: the armed ceilings, the loop detector.
//!
//! # The resolver contract
//!
//! gg's configuration is read by ~30 small **resolvers** — [`CompactionStrategy::resolve`], [`MemoryStrategy::resolve`],
//! [`ReadPolicy::resolve`], [`resolve_run_limits`], and their kin. Every one of them is called
//! **more than once**: at launch, and again mid-run on `adopt`, on an `exec`/`transition` transfer,
//! at subagent spawn, or per turn. So a resolver **stays total** — it never returns a `Result` — and
//! instead takes one extra parameter:
//!
//! ```ignore
//! fn resolve(params: &Value, report: &mut LaunchReport) -> Self
//! ```
//!
//! - **Total signature.** It always produces a value, because ~40 mid-run call sites must not grow
//!   error handling for a condition [`validate_launch`] has already made impossible.
//! - **One `report` parameter**, the sink. At launch it is [`LaunchReport::Collecting`] and every
//!   defect it is handed refuses the run. Mid-run it is [`LaunchReport::Discarding`], which asserts
//!   that nothing arrives — anything that does is a **gg defect**, because the launch pass already
//!   proved this same document has nothing to report.
//! - **An absent required value is the resolver's own defect to report**, at the same `PARAM_*`
//!   constant it reads it by. [`required_param`] and its typed siblings do both jobs in one call, so
//!   a required key cannot be read without its absence being reported, and the sentence an operator
//!   gets comes from the [table](CAPABILITY_PARAMS) rather than from the call site.
//! - **Having reported, the resolver still returns something**, because it is total — and that
//!   something is an explicitly **named placeholder**, never a `Default` and never
//!   `.unwrap_or_default()`. The name is what tells the next reader of that line that the launch is
//!   already refused and the value configures nothing.
//! - **An absent optional value is a setting, not a hole.** The resolver answers with the value that
//!   says the thing is off — `None`, no summarizer model, no reviewer requirement — and reports
//!   nothing.
//! - **Present and unhonourable means a reported defect.** The resolver hands back the same
//!   placeholder and reports a [`LaunchDefect`] naming the locus, the value as written, and the
//!   vocabulary it was read against.
//! - **An absent *arm* is the one absence a resolver does not report.** An arm resolver is handed an
//!   `Option<&str>` and no switch, and requirement is a property of the switch — so
//!   [`check_implementation`], which reads the whole capability, reports it, and the resolver
//!   answers `None` with its named placeholder and says nothing.
//!
//! Keeping the check inside the resolver — reading the same `PARAM_*` constants, in the same
//! function — is what stops the vocabulary drifting: a param cannot be added without its validation,
//! because they are the same line of code.
//!
//! [`CompactionStrategy::resolve`]: crate::compaction::CompactionStrategy::resolve
//! [`MemoryStrategy::resolve`]: crate::memories::MemoryStrategy::resolve
//! [`ReadPolicy::resolve`]: crate::tools::ReadPolicy::resolve
//! [`resolve_run_limits`]: crate::limits::resolve_run_limits

use std::fmt;

use serde_json::Value;
use test_cabinet_core::gg::{
    ALL_SUBAGENT_SCOPES, AUTOLOAD_LOCKED_IMPL, AUTOLOAD_PARAM_IMAGES,
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_AGENT_PERSISTENCE, CAPABILITY_AUTOLOAD_SPECS,
    CAPABILITY_COMPACTION, CAPABILITY_CONTEXT_WINDOW_OVERRIDE, CAPABILITY_DOCVIEW_CLOSE,
    CAPABILITY_EDIT_FILE, CAPABILITY_EXEC, CAPABILITY_FORK, CAPABILITY_FSM, CAPABILITY_LIST_DIR,
    CAPABILITY_MEMORIES, CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_READ_FILE, CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SEARCH, CAPABILITY_SHELL,
    CAPABILITY_SKILLS, CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WRITE_FILE,
    COMPACTION_PARAM_MODEL, COMPACTION_PARAM_MODEL_SLOT, COMPACTION_STRATEGY_MEMORY,
    FSM_PARAM_STATES, GG_CAPABILITY_CATALOG, GgAgentConfig, GgCapabilityConfig, GgCapabilitySet,
    GgSubagentScope, MEMORY_PARAM_SCOPE, PARAM_BUILT_INS, PARAM_DOC_VIEW_TYPES, PARAM_ID_LENGTH,
    PARAM_KEEP, PARAM_LANGUAGE, PARAM_LINE_CAP, PARAM_MAX_CHARS, PARAM_MAX_COUNT, PARAM_MAX_DEPTH,
    PARAM_MAX_EPICS, PARAM_MAX_ISSUES, PARAM_MAX_LEN_DESCRIPTION, PARAM_MAX_LEN_INDEX,
    PARAM_MAX_LEN_PER_MEMORY, PARAM_MAX_LINES, PARAM_MAX_MEMORY_BYTES, PARAM_MAX_RESULTS,
    PARAM_MAX_RETRIES, PARAM_MAX_TASKS, PARAM_MAX_TOTAL_LEN, PARAM_MODE, PARAM_REVIEWERS,
    PARAM_SIGNAL_THRESHOLD_PERCENT, PARAM_SKILLS_DIR, PARAM_SUMMARY_HEADROOM, PARAM_TIMEOUT_SECS,
    PARAM_TOP_FILE_VIEWS, PARAM_WINDOW_LIMIT, PROJECT_MANAGEMENT_PARAM_MERGE_AGENT, READ_MODES,
    SHELL_OUTPUT_MODES,
};

use crate::config::GgInvocation;

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

/// **One configured value the launch cannot honour** — the unit a refusal is made of.
///
/// It is a structured record rather than a bare string so the emission site can order, count and
/// attribute defects, and so a test can assert *which* value was refused rather than pattern-match
/// prose. [`Display`](fmt::Display) renders the line that reaches the operator's log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchDefect {
    /// The [id](GgAgentConfig::id) of the agent profile the value belongs to, or `None` for a
    /// **run-level** value — one declared on the set rather than on any one profile (`limits`, the
    /// set's own shape).
    pub agent: Option<String>,
    /// Where in the configuration document the value sits, in the document's own spelling:
    /// `"compaction.implementation"`, `"limits.maxCost"`, `"tools[2]"`. Greppable, and the thing an
    /// operator actually has to go and edit.
    pub locus: String,
    /// The value **as written**, rendered for the log. Empty when the defect is about a value's
    /// absence or about the shape of the document rather than about a value.
    pub found: String,
    /// The operator-facing sentence: what gg could not do with the value, and what to do instead.
    pub message: String,
    /// The vocabulary the value was read against, when the value is drawn from a closed set. Empty
    /// when there is no such set (a free-form name, a numeric range).
    pub known: Vec<String>,
}

impl LaunchDefect {
    /// A defect in a **run-level** value — one that belongs to the set rather than to any one
    /// profile.
    pub fn run_level(
        locus: impl Into<String>,
        found: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            agent: None,
            locus: locus.into(),
            found: found.into(),
            message: message.into(),
            known: Vec::new(),
        }
    }

    /// A defect in a value declared on one **agent profile**, attributed to it by
    /// [id](GgAgentConfig::id) — profile names may repeat, so an attribution by name could point at
    /// two profiles.
    pub fn on_agent(
        agent: impl Into<String>,
        locus: impl Into<String>,
        found: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            agent: Some(agent.into()),
            ..Self::run_level(locus, found, message)
        }
    }

    /// Attach the closed vocabulary the value was read against, so the refusal tells the operator
    /// what they *could* have written rather than only that what they wrote is wrong.
    #[must_use]
    pub fn known<S: AsRef<str>>(mut self, known: impl IntoIterator<Item = S>) -> Self {
        self.known = known
            .into_iter()
            .map(|value| value.as_ref().to_string())
            .collect();
        self
    }
}

impl fmt::Display for LaunchDefect {
    /// The line the operator reads, assembled so the attribution and the locus are always present
    /// even when the message's prose does not repeat them: `agent \`root\`:
    /// compaction.implementation = \`self-compation\` — …`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(agent) = &self.agent {
            write!(f, "agent `{agent}`: ")?;
        }
        write!(f, "{}", self.locus)?;
        if !self.found.is_empty() {
            write!(f, " = `{}`", self.found)?;
        }
        write!(f, " — {}", self.message)?;
        if !self.known.is_empty() {
            let known = self
                .known
                .iter()
                .map(|value| format!("`{value}`"))
                .collect::<Vec<_>>()
                .join(", ");
            write!(f, " gg recognizes: {known}.")?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// The sink
// ---------------------------------------------------------------------------

/// **The sink every resolver reports into** — the seam that lets a resolver stay total while still
/// refusing a launch.
///
/// Two states, and which one a resolver is handed says everything about what a defect *means* at
/// that call site. See the [resolver contract](self#the-resolver-contract).
#[derive(Debug, Default)]
pub enum LaunchReport {
    /// **The launch pass.** Everything reported here is collected and, together, becomes the
    /// refusal. This is the only state in which a defect changes what gg does.
    Collecting(Vec<LaunchDefect>),
    /// **Every re-resolution after launch** — `adopt`, an `exec`/`transition` transfer, a subagent
    /// spawn, a per-turn setup. [`validate_launch`] already read this same document and proved it
    /// has nothing to report, so anything arriving here means gg read one configuration two
    /// different ways: a gg defect, asserted in debug and dropped in release (the run is already
    /// under way, and a resolver is not the place to end it).
    #[default]
    Discarding,
}

impl LaunchReport {
    /// A fresh collecting sink — what [`validate_launch`] runs the resolvers against.
    #[must_use]
    pub fn collecting() -> Self {
        Self::Collecting(Vec::new())
    }

    /// A sink for a read whose reporting **belongs to another call in this same pass**.
    ///
    /// Several checks need a value a different check owns: a cross-field check has to know a
    /// profile's declared [scope](crate::memories::resolve_scope) to decide whether its
    /// `memory-compaction` could ever be satisfied, and the scope is read — and refused — by the
    /// per-profile walk a few lines earlier. Reading it again into the *collecting* sink would name
    /// one typo twice, and reading it into a [`Discarding`](Self::Discarding) one would trip that
    /// sink's assertion, because during the pass an unhonourable value is exactly what is expected.
    ///
    /// So this is a collecting sink that is thrown away: it says "somebody else reports this", which
    /// is a different claim from `Discarding`'s "nothing here can possibly be reported", and the two
    /// must not be spelled the same way.
    #[must_use]
    pub fn already_reported() -> Self {
        Self::Collecting(Vec::new())
    }

    /// Report one value the configuration cannot honour.
    pub fn report(&mut self, defect: LaunchDefect) {
        match self {
            Self::Collecting(defects) => defects.push(defect),
            Self::Discarding => debug_assert!(
                false,
                "a resolver reported `{defect}` after the launch pass had already accepted this \
                 configuration; gg read one document two different ways"
            ),
        }
    }

    /// Whether nothing has been reported. Always true of a [`Discarding`](Self::Discarding) sink,
    /// which is the invariant the launch pass exists to establish.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        match self {
            Self::Collecting(defects) => defects.is_empty(),
            Self::Discarding => true,
        }
    }

    /// Everything reported, in the order it was reported — which is document order, because the
    /// pass walks the document — with a value named **once** however many readers named it.
    ///
    /// One value has more than one reader by design. An absent required param is reported by
    /// [`check_params`], which sweeps the whole [table](CAPABILITY_PARAMS) and so cannot miss one,
    /// *and* by the [`required_param`] call in the resolver that reads it, which is what makes a
    /// resolver unable to fall back on a value nobody wrote. Both are wanted, and both produce the
    /// same line — same profile, same locus, same sentence — because the sentence comes from the
    /// table rather than from either call site. Printing it twice would tell an operator there are
    /// two things to fix.
    ///
    /// Only an **exactly** equal defect is dropped, and only after [`for_agent`](Self::for_agent)
    /// has stamped the attributions, so two profiles short of the same param stay two lines.
    #[must_use]
    pub fn into_defects(self) -> Vec<LaunchDefect> {
        match self {
            Self::Collecting(defects) => {
                let mut named = Vec::with_capacity(defects.len());
                for defect in defects {
                    if !named.contains(&defect) {
                        named.push(defect);
                    }
                }
                named
            }
            Self::Discarding => Vec::new(),
        }
    }

    /// Run `walk`, and **attribute to `agent`** everything it reports that names no profile.
    ///
    /// A resolver reports what it can see, and most of them cannot see a profile:
    /// [`CompactionStrategy::resolve`](crate::compaction::CompactionStrategy::resolve) is handed one
    /// `Option<&str>`, [`MemoryCaps::resolve`](crate::memories::MemoryCaps::resolve) one capability.
    /// Threading a profile id through them so a defect could carry it would put the
    /// attribution in ~30 signatures that have no other use for it, and would have to be passed
    /// again by every mid-run caller that has no profile in hand either.
    ///
    /// So the walk stamps it on the way out: the pass knows whose profile it is reading, and every
    /// defect that arrived unattributed inside `walk` belongs to it. A resolver that *does* hold the
    /// profile attributes its own defect and is left exactly as it reported it.
    pub fn for_agent<T>(&mut self, agent: &str, walk: impl FnOnce(&mut Self) -> T) -> T {
        let before = match self {
            Self::Collecting(defects) => defects.len(),
            Self::Discarding => 0,
        };
        let value = walk(self);
        if let Self::Collecting(defects) = self {
            for defect in &mut defects[before..] {
                if defect.agent.is_none() {
                    defect.agent = Some(agent.to_string());
                }
            }
        }
        value
    }
}

// ---------------------------------------------------------------------------
// Reading one param
// ---------------------------------------------------------------------------

/// Where a capability `params` key sits, in the document's own spelling:
/// `compaction.params.summaryHeadroom`.
///
/// The capability id rather than its index in the profile's list, because the id is what an operator
/// searches the document for and what every diagnostic about that capability already names.
#[must_use]
pub fn param_locus(capability: &str, key: &str) -> String {
    format!("{capability}.params.{key}")
}

/// Where a capability's [`implementation`](GgCapabilityConfig::implementation) — its **arm** — sits:
/// `compaction.implementation`.
#[must_use]
pub fn implementation_locus(capability: &str) -> String {
    format!("{capability}.implementation")
}

/// One JSON value rendered for a defect's [`found`](LaunchDefect::found) field, **as the operator
/// wrote it**: a string bare, anything else as the JSON it is.
///
/// The distinction matters at exactly the moment it is read. `scope = \`communal\`` is the operator's
/// own spelling; `scope = \`3\`` next to it is unambiguous about the value being a number, because
/// the quotes that would have made it a string are absent.
#[must_use]
pub fn as_written(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// **The line a required `params` key earns by not being there** — the one place that sentence is
/// written, so the two readers that can notice the same hole produce the same defect.
///
/// [`check_params`] sweeps the [table](CAPABILITY_PARAMS) and so notices every absent required key
/// on every capability; the resolver that reads the key notices the one it reads, through
/// [`required_param`]. Both are deliberate — the sweep cannot miss a key and the resolver cannot
/// fall back on one — and [`into_defects`](LaunchReport::into_defects) drops the second copy
/// precisely because it is identical to the first.
///
/// The clause saying **what the key configures** comes out of the table with the requirement, so a
/// param added to gg carries its own sentence and no call site spells one.
///
/// Unattributed: the callers sit inside a [`for_agent`](LaunchReport::for_agent) walk, which stamps
/// the profile on the way out.
///
/// Visible to the crate so a resolver's own tests can pin that the line it produces is *this* one,
/// rather than restating the sentence and letting the two drift apart.
pub(crate) fn missing_required_param(capability: &str, key: &str) -> LaunchDefect {
    let configures = match requirement(capability, key) {
        Some(Requirement::Required(configures)) => configures,
        // A resolver reading a key the table does not mark required, or does not know at all, is a
        // gg defect: the table is what `check_params` reads the same document against, so the two
        // would be refusing different documents. The refusal still has to say something.
        other => {
            debug_assert!(
                false,
                "`{capability}` read `{key}` as a required param, and the params table says \
                 `{other:?}`"
            );
            "read by the capability"
        }
    };
    LaunchDefect::run_level(
        param_locus(capability, key),
        "",
        format!("the `{capability}` capability is on and writes no `{key}`, which is {configures}"),
    )
}

/// **One required `params` key, read and reported in one call** — the only way a resolver reads a
/// key the [table](CAPABILITY_PARAMS) marks [required](Requirement::Required).
///
/// `Some(value)` is the value as written, for the caller to read against its own vocabulary.
/// `None` says the key is absent or explicitly `null`, and by the time it comes back the launch is
/// already refused: the resolver's remaining job is to hand its caller an explicitly **named
/// placeholder**, never a `Default` and never `.unwrap_or_default()`, so the next reader of that
/// line can see the value configures nothing.
///
/// Pairing the read with the report is the whole point. A resolver cannot reach a required key
/// without the reaching *being* the reporting, so there is no way to write the fallback back in by
/// accident, and the vocabulary and its validation stay one line of code.
///
/// **It is for a capability the caller has already established is on.** Requirement is a property
/// of the switch, not of the key, and this reader is handed a params object with no switch in it —
/// so a check that walks a profile's *disabled* capabilities to read what they carry reads them
/// with [`count_param`] and `params.get`, which say nothing about an absence that is not a defect.
///
/// **A `params` that is not an object at all is [reported as the shape it is](check_params), once,
/// and nothing is reported here.** Every key is missing from a string, and a list of every param it
/// is short of would bury the one line that says why — so the absence still comes back, and the
/// launch is still refused, by the line that names the cause rather than the symptoms.
pub fn required_param<'a>(
    params: &'a Value,
    capability: &str,
    key: &str,
    report: &mut LaunchReport,
) -> Option<&'a Value> {
    match params.get(key).filter(|value| !value.is_null()) {
        Some(value) => Some(value),
        None if params.is_object() || params.is_null() => {
            report.report(missing_required_param(capability, key));
            None
        }
        None => None,
    }
}

/// One JSON value read as a count — the parsing half of [`count_param`], shared with the required
/// readers so every integral param is read exactly one way.
///
/// **An integral float is a valid count**, and that is deliberate rather than lenient. JSON has no
/// integer type: a sweep generated from JavaScript writes `1e8` and a hand-rounded `100.0` as
/// readily as `100`, and reading only the integer form would refuse a figure its author wrote
/// plainly. `100.5` is a different matter: it names no count, and rounding it would be gg choosing
/// a number nobody wrote.
///
/// Everything else — a string, a boolean, a negative, a fraction, an infinity, a number past `u64`,
/// an array — is reported and `None` comes back, keeping the resolver total while the launch is
/// refused.
fn read_count(
    value: &Value,
    capability: &str,
    key: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    if let Some(count) = value.as_u64() {
        return Some(count);
    }
    if let Some(count) = value.as_f64().filter(|number| {
        number.is_finite() && *number >= 0.0 && number.fract() == 0.0 && *number <= u64::MAX as f64
    }) {
        return Some(count as u64);
    }
    report.report(LaunchDefect::run_level(
        param_locus(capability, key),
        value.to_string(),
        format!("the `{capability}` capability's `{key}` must be a whole number of zero or more"),
    ));
    None
}

/// **One optional `params` key read as a count** — the spelling every integral param whose absence
/// is itself a setting uses.
///
/// `None` means the key is absent or explicitly `null`, which is the caller's answer that the thing
/// it bounds is **off**: no ceiling, nothing substituted, nothing reported. A key the table marks
/// [required](Requirement::Required) is read through [`required_count_param`] instead, which is the
/// same reader with the absence reported.
///
/// `Some(n)` is a number naming the whole, non-negative `n`. What `0` means is the caller's business
/// — it is "unlimited" for a [memory limit](crate::memories::MemoryCaps) and "keep everything" for
/// the [program library](crate::programs), and neither is this function's to decide.
pub fn count_param(
    params: &Value,
    capability: &str,
    key: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    let value = params.get(key).filter(|value| !value.is_null())?;
    read_count(value, capability, key, report)
}

/// **One required `params` key read as a count** — [`required_param`] and [`count_param`] in one
/// call, which is how a resolver reads every integral param an enabled capability must write.
///
/// `None` covers both halves of the refusal: the key was absent, or it named no count. Either way
/// the launch is already refused by the time it comes back, and the resolver hands its caller a
/// named placeholder.
pub fn required_count_param(
    params: &Value,
    capability: &str,
    key: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    let value = required_param(params, capability, key, report)?;
    read_count(value, capability, key, report)
}

/// One count checked against the keys whose `0` bounds nothing — the shared half of
/// [`positive_count_param`] and [`required_positive_count_param`].
///
/// A ceiling of zero is not a spelling of "off": a board that may hold no epics, a list that may
/// hold no tasks or a tree an agent may not spawn into offers calls whose every use is refused, so
/// the capability is on and inert. `consequence` says, in the capability's own terms, what a zero
/// would have meant — the sentence an operator needs to know which knob they got wrong.
fn at_least_one(
    count: u64,
    capability: &str,
    key: &str,
    consequence: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    if count > 0 {
        return Some(count);
    }
    report.report(LaunchDefect::run_level(
        param_locus(capability, key),
        count.to_string(),
        format!("the `{capability}` capability's `{key}` must be one or more ({consequence})"),
    ));
    None
}

/// **One optional `params` key read as a count that must be at least one** — [`count_param`] for
/// the keys whose `0` bounds nothing. Absent is the caller's "off", exactly as in [`count_param`].
pub fn positive_count_param(
    params: &Value,
    capability: &str,
    key: &str,
    consequence: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    let count = count_param(params, capability, key, report)?;
    at_least_one(count, capability, key, consequence, report)
}

/// **One required `params` key read as a count that must be at least one** — the reader for the
/// integral params an enabled capability must write and whose `0` would leave it on and inert.
pub fn required_positive_count_param(
    params: &Value,
    capability: &str,
    key: &str,
    consequence: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    let count = required_count_param(params, capability, key, report)?;
    at_least_one(count, capability, key, consequence, report)
}

/// **One optional `params` key read as a whole percentage** — [`count_param`] bounded at a hundred,
/// for a key that names a share of something rather than a size of it.
///
/// `None` is the key absent, `null`, or a value gg cannot read as a percentage — the launch is
/// already refused in the last case — and the caller answers it the way it answers every absence:
/// with the setting the document's silence names, never with a figure it invented for a value it
/// could not read.
///
/// A hundred and one is not a share of anything, so it is refused rather than clamped: an operator
/// who wrote `750` meaning three quarters is told so, instead of running under a threshold no
/// window ever reaches and reading nothing in the record that says why.
pub fn percent_param(
    params: &Value,
    capability: &str,
    key: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    let percent = count_param(params, capability, key, report)?;
    if percent <= 100 {
        return Some(percent);
    }
    report.report(LaunchDefect::run_level(
        param_locus(capability, key),
        percent.to_string(),
        format!(
            "the `{capability}` capability's `{key}` is a percentage, so it must be between 0 \
             and 100"
        ),
    ));
    None
}

// ---------------------------------------------------------------------------
// The params vocabulary
// ---------------------------------------------------------------------------

/// **What one `params` key's absence means** — the second column of [`CAPABILITY_PARAMS`], and the
/// whole of gg's answer to a value nobody wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requirement {
    /// **Written on every declaration of the capability that is switched on.** Absent or `null`
    /// refuses the launch, because gg has nothing to put there: the figure would be one gg chose,
    /// and a run conducted under a figure nobody wrote is a run whose record names a configuration
    /// that was not conducted.
    ///
    /// The payload is what the key configures, in the capability's own terms and reading as the
    /// object of "which is" — the clause [`missing_required_param`] hands the operator, so the
    /// refusal says *which* knob is missing rather than only that one is.
    Required(&'static str),
    /// **The absence is itself the setting.** No summarizer model, so the agent condenses on its
    /// own; no reviewer requirement, so an issue's author names reviewers or does not. gg records
    /// what the document says and substitutes nothing, and a value written here is read and refused
    /// on the ordinary terms.
    OffWhenAbsent,
    /// **The absence names a figure gg holds.** The one classification that stands something in
    /// for a value nobody wrote, and it covers one shape of key: a knob that holds a piece of gg
    /// back until it is worth its cost, where "off" is the setting nobody wants and requiring it
    /// would put a number in front of every operator with no opinion about it.
    ///
    /// What keeps it honest is that the figure is **written into every new document** by the
    /// [authoring catalog](test_cabinet_core::gg::gg_authoring_catalog), so the value a run was
    /// conducted under is in that run's record whether or not the operator touched the key. The
    /// figure itself lives beside the param constant it belongs to, so the resolver that reads the
    /// key and the catalog that writes it name one number.
    ///
    /// A value that *is* written is read and refused on the ordinary terms.
    DefaultWhenAbsent,
}

/// **Every `params` key each capability accepts, and what its absence means**, in one table — the
/// closed vocabulary a capability's free-form params object is read against, and the classification
/// that decides whether a key nobody wrote refuses the launch.
///
/// [`params`](GgCapabilityConfig::params) is a `serde_json::Value`, so
/// `#[serde(deny_unknown_fields)]` can never reach inside it: this table is the only thing standing
/// between `summryHeadroom` and a run that condensed at some other headroom while its record named
/// the configured one — and, in its second column, the only thing standing between an enabled
/// capability with a hole in it and a run gg quietly filled the hole for.
///
/// Three rules the table encodes deliberately:
///
/// - **A key must be known to the *capability*, not necessarily used by the selected arm.** A
///   `maxResults` on a `scratchpad` memories run is accepted, because sweeping one shared params
///   block across all three memory strategies without retyping it is the point of the block. The
///   same argument makes a key **required whichever arm is selected**: a sweep that varies the arm
///   over one params block is judged the same way on every launch in it. See the memories
///   documentation.
/// - **A key known to *another* capability is still unknown here.** [`scope`](MEMORY_PARAM_SCOPE)
///   is offered by the memories capability and by no other, so a `scope` on `skills` or `tasks`
///   is a refusal rather than a key read by nothing.
/// - **Requirement is a property of the capability being on**, not of the key existing. A
///   [disabled](GgCapabilityConfig::enabled) capability configures nothing, so nothing is required
///   of it; see [`check_params`].
///
/// Every entry names a `PARAM_*` constant rather than a string literal, so the table and the
/// resolver that reads the key cannot drift apart, and the table's own test pins that it covers
/// [`GG_CAPABILITY_CATALOG`] exactly — a capability missing from it would refuse every param written
/// on it, and an entry outside it would be read by nothing.
const CAPABILITY_PARAMS: &[(&str, &[(&str, Requirement)])] = &[
    (
        CAPABILITY_SHELL,
        &[
            (
                PARAM_MAX_LINES,
                Requirement::Required(
                    "how many trailing lines of a command's output come back inline",
                ),
            ),
            (
                PARAM_MAX_CHARS,
                Requirement::Required("how many trailing characters of it do"),
            ),
        ],
    ),
    (
        CAPABILITY_READ_FILE,
        &[(
            PARAM_LINE_CAP,
            Requirement::Required("how many lines a read that names no limit of its own is given"),
        )],
    ),
    (CAPABILITY_WRITE_FILE, &[]),
    (CAPABILITY_EDIT_FILE, &[]),
    (CAPABILITY_LIST_DIR, &[]),
    (CAPABILITY_SEARCH, &[]),
    (
        CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
        &[(
            PARAM_WINDOW_LIMIT,
            Requirement::Required(
                "the ceiling, in tokens, this agent's model window is narrowed to",
            ),
        )],
    ),
    (
        CAPABILITY_AUTOLOAD_SPECS,
        &[(
            AUTOLOAD_PARAM_IMAGES,
            Requirement::Required("whether a seeded reference mockup arrives as a picture"),
        )],
    ),
    (CAPABILITY_AGENT_PERSISTENCE, &[]),
    (
        CAPABILITY_SKILLS,
        &[
            (
                PARAM_SKILLS_DIR,
                Requirement::Required(
                    "the directory this profile's authored skills are loaded from",
                ),
            ),
            (
                PARAM_BUILT_INS,
                Requirement::Required("which of the skills gg ships this agent is offered"),
            ),
        ],
    ),
    (
        CAPABILITY_MEMORIES,
        &[
            (
                MEMORY_PARAM_SCOPE,
                Requirement::Required("which memory instance this agent's instances bind to"),
            ),
            (
                PARAM_MAX_COUNT,
                Requirement::Required("how many memories the set may hold at once"),
            ),
            (
                PARAM_MAX_LEN_PER_MEMORY,
                Requirement::Required("the characters one memory's body may run to"),
            ),
            (
                PARAM_MAX_TOTAL_LEN,
                Requirement::Required("the characters every memory body runs to together"),
            ),
            (
                PARAM_MAX_LEN_INDEX,
                Requirement::Required("the characters the pinned index may run to"),
            ),
            (
                PARAM_MAX_LEN_DESCRIPTION,
                Requirement::Required("the characters one memory's description may run to"),
            ),
            (
                PARAM_MAX_RESULTS,
                Requirement::Required("how many hits one search reports"),
            ),
        ],
    ),
    (
        CAPABILITY_TASKS,
        &[
            (
                PARAM_MAX_TASKS,
                Requirement::Required("how many tasks the list may hold at once"),
            ),
            (
                PARAM_MODE,
                Requirement::Required("how much structure one task carries"),
            ),
        ],
    ),
    (
        CAPABILITY_COMPACTION,
        &[
            (
                PARAM_SUMMARY_HEADROOM,
                Requirement::Required(
                    "the slice of the window held back for the summarization round trip",
                ),
            ),
            (PARAM_MAX_RETRIES, Requirement::OffWhenAbsent),
            (COMPACTION_PARAM_MODEL, Requirement::OffWhenAbsent),
            (COMPACTION_PARAM_MODEL_SLOT, Requirement::OffWhenAbsent),
        ],
    ),
    (
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        &[
            (
                PARAM_TOP_FILE_VIEWS,
                Requirement::Required("how many files the context-usage breakdown names"),
            ),
            (
                PARAM_SIGNAL_THRESHOLD_PERCENT,
                Requirement::DefaultWhenAbsent,
            ),
        ],
    ),
    (
        CAPABILITY_PROJECT_MANAGEMENT,
        &[
            (
                PARAM_MAX_EPICS,
                Requirement::Required("how many epics the board may hold at once"),
            ),
            (
                PARAM_MAX_ISSUES,
                Requirement::Required("how many issues the board may hold at once"),
            ),
            (
                PARAM_MAX_RETRIES,
                Requirement::Required("how many times a failed issue is dispatched again"),
            ),
            (PARAM_REVIEWERS, Requirement::OffWhenAbsent),
            (
                PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
                Requirement::Required("which profile resolves a conflicting merge"),
            ),
        ],
    ),
    (
        CAPABILITY_SUBAGENTS,
        &[(
            PARAM_MAX_DEPTH,
            Requirement::Required("how deep the run's delegation tree may go"),
        )],
    ),
    (
        CAPABILITY_FSM,
        &[(
            FSM_PARAM_STATES,
            Requirement::Required("the machine's states, the first of which is where it starts"),
        )],
    ),
    (CAPABILITY_EXEC, &[]),
    (CAPABILITY_FORK, &[]),
    (
        CAPABILITY_RESPONSES_AS_CODE,
        &[
            (
                PARAM_LANGUAGE,
                Requirement::Required("the language this agent writes its programs in"),
            ),
            (
                PARAM_TIMEOUT_SECS,
                Requirement::Required("the guest-CPU ceiling one program runs under"),
            ),
            (
                PARAM_MAX_MEMORY_BYTES,
                Requirement::Required("the linear-memory ceiling one program runs under"),
            ),
            (
                PARAM_DOC_VIEW_TYPES,
                Requirement::Required("which of a function's types open beside its documentation"),
            ),
        ],
    ),
    (
        CAPABILITY_PROGRAM_LIBRARY,
        &[
            (
                PARAM_KEEP,
                Requirement::Required("how many of the session's programs the library retains"),
            ),
            (
                PARAM_ID_LENGTH,
                Requirement::Required("how many characters long each program's id is"),
            ),
        ],
    ),
    (CAPABILITY_DOCVIEW_CLOSE, &[]),
];

/// The params vocabulary of the capability `id` names, or `None` when the id is not one gg ships —
/// in which case the id itself is already the defect and its params have nothing to be read
/// against.
fn params_for(id: &str) -> Option<&'static [(&'static str, Requirement)]> {
    CAPABILITY_PARAMS
        .iter()
        .find(|(capability, _)| *capability == id)
        .map(|(_, params)| *params)
}

/// What one capability's `key` means when nobody writes it, or `None` when the capability does not
/// read a `key` at all. The lookup [`missing_required_param`] words its sentence from.
fn requirement(capability: &str, key: &str) -> Option<Requirement> {
    params_for(capability)?
        .iter()
        .find(|(known, _)| *known == key)
        .map(|(_, requirement)| *requirement)
}

/// **Every capability that offers arms, and whether an enabled one must name one** — the
/// [`implementation`](GgCapabilityConfig::implementation) half of "an enabled capability is fully
/// specified".
///
/// The *vocabulary* of each is not repeated here; [`arms_of`] reads it from the resolver that
/// selects on it, which is what keeps the two from drifting. What the table decides is the two
/// questions no resolver can answer, because on one side of each there is no resolver to reach the
/// field:
///
/// - **A capability that offers no arms must not name one.** An `implementation` written on one of
///   the other seventeen configures nothing, is recorded in the run's own capability set as though it
///   had, and no code anywhere ever looks at it.
/// - **A capability that offers arms and is switched on must name one**, because the arm is the
///   capability's own experimental variable and gg selects none on an operator's behalf.
///   [Autoload specifications](CAPABILITY_AUTOLOAD_SPECS) is the exception, and it is an exception
///   to the *arm* rather than to the ruling: its one arm [`locked`](AUTOLOAD_LOCKED_IMPL) pins the
///   seeded specifications into the window, and writing nothing is the declaration that they are
///   ordinary file views. That is a reading of absence, not a substitution for it — the two states
///   are both writable and both meant — so an unwritten arm there is a configured run rather than
///   an unspecified one.
///
/// [Memories](CAPABILITY_MEMORIES) is [required](ArmRule::Required) like the rest of them, including
/// on an [`inherited`](crate::memories::MemoryScope::Inherited) profile. Such a profile usually
/// binds the store its spawner keeps and is read by that store's own strategy's calls — but every
/// place gg starts one *without* a spawner (the root, an issue's implementer, a reviewer, a subagent
/// whose spawner keeps no memories) it organizes a notebook of its own instead, and an arm it never
/// named would be one gg chose. So it names the organization it works in, and
/// [`check_scoping`](crate::memories::check_scoping) refuses a pairing whose two profiles name
/// different ones.
const CAPABILITIES_WITH_ARMS: &[(&str, ArmRule)] = &[
    (CAPABILITY_COMPACTION, ArmRule::Required),
    (CAPABILITY_MEMORIES, ArmRule::Required),
    (CAPABILITY_READ_FILE, ArmRule::Required),
    (CAPABILITY_SHELL, ArmRule::Required),
    (CAPABILITY_AUTOLOAD_SPECS, ArmRule::AbsenceIsAnArm),
];

/// What an enabled capability that names no arm is saying — the second column of
/// [`CAPABILITIES_WITH_ARMS`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArmRule {
    /// Nothing gg can act on: the launch is refused, and the refusal offers [the arms](arms_of).
    Required,
    /// One of the capability's own settings, and the one the arm it does offer is the alternative
    /// to. Nothing is reported.
    AbsenceIsAnArm,
}

/// Whether the capability `id` offers arms at all, and under which rule.
fn arm_rule(id: &str) -> Option<ArmRule> {
    CAPABILITIES_WITH_ARMS
        .iter()
        .find(|(capability, _)| *capability == id)
        .map(|(_, rule)| *rule)
}

/// The arms `id` offers, **read from the code that selects on them** rather than restated here, so
/// a refusal offers exactly the names the resolver would accept. Empty for the seventeen capabilities
/// that offer none.
fn arms_of(id: &str) -> Vec<&'static str> {
    match id {
        CAPABILITY_SHELL => SHELL_OUTPUT_MODES.to_vec(),
        CAPABILITY_READ_FILE => READ_MODES.to_vec(),
        CAPABILITY_MEMORIES => crate::memories::MemoryStrategy::ALL
            .map(crate::memories::MemoryStrategy::id)
            .to_vec(),
        CAPABILITY_COMPACTION => crate::compaction::CompactionStrategy::ALL
            .map(crate::compaction::CompactionStrategy::id)
            .to_vec(),
        CAPABILITY_AUTOLOAD_SPECS => vec![AUTOLOAD_LOCKED_IMPL],
        _ => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/// **Prove this run can be conducted exactly as it is written**, or refuse it with every reason at
/// once.
///
/// Total and pure: it reads the invocation, touches nothing, and either accepts or returns the
/// complete list of values gg could not honour. Called once, at the top of the session frame —
/// after [`SessionStarted`](test_cabinet_core::gg::GgTelemetryKind::SessionStarted) is emitted, so a
/// console still shows what was attempted, and before any client is resolved, so a configuration
/// typo is never masked by a credential error.
///
/// The defects come back in document order, which is the order an operator will fix them in.
pub fn validate_launch(invocation: &GgInvocation) -> Result<(), Vec<LaunchDefect>> {
    let mut report = LaunchReport::collecting();
    check_set(&invocation.capability_set, &mut report);
    // The handful of checks that need more of the invocation than the set: a skills directory is
    // resolved against the **workspace**, which arrives beside the set rather than in it.
    crate::agent::check_invocation(invocation, &mut report);
    let defects = report.into_defects();
    if defects.is_empty() {
        Ok(())
    } else {
        Err(defects)
    }
}

/// **The second gate: prove the run's *workspace* carries what its configuration promises**, or
/// refuse it with every reason at once.
///
/// [`validate_launch`] is pure and reads the invocation document. This one reads the **filesystem**,
/// and it exists because two capabilities are configured in the document and *satisfied* by the
/// workspace:
///
/// - [skills](crate::skills) — a directory of authored guides. A `dir` gg cannot open, an entry that
///   is not a skill, front matter that will not parse, two skills claiming one name, a blank code
///   file, or a skill whose code is spelled in no language an agent that could read it writes.
/// - [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) — the test case's own specs and reference
///   images, which the capability promises an agent **in full**.
///
/// Neither is decidable from the document, and both are decidable **before the first turn**: the run
/// container's workspace is fully seeded by the time gg's process starts, so "after seeding, before
/// anything is spent" is exactly here. It is a second function rather than more of the first because
/// the first is pure, is called from tests that have no workspace, and must stay that way.
///
/// The defects are the same [`LaunchDefect`]s, refused the same way and printed in the same list, so
/// an operator sees one refusal naming everything wrong with the run — whichever half of it is
/// wrong.
pub fn validate_workspace(invocation: &GgInvocation) -> Result<(), Vec<LaunchDefect>> {
    let mut report = LaunchReport::collecting();
    crate::agent::check_workspace(invocation, &mut report);
    check_provided_files(invocation, &mut report);
    let defects = report.into_defects();
    if defects.is_empty() {
        Ok(())
    } else {
        Err(defects)
    }
}

/// Every file the [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) capability promises has to be
/// there and has to be readable.
///
/// The capability's promise is the **full** specification: an agent's opening context is seeded with
/// every file the test case provided, injected as though it had read each itself. A file gg skipped
/// left the agent with part of the brief and the run measuring something other than the arm it was
/// configured as — and the synthesized program was rewritten to list only the files that did arrive,
/// so the transcript did not show the hole either.
///
/// Checked only when some profile actually enables the capability: a run whose agents read what they
/// need for themselves is not owed these files, and a spec it never opens is not its business.
fn check_provided_files(invocation: &GgInvocation, report: &mut LaunchReport) {
    if !invocation
        .capability_set
        .agents
        .iter()
        .any(|agent| agent.is_enabled(CAPABILITY_AUTOLOAD_SPECS))
    {
        return;
    }
    for path in &invocation.provided_files {
        let full = invocation.workspace_dir.join(path);
        // Opened rather than stat'd: "it is there" and "gg can read it" are different questions, and
        // the second is the one the first turn asks.
        let readable = match std::fs::File::open(&full) {
            Ok(_) => full.is_file(),
            Err(_) => false,
        };
        if readable {
            continue;
        }
        report.report(LaunchDefect::run_level(
            path.display().to_string(),
            "",
            format!(
                "the `{CAPABILITY_AUTOLOAD_SPECS}` capability seeds every file the test case \
                 provided, and gg cannot read this one at `{}`",
                full.display(),
            ),
        ));
    }
}

/// The set-scoped half of [`validate_launch`] — everything decidable from the
/// [capability set](GgCapabilitySet) alone, which is all of it but the
/// [skills directories](crate::agent::check_invocation), whose paths are resolved against the
/// workspace the invocation carries.
///
/// Split out because the set is what almost every check reads and what almost every test has in
/// hand; [`validate_launch`] is the entry point that owns the whole invocation.
#[cfg(test)]
pub fn validate_capability_set(set: &GgCapabilitySet) -> Result<(), Vec<LaunchDefect>> {
    let mut report = LaunchReport::collecting();
    check_set(set, &mut report);
    let defects = report.into_defects();
    if defects.is_empty() {
        Ok(())
    } else {
        Err(defects)
    }
}

/// Walk the whole document, reporting into `report`. Split by group, in the order an operator reads
/// the document: the set's shape, then each profile, then the checks that need every profile in
/// hand at once.
fn check_set(set: &GgCapabilitySet, report: &mut LaunchReport) {
    // The root is the *first* profile, whatever it is called — an operator may rename it or promote
    // another profile to it — so what has to be true here is that there is one at all. Checked
    // first, and alone: everything below (and `GgCapabilitySet::root`) assumes it, so continuing
    // would report a cascade of consequences rather than the cause.
    if set.agents.is_empty() {
        report.report(LaunchDefect::run_level(
            "agents",
            "",
            "no agent profiles are declared; there is no model to run.",
        ));
        return;
    }
    // The run-level guardrails, read before any profile: they belong to the set rather than to any
    // one agent, and they are the first thing an operator writes in the document.
    crate::limits::check_launch(set, report);
    crate::subagents::check_launch(set, report);
    crate::loopguard::check_launch(set, report);
    // The run's own hooks, which hang off the set rather than off a profile. Each profile's are
    // read in the same call, because a hook's `output` is judged the same way wherever it was
    // declared and there is nothing else in a hook this pass reads.
    crate::hooks::check_launch(set, report);
    check_profile_ids(set, report);
    check_slot_declarations(set, report);
    for agent in &set.agents {
        // Attributed on the way out, exactly as the resolvers below are: the shape checks name the
        // profile themselves, and the absent-required-param sweep shares its defect with the
        // resolver that reads the same key, which has no profile in hand.
        report.for_agent(&agent.slug, |report| check_capabilities(agent, report));
        // Every resolver that reads one of this profile's capability values, run against a
        // collecting sink — the same functions, reading the same `PARAM_*` constants, that the run
        // itself will use. Their defects arrive unattributed (a resolver is handed a params object,
        // not a profile), so the walk stamps this profile's id on them.
        report.for_agent(&agent.slug, |report| {
            crate::memories::check_launch(agent, report);
            crate::compaction::check_launch(agent, report);
            crate::tasks::check_launch(agent, report);
            crate::board::check_launch(agent, report);
            crate::programs::check_launch(agent, report);
            crate::tools::check_launch(agent, report);
            crate::sandbox::check_launch(agent, report);
            crate::docs::check_launch(agent, report);
            crate::skills::builtin::check_launch(agent, report);
            crate::prompts::check_launch(agent, report);
            crate::agent::check_launch(agent, report);
        });
    }
    check_rosters(set, report);
    check_run_level_params(set, report);
    crate::memories::check_scoping(set, report);
    check_memory_compaction(set, report);
    check_merge_agent(set, report);
    // Every machine the set declares, checked structurally: an FSM shell with no states, a state
    // naming a profile nobody declared, an edge leading nowhere, a state nothing can enter. These
    // belong with the refusals for the same reason a roster reference to an undeclared profile
    // does — a run carrying one is not a differently-configured run, it is an unrunnable one, or
    // one that runs a strictly smaller process than the one written down.
    crate::fsm::check_launch(set, report);
    // …and the two delegation capabilities, whose failure mode is a **tool that is not offered**:
    // the one misconfiguration a model can never report, because it simply never makes the call and
    // the run reads as one where the agent chose not to.
    crate::agent::transitions::check_launch(set, report);
}

/// Whether `agent` may write memories, **as far as the document can say**.
///
/// The live answer depends on how an instance was spawned — a profile scoped
/// [`inherited`](crate::memories::MemoryScope::Inherited) holds whatever its spawner offered it — so
/// this is deliberately the *declared* answer: the capability is on, and the profile has not scoped
/// itself [`read-only`](crate::memories::MemoryScope::ReadOnly). It is what
/// [`check_memory_compaction`] judges a declared [memory
/// compaction](test_cabinet_core::gg::COMPACTION_STRATEGY_MEMORY) against.
fn memories_writable(agent: &GgAgentConfig) -> bool {
    agent.is_enabled(CAPABILITY_MEMORIES)
        && crate::memories::resolve_scope(agent, &mut LaunchReport::already_reported())
            != crate::memories::MemoryScope::ReadOnly
}

/// **A memory compaction that could never be performed** — the statically decidable half of the
/// prerequisite the [`memory-compaction`](test_cabinet_core::gg::COMPACTION_STRATEGY_MEMORY)
/// strategy carries.
///
/// That strategy asks the agent to write its working state into its memories instead of a summary.
/// An agent with no memories, or with a `read-only` handle on somebody else's, has no call that
/// could do it. The refusal is the whole of gg's answer: an arm gg cannot conduct never resolves to
/// another one, because a run that condensed in prose while its record named the memory arm would
/// make two profiles of a compaction study the same arm, with the cost split as the only place it
/// ever showed.
///
/// Only the **declared** contradiction is refusable here: whether an
/// [`inherited`](crate::memories::MemoryScope::Inherited) instance actually got a writable handle
/// depends on who spawned it, and that is the run's own to report.
///
/// Checked only where compaction is switched **on**. A disabled capability compacts by no strategy
/// at all, so there is nothing for the memories to fail to satisfy.
fn check_memory_compaction(set: &GgCapabilitySet, report: &mut LaunchReport) {
    for agent in &set.agents {
        let names_memory_strategy = agent
            .capability(CAPABILITY_COMPACTION)
            .filter(|capability| capability.enabled)
            .and_then(|capability| capability.implementation.as_deref())
            .map(str::trim)
            == Some(COMPACTION_STRATEGY_MEMORY);
        if !names_memory_strategy || memories_writable(agent) {
            continue;
        }
        let why = if agent.is_enabled(CAPABILITY_MEMORIES) {
            format!(
                "holds its memories `{}`, so it is offered no call that changes them",
                crate::memories::MemoryScope::ReadOnly
            )
        } else {
            format!("has no `{CAPABILITY_MEMORIES}` capability at all")
        };
        report.report(LaunchDefect::on_agent(
            &agent.slug,
            implementation_locus(CAPABILITY_COMPACTION),
            COMPACTION_STRATEGY_MEMORY,
            format!(
                "the `{COMPACTION_STRATEGY_MEMORY}` strategy condenses a thread by writing the \
                 agent's working state into its memories, and `{}` {why}. Give it writable \
                 memories, or name a strategy that condenses in prose.",
                agent.slug,
            ),
        ));
    }
}

/// A set gg is handed declares **no model slots**, at either level, and carries no profile's
/// internal [id](GgAgentConfig::id).
///
/// A slot is a launch input, and launching fills every one of them in: what reaches gg is a set of
/// pinned bindings. A declaration still on the document therefore means the launch skipped it, and
/// gg has no slot table to fill it from — the same fault the deferred
/// [binding](GgAgentConfig::model_slot) reports, caught on the declaration side so a launch that
/// bound the bindings but left the declarations behind is named for what it is.
fn check_slot_declarations(set: &GgCapabilitySet, report: &mut LaunchReport) {
    // The other half of the same resolution: an authored configuration points every reference at a
    // profile's internal id, and launching rewrites each one to that profile's slug and drops the
    // ids. One still here means gg is about to resolve references naming ids nothing will match.
    for agent in &set.agents {
        if let Some(id) = agent.id.as_deref() {
            report.report(LaunchDefect::on_agent(
                &agent.slug,
                "id",
                id,
                format!(
                    "the `{}` agent still carries an internal id; launching drops the ids, so \
                     this launch was incomplete",
                    agent.slug
                ),
            ));
        }
    }

    for (index, slot) in set.model_slots.iter().enumerate() {
        report.report(LaunchDefect::run_level(
            format!("modelSlots[{index}].name"),
            &slot.name,
            format!(
                "the set still declares the `{}` model slot; a bound launch resolves every slot \
                 and carries none, so this launch was incomplete",
                slot.name
            ),
        ));
    }
    for agent in &set.agents {
        for (index, slot) in agent.model_slots.iter().enumerate() {
            report.report(LaunchDefect::on_agent(
                &agent.slug,
                format!("modelSlots[{index}].name"),
                &slot.name,
                format!(
                    "the `{}` agent still declares the `{}` model slot; a bound launch resolves \
                     every slot and carries none.",
                    agent.slug, slot.name
                ),
            ));
        }
    }
}

/// Every profile must have a well-formed, unique [slug](GgAgentConfig::id) and — unless it is an
/// [FSM shell](crate::fsm::is_shell), which runs no model — a resolved model.
///
/// The slug is the whole of how a profile is addressed: a roster entry, an FSM state, an issue's
/// assignee and its reviewers, the merge agent, and every telemetry row all carry one, and
/// [`GgCapabilitySet::agent`] answers with the *first* profile that has it. So a repeated slug is
/// not a cosmetic clash — it makes every reference to it ambiguous, and silently binds each one to
/// the earlier profile. A profile's [name](GgAgentConfig::name) is display text that nothing
/// resolves, so a launch does not read one at all.
///
/// The [shape](test_cabinet_core::gg::is_valid_agent_slug) is checked for the same reason the slug
/// is what the model is shown: a name the model has to decide how to spell is a name it will
/// sometimes spell wrong, and the call that carries the misspelling is refused rather than
/// delivered.
fn check_profile_ids(set: &GgCapabilitySet, report: &mut LaunchReport) {
    let mut seen: Vec<&str> = Vec::with_capacity(set.agents.len());
    for (index, agent) in set.agents.iter().enumerate() {
        let id = agent.slug.trim();
        if id.is_empty() {
            report.report(LaunchDefect::run_level(
                format!("agents[{index}].id"),
                "",
                "an agent profile has an empty id; every reference to a profile is by id, so it \
                 must have one.",
            ));
            // Nothing below can be attributed to a profile with no id, and the roster and machine
            // checks resolve ids too — so report the cause and leave the consequences alone.
            continue;
        }
        if !test_cabinet_core::gg::is_valid_agent_slug(id) {
            report.report(LaunchDefect::run_level(
                format!("agents[{index}].id"),
                id,
                format!(
                    "`{id}` is not a well-formed profile slug; the model is shown this name and \
                     passes it back, so a slug is lowercase letters and digits in groups separated \
                     by single hyphens."
                ),
            ));
        }
        // An FSM shell is exempt from both model checks below, and from nothing else: a machine
        // takes no turns, so a model on it would be a value nothing reads rather than the thing that
        // makes it runnable. Its states' profiles are checked as the workers they are.
        if !crate::fsm::is_shell(agent) {
            if agent
                .model_slot
                .as_deref()
                .is_some_and(|_| !agent.is_resolved())
            {
                // A configuration is launched, not run: whoever launched it was supposed to bind a
                // model to every deferred profile. One left over means the launch skipped it.
                report.report(LaunchDefect::on_agent(
                    id,
                    "modelSlot",
                    agent.model_slot.clone().unwrap_or_default(),
                    format!(
                        "the `{id}` agent still defers to a model slot; launching must bind a \
                         model to it."
                    ),
                ));
            } else if !agent.is_resolved() {
                report.report(LaunchDefect::on_agent(
                    id,
                    "model",
                    "",
                    format!("the `{id}` agent is bound to an empty model id."),
                ));
            }
        }
        if seen.contains(&id) {
            report.report(LaunchDefect::on_agent(
                id,
                format!("agents[{index}].id"),
                id,
                format!(
                    "the `{id}` profile id is declared more than once; a reference resolves to \
                     the first profile that has it"
                ),
            ));
        }
        seen.push(id);
    }
}

/// Every capability this profile declares must be one gg ships, declared **once**, with an
/// `implementation` it has arms to select between and `params` keys it reads — and, where it is
/// switched **on**, with the arm and the params it requires actually written.
///
/// Every value written is read whether the capability is [enabled](GgCapabilityConfig::enabled) or
/// not. A disabled capability is still configuration — it records the configuration the arm *would*
/// have used so two sets differing only in that switch stay comparable — and a typo in it is a typo
/// an operator wants told about now rather than on the launch where they flip the switch. What the
/// switch decides is what may be **left out**: an off capability configures nothing, so it requires
/// nothing.
fn check_capabilities(agent: &GgAgentConfig, report: &mut LaunchReport) {
    let mut seen: Vec<&str> = Vec::with_capacity(agent.capabilities.len());
    for (index, capability) in agent.capabilities.iter().enumerate() {
        let Some(known) = params_for(&capability.id) else {
            report.report(
                LaunchDefect::on_agent(
                    &agent.slug,
                    format!("capabilities[{index}].id"),
                    &capability.id,
                    format!(
                        "`{}` is not a capability gg ships; nothing would switch it on, and the \
                         run's own record would claim it was configured.",
                        capability.id
                    ),
                )
                .known(GG_CAPABILITY_CATALOG),
            );
            // Its params have nothing to be read against — the id is the defect.
            continue;
        };
        // A profile's capability is looked up by id, and a lookup answers with the *first* match:
        // every switch, arm and param on a second entry of the same id is read by nothing, whatever
        // it says and however it contradicts the first. That is the refusal policy's own failure
        // with its machinery fully intact and simply bypassed — the second entry's typos are never
        // reached by the resolver that would have refused them.
        if seen.contains(&capability.id.as_str()) {
            report.report(LaunchDefect::on_agent(
                &agent.slug,
                format!("capabilities[{index}].id"),
                &capability.id,
                format!(
                    "the `{}` capability is declared more than once on this agent; a capability \
                     is read by id and the first declaration answers",
                    capability.id
                ),
            ));
        }
        seen.push(&capability.id);
        check_implementation(agent, index, capability, report);
        check_params(agent, index, capability, known, report);
    }
}

/// **The capability's arm, judged against whether it has any and whether it is on.**
///
/// The capabilities that offer arms validate the *name* themselves — the resolver that turns a name
/// into an arm is the same code that knows the vocabulary, which is what keeps the two from
/// drifting. What is left here is the pair of questions no resolver can reach, because on each of
/// them the field is unread: an arm written on a capability that offers none, and an enabled
/// capability that offers arms and names none. See [`CAPABILITIES_WITH_ARMS`] for which capabilities
/// are which, and for the one whose unwritten arm is a declaration.
///
/// A blank string names nothing and is how an editor spells "unset", so it reads exactly as an
/// absent field does — on both sides of the question.
fn check_implementation(
    agent: &GgAgentConfig,
    index: usize,
    capability: &GgCapabilityConfig,
    report: &mut LaunchReport,
) {
    let named = capability
        .implementation
        .as_deref()
        .map(str::trim)
        .filter(|named| !named.is_empty());
    let locus = || format!("capabilities[{index}].implementation");
    match (named, arm_rule(&capability.id)) {
        (Some(named), None) => report.report(LaunchDefect::on_agent(
            &agent.slug,
            locus(),
            named,
            format!(
                "the `{}` capability does one thing and offers no implementations to choose \
                 between; `{named}` names nothing gg could select",
                capability.id
            ),
        )),
        // A disabled capability selects nothing, so it is owed no arm; what it carries is the
        // configuration the arm would have used, and an operator who has not chosen one yet has
        // written a document that is honest about that.
        (None, Some(ArmRule::Required)) if capability.enabled => {
            report.report(
                LaunchDefect::on_agent(
                    &agent.slug,
                    locus(),
                    "",
                    format!(
                        "the `{}` capability is on and names no implementation; the arm is what \
                         the capability is varied by, and gg selects none on an operator's \
                         behalf.",
                        capability.id
                    ),
                )
                .known(arms_of(&capability.id)),
            );
        }
        _ => {}
    }
}

/// Every key of one capability's `params` object, read against that capability's own
/// [vocabulary](CAPABILITY_PARAMS) — and, where the capability is **on**, every key of that
/// vocabulary the object does not carry.
///
/// The two halves are the same table read in both directions. A key the capability does not read
/// configures nothing while the document says it configures something; a key it
/// [requires](Requirement::Required) and nobody wrote leaves gg with nothing to put there, and it
/// will not invent one.
///
/// **Off requires nothing.** A disabled capability configures nothing — it is inert, offers no call
/// and consumes no context — so there is no value it could be short of; what it carries is the
/// configuration the arm *would* have used, which is what lets the on and off arms of one comparison
/// be one document with one switch moved. Requiring a full params block there would refuse the
/// document that expresses the off arm. Everything it *does* carry is still read, on the same terms,
/// so a typo in a disabled capability is heard about now rather than on the launch that flips the
/// switch.
fn check_params(
    agent: &GgAgentConfig,
    index: usize,
    capability: &GgCapabilityConfig,
    known: &[(&str, Requirement)],
    report: &mut LaunchReport,
) {
    let vocabulary = || known.iter().map(|(key, _)| *key);
    match &capability.params {
        // An absent params object is the ordinary shape of a capability with nothing to tune — and,
        // on an enabled one that does have something to tune, it is every required key at once.
        Value::Null => {}
        Value::Object(params) => {
            for key in params.keys() {
                if known.iter().any(|(name, _)| name == key) {
                    continue;
                }
                report.report(
                    LaunchDefect::on_agent(
                        &agent.slug,
                        format!("capabilities[{index}].params.{key}"),
                        key,
                        format!(
                            "the `{}` capability does not read a `{key}` param; it would configure \
                             nothing.",
                            capability.id
                        ),
                    )
                    .known(vocabulary()),
                );
            }
        }
        other => {
            report.report(LaunchDefect::on_agent(
                &agent.slug,
                format!("capabilities[{index}].params"),
                other.to_string(),
                format!(
                    "the `{}` capability's `params` is not an object; capability parameters are \
                     named, so there is nothing here gg can read.",
                    capability.id
                ),
            ));
            // Nothing below can be read out of a value with no named keys in it, and a list of
            // every param it is missing would bury the one line that says why.
            return;
        }
    }
    if !capability.enabled {
        return;
    }
    for (key, requirement) in known {
        if !matches!(requirement, Requirement::Required(_)) {
            continue;
        }
        if capability
            .params
            .get(key)
            .is_some_and(|value| !value.is_null())
        {
            continue;
        }
        report.report(missing_required_param(&capability.id, key));
    }
}

/// **Every params key gg reads once for the whole run**, checked on the profiles that are not the
/// one it is read off.
///
/// Four keys configure the run rather than an agent. The [subagents](CAPABILITY_SUBAGENTS)
/// recursion bound is a property of the tree, and the three ceilings on the
/// [board](CAPABILITY_PROJECT_MANAGEMENT) — how many epics and issues it may hold, and how often a
/// failed issue is re-dispatched — are properties of the one board a run keeps. Each is read off
/// exactly one profile ([`ReadOff`]), so a *different* value written on another profile is read by
/// nothing at all, whatever it says.
///
/// Writing the **same** value on every profile is not that, and is the ordinary shape: each key is
/// [required](Requirement::Required) wherever its capability is on, so an editor that offers it per
/// agent writes it on each, and a document in which every profile says `3` says exactly what gg
/// does. So what is refused is a declaration that **diverges** from the one in force — the case
/// where the document says two things and the run can only do one — and a declaration on a profile
/// gg does not read it off when the profile it *does* read it off declares none at all, which is a
/// figure gg never reaches.
const RUN_LEVEL_PARAMS: &[(&str, &str, ReadOff, &str)] = &[
    (
        CAPABILITY_SUBAGENTS,
        PARAM_MAX_DEPTH,
        ReadOff::Root,
        "the recursion bound is a property of the run's agent tree",
    ),
    (
        CAPABILITY_PROJECT_MANAGEMENT,
        PARAM_MAX_EPICS,
        ReadOff::BoardOwner,
        "the board is the run's, so its ceilings are",
    ),
    (
        CAPABILITY_PROJECT_MANAGEMENT,
        PARAM_MAX_ISSUES,
        ReadOff::BoardOwner,
        "the board is the run's, so its ceilings are",
    ),
    (
        CAPABILITY_PROJECT_MANAGEMENT,
        PARAM_MAX_RETRIES,
        ReadOff::BoardOwner,
        "the board is the run's, so its ceilings are",
    ),
];

/// Which profile gg reads a [run-level param](RUN_LEVEL_PARAMS) off — the second half of what makes
/// a declaration elsewhere a declaration nothing reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadOff {
    /// The [root](GgCapabilitySet::root), the only profile a run is guaranteed to have.
    Root,
    /// The profile that [owns the board](crate::agent::board_owner) — the first with project
    /// management switched on. A set in which no profile does has no board at all, so there is
    /// nothing for a ceiling to bound and every profile's is the configuration the on arm *would*
    /// have used; those are left alone, exactly as a disabled capability's params are.
    BoardOwner,
}

/// Whether two declarations of one key say the same thing, read the way the resolver that consumes
/// them would: a number by its value (so `3` and `3.0` are one declaration, exactly as
/// [`count_param`] reads them) and a string by its trimmed text.
fn same_declaration(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        (Value::String(left), Value::String(right)) => left.trim() == right.trim(),
        (left, right) => left == right,
    }
}

/// See [`RUN_LEVEL_PARAMS`].
fn check_run_level_params(set: &GgCapabilitySet, report: &mut LaunchReport) {
    let declared = |agent: &GgAgentConfig, capability: &str, key: &str| {
        agent
            .capability(capability)
            .and_then(|capability| capability.params.get(key))
            .filter(|value| !value.is_null())
            .cloned()
    };
    for (capability, key, read_off, why) in RUN_LEVEL_PARAMS {
        let reader = match read_off {
            ReadOff::Root => set.agents.first(),
            ReadOff::BoardOwner => crate::agent::board_owner(set),
        };
        let Some(reader) = reader else {
            continue;
        };
        // What the run actually uses: what the profile gg reads it off declares, and nothing else.
        // A reader that declares none leaves gg with no figure at all, so a value elsewhere is not
        // a divergence from a default — it is a declaration nothing reads.
        let in_force = declared(reader, capability, key);
        for agent in &set.agents {
            if agent.slug == reader.slug {
                continue;
            }
            let Some(value) = declared(agent, capability, key) else {
                continue;
            };
            if in_force
                .as_ref()
                .is_some_and(|in_force| same_declaration(in_force, &value))
            {
                continue;
            }
            report.report(LaunchDefect::on_agent(
                &agent.slug,
                param_locus(capability, key),
                as_written(&value),
                match &in_force {
                    Some(in_force) => format!(
                        "{why}, so gg reads `{key}` off the `{}` agent, and this run's is `{}`",
                        reader.slug,
                        as_written(in_force),
                    ),
                    None => format!(
                        "{why}, so gg reads `{key}` off the `{}` agent, which declares none. \
                         Declare it there.",
                        reader.slug,
                    ),
                },
            ));
        }
    }
}

/// The checks that need every profile in hand at once: a roster naming a profile the set does not
/// declare, a roster entry that permits nothing, and an agent able to **file
/// [issues](crate::board)** with nobody to assign them to.
fn check_rosters(set: &GgCapabilitySet, report: &mut LaunchReport) {
    for agent in &set.agents {
        for (index, reference) in agent.subagents.iter().enumerate() {
            if set.agent(&reference.agent_id).is_none() {
                report.report(
                    LaunchDefect::on_agent(
                        &agent.slug,
                        format!("subagents[{index}].agentId"),
                        &reference.agent_id,
                        format!(
                            "the `{}` agent's roster points at `{}`, which is not a profile this \
                             configuration declares.",
                            agent.slug, reference.agent_id
                        ),
                    )
                    .known(set.agents.iter().map(|agent| agent.slug.as_str())),
                );
            }
            // The scopes are what a roster entry *is*: the three roles are governed independently,
            // and every call that names a target is checked against the scope it names it in. An
            // entry short of them permits nothing at all, and reading one out of the absence would
            // hand this agent a delegation nobody wrote.
            if reference.scopes.is_empty() {
                report.report(
                    LaunchDefect::on_agent(
                        &agent.slug,
                        format!("subagents[{index}].scopes"),
                        "",
                        format!(
                            "the `{}` agent's roster entry for `{}` names no scope, and what a \
                             target may be used for is the whole of what a roster entry says",
                            agent.slug, reference.agent_id
                        ),
                    )
                    .known(ALL_SUBAGENT_SCOPES.map(GgSubagentScope::id)),
                );
            }
        }
        // An issue names the profile gg dispatches it under, drawn from the filer's own
        // *implementers* — so an agent that may file issues but lists none could never write a valid
        // one. Refuse the configuration rather than offer a tool whose every call would be rejected;
        // withholding `create_issue` (read-only board access) is the intended way to have one. The
        // same argument applies to an agent that must name reviewers but has none.
        if !agent.is_enabled(CAPABILITY_PROJECT_MANAGEMENT)
            || !crate::agent::grants_call(
                agent,
                crate::tools::CREATE_ISSUE_TOOL,
                crate::sandbox::BOARD_CREATE_ISSUE,
            )
        {
            continue;
        }
        if agent
            .agents_in_scope(GgSubagentScope::Implementer)
            .is_empty()
        {
            report.report(LaunchDefect::on_agent(
                &agent.slug,
                "subagents",
                "",
                format!(
                    "the `{}` agent may create issues but its roster lists no `implementer` to \
                     assign them to; give one of its agents the implementer scope, or switch its \
                     issue-creation feature off for read-only board access.",
                    agent.slug
                ),
            ));
        }
        if crate::board::requires_reviewers(agent)
            && agent.agents_in_scope(GgSubagentScope::Reviewer).is_empty()
        {
            report.report(LaunchDefect::on_agent(
                &agent.slug,
                "subagents",
                "",
                format!(
                    "the `{}` agent must name reviewers on every issue but its roster lists no \
                     `reviewer`; give one of its agents the reviewer scope, or switch the \
                     `reviewers` requirement off.",
                    agent.slug
                ),
            ));
        }
    }
}

/// The [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) a
/// [project-management](CAPABILITY_PROJECT_MANAGEMENT) run must name.
///
/// Every issue works in its own worktree, so an accepted issue's branch has to be merged back — and
/// with issues running concurrently a conflicting merge is an ordinary event. gg therefore refuses
/// to launch a board without somebody to hand that conflict to. The param holds a profile
/// [id](GgAgentConfig::id), which must resolve, and the profile it resolves to must have the
/// [shell](CAPABILITY_SHELL) capability: resolving a merge means running `git`, which an agent
/// without a shell cannot do.
///
/// That the param is written at all is not checked here. It is
/// [required](Requirement::Required) of every enabled declaration of the capability and reported by
/// [`merge_agent_id`](crate::agent::merge_agent_id), the reader, at the locus an operator edits —
/// so a set that names nobody is refused there, once, rather than twice in two wordings.
fn check_merge_agent(set: &GgCapabilitySet, report: &mut LaunchReport) {
    if !set
        .agents
        .iter()
        .any(|agent| agent.is_enabled(CAPABILITY_PROJECT_MANAGEMENT))
    {
        return;
    }
    let locus = format!("{CAPABILITY_PROJECT_MANAGEMENT}.{PROJECT_MANAGEMENT_PARAM_MERGE_AGENT}");
    check_merge_agent_declarations(set, &locus, report);
    let Some(id) = crate::agent::merge_agent_id(set, report) else {
        return;
    };
    let Some(profile) = set.agent(&id) else {
        report.report(
            LaunchDefect::run_level(
                locus,
                &id,
                format!(
                    "the `{PROJECT_MANAGEMENT_PARAM_MERGE_AGENT}` names `{id}`, which is not a \
                     declared agent profile."
                ),
            )
            .known(set.agents.iter().map(|agent| agent.slug.as_str())),
        );
        return;
    };
    if !profile.is_enabled(CAPABILITY_SHELL) {
        report.report(LaunchDefect::run_level(
            locus,
            &id,
            format!(
                "the merge agent `{id}` ({}) does not have the `{CAPABILITY_SHELL}` capability; \
                 resolving a merge conflict means running `git` in the workspace, so a merge agent \
                 must have a shell.",
                profile.name
            ),
        ));
    }
}

/// Every [`mergeAgentId`](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) the set **writes down**, as against
/// the one gg [reads](crate::agent::merge_agent_id).
///
/// The board is run-global and so is its merge agent, so gg reads the first declaration it can make
/// sense of. Two things fall through that on their own: a declaration gg cannot read as an id at
/// all — a number, an object, a blank string — which is skipped as though it were absent while a
/// *later* profile's value silently becomes the run's merge agent; and two profiles naming two
/// different agents, of which exactly one is read and neither is marked. Both leave a document
/// saying one thing and a run doing another, so both are refused here rather than resolved.
fn check_merge_agent_declarations(set: &GgCapabilitySet, locus: &str, report: &mut LaunchReport) {
    let mut named: Vec<(&str, &str)> = Vec::new();
    for agent in &set.agents {
        let Some(raw) = agent
            .capability(CAPABILITY_PROJECT_MANAGEMENT)
            .and_then(|capability| capability.params.get(PROJECT_MANAGEMENT_PARAM_MERGE_AGENT))
            .filter(|value| !value.is_null())
        else {
            continue;
        };
        match raw.as_str().map(str::trim).filter(|id| !id.is_empty()) {
            Some(id) => named.push((agent.slug.as_str(), id)),
            None => report.report(LaunchDefect::on_agent(
                &agent.slug,
                locus,
                as_written(raw),
                format!(
                    "the `{PROJECT_MANAGEMENT_PARAM_MERGE_AGENT}` names the agent that resolves \
                     a conflicting merge, so it must be the id of a declared profile, and gg \
                     cannot read one here"
                ),
            )),
        }
    }
    let Some((first_agent, first)) = named.first().copied() else {
        return;
    };
    for (agent, id) in named.iter().skip(1).copied() {
        if id == first {
            continue;
        }
        report.report(LaunchDefect::on_agent(
            agent,
            locus,
            id,
            format!(
                "the board is the run's, so it has one merge agent, and `{first_agent}` already \
                 names `{first}`"
            ),
        ));
    }
}

/// [`validate_capability_set`] with its defects joined into one string, one per line.
///
/// For the tests written against the single-message `validate_agents` this pass absorbed: they
/// assert *that* a set is refused and that the reason names the offending value, which reads the
/// same off a joined refusal as off the one error it used to be. New tests should assert against
/// the [defects](LaunchDefect) themselves.
#[cfg(test)]
pub fn refusal(set: &GgCapabilitySet) -> Result<(), String> {
    validate_capability_set(set).map_err(|defects| {
        defects
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    })
}

#[cfg(test)]
#[path = "validate.test.rs"]
mod tests;

#[cfg(test)]
#[path = "validate.workspace.test.rs"]
mod workspace_tests;
