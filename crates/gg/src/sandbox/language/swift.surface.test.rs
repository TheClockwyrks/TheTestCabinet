//! **The Swift arm's model-facing surface**, driven end to end through the real toolchain and the
//! real membrane: the hand-written SDK, the catalogue reflected out of its own symbol graph, and the
//! libraries this arm says a program may reach.
//!
//! # Why these are not in the substrate file
//!
//! Because they are a different claim. [`substrate`](super::substrate) asks whether Swift runs here.
//! This asks whether the thing a model is **told** it may write is the thing the sandbox really has
//! — which is the only question a cross-language study rests on, and the one whose failure is
//! silent: an SDK and a catalogue that agree with each other and with nothing else are two green
//! test suites and an invalidated experiment.
//!
//! # How they are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in it costs a
//! real `swiftc` and a Cranelift compile of the component it produced — a Swift artifact is not
//! byte-for-byte reproducible, so the test-only component cache cannot serve it. A function
//! groups the programs that exercise one behaviour, so they share that cost; one that grows
//! into the slow end of the suite is split rather than extended.

use serde_json::{Value, json};

use super::compile;
use super::substrate::{
    evaluate, evaluate_closing_docviews, evaluate_with_api, logs, prepare, sandbox_error,
};
use crate::ending::{Ending, EndingRole};
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY,
};

use crate::docs::DocKind;
use crate::model::Role;
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_operations, all_operations_without, canned_outcome,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::operations::{DELEGATION_TRANSITION_STATE, OperationId, PROGRAMS_GET};
use crate::sandbox::outcome::SandboxOutcome;
use crate::sandbox::{CodeModule, PrepareContext, PrepareFailure};
use crate::tools::{
    AgentStatusData, ApiData, ArchiveHitData, ArchiveSearchData, ReclaimData, SubagentResultData,
    ToolFailure, ToolOutcome,
};

/// The catalogue this arm's build reflects, read as a **document** rather than through
/// [`SignatureCatalogue`](crate::sandbox::signatures) — deliberately, because the parsed reading is
/// a *projection* and a field the parser does not model is one these tests could not notice was
/// missing. Here the JSON is read as JSON, which is what lets a test say the file carries a section
/// at all.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/swift.signatures.json"
));

/// This arm's generated catalogue, parsed as JSON.
fn catalogue() -> Value {
    serde_json::from_str(SIGNATURES).expect("the generated catalogue is JSON")
}

/// Every entry of one of the catalogue's function-carrying sections.
fn section<'a>(catalogue: &'a Value, name: &str) -> &'a Vec<Value> {
    catalogue[name]
        .as_array()
        .unwrap_or_else(|| panic!("the catalogue carries a `{name}` section"))
}

/// One entry's string field.
fn text<'a>(entry: &'a Value, field: &str) -> &'a str {
    entry[field]
        .as_str()
        .unwrap_or_else(|| panic!("an entry carries a `{field}`: {entry}"))
}

/// Compile and run one Swift program with `enabled`'s operations offered and no ending group.
fn run_with(
    source: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(source),
        operations,
        RunEnding::None,
        false,
        responder,
    )
}

/// One operation, called through the Swift spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound operation, called through its idiomatic Swift function.
///
/// Deliberately the same table the other arms' surface tests drive theirs with, down to the
/// arguments and the expected JSON — because the expected JSON is the point. gg's dispatch is
/// language-independent: nine arms writing the same call in their own idioms must produce
/// **byte-identical** arguments, or they are not running the same experiment. A default argument
/// lowered onto the wrong wire slot, a `.clear` read as "leave it alone" instead of "clear it", an
/// enum case whose wire word did not translate — none of them is a compile error in any of the nine,
/// and all of them are visible here.
///
/// What differs from every other arm's table is the **argument labels**, which is Swift's defining
/// feature and the one this SDK leans on hardest: `files.editFile("a", replacing: "x", with: "y")` and
/// `delegation.sendMessage("note", to: id)` read as sentences, and the label is part of the function's
/// name rather than a way of reordering a call.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: r#"try shell.run("npm test", timeout: 30)"#,
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: r#"_ = try files.readFile("src/a.swift", offset: 2, limit: 5)"#,
            expected: || json!({ "path": "src/a.swift", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: r#"try files.writeFile("out.txt", contents: "hello")"#,
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: r#"try files.editFile("src/a.swift", replacing: "alpha", with: "beta")"#,
            expected: || json!({ "path": "src/a.swift", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: r#"_ = try files.listDir("src")"#,
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            statement: r#"_ = try files.tree(path: "src", depth: 3)"#,
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            statement: r#"_ = try files.search("answer", path: "src", limit: 10)"#,
            expected: || json!({ "query": "answer", "path": "src", "limit": 10 }),
        },
        Crossing {
            tool: "read_skill",
            statement: r#"_ = try skills.readSkill("testing")"#,
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: r#"try memories.writeMemory("layout", description: "d", body: "b")"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: r#"try memories.updateMemory("layout", description: "d2", body: "b2")"#,
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, and the one that skips a default
            // argument between two it names — which is what a Swift author does instead of filling
            // in a record.
            statement: r#"try memories.createMemory(
                "layout", description: "d", body: "b", code: "public func one() -> Int { 1 }")"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "public func one() -> Int { 1 }", "onUse": null })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: r#"_ = try memories.readMemory("layout")"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: r#"try memories.editMemory("layout", replacing: "old", with: "new")"#,
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: r#"_ = try memories.searchMemories(["cargo", "nextest"])"#,
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: r#"try memories.deleteMemory("layout")"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: r#"try tasks.addTask("t1", title: "T", description: "D", blockedBy: ["t0"])"#,
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: r#"try tasks.updateTask("t1", title: "T2", description: .clear, status: .inProgress)"#,
            expected: || {
                // `.clear` is what CLEARS it — the default `.keep` is what leaves it alone — and
                // `in_progress` is gg's own spelling, so the membrane's `in-progress` reaches
                // neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: r#"try tasks.setBlockedBy("t1", to: [])"#,
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: r#"try tasks.completeTask("t1")"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: r#"try tasks.removeTask("t1")"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: r#"try board.createEpic(prefix: "epc", title: "E", description: "D")"#,
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: r#"try board.createIssue(
                title: "I", inScope: "s", outOfScope: "o", completionCriteria: "c",
                agent: "worker", reviewers: ["critic"])"#,
            expected: || {
                json!({
                    "title": "I",
                    "description": null,
                    "inScope": "s",
                    "outOfScope": "o",
                    "completionCriteria": "c",
                    "blockedBy": [],
                    "epicId": null,
                    "agent": "worker",
                    "reviewers": ["critic"],
                })
            },
        },
        Crossing {
            tool: "update_issue",
            statement: r#"try board.updateIssue("i1", status: .done, epic: .ungroup)"#,
            expected: || {
                // `.ungroup` ungroups the issue, which gg's schema spells as the empty string; a
                // description the call left at its `.keep` default keeps the one it has, so its key
                // is absent.
                json!({
                    "id": "i1",
                    "title": null,
                    "inScope": null,
                    "outOfScope": null,
                    "completionCriteria": null,
                    "status": "done",
                    "epicId": "",
                })
            },
        },
        Crossing {
            tool: "set_issue_blocked_by",
            statement: r#"try board.setIssueBlockedBy("i1", to: ["i0"])"#,
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: r#"try board.removeEpic("e1")"#,
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: r#"try board.removeIssue("i1")"#,
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: r#"try board.waitForIssue("i1")"#,
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: r#"try context.evictFileView("src/a.swift")"#,
            expected: || json!({ "path": "src/a.swift" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a Swift CLOSED RANGE — `4...19` — rather than a record with two
            // fields, because that is what an inclusive span of integers is in this language.
            statement: r#"try context.archiveThread([4...19, 30...35])"#,
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: r#"_ = try context.searchArchive("the parser")"#,
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: r#"try context.compact(summary: "scaffolded the page", files: ["src/main.swift"])"#,
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/main.swift"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a typed value rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: r#"try delegation.spawnSubagent("subagent", task: .prompt("write the lexer"))"#,
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: r#"_ = try delegation.waitForSubagents(["agent-1"])"#,
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: r#"try delegation.sendMessage("prefer the simpler parser", to: "agent-1")"#,
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: r#"try delegation.transitionState(to: "verify", note: "the build is green")"#,
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: r#"try delegation.exec("Builder", prompt: "pick it up from here")"#,
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: r#"try delegation.fork("try the other fix")"#,
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_operation_crosses_the_membrane_from_its_swift_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: a compile and an instantiate here are ~1.6 s
    // between them, so thirty-five of them would be a minute of toolchain for a table that reads the
    // same. It is also the stronger check — the calls must arrive in the order the program made
    // them, so a call that reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    let program: String = std::iter::once(format!("{}\n\n", super::SURFACE_IMPORT))
        .chain(
            crossings
                .iter()
                .map(|crossing| format!("{}\n", crossing.statement)),
        )
        .collect();
    let (outcome, log) = run_with(&program, &all_operations(), canned_outcome);
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the program did not run cleanly: {:?}",
        outcome.result
    );

    let expected: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    assert_eq!(
        log.names(),
        expected,
        "the calls did not reach gg's dispatch under their own names, in order"
    );
    for crossing in &crossings {
        assert_eq!(
            log.args(crossing.tool),
            Some((crossing.expected)()),
            "`{}` carried the wrong arguments",
            crossing.statement
        );
    }

    // Exhaustive by construction: an operation added to gg with no row here fails now, rather than
    // shipping as a typed function nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut vocabulary = crate::sandbox::signatures::sandbox_operation_names();
    vocabulary.sort_unstable();
    assert_eq!(
        covered, vocabulary,
        "every bound operation needs a crossing, and only bound operations may have one"
    );
}

#[test]
fn the_view_object_the_helper_and_the_standard_ending_are_reached_in_swift_too() {
    // Three of the families that are NOT gg tools, so none of them appears in the crossing table
    // above — and they are where a program puts something in front of the model and finds out what
    // it may call at all, which makes them the ones a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(
            r####"
import gg

let read = try views.openFile("notes.md", offset: 1, limit: 2)
try views.openText("summary", body: "eight files, two failing")
try views.openDocsView("readFile")
let closed = try views.close("summary")
let missing = try views.close("never opened")
gg.log("\(closed) \(missing)")
switch read {
case .text(let file): gg.log(file.contents.split(separator: "\n").first.map(String.init) ?? "")
case .image(let picture): gg.log(picture.label)
}
let found = try docs.search(query: "open", modules: ["views"], kind: .function, limit: 5)
gg.log("\(found.total) \(found.offset) \(found.hits.count)")
do {
    gg.log("closed \(try docs.close("gg.views.openText"))")
} catch let failure as core.ApiError {
    gg.log("\(failure.code) on \(failure.operation)")
}
do {
    gg.log("closed \(try docs.closeAll())")
} catch let failure as core.ApiError {
    gg.log("\(failure.code) on \(failure.operation)")
}
try session.finish("read the file and showed myself the result")
"####,
        ),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // Closing something that is not open is `0` rather than a failure, so a program that tidies up
    // unconditionally does not have to guard every call.
    assert_eq!(lines[0], "1 0");
    assert_eq!(lines[1], "contents of notes.md");
    // A search hands the program a page it can read in the turn that asked for it — the count, the
    // echoed offset, and the hits themselves. The double models no catalogue, so the honest page is
    // an empty one; what this proves is the crossing, which is the half no other test covers on this
    // arm. The ranking over a real catalogue is the documentation runtime's own to prove.
    assert_eq!(lines[2], "0 0 0");
    // Closing documentation is the one part of this family a run buys, and this run did not: the
    // program is refused by the host, as the error a Swift author catches, under the call's own name
    // rather than by a name that was never in scope — a compiled arm cannot withhold a name.
    assert_eq!(lines[3], "unavailable on close");
    assert_eq!(lines[4], "unavailable on close_all");
    // Every view the program opened is recorded, the documentation one and the search's own
    // included — a search puts its page in the window as well as handing it back.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes.md", "summary", "readFile", "search results"]
    );
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::Finished { summary }) if summary.starts_with("read the file")
        ),
        "the ending the program declared: {:?}",
        outcome.completion
    );

    // And the same two calls once the run has bought the capability, which is the only way to reach
    // their answer at all: refused, the count a program reads is never lifted. The double holds no
    // window, so nothing is open and `0` is the honest number — a success, exactly as it is in
    // production for a key that is not open.
    let (granted, _log) = evaluate_closing_docviews(
        &prepare(
            r####"
import gg

gg.log("\(try docs.close("gg.views.openText")) \(try docs.closeAll())")
"####,
        ),
        canned_outcome,
    );
    assert_eq!(logs(&granted), ["0 0"]);

    // One read reached gg's dispatch and arrived as `read_file`: the one `views.openFile`
    // performs. It has no tool name of its own, which is exactly the point — a view is a read gg
    // also shows you.
    assert_eq!(log.names(), ["read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );

    // THE FULLY-QUALIFIED NAME IS WHAT A PROGRAM WRITES, AND IT SURVIVES BEING SHADOWED.
    // Every entry in this arm's catalogue is keyed by `gg.<module>.<name>` and carries no separate
    // `call`, which is a claim that the key compiles. Here it is compiled — in the one file where
    // the short form does not, because the program declared a `files` of its own. Top-level Swift
    // is one scope for the whole file, so the shadowing reaches back over the line above it; the
    // qualified form goes through the module the SDK is compiled into and is unaffected. This is the
    // measurement behind the sentence the prompt and the SDK's own header make.
    let (outcome, log) = run_with(
        r####"
import gg

let files = ["a", "b"]
gg.log("\(files.count)")
switch try gg.files.readFile("notes.md") {
case .text(let file): gg.log(file.contents)
case .image(let picture): gg.log(picture.label)
}
"####,
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2", "contents of notes.md\nline two\n"]);
    assert_eq!(log.names(), ["read_file"]);
}

#[test]
fn the_program_library_and_a_reviewers_verdict_are_reached_in_swift_too() {
    // The program library is bound from the CAPABILITY rather than from a tool name, and a reviewer
    // gets the other ending group. Between this and the two functions above, every function this
    // arm's catalogue describes has been driven through the real membrane.
    let (outcome, _log) = evaluate(
        &prepare(
            r####"
import gg

let history = try programs.history()
gg.log("\(history.count)")
do {
    gg.log(try programs.get("k3p9"))
} catch let failure as core.ApiError {
    gg.log("\(failure.code)")
}
try programs.rerun("gg.log(\"again\")")
try session.requestChanges(["widen the test", "name the file"])
"####,
        ),
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never a failure — and an id it never
    // issued a program under is a `.notFound` the program catches in Swift's own idiom.
    assert_eq!(logs(&outcome), ["0", "notFound"]);
    assert!(outcome.rerun.is_some(), "the hand-over is recorded");
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::ChangesRequested { items }) if items.len() == 2
        ),
        "the reviewer's verdict, with both items: {:?}",
        outcome.completion
    );

    // The other verdict, which is the same role's other ending, and the one call in the surface that
    // takes nothing at all.
    let (outcome, _log) = evaluate(
        &prepare("import gg\n\ntry session.approve()\n"),
        &[],
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert!(
        matches!(
            outcome
                .completion
                .as_ref()
                .map(|completion| &completion.ending),
            Some(Ending::Approved)
        ),
        "{:?}",
        outcome.completion
    );
}

#[test]
fn a_failure_is_thrown_whether_it_is_caught_or_let_out() {
    // Caught: an ordinary `catch` with a `where` clause on the code, which is what a program that
    // expects one failure and not the others writes. Nothing about it is exceptional — `ApiError`
    // is an ordinary Swift `Error`, so `do`/`catch`, `try?` and `Result { }` all work on it without
    // an SDK-specific combinator.
    let (outcome, _log) = run_with(
        r####"
import gg

do {
    _ = try files.readFile("gone.swift")
    gg.log("read it")
} catch let failure as core.ApiError where failure.code == .notFound {
    gg.log("\(failure.code) on \(failure.operation)")
}
gg.log("carried on")
"####,
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                ToolFailure::NotFound,
                "no such file: gone.swift".to_string(),
            )
        },
    );
    assert_eq!(logs(&outcome), ["notFound on read_file", "carried on"]);

    // Let out: Swift's top-level code is not a `throws` context anything can wrap, so an uncaught
    // failure is a TRAP rather than a reported error. What a model reads is what the runtime says
    // about it — and the measurement here is that **gg's own sentence survives**: `ApiError` is
    // `CustomStringConvertible`, the runtime renders the error it could not handle, and the tool,
    // the class and the message all come through.
    let (outcome, _log) = run_with(
        r####"
import gg

gg.log("before")
_ = try files.readFile("gone.swift")
gg.log("after")
"####,
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                ToolFailure::NotFound,
                "no such file: gone.swift".to_string(),
            )
        },
    );
    let failure = sandbox_error(&outcome).to_string();
    assert!(
        failure.contains("Error raised at top level"),
        "an uncaught failure did not say what happened to it: {failure}"
    );
    assert!(
        failure.contains("`read_file` failed (not-found): no such file: gone.swift"),
        "the model reads gg's own sentence rather than a Swift type name: {failure}"
    );

    // And the gap, asserted rather than glossed. An uncaught THROW is the one failure on this arm
    // that reaches a model **unlocated**, and it is the opposite of what the runtime does with an
    // index out of range: there the trap is at the model's own instruction and `-g` symbolicates it
    // to `main.swift:3:22`, while here the runtime hands the error to `swift_errorInMain` from the
    // entry point's synthesized epilogue — so the only frames left are `/<compiler-generated>`, and
    // there is no line to recover. Catching what you expect is what buys the line back, which is why
    // the half above is written the way a program should be.
    assert!(
        !failure.contains("main.swift:"),
        "an uncaught throw is expected to arrive unlocated on this arm; if this now carries the \
         model's own line, the comment above is out of date and the gap has closed: {failure}"
    );
    assert_eq!(
        outcome.logs,
        ["before"],
        "what ran before it still stands: {:?}",
        outcome.logs
    );

    // AND THE ONE FAILURE THIS ARM'S SDK RAISES ITSELF, BEFORE THE MEMBRANE.
    // `depth` is a signed `Int` here — Swift has no unsigned integer a model would write by hand —
    // so a negative one has to be refused in the SDK: lowered instead, `-1` becomes 4294967295 and
    // the host answers a nonsensical request with a tree clamped to the ceiling. Both `0` and `-1`
    // come back as `invalid-argument` under the call's own gg name, neither reaches gg's dispatch,
    // and the well-formed depth beside them still does.
    let (outcome, log) = run_with(
        r####"
import gg

for depth in [0, -1] {
    do {
        _ = try files.tree(depth: depth)
        gg.log("walked at \(depth)")
    } catch let failure as core.ApiError {
        gg.log("\(failure.code) on \(failure.operation)")
    }
}
gg.log(try files.tree(path: "src", depth: 3))
"####,
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "invalidArgument on tree",
            "invalidArgument on tree",
            "a.ts\nb.test.ts\nsub/\n  c.ts"
        ]
    );
    assert_eq!(
        log.names(),
        ["tree"],
        "only the well-formed depth reached gg's dispatch: {:?}",
        log.names()
    );
    assert_eq!(log.args("tree"), Some(json!({ "path": "src", "depth": 3 })));
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // This arm cannot withhold a NAME: its SDK is a module linked into the program, so every
    // function is in scope whatever a run enables and the host is the only thing that can refuse.
    // That is exactly the case `error-code.unavailable` exists for, and the recovery is the same one
    // a name that was never in scope gets.
    let (outcome, log) = run_with(
        r####"
import gg

do {
    _ = try shell.run("swift build")
    gg.log("ran")
} catch let failure as core.ApiError {
    gg.log("\(failure.code)")
}
"####,
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["unavailable".to_string()],
        "a tool this run does not offer was not refused as unavailable"
    );
    assert!(
        log.names().is_empty(),
        "a withheld tool must not reach gg's dispatch at all"
    );

    // AND IT LANDS ON THE TURN'S REFUSAL ROSTER, under gg's own key rather than this arm's spelling.
    // That matters more here than on most arms: an UNCAUGHT gg failure on this arm is not a
    // `program-error` at all — Swift's top-level code is not a `throws` context the shell can wrap,
    // so it traps the store — which means the turn error type a cross-arm study would otherwise
    // count withheld reaches by says nothing about this arm. The roster is the source that is
    // uniform across all eleven, and it is asserted here so that stays true. See
    // `sandbox.test.rs`'s `a_refused_call_is_the_same_turn_error_as_an_unbound_name`.
    assert_eq!(
        outcome
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>(),
        ["shell.shell"],
        "the refusal is recorded under gg's own identity for the call: {:?}",
        outcome.refusals
    );
}

