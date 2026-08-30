//! End-to-end tests against the **prebuilt component** — real TypeScript, really evaluated.
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
use test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY;

use super::*;
use crate::context::ViewKind;
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, canned_outcome, typescript,
};
use crate::tools::{ToolFailure, ToolOutcome};

#[path = "sandbox.membrane.test.rs"]
mod membrane_tests;

#[path = "sandbox.faults.test.rs"]
mod fault_tests;

#[path = "sandbox.compile.test.rs"]
mod compile_tests;

/// Run `program` with every call granted, the canned invoker, and the default ceilings.
fn run(program: &str) -> (SandboxOutcome, CallLog) {
    run_with(
        program,
        &all_operations(),
        SandboxLimits::AMPLE,
        canned_outcome,
    )
}

/// Run `program` granted `operations` under `limits`, answering calls with `responder`. The
/// program is given the [standard](EndingRole::Standard) ending group; [`run_as`] varies that.
///
/// The [program library](crate::programs) is the one capability deliberately **off** here, and it is
/// off because the guest binds its module only for a run that keeps one: a fixture that switched it
/// on would put `programs` in every program's scope, and the case that asserts an unkept library is
/// an unbound name would have nothing left to assert. [`run_with_library`] is the arm that keeps it.
fn run_with(
    program: &str,
    operations: &[crate::sandbox::OperationId],
    limits: SandboxLimits,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let capabilities: Vec<String> = all_capabilities()
        .into_iter()
        .filter(|id| id != CAPABILITY_PROGRAM_LIBRARY)
        .collect();
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            capabilities: &capabilities,
            operations,
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        &crate::sandbox::AgentWorkspace::new(),
        limits,
        None,
        FakeOperationApi::with(&log, responder),
    );
    (outcome, log)
}

/// Run `program` with the [program library](crate::programs) bound and already holding `held`
/// (id, turn, source) — the one scope variation that is not a tool and not a role.
fn run_with_library(program: &str, held: &[(&str, u64, &str)]) -> SandboxOutcome {
    let log = CallLog::default();
    let mut api = FakeOperationApi::new(&log);
    for (id, turn, source) in held {
        api = api.with_program(id, *turn, source);
    }
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            capabilities: &all_capabilities(),
            operations: &all_operations(),
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
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
            capabilities: &[],
            operations: &[],
            modules: &[],
            ending: RunEnding::Role(role),
        },
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        FakeOperationApi::new(&log),
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

/// The throw a program did not catch, insisting the program ran and threw — the shape a refused
/// call arrives in: the guest reports the uncaught `ApiError` with its class, rather than dying in
/// a trap.
fn uncaught(outcome: &SandboxOutcome) -> &crate::sandbox::ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .expect("the program threw and did not catch it"),
        Err(other) => panic!("expected an uncaught program throw, but the sandbox failed: {other}"),
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

