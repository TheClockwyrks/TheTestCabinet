//! End-to-end tests against the **committed component** — real TypeScript, really evaluated.
//!
//! # These cost a component compile each, so they are consolidated
//!
//! `cargo nextest` runs one process per test, and the first thing any test here does is compile the
//! ~13 MB artifact: ~1.2 s with the root manifest's cranelift `[profile.dev.package.*]` pins, ~7.6 s
//! without them. So each test function drives **many** programs against many stores rather than
//! being split one behaviour per function — the compile is per process, the instantiate is 24–124 µs.
//! Resist the urge to split these up; add a program to an existing function instead.
//!
//! The submodules below follow the same rule and share these helpers.

use std::time::Duration;

use serde_json::{Value, json};

use super::*;
use crate::context::ViewKind;
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{CallLog, FakeToolApi, all_tools, canned_outcome, typescript};
use crate::tools::{ToolFailure, ToolOutcome};

#[path = "sandbox.membrane.test.rs"]
mod membrane_tests;

#[path = "sandbox.faults.test.rs"]
mod fault_tests;

/// Run `program` with every tool bound, the canned invoker, and the default ceilings.
fn run(program: &str) -> (SandboxOutcome, CallLog) {
    run_with(
        program,
        &all_tools(),
        SandboxLimits::default(),
        canned_outcome,
    )
}

/// Run `program` against `enabled`'s tools under `limits`, answering calls with `responder`. The
/// program is given the [standard](EndingRole::Standard) ending group; [`run_as`] varies that.
fn run_with(
    program: &str,
    enabled: &[String],
    limits: SandboxLimits,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            enabled,
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
        },
        limits,
        None,
        FakeToolApi::with(&log, responder),
    );
    (outcome, log)
}

/// Run `program` with the [program library](crate::programs) bound and already holding `held`
/// (turn, source) — the one scope variation that is not a tool and not a role.
fn run_with_library(program: &str, held: &[(u64, &str)]) -> SandboxOutcome {
    let log = CallLog::default();
    let mut api = FakeToolApi::new(&log);
    for (turn, source) in held {
        api = api.with_program(*turn, source);
    }
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            enabled: &all_tools(),
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: true,
        },
        SandboxLimits::default(),
        None,
        api,
    );
    outcome
}

/// Run `program` in `role`'s ending group with no tools at all — what the ending calls are bound
/// beside, and what a program in a run that enables nothing still has.
fn run_as(program: &str, role: EndingRole) -> SandboxOutcome {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            enabled: &[],
            modules: &[],
            ending: RunEnding::Role(role),
            library: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    outcome
}

/// What a program logged, insisting that it ran and did not throw.
///
/// `console.log` is a program's only channel — a return value is discarded — so this is the whole of
/// what a program says, and every assertion about what one *produced* reads it.
fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program threw: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// The single line a program logged, parsed as JSON — the shape a program uses to hand back a value
/// now that a returned one goes nowhere.
fn logged_json(outcome: &SandboxOutcome) -> Value {
    let lines = logs(outcome);
    assert_eq!(
        lines.len(),
        1,
        "expected exactly one logged line: {lines:?}"
    );
    serde_json::from_str(&lines[0]).unwrap_or_else(|error| {
        panic!(
            "the program's one log line is not JSON ({error}): {}",
            lines[0]
        )
    })
}

/// The ending a program declared, insisting that it declared one.
fn completion(outcome: &SandboxOutcome) -> &ProgramCompletion {
    outcome
        .completion
        .as_ref()
        .unwrap_or_else(|| panic!("the program did not end its session: {:?}", outcome.result))
}

/// The summary a [`Finished`](Ending::Finished) ending carries, insisting that is what it was.
fn summary_of(completion: &ProgramCompletion) -> &str {
    match &completion.ending {
        Ending::Finished { summary } => summary,
        other => panic!("expected a finished ending, got {other:?}"),
    }
}

/// The throw a program did not catch, insisting that the sandbox itself did not fail.
fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .unwrap_or_else(|| panic!("the program did not throw; it logged {:?}", outcome.logs)),
        Err(error) => panic!("expected a program fault, but the sandbox failed: {error}"),
    }
}

