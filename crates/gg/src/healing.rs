//! **Response healing** — the pass that sits between a model's raw reply and the
//! [type-strip](crate::sandbox), repairing the contract violations models actually commit and
//! saying so.
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
//! "is a program" — that question belongs to the type-strip, which answers it with a located
//! compiler diagnostic rather than with gg's opinion of the model's prose. So the tree reads as the
//! pipeline does — `healing.rs` (text) → `sandbox/transpile.rs` (syntax) → `sandbox/engine.rs`
//! (execution), with every reply travelling the whole way.
//!
//! Nothing here does I/O, reads a clock, allocates a `Store`, or is `async`; its only imports are
//! `serde_json::Value` and the two capability types the resolver reads. Two things follow. Every
//! case in this module's tests is a microsecond-scale unit test with no component compile behind it,
//! and the ablation is honest: turning a strategy off changes only what [`heal`] returns. (Replay is
//! unaffected either way — the [replay driver](crate::replay_driver) reconstructs a code turn from
//! the captured record and never re-runs healing.)

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig};

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
    pub const ALL: [HealingStrategy; 5] = [
        Self::StripFences,
        Self::StripProse,
        Self::DropDuplicateProgram,
        Self::DropImports,
        Self::UnwrapAsync,
    ];

    /// The strategy's stable id — the one spelling, in kebab-case.
    pub const fn id(self) -> &'static str {
        match self {
            Self::StripFences => "strip-fences",
            Self::StripProse => "strip-prose",
            Self::DropDuplicateProgram => "drop-duplicate-program",
            Self::DropImports => "drop-imports",
            Self::UnwrapAsync => "unwrap-async",
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
/// Five private bools rather than a set, because the set of strategies is closed and a bool per
/// strategy is what makes [`enabled`](Self::enabled) total: there is no "unknown strategy" state to
/// resolve at the point of use, only at the point of [configuration](resolve_healing).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealingConfig {
    strip_fences: bool,
    strip_prose: bool,
    drop_duplicate_program: bool,
    drop_imports: bool,
    unwrap_async: bool,
}

impl Default for HealingConfig {
    /// Every strategy **on**. A strategy absent from a run's `healing` param is armed, so a
    /// configuration that says nothing gets all of them — the arm a study compares against.
    fn default() -> Self {
        Self {
            strip_fences: true,
            strip_prose: true,
            drop_duplicate_program: true,
            drop_imports: true,
            unwrap_async: true,
        }
    }
}

impl HealingConfig {
    /// Every strategy off — the master switch's arm, and the ablation's floor.
    ///
    /// [`heal`] still runs under it and still canonicalises; it simply repairs nothing, so the reply
    /// reaches the type-strip exactly as the model sent it.
    pub const OFF: Self = Self {
        strip_fences: false,
        strip_prose: false,
        drop_duplicate_program: false,
        drop_imports: false,
        unwrap_async: false,
    };