/// **What the model reads when a program failed at run time.**
///
/// This arm reports a failure by capture rather than interception: nothing in the guest catches a
/// program's throw to describe it, so what is reported over `feedback.report-error` is the
/// engine's own rendering — its `name`, its `message`, the stack in the model's own coordinates,
/// and whatever the thrown object carries. So a program fault arrives as a
/// [`ProgramError`](crate::sandbox::outcome::ProgramError) whose text is the engine's, the guest
/// returns normally, and the assertions below read that text.
fn program_failure(outcome: &SandboxOutcome) -> String {
    match &outcome.result {
        Ok(result) => match &result.error {
            Some(error) => error.message.clone(),
            None => panic!(
                "the program did not fail; it logged {:?} and reported nothing",
                outcome.logs
            ),
        },
        Err(other) => {
            panic!("expected a reported program fault, but the store died instead: {other}")
        }
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
        "import * as gg from \"gg\";\nconst files = gg.files.listDir(\"src\").filter((e) => e.kind === \"file\" && e.name.endsWith(\".ts\"));\n",
        "const texts = files.map((e) => { const r = gg.files.readFile(`src/${e.name}`); return r.kind === \"text\" ? r.contents : \"\"; });\n",
        "const written = gg.files.writeFile(\"out/summary.txt\", texts.join(\"\\n\"));\n",
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
        [
            "files.list_dir",
            "files.read_file",
            "files.read_file",
            "files.write_file"
        ],
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
    let (_, log) = run(
        "import * as gg from \"gg\";\ngg.tasks.addTask({ id: \"t1\", title: \"write it\", blockedBy: [\"t0\"] });",
    );
    assert_eq!(
        log.args("add_task"),
        Some(json!({
            "id": "t1",
            "title": "write it",
            "description": null,
            "blockedBy": ["t0"],
        }))
    );

    // The same program twice takes the same path and composes the same calls: the host dispatches
    // identically for identical tool outcomes. Elapsed time is deliberately *not* compared — it is a
    // measurement of wall clock, and the machine is free to run slightly differently each time.
    let program = concat!(
        "import * as gg from \"gg\";\nconst entries = gg.files.listDir(\"src\");\n",
        "console.log(entries.filter((e) => e.kind === \"file\").map((e) => e.name).join(\", \"));",
    );
    let (first, first_log) = run(program);
    let (second, second_log) = run(program);
    assert_eq!(logs(&first), logs(&second));
    assert_eq!(first_log.names(), second_log.names());

    // THE DOCUMENTED SPELLING, which is the one nothing above uses. `fs`, `view` and `tasks` are
    // legacy grouping names that appear in no catalogue and that no model is ever shown; they are
    // bound for the sibling arms whose compiled bundles resolve them as free identifiers. What a
    // model reads is `gg.<module>.<function>` — so without this, the surface every test here drives
    // is the one no model is shown, and a regression in the shim's module wiring would leave this
    // file green while every real program died with a `ReferenceError`.
    //
    // One call per bound module, the directory every module carries, and the one gg name bound bare.
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\nconst notes = gg.files.readFile(\"notes.md\");\n",
        "gg.views.openText(\"scratch\", notes.kind === \"text\" ? notes.contents : \"\");\n",
        "gg.shell.shell(\"ls\");\n",
        "gg.board.createEpic({ prefix: \"epc\", title: \"E\", description: \"D\" });\n",
        "gg.tasks.addTask({ id: \"t1\", title: \"T\" });\n",
        "gg.memories.readMemory(\"layout\");\n",
        "gg.context.compact(\"done\");\n",
        "gg.delegation.sendMessage(\"agent-1\", \"more\");\n",
        "gg.skills.readSkill(\"testing\");\n",
        "try {\n",
        "  gg.files.readFile(\"a.ts\", { offset: -1 });\n",
        "} catch (error) {\n",
        "  console.log(String(error instanceof gg.core.ApiError));\n",
        "}\n",
        "gg.session.finish(\"drove the documented spelling\");\n",
    ));
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the documented spelling did not run: {:?}",
        outcome.result
    );
    assert_eq!(
        log.names(),
        [
            "read_file",
            "shell",
            "create_epic",
            "add_task",
            "read_memory",
            "compact",
            "send_message",
            "read_skill",
        ],
        "every module reached gg's dispatch from its `gg.`-qualified spelling"
    );
    // A view is not a tool call, so `gg.views.openText` shows up here rather than in the log above.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["scratch"],
        "`gg.views.openText` opened the view its documented spelling names"
    );
    let lines = logs(&outcome);
    assert_eq!(
        lines[0], "true",
        "`ApiError` is bound bare, so `instanceof` narrows a caught failure"
    );
    assert_eq!(
        summary_of(completion(&outcome)),
        "drove the documented spelling",
        "the ending group is reached by its documented spelling too"
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
        "import * as gg from \"gg\";\nconst hits = gg.memories.searchMemories([\"cargo\", \"nextest\"]);\n",
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
        "import * as gg from \"gg\";\nconst body = gg.memories.readMemory(\"build-commands\");\n",
        "console.log(JSON.stringify({ body }));",
    ));
    assert_eq!(logged_json(&outcome)["body"], json!("the memory contents"));
    assert_eq!(log.names(), ["read_memory"]);

    // A budget with no ceilings comes back as absent maxima rather than as zeros a program would
    // read as "no room left".
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\nconst usage = gg.memories.createMemory({ name: \"m\", description: \"d\", body: \"b\" });\n",
        "console.log(JSON.stringify({ count: usage.count, max: usage.maxCount ?? null,",
        " index: usage.indexChars ?? null }));",
    ));
    let reported = logged_json(&outcome);
    assert_eq!(reported["count"], json!(1));
    assert_eq!(reported["max"], json!(8));
    assert_eq!(reported["index"], json!(null));
}

