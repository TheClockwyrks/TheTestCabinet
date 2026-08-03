//! The **responses-as-code** half of the agent loop: turning one model reply into a program, running
//! it in the [wasmtime sandbox](crate::sandbox), servicing every tool call that program composes,
//! and telling the loop what to do next.
//!
//! It is a module of [`agent`](super) rather than a file of it because it is one self-contained
//! concern — healing, execution, servicing, feedback — whose only couplings to the turn loop are the
//! [`CodeTurn`] it is handed and the [`CodeTurnOutcome`] it hands back. Splitting it out keeps
//! `agent.rs` about the turn loop and this file about what a *program turn* is.
//!
//! # Two questions this file does not answer
//!
//! **What counts as a program** is [healing](crate::healing)'s question, and **what counts as
//! finished** is an [ending call](crate::ending)'s. Neither is decided here, and neither
//! has a second, quieter answer hiding in this module: there is no shape of reply this file reads as
//! a conclusion, and no ending it invents. That is the whole of the protocol change this design
//! carries — under the protocol this replaces, both questions were answered here, by an extractor
//! whose silence about what it discarded cost a real session its deliverable.
//!
//! # What lives here
//!
//! * [`run_code_turn`] — one whole turn, from the raw reply to the [decision](CodeTurnOutcome) the
//!   loop acts on. Every effect a code turn has on the world happens inside it.
//! * [`run_code_program`] — the `spawn_blocking` offload plus the servicing loop, which is where
//!   every must-survive loop behaviour (gating, scheduler routing, telemetry, replay capture,
//!   knowledge-state re-emission, context reclaim, skill pinning) is preserved for a composed call.
//! * [`dispatch_code_tool_call`] — the per-call counterpart of the tool-calling loop's dispatch, so
//!   the two paths gate and route identically.
//! * The four feedback-context builders, which turn what happened into whichever of the four
//!   `code-*.hbs` templates the turn earned.
//!
//! Everything the seam only reads is grouped into [`CodeTurn`]; what it mutates — the context
//! window, the skills runtime, the subagent context — stays an explicit `&mut` parameter, which is
//! what lets the borrow checker prove the window is never mutated down two paths at once.

use super::*;

use std::time::Duration;

use tokio::runtime::Handle;

use test_cabinet_core::gg::GgSubagentRef;
use test_cabinet_core::gg_replay::GgShellOrigin;

use crate::context::{EvictionResult, OpenViewInfo, ViewKind};
use crate::ending::Ending;
use crate::sandbox::{
    ProgramError, SandboxViewOpened, ToolApi, UnreachableTail, ViewOpenOutcome, ViewRefusal,
    WorkflowStageInput,
};
use crate::tasks::TaskStatus;
use crate::tools::{
    AddTaskTool, ArchiveThreadTool, CompactTool, CompleteTaskTool, CreateEpicTool, CreateIssueTool,
    CreateMemoryTool, DeleteMemoryTool, EditFileTool, EditMemoryTool, EvictFileViewTool,
    ListDirTool, OffloadPolicy, OwnedStructured, ReadMemoryTool, ReadSkillTool, RemoveEpicTool,
    RemoveIssueTool, RemoveTaskTool, SearchArchiveTool, SearchMemoriesTool, SetBlockedByTool,
    SetIssueBlockedByTool, UpdateIssueTool, UpdateMemoryTool, UpdateTaskTool, WriteFileTool,
    WriteMemoryTool, read_only_refusal, run_command,
};

// ---------------------------------------------------------------------------
// What one code turn asks the loop to do
// ---------------------------------------------------------------------------

/// What one responses-as-code turn asks the loop to do next.
///
/// Three variants, because the loop has exactly three things it can do with a code turn: end the
/// session because the model said so, feed something back and take another turn, or stop because
/// gg's own machinery is broken and every further turn would fail identically.
///
/// The [turn outcome](Self::turn_outcome) is derived from the variant rather than carried alongside
/// it, so an illegal pairing — a `Finished` that also counts as an error, a `Continue` that ends the
/// session — is unrepresentable.
pub(super) enum CodeTurnOutcome {
    /// The program made one of its [ending calls](crate::ending::EndingRole).
    Finished {
        /// What the program declared — the summary it finished with, the verdict it returned, or
        /// the attempt it picked. Its [text](Ending::final_text) becomes the session's final word.
        ending: Ending,
    },
    /// The turn produced feedback for the model; the loop pushes it and takes another turn.
    Continue {
        /// What gg has to say back, in the order it is pushed — **empty** for the ordinary outcome
        /// of a program that compiled, ran, and showed itself what it meant to.
        ///
        /// A list rather than one message because a turn can produce a process fact *and* a fault,
        /// and the two must not be welded into one blob: an error message carries the error alone
        /// (see [`CodeFeedback`]), so anything else gg needs to say is a message of its own. The
        /// error goes last, so it is the final thing the model reads before writing its next
        /// program.
        ///
        /// They carry **no pictures**. A picture reaches the model through a
        /// [view](crate::context::ViewKind) — its own attributable, evictable context item — or not
        /// at all; a message from gg is gg's reporting, not a channel for workspace material.
        feedback: Vec<CodeFeedback>,
        /// Why this turn was an error, or `None` for a turn that carried out its declared work.
        error: Option<TurnErrorKind>,
        /// One line describing what this turn produced, in gg's own words.
        ///
        /// It is what an agent **stopped** before it could `finish` returns to its spawner. Under
        /// this protocol every assistant message is a TypeScript program, so the loop's `last_text`
        /// would hand a spawner a page of source instead of an answer; this is the answer.
        report: String,
    },
    /// gg's own machinery failed. Not a fault in anything the model wrote, and unreachable in a
    /// released build — CI compiles and instantiates the committed artifact — so the loop ends the
    /// session loudly rather than burning the run on a failure that would recur identically.
    Fatal {
        /// Which of gg's own failures this was.
        fault: FatalFault,
        /// The operator-facing sentence for the `error` log and the `CodeExecution` event.
        message: String,
    },
}

/// One message gg sends a [responses-as-code](crate::sandbox) agent, and the
/// [band](GgContextSource) it goes in — which is also the
/// [heading](crate::context::code_heading) the model reads it under.
///
/// # There are exactly three kinds, and two of them carry nothing but an error
///
/// Under this protocol every assistant turn is a program and everything gg says back is plain `user`
/// text, so the heading is the only thing telling the model what it is looking at. The vocabulary is
/// therefore deliberately tiny:
///
/// - [`CompilerError`](GgContextSource::CompilerError) — the program did not compile. Nothing ran.
/// - [`RuntimeError`](GgContextSource::RuntimeError) — it compiled and then threw, or a sandbox
///   limit stopped it. What it did before that stands.
/// - [`System`](GgContextSource::System) — a process notice: something about the *session* rather
///   than about the program.
///
/// The two error kinds carry **the error and nothing else**. No preamble, no "your program stopped",
/// no advice, no roster of what the program called, no restatement of the rules. A model reading its
/// own transcript learns the shape of a turn from what is in it, and a diagnostic wrapped in gg's
/// prose is a diagnostic the model has to parse gg out of first — so everything that is not the
/// error is either information the program already has (a failed call throws into the program; a
/// refused view throws into the program) or a *standing rule*, which belongs in the system prompt
/// where it is stated once instead of on every failing turn.
///
/// gg may **remove** from an error — a stack trace whose frames are gg's own internals tells the
/// model nothing it can act on — but never adds to one.
///
/// # There is no `Output`
///
/// There used to be. It is gone, and its absence is the point: `console.log` does not reach the
/// model (it reaches the run's operator), and a [view](crate::context::ViewKind) is the only channel
/// material has into the window. A band called `Output` on a protocol where a program produces no
/// output the model can read was a heading over an empty idea.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CodeFeedback {
    /// Which of the three bands this message belongs to.
    pub(super) source: GgContextSource,
    /// The message body, unheaded — [`ContextModel`](crate::context::ContextModel) prefixes the
    /// heading when it is pushed.
    pub(super) body: String,
}

impl CodeFeedback {
    /// A [`CompilerError`](GgContextSource::CompilerError) carrying `error` verbatim.
    fn compiler(error: impl Into<String>) -> Self {
        Self {
            source: GgContextSource::CompilerError,
            body: error.into(),
        }
    }

    /// A [`RuntimeError`](GgContextSource::RuntimeError) carrying `error` verbatim.
    fn runtime(error: impl Into<String>) -> Self {
        Self {
            source: GgContextSource::RuntimeError,
            body: error.into(),
        }
    }

    /// A [`System`](GgContextSource::System) notice — gg speaking about the session rather than
    /// reporting a fault in the program.
    pub(super) fn notice(body: impl Into<String>) -> Self {
        Self {
            source: GgContextSource::System,
            body: body.into(),
        }
    }
}

impl CodeTurnOutcome {
    /// This turn's [outcome](TurnOutcome) for the run's [ceilings](crate::limits::RunLimits).
    ///
    /// Total: there is no code turn a ceiling does not see recorded, which is what makes "every turn
    /// records exactly one outcome" an invariant rather than an aspiration — including the turn that
    /// ends the session and the one that ends it fatally, neither of which may ever *breach* a
    /// ceiling but both of which are counted so the accounting cannot drift from the number of model
    /// calls the run made.
    pub(super) fn turn_outcome(&self) -> TurnOutcome {
        match self {
            Self::Finished { .. } => TurnOutcome::Finished,
            Self::Continue { error: None, .. } => TurnOutcome::Progressed,
            Self::Continue {
                error: Some(kind), ..
            } => TurnOutcome::Error(*kind),
            Self::Fatal { fault, .. } => TurnOutcome::Fatal(*fault),
        }
    }
}

// ---------------------------------------------------------------------------
// One code turn
// ---------------------------------------------------------------------------

