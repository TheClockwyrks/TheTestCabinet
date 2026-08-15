//! **Response healing** — the pass that sits between a model's raw reply and the
//! [preparation](crate::sandbox::ProgramLanguage::prepare_program) that turns it into source a guest
//! can evaluate, repairing the contract violations models actually commit and saying so.
//!
//! Under [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) the model's whole
//! reply *is* the program: there is no fenced block to extract, no language tag, and no
//! first-block-wins rule. That contract is simple enough to state in one sentence and simple enough
//! to break in several ways, and real models break it — they wrap the program in a Markdown fence,
//! they glue a sentence onto the closing fence (which CommonMark does not accept as a close, so the
//! sentence becomes part of the program), and they explain themselves above and below the code.
//!
//! Healing turns those replies into the program the model meant, and — because the point of the
//! capability is to *measure* how well models follow a code-only contract — it counts and discloses
//! every repair it makes rather than performing them behind the model's back.
//!
//! # The invariant that makes it honest
//!
//! > **Healing only ever deletes.** Every strategy removes contiguous text;
//! > [`strip-fences`](HealingStrategy::StripFences) and
//! > [`strip-prose`](HealingStrategy::StripProse) additionally remove the leading whitespace every
//! > line of the program they leave behind shares. No strategy inserts a character, moves a line,
//! > rewrites a token in place, or reorders anything. Therefore **the healed program, with
//! > whitespace removed, is a subsequence of the response with whitespace removed.**
//!
//! One machine-checkable sentence that covers "never invents code" and "never reorders" for every
//! strategy at once; `every_healed_program_is_a_subsequence_of_the_response` holds the whole fixture
//! corpus to it under every configuration. Where a strategy cannot apply cleanly it **declines** —
//! silently, leaving the text exactly as it was — because a wrong repair deletes the model's work
//! while a missed one costs a turn and a located diagnostic, and only one of those is recoverable.
//!
//! # A top-level module, not part of the sandbox
//!
//! This runs *before* the sandbox, and only ever hands it text. It never decides whether a reply
//! "is a program" — that question belongs to the run's program language, which answers it with a located
//! compiler diagnostic rather than with gg's opinion of the model's prose. So the tree reads as the
//! pipeline does — `healing.rs` (text) → the run's program language's own prepare step
//! (`sandbox/language/<language>.prepare.rs`, syntax) → `sandbox/engine.rs` (execution), with every
//! reply travelling the whole way.
//!
//! Nothing here does I/O, reads a clock, allocates a `Store`, or is `async`; its only imports are
//! `serde_json::Value` and the two capability types the resolver reads. Two things follow. Every
//! case in this module's tests is a microsecond-scale unit test with no component compile behind it,
//! and the comparison is honest: turning a strategy off changes only what [`heal`] returns.
//!
//! # The skeleton and the [dialect](Dialect)
//!
//! Which repairs exist, in which order they run, what makes each of them *decline*, and what the
//! model is told about the ones that fired are all facts about **gg's contract**, not about any one
//! program language: a model that fences its program, explains it or doubles it does so in whatever
//! language it was asked to write. Those facts are this module — the skeleton.
//!
//! What a language *does* own is the handful of lexical questions the skeleton asks along the way:
//! which fence tags mean "this block is the program", and whether a line is certainly code or
//! certainly prose. Each is a method on [`Dialect`], and each language's implementation lives with
//! the rest of that language under `sandbox/language/`. The trait carries one further question of
//! the same kind — [`code_mask`](Dialect::code_mask), which bytes of a source are code rather than
//! string or comment text — that the skeleton itself does not ask; see [`CodeMask`] for who does.
//!
//! The trait is declared **here**, and [`heal`] takes it as a parameter, so the dependency arrow
//! points `sandbox::language` → `healing` and this module keeps the property above: it still imports
//! nothing from [`crate::sandbox`], still does no I/O, and is still exercisable against a dialect
//! that answers "no" to everything. One strategy —
//! [`drop-doubled-response`](HealingStrategy::DropDoubledResponse) — asks the dialect nothing at
//! all, deliberately; see its own documentation for why it has no hook.

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig};

// ---------------------------------------------------------------------------------------------
// The language dialect
// ---------------------------------------------------------------------------------------------

/// The lexical questions [healing](self) asks about one **program language**.
///
/// Every method is a lexical question — most of them ones the skeleton needs answered before it can
/// decide that a deletion is safe — and every one of them has a different answer per language while
/// the decision built on it does not. A dialect is therefore small, total and side-effect-free: it
/// looks at text and says yes, no, or "I could not tell", and it rewrites nothing at all.
///
/// # The rule every implementation inherits
///
/// > **Healing only ever deletes.** Whatever a dialect answers, the healed program with its
/// > whitespace removed must remain a subsequence of the response with its whitespace removed.
///
/// That is the property the whole subsystem rests on, and it has to be re-earned per language rather
/// than inherited: a dialect whose [`is_prose_line`](Self::is_prose_line) were too generous would
/// delete a line of a model's program, and no amount of correctness in the skeleton would notice. So
/// the trait carries `fixtures` — replies in this language that the delete-only
/// harness runs the whole pipeline over, under every configuration — and a language cannot be
/// registered without contributing them.
///
/// # Answering "no" is always safe
///
/// A dialect that declines every question leaves `strip-prose` inert and narrows `strip-fences` to
/// the untagged block it can recognise without help, while `drop-doubled-response` — the one
/// strategy that is pure skeleton — goes on working exactly as it does now. That is what makes a
/// language's dialect something it can grow into rather than a prerequisite for running at all, and
/// it is what the tests' inert dialect asserts, so the skeleton is demonstrably not one language's
/// rules with the labels filed off.
///
/// Object-safe, for the reason [`ProgramLanguage`](crate::sandbox::ProgramLanguage) is: the registry
/// hands out `&'static dyn Dialect`, and nothing that consults one is generic over it.
pub trait Dialect: Send + Sync + 'static {
    /// The Markdown info-string tags that mean "this fenced block is the program", lower-cased.
    ///
    /// A **closed, recognised** list rather than a deny list: a block tagged `json`, `text`, `bash`
    /// or `md` is context the model showed, not the program, and round 1 measured models emitting
    /// exactly those beside their program. Tier 3 of [`strip_fences`]'s candidacy ladder is what
    /// stops the closed list from being a trap, and it needs no tags at all — so an empty list is
    /// legal, and simply gives up the first tier.
    fn program_fence_tags(&self) -> &'static [&'static str];

    /// Whether `line` is **certainly** a line of code in this language.
    ///
    /// Its errors must be asymmetric. A false positive costs a fence that could have been unwrapped
    /// — one turn, one located diagnostic — while a false negative deletes a line of the model's
    /// program. So every clause of an implementation must be a shape only code has.
    fn looks_like_code(&self, line: &str) -> bool;

    /// Whether `line` is **certainly** prose rather than this language's code.
    ///
    /// The mirror image of [`looks_like_code`](Self::looks_like_code), with the asymmetry the other
    /// way round: here a false positive *deletes* the line, so every clause must be a shape only
    /// English has. The two are deliberately **not** complements and not disjoint — a line may
    /// satisfy both, or neither — and the pipeline's fixpoint loop is what resolves the overlap.
    fn is_prose_line(&self, line: &str) -> bool;

    /// Which bytes of `src` are **code**, as opposed to string, interpolation or comment text.
    ///
    /// `None` means the source did not lex cleanly, and every caller that needs the mask declines to
    /// act on it. That is the correct failure mode for a lexer that has lost its place: the
    /// alternative is acting on a reading already known to be wrong. No strategy in [healing](self)
    /// asks it; see [`CodeMask`] for who does, and for why the method lives here anyway.
    fn code_mask(&self, src: &str) -> Option<CodeMask>;

    /// Replies in this language that the delete-only invariant is re-asserted over.
    ///
    /// `#[cfg(test)]`, and deliberately part of the trait rather than a free list beside the tests:
    /// a language cannot be registered without contributing the replies its own dialect must
    /// survive, which is what keeps the invariant a per-language property rather than an inherited
    /// claim.
    #[cfg(test)]
    fn fixtures(&self) -> &'static [&'static str];
}

