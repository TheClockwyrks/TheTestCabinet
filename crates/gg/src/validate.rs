//! **The launch refusal**: the one pass that proves a gg run can be conducted exactly as it is
//! written, before the first turn and before a single token is spent.
//!
//! # The policy
//!
//! A gg run **refuses to start if any configured value cannot be honoured exactly as written**.
//! There is no such thing in gg as resolving an unrecognized configured value to a default: an
//! experiment measured on one arm while its record names another is worse than no experiment, and
//! a fallback is precisely the mechanism that produces one. The refusal is the alternative.
//!
//! Three consequences follow, and they are the whole of the contract:
//!
//! 1. **Absent is not unrecognized.** A value that is absent or `null` takes the capability's
//!    documented default, and that is correct rather than a fallback. Only a value that is
//!    *present* and cannot be honoured is refused — with one exception, which is a param that has
//!    no documented default at all: responses-as-code's
//!    [`language`](crate::sandbox::PARAM_LANGUAGE) is **required** wherever the capability is on,
//!    because every answer gg could invent for it is a run recorded under a language nobody chose.
//!    A required param is a deliberate rarity, not a pattern to copy: it is right only where the
//!    absence of a value cannot be read as a choice.
//! 2. **Every defect at once.** A refusal names *every* offending value, not the first one — an
//!    operator fixing a sweep's one shared configuration document wants every typo in one pass, not
//!    a dozen launches each revealing the next.
//! 3. **What cannot be seen before the run kills the run.** A value that can only be discovered
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
//! - An allowlist entry naming a real gg tool or operation that *this* agent's capabilities do not
//!   offer. It grants nothing, it is not a typo, and it is the legitimate shared-document case.
//! - A `params` key known to the capability but unused by the arm its `implementation` selected —
//!   the deliberate "one shared params block per sweep" case.
//! - The `info` lines reporting what *is* in force: the armed ceilings, the healing set, the loop
//!   detector.
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
//! - **Absent means default.** An absent or `null` value takes the documented default and reports
//!   nothing — unless the param is one of the few that is *required*, in which case its absence is
//!   itself the reported defect and the resolver hands back a placeholder nothing will read.
//! - **Present and unhonourable means a reported defect.** The resolver still returns *something*
//!   (the default is as good as anything, since the run is about to be refused) and reports a
//!   [`LaunchDefect`] naming the locus, the value as written, and the vocabulary it was read
//!   against.
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
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_AGENT_PERSISTENCE, CAPABILITY_AUTOLOAD_SPECS,
    CAPABILITY_COMPACTION, CAPABILITY_CONTEXT_WINDOW_OVERRIDE, CAPABILITY_DOCVIEW_CLOSE,
    CAPABILITY_EDIT_FILE, CAPABILITY_EXEC, CAPABILITY_FORK, CAPABILITY_FSM, CAPABILITY_LIST_DIR,
    CAPABILITY_MEMORIES, CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_READ_FILE, CAPABILITY_RESPONSES_AS_CODE, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WRITE_FILE, COMPACTION_PARAM_MODEL,
    COMPACTION_PARAM_MODEL_SLOT, COMPACTION_STRATEGY_MEMORY, FSM_PARAM_STATES,
    GG_CAPABILITY_CATALOG, GgAgentConfig, GgCapabilityConfig, GgCapabilitySet, GgSubagentScope,
    MEMORY_PARAM_SCOPE, MODULE_PARAM_OWNERSHIP, PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
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
    /// pass walks the document.
    #[must_use]
    pub fn into_defects(self) -> Vec<LaunchDefect> {
        match self {
            Self::Collecting(defects) => defects,
            Self::Discarding => Vec::new(),
        }
    }

    /// Run `walk`, and **attribute to `agent`** everything it reports that names no profile.
    ///
    /// A resolver reports what it can see, and most of them cannot see a profile:
    /// [`CompactionStrategy::resolve`](crate::compaction::CompactionStrategy::resolve) is handed one
    /// `Option<&str>`, [`MemoryCaps::resolve`](crate::memories::MemoryCaps::resolve) one `params`
    /// object. Threading a profile id through them so a defect could carry it would put the
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