#[test]
fn swift_reaches_every_library() {
    // Every module the catalogue's `libraries` section names, imported and used for what it is there
    // for. The claim is not that these compile in the abstract: it is that a MODEL'S PROGRAM,
    // compiled by the production prepare step against the committed archive, can name them — which
    // is the promise the prompt makes and the one a stale archive or a missing `-I` would break
    // silently.
    let catalogue = catalogue();
    let named: Vec<&str> = section(&catalogue, "libraries")
        .iter()
        .flat_map(|group| group["modules"].as_array().expect("a group lists modules"))
        .map(|module| module.as_str().expect("a module is named by a string"))
        .collect();
    assert_eq!(
        named,
        [
            "Collections",
            "DequeModule",
            "OrderedCollections",
            "HeapModule",
            "BitCollections",
            "HashTreeCollections",
            "RopeModule",
            "Algorithms",
            "RealModule",
            "ComplexModule",
            "Foundation",
            "FoundationEssentials",
            "FoundationInternationalization",
            "FoundationXML",
            "RegexBuilder",
            "Synchronization",
            "Observation",
            "WASILibc",
            "Swift",
        ],
        "the set a program is told it may reach has changed; the program below must follow it"
    );

    // And the other direction, which nothing else closes: what the committed archive really carries,
    // read off the manifest `build.sh` wrote. A module vendored and left out of `libraries.txt`
    // would be a library this arm ships and never mentions.
    let vendored: Vec<&str> = compile::library_modules().collect();
    let mut declared: Vec<&str> = named
        .iter()
        .copied()
        .filter(|module| !SHIPPED_WITH_THE_SDK.contains(module))
        .collect();
    declared.sort_unstable();
    let mut sorted = vendored;
    sorted.retain(|module| *module != "InternalCollectionsUtilities");
    sorted.sort_unstable();
    assert_eq!(
        sorted, declared,
        "the modules the committed archive carries and the modules a model is told about have \
         drifted apart"
    );

    // One import per declared module, so a name that does not resolve is a compile failure naming
    // it, and one real use of the two the whole vendored set exists for.
    let (outcome, _log) = run_with(
        r####"
import gg

import Collections
import DequeModule
import OrderedCollections
import HeapModule
import BitCollections
import HashTreeCollections
import RopeModule
import Algorithms
import RealModule
import ComplexModule
import Foundation
import FoundationEssentials
import FoundationInternationalization
import FoundationXML
import RegexBuilder
import Synchronization
import Observation
import WASILibc

var queue: Deque<Int> = [2, 3]
queue.prepend(1)
let pairs = queue.adjacentPairs().map { "\($0)-\($1)" }.joined(separator: ",")

var ranked = OrderedDictionary<String, Int>()
ranked["second"] = 2
ranked["first"] = 1
let order = ranked.keys.joined(separator: ",")

var heap = Heap<Int>()
heap.insert(5)
heap.insert(2)
let smallest = heap.min ?? -1

let bits: BitSet = [1, 4, 9]
let flags = bits.map(String.init).joined(separator: "/")

let chunks = Array([1, 2, 3, 4, 5].chunks(ofCount: 2)).map { Array($0) }
let unique = ["b", "a", "b"].uniqued().sorted().joined(separator: ",")

let rooted = Double.root(27, 3)
let parsed = try JSONSerialization.jsonObject(with: Data(#"{"count":3}"#.utf8))
let count = (parsed as? [String: Any])?["count"] as? Int ?? 0

gg.log("\(pairs) \(order) \(smallest) \(flags) \(chunks) \(unique) \(Int(rooted)) \(count)")
"####,
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["1-2,2-3 second,first 2 1/4/9 [[1, 2], [3, 4], [5]] a,b 3 3".to_string()],
        "a library this arm ships was not reachable, or did not behave"
    );
}

/// The modules `libraries.txt` names that the **Swift SDK for WebAssembly** ships, rather than ones
/// this arm vendored into its own archive.
///
/// They are declared for the same reason the vendored ones are — a model that is not told about
/// `Foundation` will not reach for it — and they are excluded from the manifest comparison above
/// because nothing in this repository builds them. `Swift` is here too: it is the standard library,
/// in scope with no import at all.
const SHIPPED_WITH_THE_SDK: [&str; 9] = [
    "Foundation",
    "FoundationEssentials",
    "FoundationInternationalization",
    "FoundationXML",
    "RegexBuilder",
    "Synchronization",
    "Observation",
    "WASILibc",
    "Swift",
];

#[test]
fn the_generated_catalogue_describes_the_surface_the_sdk_offers() {
    let catalogue = catalogue();
    assert_eq!(
        text(&catalogue, "language"),
        "swift",
        "the catalogue must say whose spellings it carries, and this arm's id is what a run \
         resolves it by"
    );
    // Read as a string *and* through `SignatureCatalogue`, which are two different claims: the
    // string is what this file can say a section exists at all, and the parse is what says the seam
    // resolves this catalogue to this arm rather than to a stem filed under the wrong name.
    assert_eq!(
        crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::Swift)
            .catalogue()
            .language,
        test_cabinet_core::gg::GgProgramLanguage::Swift,
    );

    // Identity: the modules, in the order the surface is presented in, each under the Swift path a
    // program writes and a fully-qualified name is prefixed with. `core` is last and carries no
    // capability, which is why it is the one module with no directory.
    let modules: Vec<(&str, &str)> = section(&catalogue, "modules")
        .iter()
        .map(|module| (text(module, "id"), text(module, "path")))
        .collect();
    assert_eq!(
        modules,
        [
            ("files", "gg.files"),
            ("shell", "gg.shell"),
            ("board", "gg.board"),
            ("tasks", "gg.tasks"),
            ("memories", "gg.memories"),
            ("views", "gg.views"),
            ("docs", "gg.docs"),
            ("context", "gg.context"),
            ("delegation", "gg.delegation"),
            ("skills", "gg.skills"),
            ("programs", "gg.programs"),
            ("session", "gg.session"),
            ("core", "gg.core"),
        ],
        "the modules, their order, or their Swift paths are not the surface's"
    );

    // Every gg operation is bound exactly once, and nothing that is not one is claimed. That is the
    // tool bijection: an arm asserts which operation each function binds, and gg's own table says
    // whether that operation exists — see `language/register.rs`, which fails an id gg has no row
    // for.
    let mut canonical: Vec<String> = section(&catalogue, "functions")
        .iter()
        .filter(|entry| entry["aliasOf"].is_null())
        .map(|entry| text(entry, "operation").to_string())
        .collect();
    canonical.sort();
    let mut offered: Vec<String> = crate::sandbox::operations::OPERATIONS
        .iter()
        .map(|operation| operation.id.to_string())
        .collect();
    offered.sort();
    assert_eq!(
        canonical, offered,
        "the catalogue and gg's operation vocabulary have drifted apart"
    );

    // Spelling: `camelCase`, because that is what Swift spells a function in. gg's vocabulary is
    // `snake_case`, so on this arm the two differ for every operation whose name is more than one
    // word — which is what the operation id exists for, and what a catalogue that quietly used gg's
    // spelling would hide.
    for entry in section(&catalogue, "functions") {
        let name = text(entry, "name");
        assert!(
            !name.contains('_'),
            "`{name}` is not how Swift spells a function"
        );
        // And the fully-qualified name is a real Swift path a program may write: the module's own,
        // then the name, with the receiver in between where a value carries the call.
        let fqn = text(entry, "fqn");
        assert!(
            fqn.starts_with("gg.") && fqn.ends_with(name),
            "`{fqn}` is not this arm's own spelling of `{name}`"
        );
        assert!(
            entry["call"].is_null(),
            "`{fqn}` is what a program writes, so there is no second spelling to record"
        );
    }

    // The idiom this arm exists to produce, asserted where a model reads it: required arguments
    // positional and unlabelled where the name already says what they are, optional ones expressed
    // as DEFAULT VALUES rather than as a record, argument labels on everything whose role the
    // function's name does not carry, `throws` on the way out, and a closed range where the wire has
    // a record.
    let signature = |operation: &str| {
        let entry = section(&catalogue, "functions")
            .iter()
            .find(|entry| text(entry, "operation") == operation && entry["aliasOf"].is_null())
            .unwrap_or_else(|| panic!("`{operation}` is catalogued"));
        let shapes = entry["signatures"].as_array().expect("an entry has shapes");
        assert_eq!(
            shapes.len(),
            1,
            "this SDK expresses an optional argument as a default value rather than as an \
             overload, so every entry has exactly one shape"
        );
        text(&shapes[0], "signature").to_string()
    };
    assert_eq!(
        signature("files.read_file"),
        "readFile(_ path: String, offset: Int? = nil, limit: Int? = nil) throws -> files.FileRead"
    );
    assert_eq!(
        signature("shell.shell"),
        "run(_ command: String, timeout: Double? = nil) throws -> shell.ShellOutput"
    );
    assert_eq!(
        signature("files.edit_file"),
        "editFile(_ path: String, replacing oldString: String, with newString: String) throws"
    );
    assert_eq!(
        signature("context.archive_thread"),
        "archiveThread(_ ranges: [ClosedRange<Int>]) throws -> context.ReclaimReport"
    );
    assert_eq!(
        signature("board.create_issue"),
        "createIssue(title: String, inScope: String, outOfScope: String, \
         completionCriteria: String, agent: String, description: String? = nil, \
         blockedBy: [String] = [], epic: String? = nil, reviewers: [String] = []) \
         throws -> board.IssueCreated"
    );
    // A member function is the one place the receiver is what a program already holds, so its
    // signature starts at the name and says nothing about the value it hangs off.
    assert_eq!(
        signature("delegation.send_message"),
        "sendMessage(_ message: String, to agentId: String) throws"
    );

    // A default value is what makes an argument optional in Swift, so the catalogue's two fields
    // must say the same thing about every argument of every shape — a `default` on a required
    // argument, or an optional one without a default, would be a catalogue describing a call a model
    // could not write.
    for entry in section(&catalogue, "functions") {
        for shape in entry["signatures"].as_array().expect("an entry has shapes") {
            for parameter in shape["parameters"]
                .as_array()
                .expect("a shape has parameters")
            {
                assert_eq!(
                    parameter["optional"].as_bool().expect("a flag"),
                    !parameter["default"].is_null(),
                    "`{}`'s `{}` disagrees with itself about being optional",
                    text(entry, "name"),
                    text(parameter, "name")
                );
                assert_eq!(
                    text(parameter, "kind"),
                    "positional",
                    "every Swift argument is positional, label or no label"
                );
            }
        }
    }

    // Every word of it is written on a declaration: nothing blank, an argument documented for every
    // argument a signature names, and a member documented for every member of every type. The
    // reflector refuses to emit a catalogue that breaks this, and this is the second reading of it —
    // over the emitted JSON, where it is the same check for every language there will ever be.
    for entry in section(&catalogue, "functions") {
        let called = text(entry, "name");
        assert!(
            !text(entry, "brief").trim().is_empty(),
            "`{called}` has no documentation"
        );
        for shape in entry["signatures"].as_array().expect("an entry has shapes") {
            let written = text(shape, "signature");
            for parameter in shape["parameters"]
                .as_array()
                .expect("a shape has parameters")
            {
                let argument = text(parameter, "name");
                assert!(
                    !text(parameter, "doc").trim().is_empty(),
                    "`{called}`'s `{argument}` has no documentation"
                );
                assert!(
                    written.contains(argument),
                    "`{called}` documents an argument its signature does not name: {written}"
                );
            }
        }
    }
    for declaration in section(&catalogue, "types") {
        let named = text(declaration, "fqn");
        assert!(
            !text(declaration, "brief").trim().is_empty(),
            "the type `{named}` has no documentation"
        );
        assert!(
            named.starts_with("gg.") && named.ends_with(text(declaration, "name")),
            "`{named}` is not this arm's own spelling of a type"
        );
        let members = declaration["members"]
            .as_array()
            .expect("a type declares members");
        assert!(
            !members.is_empty(),
            "the type `{named}` declares no members"
        );
        for member in members {
            let member_name = text(member, "name");
            assert!(
                !text(member, "brief").trim().is_empty(),
                "`{named}.{member_name}` has no documentation"
            );
        }
    }
}

/// **Nothing this arm offers resolves in a program that wrote no line for it** — asked of `swiftc`
/// rather than read off the sources.
///
/// This is the [import invariant](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) for
/// this arm, and the one a reading of the sources cannot settle: gg's shell is compiled in the
/// **same Swift module** as the model's file, so what a shell wrote used to decide what the reply
/// could name. A `-I` tells the compiler a module exists and puts no name in scope; an
/// `@_exported import` in the shell put the whole surface in scope in every file of the module.
/// The difference is invisible in the model's own file and decided by `swiftc`, so it is asked of
/// `swiftc`.
///
/// Five programs, differing only in what stands above the call:
///
/// * nothing — refused, *cannot find 'files' in scope*, which is what "no name is in scope" looks
///   like;
/// * nothing, reaching for the fully qualified name — refused too, because `gg` is itself the
///   module's name and there is no path around the import;
/// * [`SURFACE_IMPORT`](super::SURFACE_IMPORT) — accepted, which is what makes the line every
///   module of this arm's catalogue states a line worth quoting;
/// * gg's own wire, which the shell reaches through a clang module of its own — refused, so the
///   header gg compiles beside every program reaches gg's file and no other;
/// * the entry-point symbol the shell calls — refused, for the same reason.
///
/// It compiles and never runs, so it instantiates no component: what a compiler refuses never
/// reaches a guest.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let compile = |source: &str| {
        compile::compile_program(source, &[], &crate::sandbox::PrepareContext::detached())
    };
    let refusal = |source: &str, wanted: &str| {
        let failure =
            compile(source).expect_err("a gg name with no line above it does not compile");
        match failure {
            crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
                diagnostic,
            )) => assert!(
                diagnostic.starts_with("main.swift:1:") && diagnostic.contains(wanted),
                "a program naming gg's surface with no import line was refused for another \
                 reason: {diagnostic}"
            ),
            other => panic!(
                "a name that is not in scope is the model's compile error, not {other:?}. gg's \
                 surface is reaching a program that never asked for it."
            ),
        }
    };

    refusal(
        "try views.openText(\"t\", body: \"b\")\n",
        "cannot find 'views' in scope",
    );
    refusal(
        "try gg.views.openText(\"t\", body: \"b\")\n",
        "cannot find 'gg' in scope",
    );
    compile(&format!(
        "{}\n\ntry views.openText(\"t\", body: \"b\")\n",
        super::SURFACE_IMPORT
    ))
    .expect("the line this arm's catalogue states brings the surface into scope");

    // gg's own wire and gg's own entry-point symbol travelled with a bridging header until this
    // arm converted, so both were in scope in a reply that wrote nothing. They are a clang module
    // the shell imports now, and the shell's import is file-scoped.
    refusal(
        "var lowered = sandbox_string_t()\n",
        "cannot find 'sandbox_string_t' in scope",
    );
    refusal(
        "let entry = __main_argc_argv\n",
        "cannot find '__main_argc_argv' in scope",
    );

    // And gg's own two exports, which the shell declares in the SAME module as `main.swift` —
    // where an `import` is file-scoped, an access level is not, so `public` or `internal` on
    // either of these would put a name the model was never told about into the model's own file.
    // `@_cdecl` emits the C symbol at any access level, so `fileprivate` costs the world nothing.
    refusal(
        "let bound = ggBoundOperations\n",
        "cannot find 'ggBoundOperations' in scope",
    );
    refusal("let run = ggRun\n", "cannot find 'ggRun' in scope");
}