/// Which bytes of a source are **code** — as opposed to string, interpolation or comment text.
///
/// The question every caller asks of it is the same one: is this byte code? — so that an import
/// inside a string, a keyword inside a comment, or a declaration inside a template literal is read
/// as the text it is rather than as the statement it spells.
///
/// **Healing does not ask it.** No strategy in this module consults a mask; the callers are the
/// per-language module analysis — `sandbox/language/python.modules.rs`, `purescript.modules.rs` and
/// `ruby.modules.rs` — which reads a program's imports and must not mistake one written into a
/// string for one the program makes. [`code_mask`](Dialect::code_mask) nonetheless belongs on the
/// [dialect](Dialect) beside the rest of that language's lexical questions, so a later reader
/// finding a trait method the skeleton never calls should not go looking for the call.
///
/// The type lives here with a per-language *filler*, because the shape of the answer is the same in
/// every language — one flag per byte, out of range is not code — and only the lexer that produces
/// it differs. That is what lets a caller index a mask without knowing whose it is.
pub struct CodeMask {
    /// Per byte: not string, interpolation, or comment text. An interpolation's own delimiters are
    /// code, because they are what a brace count has to see in order to come back out again.
    code: Vec<bool>,
}

impl CodeMask {
    /// A mask from one flag per byte of the source it was lexed from — the constructor a
    /// [`Dialect`]'s own lexer returns through.
    ///
    /// The flags are taken by value rather than the field being public, so a mask is immutable once
    /// built: every caller that reads one is deciding what a stretch of a program means, and a mask
    /// that could be edited afterwards is a decision that could be revised behind the decider's
    /// back.
    pub fn from_flags(code: Vec<bool>) -> Self {
        Self { code }
    }

    /// Whether the byte at `index` is code. Out-of-range indices are not, so a caller that has
    /// already rewritten its text cannot silently read past the end of the mask.
    pub fn is_code(&self, index: usize) -> bool {
        self.code.get(index) == Some(&true)
    }
}

// ---------------------------------------------------------------------------------------------
// The public API
// ---------------------------------------------------------------------------------------------

/// One named, independently toggleable repair.
///
/// The id is the single spelling of a strategy: the JSON key under the capability's `healing` param,
/// the wire value of [`GgHealingStrategy`](test_cabinet_core::gg::GgHealingStrategy), the metric's
/// name in the session summary, and the word used in the model-facing note. One id with two
/// spellings is exactly the drift this subsystem exists to measure away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum HealingStrategy {
    /// Unwrap a Markdown code fence wrapping the program — tagged or not, closed properly, closed
    /// with prose glued to the closing line, or never closed at all.
    StripFences,
    /// Remove explanatory lines from before and after the program body.
    StripProse,
    /// Delete the second half of a reply that is one completion concatenated with a byte-identical
    /// copy of itself — the transport-level doubling, as opposed to a model that wrote its program
    /// out twice.
    DropDoubledResponse,
}

impl HealingStrategy {
    /// Every strategy, in the order [`heal`] applies them — which is also the order the capability's
    /// config table, the docs page and the session summary list them in, so those four listings
    /// cannot drift apart.
    pub const ALL: [HealingStrategy; 3] = [
        Self::StripFences,
        Self::StripProse,
        Self::DropDoubledResponse,
    ];

    /// The strategy's stable id — the one spelling, in kebab-case.
    pub const fn id(self) -> &'static str {
        match self {
            Self::StripFences => "strip-fences",
            Self::StripProse => "strip-prose",
            Self::DropDoubledResponse => "drop-doubled-response",
        }
    }

    /// Whether a run that says nothing about this strategy gets it.
    ///
    /// **The rule: a strategy is armed by default when repairing is strictly safer than not
    /// repairing.** For two of the three it is, and the warrant is the same in both cases — the
    /// reply the strategy deletes from *could not have run as sent*. A fenced reply is not a program
    /// in any language; nor is one with prose around it. Declining to repair either of those costs
    /// the turn outright, so the default that loses least is *on*.
    ///
    /// [`DropDoubledResponse`](Self::DropDoubledResponse) is the exception, and the asymmetry is
    /// real rather than an abundance of caution: the half it deletes is **valid code under any
    /// reading other than "the transport duplicated this"**. A reply that runs its program twice is
    /// a reply that runs — so where the other two turn a dead reply into a live one, this one
    /// changes what a live reply does. That is a repair only for the models observed to emit the
    /// defect, so it is armed **deliberately**, per run, by an operator who has seen it. See the
    /// strategy's own documentation for why its match rule is nonetheless safe with almost no
    /// guards.
    pub const fn default_armed(self) -> bool {
        match self {
            Self::StripFences | Self::StripProse => true,
            Self::DropDoubledResponse => false,
        }
    }

    /// The strategy an [id](Self::id) names, or `None` when nothing does.
    ///
    /// The exact inverse of [`id`](Self::id) — written against [`ALL`](Self::ALL) rather than as a
    /// second `match`, so a strategy cannot be added to one direction and forgotten in the other.
    fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|strategy| strategy.id() == id)
    }
}

/// Which strategies are armed for a run.
///
/// One private bool per strategy rather than a set, because the set of strategies is closed and a
/// bool per strategy is what makes [`enabled`](Self::enabled) total: there is no "unknown strategy"
/// state to resolve at the point of use, only at the point of [configuration](resolve_healing).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealingConfig {
    strip_fences: bool,
    strip_prose: bool,
    drop_doubled_response: bool,
}

impl Default for HealingConfig {
    /// Each strategy at [its own default](HealingStrategy::default_armed) — which is *not* the same
    /// thing as "everything on".
    ///
    /// A strategy absent from a run's `healing` param takes this arm, so a configuration that says
    /// nothing gets the two repairs whose warrant holds unconditionally and does **not** get
    /// [`drop-doubled-response`](HealingStrategy::DropDoubledResponse). This is the arm a study
    /// compares against.
    ///
    /// Built by folding [`default_armed`](HealingStrategy::default_armed) over
    /// [`ALL`](HealingStrategy::ALL) rather than by listing bools, so a strategy's default lives in
    /// exactly one place and a new strategy cannot be added here with a silently different one.
    fn default() -> Self {
        let mut config = Self::OFF;
        for strategy in HealingStrategy::ALL {
            config.set(strategy, strategy.default_armed());
        }
        config
    }
}

impl HealingConfig {
    /// Every strategy off — what the master switch produces, and the floor two configurations are
    /// compared against.
    ///
    /// [`heal`] still runs under it and still canonicalises; it simply repairs nothing, so the reply
    /// reaches its language's prepare step exactly as the model sent it.
    pub const OFF: Self = Self {
        strip_fences: false,
        strip_prose: false,
        drop_doubled_response: false,
    };

    /// Whether `strategy` is armed.
    pub fn enabled(&self, strategy: HealingStrategy) -> bool {
        match strategy {
            HealingStrategy::StripFences => self.strip_fences,
            HealingStrategy::StripProse => self.strip_prose,
            HealingStrategy::DropDoubledResponse => self.drop_doubled_response,
        }
    }

    /// The armed strategies, in the order [`heal`] applies them.
    ///
    /// The one place the resolved configuration is read out as data rather than asked about one
    /// strategy at a time: the run records it on its session summary and names it on its launch
    /// log, because a configuration nothing observes is one a study cannot slice on.
    pub fn armed(&self) -> Vec<HealingStrategy> {
        HealingStrategy::ALL
            .into_iter()
            .filter(|strategy| self.enabled(*strategy))
            .collect()
    }

    /// The one `info` line a code-mode run logs at launch, naming every armed strategy — or saying
    /// plainly that none is.
    ///
    /// The counterpart of [`RunLimits::armed_summary`](crate::limits::RunLimits::armed_summary), and
    /// emitted for the same reason: a configuration with healing off is otherwise indistinguishable
    /// from the enabled one in an operator's log, because a run in which nothing needed repairing
    /// says nothing either way.
    pub fn armed_summary(&self) -> String {
        let armed = self.armed();
        if armed.is_empty() {
            return "response healing: disabled — every strategy is off, so a reply is compiled \
                    exactly as the model sent it"
                .to_string();
        }
        format!(
            "response healing: {}",
            armed
                .into_iter()
                .map(HealingStrategy::id)
                .collect::<Vec<_>>()
                .join(", ")
        )
    }