/// A program computes, composes typed calls in order, and logs what it found — the whole point of
/// the capability, asserted against the real guest.
#[test]
fn a_program_runs_typed_calls_in_order() {
    // The floor: arithmetic, no tools, one line logged.
    let (outcome, log) = run("console.log(40 + 2);");
    assert_eq!(logs(&outcome), ["42"]);
    assert!(outcome.tool_calls.is_empty());
    assert!(log.calls().is_empty());
    assert!(
        outcome.elapsed > Duration::ZERO,
        "evaluating a program takes time; a zero reading means it never ran"
    );

    // The headline: list, filter, read each, write once, log a summary. This is the program the
    // capability exists for — it cannot be written at all against untyped tool output.
    let (outcome, log) = run(concat!(
        "const files = fs.listDir(\"src\").filter((e) => e.kind === \"file\" && e.name.endsWith(\".ts\"));\n",
        "const texts = files.map((e) => fs.readTextFile(`src/${e.name}`));\n",
        "const written = fs.writeFile(\"out/summary.txt\", texts.join(\"\\n\"));\n",
        "console.log(JSON.stringify({ files: files.map((f) => f.name), written }));",
    ));
    let reported = logged_json(&outcome);
    assert_eq!(reported["files"], json!(["a.ts", "b.test.ts"]));
    assert!(reported["written"].as_u64().is_some_and(|bytes| bytes > 0));
    assert_eq!(
        log.names(),
        ["list_dir", "read_file", "read_file", "write_file"],
        "the calls reach the loop in the order the program made them"
    );
    assert_eq!(
        outcome
            .tool_calls
            .iter()
            .map(|call| call.name.as_str())
            .collect::<Vec<_>>(),
        ["list_dir", "read_file", "read_file", "write_file"],
        "the host's own record must match what the loop was actually asked to do"
    );

    // `console.*` all land in one capture, in order: there is no stdout in the guest, so this is
    // the only way a program can show its working.
    let (outcome, _) = run(concat!(
        "console.log(\"first\");\n",
        "console.warn(\"second\");\n",
        "console.error(\"third\");",
    ));
    assert_eq!(outcome.logs, ["first", "second", "third"]);
    assert_eq!(outcome.logs_suppressed, 0);

    // An object argument arrives under the tool's OWN schema key names, camelCase and all.
    let (_, log) = run("tasks.addTask({ id: \"t1\", title: \"write it\", blockedBy: [\"t0\"] });");
    assert_eq!(
        log.args("add_task"),
        Some(json!({
            "id": "t1",
            "title": "write it",
            "description": null,
            "blockedBy": ["t0"],
        }))
    );

    // The same program twice takes the same path and composes the same calls. Elapsed time is
    // deliberately *not* compared: it is a measurement of wall clock, and the machine is free to run
    // slightly differently each time. What must be identical is everything a replay depends on.
    let program = concat!(
        "const entries = fs.listDir(\"src\");\n",
        "console.log(entries.filter((e) => e.kind === \"file\").map((e) => e.name).join(\", \"));",
    );
    let (first, first_log) = run(program);
    let (second, second_log) = run(program);
    assert_eq!(logs(&first), logs(&second));
    assert_eq!(first_log.names(), second_log.names());

    // No clock, no randomness — which is what makes replaying a code turn exact rather than
    // approximate. `Date.now()` reports the artifact's build instant, forever.
    let program =
        "console.log(JSON.stringify([Date.now(), new Date().toISOString(), Math.random()]));";
    let (first, _) = run(program);
    let (second, _) = run(program);
    let first = logged_json(&first);
    assert_eq!(first, logged_json(&second));
    assert!(
        first[0].as_u64().is_some_and(|millis| millis > 0),
        "the frozen clock still reports a real instant: {first}"
    );
}

/// A memory search's results reach a program as **data it can rank, filter and index**, not as the
/// sentence gg wrote for a model to read.
///
/// This is the whole argument for the typed sidecar, on the one family where it decides whether the
/// capability is usable at all: the [keyword-search](crate::memories::MemoryStrategy::KeywordSearch)
/// strategy exists so a program can look memory up, and a program that had to parse "2 keywords, 3
/// occurrences" back out of prose would be re-implementing gg's formatter to do it. It also proves
/// the record crosses the membrane *outward* — the crossing table checks the arguments going in.
#[test]
fn a_memory_search_hands_a_program_its_hits_as_data() {
    let (outcome, log) = run(concat!(
        "const hits = memory.searchMemories([\"cargo\", \"nextest\"]);\n",
        "const best = hits[0];\n",
        "console.log(JSON.stringify({\n",
        "  found: hits.length,\n",
        "  best: best.name,\n",
        "  matched: best.matched,\n",
        "  worthReading: hits.filter((h) => h.matched > 1).map((h) => h.name),\n",
        "}));",
    ));
    let reported = logged_json(&outcome);
    assert_eq!(reported["found"], json!(1));
    assert_eq!(reported["best"], json!("build-commands"));
    assert_eq!(reported["matched"], json!(2));
    assert_eq!(reported["worthReading"], json!(["build-commands"]));
    assert_eq!(log.names(), ["search_memories"]);

    // And a memory read is the contents themselves, exactly as a skill's body is — a program gets
    // the text to work with rather than a report about it.
    let (outcome, log) = run(concat!(
        "const body = memory.readMemory(\"build-commands\");\n",
        "console.log(JSON.stringify({ body }));",
    ));
    assert_eq!(logged_json(&outcome)["body"], json!("the memory contents"));
    assert_eq!(log.names(), ["read_memory"]);

    // A budget with no ceilings comes back as absent maxima rather than as zeros a program would
    // read as "no room left".
    let (outcome, _) = run(concat!(
        "const usage = memory.createMemory({ name: \"m\", description: \"d\", body: \"b\" });\n",
        "console.log(JSON.stringify({ count: usage.count, max: usage.maxCount ?? null,",
        " index: usage.indexChars ?? null }));",
    ));
    let reported = logged_json(&outcome);
    assert_eq!(reported["count"], json!(1));
    assert_eq!(reported["max"], json!(8));
    assert_eq!(reported["index"], json!(null));
}

