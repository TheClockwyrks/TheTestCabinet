//! End-to-end tests for the responses-as-code sandbox: they load the **committed**
//! interpreter wasm and drive it through wasmtime against an in-memory fake tool
//! invoker — exercising the full guest/host round-trip (control flow, ordered tool
//! composition, a tool error surfacing into the script, fuel exhaustion, and
//! determinism) with no model and no network.
//!
//! A second test bridges the *real* [`ToolRegistry`] through [`RegistryToolInvoker`]
//! on a blocking thread, proving the production async-dispatch path.

use std::sync::Mutex;

use serde_json::{Value, json};

use super::{RacError, RacLimits, RegistryToolInvoker, ScriptToolInvoker, run_script};
use crate::tools::ToolOutcome;

/// A fake invoker that records every `(name, args)` in order and returns a scripted
/// outcome — deterministic, since it consults only its own tables.
struct FakeInvoker {
    calls: Mutex<Vec<(String, Value)>>,
    failing: Vec<String>,
}

impl FakeInvoker {
    fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            failing: Vec::new(),
        }
    }

    fn failing(mut self, name: &str) -> Self {
        self.failing.push(name.to_string());
        self
    }

    fn call_names(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }
}

impl ScriptToolInvoker for FakeInvoker {
    fn invoke(&self, name: &str, args: &Value) -> ToolOutcome {
        self.calls
            .lock()
            .unwrap()
            .push((name.to_string(), args.clone()));
        if self.failing.iter().any(|f| f == name) {
            ToolOutcome::error(format!("{name} failed"))
        } else {
            ToolOutcome::ok(format!("ran {name}"), format!("did {name}"))
        }
    }
}

/// The default sandbox limits for the fast tests.
fn limits() -> RacLimits {
    RacLimits::default()
}

#[test]
fn a_trivial_program_returns_its_value_through_the_sandbox() {
    let invoker = FakeInvoker::new();
    let run = run_script("return 40 + 2;", limits(), &invoker).expect("the sandbox runs");
    assert!(run.outcome.ok);
    assert_eq!(run.outcome.result, json!(42.0));
    assert!(run.tool_calls.is_empty());
    assert!(
        run.fuel_consumed > 0,
        "running the interpreter consumes fuel"
    );
}

#[test]
fn a_loop_a_conditional_and_several_tool_calls_run_in_order() {
    // The headline scenario, exercised through the real wasm interpreter.
    let source = r#"
        let files = ["a.txt", "b.log", "c.txt"];
        let kept = [];
        for f in files {
            let r = read_file({ path: f });
            if contains(f, ".txt") {
                write_file({ path: f, body: r.output });
                kept = push(kept, f);
            }
        }
        return kept;
    "#;
    let invoker = FakeInvoker::new();
    let run = run_script(source, limits(), &invoker).expect("the sandbox runs");

    // Control flow worked: only the two `.txt` files were kept.
    assert!(run.outcome.ok, "outcome: {:?}", run.outcome);
    assert_eq!(run.outcome.result, json!(["a.txt", "c.txt"]));

    // The tool calls fired in exactly the composed order — recorded by the host.
    let names: Vec<&str> = run.tool_calls.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "read_file",
            "write_file",
            "read_file",
            "read_file",
            "write_file"
        ]
    );
    // The host's record and the fake invoker's record agree.
    assert_eq!(invoker.call_names(), names);
    // Arguments really crossed the boundary: the first write carried the first read's
    // output.
    assert_eq!(
        run.tool_calls[1].arguments,
        json!({ "path": "a.txt", "body": "ran read_file" })
    );
}

#[test]
fn a_tool_error_surfaces_into_the_script() {
    let source = r#"
        let r = build({ target: "app" });
        if r.ok { return "built"; }
        return "recovered: " + r.output;
    "#;
    let invoker = FakeInvoker::new().failing("build");
    let run = run_script(source, limits(), &invoker).expect("the sandbox runs");
    assert!(run.outcome.ok, "a tool error is not a sandbox failure");
    assert_eq!(run.outcome.result, json!("recovered: build failed"));
    assert_eq!(run.tool_calls.len(), 1);
    assert!(!run.tool_calls[0].ok, "the recorded call is marked failed");
}