    /// Arm or disarm one strategy.
    pub fn set(&mut self, strategy: HealingStrategy, on: bool) {
        let field = match strategy {
            HealingStrategy::StripFences => &mut self.strip_fences,
            HealingStrategy::StripProse => &mut self.strip_prose,
            HealingStrategy::DropDoubledResponse => &mut self.drop_doubled_response,
        };
        *field = on;
    }
}

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability param arming the
/// [healing strategies](HealingStrategy). Absent takes [`HealingConfig::default`].
pub const PARAM_HEALING: &str = "healing";

/// Resolve the [healing configuration](HealingConfig) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's [`healing`](PARAM_HEALING)
/// param.
///
/// The param names a **delta against the defaults**, not a whole configuration. Saying nothing means
/// [the defaults](HealingConfig::default) — which is *not* "everything on", because
/// [`drop-doubled-response`](HealingStrategy::DropDoubledResponse) is
/// [armed deliberately](HealingStrategy::default_armed) rather than by omission. Every row below
/// that reads "the defaults" therefore means "the other two on, `drop-doubled-response` off".
///
/// | `params.healing` | Meaning |
/// | --- | --- |
/// | absent / `null` / `true` / `{}` | the **defaults** |
/// | `false` | every strategy **off** — the master switch |
/// | `{ "strip-prose": false }` | `strip-prose` off, the rest at their defaults |
/// | `{ "drop-doubled-response": true }` | `drop-doubled-response` **on**, the rest at their defaults — the one strategy an operator has to ask for |
/// | `{ "strip-prose": 0 }` | **refused**: a non-boolean is not a toggle |
/// | `{ "stripProse": false }` | **refused**: `stripProse` names no strategy |
/// | `5`, `"off"`, `[]` | **refused**: there is no set of toggles here to read |
///
/// Note the asymmetry the third and fourth rows describe: `false` is how a default-on strategy is
/// turned off and `true` is how the default-off one is turned on, and **both** travel through the
/// same `(Some(strategy), Some(on))` arm below. There is no second mechanism for arming a strategy,
/// which is what keeps the table above a description of one line of code.
///
/// A key or value gg cannot act on [refuses the launch](crate::validate) rather than leaving the
/// default standing: `{"stripFences": false}` reads as a run with `strip-fences` **on**, which is
/// the arm its author was trying to switch off, and every response-healing number the study produced
/// would then be a measurement of the other arm. The strategy ids are **contract-visible** — they are
/// what the console's capability catalogue writes and what persisted run data records — so they are
/// read literally, with only surrounding whitespace forgiven, and never guessed at.
///
/// The toggles are read whether the capability is switched **on or off**, like every other param in
/// the set: a disabled capability records the configuration the arm would have used, so the two arms
/// of one comparison stay symmetric, and a typo skipped because a switch happened to be off is a
/// typo that surfaces on the launch where it is flipped. Nothing about the run changes — healing
/// never runs where responses-as-code is off.
pub fn resolve_healing(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> HealingConfig {
    let mut config = HealingConfig::default();
    let Some(capability) = profile.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return config;
    };
    let Some(healing) = capability.params.get(PARAM_HEALING) else {
        return config;
    };

    match healing {
        // Three spellings of "say nothing", all meaning the default arm: a key that was written out
        // as null, an explicit `true`, and an object that changes nothing.
        Value::Null | Value::Bool(true) => {}
        Value::Bool(false) => config = HealingConfig::OFF,
        Value::Object(toggles) => {
            for (key, value) in toggles {
                match (HealingStrategy::from_id(key.trim()), value.as_bool()) {
                    // The one arm that moves a strategy off its default, in either direction:
                    // `false` disarms a default-on strategy and `true` arms `drop-doubled-response`.
                    (Some(strategy), Some(on)) => config.set(strategy, on),
                    // A known id carrying something that is not a toggle: reading `0` as `false`
                    // would be gg deciding what an operator meant, which is the whole of what this
                    // refusal exists to stop.
                    (Some(strategy), None) => {
                        report.report(crate::validate::LaunchDefect::run_level(
                            format!("{}.{key}", healing_locus()),
                            crate::validate::as_written(value),
                            format!(
                                "the `{}` healing strategy is armed or disarmed with `true` or \
                             `false`; gg cannot read this as either, and leaving the strategy at \
                             its default would run the arm this line was written to change.",
                                strategy.id()
                            ),
                        ))
                    }
                    (None, _) => report.report(
                        crate::validate::LaunchDefect::run_level(
                            format!("{}.{key}", healing_locus()),
                            crate::validate::as_written(value),
                            format!(
                                "`{key}` names no healing strategy, so it arms and disarms \
                                 nothing; the run would heal by a configuration nobody wrote."
                            ),
                        )
                        .known(HealingStrategy::ALL.map(HealingStrategy::id)),
                    ),
                }
            }
        }
        other => report.report(
            crate::validate::LaunchDefect::run_level(
                healing_locus(),
                crate::validate::as_written(other),
                format!(
                    "the `{PARAM_HEALING}` param is `true` (the defaults), `false` (every strategy \
                     off), or an object of per-strategy toggles; there is nothing here gg can read \
                     a set of strategies from."
                ),
            )
            .known(HealingStrategy::ALL.map(HealingStrategy::id)),
        ),
    }
    config
}

/// Where the [`healing`](PARAM_HEALING) param sits in the configuration document.
fn healing_locus() -> String {
    crate::validate::param_locus(CAPABILITY_RESPONSES_AS_CODE, PARAM_HEALING)
}

/// How the assistant message gg *records* for a code turn is derived from the model's reply — the
/// half of responses-as-code that decides what the **next** turn's prompt shows the model of *this*
/// turn.
///
/// Under responses-as-code the reply is a program, and [healing](heal) rewrites it before it runs.
/// That leaves a choice with no analogue on the tool-calling path: is the assistant turn the model
/// re-reads next turn the reply it *sent*, or the program gg actually *ran*?
///
/// The healed text is the program of record, so the answer gg records by default is the program that
/// ran. Every line number a model is handed counts lines of that text — a compiler's diagnostic, a
/// runtime's location, the frame under a panic — so a history carrying the *other* text hands the
/// model coordinates into something it has never seen. The reply as sent survives regardless, on the
/// operator's side, which is where reading the two against each other belongs.
///
/// Whichever mode is chosen, healing still runs and is still disclosed in the turn's feedback: the
/// mode governs only the stored assistant message, never whether a reply is repaired before it runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AssistantMessageMode {
    /// **No post-processing.** The assistant message is the reply exactly as the model returned it,
    /// byte for byte. Healing still repairs the reply before running it, but that repair does not
    /// leak into the recorded message — so the transcript shows what the model actually wrote, which
    /// is what a study of a model's code-only compliance wants to read.
    ///
    /// It is knowingly inconsistent rather than neutral: a reply that could not have compiled sits
    /// in the model's own history while every location gg reports counts lines of the healed text.
    /// It is an arm of a study, and the arm every other run is compared against is the default one.
    None,
    /// **Post-response healing.** The assistant message is the [healed](Healed::program) program —
    /// what gg actually compiled and ran — whenever healing rewrote the reply, and the reply
    /// verbatim when it did not ([`Healed::rewritten`] is false). The model then re-reads a clean,
    /// running program next turn rather than the malformed one it sent. The default.
    #[default]
    ResponseHealing,
}

/// The [`assistantMessages`](PARAM_ASSISTANT_MESSAGES) spelling of
/// [`AssistantMessageMode::None`].
const ASSISTANT_MESSAGES_NONE: &str = "none";
/// The [`assistantMessages`](PARAM_ASSISTANT_MESSAGES) spelling of
/// [`AssistantMessageMode::ResponseHealing`].
const ASSISTANT_MESSAGES_RESPONSE_HEALING: &str = "response-healing";