/// **One `params` key read as a count** — the single spelling every integral capability param uses.
///
/// `None` means *the caller's documented default stands*: the key is absent, or explicitly `null`.
/// `Some(n)` is a number naming the whole, non-negative `n`. What `0` means is the caller's business
/// — it is "unlimited" for a [memory limit](crate::memories::MemoryCaps) and "keep everything" for
/// the [program library](crate::programs), and neither is this function's to decide.
///
/// **An integral float is a valid count**, and that is deliberate rather than lenient. JSON has no
/// integer type: a sweep generated from JavaScript writes `1e8` and a hand-rounded `100.0` as
/// readily as `100`, and reading only the integer form would run gg's default under the configured
/// arm's name — the exact failure the launch refusal exists to prevent. `100.5` is a different
/// matter: it names no count, and rounding it would be gg choosing a number nobody wrote.
///
/// Everything else — a string, a boolean, a negative, a fraction, an infinity, a number past `u64`,
/// an array — is reported and `None` comes back, keeping the resolver total while the launch is
/// refused.
pub fn count_param(
    params: &Value,
    capability: &str,
    key: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    let value = params.get(key)?;
    if value.is_null() {
        return None;
    }
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
        format!(
            "the `{capability}` capability's `{key}` must be a whole number of zero or more; gg \
             cannot read this as one, and reading it as the default would run one arm under \
             another's name."
        ),
    ));
    None
}

/// **One `params` key read as a count that must be at least one** — [`count_param`] for the keys
/// whose `0` bounds nothing.
///
/// A ceiling of zero is not a spelling of "off": a board that may hold no epics, a list that may
/// hold no tasks or a tree an agent may not spawn into offers calls whose every use is refused, so
/// the capability is on and inert. gg took its default there until this refusal existed, which is
/// the same wrong-arm failure an unrecognized `implementation` is. `consequence` says, in the
/// capability's own terms, what a zero would have meant — the sentence an operator needs to know
/// which knob they got wrong.
///
/// Everything else is exactly [`count_param`]: absent or `null` leaves the caller's documented
/// default standing, and an integral float is a valid count.
pub fn positive_count_param(
    params: &Value,
    capability: &str,
    key: &str,
    consequence: &str,
    report: &mut LaunchReport,
) -> Option<u64> {
    let count = count_param(params, capability, key, report)?;
    if count > 0 {
        return Some(count);
    }
    report.report(LaunchDefect::run_level(
        param_locus(capability, key),
        count.to_string(),
        format!(
            "the `{capability}` capability's `{key}` must be one or more; {consequence}, and \
             taking gg's default instead would run the capability under a ceiling nobody wrote."
        ),
    ));
    None
}

// ---------------------------------------------------------------------------
// The params vocabulary
// ---------------------------------------------------------------------------