/// Run one responses-as-code turn from an already-[healed](Healed) reply: run its program, and
/// report what the loop must do next.
///
/// Every effect the turn has on the world happens inside this function — the healing, the sandbox
/// run, the servicing of each composed call, the telemetry, the replay capture. What comes back is
/// only the decision, and the [outcome](CodeTurnOutcome::turn_outcome) the run's ceilings count.
///
/// The order of the steps below is the design, not an implementation detail. A **completion is read
/// before the result is interpreted**, because by the time it gets here the question of whether the
/// program earned its ending has already been settled: the sandbox revokes the flag `finish` set if
/// the program then failed, so a completion that survives that far belongs to a program that ran to
/// its end, and nothing later in this function can outrank it.
///
/// Classification and feedback are decided at the *same* match, rather than by a separate
/// classifier the feedback then re-derives: the two decisions read the same facts, and splitting
/// them is how they drift.
/// `healed` is the reply already run through [healing](healing::heal) by the caller — done there, not
/// here, because the loop needs the healed program *before* this turn runs to decide what assistant
/// message to record (see [`AssistantMessageMode`](crate::healing::AssistantMessageMode)), and healing
/// the same reply twice would be the kind of duplicated decision that drifts.
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_code_turn(
    healed: Healed,
    code: &CodeSetup,
    deadline: Option<Instant>,
    turn: &CodeTurn<'_>,
    context: ContextModel,
    skills: SkillsRuntime,
    docs: DocsRuntime,
    subagents: Option<SubagentContext>,
) -> (CodeTurnOutcome, Option<CodeTurnState>) {
    let emitter = turn.emitter;
    if healed.did_not_converge {
        emitter.emit(log(
            "warn",
            "the response-healing pipeline did not reach a fixpoint for this reply, so every \
             repair was discarded and the reply was compiled exactly as the model sent it.",
        ));
    }
    // gg rewrote the model's message before running it, so it says so on the operator's stream as
    // well as in the model's own feedback. A silent rewrite of a model's output is exactly the class
    // of thing this harness exists to make visible: a study reading a live run must be able to see
    // that the program gg compiled was not byte-for-byte the one the model sent, without waiting for
    // the run's closing rollup. Gated on `rewritten` rather than on "a strategy fired", because a
    // reply that was only *classified* was repaired of nothing — nothing ran.
    if healed.rewritten() {
        emitter.emit(log(
            "info",
            format!(
                "the model's reply was repaired before it was compiled ({}); the repairs are \
                 disclosed to the model in this turn's feedback.",
                healed
                    .strategies()
                    .into_iter()
                    .map(HealingStrategy::id)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ));
    }

    // A reply that never became a program short-circuits here: no component, no store, no timer.
    // Nothing under `sandbox/` is entered at all. The per-turn state was never moved into a program,
    // so it is handed straight back untouched.
    if let HealingVerdict::NotAProgram(reason) = healed.verdict {
        let decision = not_a_program(turn, &healed, reason);
        return (
            decision,
            Some(CodeTurnState {
                context,
                skills,
                docs,
                subagents,
                // Nothing ran, so no program could have requested a wait, declared a compaction, or
                // made a call against a pending one.
                issue_waits: Vec::new(),
                compact_requested: None,
                handoff_requested: None,
                forks_requested: Vec::new(),
                compaction_calls: (0, 0),
            }),
        );
    }

    let (outcome, state) = run_code_program(
        &healed.program,
        code.limits,
        deadline,
        turn,
        context,
        skills,
        docs,
        subagents,
    )
    .await;

    // A reply that failed to type-strip and contains no code-shaped line was never a program at
    // all. It is the one place healing's question ("was this a program?") and the transpile's ("is
    // this program valid?") meet, and it is forced by measurement rather than taste: on the real
    // terminal prose replies models actually send, the prose *strategy* declines (it deletes, so it
    // has to be severe) while this classification — which deletes nothing — is exact. Without it the
    // modal failure of this protocol would be answered with a syntax error whose feedback never
    // mentions how to end the run.
    if matches!(&outcome.result, Err(SandboxError::Transpile(_)))
        && !healing::contains_code(&healed.program)
    {
        return (
            not_a_program(turn, &healed, NotAProgramReason::Prose),
            state,
        );
    }

    report_to_operator(&outcome, emitter);

    // Statements the model wrote that could not run are said out loud on the operator's stream as
    // well as in the model's own feedback, for the same reason a repaired reply is: a program gg
    // ran that is not the whole program the model sent has to be visible without waiting for a
    // rollup.
    if let Some(tail) = &outcome.unreachable {
        emitter.emit(log(
            "warn",
            format!(
                "the program wrote {} after its top-level `return` that could not run; the first \
                 is line {}: {}",
                plural(tail.statements, "statement"),
                tail.line,
                tail.excerpt
            ),
        ));
    }

    // The composed calls the turn actually dispatched — which is what streamed as
    // `ToolCall`/`ToolResult` pairs — is the roster plus whatever the roster cap (or a panicked
    // sandbox) stopped describing, never the roster's length.
    let tool_calls = outcome.tool_calls.len() as u64 + outcome.tool_calls_suppressed;
    emitter.emit(GgTelemetryKind::CodeExecution {
        ok: matches!(&outcome.result, Ok(result) if result.error.is_none()),
        tool_calls,
        duration_ms: Some(saturating_u64(outcome.elapsed.as_millis())),
        error: match &outcome.result {
            Ok(result) => result.error.as_ref().map(|error| error.message.clone()),
            Err(error) => Some(error.to_string()),
        },
        finished: outcome
            .completion
            .as_ref()
            .map(|completion| completion.ending.final_text()),
        // Everything the program printed, on the one event that describes the turn it printed it
        // in. This is the **only** record of it: a log line is not a channel into the model's own
        // window (what a program shows itself is a view, which arrives as its own context message),
        // so without this the output would exist for the instant it crossed the membrane and then
        // be gone — invisible to the operator reading a finished run, to the replay record, and to
        // any analysis over many runs.
        logs: outcome.logs.clone(),
        logs_suppressed: outcome.logs_suppressed,
        // Non-zero only for the program that beat the run's warm-up to the one shared component
        // compile and paid it itself — the figure that separates "this program was slow" from
        // "this program compiled a 13 MB component inside its own span".
        compile_wait_ms: outcome
            .compile_wait
            .map(|waited| saturating_u64(waited.as_millis())),
        healing: healing_record(&healed),
    });

    // Honour the ending before interpreting the result. An ending that is still here is one the
    // program declared and then ran out cleanly with — the sandbox has already revoked it if the
    // program failed afterwards — so there is nothing left to weigh it against and no next turn to
    // feed anything back to.
    if let Some(completion) = outcome.completion {
        if completion.superseded > 0 {
            emitter.emit(log(
                "warn",
                format!(
                    "the program called `{}` {} more time(s) before the call that ended the \
                     session; the last declaration is the one that stands.",
                    completion.ending.call_name(),
                    completion.superseded
                ),
            ));
        }
        emitter.emit(log(
            "info",
            format!(
                "the program ended the session: {}",
                ellipsize(&completion.ending.final_text(), MAX_REPORTED_SUMMARY_BYTES)
            ),
        ));
        return (
            CodeTurnOutcome::Finished {
                ending: completion.ending,
            },
            state,
        );
    }

    // An ending the program declared and then lost. It is said on the operator's stream as well as
    // in the model's feedback because it is the one shape in which a session that a model believed
    // was over carries on: without a word here, the stream shows an ending call on a turn that did
    // not end the session and nothing that explains it.
    if let Some(ending) = &outcome.revoked_completion {
        emitter.emit(log(
            "warn",
            format!(
                "the program called `{}` and then failed, so the session was NOT ended: {}",
                ending.call_name(),
                ellipsize(&ending.final_text(), MAX_REPORTED_SUMMARY_BYTES)
            ),
        ));
    }

    // The process facts this turn produced, independent of whether it also failed. They are
    // separate messages from any error, and they come first: an error carries the error alone, so
    // a fact welded onto it would be exactly the extra text that band exists not to have.
    let notices: Vec<CodeFeedback> = outcome
        .unreachable
        .as_ref()
        .map(|tail| CodeFeedback::notice(unreachable_notice(tail)))
        .into_iter()
        .collect();

    let decision = match &outcome.result {
        // gg's own machinery, in its two flavours. Both would fail identically on every further
        // turn, so neither is fed back and neither is ever charged to the model's error budget.
        Err(error) if error.is_artifact_defect() => CodeTurnOutcome::Fatal {
            fault: FatalFault::ArtifactDefect,
            message: format!(
                "the code sandbox's committed component could not be run ({error}); this is \
                 artifact drift, not a fault in the model's program, and every further turn would \
                 fail identically."
            ),
        },
        Err(error) if error.is_host_fault() => CodeTurnOutcome::Fatal {
            fault: FatalFault::HostFault,
            message: format!(
                "the code sandbox could not be operated ({error}); this is a defect in gg's own \
                 plumbing, not a fault in the model's program, and every further turn would fail \
                 identically."
            ),
        },
        // The compiler's own diagnostic, with nothing wrapped around it. `SandboxError::Transpile`'s
        // `Display` prefixes it ("the program did not compile: …"), which the `Compiler error`
        // heading already says, so the inner error is what goes out.
        Err(SandboxError::Transpile(transpile)) => CodeTurnOutcome::Continue {
            feedback: vec![CodeFeedback::compiler(transpile.to_string())],
            error: Some(TurnErrorKind::Transpile),
            report: "its last program did not compile".to_string(),
        },
        // A ceiling the sandbox enforced — a timeout, the memory cap, a trap. The program compiled
        // and started, so this is a runtime failure and reads as one; the variant's own `Display` is
        // the error, and gg adds no advice on top of it.
        Err(error) => {
            emitter.emit(log(
                "warn",
                format!("the code program did not run to a result: {error}"),
            ));
            CodeTurnOutcome::Continue {
                feedback: with_error(&notices, CodeFeedback::runtime(error.to_string())),
                error: Some(TurnErrorKind::SandboxLimit),
                report: "its last program was stopped by a sandbox limit".to_string(),
            }
        }
        Ok(result) => {
            let report = program_report(&outcome, result);
            let error = result
                .error
                .is_some()
                .then_some(TurnErrorKind::ProgramFault);
            CodeTurnOutcome::Continue {
                feedback: match result.error.as_ref() {
                    Some(error) => with_error(&notices, program_error_feedback(error)),
                    None => notices.clone(),
                },
                error,
                report,
            }
        }
    };
    (decision, state)
}

/// The turn a reply that was **not a program** earns: its own `CodeExecution`, the fourth feedback
/// template, and the error kind that keeps a prose loop from running forever.
///
/// Shared by healing's own verdict and the loop's post-transpile reclassification because the two
/// arrive at the same fact by different routes and the model must be told the same thing either
/// way. `duration_ms` is **absent** rather than zero: a turn that ran nothing has no duration to
/// average into a run's efficiency, and a fabricated zero would quietly halve one.
fn not_a_program(
    turn: &CodeTurn<'_>,
    healed: &Healed,
    reason: NotAProgramReason,
) -> CodeTurnOutcome {
    let emitter = turn.emitter;
    emitter.emit(GgTelemetryKind::CodeExecution {
        ok: false,
        tool_calls: 0,
        duration_ms: None,
        error: Some(reason.short()),
        finished: None,
        // Empty for the same reason `duration_ms` is absent: there was no program, so there is
        // nothing that could have printed.
        logs: Vec::new(),
        logs_suppressed: 0,
        // Absent for the same reason `duration_ms` is: nothing about this turn touched the sandbox,
        // so there is no component to have waited on.
        compile_wait_ms: None,
        healing: healing_record_with(healed, Some(reason)),
    });
    CodeTurnOutcome::Continue {
        // A `Notice`, not a `Compiler error`. Nothing was compiled: the reply was not a program in
        // the first place, so there is no diagnostic to hand back — what the model needs is the
        // process fact that gg could not act on what it sent, which is exactly what a notice is for.
        feedback: vec![CodeFeedback::notice(prompts::render_code_not_a_program(
            &CodeNotAProgramContext {
                reason: reason.message(),
                ending_calls: turn.ending_calls(),
            },
        ))],
        error: Some(TurnErrorKind::NotAProgram),
        report: format!("its last reply was not a program ({})", reason.short()),
    }
}

/// The one line a **spawner** is given for a turn whose program ran — what it said, or failed to, in
/// gg's own words rather than in the model's source.
///
/// The last thing the program logged is what it said: `console.log` is a program's channel to
/// whoever is *watching* the run — the spawner reading this line, the operator's stream, the replay
/// record — so the tail of it is the nearest thing to a conclusion the program wrote. (What the
/// program showed its own **model** is a [view](crate::context::ViewKind), and views are reported in
/// the turn's feedback rather than here: this line is for a reader outside the agent.) A throw
/// outranks it, because a program that threw did not finish what it declared however much it printed
/// on the way.
fn program_report(outcome: &SandboxOutcome, result: &ProgramResult) -> String {
    if let Some(error) = &result.error {
        return format!(
            "its last program threw: {}",
            ellipsize(&error.message, MAX_REPORTED_LINE_BYTES)
        );
    }
    match outcome.logs.last() {
        Some(line) => format!(
            "its last program logged: {}",
            ellipsize(line, MAX_REPORTED_LINE_BYTES)
        ),
        None => "its last program ran and reported nothing".to_string(),
    }
}

/// The longest one-line report [`CodeTurnOutcome::Continue::report`] carries before truncating.
///
/// A report is a *status line* handed to a spawner, a run record and a speculation judge's brief,
/// so it is bounded independently of the feedback the model sees: a program that returns a large
/// structure has already had that structure rendered (and capped) for the model's own feedback, and
/// repeating it into a status line would put the same payload in front of a reader who asked for a
/// sentence.
const MAX_REPORTED_LINE_BYTES: usize = 200;

/// The longest `finish` summary the run's `info` log line quotes. Shorter than a report because this
/// is a breadcrumb in the operator's stream — the summary itself is carried whole on the turn's
/// `CodeExecution`, on `LoopEnd::final_text`, and (for a subagent) in its return value.
const MAX_REPORTED_SUMMARY_BYTES: usize = 160;

/// `text` capped at `max` bytes on a character boundary, with an ellipsis when it was cut.
///
/// Truncating on a byte index would panic mid-codepoint on any reply that is not ASCII, which model
/// output routinely is not — so the boundary walk is the point of this function, not the cap.
fn ellipsize(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.len() <= max {
        return text.to_string();
    }
    let mut cut = max;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &text[..cut])
}

// ---------------------------------------------------------------------------
// The healing record, on the wire
// ---------------------------------------------------------------------------

/// The [contract record](GgResponseHealing) of what healing did to one reply that gg then ran.
fn healing_record(healed: &Healed) -> GgResponseHealing {
    healing_record_with(healed, None)
}

/// The [contract record](GgResponseHealing) of what healing did, with the verdict stated
/// explicitly.
///
/// The verdict is a parameter rather than being read off `healed.verdict` for one case: the loop's
/// post-transpile reclassification decides a reply was prose *after* healing has already called it a
/// program, and the record must report the reason the model was actually told. Every other caller
/// passes `None` and the verdict is taken from the pass itself.
///
/// A clean reply produces the default, which the wire omits entirely — so the presence of this
/// object on an event *is* "something was unusual about this response".
fn healing_record_with(healed: &Healed, reason: Option<NotAProgramReason>) -> GgResponseHealing {
    let reason = reason.or(match healed.verdict {
        HealingVerdict::Program => None,
        HealingVerdict::NotAProgram(reason) => Some(reason),
    });
    GgResponseHealing {
        strategies: healed.strategies().into_iter().map(wire_strategy).collect(),
        not_a_program: reason.map(wire_reason),
        blocks: match reason {
            Some(NotAProgramReason::SeveralBlocks { blocks, .. }) => Some(saturating_u32(blocks)),
            _ => None,
        },
        candidate_shape: match reason {
            Some(NotAProgramReason::SeveralBlocks { shape, .. }) => Some(wire_shape(shape)),
            _ => None,
        },
        did_not_converge: healed.did_not_converge,
    }
}

