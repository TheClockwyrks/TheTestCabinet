//! **Response healing** — the pass that sits between a model's raw reply and the
//! [preparation](crate::sandbox::ProgramLanguage::prepare_program) that turns it into source a guest
//! can evaluate, repairing the contract violations models actually commit and saying so.
//!
//! Under [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) the model's whole
//! reply *is* the program: there is no fenced block to extract, no language tag, and no
//! first-block-wins rule. That contract is simple enough to state in one sentence and simple enough
//! to break in half a dozen ways, and real models break it — they wrap the program in a Markdown
//! fence, they glue a sentence onto the closing fence (which CommonMark does not accept as a close,
//! so the sentence becomes part of the program), they explain themselves above and below the code,
//! they `import` a surface that is already in scope, and they wrap everything in an `async function
//! main()` whose `await`s this synchronous sandbox cannot honour.
//!
//! Healing turns those replies into the program the model meant, and — because the point of the
//! capability is to *measure* how well models follow a code-only contract — it counts and discloses
//! every repair it makes rather than performing them behind the model's back.
//!
//! # The invariant that makes it honest
//!
//! > **Healing only ever deletes.** Every strategy removes contiguous text;
//! > [`unwrap-async`](HealingStrategy::UnwrapAsync) additionally removes leading whitespace from
//! > the body's lines. No strategy inserts a character, moves a line, rewrites a token in place, or
//! > reorders anything. Therefore **the healed program, with whitespace removed, is a subsequence
//! > of the response with whitespace removed.**
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
//! and the ablation is honest: turning a strategy off changes only what [`heal`] returns.
//!
//! # The skeleton and the [dialect](Dialect)
//!
//! Which repairs exist, in which order they run, what makes each of them *decline*, and what the
//! model is told about the ones that fired are all facts about **gg's contract**, not about any one
//! program language: a model that fences its program, explains it, doubles it or wraps it does so in
//! whatever language it was asked to write. Those facts are this module — the skeleton.
//!
//! What a language *does* own is the handful of lexical questions the skeleton asks along the way:
//! which fence tags mean "this block is the program", whether a line is certainly code or certainly
//! prose, which bytes of a source are code rather than string or comment text, whether a line is a
//! complete module import, whether a repeated tail redeclares a binding the language refuses twice,
//! and how a whole-program concurrency wrapper comes off. Each is a method on [`Dialect`], and each
//! language's implementation lives with the rest of that language under `sandbox/language/`.
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
/// Every method is a question the skeleton needs answered before it can decide that a deletion is
/// safe, and every one of them has a different answer per language while the decision built on it
/// does not. A dialect is therefore small, total and side-effect-free: it looks at text and says
/// yes, no, or "I could not tell", and it rewrites nothing except in
/// [`unwrap_async`](Self::unwrap_async), whose rewrite is a deletion the invariant below still
/// binds.
///
/// # The rule every implementation inherits
///
/// > **Healing only ever deletes.** Whatever a dialect answers, the healed program with its
/// > whitespace removed must remain a subsequence of the response with its whitespace removed.
///
/// That is the property the whole subsystem rests on, and it has to be re-earned per language rather
/// than inherited: a dialect whose [`is_prose_line`](Self::is_prose_line) were too generous would
/// delete a line of a model's program, and no amount of correctness in the skeleton would notice. So
/// the trait carries [`fixtures`](Self::fixtures) — replies in this language that the delete-only
/// harness runs the whole pipeline over, under every configuration — and a language cannot be
/// registered without contributing them.
///
/// # Answering "no" is always safe
///
/// A dialect that declines every question leaves the four dialect-driven strategies inert while the
/// two that are pure skeleton — `strip-fences` over an untagged block, and `drop-doubled-response` —
/// go on working exactly as they do now. That is what makes a language's dialect something it can
/// grow into rather than a prerequisite for running at all, and it is what the tests' inert dialect
/// asserts, so the skeleton is demonstrably not one language's rules with the labels filed off.
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
    /// `None` means the source did not lex cleanly, and every strategy that needs the mask declines
    /// on it. That is the correct failure mode for a lexer that has lost its place: the alternative
    /// is deleting text on the strength of a reading already known to be wrong.
    fn code_mask(&self, src: &str) -> Option<CodeMask>;

    /// Whether the trimmed `line` is a **complete single-line** module import.
    ///
    /// "Complete" is load-bearing: a statement whose end is somewhere below is one only a parser can
    /// delete correctly, and healing is not a parser.
    fn is_import_statement(&self, line: &str) -> bool;

    /// Whether `text` makes, at its top level, a binding this language refuses to see **twice**.
    ///
    /// This is the proof that deleting a repeated tail removes text that could never have run: if
    /// the reply as sent redeclares such a binding, the language refuses it before a statement
    /// executes, so the deletion changes no behaviour because there was none to change. A language
    /// with no such rule answers `false` and thereby gives up
    /// [`drop-duplicate-program`](HealingStrategy::DropDuplicateProgram) — which is right, because
    /// without the proof that strategy would be deleting work the model asked to have done twice.
    ///
    /// `base` is where `text` starts inside the source `mask` was built over, so a caller may ask
    /// about a slice of it.
    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool;

    /// Unwrap a concurrency wrapper around the **whole** program, if this language has one and
    /// `text` is entirely made of it.
    ///
    /// Answers with the wrapper shape, the program that was inside it, and how many suspension
    /// tokens went with it. A language with no such construct — or one whose guest could honour it —
    /// answers `None`, and so does one that recognises a wrapper it must not remove.
    fn unwrap_async(&self, text: &str, mask: &CodeMask) -> Option<Unwrapped>;

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
/// The question [`drop_imports`], [`unwrap_async`] and [`drop_duplicate_program`] each ask of it is
/// the same one: is this byte code? — so that an import inside a string, a suspension keyword inside
/// a comment, or a declaration inside a template literal is left alone.
///
/// The type lives here with a per-language *filler*, because the shape of the answer is the same in
/// every language — one flag per byte, out of range is not code — and only the lexer that produces
/// it differs. That is what lets a skeleton strategy index a mask without knowing whose it is.
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
    /// built: every strategy that reads one is deciding whether to delete text, and a mask that
    /// could be edited afterwards is a decision that could be revised behind the decider's back.
    pub fn from_flags(code: Vec<bool>) -> Self {
        Self { code }
    }

    /// Whether the byte at `index` is code. Out-of-range indices are not, so a caller that has
    /// already rewritten its text cannot silently read past the end of the mask.
    pub fn is_code(&self, index: usize) -> bool {
        self.code.get(index) == Some(&true)
    }
}