/// **Every `params` key each capability accepts**, in one table — the closed vocabulary a
/// capability's free-form params object is read against.
///
/// [`params`](GgCapabilityConfig::params) is a `serde_json::Value`, so
/// `#[serde(deny_unknown_fields)]` can never reach inside it: this table is the only thing standing
/// between `summryHeadroom` and a run that silently condensed at gg's default headroom while its
/// record named the configured one.
///
/// Two rules the table encodes deliberately:
///
/// - **A key must be known to the *capability*, not necessarily used by the selected arm.** A
///   `maxResults` on a `scratchpad` memories run is accepted, because sweeping one shared params
///   block across all three memory strategies without retyping it is the point of the block. See
///   the memories documentation.
/// - **A key known to *another* capability is still unknown here.** [`ownership`](MODULE_PARAM_OWNERSHIP)
///   is offered by the two module-backed capabilities that have an ownership to configure and by no
///   others, so an `ownership` on `memories`, `skills` or `tasks` is a refusal rather than a key
///   read by nothing.
///
/// Every entry names a `PARAM_*` constant rather than a string literal, so the table and the
/// resolver that reads the key cannot drift apart, and the table's own test pins that it covers
/// [`GG_CAPABILITY_CATALOG`] exactly — a capability missing from it would refuse every param written
/// on it, and an entry outside it would be read by nothing.
const CAPABILITY_PARAMS: &[(&str, &[&str])] = &[
    (
        CAPABILITY_SHELL,
        &[crate::tools::PARAM_MAX_LINES, crate::tools::PARAM_MAX_CHARS],
    ),
    (CAPABILITY_READ_FILE, &[crate::tools::PARAM_LINE_CAP]),
    (CAPABILITY_WRITE_FILE, &[]),
    (CAPABILITY_EDIT_FILE, &[]),
    (CAPABILITY_LIST_DIR, &[]),
    (
        CAPABILITY_CONTEXT_WINDOW_OVERRIDE,
        &[crate::agent::PARAM_WINDOW_LIMIT],
    ),
    (CAPABILITY_AUTOLOAD_SPECS, &[]),
    (CAPABILITY_AGENT_PERSISTENCE, &[]),
    (
        CAPABILITY_SKILLS,
        &[
            crate::agent::PARAM_SKILLS_DIR,
            crate::skills::builtin::PARAM_BUILT_INS,
        ],
    ),
    (
        CAPABILITY_MEMORIES,
        &[
            MEMORY_PARAM_SCOPE,
            crate::memories::PARAM_MAX_COUNT,
            crate::memories::PARAM_MAX_LEN_PER_MEMORY,
            crate::memories::PARAM_MAX_TOTAL_LEN,
            crate::memories::PARAM_MAX_LEN_INDEX,
            crate::memories::PARAM_MAX_LEN_DESCRIPTION,
            crate::memories::PARAM_MAX_RESULTS,
        ],
    ),
    (
        CAPABILITY_TASKS,
        &[crate::tasks::PARAM_MAX_TASKS, crate::tasks::PARAM_MODE],
    ),
    (
        CAPABILITY_COMPACTION,
        &[
            crate::compaction::PARAM_SUMMARY_HEADROOM,
            COMPACTION_PARAM_MODEL,
            COMPACTION_PARAM_MODEL_SLOT,
        ],
    ),
    (
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        &[crate::agent::PARAM_TOP_FILE_VIEWS, MODULE_PARAM_OWNERSHIP],
    ),
    (
        CAPABILITY_PROJECT_MANAGEMENT,
        &[
            crate::board::PARAM_MAX_EPICS,
            crate::board::PARAM_MAX_ISSUES,
            crate::board::PARAM_MAX_RETRIES,
            crate::board::PARAM_REVIEWERS,
            PROJECT_MANAGEMENT_PARAM_MERGE_AGENT,
            MODULE_PARAM_OWNERSHIP,
        ],
    ),
    (CAPABILITY_SUBAGENTS, &[crate::subagents::PARAM_MAX_DEPTH]),
    (CAPABILITY_FSM, &[FSM_PARAM_STATES]),
    (CAPABILITY_EXEC, &[]),
    (CAPABILITY_FORK, &[]),
    (
        CAPABILITY_RESPONSES_AS_CODE,
        &[
            crate::sandbox::PARAM_LANGUAGE,
            crate::sandbox::PARAM_TIMEOUT_SECS,
            crate::sandbox::PARAM_MAX_MEMORY_BYTES,
            crate::docs::PARAM_DOC_VIEW_TYPES,
            crate::healing::PARAM_HEALING,
            crate::healing::PARAM_ASSISTANT_MESSAGES,
        ],
    ),
    (CAPABILITY_PROGRAM_LIBRARY, &[crate::programs::PARAM_KEEP]),
    (CAPABILITY_DOCVIEW_CLOSE, &[]),
];

/// The params vocabulary of the capability `id` names, or `None` when the id is not one gg ships —
/// in which case the id itself is already the defect and its params have nothing to be read
/// against.
fn params_for(id: &str) -> Option<&'static [&'static str]> {
    CAPABILITY_PARAMS
        .iter()
        .find(|(capability, _)| *capability == id)
        .map(|(_, params)| *params)
}

/// **Every capability that offers arms** — the ones whose
/// [`implementation`](GgCapabilityConfig::implementation) selects between named ways of doing the
/// same job.
///
/// The vocabulary of each is *not* repeated here: the capability's own resolver owns it, reads it
/// from the same constants it resolves against, and reports a name it does not offer itself. What
/// this list is for is the other half of the question — a capability that offers **no** arms at all,
/// where there is no resolver to reach the value and nothing to compare it against. An
/// `implementation` written there configures nothing, is recorded in the run's own capability set as
/// though it had, and no code anywhere ever looks at it. The contract says so in as many words on
/// the field itself: a name the capability does not offer is a launch failure, never a fall back to
/// the default — and "offers none" is the strongest case of that.
const CAPABILITIES_WITH_ARMS: &[&str] = &[
    CAPABILITY_COMPACTION,
    CAPABILITY_MEMORIES,
    CAPABILITY_READ_FILE,
    CAPABILITY_SHELL,
    CAPABILITY_AUTOLOAD_SPECS,
];

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
    // The handful of checks that need more of the invocation than the set: a window override is a
    // narrowing of a **model's** window, and the windows arrive beside the set rather than in it.
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
                 provided into an agent's opening context, and gg cannot read this one at \
                 `{}`. Its promise is the *whole* brief, so a run that opened with part of it \
                 would answer a question about a specification nobody wrote.",
                full.display(),
            ),
        ));
    }
}