/// One [strategy](HealingStrategy) as the contract spells it.
///
/// Written out rather than derived, because the two enums are deliberately separate types: one is
/// gg's internal pipeline vocabulary and the other is a published wire value, and a `From` that made
/// them interchangeable would let a rename on either side travel silently to the other.
pub(super) fn wire_strategy(strategy: HealingStrategy) -> GgHealingStrategy {
    match strategy {
        HealingStrategy::StripFences => GgHealingStrategy::StripFences,
        HealingStrategy::StripProse => GgHealingStrategy::StripProse,
        HealingStrategy::DropDuplicateProgram => GgHealingStrategy::DropDuplicateProgram,
        HealingStrategy::DropImports => GgHealingStrategy::DropImports,
        HealingStrategy::UnwrapAsync => GgHealingStrategy::UnwrapAsync,
        HealingStrategy::StripCommentOnly => GgHealingStrategy::StripCommentOnly,
    }
}

/// One [candidate shape](CandidateShape) as the contract spells it — written out for the same
/// reason [`wire_strategy`] is: gg's pipeline vocabulary and the published wire values are two
/// vocabularies, and a rename on either side must not travel silently to the other.
fn wire_shape(shape: CandidateShape) -> GgCandidateShape {
    match shape {
        CandidateShape::Fenced => GgCandidateShape::Fenced,
        CandidateShape::Bare => GgCandidateShape::Bare,
    }
}

/// One [not-a-program reason](NotAProgramReason) as the contract spells it. The candidate count and
/// their shape ride on their own fields rather than inside the variant, because a wire enum a study
/// groups by must be a closed set of bare strings.
fn wire_reason(reason: NotAProgramReason) -> GgNotAProgram {
    match reason {
        NotAProgramReason::Empty => GgNotAProgram::Empty,
        NotAProgramReason::ToolCallsOnly => GgNotAProgram::ToolCallsOnly,
        NotAProgramReason::Prose => GgNotAProgram::Prose,
        NotAProgramReason::CommentOnly => GgNotAProgram::CommentOnly,
        NotAProgramReason::NoProgramBlock => GgNotAProgram::NoProgramBlock,
        NotAProgramReason::SeveralBlocks { .. } => GgNotAProgram::SeveralBlocks,
    }
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/// Everything one program did that the **model** is not told, said on the operator's stream.
///
/// gg used to hand the model a per-turn report: the roster of calls, the views opened and closed, a
/// refusal, a discarded return value, work deferred past the program's end. That report is gone —
/// see [`CodeFeedback`] — because every item in it is either something the program already learned
/// by running (a call returns; a refusal throws) or a standing rule the system prompt states once.
///
/// None of it stops being worth *recording*, though, and losing the model's copy makes this one the
/// only copy. A study reading a finished run has to be able to see that a view was refused or that a
/// program returned a value into the void, and the operator's stream is where a run says what it did.
/// So the same facts go out here, worded for a reader outside the agent rather than for the agent.
///
/// Deliberately quiet on the ordinary path: a program that called some tools and opened some views
/// did what programs do, and a line per turn saying so would bury the turns worth reading.
fn report_to_operator(outcome: &SandboxOutcome, emitter: &Emitter) {
    for refusal in &outcome.refusals {
        emitter.emit(log(
            "warn",
            format!(
                "the program's `{}` call was refused before it ran: {}",
                refusal.name, refusal.message
            ),
        ));
    }
    if outcome.refusals_suppressed > 0 {
        emitter.emit(log(
            "warn",
            format!(
                "{} further refused call(s) were not recorded",
                outcome.refusals_suppressed
            ),
        ));
    }
    for refusal in &outcome.view_refusals {
        emitter.emit(log("warn", format!("a view call was refused: {refusal}")));
    }
    if outcome.views_suppressed > 0 {
        emitter.emit(log(
            "warn",
            format!(
                "{} further view record(s) were not recorded",
                outcome.views_suppressed
            ),
        ));
    }
    // Worth a line because it is the one way a program can produce a result and lose it: a `return`
    // is the shape a model reaches for when it wants to *say* something, and under this protocol the
    // only thing that says anything is a view.
    if outcome.returned_value {
        emitter.emit(log(
            "info",
            "the program returned a value, which was discarded — a program reports by opening a \
             view, not by returning",
        ));
    }
    if let Some(note) = &outcome.deferred_note {
        emitter.emit(log("info", note.clone()));
    }
    for view in &outcome.views_opened {
        emitter.emit(log(
            "debug",
            format!(
                "the program {} the {} view `{}` (~{} tokens)",
                if view.superseded {
                    "replaced"
                } else {
                    "opened"
                },
                view_kind_word(view.kind),
                view.selector,
                view.tokens
            ),
        ));
    }
    for selector in &outcome.views_closed {
        emitter.emit(log(
            "debug",
            format!("the program closed the view `{selector}`"),
        ));
    }
}

/// The word a [view kind](ViewKind) is named with — the same word the model wrote its own call with
/// (`view.openText` opens a `text` view), so an operator reading the stream sees the program's own
/// vocabulary rather than gg's.
fn view_kind_word(kind: ViewKind) -> &'static str {
    match kind {
        ViewKind::File => "file",
        ViewKind::Text => "text",
        ViewKind::Docs => "documentation",
    }
}

/// The [`Runtime error`](GgContextSource::RuntimeError) message for a program that threw.
///
/// The body is the error, and the error is `{name}: {message}` as the guest composed it, followed by
/// the one stack frame that is the model's own — rendered the way a stack trace renders, because
/// that is what it is. Every other frame belongs to the shim or to the SDK and never reaches here
/// (the guest matches the program's frame positively rather than filtering gg's out): a model cannot
/// act on gg's internals, and a trace full of them is a trace it has to read past.
///
/// Nothing else goes in. Not what the program called, not what it opened, not that an ending it
/// declared was revoked — a call returned its result into the program, a refused view threw into the
/// program, and the revocation rule is a standing one the system prompt states once. See
/// [`CodeFeedback`] for why that restraint is the design rather than an omission.
/// `notices` followed by `error` — the order a turn's messages are pushed in.
///
/// The error goes last so it is the final thing the model reads before it writes its next program,
/// and so a notice can never be mistaken for part of the diagnostic above it.
fn with_error(notices: &[CodeFeedback], error: CodeFeedback) -> Vec<CodeFeedback> {
    let mut all = notices.to_vec();
    all.push(error);
    all
}

/// The [`Notice`](GgContextSource::System) for [statements that could not run](UnreachableTail).
///
/// A notice rather than an error, and one gg keeps saying even though it says almost nothing else
/// about a program that ran: the model wrote a reply it believes executed in full, and half of it
/// silently did not. Nothing the program can observe reveals that — no call failed, nothing threw —
/// so this is the only channel it has. It names the count, quotes the first dead statement so the
/// model can recognise which half was lost, and states the rule that made them dead.
///
/// Rendered in Rust rather than in a template for the reason every count-bearing line here is: a
/// template that has to pluralise is a template that will one day say "1 statements".
fn unreachable_notice(tail: &UnreachableTail) -> String {
    format!(
        "{} after your top-level `return` did not run — the first is line {}: {}. A top-level \
         `return` ends the program, so nothing written after it executes. Send exactly one program \
         per reply.",
        plural(tail.statements, "statement"),
        tail.line,
        tail.excerpt,
    )
}

fn program_error_feedback(error: &ProgramError) -> CodeFeedback {
    CodeFeedback::runtime(match &error.location {
        Some(location) => format!("{}\n    at {location}", error.message),
        None => error.message.clone(),
    })
}

// ---------------------------------------------------------------------------
// The servicing seam
// ---------------------------------------------------------------------------

/// Everything a code turn's servicing seam needs to gate, route, record and report one program's
/// calls — the parts of the loop's per-turn state that the seam only ever **reads**.
///
/// It exists because the alternative is a twenty-one-parameter function and a thirteen-parameter
/// one that share twelve of those parameters. Grouping them names the thing they are — the turn's
/// context — and makes adding a routing input one field rather than an edit at four call sites.
///
/// What is *not* here is deliberate: [`ContextModel`], [`SkillsRuntime`] and the
/// [subagent context](SubagentContext) are mutated while a program runs, so they stay separate
/// `&mut` parameters. Keeping the immutable and mutable halves apart is what lets the borrow
/// checker prove the seam cannot mutate the window through two paths at once.
pub(super) struct CodeTurn<'a> {
    /// The agent running the program — the spawner a delegation call is attributed to, and the id
    /// a replay entry is tagged with.
    pub(super) spawner: &'a Agent,
    /// The run's toolset, which decides both what the program binds and what dispatch reaches.
    pub(super) registry: &'a ToolRegistry,
    /// The workspace root and vision context every tool call is executed against.
    pub(super) tool_ctx: &'a ToolContext,
    /// The read policy `read_file` is bound with — whether ambient reads are permitted.
    pub(super) read_policy: ReadPolicy,
    /// The output policy `shell` is bound with — how much of a command's output a program's
    /// `system.shell(…)` gets back, and whether the whole of it is kept on disk.
    pub(super) shell_offload: &'a OffloadPolicy,
    /// The epic/issue board, for its state event and its tools.
    pub(super) board: &'a BoardRuntime,
    /// This agent's own rules on filing an issue — who it may assign one to, and whether it must
    /// name reviewers. The native path carries these on the registry's `create_issue`; a code turn
    /// rebuilds that tool per call, so it is handed them here.
    pub(super) issue_policy: &'a IssuePolicy,
    /// The [project-management](crate::board) context, when the capability is on — for the
    /// auto-dispatch pump after a board mutation and for `wait_for_issue`. `None` when off.
    pub(super) project: Option<&'a ProjectContext>,
    /// The memory scratchpad, for its state event.
    pub(super) memories: &'a MemoriesRuntime,
    /// The task list, for its state event.
    pub(super) tasks: &'a TasksRuntime,
    /// The [agent-managed-context](apply_context_reclaim) setup, for the reclaim tools.
    pub(super) amc: &'a AmcSetup,
    /// Where this turn's telemetry goes.
    pub(super) emitter: &'a Emitter,
    /// The replay recorder, when the capability is on.
    pub(super) replay: Option<&'a Arc<GgRecorder>>,
    /// The session's [observer](crate::observer::SessionObserver), when one is watching — a
    /// [playback](crate::playback)'s, and nothing else. A program's composed calls reach it at the
    /// same servicing tail the recorder does, so a reconstruction compares a program's tool
    /// outcomes exactly as it compares a tool-calling turn's.
    pub(super) observer: Option<&'a Arc<dyn SessionObserver>>,
    /// Whether `speculate` is routed through the best-of-K routine this run.
    pub(super) speculative_active: bool,
    /// The [compaction](crate::compaction) the loop is waiting for this agent to perform, when one
    /// is in flight. While it is set the program's calls are narrowed to the one family that
    /// satisfies it — everything else is refused, because everything else adds to a window that is
    /// already full.
    pub(super) pending_compaction: Option<PendingCompaction>,
    /// Which [ending calls](EndingRole) this agent's programs are given, and what the sandbox will
    /// accept from them.
    pub(super) ending_role: EndingRole,
    /// The agents this one may become — its own
    /// [roster](test_cabinet_core::gg::GgAgentConfig::subagents), which is what an `exec` target is
    /// checked against. Empty when it has none, which is also when the call is not bound.
    pub(super) exec_roster: &'a [GgSubagentRef],
}

impl CodeTurn<'_> {
    /// The [ending calls](EndingRole) this agent's programs may make, as a program writes them.
    ///
    /// The feedback for a reply that was not a program names them, and it does so *every turn* — far
    /// later in the context than the system prompt that named them first. If the two ever disagree
    /// the later text wins, so both read this one fact: a reviewer pointed at a `harness.finish` it
    /// does not have would spend its turns calling a function that is not in its scope, and a
    /// reviewer that never returns a verdict is exactly what leaves an issue unaccepted.
    pub(super) fn ending_calls(&self) -> Vec<String> {
        ending_calls(self.ending_role, true)
    }
}