/// **Denied globals become located program errors, never traps.**
///
/// The component is built with the WASI imports these builtins call disabled, so an *unshadowed*
/// call reaches a missing import and traps the whole store — uncatchable, no feedback, and the
/// model is told only that the sandbox trapped. Since `await new Promise((r) => setTimeout(r, 100))`
/// is the first reflex a model brings to a new runtime, that failure would be routine.
#[test]
fn the_sandbox_globals_are_denied_not_trapped() {
    let denied = [
        "setTimeout(() => 1, 0);",
        "setInterval(() => 1, 0);",
        "clearTimeout(1);",
        "clearInterval(1);",
        "queueMicrotask(() => 1);",
        "requestAnimationFrame(() => 1);",
        "fetch(\"https://example.com\");",
        "performance.now();",
        "crypto.getRandomValues(new Uint8Array(4));",
        "crypto.randomUUID();",
    ];
    for program in denied {
        let (outcome, _) = run(program);
        let error = program_error(&outcome);
        assert!(
            error.message.contains("not available in the sandbox"),
            "`{program}` did not produce the denial message: {}",
            error.message
        );
        assert!(
            error.location.is_some(),
            "`{program}` produced no line number, so the model cannot find it"
        );
    }

    // A denial is an ordinary throw, so a program can handle it and carry on.
    let (outcome, _) =
        run("try { fetch(\"https://example.com\"); } catch (e) { console.log(\"caught\"); }");
    assert_eq!(logs(&outcome), ["caught"]);

    // Work deferred past the end of the program still executes — its effects are real and are
    // recorded — but it lands outside the turn and a throw inside it is invisible, so the model is
    // told plainly rather than shown a clean turn over a half-failed program.
    let (outcome, log) = run(concat!(
        "Promise.resolve().then(() => fs.writeFile(\"late.txt\", \"x\"));\n",
        "console.log(\"done\");",
    ));
    assert_eq!(logs(&outcome), ["done"]);
    assert_eq!(log.names(), ["write_file"], "the deferred write still ran");
    let note = outcome
        .deferred_note
        .as_deref()
        .expect("the deferred call was reported");
    assert!(note.contains("ran after your program ended"), "{note}");
}

/// The two ceilings stop a runaway program, and everything it did first is still reported.
#[test]
fn the_limits_stop_a_runaway_program() {
    // A timeout far shorter than the default keeps the test quick; a runaway reaches any ceiling.
    let short_timeout = SandboxLimits {
        timeout: Duration::from_millis(100),
        ..SandboxLimits::default()
    };

    // A program that calls nothing and never returns is stopped by the timeout alone.
    let (outcome, _) = run_with(
        "while (true) {}",
        &all_tools(),
        short_timeout,
        canned_outcome,
    );
    match outcome.result {
        Err(SandboxError::Timeout { limit }) => assert_eq!(limit, short_timeout.timeout),
        other => panic!("expected an execution timeout, got {other:?}"),
    }
    assert!(
        outcome.elapsed > Duration::ZERO,
        "the time a stopped program spent running is reported, not lost"
    );

    // The calls that landed before the trap are still the model's to see: they really happened.
    let (outcome, log) = run_with(
        "fs.listDir(\"src\");\nwhile (true) {}",
        &all_tools(),
        short_timeout,
        canned_outcome,
    );
    assert!(matches!(outcome.result, Err(SandboxError::Timeout { .. })));
    assert_eq!(log.names(), ["list_dir"]);
    assert_eq!(
        outcome
            .tool_calls
            .iter()
            .map(|call| call.name.as_str())
            .collect::<Vec<_>>(),
        ["list_dir"]
    );

    // A cap below the guest engine's ~10 MiB floor fails at INSTANTIATION, and is reported as the
    // memory cap rather than as a mysterious instantiation failure — the limiter's denial flag is
    // what makes the two distinguishable at all.
    let (outcome, _) = run_with(
        "return 1;",
        &all_tools(),
        SandboxLimits {
            max_memory_bytes: 4 * 1024 * 1024,
            ..SandboxLimits::default()
        },
        canned_outcome,
    );
    match outcome.result {
        Err(SandboxError::OutOfMemory { limit }) => assert_eq!(limit, 4 * 1024 * 1024),
        other => panic!("expected the memory cap, got {other:?}"),
    }

    // A running program that outgrows its cap is the other shape of the same denial. The
    // allocation has to be of DISTINCT objects: this engine's rope strings barely allocate, so
    // repeatedly concatenating one would run out the clock instead of the memory cap.
    let (outcome, _) = run_with(
        concat!(
            "const held = [];\n",
            "for (let i = 0; i < 20000000; i++) { held.push({ i, tag: i * 2 }); }\n",
            "return held.length;",
        ),
        &all_tools(),
        SandboxLimits {
            max_memory_bytes: 64 * 1024 * 1024,
            ..SandboxLimits::default()
        },
        canned_outcome,
    );
    assert!(
        matches!(outcome.result, Err(SandboxError::OutOfMemory { .. })),
        "a runaway allocation must be the memory cap, not a bare trap: {:?}",
        outcome.result
    );

    // **And the default timeout has enormous headroom over the heaviest honest program.** The
    // timeout is a pure infinite-loop guard, not a work ration: even the heaviest honest program —
    // read, rewrite and write back twenty 64 KiB files — spends a fraction of a second of guest CPU,
    // orders of magnitude under the 30 s ceiling. This runs that workload and asserts a wide margin,
    // which is the property that keeps the timeout from ever tripping on real work.
    let (outcome, log) = run_with(
        concat!(
            "let total = 0;\n",
            "for (let i = 0; i < 20; i++) {\n",
            "  const text = fs.readTextFile(`src/file-${i}.ts`);\n",
            "  total += fs.writeFile(`src/file-${i}.ts`, text.replace(/alpha/g, \"beta\"));\n",
            "}\n",
            "console.log(total);",
        ),
        &all_tools(),
        SandboxLimits::default(),
        |name, args| {
            if name == "read_file" {
                let contents = "alpha ".repeat(64 * 1024 / 6);
                return ToolOutcome::ok(contents.clone(), "read").with_data(
                    crate::tools::ToolData::FileText(crate::tools::FileTextData {
                        contents,
                        first_line: 1,
                        last_line: 1,
                        total_lines: 1,
                        byte_truncated: false,
                    }),
                );
            }
            canned_outcome(name, args)
        },
    );

    assert_eq!(
        logs(&outcome).len(),
        1,
        "the heaviest honest program must complete within the default ceiling"
    );
    assert_eq!(log.names().len(), 40, "twenty reads and twenty writes");
    // `elapsed` is the guest's *wall clock* with bridged-call time subtracted, not CPU time,
    // so this reading is only about the workload when the workload has the machine. That is
    // what `.config/nextest.toml` gives it: the override there makes this test take every
    // runner slot, so a busy suite cannot inflate the number and red the gate over nothing.
    let default_timeout = SandboxLimits::default().timeout;
    assert!(
        outcome.elapsed * 5 < default_timeout,
        "the default timeout has lost its headroom: the workload ran for {:?} of {default_timeout:?}",
        outcome.elapsed
    );
}