/// What a dialect's [unwrap](Dialect::unwrap_async) produced: the wrapper it recognised, the program
/// that was inside it, and how many suspension tokens it deleted on the way out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unwrapped {
    /// Which wrapper shape it was — what the model is told came off.
    pub wrapper: AsyncWrapper,
    /// The unwrapped program: the body, dedented, with its suspension tokens gone.
    pub text: String,
    /// How many of those tokens were deleted, which is the count the model's note carries.
    pub awaits: usize,
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
    /// Delete an exact repeated trailing copy of the program — the fence-free shape of a model that
    /// sent the same program twice.
    DropDuplicateProgram,
    /// Remove `import`/`require` statements for a tool surface that is already in scope.
    DropImports,
    /// Unwrap an `async` wrapper around the whole program and delete the `await`s it implied.
    UnwrapAsync,
}

impl HealingStrategy {
    /// Every strategy, in the order [`heal`] applies them — which is also the order the capability's
    /// config table, the docs page and the session summary list them in, so those four listings
    /// cannot drift apart.
    pub const ALL: [HealingStrategy; 6] = [
        Self::StripFences,
        Self::StripProse,
        Self::DropDoubledResponse,
        Self::DropDuplicateProgram,
        Self::DropImports,
        Self::UnwrapAsync,
    ];