/// **The bytes `swiftc` reads are the bytes the model sent**, compared byte for byte in the
/// preparation's own workspace.
///
/// The [authorship gate](super::super::authorship) asserts this across every arm from the outside.
/// This asks it of the one file that matters here and names it: `main.swift`, the file every
/// diagnostic and every located trap on this arm is reported in. A program carrying its own
/// `import`, a comment, an odd indent and no trailing newline, so that anything that normalised,
/// re-indented or terminated the text would show.
#[test]
fn the_bytes_the_compiler_reads_are_the_bytes_the_model_sent() {
    let source = "import gg\n\n// a comment gg has no business touching\n   \
                  gg.log(\"kept\")";
    let context = crate::sandbox::PrepareContext::detached();
    compile::compile_program(source, &[], &context).expect("the subject compiles");
    let workspace = context
        .opened_workspace()
        .expect("this arm's preparation opens a workspace to run a compiler in");
    // `work/` is the directory a preparation writes its compiler's inputs into
    // (`language/compile.rs`'s `Workspace`), and `main.swift` is the one file in it that carries
    // the model's own text.
    let written = std::fs::read_to_string(workspace.join("work").join(compile::PROGRAM_FILE))
        .expect("the file the compiler was given is readable");
    assert_eq!(
        written, source,
        "gg wrote something other than the model's own text into the file swiftc read"
    );
}

/// **The file-view program gg synthesizes is a program this arm compiles.**
///
/// gg pushes it into an agent's transcript as an assistant turn — every file a test case provided,
/// or one restored view — and a model reads its own transcript as the example of what a well-formed
/// reply looks like. Nothing on the turn path compiles it, so a text that could not have been sent
/// would teach the wrong shape and never fail anything, which is what this is for. On this arm the
/// thing it could get wrong is the import line, and the discarded result of a call that returns one.
#[test]
fn the_file_view_program_gg_synthesizes_is_a_program_that_compiles() {
    let arm = crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::Swift);
    let window = crate::sandbox::FileWindow {
        offset: 400,
        limit: 200,
    };
    let program =
        arm.open_file_program(&[("src/main.swift", None), ("docs/spec.md", Some(window))]);
    compile::compile_program(&program, &[], &crate::sandbox::PrepareContext::detached())
        .unwrap_or_else(|failure| {
            panic!(
                "gg pushes a Swift program that does not compile into the transcript: \
                 {failure}\n\n{program}"
            )
        });
}

// ---------------------------------------------------------------------------------------------
// Every workspace operation, driven from a Swift program that reads its answer back
// ---------------------------------------------------------------------------------------------
//
// The [crossing table](crossings) above proves what gg's dispatch *saw*. These prove what a Swift
// program *gets*: the value lifted back out of a successful call, and the `core.ApiError` a refused
// one throws. Between them every `- Throws:` line in `Shell.swift`, `Files.swift`, `Skills.swift`,
// `Memories.swift`, `Tasks.swift` and `Board.swift` is a failure some program below caught, and
// every call that returns something has a program that read it back.
//
// A refusal here is the HOST's, injected through the responder, with three exceptions that are the
// arm's own and are asserted as such — the negative shell timeout the membrane's `clamp_timeout`
// refuses before dispatch, and the two guards `files.readFile` and `files.search` carry because
// their windows are signed `Int`s over a `u32` wire. Each of those cases also asserts that nothing
// reached a tool at all.

/// One program, granted every operation, answered by `responder`.
fn answering(
    body: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_with(
        &format!("import gg\n\n{body}\n"),
        &all_operations(),
        responder,
    )
}