/// The per-turn state a code turn takes **by value** and hands back: the context window, the skills
/// and docs runtimes, and (when delegation is on) the subagent context.
///
/// It is moved into the turn's [`LoopToolApi`] so a program's calls act on the live window on the
/// blocking sandbox thread, then reclaimed from it when the sandbox returns — which is why
/// [`run_code_program`] returns `Option<CodeTurnState>`: on the one path the state cannot come back
/// (the blocking task **panicked** and took it with it) the option is `None`, a host fault the turn
/// maps to [`Fatal`](CodeTurnOutcome::Fatal), after which the loop ends the session and never reads
/// the window again.
pub(super) struct CodeTurnState {
    /// The agent's context window.
    pub(super) context: ContextModel,
    /// The skills runtime (skill library + what has been read this session).
    pub(super) skills: SkillsRuntime,
    /// The per-agent documentation runtime behind `object.list()` / `view.openDocsView()`.
    pub(super) docs: DocsRuntime,
    /// This agent's delegation context, when the capability is on.
    pub(super) subagents: Option<SubagentContext>,
    /// The board issues this turn's program asked to wait on, in first-requested order (empty when
    /// it requested none, or never ran a program). The loop suspends the agent on each — after the
    /// turn's feedback is recorded — before taking the next turn.
    pub(super) issue_waits: Vec<String>,
    /// The [compaction](crate::compaction) this turn's program declared with `context.compact(…)`,
    /// deferred to the loop exactly as an issue wait is: rewriting the window a program is running
    /// in would pull it out from under the turn still using it. The **last** call stands, so a
    /// program that compacts twice compacts once, from its final summary.
    pub(super) compact_requested: Option<CompactionRequest>,
    /// The [succession](crate::agent::transitions) this turn's program declared — with
    /// `agents.transitionState(…)` or `agents.exec(…)`, which are the same handoff — deferred to
    /// the loop for a stronger version of the same reason a compaction is: a succession replaces
    /// this agent outright, so performing it mid-program would pull the window, and every remaining
    /// call, out from under the turn still running in it. The **first** declaration stands.
    pub(super) handoff_requested: Option<Handoff>,
    /// The copies this turn's program declared with `agents.fork(…)`, in the order it made them.
    ///
    /// Deferred for the same reason and **additive** rather than first-wins: each fork is a
    /// separate child, so a program that forks three times gets three copies. Each copy's id was
    /// minted at its call and already returned to the program; what waits for the end of the turn
    /// is the dispatch, so the conversation each copy inherits is a complete one.
    pub(super) forks_requested: Vec<PendingFork>,
    /// How this turn's program fared against a pending compaction: how many calls it made while one
    /// was in flight, and how many of those failed (a refused call counts as a failure, because it
    /// is one). A [memory compaction](crate::compaction::PendingCompaction::MemoryWrites) is
    /// satisfied by a program that made at least one call and had none of them fail.
    pub(super) compaction_calls: (u32, u32),
}

/// Run a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program in the wasmtime sandbox and
/// return everything the program produced, along with the [per-turn state](CodeTurnState) it acted
/// on.
///
/// The sandbox is synchronous and CPU-bound, so it runs on a
/// [`spawn_blocking`](tokio::task::spawn_blocking) thread (the same offload the Foray/Lattice
/// validators use). Every call the program composes is serviced by the turn's [`LoopToolApi`], which
/// runs **on that blocking thread** — calling the stage-1 typed tool functions directly and routing
/// the delegation family back onto the async loop via `block_on`. That is where every must-survive
/// loop behaviour lives now: the compaction gate, `ToolCall`/`ToolResult` telemetry, replay
/// capture, knowledge-state re-emission, agent-managed-context reclaim, and skill pinning — all
/// exactly as a native tool call is serviced.
///
/// The per-turn state (`context`/`skills`/`docs`/`subagents`) is **moved into** the api so a
/// program's calls act on the live window, then reclaimed from it here and handed back to the loop.
/// On the one path it cannot come back — the blocking task **panicked**, a host fault that took the
/// state with it — the second element is `None`, and the turn maps that to
/// [`Fatal`](CodeTurnOutcome::Fatal) (after which the loop ends the session and never reads the
/// window again).
///
/// One thing is deliberately **not** replicated, and one thing deliberately is. A bare `read_file`
/// result is *not* pushed as a [`FileView`](GgContextSource::FileView) context item: a program that
/// reads forty files to grep them should not put forty files in the window, and consuming reads
/// inside the program instead of the context is one of the reasons responses-as-code exists. That
/// holds for **pictures too**: a bare read of a mockup reads and describes it (`shown: false`, with
/// a reason naming the remedy) and shows the model nothing.
///
/// A [`view.openFile`](ToolApi::open_file_view) *does* push one, and that is the whole distinction
/// the model is taught in one line: **`fs.readFile` gets bytes for your program; `view.openFile`
/// shows a file to you.** A view is an intent — *this should be visible* — so it is an attributable,
/// evictable, persisted context item keyed by `(path, region)`, and the picture an opened mockup
/// returned rides in that item. One channel, which is what makes the
/// [open-image-view cap](crate::sandbox::SandboxLimits::image_view_cap) a bound on the whole arm
/// rather than one of two budgets that cannot see each other.
#[allow(clippy::too_many_arguments)]
async fn run_code_program(
    source: &str,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    turn: &CodeTurn<'_>,
    context: ContextModel,
    skills: SkillsRuntime,
    docs: DocsRuntime,
    subagents: Option<SubagentContext>,
) -> (SandboxOutcome, Option<CodeTurnState>) {
    let program = source.to_string();
    // The tools bound into the program's scope: the run's offered toolset minus the turn-level
    // transitions. Derived from the same registry the system prompt was rendered from, so the
    // functions in scope and the signatures the model was shown are the same set.
    let enabled = scope_tools(turn.registry);
    // The ending group bound alongside them. It is the agent's role rather than a capability, which
    // is why it travels beside the tool names instead of among them.
    let role = turn.ending_role;
    // The production `ToolApi`: the loop's own per-turn state, servicing each typed call inline. The
    // mutable, reclaimed-after-the-turn state moves in; the rest is cloned from the turn (all
    // Arc-backed, so cheap) or captured fresh (`Handle::current()` bridges the delegation family
    // back onto this runtime from the blocking thread).
    let api = LoopToolApi {
        context,
        skills,
        docs,
        subagents,
        issue_waits_requested: Vec::new(),
        compact_requested: None,
        handoff_requested: None,
        forks_requested: Vec::new(),
        exec_roster: turn.exec_roster.to_vec(),
        compaction_calls: 0,
        compaction_failures: 0,
        spawner: turn.spawner.clone(),
        tool_ctx: turn.tool_ctx.clone(),
        read_policy: turn.read_policy,
        shell_offload: turn.shell_offload.clone(),
        board: turn.board.shared(),
        issue_policy: turn.issue_policy.clone(),
        project: turn.project.cloned(),
        memories_rt: turn.memories.alias(),
        tasks_rt: turn.tasks.shared(),
        amc: turn.amc.clone(),
        emitter: turn.emitter.clone(),
        replay: turn.replay.cloned(),
        observer: turn.observer.cloned(),
        handle: Handle::current(),
        speculative_active: turn.speculative_active,
        pending_compaction: turn.pending_compaction,
        serviced: 0,
        view_ops: 0,
        // The one ceiling on `limits` that is not enforced by the store: it bounds what stays in
        // the window rather than what this program may spend, so it travels onto the api instead.
        image_view_cap: limits.image_view_cap,
    };

    let sandbox = tokio::task::spawn_blocking(move || {
        run_program(&program, &enabled, role, limits, deadline, api)
    });

    match sandbox.await {
        // The sandbox ran (to a result, a throw, or a ceiling): reclaim the state the api carried so
        // the loop gets its live window, skills/docs runtimes and delegation context back.
        Ok((outcome, api)) => {
            let state = CodeTurnState {
                context: api.context,
                skills: api.skills,
                docs: api.docs,
                subagents: api.subagents,
                issue_waits: api.issue_waits_requested,
                compact_requested: api.compact_requested,
                handoff_requested: api.handoff_requested,
                forks_requested: api.forks_requested,
                compaction_calls: (api.compaction_calls, api.compaction_failures),
            };
            (outcome, Some(state))
        }
        // A panic inside the sandbox is a failure of gg's own plumbing, classified as one rather than
        // as a guest trap: the store — and with it the roster, the logs, the pictures, the elapsed
        // reading *and the per-turn state the api owned* — died with the blocking task. Returning
        // `None` for the state is what tells the turn this is a host fault; it maps it to `Fatal`,
        // ends the session, and never reads the window again. Laundering this as a trap would charge
        // gg's defect to the model's error budget and answer it with advice about smaller programs.
        Err(join) => {
            let outcome = SandboxOutcome {
                tool_calls: Vec::new(),
                // The api's own roster died with the panic, so the count of calls it had already
                // serviced is not recoverable here; the turn is fatal regardless.
                tool_calls_suppressed: 0,
                refusals: Vec::new(),
                refusals_suppressed: 0,
                logs: Vec::new(),
                logs_suppressed: 0,
                // The views the program had already opened died with the window they were pushed
                // into: the api owned the `ContextModel` and the panic took it. The turn is fatal
                // regardless, and the loop never reads that window again.
                views_opened: Vec::new(),
                views_closed: Vec::new(),
                view_refusals: Vec::new(),
                views_suppressed: 0,
                deferred_note: None,
                returned_value: false,
                completion: None,
                revoked_completion: None,
                elapsed: Duration::ZERO,
                // Both are observations the sandbox makes on its way through, and the task that would
                // have made them died — so neither is known, and neither is invented.
                unreachable: None,
                compile_wait: None,
                result: Err(SandboxError::Host(format!(
                    "the code sandbox task did not complete: {join}"
                ))),
            };
            (outcome, None)
        }
    }
}

/// Pin a **fresh** `read_skill` into the context and emit the updated
/// [`SkillsState`](GgTelemetryKind::SkillsState) — the code-mode half of what
/// [`record_tool_result`] does for a native call.
///
/// It lives here, rather than inside [`run_code_program`]'s already long servicing arm, because the
/// rule it encodes is subtle: a skill body is *pinned* context, retained across compaction, and it
/// must be pinned exactly once no matter how many times a program reads it. A repeat read is
/// answered by the program having the text and nothing being added to the window; the native path
/// pushes a short "already loaded" note instead, which a program does not need because it was
/// handed the body as a return value.
///
/// # Why the envelope differs from the native path's
///
/// [`record_tool_result`] pins the body as the `tool` message that answers its `read_skill` call,
/// because on that path the assistant turn really did request the call and a provider requires a
/// `tool` message to follow the assistant `tool_calls` it answers. A code turn offers the model
/// **no** native tool definitions, so its assistant message carries no `tool_calls` at all and the
/// call id here is one the loop minted for the program — a `tool` message quoting it would dangle
/// from the moment it was pushed, and an OpenAI-shaped provider rejects the whole request. So the
/// body is pinned as a standalone `user` message: the identical text, under the one envelope that
/// is valid without a call to answer — exactly what
/// [`clear_ephemeral`](ContextModel::clear_ephemeral) rewrites a retained `tool` item into for the
/// same reason.
fn pin_read_skill(
    context: &mut ContextModel,
    skills: &mut SkillsRuntime,
    call: &ToolCall,
    outcome: &ToolOutcome,
    emitter: &Emitter,
) {
    if call.name != READ_SKILL_TOOL || !outcome.ok {
        return;
    }
    let Some(name) = call.arguments.get("name").and_then(Value::as_str) else {
        return;
    };
    if matches!(skills.record_read(name), ReadRecord::Fresh) {
        context.push(
            GgContextSource::Skill,
            Retention::Pinned,
            Message::user(outcome.output.clone()),
        );
        if let Some(state) = skills.state_event() {
            emitter.emit(state);
        }
    }
}

// ---------------------------------------------------------------------------
// The caps a program's views are held to
// ---------------------------------------------------------------------------
//
// Every one of these is enforced in `LoopToolApi`, because that is where the `ContextModel` is: a
// cap that cannot see the window is a cap guessing. Breaching one is a **catchable** `ToolError`
// with code `limit-exceeded` **naming the cap** — never a silent truncation. A view is a program's
// only channel into its own context, and quietly cutting the model's output in half behind its back
// is the exact failure mode this whole feature exists to remove: the model can split the material,
// trim it, or write it to a file and open a file view of that, but only if it is told.

/// The most bytes one `view.openText` body may carry.
///
/// 64 KiB is four times what a `shell` result is truncated to and roughly a sixth of a small model's
/// whole window — comfortably more than any value a program assembles on purpose, and small enough
/// that one call cannot fill the window by itself.
const MAX_TEXT_VIEW_BYTES: usize = 65_536;