/// **A program ends the run by calling `finish`, and nothing else does.**
///
/// Eight programs against eight stores, in one function because the component compile is per process
/// (see the module docs). Together they pin the whole of the completion contract against the real
/// guest: that `finish` sets a flag and returns rather than stopping anything, that the work after it
/// still happens, that the last summary is the one that stands, that a program which then fails loses
/// the ending it declared, and that an unusable summary finishes nothing at all.
#[test]
fn a_program_ends_the_run_by_calling_finish() {
    // 1. The plain case. The completion is carried out verbatim and the turn is not a failure:
    //    nothing was thrown, because `finish` throws nothing.
    let (outcome, log) = run("harness.finish(\"wrote the manifest\");");
    assert_eq!(summary_of(completion(&outcome)), "wrote the manifest");
    assert_eq!(completion(&outcome).superseded, 0);
    assert!(logs(&outcome).is_empty());
    assert!(log.calls().is_empty());

    // 2. **What comes after `finish` runs.** This is the inversion the design turns on: `finish` is
    //    not `process.exit()`, it is a flag in the agent's context that the loop reads once the
    //    program has ended. A model that tidies up after declaring itself done gets the tidying it
    //    asked for rather than a silently discarded half-reply.
    let (outcome, log) = run(concat!(
        "harness.finish(\"done\");\n",
        "fs.writeFile(\"after.txt\", \"x\");\n",
        "console.log(\"tidied up\");",
    ));
    assert_eq!(summary_of(completion(&outcome)), "done");
    assert_eq!(logs(&outcome), ["tidied up"]);
    assert_eq!(
        log.names(),
        ["write_file"],
        "a call after `finish` is ordinary work and reaches the loop"
    );

    // 3. A conditional that does not fire finishes nothing. `finish` inside an `if` is not an edge
    //    case, it is *the* case: a program checks its work and concludes, and the branch that does
    //    not fire must fall through to the rest of the program.
    let (outcome, _) = run(concat!(
        "const n = 7;\n",
        "if (n > 10) { harness.finish(\"big enough\"); }\n",
        "console.log(n);",
    ));
    assert_eq!(logs(&outcome), ["7"]);
    assert!(
        outcome.completion.is_none(),
        "the branch never ran, so the run is not finished"
    );

    // 4. …and the branch that does fire declares the ending without cutting the program short.
    let (outcome, log) = run(concat!(
        "const n = 12;\n",
        "if (n > 10) { harness.finish(\"big enough\"); }\n",
        "fs.writeFile(\"after.txt\", \"x\");",
    ));
    assert_eq!(summary_of(completion(&outcome)), "big enough");
    assert_eq!(log.names(), ["write_file"]);

    // 5. **Last call wins, and calling twice is not a failure.** With no unwind to catch, a second
    //    `finish` is an ordinary thing for a program to write — two branches that both run, a call
    //    inside a loop — and the later summary is the one written with more of the work behind it.
    let (outcome, _) = run(concat!(
        "harness.finish(\"the first word\");\n",
        "harness.finish(\"the last word\");\n",
        "console.log(\"neither call threw\");",
    ));
    assert_eq!(logs(&outcome), ["neither call threw"]);
    assert_eq!(
        summary_of(completion(&outcome)),
        "the last word",
        "last wins: the summary written with the most of the program behind it"
    );
    assert_eq!(completion(&outcome).superseded, 1);

    // 6. A completion survives a *caught* failure, because the program still ran to its end. This is
    //    what a broad `try`/`catch` around the work can no longer do: there is no ending inside it
    //    to swallow.
    let (outcome, _) = run(concat!(
        "try { throw new Error(\"handled\"); } catch (e) { console.log(\"recovered\"); }\n",
        "harness.finish(\"done anyway\");",
    ));
    assert_eq!(summary_of(completion(&outcome)), "done anyway");
    assert_eq!(logs(&outcome), ["recovered"]);

    // 7. **A throw after a completion revokes it.** The summary describes checks the program never
    //    finished running, so gg does not end the run on it — it reports the throw, keeps the
    //    abandoned summary for the feedback, and gives the model another turn.
    let (outcome, _) = run(concat!(
        "harness.finish(\"done\");\n",
        "throw new Error(\"and then it fell over\");",
    ));
    assert!(
        outcome.completion.is_none(),
        "a program that failed after `finish` has not finished: {:?}",
        outcome.completion
    );
    assert_eq!(
        outcome.revoked_completion,
        Some(Ending::Finished {
            summary: "done".to_string(),
        })
    );
    assert!(
        program_error(&outcome)
            .message
            .contains("and then it fell over"),
        "{:?}",
        program_error(&outcome)
    );

    // 8. A summary that is not a usable summary finishes nothing: the model is told what was wrong
    //    with it and the run carries on, rather than ending on an empty final word. The blank ones
    //    are refused by the HOST, which knows whether the text is usable; the mistyped one by the
    //    guest, the only layer that can still see it was never a string at all.
    for (program, wanted) in [
        ("harness.finish(\"\");", "non-empty summary"),
        ("harness.finish(\"   \");", "non-empty summary"),
        (
            "harness.finish(42 as any);",
            "expected a summary string, got number",
        ),
    ] {
        let (outcome, _) = run(program);
        assert!(
            outcome.completion.is_none(),
            "`{program}` must not finish the run"
        );
        let error = program_error(&outcome);
        assert_eq!(
            error.kind,
            ProgramErrorKind::ToolFailure,
            "`{program}`: {error:?}"
        );
        assert!(
            error.message.contains("invalid-argument"),
            "`{program}`: {}",
            error.message
        );
        assert!(
            error.message.contains(wanted),
            "`{program}`: {}",
            error.message
        );
    }
}

