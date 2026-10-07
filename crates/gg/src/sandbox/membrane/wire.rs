//! **The one door the JVM arms come through**: the host side of `test-cabinet:gg/wire`.
//!
//! # Why this door exists at all, when fifteen typed interfaces already do
//!
//! Every other guest on this membrane reaches the typed interfaces directly, because every other
//! guest has a binding generator that writes the canonical ABI for them. **There is no
//! `wit-bindgen` for Java**, and none is coming. A Java or Kotlin program compiled through TeaVM
//! would otherwise have to carry a hand-written canonical-ABI lowering for every record, variant,
//! enum, `option` and `list` in a 1200-line WIT file — written once by hand and then kept in step
//! with it by hand, forever, on the arm gg has the least tooling for.
//!
//! So the two JVM arms implement the canonical ABI for **one string, two byte lists and a scalar**,
//! and gg owns what travels inside them. That is the whole of the trade, and it is the same trade
//! the arms already made when their far side was a JavaScript object rather than gg's Rust: one
//! bridge, written once, under a typed surface.
//!
//! One door, **two functions**: `call` runs the operation and answers how long its encoded result
//! is, holding the bytes, and `take` hands them over. That is not two doors — it is one crossing
//! split at the only moment a JVM guest may allocate. The interface's own note in
//! `crates/gg/wit/gg-sandbox.wit` carries the measurement it comes from.
//!
//! # This is not a second capability model, and it is not a generic door
//!
//! `op` is one of gg's own [rendered operation ids](crate::sandbox::operations) and nothing else,
//! and every one of them is answered by **calling the very same typed host function** the fifteen
//! interfaces are implemented by — `files`'s `read-file`, `board`'s `create-issue`, and so on
//! down the table. That means this file adds no policy of any kind: the
//! [capability gate](super::recording), the recorded call, the deadline, the picture collection and
//! the `api-error` are all reached exactly where they were, because they are reached through the
//! same functions.
//!
//! Two consequences worth stating plainly. A call this agent was not granted is refused **here** in
//! the same words it is refused everywhere else, because the refusal happens inside the host function
//! this dispatches to. And an operation added to gg without an arm below is a **fault**, not a
//! silently missing capability — `every_operation_is_reachable_through_the_wire` walks
//! [the operations table](crate::sandbox::operations::OPERATIONS) and fails by name.
//!
//! The seam's rule that a capability reaches a program as a typed, namespaced binding rather than as
//! a dispatcher taking a name as data is a rule about **what a model writes**. A model writing Java
//! writes `Files.readFile("notes.txt")` and one writing Kotlin writes
//! `gg.files.readFile("notes.txt")`; this is one layer below anything either can see, in a
//! package no catalogue describes.
//!
//! # What it cannot do
//!
//! Fail. `trappable_imports` is off here for the reason it is off for the whole membrane: a host
//! function that trapped would take the program down over something the model can neither see nor
//! fix. A request that does not decode, and an `op` with no row, therefore come back as an encoded
//! **`other`** failure whose message says the guest and the host have parted — which is what has in
//! fact happened, since the two are built from one checkout.

use super::test_cabinet::gg::types::{ApiError, ErrorCode};
use super::{MembraneState, OperationApi};

use wire_coding::{Value, WireFault, decode_request, encode_error, encode_ok};

#[path = "wire.coding.rs"]
pub(super) mod wire_coding;

#[path = "wire.context.rs"]
mod context;
#[path = "wire.knowledge.rs"]
mod knowledge;
#[path = "wire.session.rs"]
mod session;
#[path = "wire.workspace.rs"]
mod workspace;

wasmtime::component::bindgen!({ world: "jvm-sandbox", path: "wit" });

use test_cabinet::gg::wire::Host as WireHost;

/// What one dispatched call answered: a value to encode, or a failure to encode.
pub(super) type Answer = Result<Value, Failure>;

/// The two ways a call over this wire ends badly, which are told apart because only one of them is
/// about the program.
pub(super) enum Failure {
    /// gg refused the call or the tool behind it failed — the ordinary outcome a program catches.
    Api(ApiError),
    /// The request did not decode, or named an operation with no row. Never the model's doing: the
    /// SDK that lowered it and the host that read it are built from one checkout.
    Fault(WireFault),
}

impl From<ApiError> for Failure {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}

impl From<WireFault> for Failure {
    fn from(fault: WireFault) -> Self {
        Self::Fault(fault)
    }
}

