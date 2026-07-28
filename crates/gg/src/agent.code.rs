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
//! finished** is [`finish`](crate::sandbox::FINISH_FUNCTION)'s. Neither is decided here, and neither
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

use crate::sandbox::{ToolApi, WorkflowStageInput};
use crate::tasks::TaskStatus;
use crate::tools::{
    AddTaskTool, ArchiveThreadTool, CompleteIssueTool, CompleteTaskTool, CreateEpicTool,
    CreateIssueTool, DeleteMemoryTool, EditFileTool, EvictFileViewTool, ListDirTool,
    OwnedStructured, ReadSkillTool, RemoveEpicTool, RemoveIssueTool, RemoveTaskTool,
    SearchArchiveTool, SetBlockedByTool, SetIssueBlockedByTool, UpdateIssueTool, UpdateMemoryTool,
    UpdateTaskTool, WriteFileTool, WriteMemoryTool, run_command,
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
    /// The program called [`finish`](crate::sandbox::FINISH_FUNCTION).
    Finished {
        /// The summary the program passed to `finish`, verbatim. Becomes the run's final text.
        summary: String,
    },
    /// The turn produced feedback for the model; the loop pushes it and takes another turn.
    Continue {
        /// The rendered feedback, pushed as an ephemeral user message.
        feedback: String,
        /// The pictures a bridged `read_file` produced, attached to that message — what restores
        /// vision inside a program.
        images: Vec<ImageContent>,
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
                // Nothing ran, so no program could have requested a wait.
                issue_waits: Vec::new(),
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
            .map(|completion| completion.summary.clone()),
        // Non-zero only for the program that beat the run's warm-up to the one shared component
        // compile and paid it itself — the figure that separates "this program was slow" from
        // "this program compiled a 13 MB component inside its own span".
        compile_wait_ms: outcome
            .compile_wait
            .map(|waited| saturating_u64(waited.as_millis())),
        healing: healing_record(&healed),
    });

    // Honour the completion before interpreting the result. A completion that is still here is one
    // the program declared and then ran out cleanly with — the sandbox has already revoked it if the
    // program failed afterwards — so there is nothing left to weigh it against and no next turn to
    // feed anything back to.
    if let Some(completion) = outcome.completion {
        if completion.superseded > 0 {
            emitter.emit(log(
                "warn",
                format!(
                    "the program called `{FINISH_FUNCTION}` {} more time(s) before the call that \
                     ended the run; the last summary is the one that stands.",
                    completion.superseded
                ),
            ));
        }
        emitter.emit(log(
            "info",
            format!(
                "the program ended the run: {}",
                ellipsize(&completion.summary, MAX_REPORTED_SUMMARY_BYTES)
            ),
        ));
        return (
            CodeTurnOutcome::Finished {
                summary: completion.summary,
            },
            state,
        );
    }

    // An ending the program declared and then lost. It is said on the operator's stream as well as
    // in the model's feedback because it is the one shape in which a run that a model believed was
    // over carries on: without a word here, the stream shows a `finish` on a turn that did not end
    // the session and nothing that explains it.
    if let Some(summary) = &outcome.revoked_completion {
        emitter.emit(log(
            "warn",
            format!(
                "the program called `{FINISH_FUNCTION}` and then failed, so the run was NOT ended: \
                 {}",
                ellipsize(summary, MAX_REPORTED_SUMMARY_BYTES)
            ),
        ));
    }

    let notes = healed.notes();
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
        Err(error @ SandboxError::Transpile(_)) => CodeTurnOutcome::Continue {
            feedback: code_failure_feedback(error, &outcome, notes, turn.delegated()),
            images: Vec::new(),
            error: Some(TurnErrorKind::Transpile),
            report: "its last program did not compile".to_string(),
        },
        Err(error) => {
            emitter.emit(log(
                "warn",
                format!("the code program did not run to a result: {error}"),
            ));
            CodeTurnOutcome::Continue {
                feedback: code_failure_feedback(error, &outcome, notes, turn.delegated()),
                images: outcome.images.clone(),
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
                feedback: prompts::render_code_result(&code_result_context(
                    &outcome,
                    result,
                    notes,
                    turn.delegated(),
                )),
                images: outcome.images.clone(),
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
        // Absent for the same reason `duration_ms` is: nothing about this turn touched the sandbox,
        // so there is no component to have waited on.
        compile_wait_ms: None,
        healing: healing_record_with(healed, Some(reason)),
    });
    CodeTurnOutcome::Continue {
        feedback: prompts::render_code_not_a_program(&CodeNotAProgramContext {
            healing: healed.notes(),
            reason: reason.message(),
            delegated: turn.delegated(),
        }),
        images: Vec::new(),
        error: Some(TurnErrorKind::NotAProgram),
        report: format!("its last reply was not a program ({})", reason.short()),
    }
}

