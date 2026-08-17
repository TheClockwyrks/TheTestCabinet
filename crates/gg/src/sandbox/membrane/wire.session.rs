//! The [wire](super)'s session half: the three ending calls, the six delegation operations,
//! and the five functions of the feedback channel.
//!
//! **The feedback five are not operations.** They carry no capability, appear in no
//! [table](crate::sandbox::operations) and are gated by nothing, because they are the shim's own
//! channel back to gg rather than anything a run offers an agent. They are answered here for the
//! same reason the typed interface declares them: a guest that cannot reach them cannot say what it
//! logged, and a wire that answered forty-nine of fifty-five calls would be a wire somebody has to
//! remember the shape of.

use super::super::test_cabinet::gg::delegation::{
    AgentStatus, Host as DelegationHost, SpawnRequest, SubagentBrief, SubagentHandle,
    SubagentResult,
};
use super::super::test_cabinet::gg::feedback::{self, ErrorKind, ProgramError};
use super::super::test_cabinet::gg::session::Host as SessionHost;
use super::super::test_cabinet::gg::types::ErrorCode;
use super::super::{MembraneState, OperationApi};
use super::wire_coding::{VARIANT_CASE, VARIANT_VALUE, Value, WireFault, argument, record, text};
use super::{Answer, Failure};

// ---------------------------------------------------------------------------------------------
// Ending the session
// ---------------------------------------------------------------------------------------------

/// `session.finish` — declare the work complete.
pub(super) fn finish<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let summary = argument(arguments, op, 0)?.text("the summary")?;
    SessionHost::finish(state, summary)?;
    Ok(Value::None)
}

/// `session.approve` — approve what was reviewed.
pub(super) fn approve<A: OperationApi>(state: &mut MembraneState<A>) -> Answer {
    SessionHost::approve(state)?;
    Ok(Value::None)
}

/// `session.request_changes` — send the work back with a list of changes.
pub(super) fn request_changes<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let items = argument(arguments, op, 0)?.texts("a requested change")?;
    SessionHost::request_changes(state, items)?;
    Ok(Value::None)
}

// ---------------------------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------------------------

/// `delegation.spawn_subagent` — start a subagent.
pub(super) fn spawn_subagent<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let request = argument(arguments, op, 0)?;
    let request = SpawnRequest {
        agent: request.field("the request", "agent")?.text("the agent")?,
        task: subagent_brief(request.field("the request", "task")?)?,
    };
    Ok(subagent_handle(DelegationHost::spawn_subagent(
        state, request,
    )?))
}

/// `delegation.wait_for_subagents` — park until subagents return.
pub(super) fn wait_for_subagents<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let ids = argument(arguments, op, 0)?.optional_texts("a subagent id")?;
    Ok(Value::List(
        DelegationHost::wait_for_subagents(state, ids)?
            .into_iter()
            .map(subagent_result)
            .collect(),
    ))
}

/// `delegation.send_message` — send one agent a message.
pub(super) fn send_message<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let agent = argument(arguments, op, 0)?.text("the agent's id")?;
    let message = argument(arguments, op, 1)?.text("the message")?;
    DelegationHost::send_message(state, agent, message)?;
    Ok(Value::None)
}

/// `delegation.transition_state` — move this agent's issue to another state.
pub(super) fn transition_state<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let to = argument(arguments, op, 0)?.text("the state")?;
    let note = argument(arguments, op, 1)?.optional_text("the note")?;
    DelegationHost::transition_state(state, to, note)?;
    Ok(Value::None)
}

/// `delegation.exec` — hand this session to another agent.
pub(super) fn exec<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let agent = argument(arguments, op, 0)?.text("the agent")?;
    let prompt = argument(arguments, op, 1)?.optional_text("the prompt")?;
    DelegationHost::exec(state, agent, prompt)?;
    Ok(Value::None)
}

/// `delegation.fork` — start a copy of this agent.
pub(super) fn fork<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let prompt = argument(arguments, op, 0)?.text("the prompt")?;
    Ok(subagent_handle(DelegationHost::fork(state, prompt)?))
}