impl AssistantMessageMode {
    /// The two modes, in the spelling a [refusal](crate::validate) offers back.
    pub const ALL: [&'static str; 2] =
        [ASSISTANT_MESSAGES_NONE, ASSISTANT_MESSAGES_RESPONSE_HEALING];
}

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability param choosing which form of a
/// reply is recorded as the assistant's message. Absent takes [`AssistantMessageMode::default`].
pub const PARAM_ASSISTANT_MESSAGES: &str = "assistantMessages";

/// Resolve the [assistant-message mode](AssistantMessageMode) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's
/// [`assistantMessages`](PARAM_ASSISTANT_MESSAGES) param.
///
/// | `params.assistantMessages` | Mode |
/// | --- | --- |
/// | absent / `null` / `"response-healing"` | [`ResponseHealing`](AssistantMessageMode::ResponseHealing) — the healed program that ran (the default) |
/// | `"none"` | [`None`](AssistantMessageMode::None) — no post-processing |
/// | anything else | **refused** — the launch does not start |
///
/// Read literally — with only surrounding whitespace forgiven — and [refused](crate::validate) on
/// mismatch for the same reason [`resolve_healing`] is: the value is contract-visible (the console's
/// capability catalogue writes it, persisted run data records it), so a typo must stop the run
/// rather than record it under a mode nobody chose. The mode comes back anyway to keep the resolver
/// total for the per-turn calls that re-read it. The value is read whether the capability is
/// switched on or off, on the same rule every other param in the set follows.
pub fn resolve_assistant_messages(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> AssistantMessageMode {
    let Some(capability) = profile.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return AssistantMessageMode::default();
    };
    let Some(value) = capability.params.get(PARAM_ASSISTANT_MESSAGES) else {
        return AssistantMessageMode::default();
    };

    match value {
        Value::Null => AssistantMessageMode::default(),
        Value::String(mode) if mode.trim() == ASSISTANT_MESSAGES_NONE => AssistantMessageMode::None,
        Value::String(mode) if mode.trim() == ASSISTANT_MESSAGES_RESPONSE_HEALING => {
            AssistantMessageMode::ResponseHealing
        }
        other => {
            report.report(
                crate::validate::LaunchDefect::run_level(
                    crate::validate::param_locus(
                        CAPABILITY_RESPONSES_AS_CODE,
                        PARAM_ASSISTANT_MESSAGES,
                    ),
                    crate::validate::as_written(other),
                    format!(
                        "the `{PARAM_ASSISTANT_MESSAGES}` param names which form of a reply is \
                         recorded as the assistant's message; gg has no such mode, and recording \
                         the model's own text under the healed-program arm's name would make the \
                         two arms indistinguishable in the transcript."
                    ),
                )
                .known(AssistantMessageMode::ALL),
            );
            AssistantMessageMode::default()
        }
    }
}

/// The responses-as-code capability's healing half of the
/// [launch pass](crate::validate::validate_launch): the [strategies](resolve_healing) and the
/// [assistant-message mode](resolve_assistant_messages) `profile` declares, read exactly as the run
/// will read them.
pub fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    resolve_healing(profile, report);
    resolve_assistant_messages(profile, report);
}

/// The launch-time `info` line naming the [assistant-message mode](AssistantMessageMode) a code run
/// records under — the counterpart of [`HealingConfig::armed_summary`], and emitted for the same
/// reason: the two arms are otherwise indistinguishable in an operator's log.
pub fn assistant_messages_summary(mode: AssistantMessageMode) -> String {
    match mode {
        AssistantMessageMode::None => "assistant messages: recorded as the model sent them (no \
                                       post-processing)"
            .to_string(),
        AssistantMessageMode::ResponseHealing => {
            "assistant messages: recorded as the healed program that ran (post-response healing)"
                .to_string()
        }
    }
}

/// How many times the pipeline may run its rewriting strategies before it gives up on reaching a
/// fixpoint.
///
/// One of these passes is spent *observing* the fixpoint — the pass that applies nothing — so a
/// response converges here only if it needs fewer than four **productive** passes. Measured, no
/// round-1 reply needs more than one, and the deepest shape in the whole test corpus (a fence nested
/// inside a fence) needs two, so four leaves two passes of headroom over anything real while
/// bounding a response engineered to make two strategies undo one another.
pub const MAX_PASSES: usize = 4;

/// What one healing pass produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Healed {
    /// The text to hand the [sandbox](crate::sandbox): the healed program, which is always run.
    pub program: String,
    /// The reply exactly as it arrived, before canonicalisation and before any strategy ran.
    ///
    /// Kept because the program is what everything downstream treats as the model's source — it is
    /// what compiles, what the model's history carries and what every reported line number counts
    /// lines of — so once healing has run, this is the only copy of what it started from. It
    /// reaches the run's operator and no model.
    pub original: String,
    /// Every strategy application, in application order. A strategy may appear more than once (two
    /// nested fences are two applications), which is what makes "how many times did it fire" a count
    /// rather than a flag.
    pub applied: Vec<HealingApplication>,
    /// Whether the pipeline failed to reach a fixpoint within [`MAX_PASSES`] and every repair was
    /// therefore discarded.
    ///
    /// Carried rather than left implicit because the alternative — an empty
    /// [`applied`](Self::applied) beside an untouched program — is byte-identical to a clean
    /// response, and reporting the one response pathological enough to defeat the pipeline as
    /// "nothing was unusual" is the kind of quiet lie this subsystem exists to remove.
    pub did_not_converge: bool,
}

impl Healed {
    /// Whether the program that will run differs from the response the model sent — the metric's
    /// definition of "healed".
    pub fn rewritten(&self) -> bool {
        !self.applied.is_empty()
    }

    /// The strategies applied, in order and with repeats — what the telemetry carries.
    pub fn strategies(&self) -> Vec<HealingStrategy> {
        self.applied
            .iter()
            .map(|application| application.strategy)
            .collect()
    }
}

/// One application of one strategy, with what it did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealingApplication {
    /// The strategy that fired.
    pub strategy: HealingStrategy,
    /// What it did, in the terms the model is told about it.
    pub detail: HealingDetail,
}

/// What a strategy did, in the terms the model is told about it.
///
/// The counts are carried rather than folded into a rendered sentence because the same facts feed
/// two audiences with different needs — the model's note, which must pluralise, and the tests, which
/// must assert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealingDetail {
    /// A Markdown fence was removed.
    Fence {
        /// How the unwrapped block ended.
        close: FenceClose,
        /// How many fenced blocks were left where they were.
        ignored: usize,
        /// How many of those contained a line that is certainly code — the one case where
        /// "gg removed a wrapper" would be an understatement of what happened.
        ignored_code: usize,
    },
    /// Explanatory lines were removed from the ends of the program.
    Prose {
        /// Non-blank lines removed before it.
        leading: usize,
        /// Non-blank lines removed after it.
        trailing: usize,
    },
    /// The reply was one completion concatenated with a byte-identical copy of itself, and the
    /// trailing copy was deleted.
    DoubledResponse {
        /// How many characters the deleted copy held. Carried because it is the only figure that
        /// tells a doubling of a one-line first-turn program from a doubling of a two-hundred-line
        /// one, and the two are worth telling apart when reading a run whose model exhibits this
        /// defect — the first is the shape a length floor would have missed.
        chars: usize,
    },
}

/// How a fenced block ended — the three shapes measured in round 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FenceClose {
    /// A closing fence on its own line, as CommonMark asks. The ordinary case.
    Fenced,
    /// A closing fence with text on the same line, which does **not** close a block — so everything
    /// after it would have been swallowed into the program. The exact shape that made one round-1
    /// session unrecoverable.
    Glued,
    /// No closing fence at all: the block ran to the end of the response.
    Unterminated,
}

