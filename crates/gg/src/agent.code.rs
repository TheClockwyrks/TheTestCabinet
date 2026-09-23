//! The **responses-as-code** half of the agent loop: turning one model reply into a program, running
//! it in the [wasmtime sandbox](crate::sandbox), servicing every tool call that program composes,
//! and telling the loop what to do next.
//!
//! It is a module of [`agent`](super) rather than a file of it because it is one self-contained
//! concern — execution, servicing, feedback — whose only couplings to the turn loop are the
//! [`CodeTurn`] it is handed and the [`CodeTurnOutcome`] it hands back. Splitting it out — under
//! the repo's `foo.<concern>.rs` convention, `agent.rs` already being the largest file in the
//! crate — keeps `agent.rs` about the turn loop and this file about what a *program turn* is. Its
//! items are `use`d back into [`agent`](super), so the loop calls them unqualified exactly as it
//! did when they lived there.
//!
//! # Two questions this file does not answer
//!
//! **What counts as a program** is the [`submit_program`](crate::completion::SUBMIT_PROGRAM_TOOL)
//! tool call's question — the call's `program` string is the program, exactly as sent — and
//! **what counts as finished** is an [ending call](crate::ending)'s. Neither is decided here, and
//! neither has a second, quieter answer hiding in this module: there is no shape of reply this
//! file reads as a conclusion, no ending it invents, and no analysis that extracts code from the
//! model's prose.
//!
//! # What lives here
//!
//! * [`run_code_turn`] — one whole turn: every program the reply submitted, run in order, down to
//!   the [decision](CodeTurnOutcome) the loop acts on. Every effect a code turn has on the world
//!   happens inside it.
//! * [`run_code_program`] — the `spawn_blocking` offload plus the servicing loop, which is where
//!   every must-survive loop behaviour (gating, scheduler routing, telemetry, session capture,
//!   knowledge-state re-emission, context reclaim, skill pinning) is preserved for a composed call.
//! * [`LoopOperationApi`] — the production [`OperationApi`], holding the loop's own state and servicing each
//!   typed call the guest makes inline, so a composed call and a native tool call gate and route
//!   identically.
//! * The feedback builders, which turn what happened into the compiler diagnostic, runtime fault or
//!   notice the turn earned.
//!
//! Everything the seam only reads is grouped into [`CodeTurn`]; what it mutates — the context
//! window, the skills runtime, the subagent context — stays an explicit `&mut` parameter, which is
//! what lets the borrow checker prove the window is never mutated down two paths at once.

use super::*;

use std::time::Duration;

use tokio::runtime::Handle;

use test_cabinet_core::gg_session_record::GgShellOrigin;

use crate::board::BOARD_MUTATIONS;
use crate::context::{
    DocviewOpen, EvictionResult, SEARCH_RESULTS_VIEW, ShownLines, ViewKind, ViewsClosed,
};
use crate::docs::{DocKind, DocQuery, DocSearch};
use crate::ending::Ending;
use crate::knowledge::{KnowledgeError, KnowledgeModules, KnowledgeOrigin, PendingOnUse};
use crate::memories::MEMORY_MUTATIONS;
use crate::memories::MemoryCode;
use crate::programs::{ProgramLibrary, ProgramRefusal, ProgramSummary};
use crate::sandbox::{
    ApiIdentity, BOARD_CREATE_EPIC, BOARD_CREATE_ISSUE, BOARD_REMOVE_EPIC, BOARD_REMOVE_ISSUE,
    BOARD_SET_ISSUE_BLOCKED_BY, BOARD_UPDATE_ISSUE, BOARD_WAIT_FOR_ISSUE, CONTEXT_ARCHIVE_THREAD,
    CONTEXT_COMPACT, CONTEXT_EVICT_FILE_VIEW, CONTEXT_SEARCH_ARCHIVE, DELEGATION_EXEC,
    DELEGATION_FORK, DELEGATION_SEND_MESSAGE, DELEGATION_SPAWN_SUBAGENT,
    DELEGATION_TRANSITION_STATE, DELEGATION_WAIT_FOR_SUBAGENTS, DocSearchQuery, DocSearchResult,
    FILES_EDIT_FILE, FILES_LIST_DIR, FILES_READ_FILE, FILES_SEARCH, FILES_TREE, FILES_WRITE_FILE,
    MEMORIES_CREATE_MEMORY, MEMORIES_DELETE_MEMORY, MEMORIES_EDIT_MEMORY, MEMORIES_READ_MEMORY,
    MEMORIES_SEARCH_MEMORIES, MEMORIES_UPDATE_MEMORY, MEMORIES_WRITE_MEMORY, OperationApi,
    OperationId, PreparedProgram, ProgramError, ProgramLanguage, ProgramScope, RunEnding,
    SHELL_SHELL, SKILLS_READ_SKILL, SandboxViewOpened, TASKS_ADD_TASK, TASKS_COMPLETE_TASK,
    TASKS_REMOVE_TASK, TASKS_SET_BLOCKED_BY, TASKS_UPDATE_TASK, ViewOpenOutcome, ViewRefusal,
    run_prepared_program, spell,
};
use crate::tasks::TaskStatus;
use crate::tools::{
    AddTaskTool, ArchiveThreadTool, CompactTool, CompleteTaskTool, CreateEpicTool, CreateIssueTool,
    CreateMemoryTool, DeleteMemoryTool, EditFileTool, EditMemoryTool, EvictFileViewTool,
    ListDirTool, OffloadPolicy, OwnedStructured, ReadMemoryTool, ReadSkillTool, RemoveEpicTool,
    RemoveIssueTool, RemoveTaskTool, SearchArchiveTool, SearchMemoriesTool, SearchTool,
    SetBlockedByTool, SetIssueBlockedByTool, TreeTool, UpdateIssueTool, UpdateMemoryTool,
    UpdateTaskTool, WriteFileTool, WriteMemoryTool, clip_line, read_only_refusal, run_command,
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
        /// Why this turn was an error — the **specific** [type](TurnErrorType), whose base kind is
        /// derived from it — or `None` for a turn that carried out its declared work.
        error: Option<TurnErrorType>,
        /// One line describing what this turn produced, in gg's own words.
        ///
        /// It is what an agent **stopped** before it could `finish` returns to its spawner. Under
        /// this protocol every assistant message is a program, so the loop's `last_text`
        /// would hand a spawner a page of source instead of an answer; this is the answer.
        report: String,
    },
    /// gg's own machinery failed. Not a fault in anything the model wrote, and unreachable in a
    /// released build — CI compiles and instantiates the embedded artifact — so the loop ends the
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
/// `console.log` does not reach the model (it reaches the run's operator), and a
/// [view](crate::context::ViewKind) is the only channel material has into the window. A band called
/// `Output` on a protocol where a program produces no output the model can read would be a heading
/// over an empty idea.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CodeFeedback {
    /// Which of the three bands this message belongs to.
    pub(super) source: GgContextSource,
    /// The message body, unheaded — [`ContextModel`] prefixes the heading when it is pushed.
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
                error: Some(error), ..
            } => TurnOutcome::Error(*error),
            Self::Fatal { fault, .. } => TurnOutcome::Fatal(*fault),
        }
    }
}

// ---------------------------------------------------------------------------
// One code turn
// ---------------------------------------------------------------------------

/// One `submit_program` call as the loop hands it to [`run_code_turn`]: the provider-assigned id
/// whose tool result the loop already pushed, and the `program` string the call carried — or why
/// it carried none.
pub(super) struct SubmittedProgram {
    /// The tool call's id — for the operator's stream alone, since the call's tool result was
    /// already pushed by the loop and nothing here answers it.
    pub(super) call_id: String,
    /// The program to run, or (`Err`) the sentence the call's tool result already delivered about
    /// why nothing will run for it.
    pub(super) program: Result<String, String>,
    /// What the [library](crate::programs) issued this submission when it was acknowledged. Set by
    /// the loop at the acknowledgement, after [`submitted_program`] has read the call — a call
    /// that carried no program is issued nothing.
    pub(super) receipt: ProgramReceipt,
}

/// What the [program library](crate::programs) handed a submission at its acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ProgramReceipt {
    /// No id: the agent keeps no library, or the call carried no program to issue one to. The
    /// acknowledgement was the fixed word, and nothing is recorded for the submission.
    Unkept,
    /// The id the acknowledgement carried, under which the submission's program is recorded.
    Id(String),
    /// The library could not mint an id. The turn is fatal before the submission runs — gg's own
    /// defect, never charged to the model — and the sentence is the operator's.
    Exhausted(String),
}

impl ProgramReceipt {
    /// The id under which this submission's program is recorded, if the library issued one.
    fn id(&self) -> Option<&str> {
        match self {
            Self::Id(id) => Some(id.as_str()),
            Self::Unkept | Self::Exhausted(_) => None,
        }
    }
}

/// Read one `submit_program` call's `program` argument.
///
/// `Err` names the defect in the words the call's own tool result carries: the `program` key was
/// absent, or its value was not a string. Nothing is repaired — a call that did not carry a
/// program runs nothing, and the model reads exactly why.
pub(super) fn submitted_program(call: &ToolCall) -> SubmittedProgram {
    let program = match call.arguments.get("program") {
        Some(serde_json::Value::String(program)) => Ok(program.clone()),
        Some(_) => Err(format!(
            "The `{}` call's `program` argument must be a string; nothing ran.",
            completion::SUBMIT_PROGRAM_TOOL
        )),
        None => Err(format!(
            "The `{}` call carried no `program` string; nothing ran.",
            completion::SUBMIT_PROGRAM_TOOL
        )),
    };
    SubmittedProgram {
        call_id: call.id.clone(),
        program,
        receipt: ProgramReceipt::Unkept,
    }
}

/// Run one responses-as-code turn — every program its reply submitted, in submission order — and
/// report what the loop must do next.
///
/// Every effect the turn has on the world happens inside this function — the sandbox runs, the
/// servicing of each composed call, the telemetry, the session capture. What comes back is only
/// the decision, and the [outcome](CodeTurnOutcome::turn_outcome) the run's ceilings count.
///
/// # Several programs, one turn
///
/// A reply may carry several `submit_program` calls. Each runs **sequentially, in order**, against
/// the same live window — and **all of them run** whether or not an earlier one failed: each was
/// submitted before any ran, so skipping one would silently discard work the model committed to.
/// Two things are folded rather than repeated:
///
/// * **at most one error is counted.** The run's ceilings see one outcome per model call, so a
///   turn with one failing program of three is exactly the error a turn with three of three is;
///   the type recorded is the **first** failure's.
/// * the per-turn state each program hands back threads into the next, and the declarations the
///   programs defer to the loop merge on each field's own rule — issue waits and forks
///   accumulate, the **last** compaction stands (the rule within one program), and the **first**
///   handoff stands.
///
/// A program that **ends the session** stops the sequence: the ending is the turn's outcome, and
/// programs submitted after it are not run — said on the operator's stream, because nothing can
/// reach a model whose session is over. A [fatal](CodeTurnOutcome::Fatal) fault stops it too: gg
/// is broken, and every further program would fail identically.
///
/// A submission that carried no program (see [`submitted_program`]) runs nothing and counts as the
/// turn's one error on the same folding rule; its tool result already told the model why.
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_code_turn(
    submissions: Vec<SubmittedProgram>,
    code: &CodeSetup,
    deadline: Option<Instant>,
    turn: &CodeTurn<'_>,
    context: ContextModel,
    skills: SkillsRuntime,
    docs: DocsRuntime,
    programs: ProgramLibrary,
    knowledge: KnowledgeModules,
    subagents: Option<SubagentContext>,
) -> (CodeTurnOutcome, Option<CodeTurnState>) {
    debug_assert!(
        !submissions.is_empty(),
        "a reply with no submission is the loop's to answer, not a code turn"
    );
    let emitter = turn.emitter;
    let total = submissions.len();
    if total > 1 {
        emitter.emit(log(
            "info",
            format!(
                "the reply submitted {}; they run sequentially, in submission order.",
                plural(total, "program")
            ),
        ));
    }
    let mut state = CodeTurnState {
        context,
        skills,
        docs,
        programs,
        knowledge,
        subagents,
        issue_waits: Vec::new(),
        compact_requested: None,
        handoff_requested: None,
        forks_requested: Vec::new(),
        compaction_calls: (0, 0),
    };
    let mut feedback_all: Vec<CodeFeedback> = Vec::new();
    if total > 1 {
        // The one fact a model reading several errors cannot recover from the errors themselves:
        // which program each belongs to. The errors stay unwrapped — see [`CodeFeedback`] — so the
        // order is stated once, up front.
        feedback_all.push(CodeFeedback::notice(format!(
            "This turn submitted {}; they ran in order, and any error messages below follow that \
             order.",
            plural(total, "program")
        )));
    }
    let mut first_error: Option<TurnErrorType> = None;
    let mut last_report = String::new();
    for (index, submission) in submissions.into_iter().enumerate() {
        // The library could not mint this submission an id, which is gg's defect: the session ends
        // here, as it does on a host fault, and the program is not run. Checked before the source is
        // read, because a submission without an id has nowhere to be recorded and a program run
        // under no id is exactly the silent fallback the bound forbids.
        if let ProgramReceipt::Exhausted(message) = submission.receipt {
            return (
                CodeTurnOutcome::Fatal {
                    fault: crate::limits::FatalFault::HostFault,
                    message,
                },
                Some(state),
            );
        }
        let source = match submission.program {
            Ok(source) => source,
            Err(_) => {
                // The refusal already went out as the call's own tool result; what is left is the
                // accounting — the turn's (single, folded) error — and the operator's line.
                emitter.emit(log(
                    "warn",
                    format!(
                        "`{}` call `{}` carried no program; nothing ran for it.",
                        completion::SUBMIT_PROGRAM_TOOL,
                        submission.call_id
                    ),
                ));
                if first_error.is_none() {
                    first_error = Some(TurnErrorType::MissingCompletionNoProgram);
                }
                if last_report.is_empty() {
                    last_report = "its submit_program call carried no program".to_string();
                }
                continue;
            }
        };
        let (decision, one_state) = run_one_program(
            &source,
            submission.receipt.id(),
            code,
            deadline,
            turn,
            state,
        )
        .await;
        match decision {
            CodeTurnOutcome::Finished { ending } => {
                let skipped = total - index - 1;
                if skipped > 0 {
                    emitter.emit(log(
                        "warn",
                        format!(
                            "the program ended the session; {} submitted after it {} not run.",
                            plural(skipped, "program"),
                            if skipped == 1 { "was" } else { "were" }
                        ),
                    ));
                }
                return (CodeTurnOutcome::Finished { ending }, one_state);
            }
            CodeTurnOutcome::Fatal { fault, message } => {
                return (CodeTurnOutcome::Fatal { fault, message }, one_state);
            }
            CodeTurnOutcome::Continue {
                feedback,
                error,
                report,
            } => {
                feedback_all.extend(feedback);
                if first_error.is_none() {
                    first_error = error;
                }
                last_report = report;
            }
        }
        state = one_state.expect("a non-fatal program hands back its per-turn state");
    }
    (
        CodeTurnOutcome::Continue {
            feedback: feedback_all,
            error: first_error,
            report: last_report,
        },
        Some(state),
    )
}