impl<A: OperationApi> WireHost for MembraneState<A> {
    /// Decode one call, run it through the typed host function it names, and **hold** what came back
    /// for [`take`](WireHost::take) — answering its length.
    ///
    /// Two steps rather than one because of what the guest can allocate and when: see the interface's
    /// own note in `crates/gg/wit/gg-sandbox.wit`. Nothing about the dispatch changes; only where the
    /// bytes wait.
    fn call(&mut self, op: String, request: Vec<u8>) -> u32 {
        let held = match decode_request(&request) {
            Err(fault) => fault_response(&op, &fault),
            Ok(arguments) => match dispatch(self, &op, &arguments) {
                Ok(value) => encode_ok(&value),
                Err(Failure::Api(error)) => {
                    encode_error(&error.operation, code_name(error.code), &error.message)
                }
                Err(Failure::Fault(fault)) => fault_response(&op, &fault),
            },
        };
        // A response longer than `u32` cannot be described to a guest whose arrays are indexed by a
        // signed 32-bit int, so it becomes a failure saying so rather than a length that wrapped
        // into a frame the guest would read as something else. gg has no answer remotely near this;
        // what makes it worth a line is that the wrong answer would be silent.
        self.wire_held = match u32::try_from(held.len()) {
            Ok(_) => held,
            Err(_) => encode_error(
                key(&op),
                code_name(ErrorCode::Other),
                &format!(
                    "gg's answer to this call is {} bytes, which is past what this wire can \
                     describe. Nothing about the call failed; gg cannot hand the answer over.",
                    held.len()
                ),
            ),
        };
        u32::try_from(self.wire_held.len()).unwrap_or(u32::MAX)
    }

    /// Hand over the result [`call`](WireHost::call) is holding.
    ///
    /// Nothing held is gg's own drift rather than anything the program did — the SDK calls these two
    /// in one breath — so it answers in the words a request that did not decode answers in.
    fn take(&mut self) -> Vec<u8> {
        match std::mem::take(&mut self.wire_held) {
            held if held.is_empty() => fault_response(
                "wire.take",
                &WireFault::new("gg is holding no answer to hand over".to_string()),
            ),
            held => held,
        }
    }
}

/// Add the wire to a linker, so a component that imports it can be instantiated.
///
/// Carried unconditionally, beside the fifteen typed interfaces, because a component is affected
/// only by the imports it *declares* — the ten guests that reach gg the typed way never ask for this
/// one, and defining it costs them nothing. That is the same argument the whole WASI surface is
/// defined by.
pub(crate) fn add_to_linker<A: OperationApi>(
    linker: &mut wasmtime::component::Linker<MembraneState<A>>,
) -> wasmtime::Result<()> {
    test_cabinet::gg::wire::add_to_linker::<_, wasmtime::component::HasSelf<_>>(linker, |state| {
        state
    })
}

/// A failure that is gg's own, encoded as the program will read it.
///
/// Reported under the **key** of the operation the program named, so that a catch site branching on
/// `failure.operation()` sees the call it wrote even when what went wrong was underneath it. An `op` with
/// no dot at all has no key, and is reported whole.
fn fault_response(op: &str, fault: &WireFault) -> Vec<u8> {
    encode_error(
        key(op),
        code_name(ErrorCode::Other),
        &format!(
            "the call could not be decoded ({fault}); this is a defect in gg rather than in the \
             program. Nothing was done, and calling it again will not help."
        ),
    )
}

/// An operation id's **key**, which is what an `api-error` is reported under: `read_file` out of
/// `files.read_file`, so a catch site branching on `failure.operation()` sees the call the program wrote.
/// An id with no dot at all has no key and is reported whole.
fn key(op: &str) -> &str {
    op.split_once('.').map_or(op, |(_, key)| key)
}

/// The wire spelling of an error code — the WIT case name, verbatim.
///
/// Written out by hand rather than derived from the generated `Debug`, because what a program
/// branches on is a published value and a formatting change must not be able to move it.
fn code_name(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::InvalidArgument => "invalid-argument",
        ErrorCode::NotFound => "not-found",
        ErrorCode::Conflict => "conflict",
        ErrorCode::Refused => "refused",
        ErrorCode::Unavailable => "unavailable",
        ErrorCode::LimitExceeded => "limit-exceeded",
        ErrorCode::IoError => "io-error",
        ErrorCode::Other => "other",
    }
}

