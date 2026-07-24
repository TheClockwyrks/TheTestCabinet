//! Tests for the [`execute`] envelope entry — the boundary the wasm ABI drives:
//! request decoding, the outcome shape, and the failure-phase classification.

use serde_json::{Value, json};

use super::{FailureKind, ProgramOutcome, ToolHost, execute};

/// A host that records calls and always succeeds — enough to exercise the envelope.
struct RecordingHost {
    calls: Vec<String>,
}

impl ToolHost for RecordingHost {
    fn call_tool(&mut self, name: &str, args: &Value) -> Value {
        self.calls.push(name.to_string());
        json!({ "ok": true, "output": format!("ran {name}"), "summary": Value::Null, "args": args })
    }
}

/// Build a request envelope JSON for `source`.
fn request(source: &str) -> String {
    json!({ "source": source }).to_string()
}

/// Run `source` through `execute` and parse the outcome envelope back.
fn run_envelope(source: &str, host: &mut dyn ToolHost) -> ProgramOutcome {
    let json = execute(&request(source), host);
    serde_json::from_str(&json).expect("the outcome envelope round-trips")
}

#[test]
fn a_successful_run_reports_ok_result_and_steps() {
    let mut host = RecordingHost { calls: Vec::new() };
    let outcome = run_envelope(
        r#"let r = shell({ command: "ls" }); return r.output;"#,
        &mut host,
    );
    assert!(outcome.ok);
    assert_eq!(outcome.result, json!("ran shell"));
    assert!(outcome.error.is_none());
    assert!(outcome.failure.is_none());
    assert!(outcome.steps > 0);
    assert_eq!(host.calls, vec!["shell"]);
}

#[test]
fn a_lex_error_is_classified() {
    let mut host = RecordingHost { calls: Vec::new() };
    let outcome = run_envelope(r#"return "unterminated;"#, &mut host);
    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(FailureKind::Lex));
    assert!(host.calls.is_empty());
}

#[test]
fn a_parse_error_is_classified() {
    let mut host = RecordingHost { calls: Vec::new() };
    let outcome = run_envelope("let x = ;", &mut host);
    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(FailureKind::Parse));
}

#[test]
fn a_runtime_fault_is_classified() {
    let mut host = RecordingHost { calls: Vec::new() };
    let outcome = run_envelope("return nope;", &mut host);
    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(FailureKind::Runtime));
}

#[test]
fn a_step_limit_is_classified() {
    let mut host = RecordingHost { calls: Vec::new() };
    let request = json!({ "source": "while true {}", "stepLimit": 500 }).to_string();
    let outcome: ProgramOutcome =
        serde_json::from_str(&execute(&request, &mut host)).expect("round-trips");
    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(FailureKind::StepLimit));
}

#[test]
fn a_malformed_request_envelope_is_reported_not_panicked() {
    let mut host = RecordingHost { calls: Vec::new() };
    let outcome: ProgramOutcome =
        serde_json::from_str(&execute("not json", &mut host)).expect("round-trips");
    assert!(!outcome.ok);
    assert_eq!(outcome.failure, Some(FailureKind::Parse));
}