    /// The strategy's stable id — the one spelling, in kebab-case.
    pub const fn id(self) -> &'static str {
        match self {
            Self::StripFences => "strip-fences",
            Self::StripProse => "strip-prose",
            Self::DropDoubledResponse => "drop-doubled-response",
            Self::DropDuplicateProgram => "drop-duplicate-program",
            Self::DropImports => "drop-imports",
            Self::UnwrapAsync => "unwrap-async",
        }
    }

    /// Whether a run that says nothing about this strategy gets it.
    ///
    /// **The rule: a strategy is armed by default when repairing is strictly safer than not
    /// repairing.** For five of the six it is, and the warrant is the same in each case — the reply
    /// the strategy deletes from *could not have run as sent*. A fenced reply is not a program in
    /// any language; nor is one with prose around it; a reply that redeclares a top-level binding
    /// the language refuses twice is refused before a statement of it executes; an import has no
    /// module loader to resolve it; a called concurrency wrapper cannot resolve its own suspensions
    /// in a synchronous sandbox. Declining to
    /// repair any of those costs the turn outright, so the default that loses least is *on*.
    ///
    /// [`DropDoubledResponse`](Self::DropDoubledResponse) is the exception, and the asymmetry is
    /// real rather than an abundance of caution: the half it deletes is **valid code under any
    /// reading other than "the transport duplicated this"**. A reply that runs its program twice is
    /// a reply that runs — so where every other strategy turns a dead reply into a live one, this
    /// one changes what a live reply does. That is a repair only for the models observed to emit
    /// the defect, so it is armed **deliberately**, per run, by an operator who has seen it. See the
    /// strategy's own documentation for why its match rule is nonetheless safe with almost no
    /// guards.
    pub const fn default_armed(self) -> bool {
        match self {
            Self::StripFences
            | Self::StripProse
            | Self::DropDuplicateProgram
            | Self::DropImports
            | Self::UnwrapAsync => true,
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
    drop_duplicate_program: bool,
    drop_imports: bool,
    unwrap_async: bool,
}

impl Default for HealingConfig {
    /// Each strategy at [its own default](HealingStrategy::default_armed) — which is *not* the same
    /// thing as "everything on".
    ///
    /// A strategy absent from a run's `healing` param takes this arm, so a configuration that says
    /// nothing gets the five repairs whose warrant holds unconditionally and does **not** get
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
    /// Every strategy off — the master switch's arm, and the ablation's floor.
    ///
    /// [`heal`] still runs under it and still canonicalises; it simply repairs nothing, so the reply
    /// reaches its language's prepare step exactly as the model sent it.
    pub const OFF: Self = Self {
        strip_fences: false,
        strip_prose: false,
        drop_doubled_response: false,
        drop_duplicate_program: false,
        drop_imports: false,
        unwrap_async: false,
    };

    /// Whether `strategy` is armed.
    pub fn enabled(&self, strategy: HealingStrategy) -> bool {
        match strategy {
            HealingStrategy::StripFences => self.strip_fences,
            HealingStrategy::StripProse => self.strip_prose,
            HealingStrategy::DropDoubledResponse => self.drop_doubled_response,
            HealingStrategy::DropDuplicateProgram => self.drop_duplicate_program,
            HealingStrategy::DropImports => self.drop_imports,
            HealingStrategy::UnwrapAsync => self.unwrap_async,
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
    /// emitted for the same reason: the disabled arm of an ablation is otherwise indistinguishable
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
            HealingStrategy::DropDuplicateProgram => &mut self.drop_duplicate_program,
            HealingStrategy::DropImports => &mut self.drop_imports,
            HealingStrategy::UnwrapAsync => &mut self.unwrap_async,
        };
        *field = on;
    }
}

/// A [healing configuration](HealingConfig) resolved from a capability set, together with every
/// `healing` key gg could not act on.
///
/// The unknown keys are carried out rather than dropped because a typo in an ablation's
/// configuration is the one failure this subsystem cannot survive: `{"stripFences": false}` would
/// otherwise run the default arm silently, under the disabled arm's name, and every number the study
/// produced would be a measurement of the wrong thing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedHealing {
    /// The strategies this run will apply.
    pub config: HealingConfig,
    /// Every `healing` key that named nothing gg knows, or named something it knows with a value
    /// that is not a toggle — dotted from the param root (`healing.stripProse`), or the bare
    /// `healing` when the param itself was not readable. Reported at `warn` when the run starts.
    pub unknown_params: Vec<String>,
}