#[test]
fn print_output_is_returned_for_telemetry() {
    let invoker = FakeInvoker::new();
    let run = run_script(r#"print("step one"); return 0;"#, limits(), &invoker)
        .expect("the sandbox runs");
    assert_eq!(run.outcome.logs, vec!["step one".to_string()]);
}

#[test]
fn fuel_exhaustion_terminates_a_runaway_script() {
    // A tight fuel ceiling stops a runaway loop deterministically. The interpreter's
    // own step budget is huge here, so it is the *host fuel* that trips.
    let invoker = FakeInvoker::new();
    let err = run_script(
        "while true { let x = 1; }",
        RacLimits {
            fuel: 200_000,
            max_memory_bytes: 268_435_456,
        },
        &invoker,
    )
    .expect_err("a runaway script is stopped by fuel");
    assert!(matches!(err, RacError::OutOfFuel), "got {err:?}");
}

#[test]
fn a_parse_error_is_an_outcome_not_a_sandbox_error() {
    // A malformed program is the model's fault, reported in the outcome — the sandbox
    // itself did not fail.
    let invoker = FakeInvoker::new();
    let run = run_script("let x = ;", limits(), &invoker).expect("the sandbox runs");
    assert!(!run.outcome.ok);
    assert_eq!(run.outcome.failure, Some(gg_rac_interp::FailureKind::Parse));
    assert!(run.tool_calls.is_empty());
}

#[test]
fn runs_are_deterministic() {
    let source = r#"
        let out = [];
        for i in range(4) {
            let r = step({ i: i });
            out = push(out, r.output);
        }
        return out;
    "#;
    let first = run_script(source, limits(), &FakeInvoker::new()).expect("runs");
    let second = run_script(source, limits(), &FakeInvoker::new()).expect("runs");
    assert_eq!(first.outcome.result, second.outcome.result);
    assert_eq!(first.fuel_consumed, second.fuel_consumed);
    let names_a: Vec<&str> = first.tool_calls.iter().map(|c| c.name.as_str()).collect();
    let names_b: Vec<&str> = second.tool_calls.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names_a, names_b);
}

/// The production path: bridge a script's tool calls to the *real* [`ToolRegistry`]
/// (filesystem tools over a temp workspace) through [`RegistryToolInvoker`], run on a
/// blocking thread as the loop will. This proves the async-dispatch bridge, not just
/// the fake seam.
#[test]
fn bridges_the_real_tool_registry_via_the_registry_invoker() {
    use std::sync::Arc;

    use test_cabinet_core::gg::{CAPABILITY_FILESYSTEM, GgCapabilityConfig, GgCapabilitySet};

    use crate::skills::SkillLibrary;
    use crate::tools::{RuntimeSet, ToolContext, ToolRegistry};

    let workspace = tempfile::tempdir().expect("temp workspace");
    let context = ToolContext::new(workspace.path());

    // A filesystem-only toolset — the script will write a file and read it back.
    let capabilities = GgCapabilitySet {
        preset: None,
        capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM)],
        slots: Vec::new(),
        disabled_tools: Vec::new(),
    };
    let skills = Arc::new(SkillLibrary::empty());
    let registry = ToolRegistry::from_run(&capabilities, &RuntimeSet::new(&skills));

    // A program that composes two real tool calls: write then read (the filesystem
    // `write_file` tool takes `path` + `contents`).
    let source = r#"
        write_file({ path: "note.txt", contents: "hello from rac" });
        let r = read_file({ path: "note.txt" });
        return r.output;
    "#;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .expect("runtime");

    let result = runtime.block_on(async {
        let handle = tokio::runtime::Handle::current();
        // The loop runs the (blocking) sandbox off the async workers.
        tokio::task::spawn_blocking(move || {
            let invoker = RegistryToolInvoker::new(&registry, &context, handle);
            run_script(source, RacLimits::default(), &invoker)
        })
        .await
        .expect("blocking task joins")
    });

    let run = result.expect("the sandbox runs");
    assert!(run.outcome.ok, "outcome: {:?}", run.outcome);
    // The read-back tool output really contains what the write tool wrote.
    let output = run.outcome.result.as_str().unwrap_or_default();
    assert!(
        output.contains("hello from rac"),
        "read-back output was {output:?}"
    );
    let names: Vec<&str> = run.tool_calls.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["write_file", "read_file"]);
}