/// **A returned value is discarded, and the model is told so.**
///
/// This is the whole of the rule that replaced a family of them. A program may `return` anything at
/// all — a cycle, a function, a structure nested far past what any JSON parser would read back — and
/// none of it is a failure, because none of it crosses: `console.log` is the one channel. What gg
/// owes the model is not an error but a *sentence*, on the turn it happened, saying where its value
/// went.
#[test]
fn a_returned_value_is_discarded_and_the_model_is_told() {
    for program in [
        "return 42;",
        "return { deep: \"structure\" };",
        "const cycle = {}; cycle.self = cycle; return cycle;",
        "return () => 1;",
        "return JSON.parse(\"[\".repeat(400) + \"1\" + \"]\".repeat(400));",
    ] {
        let (outcome, _) = run(program);
        assert!(
            matches!(&outcome.result, Ok(result) if result.error.is_none()),
            "`{program}` must run cleanly — a returned value is not a fault: {:?}",
            outcome.result
        );
        assert!(
            outcome.returned_value,
            "`{program}` returned a value, and the model has to be told it went nowhere"
        );
    }

    // A program that returns nothing is not noted at all: the nudge exists for a model that used the
    // wrong channel, and a bare `return` used as an early exit is the right one.
    for program in [
        "console.log(\"spoke\");",
        "return;",
        "if (true) { return; }",
    ] {
        let (outcome, _) = run(program);
        assert!(
            !outcome.returned_value,
            "`{program}` returned no value, so there is nothing to tell the model about"
        );
    }
}