/// The most bytes one text view's label may carry. A label is a *selector* — the handle the model
/// closes and replaces the view by — so it is a name, not a description.
const MAX_VIEW_LABEL_BYTES: usize = 200;

/// The most text views one agent may hold open at once. Re-opening a label that is already open is
/// never refused by this: it replaces a view rather than adding one.
const MAX_OPEN_TEXT_VIEWS: usize = 50;

// The most **image-carrying** file views one agent may hold open at once is deliberately NOT a
// constant here. It is `SandboxLimits::image_view_cap` — configured per agent by the `imageViewCap`
// param and carried onto `LoopToolApi::image_view_cap` with the rest of that agent's ceilings —
// because it is the one view cap an experiment has a reason to move: it decides how much of a
// context window a run spends on pictures. The caps above it bound the *shape* of a window (a label
// is a name, a hundred views in one turn is a loop), which no arm needs to vary.

/// The most view operations — `openFile` + `openText` + `close` — one program may make.
///
/// Not a cost bound (the three caps above are) but a *shape* bound: a program composing a hundred
/// views in one turn has stopped showing the model material and started writing its window with a
/// loop. `current()` is not charged against it, because listing what is open opens nothing.
const MAX_VIEW_OPS_PER_PROGRAM: u32 = 100;

// ---------------------------------------------------------------------------
// The native `ToolApi`: the loop's own state, servicing each typed call inline
// ---------------------------------------------------------------------------

/// The production [`ToolApi`]: the loop's own state, servicing each typed call exactly as the
/// tool-calling loop services a native one — the compaction gate, ToolCall/ToolResult telemetry,
/// replay, agent-managed-context reclaim, skill pinning, board pump + state events — and routing the
/// delegation family to the subagent scheduler via `block_on` (the sandbox runs on a blocking
/// thread).
pub(super) struct LoopToolApi {
    // moved-in, mutable, reclaimed after the turn:
    pub(super) context: ContextModel,
    pub(super) skills: SkillsRuntime,
    pub(super) docs: DocsRuntime,
    pub(super) subagents: Option<SubagentContext>,
    /// The board issues this program asked to wait on, in first-requested order. A `wait_for_issue`
    /// call records its id here rather than blocking, and the loop performs the actual suspension
    /// once the program has ended — the deferral a composed program needs, since a mid-execution
    /// control-flow wait has no shape in one.
    pub(super) issue_waits_requested: Vec<String>,
    /// The compaction this program declared with `context.compact(…)`, deferred to the loop for the
    /// same reason an issue wait is: rewriting the window a program is running in would pull it out
    /// from under the turn still using it. A second `compact` replaces the first.
    pub(super) compact_requested: Option<CompactionRequest>,
    /// The [succession](crate::agent::transitions) this program declared with
    /// `agents.transitionState(…)` or `agents.exec(…)`, deferred for the reason on
    /// [`CodeTurnState::handoff_requested`]. A second declaration is **refused** rather than
    /// replacing the first, because an invisibly replaced successor identity is a change the model
    /// cannot see.
    pub(super) handoff_requested: Option<Handoff>,
    /// The copies this program declared with `agents.fork(…)`, in call order — see
    /// [`CodeTurnState::forks_requested`].
    pub(super) forks_requested: Vec<PendingFork>,
    /// The agents this one may become, for `exec`'s target check. Its own
    /// [roster](test_cabinet_core::gg::GgSubagentRef), which the loop holds and the api does not
    /// otherwise see.
    exec_roster: Vec<GgSubagentRef>,
    /// How many calls this program made while a compaction was in flight.
    pub(super) compaction_calls: u32,
    /// How many of those failed — a refusal included, since a refusal is a call that did not run.
    /// A [memory compaction](PendingCompaction::MemoryWrites) is satisfied by one program that made
    /// at least one call and had none of them fail.
    pub(super) compaction_failures: u32,
    // cloned/borrowed-by-value loop state:
    spawner: Agent,
    tool_ctx: ToolContext,
    read_policy: ReadPolicy,
    shell_offload: OffloadPolicy,
    board: BoardRuntime,
    /// The filing rules this agent's `create_issue` calls are checked against — see
    /// [`CodeTurn::issue_policy`].
    issue_policy: IssuePolicy,
    project: Option<ProjectContext>,
    memories_rt: MemoriesRuntime,
    tasks_rt: TasksRuntime,
    amc: AmcSetup,
    emitter: Emitter,
    replay: Option<Arc<GgRecorder>>,
    /// The session's observer, when one is watching. Cloned in from the turn so a program's
    /// composed calls are compared against the record exactly as a native call's are.
    observer: Option<Arc<dyn SessionObserver>>,
    handle: Handle,
    speculative_active: bool,
    pending_compaction: Option<PendingCompaction>,
    serviced: u64,
    /// How many view operations this program has made, against
    /// [`MAX_VIEW_OPS_PER_PROGRAM`]. Refused ones count: a refusal is an operation the program
    /// chose to attempt, and not counting them would leave a program that swallows the throws
    /// looping on a budget it can never spend.
    view_ops: u32,
    /// How many image-carrying views **this agent** may hold open at once — the
    /// [`imageViewCap`](crate::sandbox::SandboxLimits::image_view_cap) param, resolved from this
    /// agent's own profile and carried in on its [ceilings](SandboxLimits). `None` when the
    /// profile names none, which is the default: no ceiling at all.
    ///
    /// It is a ceiling and not a counter: what it is compared against is counted from the live
    /// window ([`ContextModel::open_image_views`]) at each call, so views that outlived the program
    /// that opened them are counted and nothing has to be reset between turns.
    image_view_cap: Option<usize>,
}

#[allow(dead_code)]
impl LoopToolApi {
    /// Gate the call and, if it is allowed, run `exec` (an ordinary typed tool call), then service
    /// the outcome (telemetry, AMC reclaim, replay, board pump, state events, skill pin). Returns
    /// the serviced outcome the membrane maps to a WIT result.
    fn serviced(
        &mut self,
        name: &str,
        args: Value,
        exec: impl FnOnce(&mut Self) -> ToolOutcome,
    ) -> ToolOutcome {
        // The gate is evaluated first, but the `ToolCall` is streamed *before* the call runs either
        // way — a refusal is a serviced call that streams its `ToolCall`/`ToolResult` pair exactly
        // as a call that ran does, so its telemetry order matches the native path's.
        let refused = self.gate(name);
        let call = self.begin(name, args);
        if let Some(refused) = refused {
            return self.complete(call, refused, Vec::new());
        }
        let mut outcome = exec(self);
        // Agent-managed context: rewrite the outcome with what the loop actually reclaimed.
        let managed = if self.amc.enabled && outcome.ok && is_context_reclaim_tool(name) {
            apply_context_reclaim(
                &mut self.context,
                &self.amc.archive,
                &self.amc.archive_id,
                &call,
                &mut outcome,
            )
        } else {
            Vec::new()
        };
        self.complete(call, outcome, managed)
    }

    /// The gates every serviced call passes: `Some(refusal_outcome)` when this call is withheld.
    ///
    /// Two, and they are refusals for different reasons. **Memory access** is structural — a
    /// [read-only](crate::memories::MemoryScope::ReadOnly) holder may not write, ever — and is the
    /// belt to the registry's braces: such a holder is offered no write call at all, so nothing a
    /// program written against the scope it actually has can reach one, and this catches only a
    /// program written against a scope it does not.
    ///
    /// **Compaction** is the strictest gate gg has, and temporary: while one is in flight the
    /// window is full, so every call that is not the one compaction asked for is refused. `compact`
    /// itself is exempt, exactly as the native path lets it through — the run has no way forward
    /// until the window is reclaimed.
    fn gate(&self, name: &str) -> Option<ToolOutcome> {
        if is_memory_tool(name) && !self.memories_rt.is_writable() {
            return Some(ToolOutcome::failed(
                ToolFailure::Refused,
                read_only_refusal(self.memories_rt.strategy(), true),
            ));
        }
        if let Some(pending) = self.pending_compaction
            && !pending.admits(name, true)
            && name != COMPACT_TOOL
        {
            return Some(ToolOutcome::failed(
                ToolFailure::Refused,
                pending.refusal(name, true, self.memories_rt.strategy().calls(true)),
            ));
        }
        None
    }

    /// Mint the synthetic call record (ordinal-keyed id, unique within the turn) and stream its
    /// `ToolCall` — done **before** the call runs, so a delegation's child events land between this
    /// `ToolCall` and its `ToolResult`, exactly as the native tool-calling loop orders them.
    fn begin(&mut self, name: &str, args: Value) -> ToolCall {
        let call = ToolCall {
            id: format!("{PROGRAM_CALL_ID_PREFIX}{}:{name}", self.serviced),
            name: name.to_string(),
            arguments: args,
        };
        self.serviced += 1;
        self.emitter.emit(GgTelemetryKind::ToolCall {
            name: call.name.clone(),
            args: call.arguments.clone(),
        });
        call
    }

    /// Stream the `ToolResult`, record replay, pump the board, re-emit knowledge state, and pin a
    /// fresh skill — the per-call servicing tail shared by ordinary and delegation calls, run after
    /// the call (or handler) has produced `outcome`. Its [`begin`](Self::begin) already streamed the
    /// `ToolCall`.
    fn complete(
        &mut self,
        call: ToolCall,
        outcome: ToolOutcome,
        managed: Vec<GgTelemetryKind>,
    ) -> ToolOutcome {
        self.emitter.emit(GgTelemetryKind::ToolResult {
            name: call.name.clone(),
            ok: outcome.ok,
            summary: outcome.summary.clone(),
        });
        for event in managed {
            self.emitter.emit(event);
        }
        if let Some(recorder) = &self.replay {
            recorder.record_tool_result(&self.spawner.id, &call, &outcome);
        }
        // The same comparison the native path makes, at the same point in the tail. `block_on` is
        // how a program reaches anything async at all — it runs on a `spawn_blocking` thread, so
        // parking it waits on the runtime rather than wedging it — which is exactly how its
        // `system.shell(…)` already reaches the shell seam.
        let mut outcome = outcome;
        if let Some(observer) = &self.observer {
            self.handle.clone().block_on(observer.tool_completed(
                &self.spawner.id,
                &call,
                &mut outcome,
            ));
        }
        // Every call made while a compaction is in flight is counted, and every one that did not
        // succeed — a refusal included, since a refusal is a call that did not run — is counted as a
        // failure. A memory compaction is satisfied by one program whose calls all succeeded, which
        // is exactly the question these two answer.
        if self.pending_compaction.is_some() {
            self.compaction_calls += 1;
            if !outcome.ok {
                self.compaction_failures += 1;
            }
        }
        if outcome.ok {
            if is_board_tool(&call.name)
                && let Some(project) = &self.project
            {
                project.orch.pump_and_wake(&self.emitter);
            }
            let state = if is_memory_tool(&call.name) {
                // The revisions first — the append-only record of what the call did, which for
                // a deletion is the only place it is recorded at all. A program may have made
                // several memory calls by now; the drain hands over every one of them.
                for revision in self.memories_rt.revision_events() {
                    self.emitter.emit(revision);
                }
                self.memories_rt.state_event()
            } else if is_task_tool(&call.name) {
                self.tasks_rt.state_event()
            } else if is_board_tool(&call.name) {
                self.board.state_event()
            } else {
                None
            };
            if let Some(state) = state {
                self.emitter.emit(state);
            }
        }
        pin_read_skill(
            &mut self.context,
            &mut self.skills,
            &call,
            &outcome,
            &self.emitter,
        );
        outcome
    }

    /// Delegation servicing: gate, stream the `ToolCall`, run the async handler on the blocking
    /// thread via `block_on`, then service the tail. `run` gets the handle + mut subagent ctx +
    /// spawner + emitter + call.
    fn delegated(
        &mut self,
        name: &str,
        args: Value,
        run: impl FnOnce(&Handle, &mut SubagentContext, &Agent, &Emitter, &ToolCall) -> ToolOutcome,
    ) -> ToolOutcome {
        let refused = self.gate(name);
        let call = self.begin(name, args);
        if let Some(refused) = refused {
            return self.complete(call, refused, Vec::new());
        }
        let handle = self.handle.clone();
        let spawner = &self.spawner;
        let emitter = &self.emitter;
        let outcome = match self.subagents.as_mut() {
            Some(sub) => run(&handle, sub, spawner, emitter, &call),
            None => ToolOutcome::failed(
                ToolFailure::Unavailable,
                format!("`{name}` is not available: this run has no delegation runtime."),
            ),
        };
        self.complete(call, outcome, Vec::new())
    }