/// [`answering`] with the canned table: the success cases' responder.
fn succeeding(body: &str) -> (SandboxOutcome, CallLog) {
    answering(body, canned_outcome)
}

/// [`answering`] with a responder that refuses **every** call with one failure class — which is all
/// a one-call program needs, and is how each failure below is injected.
fn refusing(body: &str, failure: ToolFailure, message: &str) -> (SandboxOutcome, CallLog) {
    let message = message.to_string();
    answering(body, move |_name: &str, _args: &Value| {
        ToolOutcome::failed(failure, message.clone())
    })
}

/// The program a failure case runs: the one statement, and the `catch` that logs exactly what a
/// model reads off the failure — Swift's own word for the class, and gg's own name for the call.
fn catching(statement: &str) -> String {
    format!(
        "do {{\n    {statement}\n    gg.log(\"the call did not throw\")\n}} catch let failure as \
         core.ApiError {{\n    gg.log(\"\\(failure.code) on \\(failure.operation)\")\n}}"
    )
}

/// [`catching`], with gg's **sentence** logged as well — for the cases whose message is the thing
/// that has to reach the program.
fn catching_message(statement: &str) -> String {
    format!(
        "do {{\n    {statement}\n    gg.log(\"the call did not throw\")\n}} catch let failure as \
         core.ApiError {{\n    gg.log(\"\\(failure.code) on \\(failure.operation): \
         \\(failure.message)\")\n}}"
    )
}

/// Drive one statement into `failure` and assert the program read `expected` back off the
/// `core.ApiError` it caught.
fn assert_refused(statement: &str, failure: ToolFailure, message: &str, expected: &str) {
    let (outcome, _log) = refusing(&catching(statement), failure, message);
    assert_eq!(
        logs(&outcome),
        [expected],
        "what a Swift program reads off `{statement}` when the host refuses it"
    );
}

/// [`assert_refused`], asserting gg's sentence reached the program too.
fn assert_refused_saying(statement: &str, failure: ToolFailure, message: &str, expected: &str) {
    let (outcome, _log) = refusing(&catching_message(statement), failure, message);
    assert_eq!(
        logs(&outcome),
        [expected],
        "what a Swift program reads off `{statement}` when the host refuses it"
    );
}

/// Drive one statement the **SDK** refuses before dispatch and assert both halves: what the program
/// read, and that gg's dispatch saw nothing at all.
fn assert_refused_by_the_sdk(statement: &str, expected: &str) {
    let (outcome, log) = succeeding(&catching(statement));
    assert_eq!(
        logs(&outcome),
        [expected],
        "what a Swift program reads off `{statement}` when the SDK refuses it"
    );
    assert!(
        log.names().is_empty(),
        "a call the SDK refused must never reach gg's dispatch: {:?}",
        log.names()
    );
}

// ---------------------------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------------------------

#[test]
fn a_shell_run_hands_a_swift_program_its_exit_code_and_output() {
    let (outcome, _log) = succeeding(
        r####"
let ran = try shell.run("npm test")
gg.log("\(ran.exitCode ?? -1) \(ran.output) \(ran.truncated)")
"####,
    );
    assert_eq!(logs(&outcome), ["0 ran `npm test` false"]);
}

#[test]
fn a_non_zero_shell_exit_is_a_value_a_swift_program_reads() {
    // The one call in the surface whose failure is a VALUE: the process ran, so the program reads
    // `exitCode` rather than catching anything, and the statement after it runs.
    let (outcome, _log) = succeeding(
        r####"
let ran = try shell.run("npm test -- fail")
gg.log("\(ran.exitCode ?? -1)")
gg.log("carried on")
"####,
    );
    assert_eq!(logs(&outcome), ["1", "carried on"]);
}

#[test]
fn a_shell_timeout_reaches_a_swift_program_as_limit_exceeded() {
    assert_refused(
        r#"try shell.run("sleep 600", timeout: 1)"#,
        ToolFailure::LimitExceeded,
        "`sleep 600` was killed after 1s",
        "limitExceeded on shell",
    );
}

#[test]
fn a_shell_that_could_not_be_launched_is_an_io_error_in_swift() {
    assert_refused(
        r#"try shell.run("npm test")"#,
        ToolFailure::IoError,
        "could not spawn `sh`: No such file or directory",
        "ioError on shell",
    );
}

#[test]
fn a_negative_shell_timeout_is_an_argument_error_in_swift() {
    // Not the SDK's refusal: the membrane's `clamp_timeout` refuses a timeout that names no
    // duration, so the tool is never reached and the canned responder never answers.
    let (outcome, log) = succeeding(&catching(r#"try shell.run("npm test", timeout: -4)"#));
    assert_eq!(logs(&outcome), ["invalidArgument on shell"]);
    assert!(
        log.names().is_empty(),
        "a timeout the membrane refused must never reach a tool: {:?}",
        log.names()
    );
}

// ---------------------------------------------------------------------------------------------
// files
//
// `readFile`'s text success is read back by `the_view_object_the_helper_and_the_standard_ending…`
// and by the shadowing half of the same function, its `notFound` is caught and then let out by
// `a_failure_is_thrown_whether_it_is_caught_or_let_out`, `tree`'s success and its depth guard are
// driven by that same function, and `writeFile` refused because the run withheld it is
// `a_capability_this_run_withheld_is_refused_as_unavailable`.
// ---------------------------------------------------------------------------------------------

#[test]
fn an_image_read_reaches_a_swift_program_as_the_image_case() {
    let (outcome, _log) = succeeding(
        r####"
switch try files.readFile("logo.png") {
case .image(let picture): gg.log("\(picture.label) \(picture.bytes) \(picture.shown)")
case .text: gg.log("the read came back as text")
}
"####,
    );
    // The pixels never enter the program: a bare read hands over gg's DESCRIPTION of the picture,
    // and the closed enum is switched over without a `default`. `shown` is `false` because this
    // path withholds the attachment — `views.openFile` is the call that shows one.
    assert_eq!(logs(&outcome), ["PNG 1234 false"]);
}

#[test]
fn an_empty_path_read_is_an_argument_error_in_swift() {
    assert_refused(
        r#"_ = try files.readFile("")"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty",
        "invalidArgument on read_file",
    );
}

#[test]
fn a_read_offset_below_one_is_refused_before_it_is_dispatched_in_swift() {
    // `offset` is a signed `Int` here — Swift has no unsigned integer a model would write by hand —
    // over a `u32` wire, so `0` lowered instead of refused is a window the host would answer rather
    // than reject. The guard is the SDK's, and the well-formed read beside it still dispatches.
    let (outcome, log) = succeeding(&format!(
        "{}\n_ = try files.readFile(\"notes.md\", offset: 2)\n",
        catching(r#"_ = try files.readFile("notes.md", offset: 0)"#)
    ));
    assert_eq!(logs(&outcome), ["invalidArgument on read_file"]);
    assert_eq!(
        log.names(),
        ["read_file"],
        "only the well-formed offset reached gg's dispatch: {:?}",
        log.names()
    );
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 2, "limit": null }))
    );
}

#[test]
fn a_read_limit_below_one_is_refused_before_it_is_dispatched_in_swift() {
    let (outcome, log) = succeeding(&format!(
        "{}\n{}\n",
        catching(r#"_ = try files.readFile("notes.md", limit: 0)"#),
        catching(r#"_ = try files.readFile("notes.md", limit: -1)"#)
    ));
    assert_eq!(
        logs(&outcome),
        [
            "invalidArgument on read_file",
            "invalidArgument on read_file"
        ]
    );
    assert!(
        log.names().is_empty(),
        "a limit the SDK refused must never reach gg's dispatch: {:?}",
        log.names()
    );
}

#[test]
fn a_write_hands_a_swift_program_the_byte_count() {
    let (outcome, _log) = succeeding(
        r####"
gg.log("\(try files.writeFile("out.txt", contents: "hello"))")
"####,
    );
    assert_eq!(logs(&outcome), ["5"]);
}

#[test]
fn an_empty_path_write_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try files.writeFile("", contents: "hello")"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty",
        "invalidArgument on write_file",
    );
}

#[test]
fn a_write_that_could_not_land_is_an_io_error_in_swift() {
    assert_refused(
        r#"try files.writeFile("out.txt", contents: "hello")"#,
        ToolFailure::IoError,
        "could not create `out.txt`: Permission denied",
        "ioError on write_file",
    );
}

#[test]
fn an_edit_that_succeeded_lets_a_swift_program_carry_on() {
    // `editFile` returns nothing, so what a success means to a Swift author is that the call
    // reached dispatch under its own name and the statement after it ran.
    let (outcome, log) = succeeding(
        r####"
try files.editFile("src/a.swift", replacing: "alpha", with: "beta")
gg.log("carried on")
"####,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(log.names(), ["edit_file"]);
}

#[test]
fn an_edit_whose_old_text_is_absent_is_not_found_in_swift() {
    assert_refused(
        r#"try files.editFile("src/a.swift", replacing: "alpha", with: "beta")"#,
        ToolFailure::NotFound,
        "`alpha` does not appear in `src/a.swift`",
        "notFound on edit_file",
    );
}

#[test]
fn an_edit_whose_old_text_repeats_is_a_conflict_in_swift() {
    // The match COUNT is the recovery — it tells the program how much more context the old text
    // needs — so this asserts gg's sentence reached the program rather than just the class.
    assert_refused_saying(
        r#"try files.editFile("src/a.swift", replacing: "alpha", with: "beta")"#,
        ToolFailure::Conflict,
        "`alpha` appears 3 times in `src/a.swift`; include more context to make it unique",
        "conflict on edit_file: `alpha` appears 3 times in `src/a.swift`; include more context to \
         make it unique",
    );
}

#[test]
fn a_listing_hands_a_swift_program_its_entries_and_their_kinds() {
    let (outcome, _log) = succeeding(
        r####"
for entry in try files.listDir("src") {
    gg.log("\(entry.name) \(entry.kind)")
}
"####,
    );
    assert_eq!(
        logs(&outcome),
        ["a.ts file", "b.test.ts file", "sub directory"]
    );
}

#[test]
fn an_omitted_listing_path_lists_the_root_from_swift() {
    let (outcome, log) = succeeding(
        r####"
gg.log("\(try files.listDir().count)")
"####,
    );
    assert_eq!(logs(&outcome), ["3"]);
    // The default argument is a `nil` `String?`, and what an absent path arrives as is a null
    // rather than a directory the SDK chose on the program's behalf.
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_listing_path_is_an_argument_error_in_swift() {
    assert_refused(
        r#"_ = try files.listDir("")"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty",
        "invalidArgument on list_dir",
    );
}

#[test]
fn a_listing_of_a_directory_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"_ = try files.listDir("nowhere")"#,
        ToolFailure::NotFound,
        "no such directory: nowhere",
        "notFound on list_dir",
    );
}

#[test]
fn a_tree_of_a_path_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"_ = try files.tree(path: "nowhere")"#,
        ToolFailure::NotFound,
        "no such directory: nowhere",
        "notFound on tree",
    );
}

#[test]
fn a_tree_of_something_that_is_not_a_directory_is_an_argument_error_in_swift() {
    assert_refused(
        r#"_ = try files.tree(path: "notes.md")"#,
        ToolFailure::InvalidArgument,
        "`notes.md` is not a directory",
        "invalidArgument on tree",
    );
}

#[test]
fn a_search_hands_a_swift_program_its_matches() {
    let (outcome, _log) = succeeding(
        r####"
for hit in try files.search("answer", path: "src") {
    gg.log("\(hit.path) \(hit.line) \(hit.text)")
}
"####,
    );
    assert_eq!(logs(&outcome), ["src/a.ts 3 const answer = 42;"]);
}

#[test]
fn a_search_that_matched_nothing_is_an_empty_array_in_swift() {
    // Nothing matching is a VALUE, so the program counts rather than catching — which is the half
    // of `- Returns:` a failure case could never show.
    let (outcome, _log) = answering(
        r####"
gg.log("\(try files.search("nothing at all").count)")
"####,
        |_name: &str, _args: &Value| {
            ToolOutcome::ok("no matches", "0 matches").with_data(ApiData::SearchMatches(Vec::new()))
        },
    );
    assert_eq!(logs(&outcome), ["0"]);
}

#[test]
fn a_blank_search_query_is_an_argument_error_in_swift() {
    assert_refused(
        r#"_ = try files.search("   ")"#,
        ToolFailure::InvalidArgument,
        "`query` must not be blank",
        "invalidArgument on search",
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error_in_swift() {
    assert_refused(
        r#"_ = try files.search("fn [a-z")"#,
        ToolFailure::InvalidArgument,
        "`fn [a-z` is not a valid regular expression: unclosed character class",
        "invalidArgument on search",
    );
}

#[test]
fn a_search_limit_of_zero_is_an_argument_error_in_swift() {
    // `limit` is a signed `Int` over a `u32` wire, so the SDK holds the floor rather than lowering
    // `0` into a request gg would have to answer. Same class and same gg name it would have carried
    // had the host raised it, and nothing reached dispatch.
    assert_refused_by_the_sdk(
        r#"_ = try files.search("answer", limit: 0)"#,
        "invalidArgument on search",
    );
}

#[test]
fn a_negative_search_limit_is_refused_before_it_is_dispatched_in_swift() {
    assert_refused_by_the_sdk(
        r#"_ = try files.search("answer", limit: -4)"#,
        "invalidArgument on search",
    );
}

#[test]
fn a_search_of_a_path_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"_ = try files.search("answer", path: "nowhere")"#,
        ToolFailure::NotFound,
        "no such path: nowhere",
        "notFound on search",
    );
}