/// The `subagent-brief` variant.
fn subagent_brief(value: &Value) -> Result<SubagentBrief, Failure> {
    let case = value.field("the brief", VARIANT_CASE)?.text("the case")?;
    match case.as_str() {
        "prompt" => Ok(SubagentBrief::Prompt(
            value
                .field("the brief", VARIANT_VALUE)?
                .text("the prompt")?,
        )),
        "issue" => Ok(SubagentBrief::Issue(
            value
                .field("the brief", VARIANT_VALUE)?
                .text("the issue's id")?,
        )),
        other => Err(Failure::Fault(WireFault::new(format!(
            "`{other}` is not a subagent brief gg has"
        )))),
    }
}

/// The `subagent-handle` record.
fn subagent_handle(handle: SubagentHandle) -> Value {
    record([
        ("id", text(handle.id)),
        ("slot", text(handle.slot)),
        ("model-id", text(handle.model_id)),
    ])
}

/// One `subagent-result`.
fn subagent_result(result: SubagentResult) -> Value {
    record([
        ("id", text(result.id)),
        (
            "status",
            result.status.map_or(Value::None, |status| {
                text(match status {
                    AgentStatus::Completed => "completed",
                    AgentStatus::Exhausted => "exhausted",
                    AgentStatus::TimedOut => "timed-out",
                    AgentStatus::ModelError => "model-error",
                    AgentStatus::AuthError => "auth-error",
                    AgentStatus::LimitExceeded => "limit-exceeded",
                })
            }),
        ),
        ("summary", text(result.summary)),
    ])
}

// ---------------------------------------------------------------------------------------------
// The feedback channel
// ---------------------------------------------------------------------------------------------

/// `feedback.log` — one line the program produced.
pub(super) fn log<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let line = argument(arguments, op, 0)?.text("the line")?;
    feedback::Host::log(state, line);
    Ok(Value::None)
}

/// `feedback.note_return` — the program ended with a value gg discarded.
pub(super) fn note_return<A: OperationApi>(state: &mut MembraneState<A>) -> Answer {
    feedback::Host::note_return(state);
    Ok(Value::None)
}

/// `feedback.report_deferred` — a call landed after the program ended.
pub(super) fn report_deferred<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let note = argument(arguments, op, 0)?.text("the note")?;
    feedback::Host::report_deferred(state, note);
    Ok(Value::None)
}

/// `feedback.report_error` — the program failed and its guest described the failure.
pub(super) fn report_error<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let error = argument(arguments, op, 0)?;
    let error = ProgramError {
        kind: error_kind(error.field("the error", "kind")?)?,
        code: match error.field("the error", "code")? {
            Value::None => None,
            code => Some(error_code(code)?),
        },
        message: error.field("the error", "message")?.text("the message")?,
        location: error
            .field("the error", "location")?
            .optional_text("the location")?,
    };
    feedback::Host::report_error(state, error);
    Ok(Value::None)
}

/// `feedback.report_module_error` — a code module threw while it was being loaded.
pub(super) fn report_module_error<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    let name = argument(arguments, op, 0)?.text("the module's key")?;
    let message = argument(arguments, op, 1)?.text("the message")?;
    feedback::Host::report_module_error(state, name, message);
    Ok(Value::None)
}

/// The `error-kind` enum.
fn error_kind(value: &Value) -> Result<ErrorKind, Failure> {
    match value.text("the kind")?.as_str() {
        "api-failure" => Ok(ErrorKind::ApiFailure),
        "unknown-name" => Ok(ErrorKind::UnknownName),
        "other" => Ok(ErrorKind::Other),
        other => Err(Failure::Fault(WireFault::new(format!(
            "`{other}` is not an error kind gg has"
        )))),
    }
}

/// The `error-code` enum, read the way [`code_name`](super::code_name) writes it.
fn error_code(value: &Value) -> Result<ErrorCode, Failure> {
    match value.text("the code")?.as_str() {
        "invalid-argument" => Ok(ErrorCode::InvalidArgument),
        "not-found" => Ok(ErrorCode::NotFound),
        "conflict" => Ok(ErrorCode::Conflict),
        "refused" => Ok(ErrorCode::Refused),
        "unavailable" => Ok(ErrorCode::Unavailable),
        "limit-exceeded" => Ok(ErrorCode::LimitExceeded),
        "io-error" => Ok(ErrorCode::IoError),
        "other" => Ok(ErrorCode::Other),
        other => Err(Failure::Fault(WireFault::new(format!(
            "`{other}` is not an error code gg has"
        )))),
    }
}