/// Resolve the [healing configuration](HealingConfig) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `healing` param.
///
/// The param names a **delta against the defaults**, not a whole configuration. Saying nothing means
/// [the defaults](HealingConfig::default) — which is *not* "everything on", because
/// [`drop-doubled-response`](HealingStrategy::DropDoubledResponse) is
/// [armed deliberately](HealingStrategy::default_armed) rather than by omission. Every row below
/// that reads "the defaults" therefore means "the other five on, `drop-doubled-response` off".
///
/// | `params.healing` | Meaning |
/// | --- | --- |
/// | absent / `null` / `true` / `{}` | the **defaults** |
/// | `false` | every strategy **off** — the master switch |
/// | `{ "strip-prose": false }` | `strip-prose` off, the rest at their defaults |
/// | `{ "drop-doubled-response": true }` | `drop-doubled-response` **on**, the rest at their defaults — the one strategy an operator has to ask for |
/// | `{ "strip-prose": 0 }` | `strip-prose` at its default (a non-boolean is not a toggle), and the key is reported |
/// | `{ "stripProse": false }` | the defaults, and `healing.stripProse` is reported |
/// | `5`, `"off"`, `[]` | the defaults, and `healing` is reported |
///
/// Note the asymmetry the third and fourth rows describe: `false` is how a default-on strategy is
/// turned off and `true` is how the default-off one is turned on, and **both** travel through the
/// same `(Some(strategy), Some(on))` arm below. There is no second mechanism for arming a strategy,
/// which is what keeps the table above a description of one line of code.
///
/// Modelled on [`resolve_sandbox_limits`](crate::sandbox::resolve_sandbox_limits), including its
/// reason for reading the param names literally: they are **contract-visible** — they are what the
/// console's capability catalogue writes and what persisted run data records — so they do not change
/// with the pipeline underneath them.
///
/// A capability that is present but **disabled** configures nothing: healing never runs for such a
/// run, so honouring its params would be recording an intention that had no effect.
pub fn resolve_healing(set: &GgAgentConfig) -> ResolvedHealing {
    let mut resolved = ResolvedHealing {
        config: HealingConfig::default(),
        unknown_params: Vec::new(),
    };
    let Some(capability) = set
        .capability(CAPABILITY_RESPONSES_AS_CODE)
        .filter(|capability| capability.enabled)
    else {
        return resolved;
    };
    let Some(healing) = capability.params.get("healing") else {
        return resolved;
    };

    match healing {
        // Three spellings of "say nothing", all meaning the default arm: a key that was written out
        // as null, an explicit `true`, and an object that changes nothing.
        Value::Null | Value::Bool(true) => {}
        Value::Bool(false) => resolved.config = HealingConfig::OFF,
        Value::Object(toggles) => {
            for (key, value) in toggles {
                match (HealingStrategy::from_id(key), value.as_bool()) {
                    // The one arm that moves a strategy off its default, in either direction:
                    // `false` disarms a default-on strategy and `true` arms `drop-doubled-response`.
                    (Some(strategy), Some(on)) => resolved.config.set(strategy, on),
                    // A known id with a value that is not a toggle keeps its default: guessing that
                    // `0` meant `false` is exactly the silent reinterpretation the report exists to
                    // prevent.
                    (Some(_), None) | (None, _) => {
                        resolved.unknown_params.push(format!("healing.{key}"));
                    }
                }
            }
        }
        _ => resolved.unknown_params.push("healing".to_string()),
    }
    resolved
}