/// Heal one model response into the program gg will run.
///
/// Total and pure: it never panics, performs no I/O, reads no clock, and returns a [`Healed`] for
/// every input including the empty string.
///
/// It asks **no** question about whether the reply is a program. Every reply that comes in goes
/// back out as text for the run's language to prepare and the guest to evaluate: an empty reply becomes an
/// empty program that runs and does nothing, a reply of comments becomes a program that runs and
/// does nothing, and a reply that is two programs pasted together fails to compile with the
/// redeclaration error the compiler itself reports. That feedback comes from a compiler rather than
/// from gg's reading of the model's text, which is the whole point: healing repairs shapes it can
/// prove are repairable, and judges nothing.
///
/// # The pipeline
///
/// ```text
/// trim  ->  [ strip-fences -> strip-prose -> drop-doubled-response ]*
///             ^                                                  |
///             +------ repeat until a pass applies nothing -------+
/// ```
///
/// Fences first, because until the wrapper is off, "is this line prose?" is a question about the
/// wrong text — and `strip-prose` says so itself, declining outright while an opening fence
/// survives. `drop-doubled-response` last, because the doubling it recognises is a property of the
/// **whole** text and the other two change what the whole text is: a fence around a doubled body is
/// not itself a doubling, and becomes one the moment the fence comes off. Going last is what lets it
/// see that in the same pass rather than the next. [`HealingStrategy::ALL`] **is** this order.
///
/// It is a fixpoint rather than a list because a pass's output is what the next pass reads. A fence
/// nested inside a fence is one wrapper per pass and needs two; and a doubled reply whose halves are
/// each a fenced program offers `strip-fences` two candidates, so it declines — until
/// `drop-doubled-response` halves the reply at the end of the pass and leaves the single block the
/// next pass unwraps. One strategy's output enabling another's match is the reason the loop runs
/// until nothing applies.
///
/// If the fixpoint is not reached within [`MAX_PASSES`], **every repair is discarded**, the response
/// is returned as it was sent, and [`did_not_converge`](Healed::did_not_converge) says so. That
/// keeps idempotence unconditional and keeps the honesty invariant intact: gg either produces a
/// fixpoint it can explain, or it changes nothing and reports that it could not.
///
/// `dialect` is the run's [program language](crate::sandbox::ProgramLanguage)'s answer to the
/// lexical questions this module asks — passed in rather than looked up, so healing stays
/// independent of the sandbox and a test can drive the whole pipeline with a dialect that answers
/// nothing at all.
pub fn heal(reply: &str, config: &HealingConfig, dialect: &dyn Dialect) -> Healed {
    // Canonicalisation, not repair: a byte-order mark, blank lines around the reply and trailing
    // whitespace do not change what a program is, so there is no contract violation here to
    // disclose and nothing to count. It is therefore deliberately NOT an application, which is what
    // `Healed::rewritten` turns on.
    let canonical = trim_reply(reply);

    let mut text = canonical.to_string();
    let mut applied = Vec::new();

    match to_fixpoint(&mut text, config, &mut applied, MAX_PASSES, dialect) {
        Fixpoint::Converged => Healed {
            program: text,
            original: reply.to_string(),
            applied,
            did_not_converge: false,
        },
        Fixpoint::Exhausted => Healed {
            program: canonical.to_string(),
            original: reply.to_string(),
            applied: Vec::new(),
            did_not_converge: true,
        },
    }
}

/// A reply as [`heal`] considers it: without its byte-order mark, its leading blank lines or its
/// trailing whitespace — and with the **indentation of its first content line left alone**.
///
/// That last clause is the whole reason this is a function rather than a call to
/// [`str::trim`](str::trim). CommonMark makes four spaces of indentation an *indented code block*
/// rather than a fence, [`scan_fences`] implements that rule, and trimming the first line's indent
/// away would answer the question before the scanner could ask it: an indented ```` ```ts ```` would
/// become a fence, gg would report unwrapping a wrapper that was never there, and the closing run —
/// still indented, and now not a close — would be left in the program. Leading indentation is
/// Markdown's to interpret first, so it is kept here and the scanner decides; what is left of it
/// once a wrapper comes off is [`dedent`]'s business, and that is a question about a *program*
/// rather than about a reply.
///
/// A byte-order mark is stripped only where one is defined to appear, at the very start.
fn trim_reply(reply: &str) -> &str {
    let text = reply.trim_start_matches('\u{feff}').trim_end();
    let start = lines_with_offsets(text)
        .find(|(_, line)| !line.trim().is_empty())
        .map_or(text.len(), |(offset, _)| offset);
    &text[start..]
}

/// Whether any line of `source` is **certainly** a line of code.
///
/// Used by [`strip_fences`] alone, for two decisions that are both about *deleting*: whether a lone
/// block with an unrecognised tag is nonetheless the program, and whether a line outside the fences
/// is code an unwrap would throw away.
fn contains_code(source: &str, dialect: &dyn Dialect) -> bool {
    source.lines().any(|line| dialect.looks_like_code(line))
}

// ---------------------------------------------------------------------------------------------
// The pipeline's internals
// ---------------------------------------------------------------------------------------------

/// What one strategy did with the text it was handed.
///
/// Two outcomes and nothing else: a strategy either deletes something it can prove is safe to
/// delete, or it leaves the text exactly as it was. There is no third answer, because "this is not
/// a program" is not healing's question to answer — the language's prepare step answers it, with a
/// diagnostic.
pub(crate) enum StrategyOutcome {
    /// The strategy does not apply — the text is untouched and nothing is recorded.
    Declined,
    /// The strategy rewrote the text.
    Rewrote {
        /// The text after the repair, trimmed.
        text: String,
        /// What the model is told about it.
        detail: HealingDetail,
    },
}

/// How the pipeline ended.
enum Fixpoint {
    /// A pass applied nothing, so the text is a fixpoint of every armed strategy.
    Converged,
    /// Every one of the allotted passes still changed something, so no fixpoint was reached.
    Exhausted,
}

/// Apply the rewriting strategies, in [order](HealingStrategy::ALL), until a whole pass applies
/// nothing or `budget` passes have been spent.
///
/// `text` and `applied` are left holding whatever the pipeline reached. On
/// [`Exhausted`](Fixpoint::Exhausted) the caller discards both, which is what keeps a non-converging
/// response byte-identical to the one the model sent.
///
/// The budget is a parameter rather than a constant read from inside so that a test can measure how
/// many passes a real response needs: a response needing exactly *n* productive passes converges at
/// a budget of *n + 1* — one further pass is what *observes* the fixpoint — and is
/// [`Exhausted`](Fixpoint::Exhausted) at *n*.
fn to_fixpoint(
    text: &mut String,
    config: &HealingConfig,
    applied: &mut Vec<HealingApplication>,
    budget: usize,
    dialect: &dyn Dialect,
) -> Fixpoint {
    for _ in 0..budget {
        let mut changed = false;
        for strategy in HealingStrategy::ALL {
            if !config.enabled(strategy) {
                continue;
            }
            match apply(strategy, text, dialect) {
                StrategyOutcome::Declined => {}
                StrategyOutcome::Rewrote {
                    text: healed,
                    detail,
                } => {
                    applied.push(HealingApplication { strategy, detail });
                    *text = healed;
                    changed = true;
                }
            }
        }
        if !changed {
            return Fixpoint::Converged;
        }
    }
    Fixpoint::Exhausted
}

/// Run one strategy over `text`.
///
/// One total `match` so that adding a strategy fails to compile until it has an implementation —
/// the same reason [`HealingConfig::enabled`] is a `match` rather than a lookup.
fn apply(strategy: HealingStrategy, text: &str, dialect: &dyn Dialect) -> StrategyOutcome {
    match strategy {
        HealingStrategy::StripFences => strip_fences(text, dialect),
        HealingStrategy::StripProse => strip_prose(text, dialect),
        HealingStrategy::DropDoubledResponse => drop_doubled_response(text),
    }
}

// ---------------------------------------------------------------------------------------------
// strip-fences
// ---------------------------------------------------------------------------------------------

/// The fewest backticks that open a fence, and the most leading spaces one may carry — CommonMark's
/// rules, which are the ones the models were trained on and therefore the ones they follow.
///
/// Four spaces of indentation is an indented code block rather than a fence, so a line indented
/// further is not one.
const MIN_FENCE_LENGTH: usize = 3;
const MAX_FENCE_INDENT: usize = 3;

/// One fenced block the scanner found.
struct FencedBlock {
    /// The first word of the opening fence's info string, lower-cased. Empty for an untagged fence.
    tag: String,
    /// The block's contents, [dedented](dedent) — leading blank lines and trailing whitespace gone,
    /// and the indentation its lines share removed from all of them. Never empty: an empty block is
    /// not a block.
    body: String,
    /// How the block ended.
    close: FenceClose,
}

/// Everything one scan of a response found: its fenced blocks and every line **outside** them.
struct FenceScan<'a> {
    /// The blocks, in the order they appear.
    blocks: Vec<FencedBlock>,
    /// Every line that was not inside a block, plus the fragments a glued fence left on its own
    /// line. Whether any of them is certainly code is what declines 3 and 4 both turn on: it tells a
    /// fence *around* a program from a fence *inside* one, and a reply that is only prose and
    /// non-program blocks from one whose program simply was not fenced.
    outside: Vec<&'a str>,
}