/// **What the sandbox cannot honour becomes a located program error, never a trap — and everything
/// else the host has, the guest simply gets.**
///
/// Two things would fail silently without a thrower. The timers are *defined* and never fire, because
/// gg's `run` export is synchronous and nothing polls after it returns: measured,
/// `setTimeout(() => { hit = 1 }, 0)` leaves `hit` at `0` with no error at all. And `fetch` reaches a
/// WASI import the component is baked without, which traps the whole store — uncatchable, no
/// feedback, and the model is told only that the sandbox trapped. Since
/// `await new Promise((r) => setTimeout(r, 100))` is the first reflex a model brings to a new
/// runtime, both would be routine.
///
/// The second half of this test is the other side of that line: the clock, the randomness and the
/// rest of WASI are the **host's**, linked ambiently, and nothing shadows them.
#[test]
fn the_sandbox_denies_only_what_it_cannot_honour() {
    // Reached through `globalThis` rather than by name, because the type checker declares none of
    // them: `setTimeout(…)` in a TypeScript program is a compile error before it is ever a throw,
    // which is the earlier and better answer. The thrower these reach is the same object a bare call
    // resolves to, so this is still the denial an unchecked arm — or a value typed `any` — meets.
    let global = "const host = globalThis as any;\n";
    let denied = [
        "host.setTimeout(() => 1, 0);",
        "host.setInterval(() => 1, 0);",
        "host.clearTimeout(1);",
        "host.clearInterval(1);",
        "host.requestAnimationFrame(() => 1);",
        "host.fetch(\"https://example.com\");",
    ];
    for program in denied {
        let (outcome, _) = run(&format!("{global}{program}\n"));
        let said = program_failure(&outcome);
        assert!(
            said.contains("not available in the sandbox"),
            "`{program}` did not produce the denial message: {said}"
        );
        assert!(
            said.contains("program.ts:2:"),
            "`{program}` produced no line number, so the model cannot find it: {said}"
        );
    }

    // `queueMicrotask` is NOT denied, and the difference is the guest: deferred work is drained
    // before the program's turn ends, which is the same mechanism a top-level `await` finishes on.
    let (outcome, _) = run(&format!(
        "{global}host.queueMicrotask(() => console.log(\"deferred\"));\nconsole.log(\"first\");\n"
    ));
    assert_eq!(logs(&outcome), ["first", "deferred"]);

    // A denial is an ordinary throw, so a program can handle it and carry on.
    let (outcome, _) = run(&format!(
        "{global}try {{ host.fetch(\"https://example.com\"); }} catch (e) {{ console.log(\"caught\"); }}"
    ));
    assert_eq!(logs(&outcome), ["caught"]);

    // Work a program defers is part of the program: the job queue is drained before the turn ends,
    // so a `.then` continuation runs, its effects are recorded, and there is nothing left over to
    // tell the model about. That is what a guest with a real event loop turn buys — on the guest this
    // arm left, the same continuation landed outside the turn and had to be reported as a note.
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "Promise.resolve().then(() => gg.files.writeFile(\"late.txt\", \"x\"));\n",
        "console.log(\"done\");\n",
    ));
    assert_eq!(logs(&outcome), ["done"]);
    assert_eq!(log.names(), ["write_file"], "the deferred write still ran");
    assert_eq!(
        outcome.deferred_note, None,
        "nothing ran after the program ended, so there is nothing to report"
    );

    // The clock is the host's own wall clock, not a constant the artifact snapshotted at build time.
    // Compared against this process's clock rather than against a hard-coded date, because a frozen
    // build instant would also be "after 2026" and would pass that.
    let host = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the host clock is after the epoch")
        .as_millis();
    let (outcome, _) = run("console.log(JSON.stringify(Date.now()));");
    let guest = u128::from(logged_json(&outcome).as_u64().expect("a millisecond count"));
    assert!(
        guest.abs_diff(host) < 60_000,
        "the guest's clock reports {guest} against the host's {host}, so it is not reading the host's"
    );

    // `performance.now()` is the host's monotonic clock, and it *moves*. Asserted across a busy-wait
    // rather than across two adjacent calls, so a coarse clock resolution cannot make an advancing
    // clock look frozen. The wait is measured with the wall clock, which the check above just proved
    // is the host's, so this cannot pass on a build where both are constants.
    let (outcome, _) = run(concat!(
        "const before = performance.now();\n",
        "const until = Date.now() + 5;\n",
        "while (Date.now() < until) {}\n",
        "console.log(JSON.stringify([before, performance.now()]));",
    ));
    let readings = logged_json(&outcome);
    let (before, after) = (
        readings[0].as_f64().expect("a monotonic reading"),
        readings[1].as_f64().expect("a monotonic reading"),
    );
    assert!(
        after > before,
        "`performance.now()` read {before} then {after} across five milliseconds of work, so it is \
         not reading the host's monotonic clock"
    );

    // Randomness is the host's too, and differs between two runs of the same program. All three
    // sources are checked, and checked *separately*, because they reach the guest by different
    // routes — `Math.random()` through the engine's own seeding, `crypto.randomUUID()` and
    // `crypto.getRandomValues()` through `wasi:random` directly. Comparing the three as one value
    // would let any one of them be a constant.
    let program = concat!(
        "console.log(JSON.stringify([Math.random(), crypto.randomUUID(),",
        " Array.from(crypto.getRandomValues(new Uint8Array(8)))]));",
    );
    let (first, _) = run(program);
    let (second, _) = run(program);
    let (first, second) = (logged_json(&first), logged_json(&second));
    for (index, source) in [
        "Math.random()",
        "crypto.randomUUID()",
        "crypto.getRandomValues()",
    ]
    .into_iter()
    .enumerate()
    {
        assert_ne!(
            first[index], second[index],
            "two runs drew the same value from `{source}`, so it is not reading the host's entropy"
        );
    }
}