/// **A role's ending calls are the only ones in its programs' scope.**
///
/// Scope injection is the capability model, and the ending calls obey it exactly as the tools do: a
/// call this agent's role does not have is an undefined identifier, not a call that travels to the
/// host to be refused there. So a reviewer that reaches for `harness.finish` gets a
/// `ReferenceError` naming the objects it *does* have, on the turn it reaches — rather than a
/// verdict gg has to decide what to do with.
///
/// This is the end-to-end half of the membrane's own tests: it pays a component compile to prove the
/// **committed artifact** binds what the host thinks it binds.
#[test]
fn a_role_gets_only_its_own_ending_calls() {
    // The standard group: `harness.finish` is there, and neither verdict object exists.
    let outcome = run_as("harness.finish(\"done\");", EndingRole::Standard);
    assert_eq!(summary_of(completion(&outcome)), "done");
    let outcome = run_as("review.approve();", EndingRole::Standard);
    assert_eq!(
        program_error(&outcome).kind,
        ProgramErrorKind::UnknownName,
        "an agent doing work has no `review` object at all"
    );

    // A reviewer: both verdicts, and no `harness.finish` at all.
    let outcome = run_as("review.approve();", EndingRole::Review);
    assert_eq!(
        completion(&outcome).ending,
        Ending::Approved,
        "an approval needs no arguments"
    );
    let outcome = run_as(
        "review.requestChanges([\"`step()` is off by one\"]);",
        EndingRole::Review,
    );
    assert_eq!(
        completion(&outcome).ending,
        Ending::ChangesRequested {
            items: vec!["`step()` is off by one".to_string()],
        }
    );
    // A reviewer's scope has no `harness` object at all. It exists only to carry `finish`, and a
    // reviewer does not get one — documentation reading, which used to keep the object alive for
    // every role, is `view.openDocsView` now. So the call is an unknown *name* rather than a missing
    // method, and either way it is a fault on the turn it is made rather than a verdict gg has to
    // interpret.
    let outcome = run_as(
        "harness.finish(\"the work is complete\");",
        EndingRole::Review,
    );
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::UnknownName);
    assert!(
        program_error(&outcome).message.contains("harness"),
        "a reviewer has no `harness`: {:?}",
        program_error(&outcome).message
    );
    assert!(outcome.completion.is_none());
}

/// **The `view` object is bound to every program, and only `openFile` is gated.**
///
/// A view is the one channel material has into a model's own context window, so binding it from the
/// capability set would leave a run that enables no tools with nothing to show itself — the same
/// carve-out `harness` has, checked here against the **committed artifact** rather than the source
/// catalogue. `openFile` is the exception and stays a read: withholding `read_file` must not leave a
/// side door open, and it has to close the *function* rather than the whole object, which is a
/// distinction only an end-to-end run can prove.
///
/// The rest of the programs drive the four functions the way the prompt tells a model to write them,
/// because everything about this surface that could be wrong is invisible from Rust: an argument
/// under the wrong key, a `bigint` token count that makes `JSON.stringify` throw, a refusal that
/// arrives as a bare record instead of a catchable `ToolError`.
#[test]
fn the_view_object_is_always_bound_and_only_open_file_is_gated() {
    // A run with NO tools at all still has `view`, and three of its four functions.
    let outcome = run_as(
        "view.openText(\"note\", \"what I found\");",
        EndingRole::Standard,
    );
    assert!(
        logs(&outcome).is_empty(),
        "the program ran and said nothing"
    );
    let outcome = run_as(
        "console.log(JSON.stringify(view.current().length));",
        EndingRole::Standard,
    );
    assert_eq!(logged_json(&outcome), json!(0));
    let outcome = run_as(
        "console.log(JSON.stringify(view.close(\"nothing\")));",
        EndingRole::Standard,
    );
    assert_eq!(
        logged_json(&outcome),
        json!(0),
        "closing a selector that is not open is an answer, not a failure"
    );

    // …but not `openFile`, which is a read. The object is there; the function is not, so the model
    // is told exactly which call it does not have rather than losing the whole namespace.
    let outcome = run_as("view.openFile(\"src/a.ts\");", EndingRole::Standard);
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::Other);
    assert!(
        program_error(&outcome).message.contains("not a function"),
        "a run without `read_file` has no `view.openFile`: {:?}",
        program_error(&outcome).message
    );

    // With `read_file` enabled it IS bound, and it dispatches a real `read_file` carrying the same
    // typed arguments `fs.readFile` does — one read, not two, for the bytes and the view together.
    let (outcome, log) = run(
        "const read = view.openFile(\"src/a.ts\", { offset: 2, limit: 5 });\n\
         console.log(JSON.stringify({ kind: read.kind, first: read.firstLine }));",
    );
    assert_eq!(logged_json(&outcome), json!({ "kind": "text", "first": 1 }));
    assert_eq!(log.names(), ["read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "src/a.ts", "offset": 2, "limit": 5 })),
        "`view.openFile` is a `read_file`, argument for argument"
    );

    // What is open, as data. `JSON.stringify` is the assertion: a `u64` that reached the program as
    // a `bigint` would throw here rather than merely reading oddly.
    let (outcome, _) = run("view.openFile(\"src/a.ts\");\n\
         view.openText(\"summary\", \"the body\");\n\
         console.log(JSON.stringify(view.current().map((v) => ({\n\
             kind: v.kind, selector: v.selector, tokens: typeof v.tokens, region: v.region ?? null,\n\
         }))));");
    assert_eq!(
        logged_json(&outcome),
        json!([
            { "kind": "file", "selector": "src/a.ts", "tokens": "number", "region": null },
            { "kind": "text", "selector": "summary", "tokens": "number", "region": null },
        ]),
        "a whole-file read has no region, and no token count reaches a program as a `bigint`"
    );

    // Re-stating an intent replaces it: two `openText`s of one label are one view.
    let (outcome, _) = run("view.openText(\"summary\", \"first\");\n\
         view.openText(\"summary\", \"second\");\n\
         console.log(JSON.stringify(view.current().map((v) => v.selector)));");
    assert_eq!(logged_json(&outcome), json!(["summary"]));

    // Closing reports how many it closed, and leaves the rest.
    let (outcome, _) = run("view.openText(\"a\", \"x\");\n\
         view.openText(\"b\", \"y\");\n\
         console.log(JSON.stringify({\n\
             closed: view.close(\"a\"), left: view.current().map((v) => v.selector),\n\
         }));");
    assert_eq!(logged_json(&outcome), json!({ "closed": 1, "left": ["b"] }));

    // A refused view arrives as a catchable `ToolError` naming the function the program called —
    // there is no gg tool name to report, and `openText` is what the model wrote.
    let (outcome, _) = run("try { view.openText(\"\", \"body\"); }\n\
         catch (e) { console.log(JSON.stringify({ isToolError: e instanceof ToolError, tool: e.tool, code: e.code })); }");
    assert_eq!(
        logged_json(&outcome),
        json!({ "isToolError": true, "tool": "openText", "code": "invalid-argument" }),
        "a view with no selector could never be closed or attributed, so it is refused"
    );

    // The object is wired into the documentation carve-out under its own name, like every other one.
    let (outcome, _) = run("console.log(JSON.stringify(view.list().map((f) => f.name)));");
    assert_eq!(logged_json(&outcome), json!(["viewFunction"]));

    // Reading a function's documentation opens a VIEW and returns nothing, which is the whole of
    // what replaced `fn.docs()`: a call that handed the text back inline was a second channel into
    // the model that no band was charged for and no `view.close` could reclaim.
    let (outcome, _) = run("console.log(String(view.openDocsView(view.openText)));");
    assert_eq!(logs(&outcome), ["undefined"], "it returns nothing");
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| (view.kind, view.selector.as_str()))
            .collect::<Vec<_>>(),
        vec![(ViewKind::Docs, "openText")],
        "the function is resolved to the name gg knows it by, and opened as a docs view"
    );

    // A name works as well as the function itself, and neither is a tool call.
    let (outcome, log) = run("view.openDocsView(\"openText\");");
    assert_eq!(outcome.views_opened.len(), 1);
    assert!(
        log.names().is_empty(),
        "a documentation lookup is not a tool call: {:?}",
        log.names()
    );
}