/// Remove a Markdown code fence wrapping the program.
///
/// **Matches** a fence around the whole program — tagged or not, closed properly, closed with prose
/// glued on, or never closed. **Rewrites** the response to the body of the one *candidate* block,
/// [dedented](dedent); everything outside the fences is deleted.
///
/// The dedent is part of the unwrap rather than a step after it: CommonMark lets a fence carry up to
/// three spaces of indentation and models routinely indent a whole block under a lead-in, so the
/// body arrives shifted right as a body and has to come out as a program. Every line moves by the
/// same amount, which is what keeps the deletion a deletion.
///
/// # Candidacy — a three-tier ladder, first non-empty tier wins
///
/// 1. blocks whose tag is one of this language's own
///    [program fence tags](Dialect::program_fence_tags);
/// 2. otherwise, blocks with **no** tag;
/// 3. otherwise, blocks whose (unrecognised) tag is anything else **and** whose body satisfies
///    [`contains_code`].
///
/// Only the first tier consults the dialect. Markdown is not a program language, so the scanner, the
/// ladder and every decline below read the same in every language; the *tag list* is the one datum
/// that does not.
///
/// # The decline ladder
///
/// | # | Condition | Result |
/// | --- | --- | --- |
/// | **D1** | no blocks at all | not applicable; nothing recorded |
/// | **D2** | **two or more candidates** | decline — gg cannot know which of them was meant, and picking one would delete a program the model wrote |
/// | **D3** | exactly one candidate, but some line **outside the fences** is certainly code | decline — unwrapping would delete real code |
/// | **D4** | zero candidates | decline |
/// | — | otherwise | unwrap to the single candidate's body |
///
/// **D2 declines rather than refusing the reply.** A reply offering several candidate blocks is
/// left exactly as the model sent it and compiled: what comes back is the compiler's own error over
/// the model's own text — most often the redeclaration that two pasted programs really do produce —
/// rather than gg's reading of how many programs it thinks the reply contains. Healing may delete
/// what it can prove is safe to delete and nothing else; it does not adjudicate.
///
/// **D3 asks about every line outside the fences, not only the lines above the first one.** What
/// distinguishes a fence *inside* a program from a fence *around* one is whether real code survives
/// outside it — and that code is as likely to sit below the block as above it. A model that fences
/// the working half of its program and then writes the call that ends the session underneath is the
/// shape this decline exists for: unwrapping there would delete the ending, the run could never
/// terminate, and — because everything outside a candidate block is dropped without a trace in
/// [`Fence`](HealingDetail::Fence)'s counts — the model would never be told. Deleting the model's
/// code silently is the one outcome healing may not produce, so the question is asked over the whole
/// reply.
///
/// The narrowness lives in the predicate instead, where it costs nothing:
/// [`looks_like_code`](Dialect::looks_like_code) is true only of shapes English does not have, so a
/// lead-in sentence with a semicolon in it does not block the unwrap, and across every round-1 reply
/// this strategy accepted as a single candidate **no** line outside the fences is code-shaped.
fn strip_fences(text: &str, dialect: &dyn Dialect) -> StrategyOutcome {
    let scan = scan_fences(text, dialect);
    // D1.
    if scan.blocks.is_empty() {
        return StrategyOutcome::Declined;
    }

    let candidates = candidate_blocks(&scan.blocks, dialect);
    // D2.
    if candidates.len() >= 2 {
        return StrategyOutcome::Declined;
    }

    // D3: is there code the unwrap would throw away? Above the fences it is a program that contains
    // one; below them it is a program the model continued past one. Both are code, and both are
    // deleted by an unwrap that reports only which wrapper it removed.
    if scan
        .outside
        .iter()
        .any(|line| dialect.looks_like_code(line))
    {
        return StrategyOutcome::Declined;
    }

    // D4.
    let Some(&chosen) = candidates.first() else {
        return StrategyOutcome::Declined;
    };

    let ignored = scan.blocks.len() - 1;
    let ignored_code = scan
        .blocks
        .iter()
        .enumerate()
        .filter(|(index, block)| *index != chosen && contains_code(&block.body, dialect))
        .count();
    StrategyOutcome::Rewrote {
        text: scan.blocks[chosen].body.clone(),
        detail: HealingDetail::Fence {
            close: scan.blocks[chosen].close,
            ignored,
            ignored_code,
        },
    }
}

/// The indices of the blocks that could each have been the program, per the three-tier ladder in
/// [`strip_fences`].
fn candidate_blocks(blocks: &[FencedBlock], dialect: &dyn Dialect) -> Vec<usize> {
    let tier = |predicate: &dyn Fn(&FencedBlock) -> bool| -> Vec<usize> {
        blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| predicate(block))
            .map(|(index, _)| index)
            .collect()
    };

    let tags = dialect.program_fence_tags();
    let recognised = tier(&|block| tags.contains(&block.tag.as_str()));
    if !recognised.is_empty() {
        return recognised;
    }
    let untagged = tier(&|block| block.tag.is_empty());
    if !untagged.is_empty() {
        return untagged;
    }
    tier(&|block| !block.tag.is_empty() && contains_code(&block.body, dialect))
}

/// Every non-empty fenced block in `text`, and every line outside one.
///
/// # Why the full fence rule, and not "find the next ```` ``` ````"
///
/// A program routinely *contains* a fenced block — writing a README, a docs page or a spec snippet
/// is ordinary gg work — and a model that does so opens its program with a **longer** fence, which
/// is exactly what CommonMark asks of it. Scanning for the first bare ```` ``` ```` would cut such a
/// program at the fence inside its own string literal and hand the parser an unterminated
/// literal: a diagnostic about code the model never wrote, with no way for it to see the
/// truncation. So the opening fence's **length** is recorded, both fences must start their own line,
/// and the closing fence must be at least as long as the opening one.
///
/// # The two relaxations, and the one rule they do not touch
///
/// Both come from measured round-1 responses, and neither relaxes the length rule.
///
/// * **The glued open.** While no block is open, a line whose *prose* is followed by a run of ≥3
///   backticks opens a block, and the prose becomes an outside line — `` …to confirm.```ts ``. It
///   requires real text before the run precisely so that an indented ```` ```sh ```` (four spaces,
///   which CommonMark makes an indented code block rather than a fence) is still not a fence.
/// * **The glued close.** A closing run of at least the opener's length with text after it on the
///   same line closes the block as [`Glued`](FenceClose::Glued), and the trailing text becomes an
///   outside line — `` ```Consumed fuel: 24,000 / 1,000,000 budget. ``, measured seven times in one
///   real reply. CommonMark does not accept that as a close, which is exactly why the reply that
///   contained it was read as one enormous program and looped its session to death.
///
/// End of input with a block still open closes it as [`Unterminated`](FenceClose::Unterminated) and
/// runs what it holds, rather than abandoning the scan: half a fenced block is still the model's
/// whole program, and refusing it teaches nothing that running it does not.
fn scan_fences<'a>(text: &'a str, dialect: &dyn Dialect) -> FenceScan<'a> {
    let lines: Vec<(usize, &str)> = lines_with_offsets(text).collect();
    let mut blocks = Vec::new();
    let mut outside = Vec::new();

    let mut index = 0;
    while index < lines.len() {
        let (_, line) = lines[index];
        let opened = match opening_fence(line) {
            Some((length, info)) => Some((length, fence_tag(info))),
            None => glued_open(line, dialect).map(|(before, length, tag)| {
                outside.push(before);
                (length, tag)
            }),
        };
        let Some((length, tag)) = opened else {
            outside.push(line);
            index += 1;
            continue;
        };

        // The body starts at the next line and runs to the closing fence, or to the end of the
        // response. Slicing the original text rather than re-joining the lines is what keeps a
        // program's own line endings — `\r\n` included — exactly as the model wrote them.
        index += 1;
        let body_start = lines.get(index).map_or(text.len(), |(start, _)| *start);
        let mut body_end = text.len();
        let mut close = FenceClose::Unterminated;
        while index < lines.len() {
            let (start, line) = lines[index];
            if let Some(rest) = closing_fence(line, length) {
                body_end = start;
                close = if rest.trim().is_empty() {
                    FenceClose::Fenced
                } else {
                    outside.push(rest);
                    FenceClose::Glued
                };
                index += 1;
                break;
            }
            index += 1;
        }

        // `dedent` rather than `trim`: a block a model indented is a block whose *every* line is
        // indented, and dedenting only the first one — which is all `trim` does — would hand a
        // whitespace-significant language a program gg had misaligned. See [`dedent`].
        let body = dedent(&text[body_start..body_end]);
        // An empty block is not a block: it offers nothing to run, and counting it would let a
        // model's illustrative ```` ``` ```` pair turn a single-program reply into several
        // candidates.
        if !body.is_empty() {
            blocks.push(FencedBlock { tag, body, close });
        }
    }

    FenceScan { blocks, outside }
}

