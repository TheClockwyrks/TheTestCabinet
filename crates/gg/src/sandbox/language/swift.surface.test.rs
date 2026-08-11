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
//! # Why they are consolidated all the same
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in here costs a real
//! `swiftc` and a `Component::new` — which on this arm is ~1.6 s between them, the dearest of any.
//! So each function drives *many* statements rather than being one behaviour per function. Add a
//! statement to an existing function rather than adding a function.

use serde_json::{Value, json};

use super::compile;
use super::substrate::{evaluate, logs, prepare, sandbox_error};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::SandboxOutcome;
use crate::tools::{ToolFailure, ToolOutcome};

/// The catalogue this arm commits, read as a **document** rather than through
/// [`SignatureCatalogue`](crate::sandbox::signatures) — deliberately, because the parsed reading is
/// a *projection* and a field the parser does not model is one these tests could not notice was
/// missing. Here the JSON is read as JSON, which is what lets a test say the file carries a section
/// at all.
const SIGNATURES: &str = include_str!("../guests/swift.signatures.json");

/// The committed catalogue, parsed as JSON.
fn catalogue() -> Value {
    serde_json::from_str(SIGNATURES).expect("the committed catalogue is JSON")
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

/// Compile and run one Swift program with `enabled`'s tools offered and no ending group.
fn run_with(
    source: &str,
    enabled: &[String],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(&prepare(source), enabled, RunEnding::None, false, responder)
}

/// One tool, called through the Swift spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic Swift function.
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
fn every_tool_crosses_the_membrane_from_its_swift_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: a compile and an instantiate here are ~1.6 s
    // between them, so thirty-five of them would be a minute of toolchain for a table that reads the
    // same. It is also the stronger check — the calls must arrive in the order the program made
    // them, so a call that reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    let program = crossings
        .iter()
        .map(|crossing| format!("{}\n", crossing.statement))
        .collect::<String>();
    let (outcome, log) = run_with(&program, &all_tools(), canned_outcome);
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

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than
    // shipping as a typed function nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut vocabulary = crate::sandbox::signatures::sandbox_tool_names();
    vocabulary.sort_unstable();
    assert_eq!(
        covered, vocabulary,
        "every bound tool needs a crossing, and only bound tools may have one"
    );
}

#[test]
fn the_view_object_the_helper_and_the_standard_ending_are_reached_in_swift_too() {
    // Two of the four families that are NOT gg tools, so neither appears in the crossing table above
    // — and both are where a program puts something in front of the model, which makes them the ones
    // a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(
            r####"
let text = try files.readTextFile("notes.md", offset: 1, limit: 2)
let read = try views.openFile("notes.md", offset: 1, limit: 2)
try views.openText("summary", body: text)
try views.openDocsView("readFile")
let closed = try views.close("summary")
let missing = try views.close("never opened")
let open = views.current()
gg.log("\(open[0].selector) \(open[0].kind)")
gg.log("\(closed) \(missing)")
switch read {
case .text(let file): gg.log(file.contents.split(separator: "\n").first.map(String.init) ?? "")
case .image(let picture): gg.log(picture.label)
}
try session.finish("read the file and showed myself the result")
"####,
        ),
        &all_tools(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // What is still open is the file view, carrying the enum case rather than the word the wire
    // used; the text view the program closed is gone, and a documentation view is gg's to deliver on
    // the next turn rather than something `current` reports.
    assert_eq!(lines[0], "notes.md file");
    // Closing something that is not open is `0` rather than a failure, so a program that tidies up
    // unconditionally does not have to guard every call.
    assert_eq!(lines[1], "1 0");
    assert_eq!(lines[2], "contents of notes.md");
    // Every view the program opened is recorded, the documentation one included.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes.md", "summary", "readFile"]
    );
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::Finished { summary }) if summary.starts_with("read the file")
        ),
        "the ending the program declared: {:?}",
        outcome.completion
    );

    // Two reads reached gg's dispatch and both arrived as `read_file`: the helper's, and the one
    // `views.openFile` performs. Neither has a tool name of its own, which is exactly the point — a
    // helper is a spelling of the tool it is built on, and a view is a read gg also shows you.
    assert_eq!(log.names(), ["read_file", "read_file"]);
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
let files = ["a", "b"]
gg.log("\(files.count)")
gg.log(try gg.files.readTextFile("notes.md"))
"####,
        &all_tools(),
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
let history = try programs.history()
gg.log("\(history.count)")
do {
    gg.log(try programs.get(turn: 2))
} catch let failure as core.ToolError {
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
    // A session that has run nothing has an empty history — never a failure — and a turn it never
    // kept a program for is a `.notFound` the program catches in Swift's own idiom.
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
        &prepare("try session.approve()\n"),
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
    // expects one failure and not the others writes. Nothing about it is exceptional — `ToolError`
    // is an ordinary Swift `Error`, so `do`/`catch`, `try?` and `Result { }` all work on it without
    // an SDK-specific combinator.
    let (outcome, _log) = run_with(
        r####"
do {
    gg.log(try files.readTextFile("gone.swift"))
} catch let failure as core.ToolError where failure.code == .notFound {
    gg.log("\(failure.code) on \(failure.tool)")
}
gg.log("carried on")
"####,
        &all_tools(),
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
    // about it — and the measurement here is that **gg's own sentence survives**: `ToolError` is
    // `CustomStringConvertible`, the runtime renders the error it could not handle, and the tool,
    // the class and the message all come through.
    let (outcome, _log) = run_with(
        r####"
gg.log("before")
_ = try files.readTextFile("gone.swift")
gg.log("after")
"####,
        &all_tools(),
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
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // This arm cannot withhold a NAME: its SDK is a module linked into the program, so every
    // function is in scope whatever a run enables and the host is the only thing that can refuse.
    // That is exactly the case `error-code.unavailable` exists for, and the recovery is the same one
    // a name that was never in scope gets.
    let (outcome, log) = run_with(
        r####"
do {
    _ = try shell.run("swift build")
    gg.log("ran")
} catch let failure as core.ToolError {
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
        ["system.shell"],
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
fn the_artifact_binds_exactly_the_tools_gg_offers() {
    // The one drift no source-level test can catch, asked of the artifact rather than of a source
    // file. On this arm the artifact cannot be STALE — it was compiled from this checkout's SDK
    // moments ago — so what it catches instead is the SDK's own binding table falling out of step
    // with the functions beside it, which is the second, independent statement of the same fact that
    // makes asking the artifact worth anything.
    //
    let component = prepare("");
    let mut bound = crate::sandbox::component_bound_tools(
        crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::Swift),
        Some(component),
    )
    .expect("a freshly compiled Swift program reports the tools its SDK binds");
    bound.sort();
    let mut expected: Vec<String> = crate::sandbox::signatures::sandbox_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    expected.sort();
    assert_eq!(
        bound, expected,
        "the SDK's own binding table and gg's tool vocabulary have drifted apart"
    );
}

#[test]
fn the_committed_catalogue_describes_the_surface_the_sdk_offers() {
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
            ("context", "gg.context"),
            ("delegation", "gg.delegation"),
            ("skills", "gg.skills"),
            ("programs", "gg.programs"),
            ("session", "gg.session"),
            ("core", "gg.core"),
        ],
        "the modules, their order, or their Swift paths are not the surface's"
    );

    // Every gg operation is bound exactly once, and nothing that is not one is claimed. This is the
    // v2 shape of the tool bijection: an arm asserts which operation each function binds, and gg's
    // own table is what says whether that operation exists — see `language/register.rs`, which fails
    // an id gg has no row for.
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