/// The one line a **spawner** is given for a turn whose program ran — what it said, or failed to, in
/// gg's own words rather than in the model's source.
///
/// The last thing the program logged is what it said: `console.log` is a program's only channel, so
/// the tail of it is the nearest thing to a conclusion the program wrote. A throw outranks it,
/// because a program that threw did not finish what it declared however much it printed on the way.
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
// Feedback contexts
// ---------------------------------------------------------------------------

/// The [feedback context](CodeResultContext) for a program that **ran** — whether it returned a
/// value or threw.
///
/// Everything here is what the model needs in order to write its *next* program: what each composed
/// call did, what it printed, and the seven things that are otherwise invisible — a failure it
/// caught, output the capture caps dropped, work it deferred past its own end, a value it returned
/// into the void, an ending it declared and lost, pictures the budget dropped, and
/// [what gg repaired in its reply](crate::healing) before any of it ran.
fn code_result_context(
    outcome: &SandboxOutcome,
    result: &ProgramResult,
    healing: Vec<String>,
    delegated: bool,
) -> CodeResultContext {
    CodeResultContext {
        healing,
        delegated,
        error: result.error.as_ref().map(|error| CodeErrorView {
            message: error.message.clone(),
            location: error.location.clone(),
        }),
        returned_value: outcome.returned_value,
        finish_revoked: outcome.revoked_completion.is_some(),
        calls: outcome
            .tool_calls
            .iter()
            .map(|call| CodeCallView {
                name: call.name.clone(),
                ok: call.ok,
                error: call.error.clone(),
            })
            .collect(),
        call_count: outcome.tool_calls.len() + outcome.tool_calls_suppressed as usize,
        calls_suppressed: outcome.tool_calls_suppressed,
        refusals: outcome
            .refusals
            .iter()
            .map(|refusal| format!("`{}` — {}", refusal.name, refusal.message))
            .collect(),
        refusals_suppressed: outcome.refusals_suppressed,
        logs: outcome.logs.clone(),
        logs_suppressed: outcome.logs_suppressed,
        // Named only when the program genuinely said nothing at all: a throw is itself a report, and
        // telling a model that threw to log something would be noise on top of the fault. A program
        // that returned a value is not silent either — it said something, into the one channel that
        // does not carry — and is answered by its own note instead.
        silent: result.error.is_none() && !outcome.returned_value && outcome.logs.is_empty(),
        images_dropped: outcome.images_dropped,
        // The budget is derived from what the turn actually attached rather than restated from the
        // sandbox's constant, and the two cannot disagree: a picture is dropped only once the budget
        // is already full, so whenever `images_dropped` is non-zero — the only case the feedback
        // names a budget at all — the attached count *is* the budget.
        image_budget: saturating_u32(outcome.images.len()),
        deferred: outcome.deferred_note.clone(),
        unreachable: outcome.unreachable.as_ref().map(unreachable_note),
    }
}

