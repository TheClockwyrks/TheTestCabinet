//! **The Kotlin arm's model-facing surface**, driven end to end through the real toolchain and the
//! real membrane: the hand-written SDK, the catalogue reflected out of its own KDoc, and the
//! libraries this arm says a program may reach.
//!
//! # Why these are not in the substrate file
//!
//! Because they are a different claim. [`substrate`](super::substrate) asks whether Kotlin runs here.
//! This asks whether the thing a model is **told** it may write is the thing the sandbox really has —
//! which is the only question a cross-language study rests on, and the one whose failure is silent:
//! an SDK and a catalogue that agree with each other and with nothing else are two green test suites
//! and an invalidated experiment.
//!
//! # How they are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, so each starts a JVM that loads the
//! Kotlin compiler and TeaVM, and every program in it costs a build through that JVM. A
//! function groups the programs that exercise one behaviour, so they share that cost; one that
//! grows into the slow end of the suite is split rather than extended.

use serde_json::{Value, json};

use super::compile::{compile_module, compile_program};
use super::substrate::{
    evaluate_as, evaluate_closing_docviews, evaluate_with_program, logs, prepare, prepare_with,
    trap, whole,
};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::export_names;
use crate::sandbox::fake::{CallLog, all_operations, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::SandboxOutcome;
use crate::sandbox::{CodeModule, PrepareContext};
use crate::tools::ToolOutcome;

/// The catalogue this arm's build reflects, read as a **document** rather than through the language.
///
/// What every assertion below makes is a claim about the emitted JSON's own shape — which key a
/// parameter's prose hangs off, whether a default is recorded beside it — so reading it as a document
/// is the reading that can fail. Resolving it through the registry would only prove that the registry
/// hands back the bytes this file already has.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/kotlin.signatures.json"
));