// ---------------------------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_a_swift_program_the_skill_body() {
    let (outcome, _log) = succeeding(
        r####"
gg.log(try skills.readSkill("testing"))
"####,
    );
    assert_eq!(logs(&outcome), ["the skill body"]);
}

#[test]
fn an_unknown_skill_is_not_found_in_swift() {
    // The catalogue rides in the MESSAGE — the recovery is to name a skill that does exist — so the
    // assertion is on the sentence a Swift program reads, not just on the class.
    assert_refused_saying(
        r#"_ = try skills.readSkill("nope")"#,
        ToolFailure::NotFound,
        "read_skill: no skill named `nope`; available skills: testing",
        "notFound on read_skill: read_skill: no skill named `nope`; available skills: testing",
    );
}

// ---------------------------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------------------------

/// The three budget fields every memory call hands back, logged the same way in each case below.
const MEMORY_BUDGET: &str =
    r#"gg.log("\(usage.count) \(usage.maxCount ?? -1) \(usage.totalChars)")"#;

#[test]
fn a_memory_write_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try memories.writeMemory(\"layout\", description: \"d\", body: \"b\")\n\
         {MEMORY_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn a_duplicate_memory_name_is_a_conflict_in_swift() {
    assert_refused(
        r#"try memories.writeMemory("layout", description: "d", body: "b")"#,
        ToolFailure::Conflict,
        "a memory named `layout` already exists",
        "conflict on write_memory",
    );
}

#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded_in_swift() {
    assert_refused(
        r#"try memories.writeMemory("layout", description: "d", body: "b")"#,
        ToolFailure::LimitExceeded,
        "the memories would total 5000 characters (max 4000)",
        "limitExceeded on write_memory",
    );
}

#[test]
fn a_memory_update_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try memories.updateMemory(\"layout\", description: \"d2\", body: \"b2\")\n\
         {MEMORY_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn an_update_of_a_memory_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try memories.updateMemory("layout", description: "d", body: "b")"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
        "notFound on update_memory",
    );
}

#[test]
fn a_memory_creation_hands_a_swift_program_its_budget() {
    let (outcome, log) = succeeding(&format!(
        "let usage = try memories.createMemory(\"layout\", description: \"d\", body: \"b\")\n\
         {MEMORY_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["1 8 12"]);
    // The crossing's point, kept beside the value it hands back: a Swift author writes `body:` on
    // all three writes, and this one alone lowers onto gg's `contents`.
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_duplicate_memory_slug_is_a_conflict_in_swift() {
    assert_refused(
        r#"try memories.createMemory("layout", description: "d", body: "b")"#,
        ToolFailure::Conflict,
        "a memory named `layout` already exists",
        "conflict on create_memory",
    );
}

#[test]
fn memory_contents_over_the_cap_are_limit_exceeded_in_swift() {
    assert_refused(
        r#"try memories.createMemory("layout", description: "d", body: "b")"#,
        ToolFailure::LimitExceeded,
        "the memory index would total 900 characters (max 800)",
        "limitExceeded on create_memory",
    );
}

#[test]
fn a_memory_read_hands_a_swift_program_its_contents() {
    let (outcome, _log) = succeeding(
        r####"
gg.log(try memories.readMemory("cargo"))
"####,
    );
    assert_eq!(logs(&outcome), ["the memory contents"]);
}

#[test]
fn a_read_of_a_memory_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"_ = try memories.readMemory("cargo")"#,
        ToolFailure::NotFound,
        "no memory named `cargo`",
        "notFound on read_memory",
    );
}

#[test]
fn a_memory_edit_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try memories.editMemory(\"layout\", replacing: \"old\", with: \"new\")\n\
         {MEMORY_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn an_edit_whose_text_is_absent_from_a_memory_is_not_found_in_swift() {
    assert_refused(
        r#"try memories.editMemory("layout", replacing: "old", with: "new")"#,
        ToolFailure::NotFound,
        "`old` does not appear in `layout`",
        "notFound on edit_memory",
    );
}

#[test]
fn an_edit_whose_text_repeats_in_a_memory_is_a_conflict_in_swift() {
    assert_refused(
        r#"try memories.editMemory("layout", replacing: "old", with: "new")"#,
        ToolFailure::Conflict,
        "`old` appears 2 times in `layout`",
        "conflict on edit_memory",
    );
}

#[test]
fn an_edit_that_would_overrun_a_memory_is_limit_exceeded_in_swift() {
    assert_refused(
        r#"try memories.editMemory("layout", replacing: "old", with: "new")"#,
        ToolFailure::LimitExceeded,
        "the memories would total 5000 characters (max 4000)",
        "limitExceeded on edit_memory",
    );
}

#[test]
fn an_edit_that_would_empty_a_memory_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try memories.editMemory("layout", replacing: "old", with: "")"#,
        ToolFailure::InvalidArgument,
        "the edit would leave `layout` empty; delete it instead",
        "invalidArgument on edit_memory",
    );
}

#[test]
fn a_memory_hit_hands_a_swift_program_its_ranking() {
    // The five fields a hit is ranked by, and then the one member function on a returned value in
    // this module: `read()` is an ALIAS of `memories.readMemory`, so it must reach gg's dispatch
    // under that name carrying the slug the hit was ranked under rather than one the program
    // copied out by hand.
    let (outcome, log) = succeeding(
        r####"
let hits = try memories.searchMemories(["cargo", "nextest"])
gg.log("\(hits[0].name) \(hits[0].description) \(hits[0].matched) \(hits[0].occurrences) \(hits[0].excerpt)")
gg.log(try hits[0].read())
"####,
    );
    assert_eq!(
        logs(&outcome),
        [
            "build-commands How to build 2 3 …cargo nextest run --workspace…",
            "the memory contents"
        ]
    );
    assert_eq!(log.names(), ["search_memories", "read_memory"]);
    assert_eq!(
        log.args("read_memory"),
        Some(json!({ "name": "build-commands" }))
    );
}

#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_array_in_swift() {
    let (outcome, _log) = answering(
        r####"
gg.log("\(try memories.searchMemories(["nothing"]).count)")
"####,
        |_name: &str, _args: &Value| {
            ToolOutcome::ok("0 of 2 memories match", "searched memories")
                .with_data(ApiData::MemoryHits(Vec::new()))
        },
    );
    assert_eq!(logs(&outcome), ["0"]);
}

#[test]
fn a_memory_search_of_empty_keywords_is_an_argument_error_in_swift() {
    assert_refused(
        r#"_ = try memories.searchMemories([""])"#,
        ToolFailure::InvalidArgument,
        "`keywords` must carry at least one non-empty word",
        "invalidArgument on search_memories",
    );
}

#[test]
fn a_hit_whose_memory_has_since_gone_is_not_found_in_swift() {
    let (outcome, _log) = answering(
        &format!(
            "let hits = try memories.searchMemories([\"cargo\"])\n{}",
            catching("gg.log(try hits[0].read())")
        ),
        |name: &str, args: &Value| match name {
            "read_memory" => ToolOutcome::failed(
                ToolFailure::NotFound,
                "no memory named `build-commands`".to_string(),
            ),
            other => canned_outcome(other, args),
        },
    );
    assert_eq!(logs(&outcome), ["notFound on read_memory"]);
}

#[test]
fn a_memory_deletion_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try memories.deleteMemory(\"layout\")\n{MEMORY_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn a_deletion_of_a_memory_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try memories.deleteMemory("layout")"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
        "notFound on delete_memory",
    );
}

// ---------------------------------------------------------------------------------------------
// tasks
//
// `updateTask`, `setBlockedBy` and `completeTask` return nothing, and their successful calls are
// pinned by the crossing rows above — so what a success means to a Swift author there is what the
// crossing table already asserts.
// ---------------------------------------------------------------------------------------------

/// The two budget fields every task call hands back.
const TASK_BUDGET: &str = r#"gg.log("\(usage.count) \(usage.maxTasks)")"#;

#[test]
fn adding_a_task_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try tasks.addTask(\"t1\", title: \"T\")\n{TASK_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["2 20"]);
}

#[test]
fn a_duplicate_task_id_is_a_conflict_in_swift() {
    assert_refused(
        r#"try tasks.addTask("t1", title: "T")"#,
        ToolFailure::Conflict,
        "add_task: a task `t1` already exists",
        "conflict on add_task",
    );
}

#[test]
fn a_task_edge_that_would_close_a_cycle_is_a_conflict_in_swift() {
    assert_refused(
        r#"try tasks.addTask("t1", title: "T", blockedBy: ["t2"])"#,
        ToolFailure::Conflict,
        "`t1` blocked by `t2` would close a cycle",
        "conflict on add_task",
    );
}

#[test]
fn a_task_blocker_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try tasks.addTask("t1", title: "T", blockedBy: ["t0"])"#,
        ToolFailure::NotFound,
        "no task with id `t0`",
        "notFound on add_task",
    );
}

#[test]
fn a_task_list_at_its_cap_is_limit_exceeded_in_swift() {
    assert_refused(
        r#"try tasks.addTask("t1", title: "T")"#,
        ToolFailure::LimitExceeded,
        "the task list is at its cap of 20",
        "limitExceeded on add_task",
    );
}

#[test]
fn an_update_of_a_task_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try tasks.updateTask("t1", title: "T2")"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "notFound on update_task",
    );
}

#[test]
fn an_update_that_named_nothing_to_change_is_an_argument_error_in_swift() {
    // Every edit left at its default — `description` at `.keep`, which is what LEAVES it alone —
    // so the patch names nothing, and the refusal is gg's rather than a compile error.
    assert_refused(
        r#"try tasks.updateTask("t1")"#,
        ToolFailure::InvalidArgument,
        "update_task: nothing to change; name a title, a description or a status",
        "invalidArgument on update_task",
    );
}

#[test]
fn re_blocking_a_task_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try tasks.setBlockedBy("t1", to: ["t0"])"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "notFound on set_blocked_by",
    );
}

#[test]
fn a_blocker_set_that_would_close_a_cycle_is_a_conflict_in_swift() {
    assert_refused(
        r#"try tasks.setBlockedBy("t1", to: ["t2"])"#,
        ToolFailure::Conflict,
        "`t1` blocked by `t2` would close a cycle",
        "conflict on set_blocked_by",
    );
}

#[test]
fn completing_a_task_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try tasks.completeTask("t1")"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "notFound on complete_task",
    );
}

#[test]
fn removing_a_task_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try tasks.removeTask(\"t1\")\n{TASK_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["2 20"]);
}

#[test]
fn removing_a_task_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try tasks.removeTask("t1")"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "notFound on remove_task",
    );
}

// ---------------------------------------------------------------------------------------------
// board
//
// `updateIssue` and `setIssueBlockedBy` return nothing, and their successful calls are pinned by
// the crossing rows above.
// ---------------------------------------------------------------------------------------------

/// The four board-budget fields every board call hands back.
const BOARD_BUDGET: &str =
    r#"gg.log("\(usage.epics) \(usage.maxEpics) \(usage.issues) \(usage.maxIssues)")"#;

/// The one issue every board case below files, written out once.
const AN_ISSUE: &str =
    r#"title: "I", inScope: "s", outOfScope: "o", completionCriteria: "c", agent: "worker""#;

#[test]
fn creating_an_epic_hands_a_swift_program_its_id_and_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let made = try board.createEpic(prefix: \"EPC\", title: \"E\", description: \"D\")\n\
         gg.log(made.id)\nlet usage = made.board\n{BOARD_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["EPIC", "1 4 3 20"]);
}

#[test]
fn an_epic_prefix_that_is_not_three_to_six_letters_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try board.createEpic(prefix: "ep1", title: "E", description: "D")"#,
        ToolFailure::InvalidArgument,
        "`prefix` must be 3-6 letters (`ep1` given)",
        "invalidArgument on create_epic",
    );
}

#[test]
fn an_epic_prefix_another_epic_holds_is_a_conflict_in_swift() {
    assert_refused(
        r#"try board.createEpic(prefix: "epc", title: "E", description: "D")"#,
        ToolFailure::Conflict,
        "an epic with id `EPC` already exists",
        "conflict on create_epic",
    );
}

#[test]
fn a_board_at_its_epic_cap_is_limit_exceeded_in_swift() {
    assert_refused(
        r#"try board.createEpic(prefix: "epc", title: "E", description: "D")"#,
        ToolFailure::LimitExceeded,
        "the board is at its cap of 4 epics",
        "limitExceeded on create_epic",
    );
}

#[test]
fn creating_an_issue_hands_a_swift_program_its_id_and_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let filed = try board.createIssue({AN_ISSUE})\n\
         gg.log(filed.id)\nlet usage = filed.board\n{BOARD_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["EPIC-1", "1 4 3 20"]);
}

#[test]
fn an_issue_agent_this_run_does_not_permit_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try board.createIssue(title: "I", inScope: "s", outOfScope: "o", completionCriteria: "c", agent: "nobody")"#,
        ToolFailure::InvalidArgument,
        "`nobody` is not an agent this run declares",
        "invalidArgument on create_issue",
    );
}