    /// Delegation servicing for the two handlers that also need the [board](BoardRuntime) —
    /// [`speculate`](handle_speculate) — with an
    /// extra `&BoardRuntime` handed to the `run` closure.
    fn delegated_board(
        &mut self,
        name: &str,
        args: Value,
        run: impl FnOnce(
            &Handle,
            &mut SubagentContext,
            &Agent,
            &BoardRuntime,
            &Emitter,
            &ToolCall,
        ) -> ToolOutcome,
    ) -> ToolOutcome {
        let refused = self.gate(name);
        let call = self.begin(name, args);
        if let Some(refused) = refused {
            return self.complete(call, refused, Vec::new());
        }
        let handle = self.handle.clone();
        let spawner = &self.spawner;
        let board = &self.board;
        let emitter = &self.emitter;
        let outcome = match self.subagents.as_mut() {
            Some(sub) => run(&handle, sub, spawner, board, emitter, &call),
            None => ToolOutcome::failed(
                ToolFailure::Unavailable,
                format!("`{name}` is not available: this run has no delegation runtime."),
            ),
        };
        self.complete(call, outcome, Vec::new())
    }

    /// Validate a `wait_for_issue` request and record it for the loop to honour after the program
    /// ends — the non-blocking near half of the deferred wait.
    ///
    /// It runs the same checks the native [`handle_wait_for_issue`](super::handle_wait_for_issue)
    /// runs before it blocks — a non-empty id, the project capability, not the agent's own assigned
    /// issue, and an issue that is actually on the board — so a program learns of a bad id *as a
    /// throw on the call*, in the turn it made it, rather than at the between-turns suspension where
    /// it has no program to catch it. What it does not do is block: it appends the id to
    /// [`issue_waits_requested`](LoopToolApi::issue_waits_requested) (deduplicated) and returns an
    /// acknowledgement, and the loop suspends on it once the whole program has run.
    fn register_issue_wait(&mut self, id: String) -> ToolOutcome {
        let issue_id = id.trim();
        if issue_id.is_empty() {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "wait_for_issue needs a non-empty `issueId` (the id of the issue to wait for)."
                    .to_string(),
            );
        }
        if self.project.is_none() {
            return ToolOutcome::failed(
                ToolFailure::Unavailable,
                "`wait_for_issue` is not available: this run has no project-management board."
                    .to_string(),
            );
        }
        if self
            .project
            .as_ref()
            .and_then(|project| project.assigned_issue.as_deref())
            == Some(issue_id)
        {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                format!(
                    "you cannot wait on issue `{issue_id}`: it is the issue you were assigned to \
                     implement. Do the work and finish — your issue is completed when you are."
                ),
            );
        }
        if self.board.issue_status(issue_id).is_none() {
            return ToolOutcome::failed(
                ToolFailure::NotFound,
                format!(
                    "no issue `{issue_id}` is on the board (your current board is in your context); \
                     create it with `create_issue` or correct the id."
                ),
            );
        }
        let issue_id = issue_id.to_string();
        if !self.issue_waits_requested.contains(&issue_id) {
            self.issue_waits_requested.push(issue_id.clone());
        }
        ToolOutcome::ok(
            format!(
                "Wait registered for issue `{issue_id}`. This program keeps running; after it ends \
                 the run suspends until the issue is terminal (done or failed), then resumes and \
                 tells you which."
            ),
            format!("wait registered for issue `{issue_id}`"),
        )
    }

    /// Charge one view operation against [`MAX_VIEW_OPS_PER_PROGRAM`], refusing when the budget is
    /// spent.
    ///
    /// Charged before anything else a view call does, and charged for refusals too — a program that
    /// catches the throw and keeps calling has still made the call, and a budget that only counted
    /// successes would never actually stop one.
    fn charge_view_op(&mut self) -> Result<(), ViewRefusal> {
        if let Some(refusal) = view_ops_refusal(self.view_ops) {
            return Err(refusal);
        }
        self.view_ops += 1;
        Ok(())
    }

    /// Decide whether the open-image-view cap refuses this `view.openFile`, having read the file
    /// and discovered it is a picture.
    ///
    /// The cap is read from the **live window** rather than from a counter this api carries: views
    /// outlive the program that opened them, so the only honest question is how many are open right
    /// now. Re-opening a path that already holds an image view is a supersede — it replaces an
    /// occupant instead of adding one — so it is admitted at exactly the ceiling; that check uses
    /// the same `(path, region)` key the push itself supersedes on, so the two cannot disagree.
    ///
    /// The ceiling itself is **this agent's**: it comes from the `imageViewCap` its own profile
    /// resolved, so a reviewer that is only ever shown one screenshot and a builder working from
    /// four mockups can be configured differently in one run.
    fn refuse_over_image_cap(&self, path: &str, region: Option<FileRegion>) -> Option<ViewRefusal> {
        image_view_refusal(
            self.image_view_cap,
            self.context.open_image_views(),
            self.context.holds_image_view(path, region),
        )
    }

    /// Check one `view.openText` against the caps that bound a text view, then push it and report
    /// what the push did.
    ///
    /// The count cap needs the window (how many text views are open, and whether this label is one
    /// of them), so it is resolved here and decided by [`text_view_refusal`].
    fn push_text_view(
        &mut self,
        label: String,
        body: String,
    ) -> Result<SandboxViewOpened, ViewRefusal> {
        let open: Vec<String> = self
            .context
            .open_text_views()
            .into_iter()
            .map(|view| view.label)
            .collect();
        if let Some(refusal) = text_view_refusal(&label, &body, &open) {
            return Err(refusal);
        }
        let opened = self.context.open_text_view(label.clone(), body);
        Ok(SandboxViewOpened {
            kind: ViewKind::Text,
            selector: label,
            tokens: opened.tokens as u64,
            superseded: opened.superseded,
        })
    }
}

// ---------------------------------------------------------------------------
// What the view caps decide
// ---------------------------------------------------------------------------
//
// Free functions rather than methods, and pure: every one of them is a decision about a call, made
// from the call and from what is already open. Keeping them out of `LoopToolApi` is what lets the
// rules — and the exact words a refused model reads — be read and tested without standing up an
// agent, a workspace and a tokio runtime.

/// The refusal a `view.openDocsView` of a name this run did not bind earns.
///
/// A refusal rather than an empty view: an unbound name is almost always a guess, and an empty
/// `Documentation: whatever` block in the window would confirm the guess instead of correcting it.
/// The message names the one call that enumerates what the run *did* bind.
fn docs_not_found_refusal(name: &str) -> ViewRefusal {
    ViewRefusal {
        failure: ToolFailure::NotFound,
        message: format!(
            "no function named `{name}` is available this run, so there is nothing to show you. \
             Call `<object>.list()` to see the functions on an object."
        ),
    }
}

/// The refusal [`MAX_VIEW_OPS_PER_PROGRAM`] makes when a program has already spent its budget.
fn view_ops_refusal(made: u32) -> Option<ViewRefusal> {
    (made >= MAX_VIEW_OPS_PER_PROGRAM).then(|| ViewRefusal {
        failure: ToolFailure::LimitExceeded,
        message: format!(
            "this program has already made {MAX_VIEW_OPS_PER_PROGRAM} view operations \
             (MAX_VIEW_OPS_PER_PROGRAM), which is the most one program may make. The views it \
             already opened are in your window; open the rest next turn, or show fewer, larger \
             views."
        ),
    })
}

/// The refusal the text-view caps make about one `view.openText`, or `None` to let it through.
///
/// `open` is the labels already open. The count cap is checked against **new** labels only:
/// re-opening a label that is already open replaces a view rather than adding one, so refusing it
/// at the ceiling would leave an agent with fifty views unable to correct any of them.
///
/// An empty **body** is deliberately allowed: it is how a program says that something it was
/// showing is now empty, and refusing it would make that unexpressible.
fn text_view_refusal(label: &str, body: &str, open: &[String]) -> Option<ViewRefusal> {
    if label.trim().is_empty() {
        return Some(ViewRefusal {
            failure: ToolFailure::InvalidArgument,
            message:
                "a view needs a non-empty label: it is the selector you close and replace the \
                      view by, so a view without one could never be closed, replaced or attributed."
                    .to_string(),
        });
    }
    if label.len() > MAX_VIEW_LABEL_BYTES {
        return Some(ViewRefusal {
            failure: ToolFailure::LimitExceeded,
            message: format!(
                "that label is {} bytes; a view label may be at most {MAX_VIEW_LABEL_BYTES} \
                 (MAX_VIEW_LABEL_BYTES). A label is the short name you close the view by, not a \
                 description — put the description in the body.",
                label.len()
            ),
        });
    }
    if body.len() > MAX_TEXT_VIEW_BYTES {
        return Some(ViewRefusal {
            failure: ToolFailure::LimitExceeded,
            message: format!(
                "that body is {} bytes; one text view may be at most {MAX_TEXT_VIEW_BYTES} \
                 (MAX_TEXT_VIEW_BYTES). Nothing was truncated and nothing was shown — split it \
                 across several views, trim it, or write it to a file and open a file view of that.",
                body.len()
            ),
        });
    }
    if open.len() >= MAX_OPEN_TEXT_VIEWS && !open.iter().any(|open| open == label) {
        return Some(ViewRefusal {
            failure: ToolFailure::LimitExceeded,
            message: format!(
                "you already have {MAX_OPEN_TEXT_VIEWS} text views open (MAX_OPEN_TEXT_VIEWS), \
                 which is the most one agent may hold. Close one with `view.close(label)` — \
                 `view.current()` lists them — or re-open an existing label to replace what it \
                 shows."
            ),
        });
    }
    None
}

/// The refusal the [open-image-view cap](crate::sandbox::SandboxLimits::image_view_cap) makes about
/// a `view.openFile` whose read turned out to be a picture, or `None` to let it through.
///
/// `cap` is the agent's own configured ceiling — its `imageViewCap`, or `None` when its profile
/// names none, which is the default and refuses nothing. `open` is how many image views its window
/// already holds, and `superseding` is whether this call re-opens one of them. Superseding is never
/// refused, for the reason re-opening an already-open label is never refused by
/// [`MAX_OPEN_TEXT_VIEWS`]: it replaces an occupant instead of adding one, and refusing it would
/// leave an agent at the ceiling unable to *refresh* any of the views holding it there.
///
/// A cap of zero is honourable and reachable: it refuses every picture, which is exactly what an
/// arm measuring a run that cannot look at anything asks for. (The
/// [resolver](crate::sandbox::resolve_sandbox_limits) will not *produce* zero from a param — a zero
/// param reads as "not configured" — but nothing here depends on that.)
///
/// It **refuses** rather than dropping the picture and pushing the view anyway. A drop leaves the
/// model holding a view whose body says a picture is there and no picture — it learns about the loss
/// afterwards, in a form it cannot branch on, if it learns at all. A refusal is a value the program
/// catches at the call site, and nothing enters the window: no view, no read charged to it. So the
/// message has to name both the cap and the way out, which is a close the agent can actually
/// perform.
fn image_view_refusal(cap: Option<usize>, open: usize, superseding: bool) -> Option<ViewRefusal> {
    let cap = cap?;
    (open >= cap && !superseding).then(|| ViewRefusal {
        failure: ToolFailure::LimitExceeded,
        message: format!(
            "you already have {open} image views open, and {cap} is the most this agent may hold \
             (its `imageViewCap`) — a picture is re-sent on every request for as long as its view \
             is open. Nothing was shown and no view was opened. Close one with `view.close(path)` \
             — `view.current()` lists what is open — and open this one again."
        ),
    })
}

/// The refusal a `view.close` earns for a selector that could never name anything.
///
/// A selector that is *open under nothing* is not a failure — that closes `0` — but a blank one is:
/// it is not a name at all, and answering it with a cheerful zero would hide a typo.
fn close_selector_refusal(selector: &str) -> Option<ViewRefusal> {
    selector.trim().is_empty().then(|| ViewRefusal {
        failure: ToolFailure::InvalidArgument,
        message: "`view.close` needs a non-empty selector: a file view's path or a text view's \
                  label. `view.current()` lists what is open."
            .to_string(),
    })
}