/// **The `programs` object: the program library, end to end against the real component.**
///
/// One function, many programs, for the reason the module header gives: the compile is per process.
/// What is proved here is everything the host-only tests cannot — that the object is *bound* only
/// when the run keeps a library, that its calls are not tool calls, that a hand-over registers
/// without stopping the program, and that a program failing afterwards loses it.
#[test]
fn the_program_library_is_bound_only_when_the_run_keeps_one() {
    // Absent without the capability: an undefined identifier, not a call that reaches the host to be
    // refused — the same enforcement every withheld tool gets.
    let (outcome, log) = run("programs.history();");
    let error = match &outcome.result {
        Ok(result) => result.error.as_ref().expect("an unbound object is a throw"),
        other => panic!("expected the program to run and throw, got {other:?}"),
    };
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        log.names().is_empty(),
        "nothing reached the host: a withheld family is not a name in scope at all"
    );

    // Present with it, and carrying exactly the three functions.
    let outcome = run_with_library(
        "console.log(JSON.stringify(programs.list().map((f) => f.name)));",
        &[],
    );
    assert_eq!(
        logged_json(&outcome),
        json!(["programsFunction"]),
        "the object is wired into the documentation carve-out like every other one (the double \
         answers a directory per object; which functions a real one lists is `docs`'s own test)"
    );

    // `history` describes the shape of what is held, and never its source.
    let outcome = run_with_library(
        "console.log(JSON.stringify(programs.history()));",
        &[(3, "const x = 1;\nconsole.log(x);")],
    );
    assert_eq!(
        logged_json(&outcome),
        json!([{ "turn": 3, "lines": 2, "chars": 28, "ok": true }]),
        "a summary carries no source; `get` is how you reach for one"
    );

    // `get` returns the source verbatim, and takes a turn.
    let outcome = run_with_library(
        "console.log(programs.get());",
        &[(1, "first"), (2, "second")],
    );
    assert_eq!(logs(&outcome), ["second"]);
    let outcome = run_with_library(
        "console.log(programs.get(1));",
        &[(1, "first"), (2, "second")],
    );
    assert_eq!(logs(&outcome), ["first"]);

    // A turn the library does not hold is a catchable `ToolError`, named after the call the model
    // made rather than after a gg tool that does not exist.
    let outcome = run_with_library(
        "try { programs.get(99); }\n\
         catch (e) { console.log(JSON.stringify({ isToolError: e instanceof ToolError, tool: e.tool, code: e.code })); }",
        &[(1, "first")],
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "isToolError": true, "tool": "get", "code": "not-found" })
    );

    // A hand-over returns like any other call and the program runs on — the same shape `finish` has,
    // and for the same reason: the host owns the flag, so there is no unwind to reason about.
    let outcome = run_with_library(
        "programs.rerun(\"console.log('the replacement');\");\nconsole.log('still running');",
        &[],
    );
    assert_eq!(logs(&outcome), ["still running"]);
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("console.log('the replacement');"),
        "the source survives out of the store for the loop to run"
    );

    // ...and a program that then throws loses it, exactly as it loses an ending.
    let outcome = run_with_library(
        "programs.rerun(\"console.log('never');\");\nthrow new Error('boom');",
        &[],
    );
    assert!(outcome.rerun.is_none());
    assert!(
        outcome.revoked_rerun,
        "the model is told the replacement was not run"
    );
}