/// The model-facing sentence for [statements that could not run](UnreachableTail).
///
/// Rendered in Rust rather than in the template for the reason every other count-bearing clause is:
/// a template that has to pluralise is a template that will one day say "1 statements". It names the
/// count, quotes the first statement, and states the rule that made them dead — because the model
/// that produced this shape believed its whole reply ran, and only the quote lets it recognise which
/// half did not.
fn unreachable_note(tail: &UnreachableTail) -> String {
    format!(
        "{} after your top-level `return` did not run — the first is line {}: {}. A top-level \
         `return` ends the program, so nothing written after it executes. Send exactly one program \
         per reply.",
        plural(tail.statements, "statement"),
        tail.line,
        tail.excerpt,
    )
}

/// The model-facing feedback for a program the sandbox could not run to a result.
///
/// Two templates, because the two failures need opposite advice. A **transpile** error means
/// nothing ran and nothing changed — saying so is what stops the model re-checking a workspace it
/// never touched. Everything else means the program *did* run, landed real calls, and hit a
/// ceiling, so the advice is to do less per program rather than to fix a mistake.
///
/// Both carry the [healing note](crate::healing::Healed::notes), which is what happened to the
/// model's **message** rather than to its program. It matters most on the transpile path: the
/// diagnostic is located in the *healed* source's coordinates, so a model told "line 4" without also
/// being told that a wrapper came off the top of its reply cannot reconcile the two.
fn code_failure_feedback(
    error: &SandboxError,
    outcome: &SandboxOutcome,
    healing: Vec<String>,
    delegated: bool,
) -> String {
    let calls = outcome.tool_calls.len() + outcome.tool_calls_suppressed as usize;
    let finish_revoked = outcome.revoked_completion.is_some();
    match error {
        SandboxError::Transpile(transpile) => {
            prompts::render_code_transpile_error(&CodeTranspileErrorContext {
                healing,
                error: transpile.to_string(),
                delegated,
            })
        }
        // A timeout is not "too much work for one program" — the ceiling is far larger than any
        // honest program needs — it is a program that did not terminate. It gets its own message so
        // the advice is to find the runaway loop rather than to write less.
        SandboxError::Timeout { .. } => prompts::render_code_timeout(&CodeTimeoutContext {
            healing,
            error: error.to_string(),
            finish_revoked,
            calls,
        }),
        _ => prompts::render_code_sandbox_error(&CodeSandboxErrorContext {
            healing,
            error: error.to_string(),
            finish_revoked,
            calls,
        }),
    }
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
    /// The epic/issue board, for its state event and for the Code Review gate.
    pub(super) board: &'a BoardRuntime,
    /// The [project-management](crate::board) context, when the capability is on — for the
    /// auto-dispatch pump after a board mutation and for `wait_for_issue`. `None` when off.
    pub(super) project: Option<&'a ProjectContext>,
    /// The memory scratchpad, for its state event.
    pub(super) memories: &'a MemoriesRuntime,
    /// The task list, for its state event.
    pub(super) tasks: &'a TasksRuntime,
    /// The planning capability, whose read-only gate still applies to every composed call.
    pub(super) planning: &'a PlanningRuntime,
    /// The process machine, whose current state still narrows the toolset.
    pub(super) fsm: &'a FsmRuntime,
    /// The [agent-managed-context](apply_context_reclaim) setup, for the reclaim tools.
    pub(super) amc: &'a AmcSetup,
    /// Where this turn's telemetry goes.
    pub(super) emitter: &'a Emitter,
    /// The replay recorder, when the capability is on.
    pub(super) replay: Option<&'a Arc<GgRecorder>>,
    /// Whether an FSM state is actually narrowing the toolset this turn.
    pub(super) fsm_active: bool,
    /// Whether the agent is inside a read-only planning pass.
    pub(super) in_plan_mode: bool,
    /// Whether Code Reviews gate `complete_issue` this run.
    pub(super) code_reviews_active: bool,
    /// Whether `speculate` is routed through the best-of-K routine this run.
    pub(super) speculative_active: bool,
}