/// The set-scoped half of [`validate_launch`] — everything decidable from the
/// [capability set](GgCapabilitySet) alone, which is all of it but the
/// [window overrides](crate::agent), whose narrowing is judged against the models the invocation
/// carries the windows of.
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
    for agent in &set.agents {
        check_capabilities(agent, report);
        // Every resolver that reads one of this profile's capability values, run against a
        // collecting sink — the same functions, reading the same `PARAM_*` constants, that the run
        // itself will use. Their defects arrive unattributed (a resolver is handed a params object,
        // not a profile), so the walk stamps this profile's id on them.
        report.for_agent(&agent.id, |report| {
            crate::modules::check_ownership(agent, report);
            crate::memories::check_launch(agent, report);
            crate::compaction::check_launch(agent, memories_writable(agent), report);
            crate::tasks::check_launch(agent, report);
            crate::board::check_launch(agent, report);
            crate::programs::check_launch(agent, report);
            crate::tools::check_launch(agent, report);
            crate::sandbox::check_launch(agent, report);
            crate::docs::check_launch(agent, report);
            crate::healing::check_launch(agent, report);
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
/// [`CompactionStrategy::resolve`](crate::compaction::CompactionStrategy::resolve) is given at
/// launch, so the pass reads the profile the way the run will.
fn memories_writable(agent: &GgAgentConfig) -> bool {
    agent.is_enabled(CAPABILITY_MEMORIES)
        && crate::memories::resolve_scope(agent, &mut LaunchReport::already_reported())
            != crate::memories::MemoryScope::ReadOnly
}

/// **A memory compaction that could never be performed** — the statically decidable half of the
/// demotion [`CompactionStrategy::resolve`](crate::compaction::CompactionStrategy::resolve) makes.
///
/// The [`memory-compaction`](test_cabinet_core::gg::COMPACTION_STRATEGY_MEMORY) strategy asks the
/// agent to write its working state into its memories instead of a summary. An agent with no
/// memories, or with a `read-only` handle on somebody else's, has no call that could do it — so gg
/// would condense in prose, and the run would answer a question about self-summarization while its
/// record named the memory arm. Two profiles' worth of that is a study whose two arms are the same
/// arm.
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
            &agent.id,
            implementation_locus(CAPABILITY_COMPACTION),
            COMPACTION_STRATEGY_MEMORY,
            format!(
                "the `{COMPACTION_STRATEGY_MEMORY}` strategy condenses a thread by writing the \
                 agent's working state into its memories, and `{}` {why}. Give it writable \
                 memories, or name a strategy that condenses in prose.",
                agent.id,
            ),
        ));
    }
}

/// Every profile must have a non-empty, unique [id](GgAgentConfig::id) and — unless it is an
/// [FSM shell](crate::fsm::is_shell), which runs no model — a resolved model.
///
/// The id is the whole of how a profile is addressed: a roster entry, an FSM state, an issue's
/// assignee and its reviewers, the merge agent, and every telemetry row all carry one, and
/// [`GgCapabilitySet::agent`] answers with the *first* profile that has it. So a repeated id is not
/// a cosmetic clash — it makes every reference to it ambiguous, and silently binds each one to the
/// earlier profile. A profile's [name](GgAgentConfig::name) is display text that nothing resolves,
/// so a launch does not read one at all.
fn check_profile_ids(set: &GgCapabilitySet, report: &mut LaunchReport) {
    let mut seen: Vec<&str> = Vec::with_capacity(set.agents.len());
    for (index, agent) in set.agents.iter().enumerate() {
        let id = agent.id.trim();
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
                    "the `{id}` profile id is declared more than once; a reference is resolved by \
                     id and the first profile that has it answers, so nothing could ever address \
                     this one."
                ),
            ));
        }
        seen.push(id);
    }
}

