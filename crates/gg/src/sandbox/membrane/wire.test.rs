//! Tests for the [wire](super)'s host side: that every operation is reachable through it, that a
//! refusal arrives as the refusal it already was, and that gg's own drift is reported as gg's.
//!
//! No wasm here, for the reason [the membrane's own tests](super::super) carry none: the `Host`
//! implementation is ordinary Rust and can be driven at microseconds per call. The end-to-end
//! crossing — a real compiled Java program, a real component, a real trap — is in
//! `crates/gg/src/sandbox/language/jvm.wire.test.rs`, where it pays for a compiler.

use super::wire_coding::{Value, decode_response};
use super::*;
use crate::sandbox::fake::{CallLog, canned_outcome, membrane, membrane_with};
use crate::sandbox::operations::{OPERATIONS, SHELL_SHELL};

/// Encode an argument list the way a guest would.
fn request(arguments: Vec<Value>) -> Vec<u8> {
    super::wire_coding::encode_ok(&Value::List(arguments))[1..].to_vec()
}

/// **One whole crossing**, the way a guest makes it: `call` runs the operation and answers how many
/// bytes it is holding, and `take` hands them over.
///
/// The two are never apart in a program — the SDK's `Abi.call` makes both in one method — so they
/// are never apart here either, and the length `call` promised is checked against the bytes `take`
/// produced. A guest sizes its arena from that number, so a host that answered one and handed over
/// the other would hand a program a truncated frame or an over-large one.
fn crossing<A: crate::sandbox::membrane::ToolApi>(
    state: &mut MembraneState<A>,
    op: &str,
    request: Vec<u8>,
) -> Vec<u8> {
    let promised = WireHost::call(state, op.to_string(), request);
    let handed = WireHost::take(state);
    assert_eq!(
        handed.len(),
        promised as usize,
        "`{op}` promised {promised} bytes and handed over {}",
        handed.len()
    );
    handed
}

/// The three fields of a failed response, or `None` when the call succeeded.
fn failure(response: &[u8]) -> Option<(String, String, String)> {
    decode_response(response).expect("a response decodes").err()
}

/// The value a successful response carried.
fn answer(response: &[u8]) -> Value {
    decode_response(response)
        .expect("a response decodes")
        .unwrap_or_else(|failed| panic!("the call failed: {failed:?}"))
}

/// **Every operation gg has is reachable through this wire.**
///
/// It calls each rendered id with **no arguments**, which every operation that takes any will
/// refuse — what it asserts is only that the refusal is not `is not a call gg has`, because that one
/// means gg grew an operation and this file did not grow an arm.
///
/// That is the whole of what it proves, and it is deliberately the cheap half. What an arm *does*
/// with an argument list is asserted next door, in
/// [the argument gate](super::argument_tests), which builds each call's arguments from gg's own WIT
/// and drives every id with them.
#[test]
fn every_operation_is_reachable_through_the_wire() {
    let log = CallLog::default();
    let mut state = membrane(&log);
    let mut unreachable = Vec::new();
    for operation in OPERATIONS {
        let id = operation.id.to_string();
        let response = crossing(&mut state, &id, request(Vec::new()));
        if let Some((_, _, message)) = failure(&response)
            && message.contains("is not a call gg has")
        {
            unreachable.push(id);
        }
    }
    assert!(
        unreachable.is_empty(),
        "gg has operations the JVM wire cannot reach: {unreachable:?}"
    );
}

/// The feedback channel is reachable too, and is deliberately not in the operations table.
#[test]
fn the_feedback_channel_is_reachable_and_is_not_an_operation() {
    let log = CallLog::default();
    let mut state = membrane(&log);
    for id in NON_OPERATIONS {
        assert!(
            crate::sandbox::operations::operation_by_id(id).is_none(),
            "`{id}` is in the operations table, so it is gated and this file's claim is wrong"
        );
        let response = crossing(&mut state, id, request(Vec::new()));
        if let Some((_, _, message)) = failure(&response) {
            assert!(
                !message.contains("is not a call gg has"),
                "`{id}` is not reachable through the wire"
            );
        }
    }
}