/// The [`ContextManaged`](GgTelemetryKind::ContextManaged) event one band of a `view.close`
/// produced, or `None` when that band held nothing to close.
///
/// A close reports as the same two actions the native path does — `EvictFileViews` for a path,
/// `CloseTextViews` for a label — because it *is* the same reclaim, reached by a different call.
/// Keeping the two apart matters to whoever reads the stream: an evicted file view is recoverable
/// by re-reading the file, and a closed text view held the agent's only copy of what it showed.
fn view_close_event(
    action: GgContextAction,
    selector: &str,
    result: &EvictionResult,
) -> Option<GgTelemetryKind> {
    if result.items == 0 {
        return None;
    }
    let what = match action {
        GgContextAction::CloseTextViews => "text view(s)",
        _ => "file view(s)",
    };
    Some(GgTelemetryKind::ContextManaged {
        action,
        reclaimed_tokens: result.tokens,
        items: result.items as u64,
        detail: format!(
            "Closed {} {what} for `{selector}`, reclaiming ~{} tokens.",
            result.items, result.tokens
        ),
    })
}

/// A `TaskStatus` in the spelling gg's schema declares, for the telemetry `args` value only.
#[allow(dead_code)]
fn task_status_word(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Done => "done",
    }
}

/// An `IssueStatus` in the spelling gg's schema declares, for the telemetry `args` value only.
#[allow(dead_code)]
fn issue_status_word(status: IssueStatus) -> &'static str {
    match status {
        IssueStatus::Open => "open",
        IssueStatus::InProgress => "in_progress",
        IssueStatus::InReview => "in_review",
        IssueStatus::Done => "done",
        IssueStatus::Failed => "failed",
    }
}