/// Every capability this profile declares must be one gg ships, declared **once**, with an
/// `implementation` it has arms to select between and `params` keys it reads.
///
/// All of it is checked whether the capability is [enabled](GgCapabilityConfig::enabled) or not. A
/// disabled capability is still configuration — it records the configuration the arm *would* have
/// used so two sets differing only in that switch stay comparable — and a typo in it is a typo an
/// operator wants told about now rather than on the launch where they flip the switch.
fn check_capabilities(agent: &GgAgentConfig, report: &mut LaunchReport) {
    let mut seen: Vec<&str> = Vec::with_capacity(agent.capabilities.len());
    for (index, capability) in agent.capabilities.iter().enumerate() {
        let Some(known) = params_for(&capability.id) else {
            report.report(
                LaunchDefect::on_agent(
                    &agent.id,
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
                &agent.id,
                format!("capabilities[{index}].id"),
                &capability.id,
                format!(
                    "the `{}` capability is declared more than once on this agent; a capability is \
                     read by id and the first declaration answers, so everything on this one — its \
                     switch, its arm and its params — would configure nothing while the run's \
                     record carried it.",
                    capability.id
                ),
            ));
        }
        seen.push(&capability.id);
        check_implementation(agent, index, capability, report);
        check_params(agent, index, capability, known, report);
    }
}

/// A capability that offers no arms must not name one.
///
/// The capabilities that *do* offer arms validate their own — the resolver that turns the name into
/// an arm is the same code that knows the vocabulary, which is what keeps the two from drifting. So
/// all that is left here is the case no resolver can catch, because no resolver reads the field:
/// see [`CAPABILITIES_WITH_ARMS`]. A blank string names nothing and is how an editor spells "unset",
/// so it reads exactly as an absent field does.
fn check_implementation(
    agent: &GgAgentConfig,
    index: usize,
    capability: &GgCapabilityConfig,
    report: &mut LaunchReport,
) {
    let Some(named) = capability
        .implementation
        .as_deref()
        .map(str::trim)
        .filter(|named| !named.is_empty())
    else {
        return;
    };
    if CAPABILITIES_WITH_ARMS.contains(&capability.id.as_str()) {
        return;
    }
    report.report(LaunchDefect::on_agent(
        &agent.id,
        format!("capabilities[{index}].implementation"),
        named,
        format!(
            "the `{}` capability does one thing and offers no implementations to choose between; \
             `{named}` names nothing gg could select, and the run's own record would carry it as \
             though it had.",
            capability.id
        ),
    ));
}

/// Every key of one capability's `params` object, read against that capability's own vocabulary.
fn check_params(
    agent: &GgAgentConfig,
    index: usize,
    capability: &GgCapabilityConfig,
    known: &[&str],
    report: &mut LaunchReport,
) {
    let locus = |key: &str| format!("capabilities[{index}].params.{key}");
    match &capability.params {
        // An absent params object is the ordinary shape of a capability with nothing to tune.
        Value::Object(params) if params.is_empty() => {}
        Value::Null => {}
        Value::Object(params) => {
            for key in params.keys() {
                if known.contains(&key.as_str()) {
                    continue;
                }
                report.report(
                    LaunchDefect::on_agent(
                        &agent.id,
                        locus(key),
                        key,
                        format!(
                            "the `{}` capability does not read a `{key}` param; it would configure \
                             nothing.",
                            capability.id
                        ),
                    )
                    .known(known),
                );
            }
        }
        other => report.report(LaunchDefect::on_agent(
            &agent.id,
            format!("capabilities[{index}].params"),
            other.to_string(),
            format!(
                "the `{}` capability's `params` is not an object; capability parameters are named, \
                 so there is nothing here gg can read.",
                capability.id
            ),
        )),
    }
}

/// **Every params key gg reads once for the whole run**, checked on the profiles that are not the
/// one it is read off.
///
/// One key configures the run rather than an agent: the [subagents](CAPABILITY_SUBAGENTS) recursion
/// bound is a property of the tree. gg reads it off the [root](GgCapabilitySet::capability),
/// which is the only profile a run is guaranteed to have — so a *different* value written on
/// another profile is read by nothing at all, whatever it says.
///
/// Writing the **same** value on every profile is not that, and is the ordinary shape: an editor
/// that offers a param per agent seeds each with the documented default, and a document in which
/// every profile says `3` says exactly what gg does. So what is refused is a declaration that
/// **diverges** from the one in force — the case where the document says two things and the run can
/// only do one.
const RUN_LEVEL_PARAMS: &[(&str, &str, &str)] = &[(
    CAPABILITY_SUBAGENTS,
    crate::subagents::PARAM_MAX_DEPTH,
    "the recursion bound is a property of the run's agent tree",
)];

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