/// Compile and run one Kotlin **statement body**, with the ending group and the library flag said
/// out loud.
///
/// The body is put in the `fun main()` this arm asks for by
/// [`whole`](super::substrate::whole) — the same helper the substrate tests use, and the same one a
/// model writes for itself. It is a helper here rather than a literal at every call site because
/// what these cases are about is the SDK's spellings rather than the entry point, and every gg name
/// below is written in full so nothing needs an `import` either.
fn run_as(
    body: &str,
    operations: &[crate::sandbox::operations::OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_as(
        &prepare(&whole("", body)),
        operations,
        &[],
        ending,
        library,
        responder,
    )
}

/// One Kotlin statement body through the production prepare step, as the component it becomes.
fn prepare_program(body: &str) -> Vec<u8> {
    prepare(&whole("", body))
}

/// Compile and run one Kotlin program with `enabled`'s operations offered and no ending group.
fn run_with(
    source: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(source, operations, RunEnding::None, false, responder)
}

// ---------------------------------------------------------------------------------------------
// Every operation, from its Kotlin spelling
// ---------------------------------------------------------------------------------------------

/// One operation, called through the Kotlin spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound operation, called through its idiomatic Kotlin function.
///
/// Deliberately the same table `sandbox.membrane.test.rs` drives the TypeScript arm with and the
/// Python, Ruby, PureScript and Java arms drive theirs with, down to the arguments and the expected
/// JSON — because the expected JSON is the point. gg's dispatch is language-independent: seven arms
/// writing the same call in their own idioms must produce **byte-identical** arguments, or they are
/// not running the same experiment. A named argument bound to the wrong wire field, a `gg.core.Patch.Clear`
/// read as "leave it alone" instead of "clear it", an enum entry whose wire word did not translate —
/// none of them is a compile error in any of the seven, and all of them are visible here.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: "gg.shell.run(\"npm test\", timeoutSecs = 30)",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: "gg.files.readFile(\"src/a.kt\", offset = 2, limit = 5)",
            expected: || json!({ "path": "src/a.kt", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: "gg.files.writeFile(\"out.txt\", \"hello\")",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: "gg.files.editFile(\"src/a.kt\", \"alpha\", \"beta\")",
            expected: || json!({ "path": "src/a.kt", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: "gg.files.listDir(\"src\")",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            statement: "gg.files.tree(path = \"src\", depth = 3)",
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            statement: "gg.files.search(\"answer\", path = \"src\", limit = 5)",
            expected: || json!({ "query": "answer", "path": "src", "limit": 5 }),
        },
        Crossing {
            tool: "read_skill",
            statement: "gg.skills.readSkill(\"testing\")",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: "gg.memories.writeMemory(\"layout\", \"d\", \"b\")",
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: "gg.memories.updateMemory(\"layout\", \"d2\", \"b2\")",
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, and the shape is where this arm parts
            // company with Java's: the two halves are the write's own optional arguments rather than
            // a value to build first, so "an on-use script and no module" is `onUse = …` and nothing
            // else — which is what a keyword argument with a real default buys.
            statement: "gg.memories.createMemory(\"layout\", \"d\", \"b\", \
                        code = \"fun one() = 1\", onUse = \"gg.views.openText(\\\"n\\\", \\\"1\\\")\")",
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "fun one() = 1",
                        "onUse": "gg.views.openText(\"n\", \"1\")" })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: "gg.memories.readMemory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: "gg.memories.editMemory(\"layout\", \"old\", \"new\")",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: "gg.memories.searchMemories(\"cargo\", \"nextest\")",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: "gg.memories.deleteMemory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: "gg.tasks.addTask(\"t1\", \"T\", \"D\", listOf(\"t0\"))",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: "gg.tasks.updateTask(\"t1\", title = \"T2\", \
                        description = gg.core.Patch.Clear, status = gg.tasks.TaskStatus.IN_PROGRESS)",
            expected: || {
                // `gg.core.Patch.Clear` is what CLEARS it — a field the call never names is the one that
                // keeps it — and `in_progress` is gg's own spelling, so the membrane's `in-progress`
                // reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: "gg.tasks.setBlockedBy(\"t1\")",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: "gg.tasks.completeTask(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: "gg.tasks.removeTask(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: "gg.board.createEpic(\"epc\", \"E\", \"D\")",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: "gg.board.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\", \
                        reviewers = listOf(\"critic\"))",
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
            statement: "gg.board.updateIssue(\"i1\", status = gg.board.IssueStatus.DONE, \
                        epicId = gg.core.Patch.Clear)",
            expected: || {
                // `gg.core.Patch.Clear` on the epic ungroups the issue, which gg's schema spells as the
                // empty string; a description the call never mentions keeps the one it has, so its
                // key is absent.
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
            statement: "gg.board.setIssueBlockedBy(\"i1\", \"i0\")",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: "gg.board.removeEpic(\"e1\")",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: "gg.board.removeIssue(\"i1\")",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: "gg.board.waitForIssue(\"i1\")",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: "gg.context.evictFileView(\"src/a.kt\")",
            expected: || json!({ "path": "src/a.kt" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a **range**, because that is what a span of integers is in this
            // language — and `..<` says the same span the other way, which is the shape a model
            // reaching for an exclusive end writes.
            statement: "gg.context.archiveThread(4..19, 30..<36)",
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: "gg.context.searchArchive(\"the parser\")",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: "gg.context.compact(\"scaffolded the page\", \"src/Main.kt\")",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.kt"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a sealed type rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: "gg.delegation.spawnSubagent(\"subagent\", gg.delegation.Brief.Prompt(\"write the lexer\"))",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: "gg.delegation.waitForSubagents(\"agent-1\")",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: "gg.delegation.sendMessage(\"agent-1\", \"prefer the simpler parser\")",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: "gg.delegation.transitionState(\"verify\", note = \"the build is green\")",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: "gg.delegation.exec(\"Builder\", prompt = \"pick it up from here\")",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: "gg.delegation.fork(\"try the other fix\")",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_operation_crosses_the_membrane_from_its_kotlin_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing, for the reason the Java arm gives: a compile here
    // costs a warm JVM a few hundred milliseconds, so thirty-five of them would be a great deal of
    // compiler for a table that reads the same. It is also the stronger check — the calls must arrive
    // in the order the program made them, so a call that reached gg's dispatch under a NEIGHBOUR's
    // name fails here as well.
    let program = crossings
        .iter()
        .map(|crossing| format!("{}\n", crossing.statement))
        .collect::<String>();
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

    // Exhaustive by construction: an operation added to gg with no row here fails now, rather than shipping
    // as a typed function nobody ever called.
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
fn the_documentation_the_views_the_program_library_the_helper_and_the_endings_are_reached_too() {
    // The five families that are NOT gg tools, so none of them appears in the crossing table above —
    // and two of them are where a program puts something in front of the model, which makes them the
    // ones a silent bridging mistake would cost the most. Between this, the table, and the member
    // functions driven at the end of this function, every entry this arm's catalogue describes has
    // been driven through the real membrane.
    let (outcome, log) = run_as(
        "val read = gg.views.openFile(\"notes.md\", offset = 1, limit = 2)\n\
         gg.views.openText(\"summary\", \"eight files, two failing\")\n\
         gg.views.openDocsView(\"readFile\")\n\
         gg.views.openFile(\"wide.md\", offset = 1, limit = 2, maxLineChars = 80)\n\
         val closed = gg.views.close(\"summary\")\n\
         val missing = gg.views.close(\"never opened\")\n\
         gg.log(\"$closed $missing\")\n\
         gg.log(when (read) {\n\
         \x20   is gg.files.TextFile -> read.contents.lines()[0]\n\
         \x20   is gg.files.ImageFile -> read.label\n\
         })\n\
         gg.session.finish(\"read the file and showed myself the result\")\n",
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // Closing something that is not open is `0` rather than a failure, so a program that tidies up
    // unconditionally does not have to guard every call.
    assert_eq!(lines[0], "1 0");
    assert_eq!(lines[1], "contents of notes.md");
    // Every view the program opened is recorded, the documentation one included.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes.md", "summary", "readFile", "wide.md"]
    );
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::Finished { summary }) if summary.starts_with("read the file")
        ),
        "the ending the program declared: {:?}",
        outcome.completion
    );

    // Two reads reached gg's dispatch and both arrived as `read_file`: the two
    // `gg.views.openFile` performs. Neither has a tool name of its own, which is exactly the
    // point — a view is a read gg also shows you. The second carries the view's own line cut,
    // which crosses only when the program wrote one.
    assert_eq!(log.names(), ["read_file", "read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );
    let reads: Vec<Value> = log
        .calls()
        .into_iter()
        .filter(|call| call.name == "read_file")
        .map(|call| call.args)
        .collect();
    assert_eq!(
        reads[1],
        json!({ "path": "wide.md", "offset": 1, "limit": 2, "maxLineChars": 80 })
    );

    // The program library is bound from the capability rather than from a tool name, and a reviewer
    // gets the other ending group and no `gg.session.finish` at all.
    let (outcome, _log) = run_as(
        "val history = gg.programs.history()\n\
         gg.log(history.size.toString())\n\
         try {\n\
         \x20   gg.programs.get(\"zzzz\")\n\
         } catch (failure: gg.core.ApiError) {\n\
         \x20   gg.log(failure.code.toString())\n\
         }\n\
         gg.programs.rerun(\"gg.log(\\\"again\\\")\")\n\
         gg.session.requestChanges(\"widen the test\", \"name the file\")\n",
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never an error — and an id it never
    // issued a program under is a `NOT_FOUND` the program catches in Kotlin's own idiom.
    assert_eq!(logs(&outcome), ["0", "NOT_FOUND"]);
    assert!(outcome.rerun.is_some(), "the hand-over is recorded");
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::ChangesRequested { items }) if items.len() == 2
        ),
        "the reviewer's verdict, with both items: {:?}",
        outcome.completion
    );

    // The other verdict, which is the same role's other ending.
    let (outcome, _log) = run_as(
        "gg.session.approve()\n",
        &[],
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "{:?}",
        outcome.result
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

    // THE MEMBER FUNCTIONS, each called the way its catalogue entry says it is written: on the value
    // the call before it handed back, with no `import` line anywhere in the program.
    //
    // This is the assertion that has to be made by COMPILING rather than by reading. These five were
    // written as top-level extension functions, which reads as the same thing and is not: an
    // extension is in scope only where it has been imported, so every one of these five statements
    // was `unresolved reference` — and nothing else in the suite would have said so, because the
    // crossing table drives the module-level spelling of the same five operations and passes either
    // way. What is asserted below is therefore two things at once: that the program compiles at all,
    // and that each call reaches gg's dispatch under the tool its entry names, with the argument the
    // receiver was carrying.
    let (outcome, log) = run_as(
        "val created = gg.board.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\")\n\
         gg.log(created.wait())\n\
         val hits = gg.memories.searchMemories(\"build\")\n\
         gg.log(hits[0].read())\n\
         val child = gg.delegation.spawnSubagent(\"subagent\", gg.delegation.Brief.Prompt(\"go\"))\n\
         child.send(\"prefer the simpler parser\")\n\
         gg.views.openText(\"scratch\", \"body\")\n\
         gg.log(gg.views.close(\"scratch\").toString())\n\
         try {\n\
         \x20   gg.programs.ProgramSummary(\"zzzz\", 2, 1, 1, true, null).source()\n\
         } catch (failure: gg.core.ApiError) {\n\
         \x20   gg.log(failure.code.toString())\n\
         }\n",
        &all_operations(),
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the member functions did not compile or did not run: {:?}",
        outcome.result
    );
    // Each member carried the receiver's own field across: the issue's id, the hit's slug, the
    // child's id, and the view's selector. `close` answers `1` because the view it was called on is
    // the one the line above opened.
    assert_eq!(
        logs(&outcome),
        ["wait registered", "the memory contents", "1", "NOT_FOUND"]
    );
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );

    // The fourth member hangs off the program library, which is bought by a capability rather than
    // by a tool, and answers out of a history a fresh double has none of — so it needs one seeded.
    // The summary carries the id its acknowledgement did, and `source()` fetches by that id rather
    // than by the turn, which is kept for orientation only.
    let (outcome, _log) = evaluate_with_program(
        &prepare(&whole(
            "",
            "val summary = gg.programs.history()[0]\n\
             gg.log(\"${summary.id} ${summary.turn} ${summary.source()}\")\n",
        )),
        "p3",
        3,
        "gg.log(\"the program that ran\")",
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["p3 3 gg.log(\"the program that ran\")"]);
    assert_eq!(
        log.args("read_memory"),
        Some(json!({ "name": "build-commands" }))
    );
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );

    // THE DOCUMENTATION MODULE, which is the family a session begins in: the prompt names no
    // function, so this is the only call a model can make before it has been told a name. It is
    // driven from Kotlin's own spellings — the query alone, and the filters alone with no query at
    // all, both of which are named default arguments, which is how this arm expresses every optional
    // argument.
    //
    // The double models no catalogue, so an empty page is the honest answer and the ranking is
    // `DocsRuntime`'s to be right about. What is observed here is this arm's own half: that the
    // named arguments reach the guest in the order the WIT declares them rather than as the ones the
    // call happened to write, that a `listOf` of module paths crosses as a list, and that the
    // envelope comes back as a `DocSearch` a program reads fields off.
    let (outcome, _log) = run_with(
        "val all = gg.docs.search(\"view\")\n\
         val narrowed = gg.docs.search(\n\
         \x20   modules = listOf(\"gg.views\"),\n\
         \x20   kind = gg.docs.DocKind.FUNCTION,\n\
         \x20   limit = 5,\n\
         )\n\
         gg.log(\"${all.total} ${all.offset} ${all.hits.size}\")\n\
         gg.log(narrowed.hits.isEmpty().toString())\n\
         try {\n\
         \x20   gg.docs.close(\"gg.files.readFile\")\n\
         } catch (failure: gg.core.ApiError) {\n\
         \x20   gg.log(failure.code.toString() + \" \" + failure.operation)\n\
         }\n",
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["0 0 0", "true", "UNAVAILABLE close"],
        "the documentation module did not answer from its Kotlin spellings"
    );
    // A search is not a tool call and not a view the program named: its results go into the window
    // under gg's own constant selector, so a second search replaces the first rather than piling up.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| (view.kind, view.selector.as_str()))
            .collect::<Vec<_>>(),
        [
            (
                crate::context::ViewKind::Search,
                crate::context::SEARCH_RESULTS_VIEW
            ),
            (
                crate::context::ViewKind::Search,
                crate::context::SEARCH_RESULTS_VIEW
            ),
        ],
        "each search placed its page in the window"
    );

    // And the same two closing calls for an agent that HOLDS `docview-close`, which is the only way
    // to reach this arm's lowering of what they answer: the double holds no window, so nothing is
    // open and `0` is the honest count — a successful call rather than a failure, exactly as it is
    // in production.
    let (outcome, _log) = evaluate_closing_docviews(
        &prepare_program(
            "val closed = gg.docs.close(\"gg.files.readFile\")\n\
             val every = gg.docs.closeAll()\n\
             gg.log(\"$closed $every\")\n",
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["0 0"],
        "the capability was granted and the closes still did not answer"
    );

    // Exhaustive by construction, the way the crossing table is: a fifth member function added to
    // this arm's SDK fails here rather than shipping as a name nothing has ever called.
    let kotlin =
        crate::sandbox::language::language(test_cabinet_core::gg::GgProgramLanguage::Kotlin);
    let mut catalogued: Vec<&str> = crate::sandbox::catalogue_functions(kotlin)
        .iter()
        .filter(|function| function.receiver.is_some())
        .map(|function| function.fqn)
        .collect();
    catalogued.sort_unstable();
    assert_eq!(
        catalogued,
        [
            "gg.board.IssueCreated.wait",
            "gg.delegation.SubagentHandle.send",
            "gg.memories.MemoryHit.read",
            "gg.programs.ProgramSummary.source",
        ],
        "every member function this arm catalogues needs a call in the program above"
    );
}

#[test]
fn a_failure_is_a_kotlin_exception_whether_it_is_caught_or_not() {
    // The whole of this arm's failure story. gg's refusal crosses as three encoded fields and this
    // SDK's own one-line bridge raises them as `gg.core.ApiError` — an ordinary Kotlin exception,
    // which is what makes the clause below work at all and what a `runCatching` can see.
    let (outcome, _log) = run_with(
        "try {\n\
         \x20   gg.files.readFile(\"gone.kt\")\n\
         } catch (failure: gg.core.ApiError) {\n\
         \x20   gg.log(\"${failure.code} on ${failure.operation}\")\n\
         }\n\
         gg.log(\"carried on\")\n",
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.kt".to_string(),
            )
        },
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on read_file", "carried on"]);

    // And one that ESCAPED. There is no second channel for it on a compiled arm — gg catches
    // nothing — so what the model reads is the exception's own header on the guest's standard error,
    // which is why `ApiError`'s message carries the tool and the code as well as gg's sentence.
    let (outcome, _log) = run_with(
        "gg.log(\"before\")\n\
         gg.files.readFile(\"gone.kt\")\n\
         gg.log(\"after\")\n",
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.kt".to_string(),
            )
        },
    );
    let reported = trap(&outcome);
    assert!(
        reported.contains("gg.core.ApiError: `read_file` failed (not-found)")
            && reported.contains("no such file: gone.kt"),
        "the model reads gg's own sentence under the class it would have caught: {reported}",
    );
    // And its own line, because nothing intercepted the throw: the frames are TeaVM's own over the
    // model's own file.
    assert!(reported.contains("Program.kt:3"), "{reported}");
    assert_eq!(outcome.logs, ["before"], "what ran before it still stands");

    // A `runCatching` is the other way a Kotlin author reaches a failure, and it works for the same
    // reason: what the SDK raises is an ordinary exception rather than something the bridge wrapped.
    let (outcome, _log) = run_with(
        "val read = runCatching { gg.files.readFile(\"gone.kt\") }\n\
         gg.log(read.exceptionOrNull().let { it is gg.core.ApiError }.toString())\n",
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.kt".to_string(),
            )
        },
    );
    assert_eq!(logs(&outcome), ["true"]);
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // The SDK exposes the whole surface — it is compiled once, into a jar, and a run's operations set is
    // decided per run — so what stops a withheld capability from being reachable is a refusal rather
    // than a missing name. It carries the code the HOST refuses an out-of-set call with, because gg
    // classifies a turn's error from the code: a capability nobody granted must not be recorded as a
    // name the model got wrong.
    let (outcome, log) = run_with("gg.files.readFile(\"src/Main.kt\")\n", &[], canned_outcome);
    let reported = trap(&outcome);
    assert!(
        reported.contains("`read_file` failed (unavailable)")
            && reported.contains("`gg.files.readFile` is not available"),
        "the refusal names the call the model wrote, in the host's own words, under the code gg \
         classifies an out-of-set call with: {reported}",
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");

    // The same refusal is catchable, which is what makes a program able to probe its own surface
    // rather than crash on it.
    let (outcome, _log) = run_with(
        "try {\n\
         \x20   gg.delegation.fork(\"a copy\")\n\
         } catch (failure: gg.core.ApiError) {\n\
         \x20   gg.log(failure.code.wireName)\n\
         }\n",
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable"]);
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

#[test]
fn the_catalogue_carries_the_defaults_this_arm_expresses_an_optional_argument_as() {
    // This is the arm the seam's own schema notes name beside Java's: "an optional argument is a Java
    // overload pair, a **Kotlin default**". So the assertion is the exact opposite of Java's — no
    // entry here carries an overload group at all, every optional argument is a **keyword** parameter
    // with a stated default, and the catalogue says so.
    let document: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Kotlin catalogue is valid JSON");

    let mut defaults = 0usize;
    let mut varargs = 0usize;
    // One array rather than five sections: this arm is written in the normalized doc model, where
    // every model-facing call is one entry of it and nothing model-facing sits outside it.
    for entry in document["functions"].as_array().expect("an array") {
        let shapes = entry["signatures"].as_array().expect("an array");
        assert_eq!(
            shapes.len(),
            1,
            "`{}` carries an overload group, which this language does not need",
            entry["name"]
        );
        for parameter in shapes[0]["parameters"].as_array().expect("an array") {
            let optional = parameter["optional"].as_bool().expect("a flag");
            let vararg = parameter["type"]
                .as_str()
                .expect("a type")
                .starts_with("vararg ");
            if vararg {
                // A `vararg` is optional because naming none is legal, and it is passed by
                // POSITION: `gg.memories.searchMemories("a", "b")` names no parameter.
                varargs += 1;
                assert!(optional, "a vararg may always be given no values");
                assert_eq!(parameter["kind"], json!("positional"));
                assert_eq!(parameter["default"], json!(null));
                continue;
            }
            assert_eq!(
                parameter["kind"],
                json!(if optional { "keyword" } else { "positional" }),
                "`{}`'s `{}` is passed neither the way a required argument is nor the way an \
                 optional one is",
                entry["name"],
                parameter["name"]
            );
            if optional {
                defaults += 1;
                assert_eq!(
                    parameter["default"],
                    json!("null"),
                    "`{}`'s `{}` states no default, so the signature does not say what leaving \
                     it out means",
                    entry["name"],
                    parameter["name"]
                );
            }
        }
    }
    assert!(
        defaults >= 14,
        "this arm expresses at least as many optional arguments as Java expresses overloads, and \
         found only {defaults}"
    );
    assert!(varargs >= 6, "found only {varargs} variadic arguments");
}

// ---------------------------------------------------------------------------------------------
// The libraries
// ---------------------------------------------------------------------------------------------

/// One package this arm says a program may reach, and a real declaration in it to prove the claim.
struct Library {
    /// The package, exactly as `libraries.txt` and the catalogue name it.
    package: &'static str,
    /// A statement that reaches something real in it and prints what it found.
    probe: &'static str,
    /// What that statement must print.
    expected: &'static str,
}

/// A probe per declared package, plus the idioms a model reaches for first.
///
/// The probe is deliberately a **call** rather than an import: TeaVM emits only what a call graph
/// reached, so an import alone would prove that the compiler resolved a name and nothing about
/// whether the program can run.
fn libraries() -> Vec<Library> {
    vec![
        Library {
            package: "kotlin",
            probe: "gg.log((\"ab\".repeat(2)))",
            expected: "abab",
        },
        Library {
            package: "kotlin.collections",
            probe: "gg.log(listOf(3, 1, 2).sorted().joinToString(\"-\"))",
            expected: "1-2-3",
        },
        Library {
            package: "kotlin.text",
            probe: "gg.log(Regex(\"a(\\\\d+)\").find(\"a42\")!!.groupValues[1])",
            expected: "42",
        },
        Library {
            package: "kotlin.ranges",
            probe: "gg.log((1..4).sum().toString())",
            expected: "10",
        },
        Library {
            package: "kotlin.sequences",
            probe: "gg.log(sequenceOf(1, 2, 3).map { it * 2 }.joinToString(\",\"))",
            expected: "2,4,6",
        },
        Library {
            package: "kotlin.comparisons",
            probe: "gg.log(listOf(\"bb\", \"a\").sortedWith(compareBy { it.length })[0])",
            expected: "a",
        },
        Library {
            package: "kotlin.io",
            // NOT `print`, which is this package's most obvious member and reaches nobody: gg
            // attaches a standard error to a program and deliberately no standard output. And not
            // `use` either, which this arm does not carry — see
            // `what_this_toolchain_is_not_is_recorded_rather_than_assumed`.
            probe: "gg.log(java.io.StringReader(\"printed\").readText())",
            expected: "printed",
        },
        Library {
            package: "kotlin.math",
            probe: "gg.log(kotlin.math.max(2, 3).toString())",
            expected: "3",
        },
        Library {
            package: "kotlin.random",
            probe: "gg.log((kotlin.random.Random(7).nextInt(10) in 0..9).toString())",
            expected: "true",
        },
        Library {
            package: "kotlin.time",
            probe: "gg.log(kotlin.time.Duration.parse(\"1m\").toString())",
            expected: "1m",
        },
        Library {
            package: "java.lang",
            probe: "gg.log(java.lang.Integer.toHexString(255))",
            expected: "ff",
        },
        Library {
            package: "java.util",
            probe: "gg.log(java.util.ArrayList(listOf(\"x\")).size.toString())",
            expected: "1",
        },
        Library {
            package: "java.math",
            probe: "gg.log(java.math.BigInteger(\"2\").pow(70).toString())",
            expected: "1180591620717411303424",
        },
        Library {
            package: "java.time",
            probe: "gg.log(java.time.LocalDate.of(2026, 8, 7).toString())",
            expected: "2026-08-07",
        },
        Library {
            package: "java.time.format",
            probe: "gg.log(java.time.LocalDate.of(2026, 8, 7).format(\
                    java.time.format.DateTimeFormatter.ofPattern(\"yyyy/MM\")))",
            expected: "2026/08",
        },
        Library {
            package: "java.io",
            probe: "gg.log(java.io.StringWriter().apply { write(\"w\") }.toString())",
            expected: "w",
        },
        Library {
            package: "java.nio.charset",
            probe: "gg.log(java.nio.charset.StandardCharsets.UTF_8.name())",
            expected: "UTF-8",
        },
    ]
}

#[test]
fn kotlin_reaches_every_library_this_arm_says_it_may() {
    // `libraries.txt` is a claim about the artifact, and this is what holds it to one. It is also the
    // only place the claim can be checked: nothing is installed for it and nothing is baked, so what
    // a program may reach is whatever the standard library's own implementation translates.
    let declared: Vec<&str> =
        include_str!("../../../../../packages/gg-sandbox-kotlin/libraries.txt")
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .collect();
    let probes = libraries();
    let probed: Vec<&str> = probes.iter().map(|library| library.package).collect();
    assert_eq!(
        declared, probed,
        "every package this arm declares needs a probe, in order, and only declared ones may have one"
    );

    // One program rather than one per package, for the reason the crossing table is one program: a
    // compile is the expensive thing here and seventeen of them would be a great deal of compiler for
    // a table that reads the same.
    let program = probes
        .iter()
        .map(|library| format!("{}\n", library.probe))
        .collect::<String>();
    let (outcome, _log) = run_with(&program, &[], canned_outcome);
    let printed = logs(&outcome);
    for (index, library) in probes.iter().enumerate() {
        assert_eq!(
            printed.get(index).map(String::as_str),
            Some(library.expected),
            "`{}` did not reach what this arm says it may",
            library.package
        );
    }
}

#[test]
fn what_this_arm_does_not_carry_is_recorded_rather_than_discovered() {
    // The absences are as much a fact about the arm as the presences, and a study reader has to be
    // able to read them off a test rather than out of a transcript. Each is a located compile error
    // on the turn that wrote it, which is the best shape a gap can have.
    for (source, expected) in [
        // The compiler's own runtime dependency, and the one a model reaching for concurrency writes
        // first. A program is compiled against the standard library rather than against the driver's
        // classpath precisely so that this is ONE diagnostic at the model's own line rather than
        // forty-five inside somebody else's file.
        (
            "import kotlinx.coroutines.runBlocking\n\nfun main() {\n    runBlocking { }\n}\n",
            "Program.kt:1:8: Unresolved reference 'kotlinx'.",
        ),
        // A thread is scheduled with `setTimeout`, which this sandbox denies — and this arm finds out
        // at COMPILE time, inside the standard library's own file, which is the answer this arm's
        // `verdict` calls the model's rather than gg's.
        (
            "fun main() {\n    kotlin.concurrent.thread { gg.log(\"x\") }\n}\n",
            "Thread",
        ),
    ] {
        let failure = compile_program(source, &[], &PrepareContext::detached())
            .err()
            .unwrap_or_else(|| panic!("this arm compiled `{source}`, which it must not"));
        let rendered = failure.to_string();
        assert!(
            rendered.contains(expected),
            "the diagnostic for `{source}` does not name what a model would act on: {rendered}"
        );
    }
}

/// **Nothing this arm offers resolves without a line the program wrote.**
///
/// The catalogue tells a model how to reach every module it describes, and this is the assertion
/// that the answer is true in both directions. Two forms resolve — a name written in full, and the
/// `import gg.<module>.*` the catalogue states — and a short name written with neither does not.
///
/// It is the one gate on this arm that could rot silently: gg writes no import into a program, so an
/// SDK that started arriving in a program's scope some other way would make every documentation view
/// on this arm tell a model something that is no longer true, and nothing else would notice.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    // THE TWO THAT RESOLVE. Both are driven through the real membrane rather than merely compiled,
    // because a call that resolves and then reaches nothing would pass a compile check.
    let (outcome, log) = run_with(
        "    gg.log(gg.files.readFile(\"a.md\").let { if (it is gg.files.TextFile) it.contents else \"\" })\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["contents of a.md\nline two\n"]);
    assert_eq!(log.names(), ["read_file"]);

    let line = crate::sandbox::catalogue_modules(crate::sandbox::language::language(
        test_cabinet_core::gg::GgProgramLanguage::Kotlin,
    ))
    .into_iter()
    .find(|module| module.id == "files")
    .and_then(|module| module.import)
    .expect("the catalogue states the line a program writes to reach `gg.files`");
    assert_eq!(line, "import gg.files.*");
    let (outcome, log) = evaluate_as(
        &prepare(&whole(
            line,
            "    gg.log(readFile(\"a.md\").let { if (it is TextFile) it.contents else \"\" })\n",
        )),
        &all_operations(),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["contents of a.md\nline two\n"]);
    assert_eq!(log.names(), ["read_file"]);

    // AND THE ONE THAT DOES NOT: the short name with neither the line nor the path, which is what an
    // injected scope would have made work.
    let failure = compile_program(
        &whole("", "    gg.log(readFile(\"a.md\").toString())\n"),
        &[],
        &PrepareContext::detached(),
    )
    .expect_err("a name nothing brought into scope is refused");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("Unresolved reference") && rendered.contains("Program.kt:2"),
        "the compiler's own diagnostic, at the model's own line: {rendered}"
    );

    // The same for a type, because a signature names types as well as calls.
    let failure = compile_program(
        &whole(
            "",
            "    val code: ApiErrorCode? = null\n    gg.log(code.toString())\n",
        ),
        &[],
        &PrepareContext::detached(),
    )
    .expect_err("a type nothing brought into scope is refused");
    assert!(
        failure.to_string().contains("Unresolved reference"),
        "{failure}"
    );
}

// ---------------------------------------------------------------------------------------------
// A code module, reached from Kotlin
// ---------------------------------------------------------------------------------------------

#[test]
fn a_code_module_is_reached_by_a_path_the_compiler_checks() {
    // A module is compiled on its own into `package lib.<key>` and handed to this program as a
    // CLASSPATH ENTRY, so `lib.<key>.<name>` is an ordinary call the compiler resolves against a
    // library — the same relation a program has to gg's own SDK jar.
    //
    // What this drives is the whole of what that buys: every return type reached without a reading
    // function, a value handed back through a real crossing, state the module really holds between
    // two calls, and a name that does not exist refused by the COMPILER rather than at run time.
    let prepared = compile_module(
        "helpers",
        r#"private val seen: MutableList<String> = mutableListOf()

fun greet(who: String): String = "hello, " + who.uppercase()

fun add(left: Int, right: Int): Int = left + right

fun negated(flag: Boolean): Boolean = !flag

fun describe(ratio: Double, note: String): String = "$ratio/$note"

fun remember(word: String) {
    seen.add(word)
}

fun recalled(): String = seen.joinToString("+")
"#,
        &PrepareContext::detached(),
    )
    .expect("the Kotlin toolchain compiles a code module");
    assert_eq!(
        export_names(&prepared.exports),
        [
            "greet", "add", "negated", "describe", "remember", "recalled"
        ],
        "a module's public top-level functions are its namespace, in the order it declares them",
    );

    let modules = vec![CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];
    let body = "    gg.log(lib.helpers.greet(\"gg\"))\n\
                \x20   gg.log(lib.helpers.add(40, 2).toString())\n\
                \x20   gg.log(lib.helpers.negated(false).toString())\n\
                \x20   gg.log(lib.helpers.describe(1.5, \"note\"))\n\
                \x20   lib.helpers.remember(\"one\")\n\
                \x20   lib.helpers.remember(\"two\")\n\
                \x20   gg.log(lib.helpers.recalled())\n";
    let (outcome, _log) = evaluate_as(
        &prepare_with(&whole("", body), &modules),
        &[],
        &modules,
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            // Every type the module declares, reached at its own type rather than through a reading
            // function that named one: a `String`, an `Int`, a `Boolean` and a `Double` argument.
            "hello, GG",
            "42",
            "true",
            "1.5/note",
            // The module really holds state across two calls, so a call that quietly did nothing
            // would read here rather than pass.
            "one+two",
        ]
    );

    // AND A NAME THAT IS NOT THERE IS THE COMPILER'S REFUSAL, on the turn that wrote it, rather than
    // a `NOT_FOUND` at run time. That is the whole of what a checked path buys a model over a lookup
    // by string.
    let failure = compile_program(
        &whole("", "    lib.helpers.absent()\n"),
        &modules,
        &PrepareContext::detached(),
    )
    .expect_err("a name the module does not export is refused");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("Program.kt:2") && rendered.contains("absent"),
        "the model is told at its own line: {rendered}"
    );

    // The access the reply that binds a module quotes back is the one that compiles.
    let kotlin =
        crate::sandbox::language::language(test_cabinet_core::gg::GgProgramLanguage::Kotlin);
    assert_eq!(kotlin.lib_access("helpers"), "lib.helpers.<name>");
    assert_eq!(
        kotlin.lib_import("helpers").as_deref(),
        Some("import lib.helpers.*"),
    );

    // AND A SKILL WHOSE NAME IS A KEYWORD IS STILL REACHABLE. The key is a package segment, so a
    // module bound at `object` would make `lib.object.greet(…)` a syntax error against the MODEL's
    // own file, every turn, for a name gg minted and told it to use.
    let key = kotlin.binding_name("object");
    let modules = vec![CodeModule {
        name: key.clone(),
        source: modules[0].source.clone(),
    }];
    let (outcome, _log) = evaluate_as(
        &prepare_with(
            &whole("", &format!("    gg.log(lib.{key}.greet(\"gg\"))\n")),
            &modules,
        ),
        &[],
        &modules,
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["hello, GG"]);
}