/// A call gg has no row for is a **fault**, reported as gg's own defect rather than as something the
/// program did.
#[test]
fn a_call_gg_does_not_have_is_reported_as_ggs_defect() {
    let log = CallLog::default();
    let mut state = membrane(&log);
    let response = crossing(&mut state, "files.teleport", request(Vec::new()));
    let (tool, code, message) = failure(&response).expect("an unknown call fails");
    assert_eq!(
        tool, "teleport",
        "the failure is not reported under the key"
    );
    assert_eq!(code, "other");
    assert!(
        message.contains("is not a call gg has") && message.contains("defect in gg"),
        "the message does not say whose defect it is: {message}"
    );
}

/// A request that does not decode is the same: gg's defect, said in gg's words, with nothing done.
#[test]
fn a_request_that_does_not_decode_is_reported_as_ggs_defect() {
    let log = CallLog::default();
    let mut state = membrane(&log);
    let response = crossing(&mut state, "files.read_file", vec![99]);
    let (tool, code, message) = failure(&response).expect("a malformed request fails");
    assert_eq!(tool, "read_file");
    assert_eq!(code, "other");
    assert!(
        message.contains("defect in gg"),
        "the message does not say whose defect it is: {message}"
    );
    assert!(
        log.calls().is_empty(),
        "a request that did not decode reached the loop anyway"
    );
}

/// **A call this agent was not granted is refused here in the same words as everywhere else.**
///
/// The point of dispatching through the typed host functions rather than reimplementing them: the
/// capability gate is not consulted by this file at all, and cannot therefore disagree with the one
/// the other ten arms meet.
#[test]
fn a_call_outside_the_allowlist_is_refused_with_the_membranes_own_words() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &[SHELL_SHELL], None, canned_outcome);
    let response = crossing(&mut state, "files.list_dir", request(vec![Value::None]));
    let (tool, code, _) = failure(&response).expect("a withheld call is refused");
    assert_eq!(tool, "list_dir");
    assert_eq!(code, "unavailable");
    assert!(
        log.calls().is_empty(),
        "a refused call reached the loop anyway"
    );
}

/// A whole call, end to end through the host: arguments in, the loop reached, a record back.
#[test]
fn a_granted_call_reaches_the_loop_and_answers_with_a_record() {
    let log = CallLog::default();
    let mut state = membrane(&log);
    let response = crossing(
        &mut state,
        "shell.shell",
        request(vec![Value::Text("echo hi".to_string()), Value::None]),
    );
    let value = answer(&response);
    assert!(
        matches!(
            value.field("the output", "truncated"),
            Ok(Value::Bool(false))
        ),
        "the shell output did not come back as a record: {value:?}"
    );
    assert_eq!(
        log.calls().len(),
        1,
        "the call did not reach the loop exactly once"
    );
}

/// A failed tool comes back as the three fields of the `tool-error` it already was — the same code,
/// the same key, the same sentence the other ten arms are given.
///
/// `read_text_file` over a picture is the failure chosen because the host function *itself* raises
/// it, on the narrowing that is the whole difference between it and `read_file`: so what is asserted
/// is that a `tool-error` built inside the typed implementation crosses this wire unaltered, rather
/// than that a fake said no.
#[test]
fn a_failed_tool_comes_back_as_the_tool_error_it_already_was() {
    let log = CallLog::default();
    let mut state = membrane(&log);
    let response = crossing(
        &mut state,
        "files.read_text_file",
        request(vec![
            Value::Text("logo.png".to_string()),
            Value::None,
            Value::None,
        ]),
    );
    let (tool, code, message) = failure(&response).expect("reading a picture as text fails");
    assert_eq!(tool, "read_text_file");
    assert_eq!(code, "invalid-argument");
    assert!(
        message.contains("logo.png") && message.contains("not text"),
        "the failure lost its own sentence: {message}"
    );
}

/// Every one of gg's eight error codes has a wire spelling, and it is the WIT case name.
#[test]
fn every_error_code_has_the_wits_own_spelling() {
    for (code, name) in [
        (ErrorCode::InvalidArgument, "invalid-argument"),
        (ErrorCode::NotFound, "not-found"),
        (ErrorCode::Conflict, "conflict"),
        (ErrorCode::Refused, "refused"),
        (ErrorCode::Unavailable, "unavailable"),
        (ErrorCode::LimitExceeded, "limit-exceeded"),
        (ErrorCode::IoError, "io-error"),
        (ErrorCode::Other, "other"),
    ] {
        assert_eq!(code_name(code), name);
    }
}