/// The fence `line` opens, as `(its length in backticks, its info string)`, or `None`.
///
/// A backtick fence's info string may not itself contain a backtick — CommonMark's rule, kept
/// because it is what stops an inline-code span in prose being read as a fence.
fn opening_fence(line: &str) -> Option<(usize, &str)> {
    let line = undented(line)?;
    let length = backticks(line);
    let info = &line[length..];
    (length >= MIN_FENCE_LENGTH && !info.contains('`')).then_some((length, info))
}

/// The **glued** open: prose, then a run of backticks that a model meant as an opening fence.
///
/// Returns `(the prose before the run, the run's length, the tag)`. Declines when there is no real
/// text before the run (an ordinary or over-indented fence, neither of which is this shape), when
/// that text is certainly code (a program writing a fence into a file), and when what follows the
/// run is anything but end-of-line or one bare word (an info string gg cannot read is not one it
/// should guess at).
fn glued_open<'a>(line: &'a str, dialect: &dyn Dialect) -> Option<(&'a str, usize, String)> {
    let mut offset = 0;
    while let Some(found) = line[offset..].find('`') {
        let start = offset + found;
        let length = backticks(&line[start..]);
        if length < MIN_FENCE_LENGTH {
            offset = start + length;
            continue;
        }
        let before = &line[..start];
        if before.trim().is_empty() || dialect.looks_like_code(before) {
            return None;
        }
        let after = line[start + length..].trim_end_matches('\r');
        if after.is_empty() {
            return Some((before, length, String::new()));
        }
        if after.contains(char::is_whitespace) || after.contains('`') {
            return None;
        }
        return Some((before, length, after.to_ascii_lowercase()));
    }
    None
}

/// Whether `line` closes a fence opened with `length` backticks, and what it carried after them.
///
/// The run must start its own line (CommonMark's three-space allowance) and be at least as long as
/// the opener. Both halves are load-bearing: without the first, a ```` ``` ```` inside a template
/// literal truncates the program; without the second, a four-backtick program is cut at the first
/// three-backtick fence it contains.
fn closing_fence(line: &str, length: usize) -> Option<&str> {
    let line = undented(line)?;
    let ticks = backticks(line);
    (ticks >= length).then(|| &line[ticks..])
}