/// How the assistant message gg *records* for a code turn is derived from the model's reply — the
/// half of responses-as-code that decides what the **next** turn's prompt shows the model of *this*
/// turn.
///
/// Under responses-as-code the reply is a program, and [healing](heal) rewrites it before it runs.
/// That leaves a choice with no analogue on the tool-calling path: is the assistant turn the model
/// re-reads next turn the reply it *sent*, or the program gg actually *ran*? Both are defensible and
/// the difference is measurable, so it is a lever rather than a hard-coded policy — the same reason
/// [healing itself](HealingConfig) is.
///
/// Whichever mode is chosen, healing still runs and is still disclosed in the turn's feedback: the
/// mode governs only the stored assistant message, never whether a reply is repaired before it runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AssistantMessageMode {
    /// **No post-processing.** The assistant message is the reply exactly as the model returned it,
    /// byte for byte. Healing still repairs the reply before running it, but that repair does not
    /// leak into the recorded message — so the transcript shows what the model actually wrote, which
    /// is what a study of a model's code-only compliance wants to read. The default.
    #[default]
    None,
    /// **Post-response healing.** The assistant message is the [healed](Healed::program) program —
    /// what gg actually compiled and ran — whenever healing rewrote the reply, and the reply
    /// verbatim when it did not ([`Healed::rewritten`] is false). The model then re-reads a clean,
    /// running program next turn rather than the malformed one it sent, which is what a run optimised
    /// for task completion rather than compliance measurement wants.
    ResponseHealing,
}

/// Resolve the [assistant-message mode](AssistantMessageMode) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `assistantMessages` param.
///
/// | `params.assistantMessages` | Mode |
/// | --- | --- |
/// | absent / `null` / `"none"` | [`None`](AssistantMessageMode::None) — no post-processing (the default) |
/// | `"response-healing"` | [`ResponseHealing`](AssistantMessageMode::ResponseHealing) |
/// | anything else | [`None`](AssistantMessageMode::None), and the value is reported |
///
/// Read literally and reported on mismatch for the same reason [`resolve_healing`] is: the value is
/// contract-visible (the console's capability catalogue writes it, persisted run data records it), so
/// a typo must change nothing silently rather than pick a mode the study did not ask for. A capability
/// that is present but **disabled** configures nothing.
pub fn resolve_assistant_messages(set: &GgAgentConfig) -> ResolvedAssistantMessages {
    let mut resolved = ResolvedAssistantMessages {
        mode: AssistantMessageMode::default(),
        unknown_params: Vec::new(),
    };
    let Some(capability) = set
        .capability(CAPABILITY_RESPONSES_AS_CODE)
        .filter(|capability| capability.enabled)
    else {
        return resolved;
    };
    let Some(value) = capability.params.get("assistantMessages") else {
        return resolved;
    };

    match value {
        Value::Null => {}
        Value::String(mode) if mode == "none" => {}
        Value::String(mode) if mode == "response-healing" => {
            resolved.mode = AssistantMessageMode::ResponseHealing;
        }
        _ => resolved
            .unknown_params
            .push("assistantMessages".to_string()),
    }
    resolved
}