// ---------------------------------------------------------------------------
// Code modules — the `lib` object
// ---------------------------------------------------------------------------
//
// These are the only tests that prove the committed component really binds a module: everything
// else about the feature is host-side, and a `lib` the guest failed to build would look exactly like
// a program that forgot to call into it.

/// Run `program` with `modules` bound, each already through the host's module transpile — the same
/// path a read skill or memory takes.
fn run_with_modules(program: &str, modules: &[(&str, &str)]) -> SandboxOutcome {
    run_with_modules_logged(program, modules).0
}

/// The same, keeping the call log — for the one test that is about what a module *did* on its way to
/// being loaded rather than about what it exported.
fn run_with_modules_logged(program: &str, modules: &[(&str, &str)]) -> (SandboxOutcome, CallLog) {
    let bound: Vec<CodeModule> = modules
        .iter()
        .map(|(name, source)| CodeModule {
            name: (*name).to_string(),
            source: crate::sandbox::prepare_module(typescript(), source)
                .expect("the test's module is prepared")
                .source,
        })
        .collect();
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            enabled: &all_tools(),
            modules: &bound,
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    (outcome, log)
}

/// **A loaded module's exports are callable from the program**, under `lib.<key>`.
///
/// The one end-to-end assertion behind code skills and code memories: the host transpiles a module,
/// the guest evaluates it before the program, and the program calls what it exported.
#[test]
fn a_code_module_is_bound_at_lib_and_its_exports_are_callable() {
    let outcome = run_with_modules(
        "console.log(JSON.stringify(lib.csvTools.parse(\"a,b,c\")));",
        &[(
            "csvTools",
            "export function parse(text: string): string[] { return text.split(\",\"); }\n\
             function unexported() { return 0; }\n",
        )],
    );
    assert_eq!(logged_json(&outcome), json!(["a", "b", "c"]));

    // What the module did not export is not on the object: the namespace is what the file said.
    let outcome = run_with_modules(
        "console.log(String(typeof lib.csvTools.unexported));",
        &[(
            "csvTools",
            "export function parse() {}\nfunction unexported() {}\n",
        )],
    );
    assert_eq!(logs(&outcome), ["undefined"]);
}

/// A module may call the same gg functions the program can — it is evaluated against the same scope,
/// which is what makes a helper worth keeping rather than a pure-function library.
#[test]
fn a_module_may_call_gg_functions_while_it_loads() {
    let (outcome, log) = run_with_modules_logged(
        "console.log(\"ran\");",
        &[("eager", "export const first = fs.readFile(\"a.txt\");\n")],
    );
    assert_eq!(logs(&outcome), ["ran"], "the program still ran");
    // The point: the read really crossed the membrane, so the module was evaluated against the
    // program's own scope rather than an empty one.
    assert_eq!(log.names(), ["read_file"]);
}

/// **A module that throws while loading does not take the turn down.** Its `lib` entry is empty, the
/// failure is reported separately, and the program runs.
#[test]
fn a_module_that_throws_while_loading_is_reported_and_the_program_still_runs() {
    let outcome = run_with_modules(
        "console.log(JSON.stringify(Object.keys(lib.broken)));",
        &[("broken", "export const n = (undefined as any).x;\n")],
    );
    assert_eq!(logged_json(&outcome), json!([]), "the entry is empty");
    assert_eq!(
        outcome.module_errors.len(),
        1,
        "the failure is reported: {:?}",
        outcome.module_errors
    );
    assert_eq!(outcome.module_errors[0].0, "broken");
    assert!(
        outcome
            .result
            .as_ref()
            .expect("the program itself ran")
            .error
            .is_none(),
        "somebody else's broken module is not the program's failure"
    );
}

/// A run with **no** modules has no `lib` identifier at all — the same capability model every
/// withheld tool obeys.
#[test]
fn a_program_with_no_modules_has_no_lib_in_scope() {
    let outcome = run_with_modules("console.log(String(lib));", &[]);
    let error = outcome
        .result
        .expect("the program ran")
        .error
        .expect("reaching for `lib` is an unknown name");
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
}

/// An **on-use script** binds no ending group: it is not the agent's turn, so it cannot declare the
/// session over.
#[test]
fn an_on_use_script_has_no_ending_calls_in_scope() {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        "harness.finish(\"done\");",
        ProgramScope {
            enabled: &all_tools(),
            modules: &[],
            ending: RunEnding::None,
            library: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert!(
        outcome.completion.is_none(),
        "an on-use script cannot end the session"
    );
    let error = outcome
        .result
        .expect("the script ran")
        .error
        .expect("`harness` is not a name it has");
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
}