impl CodeTurn<'_> {
    /// Whether the agent taking this turn is a **delegated** worker rather than the run's root —
    /// the same question [`SystemContext::delegated`](crate::prompts::SystemContext::delegated)
    /// answers for the system prompt, read from the same place (an agent's depth in the spawn tree).
    ///
    /// Three of the four code feedback templates name what `finish` ends, and they do it *every
    /// turn*, far later in the context than the system prompt that named it first. If the two ever
    /// disagree the later text wins, so both read this one fact: a delegated worker told each turn
    /// that `finish` ends **the run** has the strongest reason available not to call it, and a
    /// worker that never calls it never returns a verdict — which is exactly what leaves a Code
    /// Review unaccepted, a speculation judge without a winner, and a subagent's worktree
    /// discarded.
    pub(super) fn delegated(&self) -> bool {
        self.spawner.depth > 0
            || self
                .project
                .is_some_and(|project| project.assigned_issue.is_some())
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
    /// The per-agent documentation runtime behind `object.list()` / `fn.docs()`.
    pub(super) docs: DocsRuntime,
    /// This agent's delegation context, when the capability is on.
    pub(super) subagents: Option<SubagentContext>,
    /// The board issues this turn's program asked to wait on, in first-requested order (empty when
    /// it requested none, or never ran a program). The loop suspends the agent on each — after the
    /// turn's feedback is recorded — before taking the next turn.
    pub(super) issue_waits: Vec<String>,
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
/// loop behaviour lives now: plan-mode/FSM gating, `ToolCall`/`ToolResult` telemetry, replay
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
/// One thing is deliberately **not** replicated: a `read_file` result is *not* pushed as a
/// [`FileView`](GgContextSource::FileView) context item. A program that reads forty files should not
/// put forty files in the window — consuming reads inside the program instead of the context is one
/// of the reasons responses-as-code exists. The pictures a read produced still reach the model:
/// they ride out on [`SandboxOutcome::images`] and are attached to the turn's feedback.
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
        spawner: turn.spawner.clone(),
        tool_ctx: turn.tool_ctx.clone(),
        read_policy: turn.read_policy,
        board: turn.board.clone(),
        project: turn.project.cloned(),
        memories_rt: turn.memories.clone(),
        tasks_rt: turn.tasks.clone(),
        planning: turn.planning.clone(),
        fsm: turn.fsm.clone(),
        amc: turn.amc.clone(),
        emitter: turn.emitter.clone(),
        replay: turn.replay.cloned(),
        handle: Handle::current(),
        fsm_active: turn.fsm_active,
        in_plan_mode: turn.in_plan_mode,
        code_reviews_active: turn.code_reviews_active,
        speculative_active: turn.speculative_active,
        serviced: 0,
    };

    let sandbox =
        tokio::task::spawn_blocking(move || run_program(&program, &enabled, limits, deadline, api));

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
                images: Vec::new(),
                images_dropped: 0,
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

/// Pin a fresh `fn.docs()` lookup into the context — the documentation counterpart of
/// [`pin_read_skill`].
///
/// Documentation the model asked for is reference material it should keep, so it is pinned
/// (retained verbatim across a compaction boundary) rather than left in the summarizable history —
/// exactly as a read skill is. It is pinned as a standalone `user` message for the same reason a
/// read skill is: a code turn's assistant message carries no native `tool_calls`, so there is no
/// call for a `tool` message to answer.
///
/// It reuses the [`Skill`](GgContextSource::Skill) source rather than adding a context source of its
/// own: a read skill and a fetched doc are the same *kind* of thing — authored reference material
/// the model pulled in on demand and keeps across compaction — so they share the one band. The
/// [`DocsRuntime`] is what guarantees the pin happens at most once per function; this only records
/// the block it was handed.
fn pin_docs(context: &mut ContextModel, text: &str) {
    context.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user(text.to_string()),
    );
}