/// A resolved [assistant-message mode](AssistantMessageMode) together with the `assistantMessages`
/// value gg could not read, if any — the same shape [`ResolvedHealing`] takes, and reported the same
/// way at launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAssistantMessages {
    /// The mode this run records assistant turns under.
    pub mode: AssistantMessageMode,
    /// The `assistantMessages` value that named no mode gg knows, or the bare `assistantMessages`
    /// when it was not a recognised string. Reported at `warn` when the run starts.
    pub unknown_params: Vec<String>,
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
    /// An exact repeated trailing copy of the program was deleted.
    DuplicateProgram,
    /// Whole `import`/`require` statements were removed.
    Imports {
        /// How many lines went.
        lines: usize,
    },
    /// An `async` wrapper was removed and the `await`s it implied deleted.
    Async {
        /// Which wrapper shape it was.
        wrapper: AsyncWrapper,
        /// How many `await` tokens were deleted with it.
        awaits: usize,
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

/// Which asynchronous wrapper shape was unwrapped.
///
/// Two shapes, named for the *structure* rather than for one language's word for it, because this
/// enum sits on the [dialect](Dialect) seam: every language's `unwrap_async` labels its own wrapper
/// with one of these, and a language whose grammar has no "IIFE" must still be able to say which of
/// the two it found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsyncWrapper {
    /// A **declared** asynchronous function whose body is the program — declared under a name, with
    /// or without a trailing call to it. TypeScript's `async function main() { … }`.
    Declared,
    /// An asynchronous callable **invoked where it is written**, so the wrapper is one expression
    /// and there is no name. TypeScript's `(async () => { … })();` and
    /// `(async function () { … })();`.
    Immediate,
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
/// trim  ->  [ strip-fences -> strip-prose -> drop-doubled-response
///             -> drop-duplicate-program -> drop-imports -> unwrap-async ]*
///               ^                                          |
///               +--- repeat until a pass applies nothing ---+
/// ```
///
/// Fences first, because until the wrapper is off, "is this line prose?" and "is this line an
/// import?" are questions about the wrong text. Prose before duplicates, so the two copies of a
/// program are adjacent when they are compared. `drop-doubled-response` before
/// `drop-duplicate-program`, because it is the coarser, whole-reply test of the same defect: running
/// it first means the finer one — which searches for a repeated *tail* and has a lexical-declaration
/// guard to satisfy — only ever sees a reply that is not a clean doubling. Both before imports and
/// async, so a doubled reply is halved before either of those looks at it. Imports before async,
/// because a leading `import` line is exactly what makes `unwrap-async` decline — one strategy's
/// output enabling another's match is the reason this is a fixpoint rather than a list.
/// [`HealingStrategy::ALL`] **is** this order.
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
    let original = trim_reply(reply);

    let mut text = original.to_string();
    let mut applied = Vec::new();

    match to_fixpoint(&mut text, config, &mut applied, MAX_PASSES, dialect) {
        Fixpoint::Converged => Healed {
            program: text,
            applied,
            did_not_converge: false,
        },
        Fixpoint::Exhausted => Healed {
            program: original.to_string(),
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
/// still indented, and now not a close — would be left in the program. Indentation is meaningless to
/// a program and meaningful to Markdown, so it is kept and the scanner decides.
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
enum StrategyOutcome {
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
        HealingStrategy::DropDuplicateProgram => drop_duplicate_program(text, dialect),
        HealingStrategy::DropImports => drop_imports(text, dialect),
        HealingStrategy::UnwrapAsync => unwrap_async(text, dialect),
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
    /// The block's contents, trimmed. Never empty — an empty block is not a block.
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
/// trimmed; everything outside the fences is deleted.
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

        let body = text[body_start..body_end].trim();
        // An empty block is not a block: it offers nothing to run, and counting it would let a
        // model's illustrative ```` ``` ```` pair turn a single-program reply into several
        // candidates.
        if !body.is_empty() {
            blocks.push(FencedBlock {
                tag,
                body: body.to_string(),
                close,
            });
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
        text: text[start..end].trim().to_string(),
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
/// fence, not so much as a space. It is a **transport** fault rather than a model one, and
/// [`drop-duplicate-program`](drop_duplicate_program) cannot catch it, because that strategy insists
/// the repeated tail declare a
/// [binding the language refuses twice](Dialect::declares_a_redeclarable_binding) at its top level
/// before it will delete anything — a doubled body of bare statements offers no such proof.
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
/// [fixpoint loop](to_fixpoint), one halving per pass, which is the same shape
/// [`drop-duplicate-program`](without_repeated_tail) converges in.
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
// drop-duplicate-program
// ---------------------------------------------------------------------------------------------

/// Repair — or refuse — the reply that is two programs, with no fence anywhere to tell gg so.
///
/// This is the fence-free counterpart of [`strip_fences`]'s D2. With fences gone from the contract,
/// a model that drafts two programs has nothing left to separate them with: it pastes the second
/// after the first, and the result is one source that declares `const files` twice. Round 2 measured
/// exactly that from both of the strongest models — two of them byte-for-byte identical programs —
/// and it reached the guest as `SyntaxError: redeclaration of const files`, with the whole reply
/// wasted.
///
/// # Repair — an exact repeated tail
///
/// **Matches** a reply that ends with a byte-identical repetition of the text immediately before it
/// (`A A` → `A`; `A A A` converges to `A` over two passes of the [fixpoint](to_fixpoint)), when the
/// repeated text [declares a binding the language refuses
/// twice](Dialect::declares_a_redeclarable_binding) at its top level.
///
/// That guard is what makes the deletion **provably semantics-preserving**, which is otherwise not
/// obvious: deleting the second of two identical copies of `writeFile("a.md", "x");` really would
/// change what a run does. It cannot here, because a repeated declaration of that kind is refused
/// before a statement runs — the reply as sent could not execute anything at all — so the deletion
/// removes text that had no behaviour and turns a reply that could never run into the program the
/// model wrote once.
///
/// **Declines** on everything else — including two programs that are *not* identical, where there
/// is nothing safe to delete: the reply goes on to be prepared, which refuses it with the
/// redeclaration error it really is, naming the identifier, its line and its column. That is the
/// compiler's diagnostic over the model's own text, which is a better answer than any count gg
/// could infer. It also declines on a repeated tail with no lexical declaration in it (which really
/// would run twice) and on a name declared twice in different scopes (ordinary shadowing, and
/// legal).
fn drop_duplicate_program(text: &str, dialect: &dyn Dialect) -> StrategyOutcome {
    let Some(mask) = dialect.code_mask(text) else {
        return StrategyOutcome::Declined;
    };

    if let Some(kept) = without_repeated_tail(text, &mask, dialect) {
        return StrategyOutcome::Rewrote {
            text: kept.to_string(),
            detail: HealingDetail::DuplicateProgram,
        };
    }

    StrategyOutcome::Declined
}

/// `text` without its exact repeated tail, when it has one that may be deleted.
///
/// The repetition is sought at **line starts only** (a program is written in lines, and a boundary
/// inside one would mean the two copies are not the copies they appear to be), and the candidates
/// are narrowed to offsets whose line equals the reply's first line — the second copy of a program
/// begins the way the first did — so the scan is one pass over the lines with a byte comparison at
/// the few that could possibly match.
///
/// The **last** viable offset wins, which is what makes `A A A` shrink one copy per pass instead of
/// declining: the tail is compared with the text immediately preceding it, not with the whole head.
fn without_repeated_tail<'a>(
    text: &'a str,
    mask: &CodeMask,
    dialect: &dyn Dialect,
) -> Option<&'a str> {
    let first_line = text.lines().next()?.trim_end();
    let mut best = None;
    for (offset, line) in lines_with_offsets(text) {
        if offset == 0 || line.trim_end() != first_line || !mask.is_code(offset) {
            continue;
        }
        let head = text[..offset].trim_end();
        let tail = text[offset..].trim_end();
        if !tail.is_empty() && head.ends_with(tail) {
            best = Some((offset, tail));
        }
    }
    let (offset, tail) = best?;
    // The guard that keeps this a deletion of text that could never have run. See the strategy's
    // documentation: without it, `A A` over a program that declares nothing the language refuses
    // twice is a program the model asked to run twice.
    dialect
        .declares_a_redeclarable_binding(tail, mask, offset)
        .then_some(())?;
    Some(text[..offset].trim_end())
}
// ---------------------------------------------------------------------------------------------
// drop-imports
// ---------------------------------------------------------------------------------------------

/// Remove module-import statements for a surface that is already in scope.
///
/// In **code** lexical context only, deletes whole lines the language calls
/// [a complete single-line import](Dialect::is_import_statement). Which spellings those are is the
/// dialect's business; the per-line loop, the mask gate on the first non-space byte, and the
/// preservation of every surviving line's own terminator are this function's.
///
/// **Declines** on anything the dialect does not call a complete statement — a multi-line import
/// among them, since deciding where such a statement ends is a parse, and the language's own prepare
/// step already names the import and says what to write instead; on an import the
/// [mask](Dialect::code_mask) places inside a string, template literal or comment — a program
/// *writing* a source file is ordinary gg work; and on anything at all when the mask does not lex
/// cleanly.
fn drop_imports(text: &str, dialect: &dyn Dialect) -> StrategyOutcome {
    let Some(mask) = dialect.code_mask(text) else {
        return StrategyOutcome::Declined;
    };

    let mut kept = String::with_capacity(text.len());
    let mut removed = 0;
    let mut offset = 0;
    for raw in text.split_inclusive('\n') {
        let line = raw.strip_suffix('\n').unwrap_or(raw);
        let keyword_at = offset + (line.len() - line.trim_start().len());
        offset += raw.len();
        if mask.is_code(keyword_at) && dialect.is_import_statement(line) {
            removed += 1;
            continue;
        }
        // Concatenating the raw slices rather than re-joining keeps every surviving line's own
        // terminator, so a `\r\n` program stays a `\r\n` program.
        kept.push_str(raw);
    }

    if removed == 0 {
        return StrategyOutcome::Declined;
    }
    StrategyOutcome::Rewrote {
        text: kept.trim().to_string(),
        detail: HealingDetail::Imports { lines: removed },
    }
}

// ---------------------------------------------------------------------------------------------
// unwrap-async
// ---------------------------------------------------------------------------------------------

/// Unwrap a concurrency wrapper around the whole program and delete the suspension tokens it
/// implied.
///
/// The **shape** of the repair is this function's and the **recognition** is the
/// [dialect](Dialect::unwrap_async)'s: which wrappers exist, how a body is delimited, how it is
/// dedented and which token means "suspend here" are facts about one language, while "a wrapper came
/// off, and here is what the model is told about it" is the same in every language.
///
/// **Declines** on an unclean [mask](Dialect::code_mask), and on any `None` from the dialect — which
/// is where every language-shaped decline lives: a wrapper the program never **calls** (its body
/// then never ran, so unwrapping would execute statements the response never asked to execute),
/// anything at the top level besides the wrapper and its invocation, an invocation carrying a
/// callback whose code dropping the call would delete, and a wrapper that was never asynchronous at
/// all — one that already runs, so unwrapping it would change what the program evaluates to for no
/// reason.
///
/// # The honest caveat
///
/// This is the one strategy that rewrites *structure*, and it does change what the program evaluates
/// to. That is defensible only because a **called** concurrency wrapper cannot run in this sandbox
/// at all — there is no event loop, so a suspension throws and a returned promise is rejected — and
/// there is therefore no working behaviour to preserve; the repair turns a program that could not
/// run into the straight-line program the model meant. Both halves of that warrant are
/// load-bearing, which is why a dialect must decline unless the wrapper is the entire program *and*
/// the program invokes it.
///
/// The deletion invariant still binds across the seam: whatever a dialect hands back must be the
/// body with text removed and leading whitespace stripped, never text of its own.
fn unwrap_async(text: &str, dialect: &dyn Dialect) -> StrategyOutcome {
    let Some(mask) = dialect.code_mask(text) else {
        return StrategyOutcome::Declined;
    };
    let Some(unwrapped) = dialect.unwrap_async(text, &mask) else {
        return StrategyOutcome::Declined;
    };

    StrategyOutcome::Rewrote {
        text: unwrapped.text,
        detail: HealingDetail::Async {
            wrapper: unwrapped.wrapper,
            awaits: unwrapped.awaits,
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

/// `n` and its noun, pluralised the English way.
///
/// `pub(crate)` because the [code turn](crate::agent) renders one count-bearing clause of its own —
/// the statements a top-level `return` left unreachable — and two spellings of "1 statement" in one
/// turn's feedback is exactly the drift a shared helper removes.
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
