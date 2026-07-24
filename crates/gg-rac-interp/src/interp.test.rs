//! Interpreter unit tests — the pure tree-walk against a mock [`ToolHost`], with no
//! wasm and no network. These are the engine's behavioural ground truth: control flow,
//! ordered tool composition, error surfacing, and the termination budget.

use serde_json::{Value, json};

use super::{RunConfig, RunOutcome, ToolHost, run};
use crate::lexer::lex;
use crate::parser::parse;

/// A mock tool host that records every call in order and returns a scripted outcome.
/// Determinism comes for free: it consults only its own tables.
struct MockHost {
    /// Every `(name, args)` the program called, in call order.
    calls: Vec<(String, Value)>,
    /// Tools that should report failure (an `ok: false` outcome) — to exercise a tool
    /// error surfacing *into* the script as an ordinary value.
    failing: Vec<String>,
}

impl MockHost {
    fn new() -> Self {
        Self {
            calls: Vec::new(),
            failing: Vec::new(),
        }
    }

    fn failing(mut self, name: &str) -> Self {
        self.failing.push(name.to_string());
        self
    }

    /// The names called, in order — the ordering assertion the tests lean on.
    fn call_names(&self) -> Vec<String> {
        self.calls.iter().map(|(name, _)| name.clone()).collect()
    }
}

impl ToolHost for MockHost {
    fn call_tool(&mut self, name: &str, args: &Value) -> Value {
        self.calls.push((name.to_string(), args.clone()));
        let ok = !self.failing.iter().any(|f| f == name);
        // Echo the arguments back in the output so a script can thread a tool's result
        // onward, mirroring the real `{ok, output, summary}` outcome shape.
        json!({
            "ok": ok,
            "output": if ok { format!("ran {name}") } else { format!("{name} failed") },
            "summary": Value::Null,
            "args": args,
        })
    }
}

/// Lex, parse, and run `source` against `host` with a default budget.
fn run_source(source: &str, host: &mut dyn ToolHost) -> RunOutcome {
    run_source_with(source, host, RunConfig::default())
}

fn run_source_with(source: &str, host: &mut dyn ToolHost, config: RunConfig) -> RunOutcome {
    let tokens = lex(source).expect("source lexes");
    let ast = parse(&tokens).expect("source parses");
    run(&ast, host, config)
}

#[test]
fn returns_a_computed_value() {
    let mut host = MockHost::new();
    let outcome = run_source("let x = 2; let y = 3; return x * y + 1;", &mut host);
    assert_eq!(outcome.result, Ok(json!(7.0)));
}

#[test]
fn running_off_the_end_returns_null() {
    let mut host = MockHost::new();
    let outcome = run_source("let x = 1;", &mut host);
    assert_eq!(outcome.result, Ok(Value::Null));
}

#[test]
fn a_loop_a_conditional_and_several_tool_calls_compose_in_order() {
    // The headline scenario: iterate a list, branch per item, and fire several tool
    // calls whose order is exactly the evaluation order.
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
    let mut host = MockHost::new();
    let outcome = run_source(source, &mut host);

    // Control flow: only the two `.txt` files were written.
    assert_eq!(outcome.result, Ok(json!(["a.txt", "c.txt"])));

    // Ordered composition: read every file, write only the `.txt` ones, interleaved.
    assert_eq!(
        host.call_names(),
        vec![
            "read_file",  // a.txt
            "write_file", // a.txt (is .txt)
            "read_file",  // b.log
            "read_file",  // c.txt
            "write_file", // c.txt (is .txt)
        ]
    );
    // The arguments really flowed through: the first write carried the first read's
    // path.
    assert_eq!(
        host.calls[1].1,
        json!({ "path": "a.txt", "body": "ran read_file" })
    );
}

#[test]
fn while_loop_accumulates() {
    let source = r#"
        let i = 0;
        let total = 0;
        while i < 5 {
            total = total + i;
            i = i + 1;
        }
        return total;
    "#;
    let mut host = MockHost::new();
    assert_eq!(run_source(source, &mut host).result, Ok(json!(10.0)));
}

#[test]
fn a_tool_error_surfaces_into_the_script_as_a_value() {
    // A failing tool is not a fault — the script sees `ok: false` and can branch on it.
    let source = r#"
        let r = build({ target: "app" });
        if r.ok {
            return "built";
        } else {
            return "recovered from: " + r.output;
        }
    "#;
    let mut host = MockHost::new().failing("build");
    let outcome = run_source(source, &mut host);
    assert_eq!(outcome.result, Ok(json!("recovered from: build failed")));
    assert_eq!(host.call_names(), vec!["build"]);
}