/// The two ceilings stop a runaway program, and everything it did first is still reported.
#[test]
fn the_limits_stop_a_runaway_program() {
    // A timeout far shorter than the default keeps the test quick; a runaway reaches any ceiling.
    let short_timeout = SandboxLimits {
        timeout: Duration::from_millis(100),
        ..SandboxLimits::AMPLE
    };

    // A program that calls nothing and never returns is stopped by the timeout alone.
    let (outcome, _) = run_with(
        "while (true) {}",
        &all_operations(),
        short_timeout,
        canned_outcome,
    );
    match outcome.result {
        Err(SandboxError::Timeout { limit, .. }) => assert_eq!(limit, short_timeout.timeout),
        other => panic!("expected an execution timeout, got {other:?}"),
    }
    assert!(
        outcome.elapsed > Duration::ZERO,
        "the time a stopped program spent running is reported, not lost"
    );

    // The calls that landed before the trap are still the model's to see: they really happened.
    let (outcome, log) = run_with(
        "import * as gg from \"gg\";\ngg.files.listDir(\"src\");\nwhile (true) {}",
        &all_operations(),
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
        ["files.list_dir"]
    );

    // A cap below the guest engine's own floor fails at INSTANTIATION, and is reported as the
    // memory cap rather than as a mysterious instantiation failure — the limiter's denial flag is
    // what makes the two distinguishable at all.
    let (outcome, _) = run_with(
        "export const answer = 1;\n",
        &all_operations(),
        SandboxLimits {
            max_memory_bytes: 256 * 1024,
            ..SandboxLimits::AMPLE
        },
        canned_outcome,
    );
    match outcome.result {
        Err(SandboxError::OutOfMemory { limit, .. }) => assert_eq!(limit, 256 * 1024),
        other => panic!("expected the memory cap, got {other:?}"),
    }

    // A running program that outgrows its cap is the other shape of the same denial. The
    // allocation has to be of DISTINCT objects: this engine's rope strings barely allocate, so
    // repeatedly concatenating one would run out the clock instead of the memory cap.
    let (outcome, _) = run_with(
        concat!(
            "const held: unknown[] = [];\n",
            "for (let i = 0; i < 20000000; i++) { held.push({ i, tag: i * 2 }); }\n",
            "console.log(held.length);",
        ),
        &all_operations(),
        SandboxLimits {
            max_memory_bytes: 64 * 1024 * 1024,
            ..SandboxLimits::AMPLE
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
            "import * as gg from \"gg\";\n",
            "let total = 0;\n",
            "for (let i = 0; i < 20; i++) {\n",
            "  const read = gg.files.readFile(`src/file-${i}.ts`);\n",
            "  const text = read.kind === \"text\" ? read.contents : \"\";\n",
            "  total += gg.files.writeFile(`src/file-${i}.ts`, text.replace(/alpha/g, \"beta\"));\n",
            "}\n",
            "console.log(total);",
        ),
        &all_operations(),
        SandboxLimits::AMPLE,
        |name, args| {
            if name == "read_file" {
                let contents = "alpha ".repeat(64 * 1024 / 6);
                return ToolOutcome::ok(contents.clone(), "read").with_data(
                    crate::tools::ApiData::FileText(crate::tools::FileTextData {
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
    let default_timeout = SandboxLimits::AMPLE.timeout;
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
    let (outcome, log) =
        run("import * as gg from \"gg\";\ngg.session.finish(\"wrote the manifest\");");
    assert_eq!(summary_of(completion(&outcome)), "wrote the manifest");
    assert_eq!(completion(&outcome).superseded, 0);
    assert!(logs(&outcome).is_empty());
    assert!(log.calls().is_empty());

    // 2. **What comes after `finish` runs.** This is the inversion the design turns on: `finish` is
    //    not `process.exit()`, it is a flag in the agent's context that the loop reads once the
    //    program has ended. A model that tidies up after declaring itself done gets the tidying it
    //    asked for rather than a silently discarded half-reply.
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\ngg.session.finish(\"done\");\n",
        "gg.files.writeFile(\"after.txt\", \"x\");\n",
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
        "import * as gg from \"gg\";\nconst n = 7;\n",
        "if (n > 10) { gg.session.finish(\"big enough\"); }\n",
        "console.log(n);",
    ));
    assert_eq!(logs(&outcome), ["7"]);
    assert!(
        outcome.completion.is_none(),
        "the branch never ran, so the run is not finished"
    );

    // 4. …and the branch that does fire declares the ending without cutting the program short.
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\nconst n = 12;\n",
        "if (n > 10) { gg.session.finish(\"big enough\"); }\n",
        "gg.files.writeFile(\"after.txt\", \"x\");",
    ));
    assert_eq!(summary_of(completion(&outcome)), "big enough");
    assert_eq!(log.names(), ["write_file"]);

    // 5. **Last call wins, and calling twice is not a failure.** With no unwind to catch, a second
    //    `finish` is an ordinary thing for a program to write — two branches that both run, a call
    //    inside a loop — and the later summary is the one written with more of the work behind it.
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\ngg.session.finish(\"the first word\");\n",
        "gg.session.finish(\"the last word\");\n",
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
        "import * as gg from \"gg\";\ntry { throw new Error(\"handled\"); } catch (e) { console.log(\"recovered\"); }\n",
        "gg.session.finish(\"done anyway\");",
    ));
    assert_eq!(summary_of(completion(&outcome)), "done anyway");
    assert_eq!(logs(&outcome), ["recovered"]);

    // 7. **A throw after a completion revokes it.** The summary describes checks the program never
    //    finished running, so gg does not end the run on it — it reports the throw, keeps the
    //    abandoned summary for the feedback, and gives the model another turn.
    let (outcome, _) = run(concat!(
        "import * as gg from \"gg\";\ngg.session.finish(\"done\");\n",
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
        program_failure(&outcome).contains("and then it fell over"),
        "{}",
        program_failure(&outcome)
    );

    // 8. A summary that is not a usable summary finishes nothing: the model is told what was wrong
    //    with it and the run carries on, rather than ending on an empty final word. The blank ones
    //    are refused by the HOST, which knows whether the text is usable; the mistyped one by the
    //    guest, the only layer that can still see it was never a string at all.
    for (program, wanted) in [
        (
            "import * as gg from \"gg\";\ngg.session.finish(\"\");",
            "non-empty summary",
        ),
        (
            "import * as gg from \"gg\";\ngg.session.finish(\"   \");",
            "non-empty summary",
        ),
        (
            "import * as gg from \"gg\";\ngg.session.finish(42 as any);",
            "expected a summary string, got number",
        ),
    ] {
        let (outcome, _) = run(program);
        assert!(
            outcome.completion.is_none(),
            "`{program}` must not finish the run"
        );
        let said = program_failure(&outcome);
        assert!(said.contains("invalid-argument"), "`{program}`: {said}");
        assert!(said.contains(wanted), "`{program}`: {said}");
    }
}

/// **A program has nothing to return, and the language is what says so.**
///
/// A program on this arm is a module, and a module has no function body to return from — so every
/// shape a model reaches for to hand a value back is a located diagnostic from `tsc` before anything
/// runs, naming the statement rather than gg's rule about it. There is no returned value to discard,
/// no note to write, and nothing for a model to be told twice.
///
/// What a program has instead is what it always had: `console.log` for the operator, and a
/// [view](crate::context) for the model.
#[test]
fn a_returned_value_is_discarded_and_the_model_is_told() {
    for program in [
        "return 42;\n",
        "return { deep: \"structure\" };\n",
        "const cycle: Record<string, unknown> = {};\ncycle.self = cycle;\nreturn cycle;\n",
        "return () => 1;\n",
        "if (true) { return; }\n",
    ] {
        let (outcome, _) = run(program);
        assert!(
            matches!(&outcome.result, Err(SandboxError::Prepare(PrepareError::Compile(diagnostics)))
                if diagnostics.contains("A 'return' statement can only be used within a function body")),
            "`{program}` is refused by the language: {:?}",
            outcome.result
        );
        assert!(!outcome.returned_value, "`{program}` never ran");
    }

    // A `return` inside a function of the program's own is ordinary code and runs.
    let (outcome, _) =
        run("function answer(): number {\n  return 42;\n}\nconsole.log(String(answer()));\n");
    assert_eq!(logs(&outcome), ["42"]);
    assert!(!outcome.returned_value);
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
/// **embedded artifact** binds what the host thinks it binds.
#[test]
fn a_role_gets_only_its_own_ending_calls() {
    // The standard group: `harness.finish` is there, and neither verdict object exists.
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.session.finish(\"done\");",
        EndingRole::Standard,
    );
    assert_eq!(summary_of(completion(&outcome)), "done");
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.session.approve();",
        EndingRole::Standard,
    );
    assert!(
        program_failure(&outcome).contains("code: \"unavailable\""),
        "an agent doing work is refused the verdicts of a role it does not have: {}",
        program_failure(&outcome)
    );

    // A reviewer: both verdicts, and no `harness.finish` at all.
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.session.approve();",
        EndingRole::Review,
    );
    assert_eq!(
        completion(&outcome).ending,
        Ending::Approved,
        "an approval needs no arguments"
    );
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.session.requestChanges([\"`step()` is off by one\"]);",
        EndingRole::Review,
    );
    assert_eq!(
        completion(&outcome).ending,
        Ending::ChangesRequested {
            items: vec!["`step()` is off by one".to_string()],
        }
    );
    // A reviewer's scope carries `harness` like every other name — the SDK is static — and calling
    // `finish` on it reaches the host, which refuses it and names the endings a reviewer *does*
    // have. That is the whole of what an ending refusal says: an agent that reached for the wrong
    // ending is handed the right one on the same turn, where a missing name told it only that
    // something was absent. Why the wrong one is unavailable is not said, because a role is
    // dispatched rather than chosen and nothing the program does can change it.
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.session.finish(\"the work is complete\");",
        EndingRole::Review,
    );
    let said = program_failure(&outcome);
    assert!(
        said.contains(
            "`gg.session.finish` is not available. Use `gg.session.approve` or \
             `gg.session.requestChanges` instead."
        ),
        "a reviewer is handed the calls it does have, spelled as this program would write them, \
         and told nothing it could not act on: {said}"
    );
    assert!(outcome.completion.is_none());

    // The role is the host's to hold and nowhere else's: no guest withholds an ending name, so this
    // refusal is the only thing between a standard agent and a verdict it was never asked for. See
    // `membrane/session.test.rs` for the same gate exercised without a guest at all.
}

/// **A call refused as `unavailable` is the same turn error as a name that was never in scope.**
///
/// The two are one fact — the model reached for something this run does not offer it — and no arm's
/// SDK withholds a name any more, so on every arm the first is what actually happens: the call is
/// bound, it is made, and the membrane refuses it. If each guest's own reading of its throw decided
/// the class, the identical event would be counted as `program_unknown_name` in one arm and
/// `program_api_error` in the next, which is exactly the confound a cross-language study cannot
/// carry. The host reads the failure **code** instead, and this proves it end to end through the
/// real component.
///
/// # The arms this invariant does NOT hold on, measured
///
/// It is proved here on the shared ECMAScript guest and it holds wherever a guest reports the throw
/// at all: Python, Ruby, C++ and C# read the failure's code off the uncaught value the same way.
/// It does **not** hold on the four whose runtime kills the program before anything can report —
/// Rust, Swift, Kotlin and Java — and the divergence is recorded here rather than only in prose
/// because this is the test a reader of the invariant finds. Swift is the sharpest of them: it has
/// no top-level `throws` context its shell can wrap, so an uncaught error is not a `program-error`
/// at all — the runtime prints to stderr and executes `unreachable`, which arrives as a trapped
/// store (see `packages/gg-sandbox-swift/Sources/shell.swift`'s `ggRun`).
///
/// None of the four is a hole in the *measurement*, because the refusal itself is uniform on all
/// eleven arms: it is opened and closed as an API call and lands on the turn's refusal roster
/// (a `SandboxRefusal`) under gg's own key. **That roster is what a
/// cross-arm count of withheld reaches must join on**, not the turn's error type. `/gg/languages/static-sdks/`
/// says the same thing to an operator.
#[test]
fn a_refused_call_is_the_same_turn_error_as_an_unbound_name() {
    let (outcome, _) = run_with(
        "import * as gg from \"gg\";\ngg.files.listDir();",
        &all_operations(),
        SandboxLimits::AMPLE,
        |_, _| {
            ToolOutcome::failed(
                ToolFailure::Unavailable,
                "`list_dir` is not available: this run has no workspace.",
            )
        },
    );

    let said = program_failure(&outcome);
    assert!(
        said.contains("code: \"unavailable\""),
        "the class the host refused it under is what the model reads: {said}"
    );
    assert!(
        said.contains("this run has no workspace"),
        "and the call's own reason with it: {said}"
    );

    // Every other failure class is what the call said it was. A `not-found` is a genuine tool
    // failure: the call was offered, was made, and the thing it asked for is not there.
    let (outcome, _) = run_with(
        "import * as gg from \"gg\";\ngg.files.listDir();",
        &all_operations(),
        SandboxLimits::AMPLE,
        |_, _| ToolOutcome::failed(ToolFailure::NotFound, "no such directory"),
    );
    assert!(
        program_failure(&outcome).contains("code: \"not-found\""),
        "{}",
        program_failure(&outcome)
    );
}

/// **The `view` object is bound to every program, and only `openFile` is gated.**
///
/// A view is the one channel material has into a model's own context window, so binding it from the
/// capability set would leave a run that enables no tools with nothing to show itself — the same
/// carve-out `harness` has, checked here against the **embedded artifact** rather than the source
/// catalogue. `openFile` is the exception and stays a read: withholding `read_file` must not leave a
/// side door open, and it has to close the *function* rather than the whole object, which is a
/// distinction only an end-to-end run can prove.
///
/// The rest of the programs drive the four functions the way the prompt tells a model to write them,
/// because everything about this surface that could be wrong is invisible from Rust: an argument
/// under the wrong key, a `bigint` token count that makes `JSON.stringify` throw, a refusal that
/// arrives as a bare record instead of a catchable `ApiError`.
#[test]
fn the_view_object_is_always_bound_and_only_open_file_is_gated() {
    // A run with NO tools at all still has `view`, and the two of its functions that put something
    // in the window.
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.views.openText(\"note\", \"what I found\");",
        EndingRole::Standard,
    );
    assert!(
        logs(&outcome).is_empty(),
        "the program ran and said nothing"
    );
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.views.openDocsView(\"openText\");",
        EndingRole::Standard,
    );
    assert!(
        logs(&outcome).is_empty(),
        "documentation opens for everyone"
    );

    // Closing a view is context management, bought by
    // `agent-managed-context`; a run without it is refused — by gg's own sentence naming the
    // call, and as the catchable `ApiError` every other withheld call arrives as, since the SDK is
    // static and the membrane is the whole of the enforcement.
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.views.close(\"nothing\");",
        EndingRole::Standard,
    );
    let error = uncaught(&outcome);
    assert_eq!(
        error.kind,
        crate::sandbox::ProgramErrorKind::UnknownName,
        "a withheld view call is the same class as any other name this agent does not hold"
    );
    assert!(
        error.message.contains("`gg.views.close` is not available."),
        "an agent without agent-managed-context is refused `gg.views.close`: {}",
        error.message
    );
    let outcome = run_as(
        "import * as gg from \"gg\";\ntry { gg.views.close(\"nothing\"); }\n\
         catch (e) { console.log(JSON.stringify({ isApiError: e instanceof gg.core.ApiError, operation: (e as gg.core.ApiError).operation, code: (e as gg.core.ApiError).code })); }",
        EndingRole::Standard,
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "isApiError": true, "operation": "close", "code": "unavailable" }),
        "the refusal is the structured `unavailable` error, catchable like any other"
    );

    // With the capability on, closing a selector that is not open is an answer, not a failure.
    let (outcome, _) = run(
        "import * as gg from \"gg\";\nconsole.log(JSON.stringify(gg.views.close(\"nothing\")));",
    );
    assert_eq!(
        logged_json(&outcome),
        json!(0),
        "closing a selector that is not open is an answer, not a failure"
    );

    // …but `openFile` is a read, and an agent not granted it is refused. The function is bound like
    // every other — the SDK is static — so what the model gets is gg's own sentence naming the call
    // it wrote, rather than a `TypeError` about a property that is not a function.
    let outcome = run_as(
        "import * as gg from \"gg\";\ngg.views.openFile(\"src/a.ts\");",
        EndingRole::Standard,
    );
    let said = uncaught(&outcome).message.clone();
    assert!(
        said.contains("`gg.views.openFile` is not available."),
        "an agent not granted the read is refused `gg.views.openFile`: {said}"
    );

    // With `read_file` enabled it IS bound, and it dispatches a real `read_file` carrying the same
    // typed arguments `fs.readFile` does — one read, not two, for the bytes and the view together.
    let (outcome, log) = run(
        "import * as gg from \"gg\";\nconst read = gg.views.openFile(\"src/a.ts\", { offset: 2, limit: 5 });\n\
         const first = read.kind === \"text\" ? read.firstLine : null;\n\
         console.log(JSON.stringify({ kind: read.kind, first }));",
    );
    assert_eq!(logged_json(&outcome), json!({ "kind": "text", "first": 1 }));
    assert_eq!(log.names(), ["read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "src/a.ts", "offset": 2, "limit": 5 })),
        "`view.openFile` is a `read_file`, argument for argument"
    );

    // Re-stating an intent replaces it: two `openText`s of one label are one view, which is
    // what the close of that label reports.
    let (outcome, _) = run(
        "import * as gg from \"gg\";\ngg.views.openText(\"summary\", \"first\");\n\
         gg.views.openText(\"summary\", \"second\");\n\
         console.log(JSON.stringify(gg.views.close(\"summary\")));",
    );
    assert_eq!(logged_json(&outcome), json!(1));

    // Closing reports how many it closed, and leaves the rest: `a` closes once, and `b` is
    // still there for its own close to find.
    let (outcome, _) = run(
        "import * as gg from \"gg\";\ngg.views.openText(\"a\", \"x\");\n\
         gg.views.openText(\"b\", \"y\");\n\
         console.log(JSON.stringify({\n\
             closed: gg.views.close(\"a\"), left: gg.views.close(\"b\"),\n\
         }));",
    );
    assert_eq!(logged_json(&outcome), json!({ "closed": 1, "left": 1 }));

    // A refused view arrives as a catchable `ApiError` naming the call the program made, by the
    // key of the operation it wrote — the same identity every other failed call on this membrane
    // carries.
    let (outcome, _) = run(
        "import * as gg from \"gg\";\ntry { gg.views.openText(\"\", \"body\"); }\n\
         catch (e) { console.log(JSON.stringify({ isApiError: e instanceof gg.core.ApiError, operation: (e as gg.core.ApiError).operation, code: (e as gg.core.ApiError).code })); }",
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "isApiError": true, "operation": "open_text", "code": "invalid-argument" }),
        "a view with no selector could never be closed or attributed, so it is refused"
    );

    // Reading a function's documentation opens a VIEW and returns nothing, which is the whole of
    // what replaced `fn.docs()`: a call that handed the text back inline was a second channel into
    // the model that no band was charged for and no `view.close` could reclaim.
    let (outcome, _) = run(
        "import * as gg from \"gg\";\nconsole.log(String(gg.views.openDocsView(gg.views.openText)));",
    );
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
    let (outcome, log) = run("import * as gg from \"gg\";\ngg.views.openDocsView(\"openText\");");
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
    let (outcome, log) = run("import * as gg from \"gg\";\ngg.programs.history();\n");
    assert!(
        program_failure(&outcome).contains("code: \"unavailable\""),
        "a run that keeps no library refuses the call: {}",
        program_failure(&outcome)
    );
    assert!(
        log.names().is_empty(),
        "and nothing reached the loop: a withheld family is refused at the membrane"
    );

    // `history` describes the shape of what is held, and never its source.
    let outcome = run_with_library(
        "import * as gg from \"gg\";\nconsole.log(JSON.stringify(gg.programs.history()));",
        &[("k3p9", 3, "const x = 1;\nconsole.log(x);")],
    );
    assert_eq!(
        logged_json(&outcome),
        json!([{ "id": "k3p9", "turn": 3, "lines": 2, "chars": 28, "ok": true }]),
        "a summary carries no source; `get` is how you reach for one"
    );

    // `get` returns the source verbatim, and takes the id.
    let outcome = run_with_library(
        "import * as gg from \"gg\";\nconsole.log(gg.programs.get(\"bbbb\"));",
        &[("aaaa", 1, "first"), ("bbbb", 2, "second")],
    );
    assert_eq!(logs(&outcome), ["second"]);
    let outcome = run_with_library(
        "import * as gg from \"gg\";\nconsole.log(gg.programs.history()[0].source());",
        &[("aaaa", 1, "first"), ("bbbb", 2, "second")],
    );
    assert_eq!(
        logs(&outcome),
        ["first"],
        "a summary's `source()` fetches by its own id"
    );

    // An id the library does not hold is a catchable `ApiError`, named after the call the model
    // made rather than after a gg tool that does not exist.
    let outcome = run_with_library(
        "import * as gg from \"gg\";\ntry { gg.programs.get(\"zzzz\"); }\n\
         catch (e) { console.log(JSON.stringify({ isApiError: e instanceof gg.core.ApiError, operation: (e as gg.core.ApiError).operation, code: (e as gg.core.ApiError).code })); }",
        &[("aaaa", 1, "first")],
    );
    assert_eq!(
        logged_json(&outcome),
        json!({ "isApiError": true, "operation": "get", "code": "not-found" })
    );

    // A hand-over returns like any other call and the program runs on — the same shape `finish` has,
    // and for the same reason: the host owns the flag, so there is no unwind to reason about.
    let outcome = run_with_library(
        "import * as gg from \"gg\";\ngg.programs.rerun(\"console.log('the replacement');\");\nconsole.log('still running');",
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
        "import * as gg from \"gg\";\ngg.programs.rerun(\"console.log('never');\");\nthrow new Error('boom');",
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
// These are the only tests that prove the prebuilt component really binds a module: everything
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
            source: crate::sandbox::prepare_module(
                typescript(),
                name,
                source,
                &crate::sandbox::AgentWorkspace::new(),
            )
            .expect("the test's module is prepared")
            .source,
        })
        .collect();
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        program,
        ProgramScope {
            capabilities: &all_capabilities(),
            operations: &all_operations(),
            modules: &bound,
            ending: RunEnding::Role(EndingRole::Standard),
        },
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        FakeOperationApi::new(&log),
    );
    (outcome, log)
}