    /// Whether `strategy` is armed.
    pub fn enabled(&self, strategy: HealingStrategy) -> bool {
        match strategy {
            HealingStrategy::StripFences => self.strip_fences,
            HealingStrategy::StripProse => self.strip_prose,
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
/// | `params.healing` | Meaning |
/// | --- | --- |
/// | absent / `null` / `true` / `{}` | every strategy **on** |
/// | `false` | every strategy **off** — the master switch |
/// | `{ "strip-prose": false }` | `strip-prose` off, the other four on |
/// | `{ "strip-prose": 0 }` | `strip-prose` **on** (a non-boolean is not a toggle), and the key is reported |
/// | `{ "stripProse": false }` | every strategy on, and `healing.stripProse` is reported |
/// | `5`, `"off"`, `[]` | every strategy on, and `healing` is reported |
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
        // as null, an explicit `true`, and an object that turns nothing off.
        Value::Null | Value::Bool(true) => {}
        Value::Bool(false) => resolved.config = HealingConfig::OFF,
        Value::Object(toggles) => {
            for (key, value) in toggles {
                match (HealingStrategy::from_id(key), value.as_bool()) {
                    (Some(strategy), Some(on)) => resolved.config.set(strategy, on),
                    // A known id with a value that is not a toggle stays armed: guessing that `0`
                    // meant `false` is exactly the silent reinterpretation the report exists to
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

/// Which `async` wrapper shape was unwrapped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AsyncWrapper {
    /// `async function main() { … }`, with or without a trailing call.
    Function,
    /// `(async () => { … })();` or `(async function () { … })();`.
    Iife,
}

/// Heal one model response into the program gg will run.
///
/// Total and pure: it never panics, performs no I/O, reads no clock, and returns a [`Healed`] for
/// every input including the empty string.
///
/// It asks **no** question about whether the reply is a program. Every reply that comes in goes
/// back out as text for the [type-strip](crate::sandbox) to compile: an empty reply becomes an
/// empty program that runs and does nothing, a reply of comments becomes a program that runs and
/// does nothing, and a reply that is two programs pasted together fails to compile with the
/// redeclaration error the compiler itself reports. That feedback comes from a compiler rather than
/// from gg's reading of the model's text, which is the whole point: healing repairs shapes it can
/// prove are repairable, and judges nothing.
///
/// # The pipeline
///
/// ```text
/// trim  ->  [ strip-fences -> strip-prose -> drop-duplicate-program
///             -> drop-imports -> unwrap-async ]*
///               ^                            |
///               +--- repeat until a pass applies nothing +
/// ```
///
/// Fences first, because until the wrapper is off, "is this line prose?" and "is this line an
/// import?" are questions about the wrong text. Prose before duplicates, so the two copies of a
/// program are adjacent when they are compared. Duplicates before imports and async, so a doubled
/// reply is halved before either of those looks at it. Imports before async, because a leading
/// `import` line is exactly what makes `unwrap-async` decline — one strategy's output enabling
/// another's match is the reason this is a fixpoint rather than a list. [`HealingStrategy::ALL`]
/// **is** this order.
///
/// If the fixpoint is not reached within [`MAX_PASSES`], **every repair is discarded**, the response
/// is returned as it was sent, and [`did_not_converge`](Healed::did_not_converge) says so. That
/// keeps idempotence unconditional and keeps the honesty invariant intact: gg either produces a
/// fixpoint it can explain, or it changes nothing and reports that it could not.
pub fn heal(reply: &str, config: &HealingConfig) -> Healed {
    // Canonicalisation, not repair: a byte-order mark, blank lines around the reply and trailing
    // whitespace do not change what a program is, so there is no contract violation here to
    // disclose and nothing to count. It is therefore deliberately NOT an application, which is what
    // `Healed::rewritten` turns on.
    let original = trim_reply(reply);

    let mut text = original.to_string();
    let mut applied = Vec::new();

    match to_fixpoint(&mut text, config, &mut applied, MAX_PASSES) {
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
/// JavaScript and meaningful to Markdown, so it is kept and the scanner decides.
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
fn contains_code(source: &str) -> bool {
    source.lines().any(looks_like_code)
}

// ---------------------------------------------------------------------------------------------
// The pipeline's internals
// ---------------------------------------------------------------------------------------------

/// What one strategy did with the text it was handed.
///
/// Two outcomes and nothing else: a strategy either deletes something it can prove is safe to
/// delete, or it leaves the text exactly as it was. There is no third answer, because "this is not
/// a program" is not healing's question to answer — the type-strip answers it, with a diagnostic.
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
) -> Fixpoint {
    for _ in 0..budget {
        let mut changed = false;
        for strategy in HealingStrategy::ALL {
            if !config.enabled(strategy) {
                continue;
            }
            match apply(strategy, text) {
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
fn apply(strategy: HealingStrategy, text: &str) -> StrategyOutcome {
    match strategy {
        HealingStrategy::StripFences => strip_fences(text),
        HealingStrategy::StripProse => strip_prose(text),
        HealingStrategy::DropDuplicateProgram => drop_duplicate_program(text),
        HealingStrategy::DropImports => drop_imports(text),
        HealingStrategy::UnwrapAsync => unwrap_async(text),
    }
}

// ---------------------------------------------------------------------------------------------
// strip-fences
// ---------------------------------------------------------------------------------------------

/// The info-string tags gg reads as "this block is the program", lower-cased.
///
/// A closed, recognised list rather than a deny list: a block tagged `json`, `text`, `bash` or `md`
/// is context the model showed, not the program, and round 1 measured models emitting exactly those
/// alongside a `ts` block. Tier 3 of the candidacy ladder is what stops the closed list from being a
/// trap — a reply that is one block tagged something gg has never heard of, whose body is plainly
/// code, is still run.
const PROGRAM_TAGS: &[&str] = &[
    "ts",
    "typescript",
    "tsx",
    "mts",
    "cts",
    "typescriptreact",
    "js",
    "javascript",
    "jsx",
    "mjs",
    "cjs",
    "javascriptreact",
    "node",
    "es",
    "es6",
];

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
/// 1. blocks whose tag is in [`PROGRAM_TAGS`];
/// 2. otherwise, blocks with **no** tag;
/// 3. otherwise, blocks whose (unrecognised) tag is anything else **and** whose body satisfies
///    [`contains_code`].
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
/// The narrowness lives in the predicate instead, where it costs nothing: [`looks_like_code`] is
/// true only of shapes English does not have, so a lead-in sentence with a semicolon in it does not
/// block the unwrap, and across every round-1 reply this strategy accepted as a single candidate
/// **no** line outside the fences is code-shaped.
fn strip_fences(text: &str) -> StrategyOutcome {
    let scan = scan_fences(text);
    // D1.
    if scan.blocks.is_empty() {
        return StrategyOutcome::Declined;
    }

    let candidates = candidate_blocks(&scan.blocks);
    // D2.
    if candidates.len() >= 2 {
        return StrategyOutcome::Declined;
    }

    // D3: is there code the unwrap would throw away? Above the fences it is a program that contains
    // one; below them it is a program the model continued past one. Both are code, and both are
    // deleted by an unwrap that reports only which wrapper it removed.
    if scan.outside.iter().copied().any(looks_like_code) {
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
        .filter(|(index, block)| *index != chosen && contains_code(&block.body))
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
fn candidate_blocks(blocks: &[FencedBlock]) -> Vec<usize> {
    let tier = |predicate: &dyn Fn(&FencedBlock) -> bool| -> Vec<usize> {
        blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| predicate(block))
            .map(|(index, _)| index)
            .collect()
    };

    let recognised = tier(&|block| PROGRAM_TAGS.contains(&block.tag.as_str()));
    if !recognised.is_empty() {
        return recognised;
    }
    let untagged = tier(&|block| block.tag.is_empty());
    if !untagged.is_empty() {
        return untagged;
    }
    tier(&|block| !block.tag.is_empty() && contains_code(&block.body))
}

/// Every non-empty fenced block in `text`, and every line outside one.
///
/// # Why the full fence rule, and not "find the next ```` ``` ````"
///
/// A program routinely *contains* a fenced block — writing a README, a docs page or a spec snippet
/// is ordinary gg work — and a model that does so opens its program with a **longer** fence, which
/// is exactly what CommonMark asks of it. Scanning for the first bare ```` ``` ```` would cut such a
/// program at the fence inside its own template literal and hand the type-strip an unterminated
/// literal: a parse diagnostic about code the model never wrote, with no way for it to see the
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
fn scan_fences(text: &str) -> FenceScan<'_> {
    let lines: Vec<(usize, &str)> = lines_with_offsets(text).collect();
    let mut blocks = Vec::new();
    let mut outside = Vec::new();

    let mut index = 0;
    while index < lines.len() {
        let (_, line) = lines[index];
        let opened = match opening_fence(line) {
            Some((length, info)) => Some((length, fence_tag(info))),
            None => glued_open(line).map(|(before, length, tag)| {
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
fn glued_open(line: &str) -> Option<(&str, usize, String)> {
    let mut offset = 0;
    while let Some(found) = line[offset..].find('`') {
        let start = offset + found;
        let length = backticks(&line[start..]);
        if length < MIN_FENCE_LENGTH {
            offset = start + length;
            continue;
        }
        let before = &line[..start];
        if before.trim().is_empty() || looks_like_code(before) {
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
/// [`is_prose_line`] and at least one does, and symmetrically at the end. Nothing in the middle is
/// ever touched.
///
/// **Declines** at the first line that is not certainly prose — no scanning past it, no paragraph
/// heuristics — and **while the text still contains an opening fence**, because its precondition is
/// "this is a program with prose around it", which is false while a wrapper survives. That last
/// decline is what stops it chewing Markdown [`strip_fences`] deliberately declined to unwrap and
/// then reporting a repair that repaired nothing. It also declines when removal would leave nothing
/// at all: a reply that is prose from end to end has no program under the explanation, so there is
/// nothing to strip *to* — it goes to the type-strip as the model wrote it, and the diagnostic the
/// model gets is the compiler's.
///
/// It is deliberately severe. Round 1 produced *no* bare-program-with-prose responses — every model
/// fenced — so a strategy with no evidence behind it gets the setting where a false positive costs
/// one turn with a located diagnostic and a false negative deletes the model's code.
fn strip_prose(text: &str) -> StrategyOutcome {
    if !scan_fences(text).blocks.is_empty() {
        return StrategyOutcome::Declined;
    }

    let lines: Vec<(usize, &str)> = lines_with_offsets(text).collect();

    let mut leading_end = 0;
    let mut leading = 0;
    while let Some((_, line)) = lines.get(leading_end) {
        if line.trim().is_empty() {
            leading_end += 1;
        } else if is_prose_line(line) {
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
        } else if is_prose_line(line) {
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
// drop-duplicate-program
// ---------------------------------------------------------------------------------------------

/// The lexical declarations a program cannot make twice at its top level.
///
/// `const`, `let` and `class` bindings are the ones ECMAScript makes an **early error** to
/// redeclare, so a reply containing two of the same is refused at construction before a statement of
/// it runs. `var` and `function` are deliberately absent: both may legally be redeclared in the
/// sloppy function body a program is evaluated as, so a repetition of either says nothing about
/// whether the reply is one program or two.
const LEXICAL_KEYWORDS: [&str; 3] = ["const", "let", "class"];

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
/// repeated text declares something in [`LEXICAL_KEYWORDS`] at its top level.
///
/// That guard is what makes the deletion **provably semantics-preserving**, which is otherwise not
/// obvious: deleting the second of two identical copies of `writeFile("a.md", "x");` really would
/// change what a run does. It cannot here, because a repeated `const` is an early error — the reply
/// as sent could not execute a single statement — so the deletion removes text that had no
/// behaviour at all and turns a reply that could never run into the program the model wrote once.
///
/// **Declines** on everything else — including two programs that are *not* identical, where there
/// is nothing safe to delete: the reply goes to the type-strip, which refuses it with the
/// redeclaration error it really is, naming the identifier, its line and its column. That is the
/// compiler's diagnostic over the model's own text, which is a better answer than any count gg
/// could infer. It also declines on a repeated tail with no lexical declaration in it (which really
/// would run twice) and on a name declared twice in different scopes (ordinary shadowing, and
/// legal).
fn drop_duplicate_program(text: &str) -> StrategyOutcome {
    let Some(mask) = code_mask(text) else {
        return StrategyOutcome::Declined;
    };

    if let Some(kept) = without_repeated_tail(text, &mask) {
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
fn without_repeated_tail<'a>(text: &'a str, mask: &CodeMask) -> Option<&'a str> {
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
    // documentation: without it, `A A` over a program with no lexical declaration is a program the
    // model asked to run twice.
    declares_lexically(tail, mask, offset).next()?;
    Some(text[..offset].trim_end())
}

/// Every name `text` binds with a [lexical keyword](LEXICAL_KEYWORDS) at its **top level**, in
/// source order.
///
/// "Top level" is read as *unindented*, which is what a top-level statement is in every program a
/// model writes and what keeps this from mistaking a `const` inside a function body — legal, and
/// legal twice — for a redeclaration. `base` is where `text` starts inside the source `mask` was
/// built over, so a caller may ask about a slice of it.
///
/// Only plain identifiers are collected: `const { a, b } = …` binds two names, and reconstructing
/// which would be a parse. A destructuring declaration repeated verbatim is caught by the repeated
/// tail's own guard finding the other, plainer declarations beside it — and where there are none,
/// declining is the correct outcome for a strategy that may only delete what it is certain of.
fn declares_lexically<'a>(
    text: &'a str,
    mask: &'a CodeMask,
    base: usize,
) -> impl Iterator<Item = &'a str> {
    lines_with_offsets(text).filter_map(move |(offset, line)| {
        if !mask.is_code(base + offset) || line.starts_with([' ', '\t']) {
            return None;
        }
        let rest = LEXICAL_KEYWORDS
            .iter()
            .find_map(|keyword| line.strip_prefix(keyword))?;
        let rest = rest.strip_prefix(' ')?.trim_start();
        let name = rest
            .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
            .next()
            .filter(|name| !name.is_empty())?;
        name.starts_with(|c: char| c.is_alphabetic() || c == '_' || c == '$')
            .then_some(name)
    })
}

// ---------------------------------------------------------------------------------------------
// drop-imports
// ---------------------------------------------------------------------------------------------

/// Remove `import`/`require` statements for a surface that is already in scope.
///
/// In **code** lexical context only, deletes whole lines that are a complete single-line `import`, a
/// complete single-line `const`/`let`/`var … = require(…)`, or a bare `require("…");` statement.
///
/// **Declines** on a multi-line import (deciding where it ends is a parse, and the type-strip
/// already names `import` and says what to write instead); on an `import` the
/// [mask](code_mask) places inside a string, template literal or comment — a program *writing* a
/// TypeScript file is ordinary gg work; and on anything at all when the mask does not lex cleanly.
fn drop_imports(text: &str) -> StrategyOutcome {
    let Some(mask) = code_mask(text) else {
        return StrategyOutcome::Declined;
    };

    let mut kept = String::with_capacity(text.len());
    let mut removed = 0;
    let mut offset = 0;
    for raw in text.split_inclusive('\n') {
        let line = raw.strip_suffix('\n').unwrap_or(raw);
        let keyword_at = offset + (line.len() - line.trim_start().len());
        offset += raw.len();
        if mask.is_code(keyword_at) && is_import_statement(line) {
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

/// Whether the trimmed `line` is a complete single-line module import.
///
/// Every arm insists the statement *finishes* on this line — an `import` that closes its module
/// specifier, a `require(…)` call that closes its parentheses — because a statement whose end is
/// somewhere below is one only a parser can delete correctly, and this is not a parser.
fn is_import_statement(line: &str) -> bool {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("import") {
        let introduced = rest.starts_with(|c: char| c.is_whitespace())
            || rest.starts_with(['{', '*', '"', '\'']);
        return introduced && closes_a_string(rest);
    }
    if !line.ends_with(')') && !line.ends_with(';') {
        return false;
    }
    // `const fs = require("fs");` and its `let`/`var` spellings. The call has to be the **whole**
    // right-hand side: `const x = wrap(require("y"));` is a program doing something with a module
    // system it brought itself, and deleting that line would delete a binding the rest of the
    // program uses.
    for keyword in ["const", "let", "var"] {
        if let Some(rest) = line.strip_prefix(keyword)
            && rest.starts_with(|c: char| c.is_whitespace())
            && let Some((_, value)) = rest.split_once('=')
            && opens_with_require(value.trim_start())
        {
            return closes_a_string(value);
        }
    }
    // A bare `require("./setup");` statement, whose value nothing binds.
    opens_with_require(line) && closes_a_string(line)
}

/// Whether `text` **opens** with a `require(…)` call.
///
/// The identifier boundary falls out of the prefix test: `requireHelper(` leaves `Helper(`, which
/// does not open with the parenthesis.
fn opens_with_require(text: &str) -> bool {
    text.strip_prefix("require")
        .is_some_and(|rest| rest.trim_start().starts_with('('))
}

/// Whether `text` opens **and closes** a quoted string, honouring backslash escapes — the test for
/// "the module specifier ends on this line".
fn closes_a_string(text: &str) -> bool {
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\'' && c != '"' {
            continue;
        }
        let mut escaped = false;
        for inner in chars.by_ref() {
            if escaped {
                escaped = false;
            } else if inner == '\\' {
                escaped = true;
            } else if inner == c {
                return true;
            }
        }
        return false;
    }
    false
}

// ---------------------------------------------------------------------------------------------
// unwrap-async
// ---------------------------------------------------------------------------------------------

/// Unwrap an `async` wrapper around the whole program and delete the `await`s it implied.
///
/// Matches a program whose **entire** top level is one wrapper *that the program calls*:
///
/// * [`Function`](AsyncWrapper::Function) — `async function <ident>(…) { … }` followed by exactly
///   `<ident>();`, `await <ident>();` or `void <ident>();`;
/// * [`Iife`](AsyncWrapper::Iife) — `(async () => { … })();` or `(async function (…) { … })();`.
///
/// It deletes the header, the closing brace and the trailing invocation; **dedents** the body by the
/// common leading whitespace of its non-blank lines; and deletes every `await` **token** in code
/// context, replaced by nothing with the surrounding whitespace untouched — `const x = await foo();`
/// becomes `const x =  foo();`, which is the same program.
///
/// **Declines** on an unclean [mask](code_mask); on a wrapper `{` with no matching `}` in code
/// context; on anything at the top level besides the wrapper and its invocation; on a wrapper the
/// program never **calls**, because its body then never ran and unwrapping would execute statements
/// the response did not ask to execute; on a `main().then(…)` invocation, because dropping the call
/// would delete the callback's code; and on a **non-`async`** wrapper — `function main(){…}
/// main();` already runs, so unwrapping it would change what the program evaluates to for no
/// reason.
///
/// # The honest caveat
///
/// This is the one strategy that rewrites *structure*, and it does change what the program evaluates
/// to. That is defensible only because a **called** `async` wrapper cannot run in this sandbox at
/// all — `await` throws and a returned promise is rejected by the shim — so there is no working
/// behaviour to preserve; the repair turns a program that could not run into the straight-line
/// program the model meant. Both halves of that warrant are load-bearing, which is why the strategy
/// declines unless the wrapper is the entire program *and* the program invokes it: a wrapper that is
/// only declared has no `await` to throw and no promise to reject, so there is nothing to repair and
/// running its body would be a rewrite made against a program that worked.
///
/// The dedent skips any line that begins **inside** a template literal, because the leading
/// whitespace of such a line is the model's data rather than its indentation, and silently reflowing
/// a file the program was about to write is exactly the class of quiet corruption this module exists
/// to eliminate.
fn unwrap_async(text: &str) -> StrategyOutcome {
    let Some(mask) = code_mask(text) else {
        return StrategyOutcome::Declined;
    };
    let Some((wrapper, body)) = match_async_wrapper(text, &mask) else {
        return StrategyOutcome::Declined;
    };

    let (unwrapped, awaits) = unwrap_body(text, &mask, body.clone());
    StrategyOutcome::Rewrote {
        text: unwrapped,
        detail: HealingDetail::Async { wrapper, awaits },
    }
}

/// The wrapper `text` is entirely made of, and the byte range of its body between the braces.
fn match_async_wrapper(
    text: &str,
    mask: &CodeMask,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    if let Some(matched) = match_async_function(text, mask) {
        return Some(matched);
    }
    match_async_iife(text, mask)
}

/// `async function main() { … }` followed by exactly one call to it.
///
/// The call is **required**. A wrapper that is only declared runs perfectly well in this sandbox —
/// as a program that does nothing — so unwrapping it would not repair a broken program, it would
/// execute statements the response never asked to execute. That is the one rewrite the
/// [caveat](unwrap_async) cannot cover, and its absence is what keeps this strategy consistent with
/// the synchronous wrapper it deliberately declines.
fn match_async_function(
    text: &str,
    mask: &CodeMask,
) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    let after_async = keyword(text, 0, "async")?;
    let after_function = keyword(text, after_async, "function")?;
    let (name, after_name) = identifier(text, after_function)?;
    let open = body_brace(text, mask, after_name)?;
    let close = matching_brace(text, mask, open)?;

    let tail = text[close + 1..].trim();
    if !is_invocation_of(tail, &name) {
        return None;
    }
    Some((AsyncWrapper::Function, open + 1..close))
}

/// `(async () => { … })();` or `(async function (…) { … })();` as the whole program.
fn match_async_iife(text: &str, mask: &CodeMask) -> Option<(AsyncWrapper, std::ops::Range<usize>)> {
    // The leading whitespace of the first line is the model's indentation, kept by `trim_reply` so
    // the fence scanner can read it — so the match skips it here rather than assuming a `(` at zero.
    let rest = text.trim_start().strip_prefix('(')?;
    let start = text.len() - rest.len();
    let after_async = keyword(text, start, "async")?;

    let open = match keyword(text, after_async, "function") {
        // `(async function () { … })();` — an optionally named function expression.
        Some(after_function) => {
            let after_name = identifier(text, after_function)
                .map_or(after_function, |(_, after_name)| after_name);
            body_brace(text, mask, after_name)?
        }
        // `(async () => { … })();` — parameters, the fat arrow, then the body directly. An arrow
        // function has no name and no return-type position to skip, so it does not go through
        // `body_brace`.
        None => {
            let after_params = parameter_list(text, mask, after_async)?;
            let arrow = text.get(after_params..)?.trim_start();
            let arrow_at = text.len() - arrow.len();
            arrow.strip_prefix("=>")?;
            let body = text.get(arrow_at + 2..)?.trim_start();
            let open = text.len() - body.len();
            body.starts_with('{').then_some(open)?
        }
    };
    let close = matching_brace(text, mask, open)?;
    let tail = text[close + 1..].trim();
    // The wrapper's own closing paren, then the call that runs it, and nothing else.
    let tail = tail.strip_prefix(')')?.trim_start();
    let tail = tail.strip_prefix('(')?.trim_start();
    let tail = tail.strip_prefix(')')?.trim_start();
    let tail = tail.strip_prefix(';').unwrap_or(tail);
    tail.trim()
        .is_empty()
        .then_some((AsyncWrapper::Iife, open + 1..close))
}

/// The offset just past `word` when it appears at `from` (skipping leading whitespace) at an
/// identifier boundary, or `None`.
fn keyword(text: &str, from: usize, word: &str) -> Option<usize> {
    let rest = text.get(from..)?;
    let trimmed = rest.trim_start();
    let at = text.len() - trimmed.len();
    let after = trimmed.strip_prefix(word)?;
    after
        .chars()
        .next()
        .is_none_or(|c| !is_ident_char(c))
        .then_some(at + word.len())
}

/// The identifier at `from` (skipping leading whitespace) and the offset just past it.
fn identifier(text: &str, from: usize) -> Option<(String, usize)> {
    let rest = text.get(from..)?;
    let trimmed = rest.trim_start();
    let at = text.len() - trimmed.len();
    let mut end = 0;
    for (index, c) in trimmed.char_indices() {
        let acceptable = if index == 0 {
            is_ident_start(c)
        } else {
            is_ident_char(c)
        };
        if !acceptable {
            break;
        }
        end = index + c.len_utf8();
    }
    (end > 0).then(|| (trimmed[..end].to_string(), at + end))
}

/// The offset just past a balanced `( … )` parameter list starting at `from`.
fn parameter_list(text: &str, mask: &CodeMask, from: usize) -> Option<usize> {
    let rest = text.get(from..)?;
    let trimmed = rest.trim_start();
    let open = text.len() - trimmed.len();
    if !trimmed.starts_with('(') {
        return None;
    }
    let mut depth = 0usize;
    for (index, byte) in text.bytes().enumerate().skip(open) {
        if !mask.is_code(index) {
            continue;
        }
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// The offset of the wrapper's body `{`, given the offset just past its name.
///
/// Between the two lie the parameter list and — for a model that writes TypeScript, which is what
/// this run asks of it — an optional return-type annotation. The annotation is accepted only when
/// its angle brackets balance, which is what stops `: Promise<{ ok: boolean }>` from being mistaken
/// for the body and unwrapping half a type as if it were code.
fn body_brace(text: &str, mask: &CodeMask, after_name: usize) -> Option<usize> {
    let after_params = parameter_list(text, mask, after_name)?;
    let open = (after_params..text.len())
        .find(|index| text.as_bytes()[*index] == b'{' && mask.is_code(*index))?;
    let annotation = text[after_params..open].trim();
    let balanced = annotation.matches('<').count() == annotation.matches('>').count();
    (annotation.is_empty() || (annotation.starts_with(':') && balanced)).then_some(open)
}

/// The offset of the `}` that closes the `{` at `open`, counting braces in code context only.
fn matching_brace(text: &str, mask: &CodeMask, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (index, byte) in text.bytes().enumerate().skip(open) {
        if !mask.is_code(index) {
            continue;
        }
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

/// Whether `tail` is exactly one call of `name` — `main();`, `await main();` or `void main();`.
///
/// A `main().then(…)` tail fails here, which is the point: dropping that call would delete the
/// callback's code with it.
fn is_invocation_of(tail: &str, name: &str) -> bool {
    let tail = tail
        .strip_prefix("await")
        .or_else(|| tail.strip_prefix("void"))
        .filter(|rest| rest.starts_with(|c: char| c.is_whitespace()))
        .unwrap_or(tail)
        .trim_start();
    let Some(rest) = tail.strip_prefix(name) else {
        return false;
    };
    let rest = rest.trim_start();
    let Some(rest) = rest.strip_prefix('(') else {
        return false;
    };
    let rest = rest.trim_start();
    let Some(rest) = rest.strip_prefix(')') else {
        return false;
    };
    rest.trim_start().trim_start_matches(';').trim().is_empty()
}

/// The wrapper's body, dedented and with its `await` tokens removed, and how many went.
fn unwrap_body(text: &str, mask: &CodeMask, body: std::ops::Range<usize>) -> (String, usize) {
    let inner = &text[body.clone()];
    let base = body.start;

    // The common indentation, measured only over lines that begin in code context: a line that
    // begins inside a template literal carries data, not indentation.
    let indent = lines_with_offsets(inner)
        .filter(|(offset, line)| !line.trim().is_empty() && mask.is_code(base + offset))
        .map(|(_, line)| &line[..line.len() - line.trim_start().len()])
        .reduce(common_prefix)
        .unwrap_or_default()
        .to_string();

    let mut out = String::with_capacity(inner.len());
    let mut awaits = 0;
    let mut offset = 0;
    for raw in inner.split_inclusive('\n') {
        let start = offset;
        offset += raw.len();
        let dedented = if mask.is_code(base + start) {
            raw.strip_prefix(indent.as_str()).unwrap_or(raw)
        } else {
            raw
        };
        let shift = base + start + (raw.len() - dedented.len());
        awaits += strip_awaits(dedented, mask, shift, &mut out);
    }
    (out.trim().to_string(), awaits)
}

/// Append `line` to `out` with its code-context `await` tokens removed, returning how many went.
///
/// `base` is the offset of `line`'s first byte within the source the `mask` was built from.
fn strip_awaits(line: &str, mask: &CodeMask, base: usize, out: &mut String) -> usize {
    let mut removed = 0;
    let mut cursor = 0;
    while let Some(found) = line[cursor..].find("await") {
        let at = cursor + found;
        let end = at + "await".len();
        let bounded = line[..at]
            .chars()
            .next_back()
            .is_none_or(|c| !is_ident_char(c))
            && line[end..].chars().next().is_none_or(|c| !is_ident_char(c));
        let in_code = (at..end).all(|index| mask.is_code(base + index));
        if bounded && in_code {
            out.push_str(&line[cursor..at]);
            removed += 1;
        } else {
            out.push_str(&line[cursor..end]);
        }
        cursor = end;
    }
    out.push_str(&line[cursor..]);
    removed
}

/// The longer common prefix of two strings, in whole characters.
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

// ---------------------------------------------------------------------------------------------
// The predicates and the lexical mask
// ---------------------------------------------------------------------------------------------

/// The JavaScript statement keywords a line of code may open with.
///
/// Matched **case-sensitively** at an identifier boundary, which is the difference between the `let`
/// that opens a declaration and the `Let's` that opens a sentence — a distinction a real reply
/// turned on.
const STATEMENT_KEYWORDS: [&str; 26] = [
    "const", "let", "var", "function", "return", "if", "for", "while", "switch", "case", "try",
    "catch", "finally", "throw", "class", "new", "do", "else", "import", "export", "async",
    "await", "yield", "delete", "typeof", "void",
];

/// The tokens a line of code may end with.
const CODE_ENDINGS: [&str; 11] = [";", "{", "}", ",", "(", "[", "=>", "&&", "||", "+", "="];

/// Characters no line of English prose contains.
const NON_PROSE_CHARS: [char; 15] = [
    '`', ';', '{', '}', '(', ')', '[', ']', '=', '<', '>', '|', '&', '$', '\\',
];

/// Whether `line` is **certainly** a line of code — the test [`strip_fences`] uses to refuse to
/// unwrap a fence that is inside a program rather than around one, and the test the loop uses to
/// tell a reply that failed to compile from a reply that was never a program.
///
/// Its errors are asymmetric on purpose. A false positive costs a fence that could have been
/// unwrapped (one turn, one located diagnostic); a false negative deletes a line of the model's
/// program. So every clause below is a shape that only code has.
///
/// # Three shapes deliberately absent, each because a real reply contains it
///
/// * **ending with `)` or `]`** — a real trailing-prose line is `- a.ts (6 lines)`, and treating a
///   trailing paren as code would make the single most common real shape (prose, one fenced program,
///   prose) decline;
/// * **starting with a backtick** — models write prose lines that open with an inline code span
///   (`` `index.ts`: ``), and a template-literal continuation line that genuinely is code is already
///   caught by clause 1;
/// * **containing `;` anywhere** — English uses semicolons (`Here is the plan; I will list the
///   files.`), while clause 5 keeps every code shape that needs one (`x.y = 1; // note`). Without
///   that narrowing, one semicolon in a model's lead-in sentence disables fence stripping for the
///   whole reply.
fn looks_like_code(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. It ends the way a statement or an open block ends.
    if CODE_ENDINGS.iter().any(|ending| line.ends_with(ending)) {
        return true;
    }
    // 2. It opens with a statement keyword.
    if starts_with_keyword(line) {
        return true;
    }
    // 3. It opens with a closer or a comment.
    if ["}", ")", "]", "//", "/*"]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    // 4. It contains a fat arrow anywhere.
    if line.contains("=>") {
        return true;
    }
    // 5. It contains a `;` that terminates a statement — nothing after it but a comment.
    if line.match_indices(';').any(|(at, _)| {
        let rest = line[at + 1..].trim_start();
        rest.is_empty() || rest.starts_with("//") || rest.starts_with("/*")
    }) {
        return true;
    }
    // 6. It opens with a call: an identifier or dotted chain immediately followed by `(`.
    opens_with_call(line)
}

/// Whether `line` opens with a JavaScript statement keyword at an identifier boundary.
fn starts_with_keyword(line: &str) -> bool {
    STATEMENT_KEYWORDS.iter().any(|keyword| {
        line.strip_prefix(keyword)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !is_ident_char(c)))
    })
}

/// Whether `line` opens with `identifier(`, `a.b(` or `a.b.c(` — `writeFile(`, `console.log(`,
/// `entries.filter(`.
fn opens_with_call(line: &str) -> bool {
    let mut chars = line.char_indices().peekable();
    let Some((_, first)) = chars.peek().copied() else {
        return false;
    };
    if !is_ident_start(first) {
        return false;
    }
    let mut end = 0;
    while let Some((index, c)) = chars.peek().copied() {
        if is_ident_char(c) {
            end = index + c.len_utf8();
            chars.next();
            continue;
        }
        // A dot continues the chain only when a further identifier follows it; otherwise the chain
        // ended at the previous character, which is what keeps `Done. Created …` prose.
        if c == '.' {
            let mut lookahead = chars.clone();
            lookahead.next();
            if lookahead
                .peek()
                .is_some_and(|(_, next)| is_ident_start(*next))
            {
                chars.next();
                continue;
            }
        }
        break;
    }
    line[end..].starts_with('(')
}

/// Whether `line` is **certainly** prose — the test [`strip_prose`] uses to delete it.
///
/// The mirror image of [`looks_like_code`]: here a false positive deletes the model's code, so every
/// clause is a shape that only English has. The two predicates are **not** complements and are not
/// disjoint — a line may satisfy both, or neither — and the pipeline's fixpoint loop is what
/// resolves the overlap.
fn is_prose_line(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() {
        return false;
    }
    // 1. No punctuation that only code uses, and no comment opener.
    if line.contains(NON_PROSE_CHARS) || line.contains("//") || line.contains("/*") {
        return false;
    }
    // 2. Not a statement.
    if starts_with_keyword(line) {
        return false;
    }
    // 3. A sentence, or a single terminated word.
    let mut tokens = line.split_whitespace();
    let (Some(first), second) = (tokens.next(), tokens.next()) else {
        return false;
    };
    if second.is_some() {
        return [first]
            .into_iter()
            .chain(second)
            .chain(tokens)
            .any(has_letter_run);
    }
    first
        .strip_suffix(['.', '!', '?'])
        .is_some_and(|word| word.chars().count() >= 2 && word.chars().all(char::is_alphabetic))
}

/// Whether `token` contains a run of three or more letters — what tells a word of English from a
/// path, a number or an identifier fragment.
fn has_letter_run(token: &str) -> bool {
    let mut run = 0;
    for c in token.chars() {
        run = if c.is_alphabetic() { run + 1 } else { 0 };
        if run >= 3 {
            return true;
        }
    }
    false
}

/// Whether `c` may open a JavaScript identifier.
fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_' || c == '$'
}

/// Whether `c` may continue a JavaScript identifier.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// Which bytes of a source are **code** — as opposed to string, template-literal or comment text.
///
/// The question [`drop_imports`], [`unwrap_async`] and [`drop_duplicate_program`] each ask of it is
/// the same one: is this byte code? — so that an `import` inside a string, an `await` inside a
/// comment, or a `const` inside a template literal is left alone.
struct CodeMask {
    /// Per byte: not string, template-literal, or comment text. A substitution's `${` and `}`
    /// delimiters are code, because they are what a brace count has to see to come back out again.
    code: Vec<bool>,
}

impl CodeMask {
    /// Whether the byte at `index` is code. Out-of-range indices are not, so a caller that has
    /// already rewritten its text cannot silently read past the end of the mask.
    fn is_code(&self, index: usize) -> bool {
        self.code.get(index) == Some(&true)
    }
}

/// Lex `src` into its [code mask](CodeMask).
///
/// `None` means the source did not lex cleanly, and every strategy that needs the mask declines on
/// it. Three states end a scan uncleanly: an unterminated block comment, an unterminated template
/// literal, and — decisively — a single- or double-quoted string still open at a newline, which
/// JavaScript forbids.
///
/// Handles `'…'`, `"…"`, `` `…` `` with `${ … }` substitutions re-entering code (nesting tracked),
/// `//…\n`, `/*…*/`, and backslash escapes. Used by [`drop_imports`], [`unwrap_async`] and
/// [`drop_duplicate_program`]; deliberately **not** used by [`strip_fences`] or [`strip_prose`],
/// whose input is not JavaScript yet.
///
/// # The one thing it does not lex
///
/// Regular-expression literals. Telling `/` as division from `/` as the start of a regex needs
/// parser context, which is the very thing this function exists to avoid. A regex containing a quote
/// (`str.replace(/don't/g, "")`) therefore desynchronises the scan — and because that leaves a
/// quoted string open at the next newline, the scan returns `None` and every strategy declines. The
/// failure mode of the one shape it cannot lex is *no healing*, which is the correct one.
fn code_mask(src: &str) -> Option<CodeMask> {
    /// Where the scan currently is.
    enum Mode {
        Code,
        Single,
        Double,
        Template,
        LineComment,
        BlockComment,
    }

    let bytes = src.as_bytes();
    let mut code = vec![true; bytes.len()];
    let mut mode = Mode::Code;
    // The brace depth each open `${ … }` substitution returns to Template at. Its length is how
    // many template literals the scan is currently inside.
    let mut substitutions: Vec<usize> = Vec::new();
    let mut depth = 0usize;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        let next = bytes.get(index + 1).copied();
        match mode {
            Mode::Code => match byte {
                b'/' if next == Some(b'/') => {
                    mark_comment(&mut code, index);
                    mark_comment(&mut code, index + 1);
                    mode = Mode::LineComment;
                    index += 2;
                }
                b'/' if next == Some(b'*') => {
                    mark_comment(&mut code, index);
                    mark_comment(&mut code, index + 1);
                    mode = Mode::BlockComment;
                    index += 2;
                }
                b'\'' | b'"' | b'`' => {
                    code[index] = false;
                    mode = match byte {
                        b'\'' => Mode::Single,
                        b'"' => Mode::Double,
                        _ => Mode::Template,
                    };
                    index += 1;
                }
                b'{' => {
                    depth += 1;
                    index += 1;
                }
                b'}' => {
                    if substitutions.last() == Some(&depth) {
                        substitutions.pop();
                        mode = Mode::Template;
                    } else {
                        depth = depth.saturating_sub(1);
                    }
                    index += 1;
                }
                _ => index += 1,
            },
            Mode::Single | Mode::Double => {
                let quote = if matches!(mode, Mode::Single) {
                    b'\''
                } else {
                    b'"'
                };
                code[index] = false;
                match byte {
                    // A string that is still open at a newline is not a string JavaScript accepts,
                    // and is the signature of a scan that has lost its place.
                    b'\n' => return None,
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    _ if byte == quote => {
                        mode = Mode::Code;
                        index += 1;
                    }
                    _ => index += 1,
                }
            }
            Mode::Template => {
                code[index] = false;
                match byte {
                    b'\\' => {
                        if index + 1 >= bytes.len() {
                            return None;
                        }
                        code[index + 1] = false;
                        index += 2;
                    }
                    b'`' => {
                        mode = Mode::Code;
                        index += 1;
                    }
                    b'$' if next == Some(b'{') => {
                        // The substitution's own delimiters are code: they are what a brace count
                        // has to see in order to come back out again.
                        code[index] = true;
                        code[index + 1] = true;
                        substitutions.push(depth);
                        mode = Mode::Code;
                        index += 2;
                    }
                    _ => index += 1,
                }
            }
            Mode::LineComment => {
                if byte == b'\n' {
                    mode = Mode::Code;
                } else {
                    mark_comment(&mut code, index);
                }
                index += 1;
            }
            Mode::BlockComment => {
                mark_comment(&mut code, index);
                if byte == b'*' && next == Some(b'/') {
                    mark_comment(&mut code, index + 1);
                    mode = Mode::Code;
                    index += 2;
                } else {
                    index += 1;
                }
            }
        }
    }

    // A line comment is closed by end of input; a string, a template literal, a block comment and an
    // open `${` substitution are not, and each one means the scan lost its place.
    (matches!(mode, Mode::Code | Mode::LineComment) && substitutions.is_empty())
        .then_some(CodeMask { code })
}

/// Mark one byte as comment text, which is not code.
fn mark_comment(code: &mut [bool], index: usize) {
    code[index] = false;
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/// Every line of `src` as `(byte offset, the line without its terminator)`.
///
/// Offsets rather than an iterator of `&str` because two strategies rebuild the text by *slicing*
/// the original — the only way to delete lines without also rewriting the line endings of the ones
/// that survive.
fn lines_with_offsets(src: &str) -> impl Iterator<Item = (usize, &str)> {
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

#[cfg(test)]
#[path = "healing.test.rs"]
mod tests;

#[cfg(test)]
#[path = "healing.fences.test.rs"]
mod fence_tests;

#[cfg(test)]
#[path = "healing.programs.test.rs"]
mod program_tests;