#[test]
fn short_circuit_avoids_the_second_tool_call() {
    // `false && rhs` must not evaluate the right-hand tool call.
    let source = r#"
        let go = false;
        if go && probe({}).ok {
            return "probed";
        }
        return "skipped";
    "#;
    let mut host = MockHost::new();
    let outcome = run_source(source, &mut host);
    assert_eq!(outcome.result, Ok(json!("skipped")));
    assert!(host.calls.is_empty(), "the guarded tool call must not fire");
}

#[test]
fn print_is_captured_in_the_logs() {
    let mut host = MockHost::new();
    let outcome = run_source(r#"print("hello"); print(1 + 1); return 0;"#, &mut host);
    assert_eq!(outcome.logs, vec!["hello".to_string(), "2.0".to_string()]);
}

#[test]
fn fuel_style_step_budget_terminates_a_runaway_loop() {
    // An infinite loop is stopped by the step budget with a StepLimit fault, never
    // hangs.
    let source = "while true { let x = 1; }";
    let mut host = MockHost::new();
    let config = RunConfig { step_limit: 1_000 };
    let outcome = run_source_with(source, &mut host, config);
    let err = outcome.result.expect_err("a runaway loop is stopped");
    assert_eq!(err.kind, super::RuntimeErrorKind::StepLimit);
    assert!(outcome.steps >= 1_000);
}

#[test]
fn a_program_fault_is_returned_not_panicked() {
    let mut host = MockHost::new();
    let outcome = run_source("return missing_var;", &mut host);
    let err = outcome.result.expect_err("an unbound variable faults");
    assert_eq!(err.kind, super::RuntimeErrorKind::Message);
    assert!(err.message.contains("missing_var"));
}

#[test]
fn division_by_zero_faults_cleanly() {
    let mut host = MockHost::new();
    let outcome = run_source("return 1 / 0;", &mut host);
    assert!(outcome.result.is_err());
}

#[test]
fn nested_lvalue_assignment_builds_up_a_structure() {
    let source = r#"
        let out = {};
        out.name = "carom";
        out.tags = [];
        out.tags = push(out.tags, "billiards");
        return out;
    "#;
    let mut host = MockHost::new();
    assert_eq!(
        run_source(source, &mut host).result,
        Ok(json!({ "name": "carom", "tags": ["billiards"] }))
    );
}

#[test]
fn builtins_over_collections() {
    let mut host = MockHost::new();
    assert_eq!(
        run_source(r#"return len([1, 2, 3]);"#, &mut host).result,
        Ok(json!(3.0))
    );
    assert_eq!(
        run_source(r#"return keys({ b: 1, a: 2 });"#, &mut host).result,
        // Map keys are sorted (deterministic BTreeMap backing).
        Ok(json!(["a", "b"]))
    );
    assert_eq!(
        run_source(r#"return range(3);"#, &mut host).result,
        Ok(json!([0.0, 1.0, 2.0]))
    );
    assert_eq!(
        run_source(r#"return get({ a: 1 }, "b", "fallback");"#, &mut host).result,
        Ok(json!("fallback"))
    );
}

#[test]
fn map_iteration_yields_sorted_key_value_pairs() {
    let source = r#"
        let m = { b: 2, a: 1 };
        let out = [];
        for pair in m {
            out = push(out, pair[0]);
        }
        return out;
    "#;
    let mut host = MockHost::new();
    assert_eq!(run_source(source, &mut host).result, Ok(json!(["a", "b"])));
}

#[test]
fn a_tool_argument_must_be_a_map() {
    let mut host = MockHost::new();
    let outcome = run_source(r#"return shell(42);"#, &mut host);
    let err = outcome.result.expect_err("a non-map tool argument faults");
    assert!(err.message.contains("map"));
    assert!(host.calls.is_empty());
}

#[test]
fn deterministic_across_repeated_runs() {
    let source = r#"
        let out = [];
        for i in range(4) {
            let r = step({ i: i });
            out = push(out, r.output);
        }
        return out;
    "#;
    let mut first = MockHost::new();
    let mut second = MockHost::new();
    let a = run_source(source, &mut first);
    let b = run_source(source, &mut second);
    assert_eq!(a.result, b.result);
    assert_eq!(first.call_names(), second.call_names());
    assert_eq!(a.steps, b.steps);
}