#[allow(dead_code)]
impl ToolApi for LoopToolApi {
    fn shell(&mut self, command: String, timeout: Duration) -> ToolOutcome {
        self.serviced(
            "shell",
            json!({ "command": command, "timeout_secs": timeout.as_secs_f64() }),
            |api| {
                api.handle.clone().block_on(run_command(
                    &command,
                    timeout,
                    &api.shell_offload,
                    &api.tool_ctx,
                    // The one place a program's command line is distinguishable from a `shell`
                    // tool call by the time it reaches the seam, so the path is stamped here.
                    GgShellOrigin::Program,
                ))
            },
        )
    }
    fn read_file(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ToolOutcome {
        self.serviced(
            READ_FILE_TOOL,
            json!({ "path": path, "offset": offset, "limit": limit }),
            |api| {
                ReadFileTool::new(api.read_policy).read(&api.tool_ctx, path.clone(), offset, limit)
            },
        )
    }
    fn write_file(&mut self, path: String, contents: String) -> ToolOutcome {
        self.serviced(
            "write_file",
            json!({ "path": path, "contents": contents }),
            |api| WriteFileTool.write(&api.tool_ctx, path.clone(), contents.clone()),
        )
    }
    fn edit_file(&mut self, path: String, old_string: String, new_string: String) -> ToolOutcome {
        self.serviced(
            "edit_file",
            json!({ "path": path, "old_string": old_string, "new_string": new_string }),
            |api| {
                EditFileTool.edit(
                    &api.tool_ctx,
                    path.clone(),
                    old_string.clone(),
                    new_string.clone(),
                )
            },
        )
    }
    fn list_dir(&mut self, path: Option<String>) -> ToolOutcome {
        self.serviced("list_dir", json!({ "path": path }), |api| {
            ListDirTool.list(&api.tool_ctx, path.clone())
        })
    }
    fn read_skill(&mut self, name: String) -> ToolOutcome {
        self.serviced("read_skill", json!({ "name": name }), |api| {
            ReadSkillTool::new(api.skills.library()).read(name.clone())
        })
    }
    fn write_memory(&mut self, name: String, description: String, body: String) -> ToolOutcome {
        self.serviced(
            "write_memory",
            json!({ "name": name, "description": description, "body": body }),
            |api| {
                WriteMemoryTool::new(api.memories_rt.binding()).write(
                    name.clone(),
                    description.clone(),
                    body.clone(),
                )
            },
        )
    }
    fn update_memory(&mut self, name: String, description: String, body: String) -> ToolOutcome {
        self.serviced(
            "update_memory",
            json!({ "name": name, "description": description, "body": body }),
            |api| {
                UpdateMemoryTool::new(api.memories_rt.binding()).update(
                    name.clone(),
                    description.clone(),
                    body.clone(),
                )
            },
        )
    }
    fn create_memory(
        &mut self,
        name: String,
        description: String,
        contents: String,
    ) -> ToolOutcome {
        self.serviced(
            "create_memory",
            json!({ "name": name, "description": description, "contents": contents }),
            |api| {
                CreateMemoryTool::new(api.memories_rt.binding()).create(
                    name.clone(),
                    description.clone(),
                    contents.clone(),
                )
            },
        )
    }
    fn read_memory(&mut self, name: String) -> ToolOutcome {
        self.serviced("read_memory", json!({ "name": name }), |api| {
            ReadMemoryTool::new(api.memories_rt.binding()).read(name.clone())
        })
    }
    fn edit_memory(&mut self, name: String, search: String, replace: String) -> ToolOutcome {
        self.serviced(
            "edit_memory",
            json!({ "name": name, "old_string": search, "new_string": replace }),
            |api| {
                EditMemoryTool::new(api.memories_rt.binding()).edit(
                    name.clone(),
                    search.clone(),
                    replace.clone(),
                )
            },
        )
    }
    fn search_memories(&mut self, keywords: Vec<String>) -> ToolOutcome {
        self.serviced("search_memories", json!({ "keywords": keywords }), |api| {
            SearchMemoriesTool::new(api.memories_rt.binding()).search(keywords.clone())
        })
    }
    fn delete_memory(&mut self, name: String) -> ToolOutcome {
        self.serviced("delete_memory", json!({ "name": name }), |api| {
            DeleteMemoryTool::new(api.memories_rt.binding()).delete(name.clone())
        })
    }
    fn add_task(
        &mut self,
        id: String,
        title: String,
        description: Option<String>,
        blocked_by: Vec<String>,
    ) -> ToolOutcome {
        self.serviced(
            "add_task",
            json!({ "id": id, "title": title, "description": description, "blockedBy": blocked_by }),
            |api| {
                AddTaskTool::new(api.tasks_rt.store()).add(
                    id.clone(),
                    title.clone(),
                    description.clone(),
                    OwnedStructured::default(),
                    blocked_by.clone(),
                )
            },
        )
    }
    fn update_task(
        &mut self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        status: Option<TaskStatus>,
    ) -> ToolOutcome {
        // `description` follows gg's omit-to-keep sentinel: `None` (keep) is an absent key, matching
        // the pre-inversion membrane's `insert_text_edit`.
        let mut args = json!({ "id": id, "title": title, "status": status.map(task_status_word) });
        if let Some(description) = &description {
            args["description"] = json!(description);
        }
        self.serviced("update_task", args, |api| {
            UpdateTaskTool::new(api.tasks_rt.store()).update(
                id.clone(),
                title.clone(),
                description.clone(),
                OwnedStructured::default(),
                status,
            )
        })
    }
    fn set_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome {
        self.serviced(
            "set_blocked_by",
            json!({ "id": id, "blockedBy": blocked_by }),
            |api| {
                SetBlockedByTool::new(api.tasks_rt.store())
                    .set_blocked_by(id.clone(), blocked_by.clone())
            },
        )
    }
    fn complete_task(&mut self, id: String) -> ToolOutcome {
        self.serviced("complete_task", json!({ "id": id }), |api| {
            CompleteTaskTool::new(api.tasks_rt.store()).complete(id.clone())
        })
    }
    fn remove_task(&mut self, id: String) -> ToolOutcome {
        self.serviced("remove_task", json!({ "id": id }), |api| {
            RemoveTaskTool::new(api.tasks_rt.store()).remove(id.clone())
        })
    }
    fn create_epic(&mut self, prefix: String, title: String, description: String) -> ToolOutcome {
        self.serviced(
            "create_epic",
            json!({ "prefix": prefix, "title": title, "description": description }),
            |api| {
                CreateEpicTool::new(api.board.store()).create_epic(
                    prefix.clone(),
                    title.clone(),
                    description.clone(),
                )
            },
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn create_issue(
        &mut self,
        title: String,
        description: Option<String>,
        in_scope: String,
        out_of_scope: String,
        completion_criteria: String,
        blocked_by: Vec<String>,
        epic_id: Option<String>,
        agent: String,
        reviewers: Vec<String>,
    ) -> ToolOutcome {
        self.serviced(
            "create_issue",
            json!({ "title": title, "description": description, "inScope": in_scope, "outOfScope": out_of_scope, "completionCriteria": completion_criteria, "blockedBy": blocked_by, "epicId": epic_id, "agent": agent, "reviewers": reviewers }),
            |api| {
                CreateIssueTool::new(api.board.store(), api.issue_policy.clone()).create_issue(
                    title.clone(),
                    description.clone(),
                    in_scope.clone(),
                    out_of_scope.clone(),
                    completion_criteria.clone(),
                    blocked_by.clone(),
                    epic_id.clone(),
                    agent.clone(),
                    reviewers.clone(),
                )
            },
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn update_issue(
        &mut self,
        id: String,
        title: Option<String>,
        description: Option<String>,
        in_scope: Option<String>,
        out_of_scope: Option<String>,
        completion_criteria: Option<String>,
        status: Option<IssueStatus>,
        epic_id: Option<String>,
    ) -> ToolOutcome {
        // `description` (text-edit) and `epicId` (epic-assignment) use gg's omit-to-keep sentinel:
        // `None` means "leave it alone", spelled as an absent key — matching the membrane's former
        // `insert_text_edit`/`insert_epic_assignment`.
        let mut args = json!({ "id": id, "title": title, "inScope": in_scope, "outOfScope": out_of_scope, "completionCriteria": completion_criteria, "status": status.map(issue_status_word) });
        if let Some(description) = &description {
            args["description"] = json!(description);
        }
        if let Some(epic_id) = &epic_id {
            args["epicId"] = json!(epic_id);
        }
        self.serviced("update_issue", args, |api| {
            UpdateIssueTool::new(api.board.store()).update_issue(
                id.clone(),
                title.clone(),
                description.clone(),
                in_scope.clone(),
                out_of_scope.clone(),
                completion_criteria.clone(),
                status,
                epic_id.clone(),
            )
        })
    }
    fn set_issue_blocked_by(&mut self, id: String, blocked_by: Vec<String>) -> ToolOutcome {
        self.serviced(
            "set_issue_blocked_by",
            json!({ "id": id, "blockedBy": blocked_by }),
            |api| {
                SetIssueBlockedByTool::new(api.board.store())
                    .set_issue_blocked_by(id.clone(), blocked_by.clone())
            },
        )
    }
    fn remove_epic(&mut self, id: String) -> ToolOutcome {
        self.serviced("remove_epic", json!({ "id": id }), |api| {
            RemoveEpicTool::new(api.board.store()).remove_epic(id.clone())
        })
    }
    fn remove_issue(&mut self, id: String) -> ToolOutcome {
        self.serviced("remove_issue", json!({ "id": id }), |api| {
            RemoveIssueTool::new(api.board.store()).remove_issue(id.clone())
        })
    }
    fn wait_for_issue(&mut self, id: String) -> ToolOutcome {
        // Deferred, not blocking: `register_issue_wait` validates the id and records the request;
        // the loop suspends the agent after the program ends. Serviced like any ordinary call — it
        // streams a `ToolCall`/`ToolResult` pair and shows up in the composed-calls roster — but the
        // wait itself is not one of the delegation family's `block_on`s.
        self.serviced(WAIT_FOR_ISSUE_TOOL, json!({ "issueId": id }), |api| {
            api.register_issue_wait(id.clone())
        })
    }
    fn evict_file_view(&mut self, path: Option<String>) -> ToolOutcome {
        self.serviced("evict_file_view", json!({ "path": path }), |_api| {
            EvictFileViewTool.evict(path.clone())
        })
    }
    fn archive_thread(&mut self, ranges: Vec<TurnRange>) -> ToolOutcome {
        // Recorded as the same `[from, to]` pairs the JSON schema takes, because the loop re-parses
        // these arguments to perform the archival — the recorded call *is* the request.
        let pairs: Vec<Value> = ranges
            .iter()
            .map(|range| json!([range.from, range.to]))
            .collect();
        self.serviced("archive_thread", json!({ "ranges": pairs }), move |_api| {
            ArchiveThreadTool.archive(ranges.clone())
        })
    }
    fn search_archive(&mut self, query: String) -> ToolOutcome {
        self.serviced("search_archive", json!({ "query": query }), |api| {
            SearchArchiveTool::new(api.amc.archive.clone()).search(query.clone())
        })
    }
    fn compact(&mut self, summary: String, files: Vec<String>) -> ToolOutcome {
        // Deferred, not performed — the same shape as `wait_for_issue`, for a stronger version of
        // the same reason: resetting the context a program is *running in* would drop the window
        // out from under the turn still using it. The call validates (through the one parser the
        // native path and the handoff compactor also use), records the request, and the loop
        // rewrites the window once the whole program has ended.
        self.serviced(
            COMPACT_TOOL,
            json!({ "summary": summary, "files": files }),
            |api| {
                let outcome = CompactTool.compact(summary.clone(), files.clone());
                if outcome.ok
                    && let Ok(request) =
                        parse_compact_request(&json!({ "summary": summary, "files": files }))
                {
                    // The last call stands, exactly as the last `finish` summary does: a program
                    // that compacts on two branches compacts once, from the summary it ended with.
                    api.compact_requested = Some(request);
                }
                outcome
            },
        )
    }
    fn transition_state(&mut self, state: String, note: Option<String>) -> ToolOutcome {
        // Deferred, not performed — the shape `compact` has, for the reason on
        // [`handoff_requested`](LoopToolApi::handoff_requested). The judging is the loop's own
        // `handle_transition`, so a program and a native tool call are held to exactly the same
        // rules: the same legal targets, the same first-wins, the same refusal text. There is no
        // ending to lose to here — under responses-as-code an ending is declared through the session
        // membrane rather than through this dispatch path — so the ending gate is passed `None`.
        let args = json!({ "state": state, "note": note });
        let call_args = args.clone();
        self.serviced(TRANSITION_STATE_TOOL, args, move |api| {
            let Some(position) = api.spawner.fsm.clone() else {
                return ToolOutcome::failed(
                    ToolFailure::Unavailable,
                    "you are not running inside a state machine, so there is no state to \
                     transition to.",
                );
            };
            let call = ToolCall {
                id: String::new(),
                name: TRANSITION_STATE_TOOL.to_string(),
                arguments: call_args,
            };
            handle_transition(&position, &None, &mut api.handoff_requested, &call)
        })
    }
    fn exec(&mut self, agent: String, prompt: Option<String>) -> ToolOutcome {
        // The same deferral, and the same judge, as `transition_state` above: an `exec` and a
        // machine transition are one succession declared two ways, so they share a slot on this api
        // as well as a handler, and the first of the two a program declares stands.
        let args = json!({ "agent": agent, "prompt": prompt });
        let call_args = args.clone();
        self.serviced(EXEC_TOOL, args, move |api| {
            let call = ToolCall {
                id: String::new(),
                name: EXEC_TOOL.to_string(),
                arguments: call_args,
            };
            let LoopToolApi {
                exec_roster,
                spawner,
                handoff_requested,
                ..
            } = api;
            handle_exec(exec_roster, spawner, &None, handoff_requested, &call)
        })
    }
    fn fork(&mut self, prompt: String) -> ToolOutcome {
        // Registered rather than dispatched, unlike every other member of the delegation family:
        // the copy's window is this program's window, and it is not a complete conversation until
        // the turn that is running it ends. The id comes back now — a spawn a program cannot name
        // is a spawn it cannot use — and the child starts a moment later.
        let args = json!({ "prompt": prompt });
        let call_args = args.clone();
        self.serviced(FORK_TOOL, args, move |api| {
            let call = ToolCall {
                id: String::new(),
                name: FORK_TOOL.to_string(),
                arguments: call_args,
            };
            let LoopToolApi {
                subagents,
                spawner,
                forks_requested,
                ..
            } = api;
            match subagents.as_mut() {
                Some(sub) => handle_fork(sub, spawner, forks_requested, &call),
                None => ToolOutcome::failed(
                    ToolFailure::Unavailable,
                    format!(
                        "`{FORK_TOOL}` is not available: this run has no delegation runtime, so a \
                         copy of you could never be waited on or messaged."
                    ),
                ),
            }
        })
    }
    fn spawn_subagent(
        &mut self,
        agent: String,
        prompt: Option<String>,
        issue_id: Option<String>,
    ) -> ToolOutcome {
        let args = json!({ "agent": agent, "prompt": prompt, "issueId": issue_id });
        self.delegated(
            SPAWN_SUBAGENT_TOOL,
            args,
            |h, sub, spawner, emitter, call| {
                h.clone()
                    .block_on(handle_subagent_call(sub, spawner, emitter, call))
            },
        )
    }
    fn wait_for_subagents(&mut self, ids: Option<Vec<String>>) -> ToolOutcome {
        self.delegated(
            WAIT_FOR_SUBAGENTS_TOOL,
            json!({ "ids": ids }),
            |h, sub, spawner, emitter, call| {
                h.clone()
                    .block_on(handle_subagent_call(sub, spawner, emitter, call))
            },
        )
    }
    fn send_message(&mut self, agent_id: String, message: String) -> ToolOutcome {
        self.delegated(
            SEND_MESSAGE_TOOL,
            json!({ "agentId": agent_id, "message": message }),
            |h, sub, spawner, emitter, call| {
                h.clone()
                    .block_on(handle_subagent_call(sub, spawner, emitter, call))
            },
        )
    }
    fn run_workflow(&mut self, stages: Vec<WorkflowStageInput>) -> ToolOutcome {
        let json_stages: Vec<Value> = stages
            .iter()
            .map(|s| {
                json!({ "name": s.name, "prompt": s.prompt, "items": s.items, "agent": s.agent })
            })
            .collect();
        self.delegated(
            RUN_WORKFLOW_TOOL,
            json!({ "stages": json_stages }),
            |h, sub, spawner, emitter, call| {
                h.clone()
                    .block_on(handle_subagent_call(sub, spawner, emitter, call))
            },
        )
    }
    fn speculate(
        &mut self,
        agent: String,
        prompt: Option<String>,
        issue_id: Option<String>,
        attempts: u8,
        approaches: Vec<String>,
    ) -> ToolOutcome {
        let args = json!({ "agent": agent, "prompt": prompt, "issueId": issue_id, "attempts": attempts, "approaches": approaches });
        // Route through the best-of-K routine only when speculation is actually active this run
        // (the capability is on *and* the delegation machinery exists). Otherwise the tool is a
        // loop-handled declaration that reached the api by mistake — answer it exactly as the native
        // path's `registry.dispatch` → `SpeculateTool::invoke` does, with `handled_by_loop`.
        if self.speculative_active && self.subagents.is_some() {
            self.delegated_board(
                SPECULATE_TOOL,
                args,
                |h, sub, spawner, board, emitter, call| {
                    h.clone()
                        .block_on(handle_speculate(sub, spawner, board, emitter, call))
                },
            )
        } else {
            self.serviced(SPECULATE_TOOL, args, |_api| handled_by_loop(SPECULATE_TOOL))
        }
    }
    fn list_functions(&mut self, object: &str) -> Vec<FunctionSummary> {
        self.docs.list(object)
    }
    fn open_docs_view(&mut self, name: String) -> Result<SandboxViewOpened, ViewRefusal> {
        self.charge_view_op()?;
        let Some(read) = self.docs.read(&name) else {
            return Err(docs_not_found_refusal(&name));
        };
        let opened = self.context.open_docs_view(name.clone(), read);
        Ok(SandboxViewOpened {
            kind: ViewKind::Docs,
            selector: name,
            tokens: opened.tokens as u64,
            superseded: opened.superseded,
        })
    }
    /// Read a file and show it to the model — the one place a code turn pushes a
    /// [`FileView`](GgContextSource::FileView).
    ///
    /// The read itself is [`read_file`](Self::read_file) verbatim, so the gate, the telemetry pair,
    /// the replay entry, the roster line and the read policy are the ones a bare `fs.readFile`
    /// gets; there is no second, quieter read path. What follows it is the view: the `(path,
    /// region)` key comes from what the tool actually **returned** rather than from what the call
    /// asked for (an unlimited read policy ignores the window; a capped one applies its default when
    /// the call named none), so
    /// re-opening the same page supersedes it instead of stacking a second copy beside it.
    ///
    /// The content is cloned rather than moved out of the outcome because the outcome goes on to
    /// become the program's own return value — the model is handed the bytes *and* shown the file
    /// for the price of one read, which is the reason this call exists at all.
    ///
    /// # The image cap is consulted here, and only for a picture
    ///
    /// A view is the only way a picture enters the window, so this agent's
    /// [open-image-view cap](crate::sandbox::SandboxLimits::image_view_cap) is enforced
    /// on this one call. It can only be asked **after** the read, because nothing before it knows
    /// the file is a picture — gg sniffs the magic bytes rather than trusting an extension — so the
    /// order is read, then decide, then push. A read that produced no picture (a text file, or one
    /// of [`read_image`](crate::tools)'s own two refusals: a text-only model, a file over the
    /// display limit) is never touched by it: those already carry an honest `shown: false` and no
    /// image, and refusing them for a cap they do not spend would answer "you cannot see this" with
    /// "close something first".
    ///
    /// The refusal replaces the read's outcome, which the membrane lowers into the catchable
    /// `limit-exceeded` the program sees thrown. The read itself already streamed its own
    /// `ToolCall`/`ToolResult` pair and its replay entry — it really did happen, and the telemetry
    /// says so — while the roster line the *model* reads next turn records the call it actually
    /// made, which failed. Both are true of different readers, and the alternative (streaming no
    /// telemetry for a read that ran) would leave the operator's stream with a gap.
    fn open_file_view(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> ViewOpenOutcome {
        if let Err(refusal) = self.charge_view_op() {
            // Refused as a **serviced** call rather than as a silent nothing, exactly as the
            // compaction and memory gates refuse one: the roster the model reads next turn is
            // counted against the number of `ToolCall`/`ToolResult` pairs the turn streamed, and a
            // refusal that skipped the pair would make the two disagree.
            let outcome = self.serviced(
                READ_FILE_TOOL,
                json!({ "path": path, "offset": offset, "limit": limit }),
                |_api| refusal.into_outcome(),
            );
            return ViewOpenOutcome {
                outcome,
                opened: None,
            };
        }
        let mut outcome = self.read_file(path.clone(), offset, limit);
        if !outcome.ok {
            // The read failed; there is nothing to show. The failure is already a rostered,
            // streamed, replayed `read_file` result, and the membrane throws it at the program.
            return ViewOpenOutcome {
                outcome,
                opened: None,
            };
        }
        let region = match &outcome.data {
            Some(ToolData::FileText(text)) => FileRegion::covered(
                text.first_line.into(),
                text.last_line.into(),
                text.total_lines.into(),
            ),
            _ => None,
        };
        // The picture, if the read produced one, moves out of the outcome and into the view item:
        // the model looks at it there, and leaving a copy behind would let the membrane attach a
        // second one to the turn.
        let images = std::mem::take(&mut outcome.images);
        if !images.is_empty()
            && let Some(refusal) = self.refuse_over_image_cap(&path, region)
        {
            return ViewOpenOutcome {
                outcome: refusal.into_outcome(),
                opened: None,
            };
        }
        let opened = self.context.open_file_view_deduped(
            path.clone(),
            region,
            outcome.output.clone(),
            images,
        );
        ViewOpenOutcome {
            outcome,
            opened: Some(SandboxViewOpened {
                kind: ViewKind::File,
                selector: path,
                tokens: opened.tokens as u64,
                superseded: opened.superseded,
            }),
        }
    }
    fn open_text_view(
        &mut self,
        label: String,
        body: String,
    ) -> Result<SandboxViewOpened, ViewRefusal> {
        self.charge_view_op()?;
        self.push_text_view(label, body)
    }
    /// Close every view carrying `selector` — every page of a path, or the text view under a label.
    ///
    /// All three bands are swept, because a selector is what the *model* wrote and it has no
    /// obligation to tell gg which kind it meant. A selector that names nothing closes `0`, which is a
    /// successful call: a program that tidies up unconditionally should not have to guard every
    /// call with a `current()` check.
    fn close_view(&mut self, selector: String) -> Result<u32, ViewRefusal> {
        self.charge_view_op()?;
        if let Some(refusal) = close_selector_refusal(&selector) {
            return Err(refusal);
        }
        let files = self.context.evict_file_views(Some(&selector));
        let texts = self.context.close_text_views(Some(&selector));
        let docs = self.context.close_docs_views(Some(&selector));
        for event in [
            view_close_event(GgContextAction::EvictFileViews, &selector, &files),
            view_close_event(GgContextAction::CloseTextViews, &selector, &texts),
            view_close_event(GgContextAction::CloseDocsViews, &selector, &docs),
        ]
        .into_iter()
        .flatten()
        {
            self.emitter.emit(event);
        }
        Ok(saturating_u32(files.items + texts.items + docs.items))
    }
    fn current_views(&mut self) -> Vec<OpenViewInfo> {
        self.context.open_views()
    }
}

#[cfg(test)]
#[path = "agent.code.views.test.rs"]
mod view_tests;

#[cfg(test)]
#[path = "agent.code.feedback.test.rs"]
mod feedback_tests;