/// The tag an info string declares: its first word, lower-cased, or empty.
fn fence_tag(info: &str) -> String {
    info.split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// `line` with its leading spaces removed, or `None` when it carries more than a fence may.
fn undented(line: &str) -> Option<&str> {
    let indent = line.bytes().take_while(|byte| *byte == b' ').count();
    (indent <= MAX_FENCE_INDENT).then(|| &line[indent..])
}

/// How many backticks `line` starts with.
fn backticks(line: &str) -> usize {
    line.bytes().take_while(|byte| *byte == b'`').count()
}

// ---------------------------------------------------------------------------------------------
// strip-prose
// ---------------------------------------------------------------------------------------------

/// Remove explanatory lines from before and after the program.
///
/// **Matches** contiguous runs of certainly-prose lines at the **start** and **end** of the text,
/// and nowhere else: the longest leading run in which every non-blank line satisfies
/// [`is_prose_line`](Dialect::is_prose_line) and at least one does, and symmetrically at the end.
/// Nothing in the middle is ever touched.
///
/// **Declines** at the first line that is not certainly prose — no scanning past it, no paragraph
/// heuristics — and **while the text still contains an opening fence**, because its precondition is
/// "this is a program with prose around it", which is false while a wrapper survives. That last
/// decline is what stops it chewing Markdown [`strip_fences`] deliberately declined to unwrap and
/// then reporting a repair that repaired nothing. It also declines when removal would leave nothing
/// at all: a reply that is prose from end to end has no program under the explanation, so there is
/// nothing to strip *to* — it goes on to be prepared as the model wrote it, and the diagnostic the
/// model gets is the parser's.
///
/// It is deliberately severe. Round 1 produced *no* bare-program-with-prose responses — every model
/// fenced — so a strategy with no evidence behind it gets the setting where a false positive costs
/// one turn with a located diagnostic and a false negative deletes the model's code.
fn strip_prose(text: &str, dialect: &dyn Dialect) -> StrategyOutcome {
    if !scan_fences(text, dialect).blocks.is_empty() {
        return StrategyOutcome::Declined;
    }

    let lines: Vec<(usize, &str)> = lines_with_offsets(text).collect();

    let mut leading_end = 0;
    let mut leading = 0;
    while let Some((_, line)) = lines.get(leading_end) {
        if line.trim().is_empty() {
            leading_end += 1;
        } else if dialect.is_prose_line(line) {
            leading += 1;
            leading_end += 1;
        } else {
            break;
        }
    }

    // Every line was prose or blank, so there is no program under the explanation and nothing to
    // strip to. This strategy only ever deletes text from around a program.
    if leading > 0 && leading_end == lines.len() {
        return StrategyOutcome::Declined;
    }
    if leading == 0 {
        leading_end = 0;
    }

    let mut trailing_start = lines.len();
    let mut trailing = 0;
    while trailing_start > leading_end {
        let (_, line) = lines[trailing_start - 1];
        if line.trim().is_empty() {
            trailing_start -= 1;
        } else if dialect.is_prose_line(line) {
            trailing += 1;
            trailing_start -= 1;
        } else {
            break;
        }
    }
    if trailing == 0 {
        trailing_start = lines.len();
    }

    if leading == 0 && trailing == 0 {
        return StrategyOutcome::Declined;
    }

    let start = lines[leading_end].0;
    let end = lines
        .get(trailing_start)
        .map_or(text.len(), |(offset, _)| *offset);
    StrategyOutcome::Rewrote {
        // Dedented for the same reason an unwrapped fence is: prose above a program is routinely a
        // lead-in that indents what follows it, and a program left half-dedented is one gg
        // misaligned. See [`dedent`].
        text: dedent(&text[start..end]),
        detail: HealingDetail::Prose { leading, trailing },
    }
}

// ---------------------------------------------------------------------------------------------
// drop-doubled-response
// ---------------------------------------------------------------------------------------------

/// Repair the reply that is one completion concatenated with a byte-identical copy of itself.
///
/// # The defect
///
/// A provider returns a completion whose text is literally `X + X` — `"foo();\nbar();foo();\nbar();"`
/// where the model produced `"foo();\nbar();"`. Nothing separates the halves: no blank line, no
/// fence, not so much as a space. It is a **transport** fault rather than a model one: the model
/// wrote one program and the reply carries two, with nothing in the text to say so. Where the
/// doubling happens to redeclare something the language refuses twice a compiler at least reports
/// it, but a doubled body of bare statements compiles and runs — doing everything the model asked
/// for a second time — and the byte-exact concatenation is then the only evidence the fault leaves.
///
/// # The match rule
///
/// Let `t` be the text with trailing whitespace trimmed. **Matches** when `t.len()` is even and
/// `t[..t.len()/2] == t[t.len()/2..]`; **rewrites** to the first half.
///
/// The comparison is of **exact bytes**, deliberately: whitespace is not normalised, no line
/// structure is consulted and no token is parsed. The defect this repairs is a byte-exact
/// concatenation, so an inexact "near doubling" is a *model* that wrote something twice, which is
/// not this strategy's business.
///
/// # The decline ladder — and why it is this short
///
/// | # | Condition | Result |
/// | --- | --- | --- |
/// | **D1** | `t` has odd length | decline — a string of odd length cannot be `X + X` |
/// | **D2** | the midpoint is not a `char` boundary | decline — see below; this is panic-safety, not a rule |
/// | **D3** | the halves differ in any byte | decline |
/// | **D4** | the half is empty | decline — the only size floor, and it exists so an empty or whitespace-only reply is not "repaired" into itself |
/// | — | otherwise | keep the first half |
///
/// **D2 is panic-safety, not a heuristic.** Slicing a multi-byte UTF-8 sequence down the middle
/// panics, so the boundary has to be checked before the slice is taken. It is not a tunable rule and
/// it excludes nothing a rule would want to keep: a midpoint inside a character means the two halves
/// contain different fragments of that character, so they could not have compared equal anyway. A
/// later reader should not mistake it for a guard worth relaxing and delete it.
///
/// # Why almost no other guards — the separator argument
///
/// This is the one strategy whose warrant is not "the reply could not have run as sent" (it could —
/// twice), so the reason it is safe has to be argued rather than asserted. It is the **separator**:
///
/// > A model that means to repeat a statement writes something between the two copies. `step();
/// > step();` has a space; `step();\nstep();` has a newline. **Any odd-length separator makes the
/// > whole reply odd-length**, so D1 declines on arithmetic alone, before a single byte is compared.
/// > Two copies can only compare equal when the model emitted them with *no* separator at all —
/// > `step();step();` — which is not a shape models produce. The defect, by contrast, is exactly
/// > that: a concatenation with nothing between the copies, because nothing wrote a separator.
///
/// Two consequences follow, and both are load-bearing:
///
/// * **No minimum length.** The observed doubling frequently happens on a run's **first** turn,
///   where the program is a line or two — so any floor worth the name would miss precisely the case
///   this strategy exists for. D4's "not empty" is the whole size rule.
/// * **No newline requirement and no minimum statement count.** A single-line reply that is an exact
///   doubling is the defect and not the model's intent, for the separator reason above.
///
/// # The one strategy with no dialect hook
///
/// Every other repair asks the run's language something. This one asks nothing, and should not: it
/// is byte arithmetic over the reply, and the defect it repairs — a transport that recorded one
/// completion twice — belongs to the transport rather than to anything the model wrote. A later
/// reader looking for the hook it does not have should stop looking; adding one would be adding a
/// way for a language to get this wrong.
///
/// It applies **once** per pass. A quadrupled reply is therefore halved twice by the
/// [fixpoint loop](to_fixpoint), one halving per pass: each halving leaves a shorter text on which
/// the same match either holds again or does not, so nothing here has to reason about how many times
/// the transport repeated itself.
fn drop_doubled_response(text: &str) -> StrategyOutcome {
    let trimmed = text.trim_end();
    let middle = trimmed.len() / 2;
    // D1, then D2 — the arithmetic and the panic-safety check, in that order, because the second is
    // only meaningful once the first has produced a midpoint to test.
    if !trimmed.len().is_multiple_of(2) || !trimmed.is_char_boundary(middle) {
        return StrategyOutcome::Declined;
    }
    let (head, tail) = trimmed.split_at(middle);
    // D4 before D3 in code (an empty head trivially equals an empty tail, so the emptiness test has
    // to come first or a whitespace-only reply would be "repaired" into itself and counted).
    if head.is_empty() || head != tail {
        return StrategyOutcome::Declined;
    }
    // No further trim is needed and none is done: `head` ends with the same bytes `tail` does, and
    // `tail` ends `trimmed`, which was trimmed — so the half cannot end in whitespace. Its *leading*
    // whitespace is kept, for the reason [`trim_reply`] keeps the first line's indentation.
    StrategyOutcome::Rewrote {
        text: head.to_string(),
        detail: HealingDetail::DoubledResponse {
            chars: tail.chars().count(),
        },
    }
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/// Every line of `src` as `(byte offset, the line without its terminator)`.
///
/// Offsets rather than an iterator of `&str` because two strategies rebuild the text by *slicing*
/// the original — the only way to delete lines without also rewriting the line endings of the ones
/// that survive.
///
/// `pub(crate)` because both halves of the split need it: the skeleton's fence and prose scans, and
/// every [dialect](Dialect) whose lexer walks the same lines. Two spellings of "where does line *n*
/// begin" is exactly the drift one shared helper removes.
pub(crate) fn lines_with_offsets(src: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut offset = 0;
    src.split_inclusive('\n').map(move |raw| {
        let start = offset;
        offset += raw.len();
        let line = raw.strip_suffix('\n').unwrap_or(raw);
        (start, line.strip_suffix('\r').unwrap_or(line))
    })
}

/// The longer common prefix of two strings, in whole characters.
///
/// [`dedent`]'s reducer: the indentation a block's lines share is what every one of them has in
/// common, folded pairwise. Whole characters rather than bytes, so a prefix can never be cut through
/// the middle of one.
fn common_prefix<'a>(left: &'a str, right: &'a str) -> &'a str {
    let end = left
        .char_indices()
        .zip(right.char_indices())
        .take_while(|((_, a), (_, b))| a == b)
        .map(|((index, c), _)| index + c.len_utf8())
        .last()
        .unwrap_or(0);
    &left[..end]
}

/// `text` as a **program**: without its leading blank lines or its trailing whitespace, and with the
/// indentation every one of its lines shares removed from all of them.
///
/// # Why this is not `str::trim`
///
/// Because `trim` dedents the first line and no other. A block a model indented — inside a list
/// item, under a numbered step, or simply because it indented its whole answer — comes out of
/// [`str::trim`](str::trim) with line 1 flush against the margin and every following line still
/// carrying the indent the model wrote. In a language where indentation is punctuation that is not a
/// cosmetic difference: `x = 1` followed by `␣␣␣y = 2` is an unexpected-indent error over a program
/// the model wrote correctly, reported against text gg produced. The reply is untouched, the
/// diagnostic is real, and nothing in it points at healing — which is what makes this the worst
/// shape of defect the pipeline can have.
///
/// It stayed invisible because gg had one language and that language ignores leading whitespace,
/// and because the [delete-only invariant](Dialect) compares *non-whitespace* characters, so it
/// cannot see indentation at all by construction. Every line moving by the same amount is what makes
/// this safe and what makes it a repair: relative indentation — the only thing a whitespace-
/// significant language reads — is exactly what is preserved.
///
/// # What "shared" means
///
/// The longest whitespace prefix common to every **non-blank** line, compared as characters, so a
/// tab-indented block and a space-indented one are each dedented by their own unit and a block
/// mixing the two is dedented only by what its lines literally share. A blank line has no
/// indentation to share and is not consulted; it gives up whatever leading whitespace it has.
///
/// Lines that begin inside a multi-line string are counted with the rest. That is deliberate: a
/// prefix *every* line shares — the string's own lines included — is the block's indentation, and
/// the only way it could have got there is that the model indented the block. A string whose lines
/// start further left than the code around them lowers the shared prefix, which is the conservative
/// answer.
pub(crate) fn dedent(text: &str) -> String {
    let text = text.trim_end();
    let start = lines_with_offsets(text)
        .find(|(_, line)| !line.trim().is_empty())
        .map_or(text.len(), |(offset, _)| offset);
    let text = &text[start..];

    let indent = lines_with_offsets(text)
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(_, line)| &line[..line.len() - line.trim_start().len()])
        .reduce(common_prefix)
        .unwrap_or_default();
    if indent.is_empty() {
        return text.to_string();
    }

    // `split_inclusive` keeps each line's own terminator, so a reply written with `\r\n` keeps them.
    text.split_inclusive('\n')
        .map(|line| {
            line.strip_prefix(indent)
                .unwrap_or_else(|| line.trim_start_matches([' ', '\t']))
        })
        .collect()
}

/// `n` and its noun, pluralised the English way.
///
/// `pub(crate)` because the [code turn](crate::agent) renders count-bearing clauses of its own — the
/// code modules that failed to load, the programs a chained turn ran — and two spellings of "1
/// program" in one turn's feedback is exactly the drift a shared helper removes.
pub(crate) fn plural(count: usize, noun: &str) -> String {
    if count == 1 {
        format!("{count} {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

// `pub(crate)`: the corpus, the configuration enumerator and the `healed` helpers are shared with
// each language's own dialect tests, which live beside that language rather than here. One corpus,
// read from both halves of the split.
#[cfg(test)]
#[path = "healing.test.rs"]
pub(crate) mod tests;

#[cfg(test)]
#[path = "healing.fences.test.rs"]
mod fence_tests;

#[cfg(test)]
#[path = "healing.programs.test.rs"]
mod program_tests;
