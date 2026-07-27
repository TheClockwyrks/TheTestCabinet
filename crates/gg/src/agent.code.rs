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

/// Run one responses-as-code turn: heal the reply into a program, run it, and report what the loop
/// must do next.
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
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_code_turn(
    reply: &str,
    had_tool_calls: bool,
    code: &CodeSetup,
    deadline: Option<Instant>,
    turn: &CodeTurn<'_>,
    context: &mut ContextModel,
    skills: &mut SkillsRuntime,
    docs: &mut DocsRuntime,
    subagents: &mut Option<SubagentContext>,
) -> CodeTurnOutcome {
    let emitter = turn.emitter;
    let healed = healing::heal(reply, had_tool_calls, &code.healing);
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

    // A reply that never became a program short-circuits here: no component, no store, no fuel.
    // Nothing under `sandbox/` is entered at all.
    if let HealingVerdict::NotAProgram(reason) = healed.verdict {
        return not_a_program(turn, &healed, reason);
    }

    let outcome = run_code_program(
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
        return not_a_program(turn, &healed, NotAProgramReason::Prose);
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
        fuel_used: Some(outcome.fuel_consumed),
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
        return CodeTurnOutcome::Finished {
            summary: completion.summary,
        };
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
    match &outcome.result {
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
    }
}

/// The turn a reply that was **not a program** earns: its own `CodeExecution`, the fourth feedback
/// template, and the error kind that keeps a prose loop from running forever.
///
/// Shared by healing's own verdict and the loop's post-transpile reclassification because the two
/// arrive at the same fact by different routes and the model must be told the same thing either
/// way. `fuel_used` is **absent** rather than zero: a turn that ran nothing has no fuel figure to
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
        fuel_used: None,
        error: Some(reason.short()),
        finished: None,
        // Absent for the same reason `fuel_used` is: nothing about this turn touched the sandbox,
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
    match error {
        SandboxError::Transpile(transpile) => {
            prompts::render_code_transpile_error(&CodeTranspileErrorContext {
                healing,
                error: transpile.to_string(),
                delegated,
            })
        }
        _ => prompts::render_code_sandbox_error(&CodeSandboxErrorContext {
            healing,
            error: error.to_string(),
            finish_revoked: outcome.revoked_completion.is_some(),
            calls: outcome.tool_calls.len() + outcome.tool_calls_suppressed as usize,
            // Only fuel exhaustion is a budgeting problem; a memory cap or a trap is not, and would
            // be misdiagnosed by advice about how much the program wrote.
            output_heavy: matches!(error, SandboxError::OutOfFuel { .. }),
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

/// One tool call a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program made, sent from the
/// (blocking) sandbox thread to the async loop to be serviced. Carrying a [oneshot](oneshot::Sender)
/// reply lets the synchronous [`ToolInvoker`] seam block for the loop's async dispatch without
/// stalling an async worker.
struct CodeToolRequest {
    /// The tool the program called.
    name: String,
    /// The arguments the [membrane](crate::sandbox) lowered its typed call into, under the key
    /// names the tool's own schema declares.
    args: Value,
    /// Where the serviced outcome is delivered back to the blocked sandbox thread.
    reply: oneshot::Sender<ToolOutcome>,
}

/// Everything a code program asks the loop to service, sent from the (blocking) sandbox thread to
/// the async loop. Most are tool calls; the other two are the [documentation carve-out](crate::docs)
/// — `object.list()` and `fn.docs()` — which are not tools (no capability offers them) but still
/// need the loop, because only it holds the run's enabled set and the agent's context.
enum CodeRequest {
    /// A tool call to dispatch, gated and recorded exactly as a native one.
    Tool(CodeToolRequest),
    /// `object.list()`: the directory of one API object's bound functions.
    ListFunctions {
        /// The API object whose directory is wanted (`fs`, `project`, …).
        object: String,
        /// Where the directory is delivered back to the blocked sandbox thread.
        reply: oneshot::Sender<Vec<FunctionSummary>>,
    },
    /// `fn.docs()` / `harness.readDocs(fn)`: one function's full documentation, pinned into context.
    ReadDocs {
        /// The function name whose docs are wanted (`readFile`, `finish`).
        name: String,
        /// The documentation text, or `None` for a name this run did not bind.
        reply: oneshot::Sender<Option<String>>,
    },
}

/// The [`ToolInvoker`] the loop bridges a code program's tool calls through: it forwards each
/// `(name, args)` to the async loop over a channel and blocks (on its own blocking thread) for the
/// serviced [`ToolOutcome`].
///
/// Routing through the loop — rather than dispatching straight to the registry — is what lets a
/// program's **delegation** tool still go through the [scheduler](Scheduler) and its calls still
/// respect plan-mode read-only and FSM state gating: the loop services each request exactly as it
/// would an ordinary tool call, streaming the same telemetry and recording the same replay entry.
/// The two documentation calls ride the same channel so they, too, reach the agent's live context.
struct ChannelInvoker {
    /// The channel each request is forwarded to the loop on.
    tx: mpsc::UnboundedSender<CodeRequest>,
}

impl ToolInvoker for ChannelInvoker {
    fn invoke(&mut self, name: &str, args: Value) -> ToolOutcome {
        let (reply_tx, reply_rx) = oneshot::channel();
        // Both degradation paths mean the bridge itself broke, which is an I/O-class failure of
        // gg's own plumbing rather than anything the tool or the program did — classified so the
        // program is thrown a typed `io-error` it can tell apart from a real tool failure.
        if self
            .tx
            .send(CodeRequest::Tool(CodeToolRequest {
                name: name.to_string(),
                args,
                reply: reply_tx,
            }))
            .is_err()
        {
            return ToolOutcome::failed(
                ToolFailure::IoError,
                "the code sandbox lost its bridge to gg's tools before the call could run.",
            );
        }
        // The invoker runs on a `spawn_blocking` thread, so a blocking wait here never stalls an
        // async worker; the loop services the request and replies.
        reply_rx.blocking_recv().unwrap_or_else(|_| {
            ToolOutcome::failed(
                ToolFailure::IoError,
                "the code sandbox's tool bridge was dropped before the call returned.",
            )
        })
    }

    fn list_functions(&mut self, object: &str) -> Vec<FunctionSummary> {
        let (reply_tx, reply_rx) = oneshot::channel();
        // A broken bridge yields an empty directory rather than an error: `object.list()` is a
        // discovery aid, and an empty list is a truthful (if unhelpful) answer to it.
        if self
            .tx
            .send(CodeRequest::ListFunctions {
                object: object.to_string(),
                reply: reply_tx,
            })
            .is_err()
        {
            return Vec::new();
        }
        reply_rx.blocking_recv().unwrap_or_default()
    }

    fn read_docs(&mut self, name: &str) -> Option<String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        // A broken bridge yields `None`, which the membrane renders as `not-found` — the same
        // failure the program would see for a name that does not exist.
        if self
            .tx
            .send(CodeRequest::ReadDocs {
                name: name.to_string(),
                reply: reply_tx,
            })
            .is_err()
        {
            return None;
        }
        reply_rx.blocking_recv().ok().flatten()
    }
}

/// Run a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program in the wasmtime sandbox,
/// servicing every tool call it makes on the async loop, and return everything the program produced.
///
/// The sandbox is synchronous and CPU-bound, so it runs on a
/// [`spawn_blocking`](tokio::task::spawn_blocking) thread (the same offload the Foray/Lattice
/// validators use). `spawn_blocking` is not an optimisation here but a requirement: the invoker
/// blocks on `blocking_recv`, and blocking an async worker would deadlock the servicing loop below.
///
/// Every call the program composes is forwarded over a channel and serviced **here**, on the loop,
/// so it is gated, routed, streamed and recorded exactly as an ordinary tool-calling turn's call is:
///
/// * a [delegation tool](is_subagent_tool) still goes through the [scheduler](Scheduler), and
///   plan-mode/FSM gating still applies ([`dispatch_code_tool_call`]);
/// * each call streams its own [`ToolCall`](GgTelemetryKind::ToolCall) /
///   [`ToolResult`](GgTelemetryKind::ToolResult) pair and is pinned for [replay](GgRecorder);
/// * a successful memory/task/board mutation re-emits its knowledge-state event;
/// * an [agent-managed-context](apply_context_reclaim) reclaim is performed against the live
///   window and the outcome rewritten with what it really freed, so `evictFileView` returns the
///   truth to the program instead of a placeholder;
/// * a **fresh** `read_skill` pins the skill body into the context and emits the updated
///   [`SkillsState`](GgTelemetryKind::SkillsState), exactly as [`record_tool_result`] does.
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
    context: &mut ContextModel,
    skills: &mut SkillsRuntime,
    docs: &mut DocsRuntime,
    subagents: &mut Option<SubagentContext>,
) -> SandboxOutcome {
    let emitter = turn.emitter;
    let (tx, mut rx) = mpsc::unbounded_channel::<CodeRequest>();
    let program = source.to_string();
    // The tools bound into the program's scope: the run's offered toolset minus the turn-level
    // transitions. Derived from the same registry the system prompt was rendered from, so the
    // functions in scope and the signatures the model was shown are the same set.
    let enabled = scope_tools(turn.registry);
    let mut sandbox = tokio::task::spawn_blocking(move || {
        run_program(
            &program,
            &enabled,
            limits,
            deadline,
            Box::new(ChannelInvoker { tx }),
        )
    });

    // How many calls the loop itself serviced. Kept only for the panic path below, where the
    // sandbox's own roster died with its store and this is all that is left of what happened.
    let mut serviced: u64 = 0;
    // Drive the sandbox to completion, servicing each tool call it makes on this (async) thread.
    // When the sandbox finishes it drops its sender, so `rx.recv()` yields `None` — at which point
    // the blocking task is joined for its result.
    let joined: Result<SandboxOutcome, tokio::task::JoinError> = loop {
        let request = tokio::select! {
            request = rx.recv() => request,
            joined = &mut sandbox => break joined,
        };
        match request {
            Some(CodeRequest::Tool(request)) => {
                // The synthetic call id is ordinal-keyed so it is unique **within a turn**: a
                // program that calls one tool twice would otherwise produce two records under one
                // id, which is wrong for anything keyed by it (the replay driver, most of all).
                let call = ToolCall {
                    id: format!("{PROGRAM_CALL_ID_PREFIX}{serviced}:{}", request.name),
                    name: request.name.clone(),
                    arguments: request.args.clone(),
                };
                serviced += 1;
                emitter.emit(GgTelemetryKind::ToolCall {
                    name: call.name.clone(),
                    args: call.arguments.clone(),
                });
                let mut outcome = dispatch_code_tool_call(&call, turn, subagents).await;

                // Agent-managed context: `evict_file_view`/`archive_thread` act on the live window,
                // which the tools cannot hold — so the loop performs the reclaim here and rewrites
                // the outcome (its prose *and* its `ToolData::Reclaim` sidecar) with what was
                // actually freed. That rewritten outcome is what crosses back into the program, so
                // its `ReclaimReport` reports what really happened rather than a placeholder.
                let managed_event =
                    if turn.amc.enabled && outcome.ok && is_context_reclaim_tool(&call.name) {
                        apply_context_reclaim(context, &turn.amc.archive, &call, &mut outcome)
                    } else {
                        None
                    };

                emitter.emit(GgTelemetryKind::ToolResult {
                    name: call.name.clone(),
                    ok: outcome.ok,
                    summary: outcome.summary.clone(),
                });
                if let Some(event) = managed_event {
                    emitter.emit(event);
                }
                // Replay capture: the code-program counterpart of the loop's tool-result seam — a
                // program-composed (host-bridged) call is pinned here, tagged with the program's
                // spawner, after any reclaim rewrote its outcome and before it is sent back into
                // the sandbox.
                if let Some(recorder) = turn.replay {
                    recorder.record_tool_result(&turn.spawner.id, &call, &outcome);
                }
                // A successful memory/task/board mutation changed the shared store; re-emit its
                // state event so the console (and the summary tracker) track the live state,
                // mirroring the tool-calling path — the pinned block itself is refreshed at the next
                // turn boundary.
                if outcome.ok {
                    // Project management: pump auto-dispatch + wake issue-waiters before re-emitting
                    // the board, so the snapshot reflects the resulting assignments (mirrors the
                    // tool-calling loop).
                    if is_board_tool(&call.name)
                        && let Some(project) = turn.project
                    {
                        project.orch.pump_and_wake(emitter);
                    }
                    let state = if is_memory_tool(&call.name) {
                        turn.memories.state_event()
                    } else if is_task_tool(&call.name) {
                        turn.tasks.state_event()
                    } else if is_board_tool(&call.name) {
                        turn.board.state_event()
                    } else {
                        None
                    };
                    if let Some(state) = state {
                        emitter.emit(state);
                    }
                }
                // A **fresh** skill read pins the skill body into the context (retained across
                // compaction) and emits the updated skills state, exactly as the native path does.
                // A repeat read needs nothing: the body is already pinned, and the program was
                // handed the text either way.
                pin_read_skill(context, skills, &call, &outcome, emitter);

                let _ = request.reply.send(outcome);
            }
            // `object.list()`: a directory of one object's functions. No dispatch, no telemetry, no
            // roster entry — it is discovery, not a tool call — so it is answered straight from the
            // docs runtime, which knows the run's enabled set.
            Some(CodeRequest::ListFunctions { object, reply }) => {
                let _ = reply.send(docs.list(&object));
            }
            // `fn.docs()` / `harness.readDocs(fn)`: one function's documentation. A fresh lookup is
            // pinned into context (retained across compaction) exactly as a read skill is, so the
            // model keeps it across turns; a repeat lookup hands the text back and pins nothing.
            Some(CodeRequest::ReadDocs { name, reply }) => {
                let text = docs.read(&name).map(|read| {
                    if read.fresh {
                        pin_docs(context, &read.text);
                    }
                    read.text
                });
                let _ = reply.send(text);
            }
            None => break (&mut sandbox).await,
        }
    };

    joined.unwrap_or_else(|join| {
        // A panic inside the sandbox is a failure of gg's own plumbing, and it is classified as one
        // rather than as a guest trap: the store — and with it the roster, the logs, the pictures
        // and the fuel reading — died with the blocking task, so what the loop still knows is that
        // `serviced` calls really happened and really streamed their telemetry. That is exactly what
        // `tool_calls_suppressed` means: calls the turn made that the roster does not describe, so
        // the `CodeExecution` count still agrees with the number of `ToolCall`/`ToolResult` pairs
        // the turn emitted. Laundering this as a trap would charge gg's defect to the model's error
        // budget and answer it with advice about writing smaller programs.
        SandboxOutcome {
            tool_calls: Vec::new(),
            tool_calls_suppressed: serviced,
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
            fuel_consumed: 0,
            // Both are observations the sandbox makes on its way through, and the task that would
            // have made them died — so neither is known, and neither is invented.
            unreachable: None,
            compile_wait: None,
            result: Err(SandboxError::Host(format!(
                "the code sandbox task did not complete: {join}"
            ))),
        }
    })
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

/// Service one tool call a code program made — the code-mode counterpart of the tool-calling loop's
/// per-call dispatch, so the two paths gate and route identically.
///
/// The call is gated by the same predicates as a native call — refused (surfacing into the program
/// as a typed `refused` throw) when plan mode withholds it or the current FSM state does not offer
/// it — and routed the same way: a [delegation tool](is_subagent_tool) through the
/// [scheduler](handle_subagent_call), a [`speculate`](handle_speculate) or gated
/// [`complete_issue`](handle_code_review) through their routines, everything else through ordinary
/// [registry dispatch](ToolRegistry::dispatch).
///
/// The turn-level transitions (`advance_state`, `enter_plan_mode`, `submit_plan`) are **not**
/// handled here at all. They change the loop's mode rather than producing a value, so the sandbox
/// never binds them into a program's scope and the [membrane](crate::sandbox) refuses them — telling
/// the model to do the work directly, because a code-mode run has no turn that is not a program —
/// before a call can ever reach this seam. A refusal stated where the name is withheld is a refusal
/// that cannot go stale.
async fn dispatch_code_tool_call(
    call: &ToolCall,
    turn: &CodeTurn<'_>,
    subagents: &mut Option<SubagentContext>,
) -> ToolOutcome {
    if turn.planning.offers_planning() && !plan_mode_offers(&call.name, turn.in_plan_mode) {
        return ToolOutcome::failed(
            ToolFailure::Refused,
            plan_mode_refusal(&call.name, turn.in_plan_mode),
        );
    }
    if turn.fsm_active && !turn.fsm.offers(&call.name) {
        return ToolOutcome::failed(ToolFailure::Refused, fsm_refusal(&call.name, turn.fsm));
    }
    // `wait_for_issue` is not bound in the responses-as-code guest (see
    // `signatures::NON_SANDBOX_TOOLS`) — a composed program has no good shape for a blocking wait —
    // so no interception for it is needed here; a program creates issues and lets gg auto-dispatch.
    if let Some(sub) = subagents.as_mut() {
        if is_subagent_tool(&call.name) {
            return handle_subagent_call(sub, turn.spawner, turn.emitter, call).await;
        }
        if turn.speculative_active && call.name == SPECULATE_TOOL {
            return handle_speculate(sub, turn.spawner, turn.board, turn.emitter, call).await;
        }
        if turn.code_reviews_active && call.name == COMPLETE_ISSUE_TOOL && turn.board.offers_board()
        {
            return handle_code_review(sub, turn.spawner, turn.board, turn.emitter, call).await;
        }
    }
    turn.registry.dispatch(call, turn.tool_ctx).await
}