/// **A loaded module's exports are callable from the program**, through the `lib:` specifier the
/// program imports it by.
///
/// The one end-to-end assertion behind code skills and code memories: the host compiles a module,
/// the guest's loader resolves it for the program that imports it, and the program calls what it
/// exported.
#[test]
fn a_code_module_is_bound_at_lib_and_its_exports_are_callable() {
    let outcome = run_with_modules(
        "import * as csvTools from \"lib:csvTools\";\n\
         console.log(JSON.stringify(csvTools.parse(\"a,b,c\")));\n",
        &[(
            "csvTools",
            "export function parse(text: string): string[] { return text.split(\",\"); }\n\
             function unexported() { return 0; }\n",
        )],
    );
    assert_eq!(logged_json(&outcome), json!(["a", "b", "c"]));

    // What the module did not export is not in its namespace: the namespace is what the file said.
    let outcome = run_with_modules(
        "import * as csvTools from \"lib:csvTools\";\n\
         console.log(String(typeof csvTools.unexported));\n",
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
        "import * as eager from \"lib:eager\";\nconsole.log(eager.first.kind);\n",
        &[(
            "eager",
            "import * as gg from \"gg\";\nexport const first = gg.files.readFile(\"a.txt\");\n",
        )],
    );
    assert_eq!(logs(&outcome), ["text"], "the program still ran");
    // The point: the read really crossed the membrane, so the module reaches gg through its own
    // import exactly as the program does.
    assert_eq!(log.names(), ["read_file"]);
}