#[test]
fn an_issue_reviewer_this_run_does_not_permit_is_an_argument_error_in_swift() {
    assert_refused(
        &format!(r#"try board.createIssue({AN_ISSUE}, reviewers: ["nobody"])"#),
        ToolFailure::InvalidArgument,
        "`nobody` is not an agent this run declares",
        "invalidArgument on create_issue",
    );
}

#[test]
fn an_issue_epic_or_blocker_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        &format!(r#"try board.createIssue({AN_ISSUE}, blockedBy: ["EPIC-9"], epic: "GONE")"#),
        ToolFailure::NotFound,
        "no epic with id `GONE`",
        "notFound on create_issue",
    );
}

#[test]
fn an_issue_blocker_that_would_close_a_cycle_is_a_conflict_in_swift() {
    assert_refused(
        &format!(r#"try board.createIssue({AN_ISSUE}, blockedBy: ["EPIC-1"])"#),
        ToolFailure::Conflict,
        "`EPIC-2` blocked by `EPIC-1` would close a cycle",
        "conflict on create_issue",
    );
}

#[test]
fn an_update_of_an_issue_or_epic_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try board.updateIssue("i1", title: "T2", epic: .set("GONE"))"#,
        ToolFailure::NotFound,
        "no issue with id `i1`",
        "notFound on update_issue",
    );
}

#[test]
fn an_issue_update_that_named_nothing_to_change_is_an_argument_error_in_swift() {
    // Every edit at its default, `description` at `.keep` and `epic` at `.keep`, so the patch
    // names nothing at all.
    assert_refused(
        r#"try board.updateIssue("i1")"#,
        ToolFailure::InvalidArgument,
        "update_issue: nothing to change; name a field to revise",
        "invalidArgument on update_issue",
    );
}

#[test]
fn re_blocking_an_issue_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try board.setIssueBlockedBy("i1", to: ["i0"])"#,
        ToolFailure::NotFound,
        "no issue with id `i1`",
        "notFound on set_issue_blocked_by",
    );
}

#[test]
fn an_issue_edge_that_would_close_a_cycle_is_a_conflict_in_swift() {
    assert_refused(
        r#"try board.setIssueBlockedBy("i1", to: ["i2"])"#,
        ToolFailure::Conflict,
        "`i1` blocked by `i2` would close a cycle",
        "conflict on set_issue_blocked_by",
    );
}

#[test]
fn removing_an_epic_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try board.removeEpic(\"EPC\")\n{BOARD_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
}

#[test]
fn removing_an_epic_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try board.removeEpic("EPC")"#,
        ToolFailure::NotFound,
        "no epic with id `EPC`",
        "notFound on remove_epic",
    );
}

#[test]
fn removing_an_issue_hands_a_swift_program_its_budget() {
    let (outcome, _log) = succeeding(&format!(
        "let usage = try board.removeIssue(\"i1\")\n{BOARD_BUDGET}"
    ));
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
}

#[test]
fn removing_an_issue_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try board.removeIssue("i1")"#,
        ToolFailure::NotFound,
        "no issue with id `i1`",
        "notFound on remove_issue",
    );
}

#[test]
fn a_wait_is_registered_and_a_swift_program_runs_on() {
    // A wait does not block inside the program: the whole of what deferred registration means to a
    // Swift author is that the acknowledgement comes back and the next statement runs. Reached
    // twice — by id, and through the member function on what `createIssue` handed back, which is
    // the only way a program can wait on what it just filed without copying the board's id out by
    // hand.
    let (outcome, log) = succeeding(&format!(
        "gg.log(try board.waitForIssue(\"ISSUE-1\"))\n\
         gg.log(\"carried on\")\n\
         let filed = try board.createIssue({AN_ISSUE})\n\
         gg.log(try filed.wait())"
    ));
    assert_eq!(
        logs(&outcome),
        ["wait registered", "carried on", "wait registered"]
    );
    assert_eq!(
        log.names(),
        ["wait_for_issue", "create_issue", "wait_for_issue"]
    );
    assert_eq!(
        log.calls()
            .into_iter()
            .filter(|call| call.name == "wait_for_issue")
            .map(|call| call.args)
            .collect::<Vec<_>>(),
        [
            json!({ "issueId": "ISSUE-1" }),
            json!({ "issueId": "EPIC-1" })
        ]
    );
}

#[test]
fn waiting_on_an_issue_that_is_not_there_is_not_found_in_swift() {
    assert_refused(
        r#"try board.waitForIssue("ISSUE-1")"#,
        ToolFailure::NotFound,
        "no issue with id `ISSUE-1`",
        "notFound on wait_for_issue",
    );
}

#[test]
fn waiting_on_this_sessions_own_issue_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try board.waitForIssue("ISSUE-1")"#,
        ToolFailure::InvalidArgument,
        "`ISSUE-1` is the issue this session was assigned; it cannot wait on itself",
        "invalidArgument on wait_for_issue",
    );
}

// ---------------------------------------------------------------------------------------------
// Every session-side operation, driven from a Swift program that reads its answer back
// ---------------------------------------------------------------------------------------------
//
// The same promise as the workspace half above, for `Context.swift`, `Delegation.swift`,
// `Programs.swift`, `Docs.swift`, `Views.swift` and `Session.swift`. Half of these dispatch a gg
// tool and are failed through a responder exactly as the workspace calls are; the other half are
// answered inside the double — the documentation runtime, the window, the program library and the
// ending — so their failures come from the rules the double and the membrane really hold, reached
// through the argument the program passes, the scope the evaluation grants, or a double the case
// built and hands to [`evaluate_with_api`].

/// One program, granted `operations` in `ending` with `library`, answered by `responder`.
fn answering_as(
    body: &str,
    operations: &[OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(&format!("import gg\n\n{body}\n")),
        operations,
        ending,
        library,
        responder,
    )
}

/// One program run against a double the case **already built**, granted every operation.
fn over(body: &str, api: FakeOperationApi) -> SandboxOutcome {
    over_as(body, &all_operations(), RunEnding::None, false, api)
}

/// [`over`] with the grant, the ending group and the library flag said out loud.
fn over_as(
    body: &str,
    operations: &[OperationId],
    ending: RunEnding,
    library: bool,
    api: FakeOperationApi,
) -> SandboxOutcome {
    evaluate_with_api(
        &prepare(&format!("import gg\n\n{body}\n")),
        operations,
        ending,
        library,
        api,
    )
}

/// A responder answering **every** call with one sidecar — the shapes [`canned_outcome`]'s single row
/// per tool cannot carry.
fn sidecar(data: ApiData) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |_name: &str, _args: &Value| ToolOutcome::ok("", "answered").with_data(data.clone())
}

/// A responder answering the first call with the canned table and every later one with `failure` —
/// how a slot that one call per turn may take is driven into its refusal.
fn once_then(
    failure: ToolFailure,
    message: &str,
) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    let message = message.to_string();
    let mut taken = false;
    move |name: &str, args: &Value| {
        if taken {
            ToolOutcome::failed(failure, message.clone())
        } else {
            taken = true;
            canned_outcome(name, args)
        }
    }
}

/// The logged names of every refusal the turn recorded.
fn refused_names(outcome: &SandboxOutcome) -> Vec<&str> {
    outcome
        .refusals
        .iter()
        .map(|refusal| refusal.name.as_str())
        .collect()
}

// ---------------------------------------------------------------------------------------------
// context
//
// A span that ends before it starts is unreachable from a well-typed Swift call: `archiveThread`
// takes `ClosedRange`s, and the language refuses an inverted pair before any program runs.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_file_view_eviction_hands_a_swift_program_its_reclaim_report() {
    let (outcome, log) = succeeding(
        r####"
let freed = try context.evictFileView("src/a.swift")
gg.log("\(freed.items) \(freed.reclaimedTokens) \(freed.paths) \(freed.detail)")
"####,
    );
    assert_eq!(logs(&outcome), [r#"2 300 ["src/a.ts"] dropped 2 items"#]);
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.swift" }))
    );
}

#[test]
fn evicting_every_file_view_sends_no_path_from_swift() {
    let (outcome, log) = succeeding(
        r####"
gg.log("\(try context.evictFileView().items)")
"####,
    );
    assert_eq!(logs(&outcome), ["2"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_eviction_path_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try context.evictFileView("")"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty; leave it out to drop every file view",
        "invalidArgument on evict_file_view",
    );
}

#[test]
fn an_archive_hands_a_swift_program_its_reclaim_report() {
    let (outcome, log) = answering(
        r####"
let freed = try context.archiveThread([4...19, 30...35])
gg.log("\(freed.items) \(freed.reclaimedTokens) \(freed.paths.count) \(freed.detail)")
"####,
        sidecar(ApiData::Reclaim(ReclaimData {
            items: 22,
            reclaimed_tokens: 9_400,
            paths: Vec::new(),
            detail: "archived turns 4-19 and 30-35".to_string(),
        })),
    );
    assert_eq!(logs(&outcome), ["22 9400 0 archived turns 4-19 and 30-35"]);
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19], [30, 35]] }))
    );
}

#[test]
fn an_empty_archive_span_list_is_an_argument_error_in_swift() {
    assert_refused(
        "try context.archiveThread([])",
        ToolFailure::InvalidArgument,
        "`ranges` must name at least one span",
        "invalidArgument on archive_thread",
    );
}

#[test]
fn too_many_archive_spans_at_once_is_an_argument_error_in_swift() {
    let (outcome, log) = refusing(
        &catching("try context.archiveThread((0..<40).map { ($0 * 10)...($0 * 10 + 5) })"),
        ToolFailure::InvalidArgument,
        "at most 32 spans may be archived at once (40 given)",
    );
    assert_eq!(logs(&outcome), ["invalidArgument on archive_thread"]);
    assert_eq!(
        log.args("archive_thread")
            .expect("the call reached dispatch")["ranges"]
            .as_array()
            .map(Vec::len),
        Some(40)
    );
}

#[test]
fn an_archive_search_hands_a_swift_program_its_hits() {
    let (outcome, log) = succeeding(
        r####"
let found = try context.searchArchive("the parser")
let hit = found.hits[0]
gg.log("\(found.archiveEmpty) \(hit.seq) \(hit.role) \(hit.text)")
"####,
    );
    assert_eq!(logs(&outcome), ["false 3 assistant the earlier answer"]);
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the parser" }))
    );
}

#[test]
fn an_empty_archive_reads_as_empty_rather_than_as_no_match_in_swift() {
    let (outcome, _log) = answering(
        r####"
let found = try context.searchArchive("the parser")
gg.log("\(found.archiveEmpty) \(found.hits.count)")
"####,
        sidecar(ApiData::ArchiveSearch(ArchiveSearchData {
            archive_empty: true,
            hits: Vec::new(),
        })),
    );
    assert_eq!(logs(&outcome), ["true 0"]);
}

#[test]
fn every_archived_message_role_reaches_a_swift_program() {
    let hit = |seq: u32, role: Role| ArchiveHitData {
        seq,
        role,
        text: format!("message {seq}"),
    };
    let (outcome, _log) = answering(
        r####"
for hit in try context.searchArchive("message").hits {
    switch hit.role {
    case .system: gg.log("\(hit.seq) system")
    case .user: gg.log("\(hit.seq) user")
    case .assistant: gg.log("\(hit.seq) assistant")
    case .tool: gg.log("\(hit.seq) tool")
    }
}
"####,
        sidecar(ApiData::ArchiveSearch(ArchiveSearchData {
            archive_empty: false,
            hits: vec![
                hit(1, Role::System),
                hit(2, Role::User),
                hit(3, Role::Assistant),
                hit(4, Role::Tool),
            ],
        })),
    );
    assert_eq!(
        logs(&outcome),
        ["1 system", "2 user", "3 assistant", "4 tool"]
    );
}

#[test]
fn an_empty_archive_query_is_an_argument_error_in_swift() {
    assert_refused(
        r#"_ = try context.searchArchive("")"#,
        ToolFailure::InvalidArgument,
        "`query` must not be empty",
        "invalidArgument on search_archive",
    );
}

#[test]
fn a_compaction_is_registered_and_a_swift_program_runs_on() {
    let (outcome, log) = succeeding(
        r####"
try context.compact(summary: "scaffolded the page", files: ["src/main.swift"])
gg.log("ran on")
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(log.names(), ["compact"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "scaffolded the page", "files": ["src/main.swift"] }))
    );
}

#[test]
fn a_blank_compaction_summary_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try context.compact(summary: "   ")"#,
        ToolFailure::InvalidArgument,
        "`summary` must not be blank",
        "invalidArgument on compact",
    );
}

// ---------------------------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------------------------

#[test]
fn spawning_a_child_hands_a_swift_program_its_handle() {
    let (outcome, log) = succeeding(
        r####"
let child = try delegation.spawnSubagent("subagent", task: .prompt("write the lexer"))
gg.log("\(child.id) \(child.slot) \(child.modelId)")
"####,
    );
    assert_eq!(logs(&outcome), ["agent-1 primary test/model"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }))
    );
}

#[test]
fn an_issue_brief_crosses_from_a_swift_program() {
    let (outcome, log) = succeeding(
        r####"
gg.log(try delegation.spawnSubagent("subagent", task: .issue("i1")).id)
"####,
    );
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": null, "issueId": "i1" }))
    );
}