/// Run **one** submitted program: the sandbox run, the servicing of each composed call, the
/// telemetry, the session capture — and the decision it earns, exactly as a single-program turn
/// always took it.
///
/// `carried` is the per-turn state as the previous program in this turn's sequence left it (or as
/// the loop handed it over, for the first); the state handed back has this program's own deferred
/// declarations merged in on the rules [`run_code_turn`] states.
///
/// Classification and feedback are decided at the *same* match, rather than by a separate
/// classifier the feedback then re-derives: the two decisions read the same facts, and splitting
/// them is how they drift.
async fn run_one_program(
    source: &str,
    id: Option<&str>,
    code: &CodeSetup,
    deadline: Option<Instant>,
    turn: &CodeTurn<'_>,
    carried: CodeTurnState,
) -> (CodeTurnOutcome, Option<CodeTurnState>) {
    let emitter = turn.emitter;
    let CodeTurnState {
        context,
        skills,
        docs,
        programs,
        knowledge,
        subagents,
        issue_waits: carried_waits,
        compact_requested: carried_compact,
        handoff_requested: carried_handoff,
        forks_requested: carried_forks,
        compaction_calls: carried_calls,
    } = carried;
    let (outcome, chain, state) = run_code_program(
        source,
        crate::sandbox::language(code.language),
        code.limits,
        deadline,
        turn,
        context,
        skills,
        docs,
        programs,
        knowledge,
        subagents,
    )
    .await;

    // Fold the deferred work the programs before this one declared into what this one hands back —
    // each field on its own rule: waits and forks accumulate, the last compaction stands, the
    // first handoff stands, and the compaction-call tallies sum.
    let mut state = state.map(|mut fresh| {
        let mut waits = carried_waits;
        waits.append(&mut fresh.issue_waits);
        fresh.issue_waits = waits;
        fresh.compact_requested = fresh.compact_requested.take().or(carried_compact);
        fresh.handoff_requested = carried_handoff.or(fresh.handoff_requested.take());
        let mut forks = carried_forks;
        forks.append(&mut fresh.forks_requested);
        fresh.forks_requested = forks;
        fresh.compaction_calls = (
            carried_calls.0.saturating_add(fresh.compaction_calls.0),
            carried_calls.1.saturating_add(fresh.compaction_calls.1),
        );
        fresh
    });

    // Keep what ran, so a later turn can fetch it back and patch it instead of writing it again.
    // Recorded once per submission, under the id its acknowledgement carried, against the source the
    // chain actually **executed** — so a `rerun` chain keeps the submission's id and a fetch of it
    // returns a program rather than the lines that handed one over. A submission with no id belongs
    // to an agent whose library issues none, and is not kept.
    if let (Some(state), Some(id)) = (state.as_mut(), id) {
        let (ok, error) = program_verdict(&outcome);
        state
            .programs
            .record(id, turn.turn, &chain.source, ok, error);
    }
    report_to_operator(&outcome, emitter);
    report_chain_to_operator(code.language, &chain, &outcome, emitter);
    report_discovery_to_operator(code.language, &outcome, turn.discovery, emitter);

    // The composed calls the turn actually **dispatched** — the roster plus whatever the roster cap
    // (or a panicked sandbox) stopped describing, never the roster's length. It is a count of calls
    // that reached a tool implementation, not of tool calls: a program makes none of those, and
    // nothing streams a tool-shaped record beside its `ApiCall`/`ApiResult` pair.
    let tool_calls = outcome.tool_calls.len() as u64 + outcome.tool_calls_suppressed;
    emitter.emit(GgTelemetryKind::CodeExecution {
        ok: matches!(&outcome.result, Ok(result) if result.error.is_none()),
        tool_calls,
        // Every call the model wrote, which legitimately exceeds `tool_calls`: the fourteen-odd
        // functions no gg tool backs are calls too, and so is one the membrane refused.
        api_calls: outcome.api_calls,
        // The calls among those the model wrote **without ever having read what they do**. Not an
        // error and not a failure of this turn: the program ran and did its work, so this changes
        // nothing about the turn's outcome — it is evidence about the model. See
        // [`crate::discovery`].
        undocumented_calls: outcome.undocumented.clone(),
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
        // be gone — invisible to the operator reading a finished run, to the session record, and to
        // any analysis over many runs.
        logs: outcome.logs.clone(),
        logs_suppressed: outcome.logs_suppressed,
        // Non-zero only for the program that beat the run's warm-up to the one shared component
        // compile and paid it itself — the figure that separates "this program was slow" from
        // "this program compiled the guest component inside its own span".
        compile_wait_ms: outcome
            .compile_wait
            .map(|waited| saturating_u64(waited.as_millis())),
        // What compiling *this* program cost, for a language that compiles at all. It is time the
        // clock behind `duration_ms` never sees — that clock starts once the program is prepared —
        // so without this the whole of a compiled arm's per-turn compile cost would be absorbed
        // into the turn's response time, alongside minutes of `shell`.
        compile_ms: outcome
            .compile
            .map(|compiling| saturating_u64(compiling.as_millis())),
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
    let notices: Vec<CodeFeedback> = handover_notice(code.language, &chain, &outcome)
        // A program the model handed over that gg did not run. It is exactly the class of fact a
        // notice exists for: nothing the program can observe reveals it — no call failed, nothing
        // threw — and a model that believes its replacement ran would spend its next turn reasoning
        // about work that never happened.
        .map(CodeFeedback::notice)
        .into_iter()
        // A skill's or memory's code that failed to load. Its `lib` binding is empty, and a name
        // that is not bound is indistinguishable from one the run never granted, so a model reading
        // the silence would fix the wrong thing.
        .chain(module_error_notice(&outcome.module_errors).map(CodeFeedback::notice))
        .collect();

    let decision = turn_decision(code.language, &outcome, &notices, emitter);
    (decision, state)
}

/// What one program's [outcome](SandboxOutcome) makes of its turn: the disposition, the class it is
/// recorded under, and the feedback the model reads.
///
/// A function rather than the `match` it used to be inline, because it is the only thing that
/// decides **what a model is told about a failure**, and gate G8 — `sandbox::language::g8`, which
/// is `#[cfg(test)]` and so unreachable from a doc link — holds all eleven arms to it. A gate that mirrored this routing instead of calling it would be
/// asserting against a copy, which is how a gate goes green while the thing it guards regresses.
fn turn_decision(
    language: GgProgramLanguage,
    outcome: &SandboxOutcome,
    notices: &[CodeFeedback],
    emitter: &Emitter,
) -> CodeTurnOutcome {
    match &outcome.result {
        Err(error) => sandbox_failure_decision(language, error, notices, emitter),
        Ok(result) => {
            let report = program_report(outcome, result);
            // The class the guest already typed the throw with, rather than the bare fact that
            // there was one: an uncaught *call failure* says the model is fighting the API, an
            // unknown name says it is writing against a surface this run withheld, and a plain
            // throw says its own program was wrong.
            let error = result
                .error
                .as_ref()
                .map(|error| error.kind.turn_error_type());
            CodeTurnOutcome::Continue {
                feedback: match result.error.as_ref() {
                    Some(error) => with_error(notices, program_error_feedback(error)),
                    None => notices.to_vec(),
                },
                error,
                report,
            }
        }
    }
}

/// **What the model reads back about a program**, rendered by the production path that renders it.
///
/// The one entry gate G8 drives: an arm hands over the outcome of a
/// real run — including one whose program its own compiler refused, which arrives here as an `Err`
/// like any other — and gets back the body that would be pushed into the model's window, the band
/// it would arrive under, and the class the turn would be recorded as. Nothing here re-implements
/// the rendering; it calls [`turn_decision`] with no notices and a sink nobody reads, because a
/// notice is a fact about the *session* and G8 asks only what the model is told about the
/// **fault**.
#[cfg(test)]
pub(crate) fn model_facing(language: GgProgramLanguage, outcome: &SandboxOutcome) -> ModelFacing {
    let emitter = Emitter::with_sink(None, Box::new(crate::telemetry::CapturingSink::new()));
    ModelFacing::of(turn_decision(language, outcome, &[], &emitter))
}

/// What a turn would put in front of the model, flattened out of [`CodeTurnOutcome`].
#[cfg(test)]
#[derive(Debug)]
pub(crate) struct ModelFacing {
    /// The band the message arrives under, or `None` when nothing is fed back at all — a fatal
    /// fault, or a program that ran to its end.
    pub(crate) source: Option<GgContextSource>,
    /// The message body, empty when there is none. This is the string a model reads.
    pub(crate) body: String,
    /// The class the turn is recorded as, `None` for a turn that carried out its work.
    pub(crate) error: Option<TurnErrorType>,
    /// Whether gg ended the run rather than feeding anything back — which is a failure the model
    /// is never told about, and therefore never one an arm may answer a program fault with.
    pub(crate) fatal: bool,
}

#[cfg(test)]
impl ModelFacing {
    /// Read a decision the way the loop would deliver it.
    fn of(decision: CodeTurnOutcome) -> Self {
        match decision {
            CodeTurnOutcome::Continue {
                feedback, error, ..
            } => match feedback.into_iter().next_back() {
                Some(message) => Self {
                    source: Some(message.source),
                    body: message.body,
                    error,
                    fatal: false,
                },
                None => Self {
                    source: None,
                    body: String::new(),
                    error,
                    fatal: false,
                },
            },
            CodeTurnOutcome::Fatal { .. } => Self {
                source: None,
                body: String::new(),
                error: None,
                fatal: true,
            },
            CodeTurnOutcome::Finished { .. } => Self {
                source: None,
                body: String::new(),
                error: None,
                fatal: false,
            },
        }
    }
}

/// The [turn error type](TurnErrorType) a sandbox failure the **model** owns is recorded as.
///
/// A thin wrapper over [`SandboxError::turn_error_type`] for the three non-fatal arms of
/// [`sandbox_failure_decision`], which reach it only after the fatal ones have already been claimed
/// by `is_artifact_defect`/`is_host_fault`/`is_lowering_defect` — so the `None` those five return is
/// unreachable here. It is answered rather than `expect`ed because a
/// panic inside the turn loop would cost a run that is otherwise fine, and because
/// [`ProgramThrow`](TurnErrorType::ProgramThrow) is the honest reading of "the program ran and
/// something gg cannot classify ended it": the base kind it derives is `program_fault`, which is the
/// one bucket that never charges the failure to a ceiling it did not cause. If it is ever reached,
/// those arms have stopped being a partition and
/// `every_sandbox_failure_maps_to_exactly_one_turn_disposition` says so first.
fn sandbox_error_type(error: &SandboxError) -> TurnErrorType {
    error
        .turn_error_type()
        .unwrap_or(TurnErrorType::ProgramThrow)
}

/// What a turn becomes when the sandbox could not run its program to a result — **whose** failure it
/// was, what the model is told about it, and what the run's ceilings are handed.
///
/// One function and one `match`, so the dispositions are decided together from the same facts. They
/// are the ones the sandbox's own taxonomy names — see [`SandboxError`] — and each answers a
/// different owner:
///
/// * the committed **artifact**, gg's own **plumbing**, gg's own **preparation** of a source it had
///   already accepted, or the language's **compiler** failing to finish: fatal, fed back to nobody,
///   charged to nothing;
/// * the **model's program**: the language's diagnostic, verbatim, under `Compiler error`, with the
///   [supporting material](compiler_error_body) drawn from the arm's library set after it where its
///   catalogue declares one;
/// * a sandbox **ceiling**: the ceiling's own words under `Runtime error`.
///
/// Lifted out of [`run_code_turn`] rather than left inline because the split between the compiler
/// rejecting a program and the compiler failing to run one is silent when it regresses: routing a
/// compiler's crash into the `Compiler error` band tells the model its program was rejected when
/// nothing read it, produces no failure anywhere, and sends the model rewriting a program that was
/// never wrong. A function is a thing a test can hold.
fn sandbox_failure_decision(
    language: GgProgramLanguage,
    error: &SandboxError,
    notices: &[CodeFeedback],
    emitter: &Emitter,
) -> CodeTurnOutcome {
    match error {
        // gg's own machinery, in its two flavours. Neither is fed back and neither is ever charged
        // to the model's error budget; both would fail identically on every further turn.
        error if error.is_artifact_defect() => CodeTurnOutcome::Fatal {
            fault: FatalFault::ArtifactDefect,
            message: format!(
                "the code sandbox's prebuilt component could not be run: {error} \
                 (artifact drift)"
            ),
        },
        error if error.is_host_fault() => CodeTurnOutcome::Fatal {
            fault: FatalFault::HostFault,
            message: format!("gg's own plumbing could not operate the code sandbox: {error}"),
        },
        // gg's own preparation of a source it had already accepted. Fatal for the reason the two
        // above are, and stated separately because this is the one that reads like a compiler
        // error: it carries a diagnostic, it happens where a compile error happens, and it was fed
        // back under the `Compiler error` heading until the run's attribution was taken seriously.
        // What that cost is worth naming here, at the site that used to do it — a model rewriting a
        // program nothing was wrong with, gg's bug counted against the model's ceilings, and a
        // `transpile` row in the published record saying the model could not write compiling code.
        error if error.is_lowering_defect() => CodeTurnOutcome::Fatal {
            fault: FatalFault::Lowering,
            message: format!("gg's own pipeline could not prepare the model's program: {error}"),
        },
        // The compiler could not finish, so nothing was decided about the program. Fatal, and fed
        // back to nobody: there is no diagnostic to show, and the one sentence gg could write in
        // its place — "write it again" — asks the model to answer for the image it is running in.
        // The variant covers a binary that is not installed as well as one that crashed, and on the
        // first of those every turn fails identically while the model rewrites a program nothing
        // ever read.
        error if error.is_toolchain_defect() => CodeTurnOutcome::Fatal {
            fault: FatalFault::Toolchain,
            message: format!("the model's program was never read: {error} (run environment fault)"),
        },
        // The language's own diagnostic, with nothing wrapped around it. `SandboxError::Prepare`'s
        // `Display` prefixes it ("the program did not compile: …"), which the `Compiler error`
        // heading already says, so the inner error is what goes out.
        //
        // The one thing that goes out beside it is drawn from the arm's library set, which is what
        // the compiler measured the program against and is the reason no prompt carries a package
        // inventory. It is part of the diagnostic rather than advice about it: a program refused
        // for naming a package this arm does not carry is answered here or nowhere.
        error @ SandboxError::Prepare(prepare) => CodeTurnOutcome::Continue {
            feedback: vec![CodeFeedback::compiler(compiler_error_body(
                language,
                &prepare.to_string(),
            ))],
            // Which of the four prepare failures it was, from the error itself rather than from a
            // blanket "did not compile": a syntax error is a typo, a semantic error is almost
            // always two programs in one reply, a compile error is a whole coherent program written
            // against the wrong surface, and a refusal is a feature the sandbox has no
            // implementation of. They have different causes and want different responses, so the
            // record says which one happened.
            error: Some(sandbox_error_type(error)),
            report: "its last program did not compile".to_string(),
        },
        // A ceiling the sandbox enforced — a timeout, the memory cap, a trap. The program compiled
        // and started, so this is a runtime failure and reads as one; the variant's own `Display` is
        // the error, and gg adds no advice on top of it.
        error => {
            emitter.emit(log(
                "warn",
                format!("the code program did not run to a result: {error}"),
            ));
            CodeTurnOutcome::Continue {
                feedback: with_error(notices, CodeFeedback::runtime(error.to_string())),
                // Which ceiling stopped it. A runaway loop, a program that allocated past its cap
                // and a guest trap are three different defects and were one bucket while this arm
                // ignored the variant it had matched.
                error: Some(sandbox_error_type(error)),
                report: "its last program was stopped by a sandbox limit".to_string(),
            }
        }
    }
}

/// The body of a `Compiler error` message: the arm's rendered diagnostic, alone.
///
/// Everything after the heading is the compiler's output. gg's processing of that output only
/// ever removes, the way the caps in `sandbox/language/diagnostics.rs` remove, and adds nothing.
/// The diagnostic arrives here already rendered by the arm that read it: `PrepareError::Compile`
/// carries that arm's string, and the band and the turn record carry it on untouched.
fn compiler_error_body(_language: GgProgramLanguage, diagnostic: &str) -> String {
    diagnostic.to_string()
}

/// The class a refused [knowledge](crate::knowledge) load carries — the same split
/// [`sandbox_failure_decision`] makes for a turn's own program, on the other consumer of the same
/// seam.
///
/// A source the language read and rejected is the model's, and on a write the model wrote it on this
/// very call: [`InvalidArgument`](ToolFailure::InvalidArgument), because the argument really was bad.
/// Anything else is gg's side of the seam falling over — a compiler that could not finish, or a
/// source gg accepted and then could not prepare: [`IoError`](ToolFailure::IoError), the class that
/// exists for exactly that, because nothing about the model's argument was judged. A function rather
/// than an inline `if` so the two consumers of this seam cannot drift, and so the split is a thing a
/// test can hold.
fn knowledge_refusal_class(error: &KnowledgeError) -> ToolFailure {
    if error.is_authors_source() {
        ToolFailure::InvalidArgument
    } else {
        ToolFailure::IoError
    }
}

/// Record a knowledge half that would not prepare: raise the run's [fault latch](crate::fault) when
/// the failure was gg's, and tell the **operator** whatever the model was not already given.
///
/// The two halves of this seam are owned by different people, so they are recorded differently.
/// A source the language read and rejected is the author's: nothing is latched, the whole of the
/// diagnostic already went out on the call, and there is nothing left to log. Anything else — a
/// compiler that could not finish, or a source gg accepted and then could not prepare — is gg's, so
/// the run ends for the reason every gg defect ends it: the tree a run leaves after gg denied an
/// agent code it was told it had is not the tree that agent would have produced, and the record
/// carries no sign that anything was withheld.
///
/// The operator's [detail](KnowledgeError::operator_detail) rides the same call rather than a
/// second one, so a site that meets this failure cannot report it to one reader and not the other.
/// It is logged at `error` because an image whose compiler keeps falling over is a run that should
/// be fixed rather than watched, and because this is the only stream the crash detail reaches.
fn record_knowledge_failure(
    error: &KnowledgeError,
    spawner: &Agent,
    fault: &FaultLatch,
    emitter: &Emitter,
) {
    if error.is_authors_source() {
        return;
    }
    let detail = error.operator_detail().unwrap_or_else(|| error.to_string());
    fault.in_agent(&spawner.id, &spawner.profile_id, &detail);
    emitter.emit(log("error", detail));
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
/// A report is a *status line* handed to a spawner and a run record, so it is bounded independently of the feedback the model sees: a program that returns a large
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
// Feedback
// ---------------------------------------------------------------------------

/// Everything one program did that the **model** is not told, said on the operator's stream.
///
/// The model gets no per-turn report of the calls it made, the views it opened and closed, a
/// refusal, a discarded return value or work deferred past the program's end — see
/// [`CodeFeedback`] — because every one of those is either something the program already learned by
/// running (a call returns; a refusal throws) or a standing rule the system prompt states once.
///
/// None of it stops being worth *recording*, and this is the only copy. A study reading a finished
/// run has to be able to see that a view was refused or that a program returned a value into the
/// void, and the operator's stream is where a run says what it did. So the facts go out here,
/// worded for a reader outside the agent rather than for the agent.
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
        ViewKind::Search => "search",
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

/// The [`Notice`](GgContextSource::System) for code modules that failed, or `None` when every one
/// this turn brought into use loaded and ran.
///
/// A notice for the same reason the hand-over one is: nothing the program can observe reveals it. A skill or memory whose code threw while it was being loaded leaves its
/// `lib` binding empty, and a model calling into that binding reads a name that does not exist
/// rather than a broken one — so without this the model spends its next turn on a call it has no
/// way to know was never available.
///
/// It is a notice rather than an error because the fault is not the model's: the source is gg's or
/// the workspace's, and the model has never been shown it. It names which skill or memory failed
/// and what the failure said, and never the source, on the same rule.
fn module_error_notice(errors: &[(String, String)]) -> Option<String> {
    if errors.is_empty() {
        return None;
    }
    let lines: Vec<String> = errors
        .iter()
        .map(|(name, message)| format!("{name}: {message}"))
        .collect();
    Some(format!(
        "{} did not load, so nothing it declares is bound:\n{}",
        plural(errors.len(), "code module"),
        lines.join("\n"),
    ))
}

/// Whether the turn's program ran to its end, and the error it ended with when it did not — what the
/// [library](crate::programs) records beside the source.
///
/// It reads the same three arms the turn's own decision does, deliberately: a program a model would
/// want to fetch and fix is exactly a program that failed, so the record has to say so in the words
/// the model was already given. A reply that did not compile is kept too — it is the single most
/// likely thing to fetch — and its "error" is the compiler's diagnostic.
fn program_verdict(outcome: &SandboxOutcome) -> (bool, Option<String>) {
    match &outcome.result {
        Ok(ProgramResult { error: None }) => (true, None),
        Ok(ProgramResult { error: Some(error) }) => (false, Some(error.message.clone())),
        Err(error) => (false, Some(error.to_string())),
    }
}

/// The [`Notice`](GgContextSource::System) for a hand-over gg did not run, or `None` when the turn
/// made none or gg ran it.
///
/// Three ways a `programs.rerun` goes unhonoured, and each needs a different sentence because each
/// has a different remedy: the program failed afterwards (fix the fault), the program also ended the
/// session (nothing to do — the session is over), or the turn had already run as many programs as it
/// may (do the work in the program rather than handing over again).
fn handover_notice(
    language: GgProgramLanguage,
    chain: &ProgramChain,
    outcome: &SandboxOutcome,
) -> Option<String> {
    // The one call these sentences quote, spelled the way *this* agent's language spells it. These
    // are model-facing notices about the model's own surface, so a spelling frozen here would tell
    // an agent to look at a call its scope does not bind.
    let rerun = crate::sandbox::spell(crate::sandbox::language(language), sandbox::PROGRAMS_RERUN);
    if outcome.revoked_rerun {
        return Some(format!(
            "the program handed to `{rerun}` was NOT run: the handing program failed after \
             handing it over, and a program that did not run to its end decided nothing about \
             what runs next. Fix the fault and hand it over again."
        ));
    }
    match chain.refused? {
        // The session is ending, so there is no next turn to read a notice — but the turn is only
        // `Finished` if the ending survived, and this arm is reached on the path where it did not.
        ChainRefusal::Ended => Some(format!(
            "the program handed to `{rerun}` was NOT run: the same program ended the session, \
             and an ending outranks a hand-over."
        )),
        ChainRefusal::Exhausted => Some(format!(
            "the program handed to `{rerun}` was NOT run: this turn already ran its maximum of \
             {MAX_PROGRAM_CHAIN} programs, and the last of them is the turn's program. Hand over \
             once, to a program that does the work."
        )),
    }
}

/// The **one line a run gets** when its model starts calling functions it never opened the
/// documentation of — see [`crate::discovery`].
///
/// Written off `outcome.undocumented`, which is the same figure the turn's own
/// [`CodeExecution`](GgTelemetryKind::CodeExecution) event carries, so the log and the telemetry
/// cannot describe different runs. That is also what keeps it a statement about the **model**: the
/// figure excludes gg's own programs, so an [on-use script](run_on_use_scripts) running on this same
/// api can never raise it.
///
/// Claimed off the run's shared [latch](DiscoveryWarning), so it is written once however many agents
/// record however many calls. The finding is a property of the model, and the fortieth such call
/// tells a reader nothing the first did not; the per-call detail is on the telemetry, where it can
/// be counted and grouped.
///
/// The calls are spelled the way **this arm's programs write them**, because that is what an
/// operator is reading in the program above the line, and gg's own ids are named beside them,
/// because that is what the finding is counted under everywhere else.
fn report_discovery_to_operator(
    language: GgProgramLanguage,
    outcome: &SandboxOutcome,
    warning: &DiscoveryWarning,
    emitter: &Emitter,
) {
    if outcome.undocumented.is_empty() || !warning.claim() {
        return;
    }
    let arm = crate::sandbox::language(language);
    let named = outcome
        .undocumented
        .operations
        .keys()
        .map(
            |operation| match crate::sandbox::operation_by_id(operation) {
                Some(row) => format!("`{}` ({operation})", spell(arm, row.id)),
                None => format!("`{operation}`"),
            },
        )
        .collect::<Vec<_>>()
        .join(", ");
    emitter.emit(log(
        "warn",
        format!(
            "the model called {named} without ever having opened the documentation of any of \
             them; a function's signature is only knowable here from a documentation view opened \
             on an earlier turn, so this model is writing calls from memory rather than \
             discovering the surface"
        ),
    ));
}

/// What a chain of more than one program did, on the operator's stream.
///
/// Quiet for the ordinary turn, and deliberately loud for a chained one: a turn that ran three
/// programs is one `CodeExecution` event with one duration and one roster, and without a line here
/// an operator reading the stream has no way to know that the source the model sent is not the
/// source that did the work.
///
/// The hand-over call is spelled from the run's own language, exactly as the model-facing notices
/// above spell it. An operator reading a Python run's stream is reading about a Python program, and
/// a line that named TypeScript's spelling at them would be describing a call that run never had.
fn report_chain_to_operator(
    language: GgProgramLanguage,
    chain: &ProgramChain,
    outcome: &SandboxOutcome,
    emitter: &Emitter,
) {
    let rerun = crate::sandbox::spell(crate::sandbox::language(language), sandbox::PROGRAMS_RERUN);
    if chain.programs > 1 {
        emitter.emit(log(
            "info",
            format!(
                "the turn ran {} — each handed over by the one before it with `{rerun}`; the last \
                 is the turn's program.",
                plural(chain.programs as usize, "program")
            ),
        ));
    }
    if outcome.revoked_rerun {
        emitter.emit(log(
            "warn",
            format!(
                "the program handed one to `{rerun}` and then failed, so the replacement was NOT \
                 run."
            ),
        ));
    }
    match chain.refused {
        Some(ChainRefusal::Ended) => emitter.emit(log(
            "warn",
            format!(
                "the program both ended the session and handed one to `{rerun}`; the ending \
                 stands and the replacement was not run."
            ),
        )),
        Some(ChainRefusal::Exhausted) => emitter.emit(log(
            "warn",
            format!(
                "the turn reached its ceiling of {MAX_PROGRAM_CHAIN} programs; the last \
                 `{rerun}` was not run."
            ),
        )),
        None => {}
    }
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
    /// a session-record entry is tagged with.
    pub(super) spawner: &'a Agent,
    /// This agent's **session turn** — the number the [library](crate::programs) records beside
    /// this turn's programs for orientation, and the same number the window's turn headers carry,
    /// so a `Turn #12` a model reads and the turn a history entry names are one number.
    pub(super) turn: u64,
    /// The workspace root and vision context every tool call is executed against.
    pub(super) tool_ctx: &'a ToolContext,
    /// The read policy `read_file` is bound with — whether ambient reads are permitted — or `None`
    /// when this agent has no read-file capability and the call is not bound at all.
    pub(super) read_policy: Option<ReadPolicy>,
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
    /// The run's [fault latch](crate::fault), for the calls this turn services that can meet a
    /// defect of gg's own. A [knowledge](crate::knowledge) half gg accepted and could not prepare,
    /// or whose compiler could not finish, is one: the call is refused, and the run has to end for
    /// the reason every other gg defect ends it.
    ///
    /// The **latch itself**, deliberately, where everything that *attributes* a turn or an ending
    /// asks a [`FaultedRun`] instead. This is the raising side: it says a defect happened, which is
    /// a statement only the site that met one can make and which no type can second-guess.
    /// Attribution is the reading side, where the whole risk is being handed the wrong latch — so
    /// the two are shaped differently on purpose.
    pub(super) fault: &'a FaultLatch,
    /// The run's [discovery warning latch](crate::discovery::DiscoveryWarning) — the one line an
    /// operator gets when this run's model starts calling functions it never looked up.
    ///
    /// Run-wide and shared, so the line is written once however many agents record however many
    /// such calls. The finding itself is counted per turn on the turn's own event and needs nothing
    /// from here; this is only what decides whether the operator has already been told.
    pub(super) discovery: &'a DiscoveryWarning,
    /// The session recorder, when the capability is on.
    pub(super) replay: Option<&'a Arc<GgRecorder>>,
    /// The [compaction] the loop is waiting for this agent to perform, when one is in flight. While
    /// it is set the program's calls are narrowed to the one family that satisfies it — everything
    /// else is refused, because everything else adds to a window that is already full.
    pub(super) pending_compaction: Option<PendingCompaction>,
    /// Which [ending calls](EndingRole) this agent's programs are given, and what the sandbox will
    /// accept from them.
    pub(super) ending_role: EndingRole,
    /// Which SDK types this agent's documentation opens beside a function — its resolved
    /// [`DocViewTypes`], per agent exactly as its program language is.
    pub(super) doc_view_types: DocViewTypes,
    /// **What this agent was granted on the API surface**: the ids of the capabilities its profile
    /// switches on, and the operations its own [allowlist](GgAgentConfig::operations) names within
    /// them.
    ///
    /// The two travel together because they are one answer — *may this agent call X* — and because
    /// the membrane the program is run behind is built from exactly these. They are resolved once
    /// for the session and handed down rather than re-read per turn: the documentation runtime the
    /// model's own lookups are answered from was built from the same pair, and a second reading is
    /// how the two once came to disagree.
    pub(super) capabilities: &'a [String],
    /// The operation half of the grant above.
    pub(super) operations: &'a [OperationId],
    /// The agents this one may become — its own
    /// [roster](test_cabinet_core::gg::GgAgentConfig::subagents), which is what an `exec` target is
    /// checked against. Empty when it has none, which is also when the call is not bound.
    pub(super) exec_roster: &'a [GgRosterEntry],
}

/// The per-turn state a code turn takes **by value** and hands back: the context window, the skills
/// and docs runtimes, and (when delegation is on) the subagent context.
///
/// It is moved into the turn's [`LoopOperationApi`] so a program's calls act on the live window on the
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
    /// The per-agent documentation runtime behind `docs.search` / `view.openDocsView()`.
    pub(super) docs: DocsRuntime,
    /// The per-agent [program library](crate::programs), with **this turn's programs already
    /// recorded in it** — the turn appends before it hands the state back, so the next turn's
    /// `programs.get` of an id this turn's acknowledgements carried returns the program that ran.
    pub(super) programs: ProgramLibrary,
    /// The code this agent has loaded by reading a code [skill](crate::skills) or
    /// [memory](crate::memories) — the modules bound at `lib.<key>` in every later program. It costs
    /// no context and a compaction does not touch it; it travels with the turn only because it is
    /// per-agent state the api owned while the program ran.
    pub(super) knowledge: KnowledgeModules,
    /// This agent's delegation context, when the capability is on.
    pub(super) subagents: Option<SubagentContext>,
    /// The board issues this turn's program asked to wait on, in first-requested order (empty when
    /// it requested none, or never ran a program). The loop suspends the agent on each — after the
    /// turn's feedback is recorded — before taking the next turn.
    pub(super) issue_waits: Vec<String>,
    /// The [compaction] this turn's program declared with `context.compact(…)`, deferred to the
    /// loop exactly as an issue wait is: rewriting the window a program is running in would pull it
    /// out from under the turn still using it. The **last** call stands, so a program that compacts
    /// twice compacts once, from its final summary.
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
/// validators use). Every call the program composes is serviced by the turn's [`LoopOperationApi`], which
/// runs **on that blocking thread** — calling the typed implementations directly and routing
/// the delegation family back onto the async loop via `block_on`. That is where every must-survive
/// loop behaviour lives now: the compaction gate, the session record, knowledge-state re-emission,
/// agent-managed-context reclaim, and skill pinning.
///
/// What it does **not** do is pretend a program made a tool call. The typed implementation under a
/// call is shared with the tool that fronts it on the other surface; nothing above it is. A
/// program's call is bracketed by its own
/// [`ApiCall`](GgTelemetryKind::ApiCall)/[`ApiResult`](GgTelemetryKind::ApiResult) pair and by
/// nothing else, and every gate on this path is keyed on the
/// [operation](crate::sandbox::OperationId) the program called rather than on a tool's name.
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
/// A [`view.openFile`](OperationApi::open_file_view) *does* push one, and that is the whole distinction
/// the model is taught in one line: **`fs.readFile` gets bytes for your program; `view.openFile`
/// shows a file to you.** A view is an intent — *this should be visible* — so it is an attributable,
/// evictable, persisted context item keyed by `(path, region)`, and the picture an opened mockup
/// returned rides in that item. One channel, which is what keeps a picture's cost in the window's
/// own accounting rather than in a second place nothing totals.
#[allow(clippy::too_many_arguments)]
async fn run_code_program(
    source: &str,
    language: &'static dyn ProgramLanguage,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    turn: &CodeTurn<'_>,
    context: ContextModel,
    skills: SkillsRuntime,
    docs: DocsRuntime,
    programs: ProgramLibrary,
    knowledge: KnowledgeModules,
    subagents: Option<SubagentContext>,
) -> (SandboxOutcome, ProgramChain, Option<CodeTurnState>) {
    let program = source.to_string();
    // What this agent was granted: the capabilities its profile switches on and the operations its
    // allowlist names within them. Every arm's SDK is static, so this decides nothing about what the
    // guest *binds* — it is what the membrane refuses against, and it is the same pair the
    // documentation runtime beside it was built from, so what the model was told it has and what the
    // host will service are one set.
    // Owned rather than borrowed, because the whole chain below runs on a `spawn_blocking` thread
    // and nothing borrowed from the turn survives the move onto it.
    let capabilities = turn.capabilities.to_vec();
    let operations = turn.operations.to_vec();
    // The ending group, which the same membrane enforces. It is the agent's role rather than a
    // capability, which is why it travels beside the grant instead of inside it.
    let role = turn.ending_role;
    // The documentation this agent is holding **as the turn opens** — the snapshot the
    // [discovery](crate::discovery) check clears a call against. Read here, before the window moves
    // into the api and before a single line of the program runs, because a view the program itself
    // opens has been read by nobody.
    let documented = documented_operations(&context, &docs);
    // The agent's compile workspace, taken off the registry before it moves into the api. Every
    // program in the chain below prepares on it, which is the same tree the modules those programs
    // link were prepared on.
    let compile_workspace = knowledge.workspace().clone();
    // The production `OperationApi`: the loop's own per-turn state, servicing each typed call inline. The
    // mutable, reclaimed-after-the-turn state moves in; the rest is cloned from the turn (all
    // Arc-backed, so cheap) or captured fresh (`Handle::current()` bridges the delegation family
    // back onto this runtime from the blocking thread).
    let api = LoopOperationApi {
        language,
        context,
        skills,
        docs,
        doc_view_types: turn.doc_view_types,
        programs,
        knowledge,
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
        fault: turn.fault.clone(),
        // Taken **before** the program runs and never refreshed: see the field's own docs, and
        // `crate::discovery` for why the turn's own opens must not count.
        documented,
        replay: turn.replay.cloned(),
        handle: Handle::current(),
        pending_compaction: turn.pending_compaction,
        serviced: 0,
        composed_view_bytes: 0,
    };

    let sandbox = tokio::task::spawn_blocking(move || {
        // The whole chain runs on this one blocking thread, because every program in it acts on the
        // same live window through the same api — which is moved from each `run_program` into the
        // next. There is one turn here as far as everything outside is concerned: one model call,
        // one `CodeExecution`, one entry in the library.
        let mut source = program;
        let mut api = api;
        let mut accumulated: Option<SandboxOutcome> = None;
        let mut chain = ProgramChain::first(&source);
        let (mut merged, chain, mut api) = loop {
            let modules = api.knowledge.code_modules();
            let (mut outcome, returned) = run_program_charged(
                language,
                &source,
                ProgramScope {
                    capabilities: &capabilities,
                    operations: &operations,
                    modules: &modules,
                    ending: RunEnding::Role(role),
                },
                &compile_workspace,
                limits,
                deadline,
                api,
            );
            api = returned;
            let handover = outcome.rerun.take();
            let ended = outcome.completion.is_some();
            let merged = match accumulated.take() {
                Some(earlier) => merge_chain(earlier, outcome),
                None => outcome,
            };
            let Some(next) = handover else {
                break (merged, chain, api);
            };
            // An ending outranks a hand-over. A program that declared its session over and also
            // asked for a replacement asked for two incompatible things, and the ending is the one
            // that was earned by work already done — running the replacement would resume a session
            // the model has already concluded.
            if ended {
                chain.refused = Some(ChainRefusal::Ended);
                break (merged, chain, api);
            }
            if chain.programs as usize >= MAX_PROGRAM_CHAIN {
                chain.refused = Some(ChainRefusal::Exhausted);
                break (merged, chain, api);
            }
            chain.advance(&next);
            source = next;
            accumulated = Some(merged);
        };
        // The on-use scripts of everything this turn brought into use, run now that the turn's own
        // program has ended. Deferring is not a convenience: a read reaches gg from inside a
        // membrane call that already holds the api, so there is no api to run a second program
        // against until this point — and the views these open belong in the *next* prompt anyway.
        api = run_on_use_scripts(
            language,
            &mut merged,
            &capabilities,
            &operations,
            limits,
            deadline,
            api,
        );
        (merged, chain, api)
    });

    match sandbox.await {
        // The sandbox ran (to a result, a throw, or a ceiling): reclaim the state the api carried so
        // the loop gets its live window, skills/docs runtimes and delegation context back.
        Ok((outcome, chain, api)) => {
            let state = CodeTurnState {
                context: api.context,
                skills: api.skills,
                docs: api.docs,
                programs: api.programs,
                knowledge: api.knowledge,
                subagents: api.subagents,
                issue_waits: api.issue_waits_requested,
                compact_requested: api.compact_requested,
                handoff_requested: api.handoff_requested,
                forks_requested: api.forks_requested,
                compaction_calls: (api.compaction_calls, api.compaction_failures),
            };
            (outcome, chain, Some(state))
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
                // serviced is not recoverable here; the turn is fatal regardless. The API-call
                // counter died with it, on the same terms.
                tool_calls_suppressed: 0,
                api_calls: 0,
                undocumented: GgUndocumentedCalls::default(),
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
                // Whatever a module said on its way down died with the store, like everything else.
                module_errors: Vec::new(),
                returned_value: false,
                completion: None,
                revoked_completion: None,
                // The hand-over — if the program made one — died with the task that would have
                // acted on it. The turn is fatal regardless, so there is nothing to run and nothing
                // to tell the model.
                rerun: None,
                revoked_rerun: false,
                elapsed: Duration::ZERO,
                // Both are observations the sandbox makes on its way through, and the task that
                // would have made them died — so neither is known, and neither is invented.
                compile: None,
                compile_wait: None,
                result: Err(SandboxError::Host(format!(
                    "the code sandbox task did not complete: {join}"
                ))),
            };
            (outcome, ProgramChain::first(source), None)
        }
    }
}

/// The most programs one turn may run: the model's own, plus three it handed over.
///
/// A chain longer than one is not the shape this capability is for — the point is to fix a program
/// and run the fixed one — but a small allowance is worth having, because assembling a program in
/// two steps (fetch, patch, patch again against what the first patch revealed) is a legitimate thing
/// for a program to do. What the bound stops is the runaway: a program whose replacement hands over
/// again, forever, inside one turn that never reports anything. The turn that reaches it is told, so
/// a model does not sit waiting for a program gg declined to run.
const MAX_PROGRAM_CHAIN: usize = 4;

/// What one turn's chain of programs did — how many ran, which source was the turn's, and why a
/// hand-over was not honoured when one was refused.
///
/// It is separate from [`SandboxOutcome`] because a chain is the *loop's* idea, not the sandbox's:
/// every `run_program` in it is an ordinary, complete sandbox run that knows nothing about the ones
/// around it. Carrying it out separately is what keeps the sandbox's own vocabulary free of a
/// concept it does not implement.
pub(super) struct ProgramChain {
    /// How many programs the turn ran. `1` for the ordinary turn, which is every turn that made no
    /// hand-over.
    pub(super) programs: u32,
    /// The source of the program that actually did the submission's work — the last one in the
    /// chain. This is what the [library](crate::programs) records under the submission's id, so a
    /// later `programs.get` returns a program that ran rather than the lines that asked for it.
    pub(super) source: String,
    /// Why the last hand-over was not honoured, or `None` when none was refused (which includes
    /// every turn that never made one).
    pub(super) refused: Option<ChainRefusal>,
}

impl ProgramChain {
    /// The chain of one program: what every turn starts as, and what most turns stay.
    fn first(source: &str) -> Self {
        Self {
            programs: 1,
            source: source.to_string(),
            refused: None,
        }
    }

    /// Record that a hand-over was honoured and `source` is the program now running.
    fn advance(&mut self, source: &str) {
        self.programs = self.programs.saturating_add(1);
        self.source = source.to_string();
    }
}

/// Why gg did not run a program a turn handed over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ChainRefusal {
    /// The program also ended the session, and an ending outranks a hand-over.
    Ended,
    /// The turn had already run [as many programs as it may](MAX_PROGRAM_CHAIN).
    Exhausted,
}

/// Fold the record of an earlier program in the turn's chain into the one that followed it.
///
/// The **later** outcome is the turn's outcome — its result, its ending, its throw — because it is
/// the program that did the work and the one the model must fix if it failed. What the earlier ones
/// contribute is everything the turn *accumulated*: the calls it dispatched, the views it opened,
/// the lines it logged, the time it burned. Those are facts about the turn, and dropping them would
/// make a chained turn under-report exactly the work the chain existed to preserve.
///
/// Both sides are destructured field by field rather than read through dots, so a field added to
/// [`SandboxOutcome`] fails to compile here — which is where someone has to decide whether a chained
/// turn accumulates it or takes the later one's.
fn merge_chain(earlier: SandboxOutcome, later: SandboxOutcome) -> SandboxOutcome {
    let SandboxOutcome {
        tool_calls: mut calls,
        tool_calls_suppressed: calls_suppressed,
        api_calls: earlier_api_calls,
        undocumented: mut earlier_undocumented,
        mut refusals,
        refusals_suppressed,
        mut logs,
        logs_suppressed,
        mut views_opened,
        mut views_closed,
        mut view_refusals,
        views_suppressed,
        deferred_note: earlier_deferred,
        mut module_errors,
        returned_value: earlier_returned,
        // An earlier link never carries either: the chain stops at a program that declared an
        // ending, and a program that failed had its hand-over revoked, so nothing that got here
        // ended or lost an ending.
        completion: _,
        revoked_completion: earlier_revoked,
        // Taken before the merge, by the caller that decided whether to honour it.
        rerun: _,
        revoked_rerun: earlier_revoked_rerun,
        elapsed: earlier_elapsed,
        compile: earlier_compile,
        compile_wait: earlier_compile_wait,
        // The earlier program ran to its end — that is the only way the chain continued — so its
        // result says nothing the later one's does not.
        result: _,
    } = earlier;

    calls.extend(later.tool_calls);
    refusals.extend(later.refusals);
    logs.extend(later.logs);
    views_opened.extend(later.views_opened);
    views_closed.extend(later.views_closed);
    view_refusals.extend(later.view_refusals);
    // Accumulated, not replaced: every link of a chain is handed the same modules, so a module that
    // failed to load failed for each of them — but a link that loaded a *new* one has a failure the
    // earlier links could not have reported.
    module_errors.extend(later.module_errors);
    module_errors.dedup();

    SandboxOutcome {
        tool_calls: calls,
        tool_calls_suppressed: calls_suppressed.saturating_add(later.tool_calls_suppressed),
        // Summed for the reason every other per-turn count is: a chained turn's model wrote both
        // programs' calls, and reporting only the later link's would hide the hand-over.
        api_calls: earlier_api_calls.saturating_add(later.api_calls),
        // Accumulated with the calls it is a subset of, and for the same reason: a chained turn's
        // model wrote both programs, and a hand-over must not be a way to have the second program's
        // guesses go uncounted.
        undocumented: {
            earlier_undocumented.merge(&later.undocumented);
            earlier_undocumented
        },
        refusals,
        refusals_suppressed: refusals_suppressed.saturating_add(later.refusals_suppressed),
        logs,
        logs_suppressed: logs_suppressed.saturating_add(later.logs_suppressed),
        views_opened,
        views_closed,
        view_refusals,
        views_suppressed: views_suppressed.saturating_add(later.views_suppressed),
        deferred_note: later.deferred_note.or(earlier_deferred),
        module_errors,
        returned_value: later.returned_value || earlier_returned,
        completion: later.completion,
        revoked_completion: later.revoked_completion.or(earlier_revoked),
        rerun: later.rerun,
        revoked_rerun: later.revoked_rerun || earlier_revoked_rerun,
        // Summed, because the turn's cost is what every one of its programs spent — and because the
        // execution timeout is per program, so a chained turn that is slow must be visibly slow
        // rather than reporting only its last link.
        elapsed: earlier_elapsed.saturating_add(later.elapsed),
        // **Summed**, unlike `compile_wait` below and for the opposite reason: the shared component
        // is compiled at most once, but every link of a chain is a program of its own and a
        // compiling language compiles each one. Reporting only a link's worth would make a turn
        // that compiled four programs look like a turn that compiled one.
        compile: SandboxOutcome::summed_compile(earlier_compile, later.compile),
        // The earlier link is the one that could have paid the one shared component compile; by the
        // time the second ran it was warm.
        compile_wait: earlier_compile_wait.or(later.compile_wait),
        result: later.result,
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
/// # Which call this is, is the caller's to know
///
/// It is reached only from the [servicing tail](LoopOperationApi::complete)'s
/// `operation == SKILLS_READ_SKILL` arm, and it does not re-check. It cannot: the
/// [dispatch record](LoopOperationApi::begin) a program's call is minted with is named for the
/// **operation**, because that is the only vocabulary this surface has — a tool name is the other
/// surface's, and no program ever wrote one. A guard here re-reading that field against a tool name
/// would refuse every call it was handed.
fn pin_read_skill(
    context: &mut ContextModel,
    skills: &mut SkillsRuntime,
    call: &ToolCall,
    outcome: &ToolOutcome,
    emitter: &Emitter,
) {
    if !outcome.ok {
        return;
    }
    let Some(name) = call.arguments.get("name").and_then(Value::as_str) else {
        return;
    };
    if matches!(skills.record_read(name), ReadRecord::Fresh) {
        // A code-only skill has no body, and an empty message is not a message: a provider is
        // handed `"content": ""` and refuses the request, so a skill that carries nothing but a
        // module would end the turn it was used on. What such a skill puts in the window is the
        // documentation views its module opened, which are placed by the load rather than here.
        if !outcome.output.trim().is_empty() {
            context.push(
                GgContextSource::Skill,
                Retention::Pinned,
                Message::user(outcome.output.clone()),
            );
        }
        if let Some(state) = skills.state_event() {
            emitter.emit(state);
        }
    }
}

/// Run one program and charge it for **everything** compiling for it cost.
///
/// [`run_program`] times the language's prepare step for the program's own source, which is the
/// whole of it for the ordinary program. A program that reads a code skill or writes a code memory
/// makes the language prepare *more* source part-way through — inside a membrane call, at a point
/// where the sandbox has already taken its reading and cannot take another. That cost is
/// accumulated on the [knowledge registry](KnowledgeModules) instead, and drained here.
///
/// It is a wrapper rather than two lines at each call site because the failure it prevents is
/// invisible: a caller that forgets the drain reports a figure that is merely *too small*, never
/// absent, and the next program to run gets charged for the modules this one loaded.
fn run_program_charged(
    language: &'static dyn ProgramLanguage,
    program: &str,
    scope: ProgramScope<'_>,
    workspace: &crate::sandbox::AgentWorkspace,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    api: LoopOperationApi,
) -> (SandboxOutcome, LoopOperationApi) {
    let (mut outcome, mut api) =
        run_program(language, program, scope, workspace, limits, deadline, api);
    outcome.compile = SandboxOutcome::summed_compile(outcome.compile, api.knowledge.take_compile());
    (outcome, api)
}

/// The same drain around an [already-prepared](run_prepared_program) program — an on-use script.
///
/// The script itself cost nothing to prepare *here*: it was prepared at the read. What this drains
/// is what the script's **own** reads cost, since a skill's on-use script may read another skill and
/// make the language prepare a module part-way through, exactly as a turn's program can.
fn run_prepared_charged(
    language: &'static dyn ProgramLanguage,
    program: PreparedProgram,
    scope: ProgramScope<'_>,
    limits: SandboxLimits,
    deadline: Option<Instant>,
    api: LoopOperationApi,
) -> (SandboxOutcome, LoopOperationApi) {
    let (mut outcome, mut api) =
        run_prepared_program(language, program, scope, limits, deadline, api);
    outcome.compile = SandboxOutcome::summed_compile(outcome.compile, api.knowledge.take_compile());
    (outcome, api)
}

/// Fold what an on-use script did into the turn that triggered it, and hand back the sentence its
/// failure earns, if it failed.
///
/// Every accumulation here is the same claim: **the turn pays for the scripts it triggered.** They
/// happened on this turn, against this agent's window, and an operator reading the run must see them
/// — so a script's calls join the turn's roster, its views join the turn's window, its execution
/// time joins the turn's, and what its language spent compiling it joins the turn's compile figure.
/// A script is a whole program of its own: for a compiling language it is a whole trip through the
/// compiler, and leaving it out would make a skill-heavy run's compile cost read low.
///
/// `result` is deliberately **not** folded: the turn succeeded or failed on the model's own program,
/// whatever a skill's script then did.
///
/// Neither is the script's [discovery](crate::discovery) record, and for a sharper version of the
/// same reason: **a model did not write this program**, gg did, from the family the skill declares.
/// Its calls cannot be calls a model made without looking them up, so folding them in would report a
/// violation on every turn that used a skill and make the one figure that is about the model a
/// figure about gg's own generated code. [`api_calls`](SandboxOutcome::api_calls) is left out on
/// exactly the same footing, and has been all along.
fn absorb_on_use_script(outcome: &mut SandboxOutcome, script: SandboxOutcome) -> Option<String> {
    outcome.tool_calls.extend(script.tool_calls);
    outcome.refusals.extend(script.refusals);
    outcome.logs.extend(script.logs);
    outcome.views_opened.extend(script.views_opened);
    outcome.views_closed.extend(script.views_closed);
    outcome.view_refusals.extend(script.view_refusals);
    outcome.module_errors.extend(script.module_errors);
    outcome.elapsed = outcome.elapsed.saturating_add(script.elapsed);
    outcome.compile = SandboxOutcome::summed_compile(outcome.compile, script.compile);
    match &script.result {
        Ok(result) => result.error.as_ref().map(|error| error.message.clone()),
        Err(error) => Some(error.to_string()),
    }
}

/// Run every on-use script this turn queued, one sandbox run each, and record what they did.
///
/// Called once, after the turn's last program has ended and before its outcome is assembled. Each
/// script is an ordinary [`run_program_charged`] against the **same api** — so its views land in
/// this agent's window, its tool calls appear in this turn's roster, and its cost is the turn's
/// (see [`absorb_on_use_script`] for the whole of what it contributes), which is right: they
/// happened on this turn, and an operator reading the run must be able to see them. One thing
/// differs from a turn's own program: [`RunEnding::None`] — an on-use script is not the agent's
/// turn, so it has no `finish` to call, and no verdict either. Everything else it is granted is
/// exactly what the agent that read it holds, because it is running on that agent's behalf.
///
/// A script that fails is **not** the model's failure. Its source was never shown to the model, so
/// reporting the throw as a program error would be an accusation about code the model cannot see;
/// it goes into `module_errors`, which the turn's feedback renders as one sentence naming the skill
/// or memory. `outcome.result` is untouched: the turn succeeded or failed on the model's own
/// program, whatever a skill's script then did.
#[allow(clippy::too_many_arguments)]
fn run_on_use_scripts(
    language: &'static dyn ProgramLanguage,
    outcome: &mut SandboxOutcome,
    capabilities: &[String],
    operations: &[OperationId],
    limits: SandboxLimits,
    deadline: Option<Instant>,
    mut api: LoopOperationApi,
) -> LoopOperationApi {
    // Drained rather than iterated: a script that itself reads a skill would otherwise queue work
    // this loop is still walking. What it queues waits for the next turn, which is the same promise
    // every on-use script is given.
    let pending = api.knowledge.take_pending();
    for PendingOnUse {
        origin,
        name,
        program,
        module,
    } in pending
    {
        let modules: Vec<_> = module.into_iter().collect();
        let (script, returned) = run_prepared_charged(
            language,
            program,
            ProgramScope {
                capabilities,
                operations,
                modules: &modules,
                ending: RunEnding::None,
            },
            limits,
            deadline,
            api,
        );
        api = returned;
        if let Some(failure) = absorb_on_use_script(outcome, script) {
            outcome.module_errors.push((
                format!("{} `{name}`", origin.noun()),
                format!("its on-use script failed: {failure}"),
            ));
        }
    }
    api
}

/// The JSON a memory write is **recorded** as, for the roster, the session record and the observer.
///
/// The two code halves are recorded as their lengths rather than their text. They can be tens of
/// kilobytes each, they are not what a reader of a run wants beside a memory write, and the source
/// is already recoverable from the program that wrote it — which the [library](crate::programs)
/// keeps.
fn memory_args(name: &str, description: &str, body: &str, code: &MemoryCode) -> Value {
    let chars = |half: &Option<String>| half.as_ref().map(|source| source.chars().count());
    json!({
        "name": name,
        "description": description,
        "body": body,
        "codeChars": chars(&code.code),
        "onUseChars": chars(&code.on_use),
    })
}

// ---------------------------------------------------------------------------
// The caps a program's views are held to
// ---------------------------------------------------------------------------
//
// Every one of these is enforced in `LoopOperationApi`, because that is where the `ContextModel` is: a
// cap that cannot see the window is a cap guessing. Breaching one is a **catchable** `ApiError`
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

/// The most bytes of **composed view body** one turn's programs may hand the host in total.
///
/// It is a host-robustness bound, not a model-facing budget, and the distinction is the whole reason
/// it is a *byte* ceiling rather than a count. The number of views an agent may hold is deliberately
/// unbounded (see below): what makes a window too full is tokens, and the fullness signal reports
/// those honestly. But `open-text-view` is bound into every program's scope unconditionally, each
/// accepted call stores up to [`MAX_TEXT_VIEW_BYTES`] in the [`ContextModel`], and a program is
/// otherwise bounded only by its wall-clock timeout — so `for (;;) view.openText(unique(), big)` has
/// nothing between it and the driver's resident memory. One reused 64 KiB buffer costs the guest
/// nothing against its own 256 MiB linear-memory cap, so that cap does not stand in for this one.
///
/// 8 MiB is set where it is because it is past anything a program composes on purpose and short of
/// anything that hurts the host: it is roughly two million tokens of text, an order of magnitude
/// more than the largest window gg drives, and 128 bodies at the per-view maximum. A model that
/// reaches it has stopped showing itself material and started writing its window with a loop, which
/// is the failure the retired per-program view-op ceiling named — so the refusal is a catchable
/// `limit-exceeded` naming this constant, exactly as the per-body cap's is, and never a truncation.
///
/// Charged per **turn** rather than per program because that is the unit the api is alive for: a
/// [chained](ProgramChain) rerun and an on-use script are the same turn's composition, and a budget
/// that reset between them would be a budget a `rerun` loop could spend twice.
const MAX_COMPOSED_VIEW_BYTES_PER_TURN: usize = 8 * 1024 * 1024;

// There is deliberately **no cap on the NUMBER of views** an agent may hold open — not on text
// views, not on image-carrying file views, not on documentation views, and no budget on how many
// view operations one program may make. The caps that remain are the two above, and both bound the
// *size* of one thing: a body is 64 KiB, a label is a name.
//
// A count cap answers a question the context window already answers, and answers it worse. What
// makes a window too full is tokens, which every view reports and the fullness signal totals; a
// count is a proxy for that which is wrong in both directions — fifty one-line views are nothing and
// four large ones are most of a small model's window. Worse, a count cap has to refuse, and a
// refusal is the one outcome that leaves the model unable to show itself the thing it decided to
// look at, in exchange for a bound the fullness signal was already reporting honestly. The model's
// context window is the limit; agent-managed context is how it is spent.

// ---------------------------------------------------------------------------
// The native `OperationApi`: the loop's own state, servicing each typed call inline
// ---------------------------------------------------------------------------

/// The production [`OperationApi`]: the loop's own state, servicing each typed call — the compaction
/// gate, the session record, agent-managed-context reclaim, skill pinning, board pump + state
/// events — and routing the delegation family to the subagent scheduler via `block_on` (the sandbox
/// runs on a blocking thread).
///
/// A call serviced here is a **program's** call, and it is recorded as one: the membrane brackets it
/// with an [`ApiCall`](GgTelemetryKind::ApiCall)/[`ApiResult`](GgTelemetryKind::ApiResult) pair and
/// nothing here emits a second, tool-shaped record beside it. The two surfaces are independent, and
/// a program that never made a tool call must not appear to have made one.
pub(super) struct LoopOperationApi {
    /// The [program language](ProgramLanguage) this agent writes in.
    ///
    /// It is on the api rather than only on the turn because one of the api's own calls needs it: a
    /// read that brings a code [skill](crate::skills) or [memory](crate::memories) into use prepares
    /// that thing's code, and the code the agent's `lib` binds has to be prepared for the same guest
    /// its programs run in.
    pub(super) language: &'static dyn ProgramLanguage,
    // moved-in, mutable, reclaimed after the turn:
    pub(super) context: ContextModel,
    pub(super) skills: SkillsRuntime,
    pub(super) docs: DocsRuntime,
    /// Which SDK types an [`open_docs_view`](Self::open_docs_view) opens beside the function it was
    /// asked for — this agent's resolved [`DocViewTypes`], read at each open rather than baked into
    /// the runtime, because it governs what is *placed in the window* and not what a lookup says.
    pub(super) doc_view_types: DocViewTypes,
    /// This agent's [program library](crate::programs) — the source of every program it has run,
    /// which its own programs read through `programs.get` / `programs.history`.
    ///
    /// It travels by value with the rest of the per-turn state because it is *this agent's*, and
    /// because the turn appends to it: what a program ran is recorded once the turn knows how the
    /// program fared. Disabled — and therefore empty and unreadable — for an agent whose profile
    /// does not enable the capability.
    pub(super) programs: ProgramLibrary,
    /// The code this agent has loaded — the modules bound at `lib.<key>` in every program it writes
    /// from here on, and the on-use scripts a read this turn queued for the end of it.
    pub(super) knowledge: KnowledgeModules,
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
    exec_roster: Vec<GgRosterEntry>,
    /// How many calls this program made while a compaction was in flight.
    pub(super) compaction_calls: u32,
    /// How many of those failed — a refusal included, since a refusal is a call that did not run.
    /// A [memory compaction](PendingCompaction::MemoryWrites) is satisfied by one program that made
    /// at least one call and had none of them fail.
    pub(super) compaction_failures: u32,
    // cloned/borrowed-by-value loop state:
    spawner: Agent,
    tool_ctx: ToolContext,
    read_policy: Option<ReadPolicy>,
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
    /// The run's [fault latch](crate::fault) — see [`CodeTurn::fault`].
    fault: FaultLatch,
    /// **What this agent's documentation surface said when the turn began**: `true` for an operation
    /// whose page stood open in the window, `false` for one whose pages were all closed, and absent
    /// for an operation this agent binds no page for. See
    /// [`documented_operations`](DocsRuntime::documented_operations).
    ///
    /// The snapshot *is* the mechanism. A view this turn's own program opened has been read by
    /// nobody — the model wrote the program before any of it ran — so answering against the live
    /// window would clear exactly the mistake the prompt's *"write the call on a later turn"* names.
    /// It is taken as the api is built, which is after the window has been opened, compacted or
    /// restored for this turn and before the first line of the program runs, so what it holds is
    /// precisely what the model could have read.
    documented: BTreeMap<String, bool>,
    replay: Option<Arc<GgRecorder>>,
    handle: Handle,
    pending_compaction: Option<PendingCompaction>,
    serviced: u64,
    /// How many bytes of composed view body this turn's programs have handed the host so far, against
    /// [`MAX_COMPOSED_VIEW_BYTES_PER_TURN`]. Beside `serviced` because it is the same kind of thing —
    /// a running total for the life of the api, which is the life of the turn.
    composed_view_bytes: usize,
}

#[allow(dead_code)]
impl LoopOperationApi {
    /// Bring a code skill or memory into use: prepare and supply its module, queue its on-use
    /// script, and open the documentation the module put on this agent's surface.
    ///
    /// **The reply is untouched.** A use produces documentation and no message: the module's own
    /// entry and one per declaration it exports join this agent's
    /// [documentation surface](crate::docs) at the load, and this opens
    /// [a view per callable declaration](crate::docs::DocsRuntime::use_views) beside them. That is a
    /// better answer than the sentence it replaces on every count a sentence was ever justified by —
    /// it names the line the model must write, it does so for each declaration rather than for the
    /// module as a whole, it survives a compaction because a docview is re-derived from its key, and
    /// the model can take it back out of the window when it is finished with it. A prose skill or
    /// memory carries no code, so nothing is registered, nothing is opened, and the read is exactly
    /// what it always was.
    ///
    /// A failure to compile does **not** fail the read. The body is what was asked for, the code is
    /// somebody else's (an authored skill's, or a memory written twenty turns ago), and refusing to
    /// hand over a mostly-prose skill because its helper has a syntax error would be the wrong
    /// trade. The diagnostic is appended instead, located in the author's own coordinates — and it
    /// is the one thing a use still says in words, because there is no documentation to open for a
    /// module that did not prepare.
    ///
    /// A **compiler that could not finish**, and a source gg accepted and could not prepare, are
    /// gg's rather than the author's, and end the run
    /// ([`record_knowledge_failure`]) exactly as [`sandbox_failure_decision`] ends it for a turn's
    /// own program. The read still returns its body, since the run has one turn boundary left to
    /// reach and an agent that is winding down is better off with the material than without it.
    fn bring_into_use(
        &mut self,
        origin: KnowledgeOrigin,
        name: &str,
        code: Option<&str>,
        on_use: Option<&str>,
        mut outcome: ToolOutcome,
    ) -> ToolOutcome {
        if code.is_none() && on_use.is_none() {
            return outcome;
        }
        match self
            .knowledge
            .load(self.language, origin, name, code, on_use)
        {
            Ok(loaded) => self.open_loaded_docviews(loaded.key.as_deref()),
            Err(error) => {
                record_knowledge_failure(&error, &self.spawner, &self.fault, &self.emitter);
                outcome.output.push_str(&format!("\n\n---\nNOTE: {error}"));
            }
        }
        outcome
    }

    /// [Open the documentation](open_loaded_docviews) of the module just loaded at `key`, or do
    /// nothing when the thing that was used carried no code.
    fn open_loaded_docviews(&mut self, key: Option<&str>) {
        if let Some(key) = key {
            open_loaded_docviews(&mut self.context, &self.docs, self.doc_view_types, key);
        }
    }

    /// Load a memory's code at the moment it is **written**, under the strategy where a memory is in
    /// context from the moment it exists.
    ///
    /// The [scratchpad](crate::memories::MemoryStrategy::Scratchpad) has no `read_memory`: every
    /// body is already pinned in the window, so there is no later moment at which the memory "comes
    /// into use". Its code therefore loads here. Under the two file-shaped strategies the write does
    /// **not** load — the memory is not in context until it is read, and its code follows the same
    /// rule the strategy already sets for its body.
    ///
    /// Unlike a read, a write whose code does not compile is **refused**. The model wrote that code
    /// on this call, so this is the one moment at which a located diagnostic is exactly what it
    /// needs — and storing a module that can never be bound would be storing something that only
    /// fails later.
    ///
    /// A write whose **compiler could not finish** is gg's defect and ends the run
    /// ([`record_knowledge_failure`]). The call is still refused, for the reason above: under this
    /// strategy the write is the only moment the code loads, so a memory stored here whose module
    /// never bound would leave the model holding a memory whose code nothing has, with no
    /// documentation of it and no later moment at which either could arrive. It is refused as
    /// an [`IoError`](ToolFailure::IoError) rather than as an
    /// [`InvalidArgument`](ToolFailure::InvalidArgument): the compiler is a process gg ran and the
    /// process failed, and classifying it as a bad argument would record the model's call as
    /// malformed on the strength of a crash nothing about its source caused. The class is what a
    /// study slices by, so the misattribution would outlive the turn — and the turn that refusal
    /// fails is charged to gg rather than to the model for the same reason.
    fn loaded_on_write(
        &mut self,
        name: &str,
        code: &MemoryCode,
        outcome: ToolOutcome,
    ) -> ToolOutcome {
        if !outcome.ok || code.is_empty() {
            return outcome;
        }
        let strategy = self.memories_rt.strategy();
        if strategy.has_index() || strategy.has_search() {
            // The code is stored and loads when the memory is read, which is where its documentation
            // arrives too. Nothing is said about it here: a write is not a use, and a sentence
            // promising what a later call will do is the kind of narration the documentation surface
            // exists to replace.
            return outcome;
        }
        match self.knowledge.load(
            self.language,
            KnowledgeOrigin::Memory,
            name,
            code.code.as_deref(),
            code.on_use.as_deref(),
        ) {
            Ok(loaded) => {
                self.open_loaded_docviews(loaded.key.as_deref());
                outcome
            }
            Err(error) => {
                record_knowledge_failure(&error, &self.spawner, &self.fault, &self.emitter);
                ToolOutcome::failed(knowledge_refusal_class(&error), error.to_string())
            }
        }
    }

    /// Gate the call and, if it is allowed, run `exec` (the same typed implementation a tool's
    /// `invoke` runs), then service the outcome (AMC reclaim, session record, board pump, state
    /// events, skill pin). Returns the serviced outcome the membrane maps to a WIT result.
    ///
    /// Everything here is keyed on the [operation](OperationId) the program called, which is the
    /// only vocabulary this path has: a program does not name a tool, and gg does not translate one
    /// into the other. What the two surfaces share is what `exec` reaches — `ReadFileTool::read` and
    /// its siblings — and nothing above it.
    fn serviced(
        &mut self,
        operation: OperationId,
        args: Value,
        exec: impl FnOnce(&mut Self) -> ToolOutcome,
    ) -> ToolOutcome {
        // The gate is evaluated first, but the dispatch record is minted *before* the call runs
        // either way — a refusal is a serviced call, so the session record carries it exactly as it
        // carries one that ran.
        let refused = self.gate(operation);
        let call = self.begin(operation, args);
        if let Some(refused) = refused {
            return self.complete(operation, call, refused, Vec::new());
        }
        let mut outcome = exec(self);
        // Agent-managed context: rewrite the outcome with what the loop actually reclaimed.
        let managed = match ContextReclaim::of_operation(operation) {
            Some(reclaim) if self.amc.enabled && outcome.ok => apply_context_reclaim(
                &mut self.context,
                &self.amc.archive,
                &self.amc.archive_id,
                reclaim,
                &call.arguments,
                &mut outcome,
            ),
            _ => Vec::new(),
        };
        self.complete(operation, call, outcome, managed)
    }

    /// The read every `read_file`-backed operation performs: this agent's [policy](ReadPolicy) over
    /// the workspace, shared by the bare read, the text helper and the file view so the three
    /// cannot read different lines.
    ///
    /// Belt to the membrane's braces, as the memory-scope gate below is: the call is bound only for
    /// an agent whose read-file capability configures a policy, so a program reaching here without
    /// one asked for a call this agent does not have. gg reads no file under a policy nobody wrote.
    fn policy_read(&self, path: &str, offset: Option<usize>, limit: Option<usize>) -> ToolOutcome {
        match self.read_policy {
            Some(policy) => {
                ReadFileTool::new(policy).read(&self.tool_ctx, path.to_string(), offset, limit)
            }
            None => ToolOutcome::failed(
                ToolFailure::Unavailable,
                format!(
                    "`{}` is not available.",
                    spell(self.language, FILES_READ_FILE)
                ),
            ),
        }
    }

    /// The gates every serviced call passes: `Some(refusal_outcome)` when this call cannot run.
    ///
    /// Neither of them is the capability gate — that is the [membrane](crate::sandbox)'s, applied
    /// before the call ever reaches this api, and it answers from the agent's own
    /// [grant](crate::sandbox::Grants). These two are conditions of the *moment*, which no grant
    /// could express.
    ///
    /// **Memory access** is structural — a [read-only](crate::memories::MemoryScope::ReadOnly)
    /// holder may not write, ever — and is the belt to the grant's braces: such a holder is
    /// [granted](crate::sandbox::granted_operations) no memory write at all, so a program written
    /// against the scope it actually has cannot reach one, and this catches only a program written
    /// against a scope it does not.
    ///
    /// **Compaction** is the strictest gate gg has, and temporary: while one is in flight the
    /// window is full, so every call that is not the one compaction asked for is refused. `compact`
    /// itself is exempt — the run has no way forward until the window is reclaimed.
    fn gate(&self, operation: OperationId) -> Option<ToolOutcome> {
        if MEMORY_MUTATIONS.contains(&operation) && !self.memories_rt.is_writable() {
            return Some(ToolOutcome::failed(
                ToolFailure::Refused,
                read_only_refusal(self.memories_rt.strategy(), Some(self.language)),
            ));
        }
        if let Some(pending) = self.pending_compaction
            && !pending.admits_operation(operation)
            && operation != CONTEXT_COMPACT
        {
            return Some(ToolOutcome::failed(
                ToolFailure::Refused,
                pending.refusal(
                    // Named the way this agent's own programs write it, because that is the only
                    // spelling it has ever seen — a bare operation id here would name a call the
                    // model cannot make.
                    &spell(self.language, operation),
                    Some(self.language),
                    self.memories_rt.strategy().calls(Some(self.language)),
                ),
            ));
        }
        None
    }

    /// Mint this call's **dispatch record** — the ordinal-keyed id unique within the turn, the
    /// operation it was made under, and the arguments it was made with.
    ///
    /// It is not telemetry. The call's model-facing record is its
    /// [`ApiCall`](GgTelemetryKind::ApiCall)/[`ApiResult`](GgTelemetryKind::ApiResult) pair, which
    /// the membrane brackets every call with; this is what the [session record](crate::capture)
    /// keys an outcome under, and what the handful of shared handlers that still read a request as
    /// JSON (`transition_state`, `exec`, `fork`, the delegation family) are handed. The arguments
    /// are therefore the call's real request rather than a display copy of it — which is why they
    /// are built at each call site instead of being reconstructed here.
    fn begin(&mut self, operation: OperationId, args: Value) -> ToolCall {
        let call = ToolCall {
            id: format!("{PROGRAM_CALL_ID_PREFIX}{}:{operation}", self.serviced),
            name: operation.to_string(),
            arguments: args,
        };
        self.serviced += 1;
        call
    }

    /// Record the outcome, pump the board, re-emit knowledge state, and pin a fresh skill — the
    /// per-call servicing tail shared by ordinary and delegation calls, run after the call (or
    /// handler) has produced `outcome`.
    fn complete(
        &mut self,
        operation: OperationId,
        call: ToolCall,
        outcome: ToolOutcome,
        managed: Vec<GgTelemetryKind>,
    ) -> ToolOutcome {
        for event in managed {
            self.emitter.emit(event);
        }
        if let Some(recorder) = &self.replay {
            recorder.record_tool_result(&self.spawner.id, &call, &outcome);
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
            if BOARD_MUTATIONS.contains(&operation)
                && let Some(project) = &self.project
            {
                project.orch.pump_and_wake(&self.emitter);
            }
            let state = if MEMORY_MUTATIONS.contains(&operation) {
                // The revisions first — the append-only record of what the call did, which for
                // a deletion is the only place it is recorded at all. A program may have made
                // several memory calls by now; the drain hands over every one of them.
                for revision in self.memories_rt.revision_events() {
                    self.emitter.emit(revision);
                }
                self.memories_rt.state_event()
            } else if operation.namespace == TASKS_ADD_TASK.namespace {
                self.tasks_rt.state_event()
            } else if BOARD_MUTATIONS.contains(&operation) {
                self.board.state_event()
            } else {
                None
            };
            if let Some(state) = state {
                self.emitter.emit(state);
            }
        }
        if operation == SKILLS_READ_SKILL {
            pin_read_skill(
                &mut self.context,
                &mut self.skills,
                &call,
                &outcome,
                &self.emitter,
            );
        }
        outcome
    }

    /// Delegation servicing: gate, mint the dispatch record, run the async handler on the blocking
    /// thread via `block_on`, then service the tail. `run` gets the handle + mut subagent ctx +
    /// spawner + emitter + call.
    fn delegated(
        &mut self,
        operation: OperationId,
        args: Value,
        run: impl FnOnce(&Handle, &mut SubagentContext, &Agent, &Emitter, &ToolCall) -> ToolOutcome,
    ) -> ToolOutcome {
        let refused = self.gate(operation);
        let call = self.begin(operation, args);
        if let Some(refused) = refused {
            return self.complete(operation, call, refused, Vec::new());
        }
        let handle = self.handle.clone();
        let spawner = &self.spawner;
        let emitter = &self.emitter;
        let outcome = match self.subagents.as_mut() {
            Some(sub) => run(&handle, sub, spawner, emitter, &call),
            None => ToolOutcome::failed(
                ToolFailure::Unavailable,
                format!("`{}` is not available.", spell(self.language, operation)),
            ),
        };
        self.complete(operation, call, outcome, Vec::new())
    }

    /// Validate a `wait_for_issue` request and record it for the loop to honour after the program
    /// ends — the non-blocking near half of the deferred wait.
    ///
    /// It runs the checks that are about the **request** rather than about the board's current
    /// state — a non-empty id, the project capability, not the agent's own assigned issue, and an
    /// issue that is actually on the board — so a program learns of a bad id *as a throw on the
    /// call*, in the turn it made it, rather than at the between-turns suspension where it has no
    /// program to catch it. Whether the wait can be satisfied at all is not among them: that is
    /// board state, and it is read by the wait itself at the moment it suspends, which is the only
    /// reading that can still be true when the agent blocks. What it does not do is block: it
    /// appends the id to [`issue_waits_requested`](LoopOperationApi::issue_waits_requested)
    /// (deduplicated) and returns an acknowledgement, and the loop suspends on it once the whole
    /// program has run.
    pub(super) fn register_issue_wait(&mut self, id: String) -> ToolOutcome {
        let issue_id = id.trim();
        if issue_id.is_empty() {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                "missing required argument `issueId`".to_string(),
            );
        }
        if self.project.is_none() {
            return ToolOutcome::failed(
                ToolFailure::Unavailable,
                format!(
                    "`{}` is not available.",
                    spell(self.language, BOARD_WAIT_FOR_ISSUE)
                ),
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
                format!("cannot wait on issue `{issue_id}`: it is this agent's own assigned issue"),
            );
        }
        if self.board.issue_status(issue_id).is_none() {
            return ToolOutcome::failed(
                ToolFailure::NotFound,
                format!("no issue `{issue_id}` on the board"),
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

    /// Check one `view.openText` against the two size caps that bound a text view and the turn's
    /// composed-body budget, then push it and report what the push did.
    ///
    /// The budget is charged on what was **accepted**, and it is charged whether the push placed a
    /// new view or superseded one: what it bounds is how much text the host was handed, not how much
    /// of it survives in the window, because the two come apart exactly in the loop it exists to
    /// stop.
    fn push_text_view(
        &mut self,
        label: String,
        body: String,
    ) -> Result<SandboxViewOpened, ViewRefusal> {
        if let Some(refusal) = text_view_refusal(&label, &body) {
            return Err(refusal);
        }
        if let Some(refusal) = composed_view_budget_refusal(self.composed_view_bytes, body.len()) {
            return Err(refusal);
        }
        self.composed_view_bytes += body.len();
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
// from the call and from what is already open. Keeping them out of `LoopOperationApi` is what lets the
// rules — and the exact words a refused model reads — be read and tested without standing up an
// agent, a workspace and a tokio runtime.

/// The refusal a `view.openDocsView` of a name this run did not bind earns.
///
/// A refusal rather than an empty view: an unbound name is almost always a guess, and an empty
/// `Documentation: whatever` block in the window would confirm the guess instead of correcting it.
///
/// Stated flatly, and deliberately so. The prose version of this — *"so there is nothing to show
/// you"*, followed by advice — read as an explanation of gg's reasoning, which is not what a model
/// correcting a lookup needs; what it needs is the name that failed and, when there is one, the name
/// it meant. A guess about the *argument*
/// never reaches here at all: `view.openDocsView(system.run)` is refused in the guest, by the one
/// layer that can still see the value was `undefined` rather than a name.
///
/// # The hint
///
/// `suggestions` is what the [docs runtime](crate::docs::DocsRuntime::suggest) found bound and near
/// the name that failed — the model asked for `write` and this agent has `writeFile` — and it is
/// rendered the way a compiler renders one: its own line, indented under the error, naming the
/// candidates and nothing else. That indentation is what keeps this within the rule the band is
/// held to (*the error and nothing else*): the hint is not gg advice about the model's program, it
/// is the rest of the diagnostic, in the shape every diagnostic a programmer has ever read puts it.
///
/// An empty `suggestions` renders nothing at all. A hint with no candidates in it would be gg
/// filling the silence, and the message is one line shorter without it.
fn docs_not_found_refusal(name: &str, suggestions: &[String]) -> ViewRefusal {
    let mut message = format!("no documentation for `{name}`");
    if let Some(hint) = did_you_mean(suggestions) {
        message.push_str(&format!("\n  {hint}"));
    }
    ViewRefusal {
        failure: ToolFailure::NotFound,
        message,
    }
}

/// The *Did you mean …?* line for a set of candidate names, or `None` when there are none.
///
/// One candidate stands alone, two are joined with `or`, and three or more take an Oxford comma —
/// a sentence rather than a delimited list, because the model is being asked to *pick* one and a
/// list it has to parse first is a list it can misread. Each name is backquoted, so whichever it
/// picks can be lifted straight out of the line and written into the next program.
fn did_you_mean(names: &[String]) -> Option<String> {
    let quoted: Vec<String> = names.iter().map(|name| format!("`{name}`")).collect();
    let list = match quoted.as_slice() {
        [] => return None,
        [only] => only.clone(),
        [first, second] => format!("{first} or {second}"),
        [rest @ .., last] => format!("{}, or {last}", rest.join(", ")),
    };
    Some(format!("Did you mean {list}?"))
}

/// The refusal the text-view caps make about one `view.openText`, or `None` to let it through.
///
/// Both caps bound the **size** of one thing — a body is 64 KiB, a label is a name — and there is no
/// cap on how many text views an agent may hold: what makes a window too full is tokens, which the
/// fullness signal already reports honestly, and a count is a proxy for that which is wrong in both
/// directions.
///
/// An empty **body** is deliberately allowed: it is how a program says that something it was
/// showing is now empty, and refusing it would make that unexpressible.
fn text_view_refusal(label: &str, body: &str) -> Option<ViewRefusal> {
    if label.trim().is_empty() {
        return Some(ViewRefusal {
            failure: ToolFailure::InvalidArgument,
            message: "a view needs a non-empty label".to_string(),
        });
    }
    if label.len() > MAX_VIEW_LABEL_BYTES {
        return Some(ViewRefusal {
            failure: ToolFailure::LimitExceeded,
            message: format!(
                "label exceeds max length ({} bytes; max {MAX_VIEW_LABEL_BYTES})",
                label.len()
            ),
        });
    }
    if body.len() > MAX_TEXT_VIEW_BYTES {
        return Some(ViewRefusal {
            failure: ToolFailure::LimitExceeded,
            message: format!(
                "view body exceeds max size ({} bytes; max {MAX_TEXT_VIEW_BYTES})",
                body.len()
            ),
        });
    }
    None
}

/// The refusal the turn's [composed-body budget](MAX_COMPOSED_VIEW_BYTES_PER_TURN) makes about one
/// `view.openText`, or `None` to let it through.
///
/// It refuses the call that would cross the ceiling rather than truncating it, and states the
/// budget and what remains of it, so a program that meant to compose something enormous is told
/// what it may still spend instead of silently showing the model half of what it wrote.
fn composed_view_budget_refusal(spent: usize, body: usize) -> Option<ViewRefusal> {
    let remaining = MAX_COMPOSED_VIEW_BYTES_PER_TURN.saturating_sub(spent);
    (body > remaining).then(|| ViewRefusal {
        failure: ToolFailure::LimitExceeded,
        message: format!(
            "view body exceeds the turn's composed-body budget ({body} bytes; {spent} already \
             composed; budget {MAX_COMPOSED_VIEW_BYTES_PER_TURN}; {remaining} left)"
        ),
    })
}

/// The refusal a file view's byte cap makes about the body it would open, or `None` to let it
/// through.
///
/// The same bound a text view's body is held to, and the same shape of answer: the size that broke
/// it and the bound, never a truncation. What it adds is the way out, because a file view has two
/// that a text view does not — a narrower line window, and a cut on the lines themselves.
fn file_view_refusal(body: &str) -> Option<ViewRefusal> {
    (body.len() > MAX_TEXT_VIEW_BYTES).then(|| ViewRefusal {
        failure: ToolFailure::LimitExceeded,
        message: format!(
            "view body exceeds max size ({} bytes; max {MAX_TEXT_VIEW_BYTES}); open fewer lines \
             with `offset`/`limit`, or cut long lines with `maxLineChars`",
            body.len()
        ),
    })
}

/// The refusal a file view's `maxLineChars` earns for a value that names no cut, or `None` to let
/// it through.
///
/// Zero would cut every line to its annotation alone, and anything past [`MAX_TEXT_VIEW_BYTES`]
/// cuts nothing the cap would let through anyway — so both are argument errors rather than settings,
/// stated with the range so the program can pick a number that means something.
fn line_cut_refusal(max_line_chars: Option<usize>) -> Option<ViewRefusal> {
    match max_line_chars {
        Some(chars) if chars == 0 || chars > MAX_TEXT_VIEW_BYTES => Some(ViewRefusal {
            failure: ToolFailure::InvalidArgument,
            message: format!(
                "`maxLineChars` must be between 1 and {MAX_TEXT_VIEW_BYTES} ({chars} given); \
                 omit it to leave lines whole"
            ),
        }),
        _ => None,
    }
}

/// A successful read, as the file view will show it: the body cut to `max_line_chars` where that is
/// set, and refused where the result is still over the cap.
///
/// Only a **text** read is touched. A picture's body is the sentence describing it, and the
/// picture itself rides on the outcome's images under `IMAGE_ATTACH_CAP`; neither is a text body
/// and neither is cut. A read that failed is handed back as it is.
///
/// The cut is applied to the file's own text and the read's footers are re-appended whole, because a
/// footer is gg telling the model how to page and a cut through it would hide the very number the
/// model needs next. The structured result — what `views.openFile` returns to the program — keeps
/// the read's untouched contents, which is what makes the cut the view's alone.
fn file_view_outcome(mut outcome: ToolOutcome, max_line_chars: Option<usize>) -> ToolOutcome {
    if !outcome.ok {
        return outcome;
    }
    let Some(ApiData::FileText(text)) = &outcome.data else {
        return outcome;
    };
    let body = match max_line_chars {
        None => outcome.output.clone(),
        Some(max) => {
            // The model-facing output is the file's text followed by gg's footers, so what
            // follows the contents is exactly the footers — and a read whose output somehow does
            // not start with its contents is shown whole rather than guessed at.
            let footer = outcome.output.strip_prefix(text.contents.as_str());
            match footer {
                Some(footer) => format!("{}{footer}", cut_long_lines(&text.contents, max)),
                None => outcome.output.clone(),
            }
        }
    };
    if let Some(refusal) = file_view_refusal(&body) {
        return ToolOutcome::failed(refusal.failure, refusal.message);
    }
    outcome.output = body;
    outcome
}

/// `text` with every line longer than `max` characters cut there and annotated in place —
/// `foo (123 more chars...)` — line endings kept as they were.
///
/// Lines are measured in characters, never bytes, and cut on a character boundary, so a line of
/// CJK or emoji is cut where a model counting what it sees would cut it. A `\r\n` ending survives
/// as itself rather than becoming a `\r` counted among the characters dropped.
fn cut_long_lines(text: &str, max: usize) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        let (body, ending) = match line.strip_suffix("\r\n") {
            Some(body) => (body, "\r\n"),
            None => match line.strip_suffix('\n') {
                Some(body) => (body, "\n"),
                None => (line, ""),
            },
        };
        out.push_str(&clip_line(body, max));
        out.push_str(ending);
    }
    out
}

/// The refusal a `view.close` earns for a selector that could never name anything.
///
/// A selector that is *open under nothing* is not a failure — that closes `0` — but a blank one is:
/// it is not a name at all, and answering it with a cheerful zero would hide a typo.
fn close_selector_refusal(selector: &str) -> Option<ViewRefusal> {
    selector.trim().is_empty().then(|| ViewRefusal {
        failure: ToolFailure::InvalidArgument,
        message: "needs a non-empty selector: a file view's path or a text view's label"
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
        GgContextAction::CloseSearchViews => "search-results view(s)",
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
        // A file or text view is *placed* wherever a supersession left room, so where the earliest
        // one sat says nothing about a cached prefix that its own re-opens were already rewriting.
        // The documentation band is the one that is append-only, and so the one where the position
        // is a fact worth recording.
        earliest_removed: None,
    })
}

/// The [`ContextManaged`](GgTelemetryKind::ContextManaged) event a documentation close produced, or
/// `None` when nothing was open to close.
///
/// It carries the **position** of the earliest removed item as well as what was reclaimed, and it is
/// the only close that does. Every other band is disturbed by ordinary use — a re-opened file view
/// supersedes, a re-stated text view replaces — so a removal there is one rewrite among many. The
/// documentation band is append-only by construction, which makes this call the single event in a
/// session that can cost a run its cached prompt prefix, and how much it cost is entirely a question
/// of how far back the cut was.
fn docs_close_event(key: Option<&str>, closed: &ViewsClosed) -> Option<GgTelemetryKind> {
    if closed.reclaimed.items == 0 {
        return None;
    }
    let what = match key {
        Some(key) => format!("for `{key}`"),
        None => "(all of them)".to_string(),
    };
    Some(GgTelemetryKind::ContextManaged {
        action: GgContextAction::CloseDocsViews,
        reclaimed_tokens: closed.reclaimed.tokens,
        items: closed.reclaimed.items as u64,
        detail: format!(
            "Closed {} documentation view(s) {what}, reclaiming ~{} tokens.",
            closed.reclaimed.items, closed.reclaimed.tokens
        ),
        earliest_removed: closed.earliest_removed.map(|index| index as u64),
    })
}

/// The body of the [search-results view](ContextModel::open_search_view): what was asked for, how
/// much of the answer this page is, and one line per hit.
///
/// # Why the host renders it, and why it says the total
///
/// It is documentation about the surface, so it is written where every other word about the surface
/// is — on gg's side, from the catalogue — rather than left to a program to paraphrase into a text
/// view, which would be the one description of the SDK nothing could check against the SDK.
///
/// The count line is load-bearing rather than decorative. A page that did not say how much it was a
/// page *of* reads as a complete answer, and an agent that stops at the first five hits of twenty
/// has silently lost three quarters of what it was looking for — the exact failure the envelope's
/// `total` exists to prevent, which would be undone by a rendering that dropped it.
///
/// A hit's brief is shown whole and nothing else is: choosing is what this list is for, and reading
/// is what a documentation view is for.
///
/// # Why the hits are grouped by kind
///
/// A module, a function and a type are three different things to do next, and a reader scanning for
/// a call does not want the types interleaved with it. Grouping under one heading apiece also states
/// each hit's kind once per group rather than once per line, which over a hundred-hit module
/// directory is the difference between a heading and a hundred repetitions of the same word. Rank
/// order is kept **within** each group, so the best match in a group is still its first line.
///
/// The [bootstrap](crate::bootstrap)'s opening program renders its module listings through this same
/// function, so the first listing a model reads and the ones its own searches produce are one
/// format rather than two.
///
/// # Why each line leads with the key rather than the name
///
/// The identifier on a hit's line is the one the model is about to type into an
/// [`open_docs_view`](OperationApi::open_docs_view), so it has to be the one that call takes: the
/// **fully-qualified** [`key`](crate::docs::DocHit::key), not the bare
/// [`name`](crate::docs::DocHit::name). A bare name is not an identity on an arm — several
/// modules offer a `close`, and [`DocsRuntime::function`](crate::docs::DocsRuntime) resolves a bare
/// one to whichever the catalogue happens to list first — so a list rendered by name would hand the
/// model an ambiguous string and silently answer with the wrong entry's page. The system prompt
/// already promises the opposite, telling a model to open a view *by the fully-qualified name the
/// brief carries*; this is the line that carries it.
///
/// The module is not repeated beside it for the same reason: the key already
/// begins with the module, and a **type**'s [`module`](crate::docs::DocHit::module) is the joined
/// list of every module whose functions mention it, which as a parenthesised suffix is a
/// twelve-item blob rather than a fact worth reading.
///
/// A [documentation view](crate::docs::DocsRuntime) states the module outright, and says how a
/// program reaches it, and the two renderings differ because the moments do. A hit is read while
/// choosing between hits, where the qualified key is the whole of what a choice needs. A view is
/// read at the moment the call is about to be written, where the module's own path and the line
/// that brings it into scope are what the writing needs — and neither is recoverable from a key.
pub(crate) fn render_search_results(query: &DocSearchQuery, page: &DocSearch) -> String {
    let mut asked: Vec<String> = Vec::new();
    if !query.query.trim().is_empty() {
        asked.push(format!("`{}`", query.query.trim()));
    }
    let named: Vec<&str> = query
        .modules
        .iter()
        .map(|module| module.trim())
        .filter(|module| !module.is_empty())
        .collect();
    if !named.is_empty() {
        asked.push(format!(
            "{} {}",
            match named.len() {
                1 => "module",
                _ => "modules",
            },
            named
                .iter()
                .map(|module| format!("`{module}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    for (what, value) in [("type", &query.declared_type), ("kind", &query.kind)] {
        if let Some(value) = value.as_deref().map(str::trim).filter(|it| !it.is_empty()) {
            asked.push(format!("{what} `{value}`"));
        }
    }
    let asked = asked.join(", ");
    if page.hits.is_empty() {
        return format!(
            "No documentation matches {asked}.\nTry fewer words, or a shorter one: matching is by \
             substring, so a fragment finds more than a phrase."
        );
    }
    let first = page.offset as usize + 1;
    let last = page.offset as usize + page.hits.len();
    let mut body = format!(
        "{} {} for {asked}, showing {first}-{last}.\n",
        page.total,
        match page.total {
            1 => "match",
            _ => "matches",
        }
    );
    for (kind, heading) in [
        (DocKind::Module, "Modules"),
        (DocKind::Function, "Functions"),
        (DocKind::Type, "Types"),
    ] {
        let mut of_kind = page.hits.iter().filter(|hit| hit.kind == kind).peekable();
        if of_kind.peek().is_none() {
            continue;
        }
        body.push_str(&format!("\n{heading}:\n"));
        for hit in of_kind {
            body.push_str(&format!("{} — {}\n", hit.key, hit.summary));
        }
    }
    body
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
impl OperationApi for LoopOperationApi {
    /// Stream the opening half of one model-facing call's record.
    ///
    /// This is the **whole** telemetry of a responses-as-code call. There is no bridged
    /// `ToolCall`/`ToolResult` pair beside it: an agent has exactly one surface, and a program never
    /// made a tool call to record. What nests between this event and its
    /// [result](Self::end_api_call) is the effect the call had — a delegation's whole subtree of
    /// child events, a context-managed reclaim, a store's refreshed state — which is why it is
    /// emitted before the work rather than with it.
    ///
    /// It is not recorded for [replay](crate::capture): that is a *dispatch's* record, keyed on the
    /// call the loop minted for it, and it is written by [`complete`](LoopOperationApi::complete) at the
    /// one place an outcome exists to record.
    fn begin_api_call(&mut self, call: ApiIdentity<'_>) {
        self.emitter.emit(GgTelemetryKind::ApiCall {
            operation: call.operation.to_string(),
        });
    }

    /// Stream the closing half, with the verdict the program saw and — when it threw — the class it
    /// was thrown with.
    ///
    /// The operation is repeated rather than left to be recovered from the opening half: a study
    /// counting how often one operation failed reads results, and pairing each result back to its
    /// own call would mean re-deriving a bracket across every child event a delegation emitted
    /// inside it.
    fn end_api_call(&mut self, call: ApiIdentity<'_>, failure: Option<GgCallFailure>) {
        self.emitter.emit(GgTelemetryKind::ApiResult {
            operation: call.operation.to_string(),
            ok: failure.is_none(),
            failure,
        });
    }

    /// Whether this agent held a documentation view of `call` **before this turn began** — the
    /// [discovery](crate::discovery) check, answered off the snapshot the api was built with.
    ///
    /// A page under any name the arm binds the operation under counts, because a model that read
    /// either has read the call
    /// ([`documented_operations`](DocsRuntime::documented_operations)). An operation this agent's
    /// surface documents under no name at all is
    /// [`NotApplicable`](CallDiscovery::NotApplicable): there was never a page to open, so there is
    /// nothing the model can be said to have skipped.
    ///
    /// The live window is deliberately **not** consulted. A view this turn's program opened one line
    /// above the call has been read by nobody — see [`documented`](Self::documented) and
    /// [the module docs](crate::discovery#the-same-turn-does-not-count-and-that-is-the-interesting-half).
    ///
    /// It is a pure lookup with no side effect of any kind. The operator's line is written by
    /// [`report_discovery_to_operator`], off the figure the turn actually recorded, so a program of
    /// gg's own running on this same api cannot raise a warning about a model that wrote none of it.
    fn call_discovery(&mut self, call: ApiIdentity<'_>) -> CallDiscovery {
        match self.documented.get(call.operation) {
            None => CallDiscovery::NotApplicable,
            Some(true) => CallDiscovery::Documented,
            Some(false) => CallDiscovery::Undocumented,
        }
    }

    fn shell(&mut self, command: String, timeout: Duration) -> ToolOutcome {
        self.serviced(
            SHELL_SHELL,
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
            FILES_READ_FILE,
            json!({ "path": path, "offset": offset, "limit": limit }),
            |api| api.policy_read(&path, offset, limit),
        )
    }
    fn write_file(&mut self, path: String, contents: String) -> ToolOutcome {
        self.serviced(
            FILES_WRITE_FILE,
            json!({ "path": path, "contents": contents }),
            |api| WriteFileTool.write(&api.tool_ctx, path.clone(), contents.clone()),
        )
    }
    fn edit_file(&mut self, path: String, old_string: String, new_string: String) -> ToolOutcome {
        self.serviced(
            FILES_EDIT_FILE,
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
        self.serviced(FILES_LIST_DIR, json!({ "path": path }), |api| {
            ListDirTool.list(&api.tool_ctx, path.clone())
        })
    }
    fn tree(&mut self, path: Option<String>, depth: Option<u32>) -> ToolOutcome {
        self.serviced(FILES_TREE, json!({ "path": path, "depth": depth }), |api| {
            TreeTool.tree(&api.tool_ctx, path.clone(), depth)
        })
    }
    fn search(&mut self, query: String, path: Option<String>, limit: Option<u32>) -> ToolOutcome {
        self.serviced(
            FILES_SEARCH,
            json!({ "query": query, "path": path, "limit": limit }),
            |api| SearchTool.search(&api.tool_ctx, query.clone(), path.clone(), limit),
        )
    }
    fn read_skill(&mut self, name: String) -> ToolOutcome {
        self.serviced(SKILLS_READ_SKILL, json!({ "name": name }), |api| {
            let library = api.skills.library();
            let outcome = ReadSkillTool::new(library.clone()).read(name.clone());
            if !outcome.ok {
                return outcome;
            }
            // Reading a code skill is what loads it. The library is authored, not written by this
            // model, so a skill whose code does not compile still reads: the body is what the model
            // asked for, and the failure is appended as a sentence rather than turned into a refusal
            // of a skill that may be mostly prose.
            // Resolved against **this agent's** language: a skill directory may carry a module per
            // language, and only one of them is a module this program could evaluate.
            let skill = library.get(&name);
            let code = skill.and_then(|skill| skill.code(api.language));
            let on_use = skill.and_then(|skill| skill.on_use(api.language));
            // A skill that carries code in no language this agent writes reads as pure prose, which
            // is the right outcome and a silent one. The operator is told, because a directory
            // holding a module nothing in the run can evaluate is an authoring mistake rather than
            // a configuration; the model is not, because what other languages exist is not its
            // business and naming them would vary a prompt between arms.
            if let Some(skill) = skill
                && skill.has_code()
                && code.is_none()
                && on_use.is_none()
            {
                api.emitter.emit(log(
                    "warn",
                    format!(
                        "the skill `{name}` carries code spelled {} — none of which {} reads, so \
                         it was read as prose",
                        skill
                            .code_spellings()
                            .iter()
                            .map(|extension| format!("`.{extension}`"))
                            .collect::<Vec<_>>()
                            .join(", "),
                        api.language.display_name(),
                    ),
                ));
            }
            api.bring_into_use(KnowledgeOrigin::Skill, &name, code, on_use, outcome)
        })
    }
    fn write_memory(
        &mut self,
        name: String,
        description: String,
        body: String,
        code: MemoryCode,
    ) -> ToolOutcome {
        self.serviced(
            MEMORIES_WRITE_MEMORY,
            memory_args(&name, &description, &body, &code),
            |api| {
                let outcome = WriteMemoryTool::new(api.memories_rt.binding()).write(
                    name.clone(),
                    description.clone(),
                    body.clone(),
                    code.clone(),
                );
                api.loaded_on_write(&name, &code, outcome)
            },
        )
    }
    fn update_memory(
        &mut self,
        name: String,
        description: String,
        body: String,
        code: MemoryCode,
    ) -> ToolOutcome {
        self.serviced(
            MEMORIES_UPDATE_MEMORY,
            memory_args(&name, &description, &body, &code),
            |api| {
                let outcome = UpdateMemoryTool::new(api.memories_rt.binding()).update(
                    name.clone(),
                    description.clone(),
                    body.clone(),
                    Some(code.clone()),
                );
                api.loaded_on_write(&name, &code, outcome)
            },
        )
    }
    fn create_memory(
        &mut self,
        name: String,
        description: String,
        contents: String,
        code: MemoryCode,
    ) -> ToolOutcome {
        self.serviced(
            MEMORIES_CREATE_MEMORY,
            memory_args(&name, &description, &contents, &code),
            |api| {
                let outcome = CreateMemoryTool::new(api.memories_rt.binding()).create(
                    name.clone(),
                    description.clone(),
                    contents.clone(),
                    code.clone(),
                );
                api.loaded_on_write(&name, &code, outcome)
            },
        )
    }
    fn read_memory(&mut self, name: String) -> ToolOutcome {
        self.serviced(MEMORIES_READ_MEMORY, json!({ "name": name }), |api| {
            let binding = api.memories_rt.binding();
            let outcome = ReadMemoryTool::new(binding.clone()).read(name.clone());
            if !outcome.ok {
                return outcome;
            }
            // Under the two file-shaped strategies a memory is not in context until it is read, so
            // the read is also what loads its code. (Under the scratchpad there is no `read_memory`
            // at all: every memory is already in the window, and its code was loaded when it was
            // written.)
            let (code, on_use) = {
                let store = binding.lock();
                match store.read(&name) {
                    Ok(memory) => (
                        memory.code().map(str::to_string),
                        memory.on_use().map(str::to_string),
                    ),
                    Err(_) => (None, None),
                }
            };
            api.bring_into_use(
                KnowledgeOrigin::Memory,
                &name,
                code.as_deref(),
                on_use.as_deref(),
                outcome,
            )
        })
    }
    fn edit_memory(&mut self, name: String, search: String, replace: String) -> ToolOutcome {
        self.serviced(
            MEMORIES_EDIT_MEMORY,
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
        self.serviced(
            MEMORIES_SEARCH_MEMORIES,
            json!({ "keywords": keywords }),
            |api| SearchMemoriesTool::new(api.memories_rt.binding()).search(keywords.clone()),
        )
    }
    fn delete_memory(&mut self, name: String) -> ToolOutcome {
        self.serviced(MEMORIES_DELETE_MEMORY, json!({ "name": name }), |api| {
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
            TASKS_ADD_TASK,
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
        self.serviced(TASKS_UPDATE_TASK, args, |api| {
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
            TASKS_SET_BLOCKED_BY,
            json!({ "id": id, "blockedBy": blocked_by }),
            |api| {
                SetBlockedByTool::new(api.tasks_rt.store())
                    .set_blocked_by(id.clone(), blocked_by.clone())
            },
        )
    }
    fn complete_task(&mut self, id: String) -> ToolOutcome {
        self.serviced(TASKS_COMPLETE_TASK, json!({ "id": id }), |api| {
            CompleteTaskTool::new(api.tasks_rt.store()).complete(id.clone())
        })
    }
    fn remove_task(&mut self, id: String) -> ToolOutcome {
        self.serviced(TASKS_REMOVE_TASK, json!({ "id": id }), |api| {
            RemoveTaskTool::new(api.tasks_rt.store()).remove(id.clone())
        })
    }
    fn create_epic(&mut self, prefix: String, title: String, description: String) -> ToolOutcome {
        self.serviced(
            BOARD_CREATE_EPIC,
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
            BOARD_CREATE_ISSUE,
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
        self.serviced(BOARD_UPDATE_ISSUE, args, |api| {
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
            BOARD_SET_ISSUE_BLOCKED_BY,
            json!({ "id": id, "blockedBy": blocked_by }),
            |api| {
                SetIssueBlockedByTool::new(api.board.store())
                    .set_issue_blocked_by(id.clone(), blocked_by.clone())
            },
        )
    }
    fn remove_epic(&mut self, id: String) -> ToolOutcome {
        self.serviced(BOARD_REMOVE_EPIC, json!({ "id": id }), |api| {
            RemoveEpicTool::new(api.board.store()).remove_epic(id.clone())
        })
    }
    fn remove_issue(&mut self, id: String) -> ToolOutcome {
        self.serviced(BOARD_REMOVE_ISSUE, json!({ "id": id }), |api| {
            RemoveIssueTool::new(api.board.store()).remove_issue(id.clone())
        })
    }
    fn wait_for_issue(&mut self, id: String) -> ToolOutcome {
        // Deferred, not blocking: `register_issue_wait` validates the id and records the request;
        // the loop suspends the agent after the program ends. Serviced like any ordinary call — it
        // shows up in the composed-calls roster and in the session record — but the wait itself is
        // not one of the delegation family's `block_on`s.
        self.serviced(BOARD_WAIT_FOR_ISSUE, json!({ "issueId": id }), |api| {
            api.register_issue_wait(id.clone())
        })
    }
    fn evict_file_view(&mut self, path: Option<String>) -> ToolOutcome {
        self.serviced(CONTEXT_EVICT_FILE_VIEW, json!({ "path": path }), |_api| {
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
        self.serviced(
            CONTEXT_ARCHIVE_THREAD,
            json!({ "ranges": pairs }),
            move |_api| ArchiveThreadTool.archive(ranges.clone()),
        )
    }
    fn search_archive(&mut self, query: String) -> ToolOutcome {
        self.serviced(CONTEXT_SEARCH_ARCHIVE, json!({ "query": query }), |api| {
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
            CONTEXT_COMPACT,
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
        // [`handoff_requested`](LoopOperationApi::handoff_requested). The judging is the loop's own
        // `handle_transition`, so a program and a native tool call are held to exactly the same
        // rules: the same legal targets, the same first-wins, the same refusal text. There is no
        // ending to lose to here — under responses-as-code an ending is declared through the session
        // membrane rather than through this dispatch path — so the ending gate is passed `None`.
        let args = json!({ "state": state, "note": note });
        let call_args = args.clone();
        self.serviced(DELEGATION_TRANSITION_STATE, args, move |api| {
            let Some(position) = api.spawner.fsm.clone() else {
                return ToolOutcome::failed(
                    ToolFailure::Unavailable,
                    "this agent is not running inside a state machine, so there is no state to \
                     transition to.",
                );
            };
            let call = ToolCall {
                id: String::new(),
                name: DELEGATION_TRANSITION_STATE.to_string(),
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
        self.serviced(DELEGATION_EXEC, args, move |api| {
            let call = ToolCall {
                id: String::new(),
                name: DELEGATION_EXEC.to_string(),
                arguments: call_args,
            };
            let LoopOperationApi {
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
        // The arm's own spelling of the call, read off the api before the closure borrows it: the
        // sentence below is put in front of a model, and a model reads a name it could write.
        let language = self.language;
        self.serviced(DELEGATION_FORK, args, move |api| {
            let call = ToolCall {
                id: String::new(),
                name: DELEGATION_FORK.to_string(),
                arguments: call_args,
            };
            let LoopOperationApi {
                subagents,
                spawner,
                forks_requested,
                ..
            } = api;
            match subagents.as_mut() {
                Some(sub) => handle_fork(sub, spawner, forks_requested, &call),
                None => ToolOutcome::failed(
                    ToolFailure::Unavailable,
                    format!("`{}` is not available.", spell(language, DELEGATION_FORK)),
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
        // Each of the three delegation calls names **its own** handler rather than going through
        // the tool path's `handle_subagent_call`, which is a switch on a tool name. The
        // [dispatch record](Self::begin) a program's call is minted with is named for the operation,
        // because that is the only vocabulary this surface has — routing through a switch on the
        // other surface's names would fall through to its "not a delegation tool" arm for every
        // call. What the two paths share is what they should: the handler that does the work, and
        // the arguments it reads.
        self.delegated(
            DELEGATION_SPAWN_SUBAGENT,
            args,
            |_h, sub, spawner, _emitter, call| spawn_subagent(sub, spawner, &call.arguments),
        )
    }
    fn wait_for_subagents(&mut self, ids: Option<Vec<String>>) -> ToolOutcome {
        self.delegated(
            DELEGATION_WAIT_FOR_SUBAGENTS,
            json!({ "ids": ids }),
            |h, sub, _spawner, emitter, call| {
                h.clone()
                    .block_on(wait_for_subagents(sub, emitter, &call.arguments))
            },
        )
    }
    fn send_message(&mut self, agent_id: String, message: String) -> ToolOutcome {
        self.delegated(
            DELEGATION_SEND_MESSAGE,
            json!({ "agentId": agent_id, "message": message }),
            |_h, sub, _spawner, _emitter, call| send_message(sub, &call.arguments),
        )
    }
    /// Search the documentation surface, hand the program its page, and leave the same page in the
    /// window as the agent's [search-results view](ContextModel::open_search_view).
    ///
    /// # Both a value and a view, and why neither alone would do
    ///
    /// The **program** is not the reader. A search that only opened a view would make every page of
    /// a filtered loop a thing the model has to look at, and a search that only returned a value
    /// would reach the model on no turn at all unless the program spent a `view.openText` on it —
    /// which is a call the program has to remember to make, in a design where searching is the only
    /// way to find anything. So the host does it: one view, under one selector, replaced by the next
    /// search.
    ///
    /// The rendering is the host's rather than the program's for the same reason the documentation
    /// itself is: what a model reads about the surface is not a thing a program should be able to
    /// paraphrase. Refusals never open a view — a page that does not exist has nothing to show.
    fn search_docs(&mut self, query: DocSearchQuery) -> Result<DocSearchResult, ViewRefusal> {
        let page = self.docs.search(DocQuery {
            query: &query.query,
            modules: &query.modules,
            declared_type: query.declared_type.as_deref(),
            kind: query.kind.as_deref(),
            offset: query.offset,
            limit: query.limit,
        })?;
        let opened = self.context.open_search_view(
            SEARCH_RESULTS_VIEW.to_string(),
            render_search_results(&query, &page),
        );
        Ok(DocSearchResult {
            page,
            opened: SandboxViewOpened {
                kind: ViewKind::Search,
                selector: SEARCH_RESULTS_VIEW.to_string(),
                tokens: opened.tokens as u64,
                superseded: opened.superseded,
            },
        })
    }
    /// Open the documentation for `name`, plus — under this agent's [type
    /// flags](crate::docs::DocViewTypes) — the SDK types it names.
    ///
    /// # The whole algorithm, and what it deliberately does not do
    ///
    /// One call, one level. The named thing's own view is placed unless a view is already open under
    /// that key, in which case **nothing whatever happens to it** — not a move, not a re-emit. Then,
    /// for a *function* only, the types the mode selects are placed on the same terms. A type view
    /// never opens a second type view, so there is no recursion here, no closure to compute and no
    /// cycle to terminate: the depth is one because the rule is written at one level, not because a
    /// counter stops it.
    ///
    /// Nothing is deduplicated against anything but the live open set, and nothing remembers *why* a
    /// view was opened. A type opened beside `readFile` and then closed is re-opened by a later
    /// `openFile`, because the only question ever asked is whether that key is open now — which is
    /// exactly what makes closing a plain removal with no cascade.
    ///
    /// A key that resolves to nothing this agent binds is a [refusal](docs_not_found_refusal) and
    /// places nothing, including none of the types: a lookup that half-succeeded would leave the
    /// model holding records for a call it cannot make.
    ///
    /// A re-open of a function that is already open still places any of its types that are **not**,
    /// which is the one place the two halves come apart. That is the set model doing its work: the
    /// question is never "has this function been opened before", it is "is this key open now", and a
    /// model whose types were closed and whose function was not gets them back by asking for the
    /// function again — which is the only thing it has to ask for.
    fn open_docs_view(&mut self, name: String) -> Result<Vec<SandboxViewOpened>, ViewRefusal> {
        // Resolved to the one key the entry is filed under before anything is read, because an entry
        // answers to its bare name *and* to its fully-qualified one: filing the view under whichever
        // of the two the model happened to type would put the same page in the window twice for an
        // agent that spelled one lookup both ways. See `DocsRuntime::docview_key`.
        let Some((key, read)) = self
            .docs
            .docview_key(&name)
            .and_then(|key| Some((key.clone(), self.docs.read_any(&key)?)))
        else {
            return Err(docs_not_found_refusal(&name, &self.docs.suggest(&name)));
        };
        // Asked under the resolved key rather than the spelling the model typed, so the types beside
        // a loaded declaration are read off the entry the view itself was filed under. Resolved from
        // the surface and this agent's bound set, never from the window: what the mode selects is a
        // property of the declaration, and which of those are *already* open is the separate
        // question each `open_docview` answers for itself.
        let types = self.docs.types_to_open(&key, self.doc_view_types);
        let mut opened = Vec::new();
        if let DocviewOpen::Placed { tokens, superseded } =
            self.context.open_docview(key.clone(), read)
        {
            opened.push(SandboxViewOpened {
                kind: ViewKind::Docs,
                selector: key,
                tokens: tokens as u64,
                // True only where the page itself changed under a key already open, which is a
                // declaration of a module this agent revised and re-used.
                superseded,
            });
        }
        for referenced in types {
            // `read_any` rather than the type half alone: a type the flags placed beside a loaded
            // declaration is rendered by the loaded source, and one key rendering everything is what
            // keeps this path and a use of the same module opening the same pages.
            let Some(body) = self.docs.read_any(&referenced) else {
                continue;
            };
            if let DocviewOpen::Placed { tokens, superseded } =
                self.context.open_docview(referenced.clone(), body)
            {
                opened.push(SandboxViewOpened {
                    kind: ViewKind::Docs,
                    selector: referenced,
                    tokens: tokens as u64,
                    superseded,
                });
            }
        }
        Ok(opened)
    }

    /// Close the documentation view keyed by `key` — or every one of them, when `key` is `None` —
    /// and report how many went.
    ///
    /// The gate is the membrane's: an agent without
    /// [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE) never reaches here. What
    /// this owns is the removal and its record, and the record carries **where** the earliest
    /// removed item sat as well as what it reclaimed — because the documentation band is otherwise
    /// append-only, so this call is the only thing in a session that can invalidate a cached prompt
    /// prefix, and the tokens alone cannot say whether that trade was worth making.
    fn close_docviews(&mut self, key: Option<String>) -> Result<u32, ViewRefusal> {
        if let Some(key) = &key
            && let Some(refusal) = close_selector_refusal(key)
        {
            return Err(refusal);
        }
        let closed = self.context.close_docviews(key.as_deref());
        if let Some(event) = docs_close_event(key.as_deref(), &closed) {
            self.emitter.emit(event);
        }
        Ok(saturating_u32(closed.reclaimed.items))
    }
    /// Read a file and show it to the model — the one place a code turn pushes a
    /// [`FileView`](GgContextSource::FileView).
    ///
    /// The read itself is [`read_file`](Self::read_file) verbatim, so the gate, the telemetry pair,
    /// the session-record entry, the roster line and the read policy are the ones a bare `fs.readFile`
    /// gets; there is no second, quieter read path. What follows it is the view: the `(path,
    /// region)` key comes from what the tool actually **returned** rather than from what the call
    /// asked for (a capped policy applies its default when the call named no `limit`, a window
    /// running past the end of the file stops at the file's end, and a window covering the whole
    /// file is no region at all), so re-opening the same page supersedes it instead of stacking a
    /// second copy beside it.
    ///
    /// The content is cloned rather than moved out of the outcome because the outcome goes on to
    /// become the program's own return value — the model is handed the bytes *and* shown the file
    /// for the price of one read, which is the reason this call exists at all.
    ///
    /// # A picture is bounded by its size, and by nothing else
    ///
    /// A view is the only way a picture enters the window, and how many pictures may be open at once
    /// is no longer a question gg answers: what bounds them is `IMAGE_ATTACH_CAP`, 8 MiB **per
    /// image**, and the window's own fullness. A count cap here would refuse a model the thing it
    /// had just decided to look at, in exchange for a bound the fullness signal reports honestly and
    /// per-file.
    ///
    /// # The text body is capped, and long lines can be cut
    ///
    /// The view's text body is held to [`MAX_TEXT_VIEW_BYTES`] exactly as a text view's is: a window
    /// that would carry more is refused with the size and the bound, as the read's own failure —
    /// the same serviced `read_file`, recorded as failed — and nothing is opened. `max_line_chars`
    /// is what lets a window over a log of enormous lines fit: each line of the **view body** longer
    /// than it is cut there and annotated in place, the cap is measured after the cut, and what the
    /// program is handed back is the read's own untouched text. See [`file_view_outcome`].
    fn open_file_view(
        &mut self,
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
        max_line_chars: Option<usize>,
    ) -> ViewOpenOutcome {
        // The dispatch record is the read's own, argument for argument, and gains the view's one
        // option only when the program wrote it: a bare `openFile` is recorded exactly as a bare
        // `readFile` is, which is what lets the two be read as one read.
        let mut args = json!({ "path": path, "offset": offset, "limit": limit });
        if let Some(chars) = max_line_chars {
            args["maxLineChars"] = json!(chars);
        }
        let mut outcome = self.serviced(FILES_READ_FILE, args, |api| {
            if let Some(refusal) = line_cut_refusal(max_line_chars) {
                return ToolOutcome::failed(refusal.failure, refusal.message);
            }
            file_view_outcome(api.policy_read(&path, offset, limit), max_line_chars)
        });
        if !outcome.ok {
            // The read failed; there is nothing to show. The failure is already a rostered,
            // streamed, replayed `read_file` result, and the membrane throws it at the program.
            return ViewOpenOutcome {
                outcome,
                opened: None,
            };
        }
        let region = match &outcome.data {
            Some(ApiData::FileText(text)) => FileRegion::covered(
                text.first_line.into(),
                text.last_line.into(),
                text.total_lines.into(),
            ),
            _ => None,
        };
        // The lines the view shows, for its heading — from the same sidecar as the region, so the
        // heading and the key describe the same read.
        let lines = ShownLines::of_read(outcome.data.as_ref());
        // The picture, if the read produced one, moves out of the outcome and into the view item:
        // the model looks at it there, and leaving a copy behind would let the membrane attach a
        // second one to the turn.
        let images = std::mem::take(&mut outcome.images);
        let opened = self.context.open_file_view_deduped(
            path.clone(),
            region,
            lines,
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
        self.push_text_view(label, body)
    }
    /// Close every view carrying `selector` — every page of a path, the text view under a label, or
    /// the search-results view when the selector is the one it is keyed under.
    ///
    /// Every band it reaches is swept, because a selector is what the *model* wrote and it has no
    /// obligation to tell gg which kind it meant. A selector that names nothing closes `0`, which is
    /// a successful call: a program that tidies up unconditionally should not have to guard every
    /// call with a `current()` check.
    ///
    /// The search-results band is among them precisely because it is not the documentation band:
    /// nothing is lost by closing it (the same query answers the same way), and it is superseded on
    /// every search regardless, so a close of it can never be the thing that cost a run its cached
    /// prefix. A view the model can see in `current()` and cannot close would be a trap.
    ///
    /// The **documentation** band is deliberately *not* among them, and it is the one band this
    /// sweep does not reach.
    ///
    /// Closing documentation is [`close_docviews`](Self::close_docviews), because it is its own
    /// decision rather than a side effect of tidying: it is the one close that rewrites the middle
    /// of the prompt instead of appending to the end, so it costs the run every cached token after
    /// the view it took away, and it is bought by
    /// [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE) where this call is bought
    /// by [`agent-managed-context`](test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT) — the
    /// membrane has already asked that gate by the time this runs. A sweep that reached the
    /// documentation band would therefore have to either spend a second capability the caller did
    /// not ask about or silently do nothing for an agent that lacks it — and a call that answers
    /// `0` where the honest answer is *you may not* is
    /// indistinguishable, to the model reading it, from a selector that named nothing. `docs.close`
    /// refuses by name instead, which is an answer.
    ///
    /// Every arm's SDK now spells that call, so it is a route a model can actually take; while it
    /// did not, this sweep stood in for one, gated on the capability so the semantics were already
    /// these. Nothing stands in for it now, which is also what makes
    /// [`GgContextAction::CloseDocsViews`] mean one thing: `close_docviews` is its only producer, so
    /// two configurations differing in that capability can be compared on it, every documentation close
    /// attributed to the call that was bought.
    fn close_view(&mut self, selector: String) -> Result<u32, ViewRefusal> {
        if let Some(refusal) = close_selector_refusal(&selector) {
            return Err(refusal);
        }
        let files = self.context.evict_file_views(Some(&selector));
        let texts = self.context.close_text_views(Some(&selector));
        let searches = self.context.close_search_views(Some(&selector));
        for event in [
            view_close_event(GgContextAction::EvictFileViews, &selector, &files),
            view_close_event(GgContextAction::CloseTextViews, &selector, &texts),
            view_close_event(GgContextAction::CloseSearchViews, &selector, &searches),
        ]
        .into_iter()
        .flatten()
        {
            self.emitter.emit(event);
        }
        Ok(saturating_u32(files.items + texts.items + searches.items))
    }
    /// The shapes of the programs this agent's [library](crate::programs) still holds.
    ///
    /// Nothing is dispatched, nothing is charged and nothing is recorded: it reads gg's own state,
    /// which is the whole reason the library survives a compaction that would have taken the same
    /// programs out of the window.
    fn program_history(&mut self) -> Vec<ProgramSummary> {
        self.programs.summaries()
    }

    /// The source of one program this agent ran, or the refusal naming the ids that are held.
    fn program_source(&mut self, id: &str) -> Result<String, ProgramRefusal> {
        self.programs.source(id).map(str::to_string)
    }
}

/// What `docs` says about every operation it binds, against the documentation `context` was holding
/// — the snapshot one turn's [discovery](crate::discovery) check answers its calls from.
///
/// Resolved once, as the turn's api is built, because neither half can move while the turn runs: a
/// page's key is a projection of the catalogue through this agent's grants, and the window the model
/// read is the one it read. Bodies are dropped on the way past, since the only question asked of a
/// view here is whether its key was open.
fn documented_operations(context: &ContextModel, docs: &DocsRuntime) -> BTreeMap<String, bool> {
    let open: BTreeSet<String> = context
        .open_docviews()
        .into_iter()
        .map(|view| view.key)
        .collect();
    docs.documented_operations(&open)
}

/// **Open a documentation view of every callable declaration the module loaded at `key` offers**,
/// and of the types this agent's [flags](DocViewTypes) place beside them.
///
/// It is [`open_docs_view`](LoopOperationApi::open_docs_view) in every respect that matters, and
/// deliberately: the same [rendering](DocsRuntime::read_any) and the same
/// [placement](ContextModel::open_docview), which does nothing whatever to a key already open. What
/// differs is only who asked — gg, on the model's behalf, because a use is the moment the model
/// needs the manual and the moment it can least afford a round trip to ask for it. A **second** use
/// therefore opens nothing new, which is what makes using a skill again the cheap recovery it is
/// described as.
///
/// A key the runtime does not resolve is skipped rather than placed empty. That is not defensive: it
/// is the same `None` a [restore](crate::persistence::restore_docviews) reads to drop a view of a
/// module the instance has not loaded, and reaching it here would mean a module was registered and
/// then unregistered inside one call.
///
/// Nothing is reported. The views are in the window and the window is what the model reads next
/// turn; a count of them in the reply would be gg narrating a thing the model is about to see.
///
/// Free rather than a method because what it needs is three things and not a turn: the window, the
/// runtime that renders a key, and the flags. Both callers — a use and a
/// [scratchpad write](LoopOperationApi::loaded_on_write), which is the one strategy where the write
/// *is* the use — reach it through the api, and it is asserted without one.
fn open_loaded_docviews(
    context: &mut ContextModel,
    docs: &DocsRuntime,
    types: DocViewTypes,
    key: &str,
) {
    for view in docs.use_views(key, types) {
        let Some(body) = docs.read_any(&view) else {
            continue;
        };
        context.open_docview(view, body);
    }
}

#[cfg(test)]
#[path = "agent.code.views.test.rs"]
mod view_tests;

#[cfg(test)]
#[path = "agent.code.knowledge.test.rs"]
mod knowledge_tests;

#[cfg(test)]
#[path = "agent.code.feedback.test.rs"]
mod feedback_tests;