/// What gg would use for a [run-level param](RUN_LEVEL_PARAMS) the profile it reads them off
/// declares none of — the documented default, as the value an operator would have had to write to
/// mean the same thing.
///
/// It exists because a divergence is measured against **what is in force**, not against what the
/// root happens to have typed. An editor that offers the param per agent seeds every profile with
/// the documented default, and a root that is an [FSM shell](crate::fsm::is_shell) writes no
/// capability params at all — so a set in which the workers say `3` and the root says nothing
/// describes exactly the run gg conducts, and refusing it would refuse the editor's own output.
fn run_level_default(capability: &str, key: &str) -> Option<Value> {
    match (capability, key) {
        (CAPABILITY_SUBAGENTS, _) => Some(Value::from(crate::subagents::DEFAULT_MAX_DEPTH as u64)),
        _ => None,
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
    let Some(root) = set.agents.first() else {
        return;
    };
    for (capability, key, why) in RUN_LEVEL_PARAMS {
        let declaration = declared(root, capability, key);
        // What the run actually uses: the profile gg reads it off, or the documented default.
        let in_force = declaration
            .clone()
            .or_else(|| run_level_default(capability, key));
        for agent in set.agents.iter().skip(1) {
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
                &agent.id,
                param_locus(capability, key),
                as_written(&value),
                match &in_force {
                    Some(in_force) => format!(
                        "{why}, so gg reads `{key}` off the `{}` agent, and this run's is `{}`. \
                         This declaration would configure nothing.",
                        root.id,
                        as_written(in_force),
                    ),
                    None => format!(
                        "{why}, so gg reads `{key}` off the `{}` agent, which declares none — and \
                         this declaration would configure nothing. Declare it there.",
                        root.id,
                    ),
                },
            ));
        }
    }
}

/// The two checks that need every profile in hand at once: a roster naming a profile the set does
/// not declare, and an agent able to **file [issues](crate::board)** with nobody to assign them to.
fn check_rosters(set: &GgCapabilitySet, report: &mut LaunchReport) {
    for agent in &set.agents {
        for (index, reference) in agent.subagents.iter().enumerate() {
            if set.agent(&reference.agent_id).is_none() {
                report.report(
                    LaunchDefect::on_agent(
                        &agent.id,
                        format!("subagents[{index}].agentId"),
                        &reference.agent_id,
                        format!(
                            "the `{}` agent's roster points at `{}`, which is not a profile this \
                             configuration declares.",
                            agent.id, reference.agent_id
                        ),
                    )
                    .known(set.agents.iter().map(|agent| agent.id.as_str())),
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
                &agent.id,
                "subagents",
                "",
                format!(
                    "the `{}` agent may create issues but its roster lists no `implementer` to \
                     assign them to; give one of its agents the implementer scope, or switch its \
                     issue-creation feature off for read-only board access.",
                    agent.id
                ),
            ));
        }
        if crate::board::requires_reviewers(agent)
            && agent.agents_in_scope(GgSubagentScope::Reviewer).is_empty()
        {
            report.report(LaunchDefect::on_agent(
                &agent.id,
                "subagents",
                "",
                format!(
                    "the `{}` agent must name reviewers on every issue but its roster lists no \
                     `reviewer`; give one of its agents the reviewer scope, or switch the \
                     `reviewers` requirement off.",
                    agent.id
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
    let Some(id) = crate::agent::merge_agent_id(set) else {
        report.report(LaunchDefect::run_level(
            locus,
            "",
            format!(
                "project management is enabled but no merge agent is named; set the \
                 `{PROJECT_MANAGEMENT_PARAM_MERGE_AGENT}` param of the \
                 `{CAPABILITY_PROJECT_MANAGEMENT}` capability to an agent that can resolve a merge \
                 conflict when an accepted issue's work does not apply cleanly."
            ),
        ));
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
            .known(set.agents.iter().map(|agent| agent.id.as_str())),
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
            Some(id) => named.push((agent.id.as_str(), id)),
            None => report.report(LaunchDefect::on_agent(
                &agent.id,
                locus,
                as_written(raw),
                format!(
                    "the `{PROJECT_MANAGEMENT_PARAM_MERGE_AGENT}` names the agent that resolves a \
                     conflicting merge, so it must be the id of a declared profile. gg cannot read \
                     one here, and skipping it would hand the run whichever profile happened to \
                     name one next."
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
                 names `{first}`. gg would read the first of the two and this declaration would \
                 configure nothing."
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