// ---------------------------------------------------------------------------
// The native `ToolApi`: the loop's own state, servicing each typed call inline
// ---------------------------------------------------------------------------

/// The production [`ToolApi`]: the loop's own state, servicing each typed call exactly as the
/// tool-calling loop services a native one — plan/FSM gating, ToolCall/ToolResult telemetry, replay,
/// agent-managed-context reclaim, skill pinning, board pump + state events — and routing the
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
    // cloned/borrowed-by-value loop state:
    spawner: Agent,
    tool_ctx: ToolContext,
    read_policy: ReadPolicy,
    board: BoardRuntime,
    project: Option<ProjectContext>,
    memories_rt: MemoriesRuntime,
    tasks_rt: TasksRuntime,
    planning: PlanningRuntime,
    fsm: FsmRuntime,
    amc: AmcSetup,
    emitter: Emitter,
    replay: Option<Arc<GgRecorder>>,
    handle: Handle,
    fsm_active: bool,
    in_plan_mode: bool,
    code_reviews_active: bool,
    speculative_active: bool,
    serviced: u64,
}

#[allow(dead_code)]
impl LoopToolApi {
    /// Gate (plan/FSM) then, if allowed, run `exec` (an ordinary typed tool call), then service the
    /// outcome (telemetry, AMC reclaim, replay, board pump, state events, skill pin). Returns the
    /// serviced outcome the membrane maps to a WIT result.
    fn serviced(
        &mut self,
        name: &str,
        args: Value,
        exec: impl FnOnce(&mut Self) -> ToolOutcome,
    ) -> ToolOutcome {
        // The gate is evaluated first, but the `ToolCall` is streamed *before* the call runs either
        // way — a plan/FSM refusal is a serviced call that streams its `ToolCall`/`ToolResult` pair
        // exactly as a call that ran does, so its telemetry order matches the native path's.
        let refused = self.gate(name);
        let call = self.begin(name, args);
        if let Some(refused) = refused {
            return self.complete(call, refused, None);
        }
        let mut outcome = exec(self);
        // Agent-managed context: rewrite the outcome with what the loop actually reclaimed.
        let managed = if self.amc.enabled && outcome.ok && is_context_reclaim_tool(name) {
            apply_context_reclaim(&mut self.context, &self.amc.archive, &call, &mut outcome)
        } else {
            None
        };
        self.complete(call, outcome, managed)
    }