/// **A module is evaluated by the program that imports it, and by nothing else.**
///
/// A module the program never names is never evaluated, so a broken one somebody else loaded cannot
/// take this turn down. A module the program *does* import is part of the program: its failure is
/// the program's, reported in the module's own coordinates under the specifier the program wrote.
#[test]
fn a_module_that_throws_while_loading_is_reported_and_the_program_still_runs() {
    let outcome = run_with_modules(
        "console.log(\"ran\");\n",
        &[("broken", "export const n = (undefined as any).x;\n")],
    );
    assert_eq!(
        logs(&outcome),
        ["ran"],
        "somebody else's broken module is not this program's failure"
    );

    let outcome = run_with_modules(
        "import * as broken from \"lib:broken\";\nconsole.log(String(broken.n));\n",
        &[("broken", "export const n = (undefined as any).x;\n")],
    );
    let said = program_failure(&outcome);
    assert!(said.contains("TypeError"), "{said}");
    assert!(
        said.contains("lib:broken:1:"),
        "the failure is located in the module the program imported: {said}"
    );
}

/// A run with **no** modules has no `lib` identifier at all — the same capability model every
/// withheld tool obeys.
#[test]
fn a_program_with_no_modules_has_no_lib_in_scope() {
    let outcome = run_with_modules(
        "import * as anything from \"lib:anything\";\nconsole.log(String(anything));\n",
        &[],
    );
    let said = program_failure(&outcome);
    assert!(
        said.contains("this agent has loaded no code skills or code memories"),
        "the loader says why there is nothing to import: {said}"
    );
}

/// An **on-use script** binds no ending group: it is not the agent's turn, so it cannot declare the
/// session over.
#[test]
fn an_on_use_script_has_no_ending_calls_in_scope() {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        typescript(),
        "import * as gg from \"gg\";\ngg.session.finish(\"done\");",
        ProgramScope {
            capabilities: &all_capabilities(),
            operations: &all_operations(),
            modules: &[],
            ending: RunEnding::None,
        },
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        FakeOperationApi::new(&log),
    );
    assert!(
        outcome.completion.is_none(),
        "an on-use script cannot end the session"
    );
    assert!(
        program_failure(&outcome).contains("code: \"unavailable\""),
        "an on-use script is refused the ending it reached for: {}",
        program_failure(&outcome)
    );
}