/// Run one call.
///
/// A flat match on the rendered id rather than a split-and-nest, because this is the list a reader
/// checks against [the operations table](crate::sandbox::operations::OPERATIONS) and a reader can
/// only check a list they can see. Every arm hands
/// off to the family file that carries the argument decoding and the result lowering for that
/// family; nothing is done here but the routing.
fn dispatch<A: OperationApi>(
    state: &mut MembraneState<A>,
    op: &str,
    arguments: &[Value],
) -> Answer {
    match op {
        // shell
        "shell.shell" => workspace::shell(state, op, arguments),
        // files
        "files.read_file" => workspace::read_file(state, op, arguments),
        "files.write_file" => workspace::write_file(state, op, arguments),
        "files.edit_file" => workspace::edit_file(state, op, arguments),
        "files.list_dir" => workspace::list_dir(state, op, arguments),
        "files.tree" => workspace::tree(state, op, arguments),
        "files.search" => workspace::search(state, op, arguments),
        // skills
        "skills.read_skill" => workspace::read_skill(state, op, arguments),
        // memories
        "memories.write_memory" => knowledge::write_memory(state, op, arguments),
        "memories.update_memory" => knowledge::update_memory(state, op, arguments),
        "memories.create_memory" => knowledge::create_memory(state, op, arguments),
        "memories.read_memory" => knowledge::read_memory(state, op, arguments),
        "memories.edit_memory" => knowledge::edit_memory(state, op, arguments),
        "memories.search_memories" => knowledge::search_memories(state, op, arguments),
        "memories.delete_memory" => knowledge::delete_memory(state, op, arguments),
        // tasks
        "tasks.add_task" => knowledge::add_task(state, op, arguments),
        "tasks.update_task" => knowledge::update_task(state, op, arguments),
        "tasks.set_blocked_by" => knowledge::set_blocked_by(state, op, arguments),
        "tasks.complete_task" => knowledge::complete_task(state, op, arguments),
        "tasks.remove_task" => knowledge::remove_task(state, op, arguments),
        // board
        "board.create_epic" => knowledge::create_epic(state, op, arguments),
        "board.create_issue" => knowledge::create_issue(state, op, arguments),
        "board.update_issue" => knowledge::update_issue(state, op, arguments),
        "board.set_issue_blocked_by" => knowledge::set_issue_blocked_by(state, op, arguments),
        "board.remove_epic" => knowledge::remove_epic(state, op, arguments),
        "board.remove_issue" => knowledge::remove_issue(state, op, arguments),
        "board.wait_for_issue" => knowledge::wait_for_issue(state, op, arguments),
        // context
        "context.evict_file_view" => context::evict_file_view(state, op, arguments),
        "context.archive_thread" => context::archive_thread(state, op, arguments),
        "context.search_archive" => context::search_archive(state, op, arguments),
        "context.compact" => context::compact(state, op, arguments),
        // docs
        "docs.search" => context::search(state, op, arguments),
        "docs.close" => context::close_doc_view(state, op, arguments),
        "docs.close_all" => context::close_doc_views(state),
        // views
        "views.open_file" => context::open_file_view(state, op, arguments),
        "views.open_text" => context::open_text_view(state, op, arguments),
        "views.open_docs_view" => context::open_docs_view(state, op, arguments),
        "views.close" => context::close_view(state, op, arguments),
        // programs
        "programs.history" => context::history(state),
        "programs.get" => context::get(state, op, arguments),
        "programs.rerun" => context::rerun(state, op, arguments),
        // session
        "session.finish" => session::finish(state, op, arguments),
        "session.approve" => session::approve(state),
        "session.request_changes" => session::request_changes(state, op, arguments),
        // delegation
        "delegation.spawn_subagent" => session::spawn_subagent(state, op, arguments),
        "delegation.wait_for_subagents" => session::wait_for_subagents(state, op, arguments),
        "delegation.send_message" => session::send_message(state, op, arguments),
        "delegation.transition_state" => session::transition_state(state, op, arguments),
        "delegation.exec" => session::exec(state, op, arguments),
        "delegation.fork" => session::fork(state, op, arguments),
        // feedback — the shim's private channel, which is not an operation, is gated by nothing and
        // is model-facing only in that a program's own logging travels over it.
        "feedback.log" => session::log(state, op, arguments),
        "feedback.note_return" => session::note_return(state),
        "feedback.report_deferred" => session::report_deferred(state, op, arguments),
        "feedback.report_error" => session::report_error(state, op, arguments),
        "feedback.report_module_error" => session::report_module_error(state, op, arguments),
        other => Err(Failure::Fault(WireFault::new(format!(
            "`{other}` is not a call gg has"
        )))),
    }
}

/// Every id [`dispatch`] answers that is **not** in [`OPERATIONS`] — the feedback channel, which is
/// the shim's own and belongs to no capability.
///
/// Named here so the gate below can subtract them rather than carrying its own copy of the list.
#[cfg(test)]
pub(super) const NON_OPERATIONS: &[&str] = &[
    "feedback.log",
    "feedback.note_return",
    "feedback.report_deferred",
    "feedback.report_error",
    "feedback.report_module_error",
];

#[cfg(test)]
#[path = "wire.test.rs"]
mod tests;

/// The gate that drives **every** arm with the arguments its own WIT function declares, which is the
/// one the reachability walk above cannot be.
#[cfg(test)]
#[path = "wire.arguments.test.rs"]
mod argument_tests;