    /// The plan-mode/FSM gate; `Some(refusal_outcome)` when this call is withheld this turn.
    fn gate(&self, name: &str) -> Option<ToolOutcome> {
        if self.planning.offers_planning() && !plan_mode_offers(name, self.in_plan_mode) {
            return Some(ToolOutcome::failed(
                ToolFailure::Refused,
                plan_mode_refusal(name, self.in_plan_mode),
            ));
        }
        if self.fsm_active && !self.fsm.offers(name) {
            return Some(ToolOutcome::failed(
                ToolFailure::Refused,
                fsm_refusal(name, &self.fsm),
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
        managed: Option<GgTelemetryKind>,
    ) -> ToolOutcome {
        self.emitter.emit(GgTelemetryKind::ToolResult {
            name: call.name.clone(),
            ok: outcome.ok,
            summary: outcome.summary.clone(),
        });
        if let Some(event) = managed {
            self.emitter.emit(event);
        }
        if let Some(recorder) = &self.replay {
            recorder.record_tool_result(&self.spawner.id, &call, &outcome);
        }
        if outcome.ok {
            if is_board_tool(&call.name)
                && let Some(project) = &self.project
            {
                project.orch.pump_and_wake(&self.emitter);
            }
            let state = if is_memory_tool(&call.name) {
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
            return self.complete(call, refused, None);
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
        self.complete(call, outcome, None)
    }

    /// Delegation servicing for the two handlers that also need the [board](BoardRuntime) —
    /// [`speculate`](handle_speculate) and the gated [`complete_issue`](handle_code_review) — with an
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
            return self.complete(call, refused, None);
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
        self.complete(call, outcome, None)
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
                     implement. Do the work and call `complete_issue` when it is done."
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
                api.handle
                    .clone()
                    .block_on(run_command(&command, timeout, &api.tool_ctx))
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
                WriteMemoryTool::new(api.memories_rt.store()).write(
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
                UpdateMemoryTool::new(api.memories_rt.store()).update(
                    name.clone(),
                    description.clone(),
                    body.clone(),
                )
            },
        )
    }
    fn delete_memory(&mut self, name: String) -> ToolOutcome {
        self.serviced("delete_memory", json!({ "name": name }), |api| {
            DeleteMemoryTool::new(api.memories_rt.store()).delete(name.clone())
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
    fn create_epic(&mut self, id: String, title: String, description: String) -> ToolOutcome {
        self.serviced(
            "create_epic",
            json!({ "id": id, "title": title, "description": description }),
            |api| {
                CreateEpicTool::new(api.board.store()).create_epic(
                    id.clone(),
                    title.clone(),
                    description.clone(),
                )
            },
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn create_issue(
        &mut self,
        id: String,
        title: String,
        description: Option<String>,
        in_scope: String,
        out_of_scope: String,
        completion_criteria: String,
        blocked_by: Vec<String>,
        epic_id: Option<String>,
    ) -> ToolOutcome {
        self.serviced(
            "create_issue",
            json!({ "id": id, "title": title, "description": description, "inScope": in_scope, "outOfScope": out_of_scope, "completionCriteria": completion_criteria, "blockedBy": blocked_by, "epicId": epic_id }),
            |api| {
                CreateIssueTool::new(api.board.store()).create_issue(
                    id.clone(),
                    title.clone(),
                    description.clone(),
                    in_scope.clone(),
                    out_of_scope.clone(),
                    completion_criteria.clone(),
                    blocked_by.clone(),
                    epic_id.clone(),
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
    fn complete_issue(&mut self, id: String) -> ToolOutcome {
        // Code-review-gated? route to the reviewer; else the plain typed completion.
        if self.code_reviews_active && self.board.offers_board() && self.subagents.is_some() {
            return self.delegated_board(
                COMPLETE_ISSUE_TOOL,
                json!({ "id": id }),
                |h, sub, spawner, board, emitter, call| {
                    h.clone()
                        .block_on(handle_code_review(sub, spawner, board, emitter, call))
                },
            );
        }
        self.serviced(COMPLETE_ISSUE_TOOL, json!({ "id": id }), |api| {
            CompleteIssueTool::new(api.board.store()).complete_issue(id.clone())
        })
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
    fn archive_thread(&mut self, keep_recent_turns: Option<u32>) -> ToolOutcome {
        let keep = keep_recent_turns
            .map(|k| k as usize)
            .unwrap_or(DEFAULT_ARCHIVE_KEEP_RECENT);
        self.serviced(
            "archive_thread",
            json!({ "keep_recent_turns": keep_recent_turns }),
            move |_api| ArchiveThreadTool.archive(keep),
        )
    }
    fn search_archive(&mut self, query: String) -> ToolOutcome {
        self.serviced("search_archive", json!({ "query": query }), |api| {
            SearchArchiveTool::new(api.amc.archive.clone()).search(query.clone())
        })
    }
    fn spawn_subagent(
        &mut self,
        agent: String,
        prompt: Option<String>,
        issue_id: Option<String>,
        worktree: bool,
    ) -> ToolOutcome {
        let args =
            json!({ "agent": agent, "prompt": prompt, "issueId": issue_id, "worktree": worktree });
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
                json!({ "name": s.name, "prompt": s.prompt, "items": s.items, "agent": s.agent, "worktree": s.worktree })
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
    fn read_docs(&mut self, name: &str) -> Option<String> {
        self.docs.read(name).map(|read| {
            if read.fresh {
                pin_docs(&mut self.context, &read.text);
            }
            read.text
        })
    }
}