#[test]
fn a_child_beyond_the_delegation_depth_cap_is_limit_exceeded_in_swift() {
    assert_refused(
        r#"try delegation.spawnSubagent("subagent", task: .prompt("write the lexer"))"#,
        ToolFailure::LimitExceeded,
        "this run's delegation depth cap of 2 is already reached",
        "limitExceeded on spawn_subagent",
    );
}

#[test]
fn an_agent_this_session_may_not_spawn_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try delegation.spawnSubagent("nope", task: .prompt("write the lexer"))"#,
        ToolFailure::InvalidArgument,
        "this run may not spawn `nope`; agents it may spawn: subagent",
        "invalidArgument on spawn_subagent",
    );
}

#[test]
fn waiting_on_a_named_child_hands_a_swift_program_its_result() {
    let (outcome, log) = succeeding(
        r####"
let first = try delegation.waitForSubagents(["agent-1"])[0]
gg.log("\(first.id) \(first.status.map { "\($0)" } ?? "nil") \(first.summary)")
"####,
    );
    assert_eq!(logs(&outcome), ["agent-1 completed did the work"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

#[test]
fn waiting_for_every_child_sends_no_ids_from_swift() {
    let (outcome, log) = succeeding(
        r####"
gg.log("\(try delegation.waitForSubagents().count)")
"####,
    );
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

#[test]
fn a_child_with_no_ending_reports_no_status_in_swift() {
    let (outcome, _log) = answering(
        r####"
let first = try delegation.waitForSubagents()[0]
if let status = first.status {
    gg.log("\(first.id) \(status)")
} else {
    gg.log("\(first.id) nil \(first.summary)")
}
"####,
        sidecar(ApiData::SubagentResults(vec![SubagentResultData {
            id: "agent-9".to_string(),
            status: None,
            summary: "it said this much".to_string(),
        }])),
    );
    assert_eq!(logs(&outcome), ["agent-9 nil it said this much"]);
}

#[test]
fn every_agent_status_reaches_a_swift_program() {
    let result = |id: &str, status: AgentStatusData| SubagentResultData {
        id: id.to_string(),
        status: Some(status),
        summary: String::new(),
    };
    let (outcome, _log) = answering(
        r####"
for result in try delegation.waitForSubagents() {
    switch result.status {
    case .completed?: gg.log("\(result.id) completed")
    case .exhausted?: gg.log("\(result.id) exhausted")
    case .timedOut?: gg.log("\(result.id) timedOut")
    case .modelError?: gg.log("\(result.id) modelError")
    case .authError?: gg.log("\(result.id) authError")
    case .limitExceeded?: gg.log("\(result.id) limitExceeded")
    case nil: gg.log("\(result.id) nil")
    }
}
"####,
        sidecar(ApiData::SubagentResults(vec![
            result("a1", AgentStatusData::Completed),
            result("a2", AgentStatusData::Exhausted),
            result("a3", AgentStatusData::TimedOut),
            result("a4", AgentStatusData::ModelError),
            result("a5", AgentStatusData::AuthError),
            result("a6", AgentStatusData::LimitExceeded),
        ])),
    );
    assert_eq!(
        logs(&outcome),
        [
            "a1 completed",
            "a2 exhausted",
            "a3 timedOut",
            "a4 modelError",
            "a5 authError",
            "a6 limitExceeded"
        ]
    );
}

#[test]
fn waiting_on_a_child_this_session_did_not_spawn_is_not_found_in_swift() {
    assert_refused(
        r#"_ = try delegation.waitForSubagents(["agent-9"])"#,
        ToolFailure::NotFound,
        "no child agent `agent-9`",
        "notFound on wait_for_subagents",
    );
}

#[test]
fn a_message_reaches_a_running_child_from_swift() {
    let (outcome, log) = succeeding(
        r####"
try delegation.sendMessage("prefer the simpler parser", to: "agent-1")
gg.log("ran on")
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(log.names(), ["send_message"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn a_handle_delivers_its_own_message_in_swift() {
    let (outcome, log) = succeeding(
        r####"
let child = try delegation.spawnSubagent("subagent", task: .prompt("write the lexer"))
try child.send("prefer the simpler parser")
gg.log("ran on")
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(log.names(), ["spawn_subagent", "send_message"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn a_message_to_an_unknown_agent_is_not_found_in_swift() {
    assert_refused(
        r#"try delegation.sendMessage("prefer the simpler parser", to: "agent-9")"#,
        ToolFailure::NotFound,
        "no agent `agent-9`",
        "notFound on send_message",
    );
}

#[test]
fn a_message_to_a_child_that_already_returned_is_a_conflict_in_swift() {
    assert_refused(
        r#"try delegation.sendMessage("prefer the simpler parser", to: "agent-1")"#,
        ToolFailure::Conflict,
        "`agent-1` has already returned",
        "conflict on send_message",
    );
}

#[test]
fn a_state_transition_is_registered_and_a_swift_program_runs_on() {
    let (outcome, log) = succeeding(
        r####"
try delegation.transitionState(to: "verify", note: "the build is green")
gg.log("ran on")
gg.log("and on")
"####,
    );
    assert_eq!(logs(&outcome), ["ran on", "and on"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "verify", "note": "the build is green" }))
    );
}

#[test]
fn a_state_this_session_may_not_move_to_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try delegation.transitionState(to: "nowhere")"#,
        ToolFailure::InvalidArgument,
        "`verify` is the only state this one has an edge to",
        "invalidArgument on transition_state",
    );
}

#[test]
fn a_second_state_declaration_in_one_turn_is_refused_in_swift() {
    let (outcome, log) = answering(
        &format!(
            "try delegation.transitionState(to: \"verify\")\n{}\ngg.log(\"ran on\")",
            catching(r#"try delegation.transitionState(to: "ship")"#)
        ),
        once_then(
            ToolFailure::Refused,
            "this session already declared a transition this turn",
        ),
    );
    assert_eq!(logs(&outcome), ["refused on transition_state", "ran on"]);
    assert_eq!(log.names(), ["transition_state", "transition_state"]);
}

#[test]
fn a_transition_outside_a_machine_state_is_unavailable_in_swift() {
    let operations: Vec<OperationId> = all_operations()
        .into_iter()
        .filter(|operation| *operation != DELEGATION_TRANSITION_STATE)
        .collect();
    let (outcome, log) = answering_as(
        &catching(r#"try delegation.transitionState(to: "verify")"#),
        &operations,
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on transition_state"]);
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert_eq!(refused_names(&outcome), ["delegation.transition_state"]);
}

#[test]
fn a_succession_is_registered_and_a_swift_program_runs_to_its_end() {
    let (outcome, log) = succeeding(
        r####"
try delegation.exec("Builder", prompt: "pick it up from here")
gg.log("ran on")
gg.log("to the end")
"####,
    );
    assert_eq!(logs(&outcome), ["ran on", "to the end"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": "pick it up from here" }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_an_argument_error_in_swift() {
    assert_refused(
        r#"try delegation.exec("nope")"#,
        ToolFailure::InvalidArgument,
        "this run may not become `nope`; agents it may become: Builder",
        "invalidArgument on exec",
    );
}

#[test]
fn a_succession_after_a_transition_is_refused_in_swift() {
    let (outcome, log) = answering(
        &format!(
            "try delegation.transitionState(to: \"verify\")\n{}\ngg.log(\"ran on\")",
            catching(r#"try delegation.exec("Builder")"#)
        ),
        once_then(
            ToolFailure::Refused,
            "this session already declared a successor this turn",
        ),
    );
    assert_eq!(logs(&outcome), ["refused on exec", "ran on"]);
    assert_eq!(log.names(), ["transition_state", "exec"]);
}

#[test]
fn a_fork_hands_a_swift_program_the_copys_id() {
    let (outcome, log) = succeeding(
        r####"
let copy = try delegation.fork("try the other fix")
gg.log(copy.id)
gg.log("ran on")
"####,
    );
    assert_eq!(logs(&outcome), ["agent-2", "ran on"]);
    assert_eq!(
        log.args("fork"),
        Some(json!({ "prompt": "try the other fix" }))
    );
}

#[test]
fn a_fork_beyond_the_delegation_depth_cap_is_limit_exceeded_in_swift() {
    assert_refused(
        r#"try delegation.fork("try the other fix")"#,
        ToolFailure::LimitExceeded,
        "this run's delegation depth cap of 2 is already reached",
        "limitExceeded on fork",
    );
}

// ---------------------------------------------------------------------------------------------
// programs
//
// `history` on an empty library, `get`'s `.notFound` and `rerun`'s recorded hand-over are read back
// by `the_program_library_and_a_reviewers_verdict_are_reached_in_swift_too`.
// ---------------------------------------------------------------------------------------------

/// The source the library cases seed the double with.
const SEEDED_PROGRAM: &str = "import gg\n\ngg.log(\"one\")\n";

/// A double holding one program the library issued an id for, answering everything else as usual.
fn holding_a_program() -> FakeOperationApi {
    FakeOperationApi::new(&CallLog::default()).with_program("k3p9", 3, SEEDED_PROGRAM)
}

/// [`over_as`] with the library kept and nothing else granted — the scope every case below runs in.
fn over_the_library(body: &str, api: FakeOperationApi) -> SandboxOutcome {
    over_as(body, &[], RunEnding::None, true, api)
}

#[test]
fn a_program_summary_hands_a_swift_program_every_field() {
    let outcome = over_the_library(
        r####"
let first = try programs.history()[0]
gg.log("\(first.id) \(first.turn) \(first.lines) \(first.chars) \(first.ok) \(first.error ?? "none")")
"####,
        holding_a_program(),
    );
    assert_eq!(
        logs(&outcome),
        [format!("k3p9 3 3 {} true none", SEEDED_PROGRAM.len())]
    );
}

#[test]
fn fetching_a_stored_program_hands_a_swift_program_its_source() {
    let outcome = over_the_library(r#"gg.log(try programs.get("k3p9"))"#, holding_a_program());
    assert_eq!(logs(&outcome), [SEEDED_PROGRAM]);
}

#[test]
fn a_summary_fetches_its_own_source_in_swift() {
    let outcome = over_the_library(
        "gg.log(try programs.history()[0].source())",
        holding_a_program(),
    );
    assert_eq!(logs(&outcome), [SEEDED_PROGRAM]);
}

#[test]
fn a_program_the_library_dropped_is_not_found_in_swift() {
    let outcome = over_the_library(
        &format!(
            "let first = try programs.history()[0]\n{}",
            catching_message("gg.log(try first.source())")
        ),
        holding_a_program().refusing(
            PROGRAMS_GET,
            ToolFailure::NotFound,
            "no program is kept under the id `k3p9`; no program has been kept yet",
        ),
    );
    assert_eq!(
        logs(&outcome),
        ["notFound on get: no program is kept under the id `k3p9`; no program has been kept yet"]
    );
}

#[test]
fn an_unknown_program_id_names_what_the_library_holds_in_swift() {
    let outcome = over_the_library(
        &catching_message(r#"gg.log(try programs.get("zzzz"))"#),
        holding_a_program(),
    );
    assert_eq!(
        logs(&outcome),
        ["notFound on get: no program is kept under the id `zzzz`; ids held: `k3p9` (turn 3)"]
    );
}

#[test]
fn a_blank_rerun_source_is_an_argument_error_in_swift() {
    let (outcome, _log) = answering_as(
        &catching(r#"try programs.rerun("   ")"#),
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["invalidArgument on rerun"]);
    assert!(outcome.rerun.is_none(), "{:?}", outcome.rerun);
}

#[test]
fn a_second_hand_over_from_one_swift_program_is_refused() {
    let (outcome, _log) = answering_as(
        &format!(
            "try programs.rerun(\"gg.log(\\\"first\\\")\")\n{}",
            catching(r#"try programs.rerun("gg.log(\"second\")")"#)
        ),
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["refused on rerun"]);
    assert_eq!(outcome.rerun.as_deref(), Some("gg.log(\"first\")"));
}

#[test]
fn a_hand_over_is_revoked_when_the_swift_program_then_fails() {
    let (outcome, _log) = answering_as(
        "try programs.rerun(\"gg.log(\\\"again\\\")\")\n_ = try programs.get(\"zzzz\")",
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    let _ = sandbox_error(&outcome);
    assert!(outcome.rerun.is_none(), "{:?}", outcome.rerun);
    assert!(outcome.revoked_rerun, "the hand-over was revoked");
}

#[test]
fn the_library_is_unavailable_to_a_swift_program_without_one() {
    let (outcome, log) = answering_as(
        &[
            catching("_ = try programs.history()"),
            catching(r#"_ = try programs.get("k3p9")"#),
            catching(r#"try programs.rerun("gg.log(\"again\")")"#),
        ]
        .join("\n"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "unavailable on history",
            "unavailable on get",
            "unavailable on rerun"
        ]
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(outcome.rerun.is_none());
}

// ---------------------------------------------------------------------------------------------
// docs
//
// `search`'s empty page, both closes refused as `unavailable` and both answering `0` once granted
// are read back by `the_view_object_the_helper_and_the_standard_ending_are_reached_in_swift_too`.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_search_with_no_query_and_no_filter_is_an_argument_error_in_swift() {
    let log = CallLog::default();
    let outcome = over(
        &catching_message("_ = try docs.search()"),
        FakeOperationApi::new(&log),
    );
    assert_eq!(
        logs(&outcome),
        [
            "invalidArgument on search: a search needs something to look for: a query, or a \
             `modules`, `type` or `kind` filter"
        ]
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn a_docs_search_limit_of_zero_is_an_argument_error_in_swift() {
    let outcome = over(
        &catching_message(r#"_ = try docs.search(query: "view", limit: 0)"#),
        FakeOperationApi::new(&CallLog::default()),
    );
    assert_eq!(
        logs(&outcome),
        [
            "invalidArgument on search: a page of zero hits would answer nothing; leave `limit` \
             out for the default"
        ]
    );
}

#[test]
fn a_doc_hit_hands_a_swift_program_its_fields() {
    // One compile, three evaluations: the double answers one hit, so each kind is its own run of the
    // same program.
    let component = prepare(
        r####"import gg

let found = try docs.search(query: "text view")
let hit = found.hits[0]
let kind: String
switch hit.kind {
case .module: kind = "module"
case .function: kind = "function"
case .type: kind = "type"
}
gg.log("\(found.total) \(hit.key) \(kind) \(hit.module) \(hit.name) \(hit.summary)")
"####,
    );
    for (kind, word) in [
        (DocKind::Module, "module"),
        (DocKind::Function, "function"),
        (DocKind::Type, "type"),
    ] {
        let outcome = evaluate_with_api(
            &component,
            &all_operations(),
            RunEnding::None,
            false,
            FakeOperationApi::new(&CallLog::default()).finding(
                "gg.views.openText",
                kind,
                "gg.views",
                "openText",
                "Show a value the program computed.",
            ),
        );
        assert_eq!(
            logs(&outcome),
            [format!(
                "1 gg.views.openText {word} gg.views openText Show a value the program computed."
            )]
        );
    }
}

// ---------------------------------------------------------------------------------------------
// views
//
// `openFile`'s text window, `openText`, `openDocsView`, and `close` on an open selector and on one
// never opened are read back by `the_view_object_the_helper_and_the_standard_ending_are_reached_in_swift_too`.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_file_view_of_a_path_that_is_not_there_opens_nothing_in_swift() {
    let (outcome, log) = refusing(
        &catching(r#"try views.openFile("gone.md")"#),
        ToolFailure::NotFound,
        "no such file: gone.md",
    );
    assert_eq!(logs(&outcome), ["notFound on open_file"]);
    assert_eq!(log.names(), ["read_file"]);
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

#[test]
fn an_offset_past_the_end_of_a_file_is_an_argument_error_in_swift() {
    let (outcome, log) = refusing(
        &catching(r#"try views.openFile("notes.md", offset: 900, limit: 20)"#),
        ToolFailure::InvalidArgument,
        "notes.md has 2 lines, so line 900 is past its end",
    );
    assert_eq!(logs(&outcome), ["invalidArgument on open_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 900, "limit": 20 }))
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_file_view_over_the_text_cap_is_limit_exceeded_in_swift() {
    let log = CallLog::default();
    let outcome = over(
        &catching_message(r#"try views.openFile("huge.md")"#),
        FakeOperationApi::with(&log, |_name: &str, _args: &Value| {
            ToolOutcome::ok("x".repeat(70_000), "read a big file")
        }),
    );
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("limitExceeded on open_file: ")
            && line.contains("70000")
            && line.contains("65536"),
        "the refusal names the size and the bound: {line}"
    );
    assert_eq!(log.names(), ["read_file"]);
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_line_cut_below_one_is_refused_before_it_is_dispatched_in_swift() {
    let (outcome, log) = succeeding(&format!(
        "{}\n{}",
        catching_message(r#"try views.openFile("wide.md", maxLineChars: 0)"#),
        catching(r#"try views.openFile("wide.md", maxLineChars: -1)"#)
    ));
    assert_eq!(
        logs(&outcome),
        [
            "invalidArgument on open_file: `maxLineChars` must be between 1 and 65536 (0 given); \
             omit it to leave lines whole",
            "invalidArgument on open_file"
        ]
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_line_cut_over_the_ceiling_is_refused_before_it_is_dispatched_in_swift() {
    let (outcome, log) = succeeding(&format!(
        "{}\ntry views.openFile(\"wide.md\", maxLineChars: 65536)\ngg.log(\"the ceiling itself opens\")",
        catching(r#"try views.openFile("wide.md", maxLineChars: 65537)"#)
    ));
    assert_eq!(
        logs(&outcome),
        ["invalidArgument on open_file", "the ceiling itself opens"]
    );
    assert_eq!(
        log.names(),
        ["read_file"],
        "only the cut at the ceiling reached gg's dispatch"
    );
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "wide.md", "offset": null, "limit": null, "maxLineChars": 65536 }))
    );
}

#[test]
fn re_opening_a_file_view_supersedes_rather_than_duplicating_in_swift() {
    let (outcome, _log) = succeeding(
        r####"
try views.openFile("notes.md")
try views.openFile("notes.md")
gg.log("opened twice")
"####,
    );
    assert_eq!(logs(&outcome), ["opened twice"]);
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| (view.selector.as_str(), view.superseded))
            .collect::<Vec<_>>(),
        [("notes.md", false), ("notes.md", true)]
    );
}

#[test]
fn an_empty_view_label_is_an_argument_error_in_swift() {
    let (outcome, log) = succeeding(&catching_message(
        r#"try views.openText("", body: "eight files, two failing")"#,
    ));
    assert_eq!(
        logs(&outcome),
        ["invalidArgument on open_text: a view needs a non-empty label"]
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_text_view_body_over_the_cap_is_limit_exceeded_in_swift() {
    let outcome = over(
        &catching_message(
            r#"try views.openText("summary", body: String(repeating: "x", count: 70000))"#,
        ),
        FakeOperationApi::new(&CallLog::default()),
    );
    assert_eq!(
        logs(&outcome),
        ["limitExceeded on open_text: view body exceeds max size (70000 bytes; max 65536)"]
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_text_view_label_over_the_cap_is_limit_exceeded_in_swift() {
    let outcome = over(
        &catching_message(
            r#"try views.openText(String(repeating: "l", count: 300), body: "eight files")"#,
        ),
        FakeOperationApi::new(&CallLog::default()),
    );
    assert_eq!(
        logs(&outcome),
        ["limitExceeded on open_text: label exceeds max length (300 bytes; max 200)"]
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_documentation_view_of_an_unknown_name_is_not_found_in_swift() {
    let outcome = over(
        &catching_message(r#"try views.openDocsView("gg.views.openTex")"#),
        FakeOperationApi::new(&CallLog::default())
            .cataloguing(&[("gg.views.openText", true), ("gg.delegation.fork", false)]),
    );
    assert_eq!(
        logs(&outcome),
        ["notFound on open_docs_view: no documentation for `gg.views.openTex`"]
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_documentation_view_of_a_name_this_agent_does_not_bind_is_not_found_in_swift() {
    let outcome = over(
        &catching_message(r#"try views.openDocsView("gg.delegation.fork")"#),
        FakeOperationApi::new(&CallLog::default())
            .cataloguing(&[("gg.views.openText", true), ("gg.delegation.fork", false)]),
    );
    assert_eq!(
        logs(&outcome),
        [
            "notFound on open_docs_view: no documentation for `gg.delegation.fork`: this session \
             does not bind it"
        ]
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn an_empty_view_selector_is_an_argument_error_in_swift() {
    let (outcome, _log) = succeeding(&catching_message(r#"try views.close("")"#));
    assert_eq!(
        logs(&outcome),
        ["invalidArgument on close: `view.close` needs a non-empty selector"]
    );
}

#[test]
fn closing_a_view_without_agent_managed_context_is_unavailable_in_swift() {
    let (outcome, log) = answering_as(
        &catching(r#"try views.close("summary")"#),
        &all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on close"]);
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert_eq!(refused_names(&outcome), ["views.close"]);
    assert!(outcome.views_closed.is_empty());
}

// ---------------------------------------------------------------------------------------------
// session
//
// `finish`'s standard ending, `approve`, and `requestChanges` with both items are read back by
// `the_view_object_the_helper_and_the_standard_ending_are_reached_in_swift_too` and
// `the_program_library_and_a_reviewers_verdict_are_reached_in_swift_too`.
// ---------------------------------------------------------------------------------------------

/// One program in `role`'s ending group, granted every operation.
fn ending_as(body: &str, role: EndingRole) -> SandboxOutcome {
    answering_as(
        body,
        &all_operations(),
        RunEnding::Role(role),
        false,
        canned_outcome,
    )
    .0
}

#[test]
fn a_blank_finish_summary_is_an_argument_error_in_swift() {
    let outcome = ending_as(
        &catching(r#"try session.finish("   ")"#),
        EndingRole::Standard,
    );
    assert_eq!(logs(&outcome), ["invalidArgument on finish"]);
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
}

#[test]
fn finishing_from_a_reviewers_session_is_unavailable_in_swift() {
    let outcome = ending_as(
        &catching(r#"try session.finish("the work is done")"#),
        EndingRole::Review,
    );
    assert_eq!(logs(&outcome), ["unavailable on finish"]);
    assert_eq!(refused_names(&outcome), ["session.finish"]);
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
}

#[test]
fn a_later_finish_replaces_the_summary_in_swift() {
    let outcome = ending_as(
        r#"try session.finish("first draft")
try session.finish("the work is done")
gg.log("ran on")"#,
        EndingRole::Standard,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    let completion = outcome.completion.as_ref().expect("the ending stands");
    assert!(
        matches!(&completion.ending, Ending::Finished { summary } if summary == "the work is done"),
        "{completion:?}"
    );
    assert_eq!(completion.superseded, 1);
}

#[test]
fn a_completion_is_revoked_when_the_swift_program_then_fails() {
    let (outcome, _log) = answering_as(
        r#"try session.finish("the work is done")
_ = try files.readFile("gone.swift")"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                ToolFailure::NotFound,
                "no such file: gone.swift".to_string(),
            )
        },
    );
    let _ = sandbox_error(&outcome);
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
    assert!(
        matches!(
            &outcome.revoked_completion,
            Some(Ending::Finished { summary }) if summary == "the work is done"
        ),
        "{:?}",
        outcome.revoked_completion
    );
}

#[test]
fn approving_from_a_standard_session_is_unavailable_in_swift() {
    let outcome = ending_as(&catching("try session.approve()"), EndingRole::Standard);
    assert_eq!(logs(&outcome), ["unavailable on approve"]);
    assert_eq!(refused_names(&outcome), ["session.approve"]);
    assert!(outcome.completion.is_none());
}

#[test]
fn an_empty_change_list_is_an_argument_error_in_swift() {
    let outcome = ending_as(
        &catching("try session.requestChanges([])"),
        EndingRole::Review,
    );
    assert_eq!(logs(&outcome), ["invalidArgument on request_changes"]);
    assert!(outcome.completion.is_none());
}

#[test]
fn a_change_list_of_blank_entries_is_an_argument_error_in_swift() {
    let outcome = ending_as(
        &catching(r#"try session.requestChanges(["", "   "])"#),
        EndingRole::Review,
    );
    assert_eq!(logs(&outcome), ["invalidArgument on request_changes"]);
    assert!(outcome.completion.is_none());
}

#[test]
fn requesting_changes_from_a_standard_session_is_unavailable_in_swift() {
    let outcome = ending_as(
        &catching(r#"try session.requestChanges(["widen the test"])"#),
        EndingRole::Standard,
    );
    assert_eq!(logs(&outcome), ["unavailable on request_changes"]);
    assert_eq!(refused_names(&outcome), ["session.request_changes"]);
    assert!(outcome.completion.is_none());
}

// ---------------------------------------------------------------------------------------------
// the feedback channel
//
// `gg.log` is the channel every assertion above reads through. The interface's other four
// functions are decided by the shell (`Sources/shell.swift`), and each case below states what this
// arm does instead; an uncaught failure is a trap rather than a reported error, which
// `a_failure_is_thrown_whether_it_is_caught_or_let_out` asserts with gg's own sentence.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_swift_program_notes_no_returned_value() {
    let (outcome, _log) = succeeding(
        r####"
gg.log("counted")
"counted".count
"####,
    );
    assert_eq!(logs(&outcome), ["counted"]);
    assert!(!outcome.returned_value);
}

#[test]
fn a_swift_program_defers_nothing_past_its_end() {
    let (outcome, log) = succeeding(
        r####"
try files.writeFile("out.txt", contents: "hello")
gg.log("done")
"####,
    );
    assert_eq!(logs(&outcome), ["done"]);
    assert_eq!(log.names(), ["write_file"]);
    assert_eq!(outcome.deferred_note, None);
}

#[test]
fn a_broken_code_module_is_refused_before_a_swift_program_runs() {
    let modules = [CodeModule {
        name: "broken".to_string(),
        source: "public func shout(_ who: String) -> String { return 42 }\n".to_string(),
    }];
    let failure = compile::compile_program(
        "import gg\nimport broken\n\ngg.log(shout(\"never\"))\n",
        &modules,
        &PrepareContext::detached(),
    )
    .expect_err("a module that does not type-check is refused at prepare");
    assert!(
        matches!(failure, PrepareFailure::Lowering(_)),
        "a module is refused before any program runs, so no module error is ever reported: \
         {failure:?}"
    );
}
