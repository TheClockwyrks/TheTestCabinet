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

use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY,
    CAPABILITY_READ_FILE,
};

use super::compile::{compile_module, compile_program};
use super::substrate::{
    evaluate_as, evaluate_cataloguing, evaluate_closing_docviews, evaluate_refusing,
    evaluate_with_program, logs, prepare, prepare_with, trap, whole,
};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::export_names;
use crate::sandbox::fake::{CallLog, all_operations, all_operations_without, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::operations::{
    CONTEXT_ARCHIVE_THREAD, CONTEXT_COMPACT, CONTEXT_EVICT_FILE_VIEW, CONTEXT_SEARCH_ARCHIVE,
    DELEGATION_EXEC, DELEGATION_FORK, DELEGATION_SEND_MESSAGE, DELEGATION_SPAWN_SUBAGENT,
    DELEGATION_TRANSITION_STATE, DELEGATION_WAIT_FOR_SUBAGENTS, VIEWS_CLOSE, VIEWS_OPEN_FILE,
    VIEWS_OPEN_TEXT,
};
use crate::sandbox::outcome::SandboxOutcome;
use crate::sandbox::{CodeModule, PrepareContext};
use crate::tools::{
    AgentStatusData, ApiData, ArchiveSearchData, SubagentResultData, ToolFailure, ToolOutcome,
};

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
fn the_views_the_program_library_and_the_endings_are_reached_too() {
    // The five families that are NOT gg tools, so none of them appears in the crossing table above —
    // and two of them are where a program puts something in front of the model, which makes them the
    // ones a silent bridging mistake would cost the most. Between this, the table, the member
    // functions and the documentation module driven by the two tests below, every entry this arm's
    // catalogue describes has been driven through the real membrane.
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
}

/// **The member functions**, each called the way its catalogue entry says it is written.
#[test]
fn the_member_functions_are_reached_on_the_values_that_carry_them() {
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
        "every member function this arm catalogues needs a call in the programs above"
    );
}

/// **The documentation module**, driven from Kotlin's own spellings.
#[test]
fn the_documentation_module_is_reached_from_kotlins_own_spellings() {
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
            // `substrate::use_is_refused_and_try_finally_is_what_a_program_writes`.
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

// ---------------------------------------------------------------------------------------------
// What a successful call hands a Kotlin program back, and what a program catches when one fails
// ---------------------------------------------------------------------------------------------

/// **Compile and run one Kotlin program under a run that offers everything and fails every call.**
///
/// The other half of the [crossing table](crossings): that table is the argument-lowering gate, and
/// this is the gate on what comes *back*. Every runtime failure a well-typed Kotlin call can meet is
/// a [`ToolFailure`] gg's own tool implementation raises, so the arm's job is to lower it onto the
/// `gg.core.ApiError` a program catches — under the operation's own name, carrying gg's own words.
///
/// A responder that fails *every* call is the right shape here because each of these programs makes
/// exactly one, and it keeps a failure case to a program and its assertion.
fn fails_with(body: &str, failure: ToolFailure, detail: &str) -> (SandboxOutcome, CallLog) {
    fails_granting(body, &all_operations(), failure, detail)
}

/// [`fails_with`] with the grant said out loud, so a refusal case can offer exactly the operation it
/// is about and nothing else — and prove the refusal rather than the grant.
fn fails_granting(
    body: &str,
    operations: &[crate::sandbox::operations::OperationId],
    failure: ToolFailure,
    detail: &str,
) -> (SandboxOutcome, CallLog) {
    let message = detail.to_string();
    run_with(body, operations, move |_name: &str, _args: &Value| {
        ToolOutcome::failed(failure, message.clone())
    })
}

/// A responder answering **every** call with one sidecar — the payloads [`canned_outcome`]'s single
/// row per tool cannot carry, each of them a success rather than a failure.
fn sidecar(data: ApiData) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |_name: &str, _args: &Value| {
        ToolOutcome::ok("answered", "answered").with_data(data.clone())
    }
}

/// A responder answering every call successfully and carrying **no** structured result at all.
///
/// The one way a program reaches the membrane's `missing_data` path: the sidecars the context and
/// delegation families read are attached by the loop rather than by a tool, so "the tool said yes
/// and produced nothing" is a real shape and is reported to the program as gg's own defect.
fn without_sidecar(_name: &str, _args: &Value) -> ToolOutcome {
    ToolOutcome::ok("answered", "answered")
}

/// **The body of a failure case's program**: make the call, and log the class and the operation of
/// the failure it came back with.
///
/// The successful path logs rather than throwing so a case that wrongly *succeeded* fails on the
/// assertion with the reason visible, instead of on a trap the reader has to decode.
fn caught(call: &str) -> String {
    format!(
        "try {{\n\
         \x20   {call}\n\
         \x20   gg.log(\"it succeeded\")\n\
         }} catch (failure: gg.core.ApiError) {{\n\
         \x20   gg.log(\"${{failure.code}} on ${{failure.operation}}\")\n\
         }}\n"
    )
}

/// [`caught`], logging gg's own sentence too — for the cases where gg puts in it the one thing the
/// program needs to recover: how many times an ambiguous edit matched, which skills do exist.
fn caught_with_message(call: &str) -> String {
    format!(
        "try {{\n\
         \x20   {call}\n\
         \x20   gg.log(\"it succeeded\")\n\
         }} catch (failure: gg.core.ApiError) {{\n\
         \x20   gg.log(\"${{failure.code}} on ${{failure.operation}}: ${{failure.detail}}\")\n\
         }}\n"
    )
}

// --- shell -------------------------------------------------------------------------------------

#[test]
fn a_shell_run_hands_a_kotlin_program_its_exit_code_and_output() {
    let (outcome, log) = run_with(
        "val ran = gg.shell.run(\"npm test\", timeoutSecs = 5)\n\
         gg.log(\"${ran.exitCode} ${ran.output} ${ran.truncated}\")\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["0 ran `npm test` false"]);
    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "npm test", "timeout_secs": 5.0 }))
    );
}

#[test]
fn a_non_zero_shell_exit_is_a_value_a_kotlin_program_reads() {
    // The double answers `ok: false` with a full sidecar and NO failure classification for a command
    // saying `fail`, which is exactly what the real tool produces for a process that ran and exited
    // non-zero. The membrane has to turn that back into a value: a failing test suite is a fact to
    // branch on, not an exception — so the lines after the call still run.
    let (outcome, _log) = run_with(
        "val ran = gg.shell.run(\"npm test || fail\")\n\
         gg.log(ran.exitCode.toString())\n\
         gg.log(\"carried on\")\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1", "carried on"]);
}

#[test]
fn a_shell_timeout_reaches_a_kotlin_program_as_limit_exceeded() {
    let (outcome, log) = fails_with(
        &caught("gg.shell.run(\"sleep 600\", timeoutSecs = 1)"),
        ToolFailure::LimitExceeded,
        "shell: the command was killed after 1s",
    );
    assert_eq!(logs(&outcome), ["LIMIT_EXCEEDED on shell"]);
    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "sleep 600", "timeout_secs": 1.0 }))
    );
}

#[test]
fn a_shell_that_could_not_be_launched_is_an_io_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.shell.run(\"npm test\")"),
        ToolFailure::IoError,
        "shell: could not spawn `sh`",
    );
    assert_eq!(logs(&outcome), ["IO_ERROR on shell"]);
    // The timeout the program left out is gg's default rather than an absent key: the arm lowers the
    // absence onto the clamped number the membrane computed, which is what really reached dispatch.
    assert_eq!(
        log.args("shell"),
        Some(
            json!({ "command": "npm test", "timeout_secs": crate::tools::SHELL_DEFAULT_TIMEOUT_SECS })
        )
    );
}

#[test]
fn a_negative_shell_timeout_is_an_argument_error_in_kotlin() {
    // `timeoutSecs` is an `Int?`, so the type keeps nothing out here: a negative number is well
    // typed and names no duration, and the membrane's `clamp_timeout` refuses it BEFORE the tool is
    // reached — which is why the program reads an argument error and gg's dispatch saw nothing at
    // all.
    let (outcome, log) = run_with(
        &caught("gg.shell.run(\"npm test\", timeoutSecs = -4)"),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on shell"]);
    assert!(
        log.names().is_empty(),
        "a timeout naming no duration must not start a command"
    );
}

// --- files -------------------------------------------------------------------------------------

#[test]
fn an_image_read_reaches_a_kotlin_program_as_the_image_variant() {
    let (outcome, log) = run_with(
        "when (val read = gg.files.readFile(\"logo.png\")) {\n\
         \x20   is gg.files.ImageFile -> gg.log(\"${read.label} ${read.bytes} ${read.shown}\")\n\
         \x20   is gg.files.TextFile -> gg.log(\"the read was text\")\n\
         }\n",
        &all_operations(),
        canned_outcome,
    );
    // The bytes never enter the program: what a read hands over is gg's description of the picture,
    // and `shown` is `false` because a bare read places nothing in the window.
    assert_eq!(logs(&outcome), ["PNG 1234 false"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "logo.png", "offset": null, "limit": null }))
    );
}

#[test]
fn an_empty_path_read_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.readFile(\"\")"),
        ToolFailure::InvalidArgument,
        "read_file: `path` must not be empty",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "", "offset": null, "limit": null }))
    );
}

#[test]
fn a_write_hands_a_kotlin_program_the_byte_count() {
    let (outcome, log) = run_with(
        "gg.log(gg.files.writeFile(\"out.txt\", \"hello\").toString())\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["5"],
        "the count is UTF-8 bytes, not characters"
    );
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out.txt", "contents": "hello" }))
    );
}

#[test]
fn an_empty_path_write_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.writeFile(\"\", \"hello\")"),
        ToolFailure::InvalidArgument,
        "write_file: `path` must not be empty",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on write_file"]);
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "", "contents": "hello" }))
    );
}

#[test]
fn a_write_that_could_not_land_is_an_io_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.writeFile(\"out.txt\", \"hello\")"),
        ToolFailure::IoError,
        "write_file: permission denied",
    );
    assert_eq!(logs(&outcome), ["IO_ERROR on write_file"]);
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out.txt", "contents": "hello" }))
    );
}

#[test]
fn an_edit_that_succeeded_lets_a_kotlin_program_carry_on() {
    // The one file call that hands nothing back, so what a success looks like from inside a program
    // is the absence of a throw: the call reached gg's dispatch and the next line ran.
    let (outcome, log) = run_with(
        "gg.files.editFile(\"src/a.kt\", \"alpha\", \"beta\")\n\
         gg.log(\"carried on\")\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(log.names(), ["edit_file"]);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.kt", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn an_edit_whose_old_text_is_absent_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.editFile(\"src/a.kt\", \"gamma\", \"delta\")"),
        ToolFailure::NotFound,
        "edit_file: `gamma` does not appear in `src/a.kt`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on edit_file"]);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.kt", "old_string": "gamma", "new_string": "delta" }))
    );
}

#[test]
fn an_edit_whose_old_text_repeats_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught_with_message("gg.files.editFile(\"src/a.kt\", \"alpha\", \"beta\")"),
        ToolFailure::Conflict,
        "edit_file: `alpha` appears 3 times in `src/a.kt`; make it unique",
    );
    // The recovery is the COUNT, and it only exists in gg's sentence — so a program that cannot read
    // the message back cannot tell an ambiguous edit from any other conflict.
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("CONFLICT on edit_file: "), "{line}");
    assert!(line.contains("appears 3 times"), "{line}");
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.kt", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn a_listing_hands_a_kotlin_program_its_entries_and_their_kinds() {
    let (outcome, log) = run_with(
        "for (entry in gg.files.listDir(\"src\")) {\n\
         \x20   gg.log(\"${entry.name} ${entry.kind}\")\n\
         }\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["a.ts FILE", "b.test.ts FILE", "sub DIRECTORY"],
        "an entry is a name and a `gg.files.EntryKind`, not a line of rendered text"
    );
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "src" })));
}

#[test]
fn an_omitted_listing_path_lists_the_root_from_kotlin() {
    let (outcome, log) = run_with(
        "gg.log(gg.files.listDir().size.toString())\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["3"]);
    // The default argument crosses as the wire's own ABSENCE rather than as an empty string, which
    // is the one thing that separates "list the workspace root" from the argument error below.
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_listing_path_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.listDir(\"\")"),
        ToolFailure::InvalidArgument,
        "list_dir: `path` was given but empty",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on list_dir"]);
    // Writing the argument and leaving it out are two different calls, and they cross as two
    // different arguments: the empty string reaches dispatch and is refused there.
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "" })));
}

#[test]
fn a_listing_of_a_directory_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.listDir(\"gone\")"),
        ToolFailure::NotFound,
        "list_dir: no such directory: gone",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on list_dir"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "gone" })));
}

#[test]
fn a_tree_hands_a_kotlin_program_its_rendering() {
    let (outcome, log) = run_with(
        "gg.log(gg.files.tree(path = \"src\", depth = 3))\n",
        &all_operations(),
        canned_outcome,
    );
    // One block of text, indentation and trailing `/` included: a tree is rendered by gg and handed
    // over whole, not a structure the program reassembles.
    assert_eq!(logs(&outcome), ["a.ts\nb.test.ts\nsub/\n  c.ts"]);
    assert_eq!(log.args("tree"), Some(json!({ "path": "src", "depth": 3 })));
}

#[test]
fn a_tree_of_a_path_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.tree(path = \"gone\")"),
        ToolFailure::NotFound,
        "tree: no such path: gone",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on tree"]);
    assert_eq!(
        log.args("tree"),
        Some(json!({ "path": "gone", "depth": null }))
    );
}

#[test]
fn a_tree_of_something_that_is_not_a_directory_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.tree(path = \"src/a.kt\")"),
        ToolFailure::InvalidArgument,
        "tree: `src/a.kt` is a file, not a directory",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on tree"]);
    assert_eq!(
        log.args("tree"),
        Some(json!({ "path": "src/a.kt", "depth": null }))
    );
}

#[test]
fn a_tree_depth_of_zero_is_refused_before_it_is_dispatched_in_kotlin() {
    // The SDK's OWN guard, at `gg/files/Files.kt`. It is raised as the same `gg.core.ApiError` gg
    // would have raised, under the operation's own name, so a program catches a guest-side refusal
    // and a host-side one in one clause — and the round trip is never spent.
    let (outcome, log) = run_with(
        &caught("gg.files.tree(path = \"src\", depth = 0)"),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on tree"]);
    assert!(
        log.names().is_empty(),
        "a depth of zero must be refused inside the guest"
    );
}

#[test]
fn a_search_hands_a_kotlin_program_its_matches() {
    let (outcome, log) = run_with(
        "for (found in gg.files.search(\"answer\", path = \"src\")) {\n\
         \x20   gg.log(\"${found.path} ${found.line} ${found.text}\")\n\
         }\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["src/a.ts 3 const answer = 42;"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "src", "limit": null }))
    );
}

#[test]
fn a_blank_search_query_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.search(\"   \")"),
        ToolFailure::InvalidArgument,
        "search: `query` must not be blank",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on search"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "   ", "path": null, "limit": null }))
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.search(\"(unclosed\")"),
        ToolFailure::InvalidArgument,
        "search: `(unclosed` is not a valid regular expression: unclosed group",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on search"]);
    // A pattern is a string in every arm, so this is a runtime refusal here exactly as it is
    // everywhere else: no type keeps an unparseable regular expression out.
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "(unclosed", "path": null, "limit": null }))
    );
}

#[test]
fn a_search_limit_of_zero_is_refused_before_it_is_dispatched_in_kotlin() {
    // The second of this arm's two guest-side guards, at `gg/files/Files.kt`: a page of no matches
    // would answer nothing, so it never becomes a call.
    let (outcome, log) = run_with(
        &caught("gg.files.search(\"answer\", limit = 0)"),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on search"]);
    assert!(
        log.names().is_empty(),
        "a limit of zero must be refused inside the guest"
    );
}

#[test]
fn a_search_of_a_path_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.files.search(\"answer\", path = \"gone\")"),
        ToolFailure::NotFound,
        "search: no such path: gone",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on search"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "gone", "limit": null }))
    );
}

// --- skills ------------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_a_kotlin_program_the_skill_body() {
    let (outcome, log) = run_with(
        "gg.log(gg.skills.readSkill(\"testing\"))\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["the skill body"]);
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "testing" })));
}

#[test]
fn an_unknown_skill_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught_with_message("gg.skills.readSkill(\"nope\")"),
        ToolFailure::NotFound,
        "read_skill: no skill named `nope`; available skills: testing",
    );
    // The recovery is in the message — the list of names that DO exist, phrased the way the membrane
    // phrases it — and a program has to be able to read it back to ask for a real one.
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("NOT_FOUND on read_skill: "), "{line}");
    assert!(line.contains("available skills: testing"), "{line}");
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "nope" })));
}

// --- memories ----------------------------------------------------------------------------------

/// The three budget fields every memory mutation hands back, logged in one line.
const MEMORY_USAGE: &str = "gg.log(\"${usage.count} ${usage.maxCount} ${usage.totalChars}\")\n";

#[test]
fn a_memory_write_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val usage = gg.memories.writeMemory(\"layout\", \"where things are\", \
             \"the crate map\")\n{MEMORY_USAGE}"
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
    assert_eq!(
        log.args("write_memory"),
        Some(json!({ "name": "layout", "description": "where things are",
                     "body": "the crate map", "code": null, "onUse": null }))
    );
}

#[test]
fn a_duplicate_memory_name_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.writeMemory(\"layout\", \"d\", \"b\")"),
        ToolFailure::Conflict,
        "write_memory: a memory named `layout` already exists",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on write_memory"]);
    assert_eq!(
        log.args("write_memory"),
        Some(json!({ "name": "layout", "description": "d", "body": "b",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.writeMemory(\"layout\", \"d\", \"b\")"),
        ToolFailure::LimitExceeded,
        "write_memory: the body would take this run past its 4000-character budget",
    );
    assert_eq!(logs(&outcome), ["LIMIT_EXCEEDED on write_memory"]);
    assert_eq!(
        log.args("write_memory"),
        Some(json!({ "name": "layout", "description": "d", "body": "b",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn a_memory_update_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val usage = gg.memories.updateMemory(\"layout\", \"d2\", \"b2\")\n{MEMORY_USAGE}"
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
    assert_eq!(
        log.args("update_memory"),
        Some(json!({ "name": "layout", "description": "d2", "body": "b2",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn an_update_of_a_memory_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.updateMemory(\"gone\", \"d\", \"b\")"),
        ToolFailure::NotFound,
        "update_memory: no memory named `gone`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on update_memory"]);
    assert_eq!(
        log.args("update_memory"),
        Some(json!({ "name": "gone", "description": "d", "body": "b",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn a_memory_creation_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val usage = gg.memories.createMemory(\"layout\", \"where things are\", \
             \"the crate map\")\n{MEMORY_USAGE}"
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
    // The crossing table's point, kept here beside the value that comes back: this is the ONE write
    // whose body lowers onto `contents` rather than onto `body`, and the Kotlin argument is `body`
    // in both — so a program reads one spelling and gg reads two.
    assert_eq!(
        log.args("create_memory"),
        Some(json!({ "name": "layout", "description": "where things are",
                     "contents": "the crate map", "code": null, "onUse": null }))
    );
}

#[test]
fn a_duplicate_memory_slug_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.createMemory(\"layout\", \"d\", \"b\")"),
        ToolFailure::Conflict,
        "create_memory: a memory named `layout` already exists",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on create_memory"]);
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn memory_contents_over_the_cap_are_limit_exceeded_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.createMemory(\"layout\", \"d\", \"b\")"),
        ToolFailure::LimitExceeded,
        "create_memory: the index entry would take this run past its index budget",
    );
    assert_eq!(logs(&outcome), ["LIMIT_EXCEEDED on create_memory"]);
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_read_of_a_memory_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.readMemory(\"gone\")"),
        ToolFailure::NotFound,
        "read_memory: no memory named `gone`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on read_memory"]);
    assert_eq!(log.args("read_memory"), Some(json!({ "name": "gone" })));
}

#[test]
fn a_memory_edit_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val usage = gg.memories.editMemory(\"layout\", \"old\", \"new\")\n{MEMORY_USAGE}"
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn an_edit_whose_text_is_absent_from_a_memory_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.editMemory(\"layout\", \"gamma\", \"delta\")"),
        ToolFailure::NotFound,
        "edit_memory: `gamma` does not appear in `layout`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on edit_memory"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "gamma", "new_string": "delta" }))
    );
}

#[test]
fn an_edit_whose_text_repeats_in_a_memory_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught_with_message("gg.memories.editMemory(\"layout\", \"old\", \"new\")"),
        ToolFailure::Conflict,
        "edit_memory: `old` appears 2 times in `layout`; make it unique",
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("CONFLICT on edit_memory: "), "{line}");
    assert!(line.contains("appears 2 times"), "{line}");
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn an_edit_that_would_overrun_a_memory_is_limit_exceeded_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.editMemory(\"layout\", \"old\", \"new\")"),
        ToolFailure::LimitExceeded,
        "edit_memory: the result would take this run past its 4000-character budget",
    );
    assert_eq!(logs(&outcome), ["LIMIT_EXCEEDED on edit_memory"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn an_edit_that_would_empty_a_memory_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.editMemory(\"layout\", \"the whole body\", \"\")"),
        ToolFailure::InvalidArgument,
        "edit_memory: the edit would leave `layout` empty; delete it instead",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on edit_memory"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "the whole body", "new_string": "" }))
    );
}

#[test]
fn a_memory_hit_hands_a_kotlin_program_its_ranking() {
    let (outcome, log) = run_with(
        "val hit = gg.memories.searchMemories(\"cargo\", \"nextest\")[0]\n\
         gg.log(\"${hit.name} ${hit.description} ${hit.matched} ${hit.occurrences} \
         ${hit.excerpt}\")\n",
        &all_operations(),
        canned_outcome,
    );
    // The ranking numbers and the window are what let a program choose which hit to read; the hit's
    // own `read()` is driven by the member-function case above.
    assert_eq!(
        logs(&outcome),
        ["build-commands How to build 2 3 …cargo nextest run --workspace…"]
    );
    assert_eq!(
        log.args("search_memories"),
        Some(json!({ "keywords": ["cargo", "nextest"] }))
    );
}

#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_list_in_kotlin() {
    let (outcome, _log) = run_with(
        "val hits = gg.memories.searchMemories(\"nothing\")\n\
         gg.log(\"${hits.size} ${hits.isEmpty()}\")\n",
        &all_operations(),
        |name: &str, _args: &Value| {
            assert_eq!(name, "search_memories");
            ToolOutcome::ok("0 of 1 memories match", "searched memories")
                .with_data(ApiData::MemoryHits(Vec::new()))
        },
    );
    // Nothing matched is a list with nothing in it, never a failure — so a program that searches
    // before it reads does not have to catch anything to find out.
    assert_eq!(logs(&outcome), ["0 true"]);
}

#[test]
fn a_memory_search_of_empty_keywords_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.searchMemories(\"\", \"   \")"),
        ToolFailure::InvalidArgument,
        "search_memories: every keyword was empty",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on search_memories"]);
    assert_eq!(
        log.args("search_memories"),
        Some(json!({ "keywords": ["", "   "] }))
    );
}

#[test]
fn a_memory_deletion_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        &format!("val usage = gg.memories.deleteMemory(\"layout\")\n{MEMORY_USAGE}"),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn a_deletion_of_a_memory_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.memories.deleteMemory(\"gone\")"),
        ToolFailure::NotFound,
        "delete_memory: no memory named `gone`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on delete_memory"]);
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "gone" })));
}

// --- tasks -------------------------------------------------------------------------------------

#[test]
fn adding_a_task_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        "val usage = gg.tasks.addTask(\"t1\", \"Parse the manifest\", \"D\", listOf(\"t0\"))\n\
         gg.log(\"${usage.count} ${usage.maxTasks}\")\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 20"]);
    assert_eq!(
        log.args("add_task"),
        Some(
            json!({ "id": "t1", "title": "Parse the manifest", "description": "D",
                     "blockedBy": ["t0"] })
        )
    );
}

#[test]
fn a_duplicate_task_id_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.tasks.addTask(\"t1\", \"T\")"),
        ToolFailure::Conflict,
        "add_task: a task `t1` already exists",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t1", "title": "T", "description": null, "blockedBy": [] }))
    );
}

#[test]
fn a_task_edge_that_would_close_a_cycle_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.tasks.addTask(\"t1\", \"T\", blockedBy = listOf(\"t2\"))"),
        ToolFailure::Conflict,
        "add_task: `t1` blocked on `t2` would close a cycle",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t1", "title": "T", "description": null, "blockedBy": ["t2"] }))
    );
}

#[test]
fn an_update_of_a_task_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.tasks.updateTask(\"gone\", title = \"T2\")"),
        ToolFailure::NotFound,
        "update_task: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on update_task"]);
    // The two fields the call never named keep what they had, which gg's schema spells as an absent
    // key — so a failed patch is still the patch the program wrote.
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "gone", "title": "T2", "status": null }))
    );
}

#[test]
fn re_blocking_a_task_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.tasks.setBlockedBy(\"gone\", \"t0\")"),
        ToolFailure::NotFound,
        "set_blocked_by: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "gone", "blockedBy": ["t0"] }))
    );
}

#[test]
fn a_blocker_set_that_would_close_a_cycle_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.tasks.setBlockedBy(\"t1\", \"t2\")"),
        ToolFailure::Conflict,
        "set_blocked_by: `t1` blocked on `t2` would close a cycle",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t2"] }))
    );
}

#[test]
fn completing_a_task_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.tasks.completeTask(\"gone\")"),
        ToolFailure::NotFound,
        "complete_task: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on complete_task"]);
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "gone" })));
}

#[test]
fn removing_a_task_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        "val usage = gg.tasks.removeTask(\"t1\")\n\
         gg.log(\"${usage.count} ${usage.maxTasks}\")\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 20"]);
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn removing_a_task_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.tasks.removeTask(\"gone\")"),
        ToolFailure::NotFound,
        "remove_task: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on remove_task"]);
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "gone" })));
}

// --- board -------------------------------------------------------------------------------------

/// The four board-budget fields every board call hands back, logged off a named `board`.
const BOARD_USAGE: &str = "${board.epics} ${board.maxEpics} ${board.issues} ${board.maxIssues}";

#[test]
fn creating_an_epic_hands_a_kotlin_program_its_id_and_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val epic = gg.board.createEpic(\"epc\", \"E\", \"D\")\n\
             val board = epic.board\n\
             gg.log(\"${{epic.id}} {BOARD_USAGE}\")\n"
        ),
        &all_operations(),
        canned_outcome,
    );
    // The id is the board's to mint — the prefix upper-cased — and it comes back beside the budget,
    // which is what a program needs to decide whether to open the next one.
    assert_eq!(logs(&outcome), ["EPIC 1 4 3 20"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epc", "title": "E", "description": "D" }))
    );
}

#[test]
fn an_epic_prefix_under_three_letters_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.createEpic(\"ep\", \"E\", \"D\")"),
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be 3-6 letters",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "ep", "title": "E", "description": "D" }))
    );
}

#[test]
fn an_epic_prefix_over_six_letters_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.createEpic(\"epicical\", \"E\", \"D\")"),
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be 3-6 letters",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epicical", "title": "E", "description": "D" }))
    );
}

#[test]
fn an_epic_prefix_that_is_not_letters_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.createEpic(\"ep1\", \"E\", \"D\")"),
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be letters only",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "ep1", "title": "E", "description": "D" }))
    );
}

#[test]
fn an_epic_prefix_another_epic_holds_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.createEpic(\"epc\", \"E\", \"D\")"),
        ToolFailure::Conflict,
        "create_epic: an epic `EPC` already exists",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epc", "title": "E", "description": "D" }))
    );
}

#[test]
fn creating_an_issue_hands_a_kotlin_program_its_id_and_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val issue = gg.board.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\")\n\
             val board = issue.board\n\
             gg.log(\"${{issue.id}} {BOARD_USAGE}\")\n"
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["EPIC-1 1 4 3 20"]);
    assert_eq!(
        log.args("create_issue"),
        Some(json!({
            "title": "I",
            "description": null,
            "inScope": "s",
            "outOfScope": "o",
            "completionCriteria": "c",
            "blockedBy": [],
            "epicId": null,
            "agent": "worker",
            "reviewers": [],
        }))
    );
}

#[test]
fn an_issue_agent_that_cannot_be_assigned_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.createIssue(\"I\", \"s\", \"o\", \"c\", \"nobody\")"),
        ToolFailure::InvalidArgument,
        "create_issue: `nobody` is not an agent this session may assign",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on create_issue"]);
    assert_eq!(
        log.args("create_issue").map(|args| args["agent"].clone()),
        Some(json!("nobody"))
    );
}

#[test]
fn an_issue_reviewer_that_cannot_be_assigned_is_an_argument_error_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught(
            "gg.board.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\", \
             reviewers = listOf(\"nobody\"))",
        ),
        ToolFailure::InvalidArgument,
        "create_issue: `nobody` is not an agent this session may assign as a reviewer",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on create_issue"]);
    assert_eq!(
        log.args("create_issue")
            .map(|args| args["reviewers"].clone()),
        Some(json!(["nobody"]))
    );
}

#[test]
fn an_issue_blocker_that_would_close_a_cycle_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught(
            "gg.board.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\", \
             blockedBy = listOf(\"EPIC-2\"))",
        ),
        ToolFailure::Conflict,
        "create_issue: blocking on `EPIC-2` would close a cycle",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on create_issue"]);
    assert_eq!(
        log.args("create_issue")
            .map(|args| args["blockedBy"].clone()),
        Some(json!(["EPIC-2"]))
    );
}

#[test]
fn an_update_of_an_issue_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.updateIssue(\"GONE-1\", status = gg.board.IssueStatus.DONE)"),
        ToolFailure::NotFound,
        "update_issue: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on update_issue"]);
    assert_eq!(
        log.args("update_issue"),
        Some(json!({
            "id": "GONE-1",
            "title": null,
            "inScope": null,
            "outOfScope": null,
            "completionCriteria": null,
            "status": "done",
        }))
    );
}

#[test]
fn re_blocking_an_issue_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.setIssueBlockedBy(\"GONE-1\", \"EPIC-1\")"),
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "GONE-1", "blockedBy": ["EPIC-1"] }))
    );
}

#[test]
fn an_issue_edge_that_would_close_a_cycle_is_a_conflict_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.setIssueBlockedBy(\"EPIC-1\", \"EPIC-2\")"),
        ToolFailure::Conflict,
        "set_issue_blocked_by: `EPIC-1` blocked on `EPIC-2` would close a cycle",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "EPIC-1", "blockedBy": ["EPIC-2"] }))
    );
}

#[test]
fn removing_an_epic_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val board = gg.board.removeEpic(\"EPIC\")\n\
             gg.log(\"{BOARD_USAGE}\")\n"
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "EPIC" })));
}

#[test]
fn removing_an_epic_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.removeEpic(\"GONE\")"),
        ToolFailure::NotFound,
        "remove_epic: no epic `GONE`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on remove_epic"]);
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "GONE" })));
}

#[test]
fn removing_an_issue_hands_a_kotlin_program_its_budget() {
    let (outcome, log) = run_with(
        &format!(
            "val board = gg.board.removeIssue(\"EPIC-1\")\n\
             gg.log(\"{BOARD_USAGE}\")\n"
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "EPIC-1" })));
}

#[test]
fn removing_an_issue_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.removeIssue(\"GONE-1\")"),
        ToolFailure::NotFound,
        "remove_issue: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on remove_issue"]);
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "GONE-1" })));
}

#[test]
fn a_wait_is_registered_and_a_kotlin_program_runs_on() {
    // The surprising half of the call, and the one a model gets wrong: nothing blocks INSIDE the
    // program. The wait is registered, the call returns gg's acknowledgement at once, and the rest
    // of the program runs — the suspension happens after the turn ends.
    let (outcome, log) = run_with(
        "gg.log(\"before the wait\")\n\
         gg.log(gg.board.waitForIssue(\"i1\"))\n\
         gg.log(\"after the wait\")\n",
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["before the wait", "wait registered", "after the wait"],
        "a registered wait suspended the program instead of returning to it"
    );
    assert_eq!(log.names(), ["wait_for_issue"]);
    assert_eq!(log.args("wait_for_issue"), Some(json!({ "issueId": "i1" })));
}

#[test]
fn waiting_on_an_issue_that_is_not_there_is_not_found_in_kotlin() {
    let (outcome, log) = fails_with(
        &caught("gg.board.waitForIssue(\"GONE-1\")"),
        ToolFailure::NotFound,
        "wait_for_issue: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on wait_for_issue"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "GONE-1" }))
    );
}

// ---------------------------------------------------------------------------------------------
// The six session-side modules, driven from Kotlin programs that read their answers back
// ---------------------------------------------------------------------------------------------
//
// `context`, `delegation`, `programs`, `docs`, `views` and `session` — the modules whose effect is
// on the **session** rather than on the workspace. The crossing table above covers the first two,
// which are gg tools, and proves what gg's dispatch *saw*; it reads no value back and injects no
// failure. The other four are answered **inside the membrane**, which is why they are absent from
// it.
//
// So each case below is one short program of its own: a success reads the value back through
// `gg.log`, and a failure catches `gg.core.ApiError` and logs this arm's own word for the class
// beside gg's own name for the call — which is what a model branches on.
//
// A failure on a tool-backed call is injected through a responder ([`fails_granting`]). A failure on
// a membrane-answered call has no tool for a responder to fail, so it comes from one of four levers
// instead: the argument the program wrote, the scope the evaluation granted, a refusal armed on the
// double ([`evaluate_refusing`]), or a catalogue seeded on it ([`evaluate_cataloguing`]).

// --- context -----------------------------------------------------------------------------------

#[test]
fn an_evicted_file_view_reports_what_it_reclaimed() {
    let (outcome, log) = run_with(
        r#"val freed = gg.context.evictFileView("src/a.kt")
gg.log("${freed.items} ${freed.reclaimedTokens} ${freed.paths} ${freed.detail}")
"#,
        &[CONTEXT_EVICT_FILE_VIEW],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 300 [src/a.ts] dropped 2 items"]);
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.kt" }))
    );
}

/// The default argument is the whole of how a program says "every file view": the key is **absent**
/// rather than empty, because the empty string is the one spelling gg refuses.
#[test]
fn evicting_every_file_view_names_no_path() {
    let (outcome, log) = run_with(
        "gg.log(gg.context.evictFileView().items.toString())\n",
        &[CONTEXT_EVICT_FILE_VIEW],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_path_is_refused_rather_than_evicting_everything() {
    let (outcome, log) = fails_granting(
        &caught("gg.context.evictFileView(\"\")"),
        &[CONTEXT_EVICT_FILE_VIEW],
        ToolFailure::InvalidArgument,
        "evict_file_view: `path` must not be empty; leave it out to drop every file view",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on evict_file_view"]);
    // Writing the argument and leaving it out are two different calls: the empty string really
    // reaches gg's dispatch and is refused there.
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": "" })));
}

/// The reclaim sidecar is attached by the **loop** rather than by the tool, so "the call succeeded
/// and produced nothing" is a shape a program can really meet — and it is reported as gg's own
/// defect rather than as an empty report the program would act on.
#[test]
fn an_eviction_with_no_reclaim_report_is_a_missing_sidecar() {
    let (outcome, _log) = run_with(
        &caught_with_message("gg.context.evictFileView(\"src/a.kt\")"),
        &[CONTEXT_EVICT_FILE_VIEW],
        without_sidecar,
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("IO_ERROR on evict_file_view: "), "{line}");
    assert!(line.contains("gg defect"), "{line}");
}

#[test]
fn an_archived_span_reports_what_it_reclaimed() {
    let (outcome, log) = run_with(
        r#"val freed = gg.context.archiveThread(4..19, 30..<36)
gg.log("${freed.items} ${freed.reclaimedTokens} ${freed.paths.size} ${freed.detail}")
"#,
        &[CONTEXT_ARCHIVE_THREAD],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 300 1 dropped 2 items"]);
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19], [30, 35]] }))
    );
}

#[test]
fn archiving_no_spans_at_all_is_refused() {
    let (outcome, log) = fails_granting(
        &caught("gg.context.archiveThread()"),
        &[CONTEXT_ARCHIVE_THREAD],
        ToolFailure::InvalidArgument,
        "archive_thread: name at least one span of turns to archive",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on archive_thread"]);
    // The vararg with nothing in it is an empty list rather than an absent one: `archive_thread`
    // takes a list, so "no spans" is a request gg reads and refuses.
    assert_eq!(log.args("archive_thread"), Some(json!({ "ranges": [] })));
}

#[test]
fn archiving_more_than_thirty_two_spans_is_refused() {
    let spans = (0..33)
        .map(|turn| format!("{turn}..{turn}"))
        .collect::<Vec<_>>()
        .join(", ");
    let (outcome, log) = fails_granting(
        &caught(&format!("gg.context.archiveThread({spans})")),
        &[CONTEXT_ARCHIVE_THREAD],
        ToolFailure::InvalidArgument,
        "archive_thread: at most 32 spans may be archived in one call",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on archive_thread"]);
    assert_eq!(
        log.args("archive_thread")
            .and_then(|args| args["ranges"].as_array().map(Vec::len)),
        Some(33),
        "every span the program wrote reached gg's dispatch"
    );
}

#[test]
fn a_span_that_ends_before_it_starts_is_refused() {
    let (outcome, log) = fails_granting(
        &caught("gg.context.archiveThread(19..4)"),
        &[CONTEXT_ARCHIVE_THREAD],
        ToolFailure::InvalidArgument,
        "archive_thread: the range 19-4 ends before it starts",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on archive_thread"]);
    // The ends arrived in the order the range declares them, which is the only thing that makes
    // "ends before it starts" a statement about the program rather than about the lowering.
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[19, 4]] }))
    );
}

#[test]
fn an_archive_with_no_reclaim_report_is_a_missing_sidecar() {
    let (outcome, _log) = run_with(
        &caught("gg.context.archiveThread(4..19)"),
        &[CONTEXT_ARCHIVE_THREAD],
        without_sidecar,
    );
    assert_eq!(logs(&outcome), ["IO_ERROR on archive_thread"]);
}

#[test]
fn a_search_of_the_archive_reads_its_hits_back() {
    let (outcome, log) = run_with(
        r#"val found = gg.context.searchArchive("the parser")
val hit = found.hits[0]
gg.log("${found.archiveEmpty} ${hit.seq} ${hit.role} ${hit.text}")
gg.log((hit.role == gg.context.MessageRole.ASSISTANT).toString())
"#,
        &[CONTEXT_SEARCH_ARCHIVE],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["false 3 ASSISTANT the earlier answer", "true"],
        "the role arrived as this arm's own enum entry rather than as the wire's word"
    );
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the parser" }))
    );
}

#[test]
fn a_search_that_matches_nothing_is_an_empty_hit_list() {
    let (outcome, _log) = run_with(
        r#"val found = gg.context.searchArchive("the parser")
gg.log("${found.archiveEmpty} ${found.hits.size}")
"#,
        &[CONTEXT_SEARCH_ARCHIVE],
        sidecar(ApiData::ArchiveSearch(ArchiveSearchData {
            archive_empty: false,
            hits: Vec::new(),
        })),
    );
    // Nothing matched is a value, never a failure: a program that searches before it archives does
    // not have to catch anything to find out.
    assert_eq!(logs(&outcome), ["false 0"]);
}

/// The reason the envelope carries a flag at all: a program told only "no hits" would archive its
/// thread a second time believing the first had failed.
#[test]
fn an_empty_archive_is_told_apart_from_no_match() {
    let (outcome, _log) = run_with(
        r#"val found = gg.context.searchArchive("the parser")
gg.log("${found.archiveEmpty} ${found.hits.size}")
"#,
        &[CONTEXT_SEARCH_ARCHIVE],
        sidecar(ApiData::ArchiveSearch(ArchiveSearchData {
            archive_empty: true,
            hits: Vec::new(),
        })),
    );
    assert_eq!(logs(&outcome), ["true 0"]);
}

#[test]
fn an_empty_archive_query_is_refused() {
    let (outcome, log) = fails_granting(
        &caught("gg.context.searchArchive(\"\")"),
        &[CONTEXT_SEARCH_ARCHIVE],
        ToolFailure::InvalidArgument,
        "search_archive: `query` must not be empty",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on search_archive"]);
    assert_eq!(log.args("search_archive"), Some(json!({ "query": "" })));
}

#[test]
fn a_search_with_no_archive_payload_is_a_missing_sidecar() {
    let (outcome, _log) = run_with(
        &caught("gg.context.searchArchive(\"the parser\")"),
        &[CONTEXT_SEARCH_ARCHIVE],
        without_sidecar,
    );
    assert_eq!(logs(&outcome), ["IO_ERROR on search_archive"]);
}

/// A compaction is **registered**, not performed: the call returns, the program carries on, and the
/// loop rewrites the window once the turn has ended.
#[test]
fn a_compaction_is_registered_and_the_program_carries_on() {
    let (outcome, log) = run_with(
        r#"gg.context.compact("scaffolded the page", "src/Main.kt")
gg.log("carried on")
"#,
        &[CONTEXT_COMPACT],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "scaffolded the page", "files": ["src/Main.kt"] }))
    );
}

#[test]
fn a_blank_compaction_summary_is_refused() {
    let (outcome, log) = fails_granting(
        &caught("gg.context.compact(\"   \")"),
        &[CONTEXT_COMPACT],
        ToolFailure::InvalidArgument,
        "compact: `summary` must not be blank",
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on compact"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "   ", "files": [] }))
    );
}

// --- delegation --------------------------------------------------------------------------------

#[test]
fn a_spawned_child_hands_back_its_own_handle() {
    let (outcome, _log) = run_with(
        r#"val child = gg.delegation.spawnSubagent("subagent", gg.delegation.Brief.Prompt("write the lexer"))
gg.log("${child.id} ${child.slot} ${child.modelId}")
"#,
        &[DELEGATION_SPAWN_SUBAGENT],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-1 primary test/model"]);
}

/// The brief's other case, which the crossing table leaves undriven: an issue id crosses under its
/// own key with **no prompt beside it**, rather than the two being optional strings a program could
/// fill in together.
#[test]
fn a_child_can_be_briefed_with_an_issue() {
    let (outcome, log) = run_with(
        "gg.log(gg.delegation.spawnSubagent(\"subagent\", gg.delegation.Brief.Issue(\"EPIC-1\")).id)\n",
        &[DELEGATION_SPAWN_SUBAGENT],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": null, "issueId": "EPIC-1" }))
    );
}

#[test]
fn a_spawn_past_the_delegation_depth_cap_is_refused() {
    let (outcome, _log) = fails_granting(
        &caught(
            "gg.delegation.spawnSubagent(\"subagent\", gg.delegation.Brief.Prompt(\"write the lexer\"))",
        ),
        &[DELEGATION_SPAWN_SUBAGENT],
        ToolFailure::LimitExceeded,
        "spawn_subagent: this run's delegation depth cap of 2 is already reached",
    );
    assert_eq!(logs(&outcome), ["LIMIT_EXCEEDED on spawn_subagent"]);
}

#[test]
fn an_agent_this_session_may_not_spawn_is_refused() {
    let (outcome, log) = fails_granting(
        &caught_with_message(
            "gg.delegation.spawnSubagent(\"nope\", gg.delegation.Brief.Prompt(\"write the lexer\"))",
        ),
        &[DELEGATION_SPAWN_SUBAGENT],
        ToolFailure::InvalidArgument,
        "spawn_subagent: this run may not spawn `nope`; agents it may spawn: subagent",
    );
    // The recovery is the list of agents that DO exist, and it lives only in gg's sentence.
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("INVALID_ARGUMENT on spawn_subagent: "),
        "{line}"
    );
    assert!(line.contains("agents it may spawn: subagent"), "{line}");
    assert_eq!(
        log.args("spawn_subagent").map(|args| args["agent"].clone()),
        Some(json!("nope"))
    );
}

#[test]
fn a_spawn_with_no_handle_is_a_missing_sidecar() {
    let (outcome, _log) = run_with(
        &caught(
            "gg.delegation.spawnSubagent(\"subagent\", gg.delegation.Brief.Prompt(\"write the lexer\"))",
        ),
        &[DELEGATION_SPAWN_SUBAGENT],
        without_sidecar,
    );
    assert_eq!(logs(&outcome), ["IO_ERROR on spawn_subagent"]);
}

#[test]
fn a_waited_child_reports_its_id_status_and_summary() {
    let (outcome, log) = run_with(
        r#"val first = gg.delegation.waitForSubagents("agent-1")[0]
gg.log("${first.id} ${first.status} ${first.summary}")
gg.log((first.status == gg.delegation.AgentEnding.COMPLETED).toString())
"#,
        &[DELEGATION_WAIT_FOR_SUBAGENTS],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-1 COMPLETED did the work", "true"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

/// Naming none is the **absent** list rather than an empty one: gg reads an absent `ids` as "every
/// child still outstanding" and a list as "exactly these", so an empty vararg lowered as a list
/// would ask gg to wait for nothing at all.
#[test]
fn waiting_for_every_child_names_no_ids() {
    let (outcome, log) = run_with(
        "gg.log(gg.delegation.waitForSubagents().size.toString())\n",
        &[DELEGATION_WAIT_FOR_SUBAGENTS],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

/// A child that produced no recognisable ending reports **no** status: a `null` the program branches
/// on, rather than an entry it would read and be wrong about.
#[test]
fn a_child_with_no_ending_reports_a_null_status() {
    let (outcome, _log) = run_with(
        r#"val first = gg.delegation.waitForSubagents()[0]
gg.log("${first.id} ${first.status} ${first.summary}")
"#,
        &[DELEGATION_WAIT_FOR_SUBAGENTS],
        sidecar(ApiData::SubagentResults(vec![SubagentResultData {
            id: "agent-9".to_string(),
            status: None,
            summary: "it said this much".to_string(),
        }])),
    );
    assert_eq!(logs(&outcome), ["agent-9 null it said this much"]);
}

/// **Every ending, as its own entry.** A word this arm failed to translate would fall through
/// `Read`'s `else` and read as `MODEL_ERROR`, which is a plausible-looking wrong answer rather than
/// a failure — so every one of the six is driven at once.
#[test]
fn every_agent_ending_reaches_its_kotlin_entry() {
    let endings = [
        AgentStatusData::Completed,
        AgentStatusData::Exhausted,
        AgentStatusData::TimedOut,
        AgentStatusData::ModelError,
        AgentStatusData::AuthError,
        AgentStatusData::LimitExceeded,
    ];
    let (outcome, _log) = run_with(
        r#"for (result in gg.delegation.waitForSubagents()) {
    gg.log(result.status.toString())
}
"#,
        &[DELEGATION_WAIT_FOR_SUBAGENTS],
        sidecar(ApiData::SubagentResults(
            endings
                .iter()
                .enumerate()
                .map(|(index, ending)| SubagentResultData {
                    id: format!("agent-{index}"),
                    status: Some(*ending),
                    summary: "did the work".to_string(),
                })
                .collect(),
        )),
    );
    assert_eq!(
        logs(&outcome),
        [
            "COMPLETED",
            "EXHAUSTED",
            "TIMED_OUT",
            "MODEL_ERROR",
            "AUTH_ERROR",
            "LIMIT_EXCEEDED",
        ]
    );
}

#[test]
fn waiting_on_an_id_nobody_issued_is_not_found() {
    let (outcome, log) = fails_granting(
        &caught("gg.delegation.waitForSubagents(\"agent-9\")"),
        &[DELEGATION_WAIT_FOR_SUBAGENTS],
        ToolFailure::NotFound,
        "wait_for_subagents: no child agent `agent-9`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on wait_for_subagents"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-9"] }))
    );
}

#[test]
fn a_wait_with_no_results_is_a_missing_sidecar() {
    let (outcome, _log) = run_with(
        &caught("gg.delegation.waitForSubagents()"),
        &[DELEGATION_WAIT_FOR_SUBAGENTS],
        without_sidecar,
    );
    assert_eq!(logs(&outcome), ["IO_ERROR on wait_for_subagents"]);
}

#[test]
fn a_message_reaches_a_running_child() {
    let (outcome, log) = run_with(
        r#"gg.delegation.sendMessage("agent-1", "prefer the simpler parser")
gg.log("carried on")
"#,
        &[DELEGATION_SEND_MESSAGE],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(log.names(), ["send_message"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn messaging_an_agent_that_does_not_exist_is_not_found() {
    let (outcome, log) = fails_granting(
        &caught("gg.delegation.sendMessage(\"agent-9\", \"prefer the simpler parser\")"),
        &[DELEGATION_SEND_MESSAGE],
        ToolFailure::NotFound,
        "send_message: no agent `agent-9`",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on send_message"]);
    assert_eq!(
        log.args("send_message").map(|args| args["agentId"].clone()),
        Some(json!("agent-9"))
    );
}

#[test]
fn messaging_a_child_that_has_returned_is_a_conflict() {
    let (outcome, _log) = fails_granting(
        &caught("gg.delegation.sendMessage(\"agent-1\", \"prefer the simpler parser\")"),
        &[DELEGATION_SEND_MESSAGE],
        ToolFailure::Conflict,
        "send_message: `agent-1` has already returned",
    );
    assert_eq!(logs(&outcome), ["CONFLICT on send_message"]);
}

/// A transition is **registered**, not performed: the call validates the target and returns, and the
/// next state's agent is stood up once the program has ended.
#[test]
fn a_transition_is_registered_and_the_program_carries_on() {
    let (outcome, log) = run_with(
        r#"gg.delegation.transitionState("verify", note = "the build is green")
gg.log("carried on")
"#,
        &[DELEGATION_TRANSITION_STATE],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "verify", "note": "the build is green" }))
    );
    assert_eq!(
        outcome
            .tool_calls
            .iter()
            .map(|call| (call.name.as_str(), call.ok))
            .collect::<Vec<_>>(),
        [("delegation.transition_state", true)],
        "the move is on the turn's own roster, under the name the model wrote"
    );
}

#[test]
fn a_transition_without_a_note_sends_none() {
    let (outcome, log) = run_with(
        r#"gg.delegation.transitionState("verify")
gg.log("carried on")
"#,
        &[DELEGATION_TRANSITION_STATE],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "verify", "note": null }))
    );
}

#[test]
fn a_state_this_session_may_not_move_to_is_refused() {
    let (outcome, _log) = fails_granting(
        &caught_with_message("gg.delegation.transitionState(\"nowhere\")"),
        &[DELEGATION_TRANSITION_STATE],
        ToolFailure::InvalidArgument,
        "transition_state: `verify` is the only state this one has an edge to",
    );
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("INVALID_ARGUMENT on transition_state: "),
        "{line}"
    );
    assert!(line.contains("`verify`"), "{line}");
}

/// **The one `Binding::Machine` row of the whole vocabulary.** A transition is bought by where the
/// instance *stands* rather than by anything a configuration says, so an agent standing in no
/// machine state has nothing it could do to acquire it — and is told only that the call is not
/// available, which is the whole of what is true.
#[test]
fn an_agent_standing_in_no_machine_state_is_told_the_transition_is_unavailable() {
    let (outcome, log) = run_with(
        &caught_with_message("gg.delegation.transitionState(\"verify\")"),
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["UNAVAILABLE on transition_state: `gg.delegation.transitionState` is not available."],
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "delegation.transition_state"),
        "a positional refusal is on the roster: {:?}",
        outcome
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>()
    );
}

/// **The first succession in a turn stands.** A silently replaced one would be a change the model
/// cannot see, so the second declaration is refused and the program is told which call it was.
#[test]
fn a_transition_after_an_exec_is_refused_and_the_first_succession_stands() {
    let (outcome, log) = run_with(
        &format!(
            "gg.delegation.exec(\"Builder\")\n{}gg.log(\"carried on\")\n",
            caught("gg.delegation.transitionState(\"verify\")")
        ),
        &[DELEGATION_EXEC, DELEGATION_TRANSITION_STATE],
        |name: &str, args: &Value| match name {
            "transition_state" => ToolOutcome::failed(
                ToolFailure::Refused,
                "this session already declared a succession this turn".to_string(),
            ),
            _ => canned_outcome(name, args),
        },
    );
    assert_eq!(
        logs(&outcome),
        ["REFUSED on transition_state", "carried on"]
    );
    assert_eq!(
        log.names(),
        ["exec", "transition_state"],
        "both reached gg's dispatch; it is the second gg declined"
    );
    assert_eq!(
        outcome
            .tool_calls
            .iter()
            .map(|call| (call.name.as_str(), call.ok))
            .collect::<Vec<_>>(),
        [
            ("delegation.exec", true),
            ("delegation.transition_state", false)
        ],
        "the succession the first call declared is the one the roster records as accepted"
    );
}

#[test]
fn an_exec_is_registered_and_the_program_runs_to_its_end() {
    let (outcome, log) = run_with(
        r#"gg.delegation.exec("Builder", prompt = "pick it up from here")
gg.log("carried on")
"#,
        &[DELEGATION_EXEC],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": "pick it up from here" }))
    );
}

#[test]
fn an_exec_without_a_prompt_sends_none() {
    let (outcome, log) = run_with(
        r#"gg.delegation.exec("Builder")
gg.log("carried on")
"#,
        &[DELEGATION_EXEC],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": null }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_refused() {
    let (outcome, _log) = fails_granting(
        &caught_with_message("gg.delegation.exec(\"nope\")"),
        &[DELEGATION_EXEC],
        ToolFailure::InvalidArgument,
        "exec: this run may not become `nope`; agents it may become: Builder",
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("INVALID_ARGUMENT on exec: "), "{line}");
    assert!(line.contains("agents it may become: Builder"), "{line}");
}

/// The copy's handle comes back **immediately** even though the copy itself is dispatched when the
/// turn closes, so the program can name it and carry on.
#[test]
fn a_fork_hands_back_the_copys_handle_immediately() {
    let (outcome, _log) = run_with(
        r#"val copy = gg.delegation.fork("try the other fix")
gg.log("${copy.id} ${copy.slot} ${copy.modelId}")
gg.log("carried on")
"#,
        &[DELEGATION_FORK],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-2 primary test/model", "carried on"]);
}

#[test]
fn a_fork_past_the_delegation_depth_cap_is_refused() {
    let (outcome, log) = fails_granting(
        &caught("gg.delegation.fork(\"try the other fix\")"),
        &[DELEGATION_FORK],
        ToolFailure::LimitExceeded,
        "fork: this run's delegation depth cap of 2 is already reached",
    );
    assert_eq!(logs(&outcome), ["LIMIT_EXCEEDED on fork"]);
    assert_eq!(
        log.args("fork"),
        Some(json!({ "prompt": "try the other fix" }))
    );
}

#[test]
fn a_fork_with_no_handle_is_a_missing_sidecar() {
    let (outcome, _log) = run_with(
        &caught("gg.delegation.fork(\"try the other fix\")"),
        &[DELEGATION_FORK],
        without_sidecar,
    );
    assert_eq!(logs(&outcome), ["IO_ERROR on fork"]);
}

// --- programs ----------------------------------------------------------------------------------

/// The source the library cases seed the double with — one line, so the two counts a summary reports
/// are this string's own rather than a figure this file has to recompute.
const SEEDED_PROGRAM: &str = "gg.log(\"the program that ran\")\n";

#[test]
fn a_seeded_history_reports_each_programs_id_and_turn() {
    let (outcome, _log) = evaluate_with_program(
        &prepare_program(
            r#"val first = gg.programs.history()[0]
gg.log("${first.id} ${first.turn} ${first.lines} ${first.chars} ${first.ok} ${first.error}")
"#,
        ),
        "p3",
        3,
        SEEDED_PROGRAM,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [format!("p3 3 1 {} true null", SEEDED_PROGRAM.len())]
    );
}

#[test]
fn a_history_call_without_a_library_is_unavailable() {
    let (outcome, log) = run_as(
        &caught("gg.programs.history()"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["UNAVAILABLE on history"]);
    assert!(
        log.names().is_empty(),
        "a library this run does not keep must never reach a tool: {:?}",
        log.names()
    );
}

#[test]
fn a_program_the_library_holds_is_fetched_by_id() {
    let (outcome, _log) = evaluate_with_program(
        &prepare_program("gg.log(gg.programs.get(\"p3\"))\n"),
        "p3",
        3,
        SEEDED_PROGRAM,
        canned_outcome,
    );
    // The bytes the library holds, newline and all: a fetch hands back what ran rather than a
    // rendering of it.
    assert_eq!(logs(&outcome), [SEEDED_PROGRAM]);
}

/// The miss names **what is held**, because an id the library never issued and an id it has since
/// let go are the same `NOT_FOUND` — and only the sentence tells a program which ids it could ask
/// for instead.
#[test]
fn a_fetch_that_names_no_held_id_says_what_is_held() {
    let (outcome, _log) = evaluate_with_program(
        &prepare_program(&caught_with_message("gg.programs.get(\"zzzz\")")),
        "p3",
        3,
        SEEDED_PROGRAM,
        canned_outcome,
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("NOT_FOUND on get: "), "{line}");
    assert!(line.contains("`p3` (turn 3)"), "{line}");
}

#[test]
fn a_fetch_without_a_library_is_unavailable() {
    let (outcome, log) = run_as(
        &caught("gg.programs.get(\"p3\")"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["UNAVAILABLE on get"]);
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn a_blank_rerun_source_is_refused() {
    let (outcome, _log) = run_as(
        &caught("gg.programs.rerun(\"   \")"),
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on rerun"]);
    assert!(
        outcome.rerun.is_none(),
        "a blank source is refused rather than handed to a compiler: {:?}",
        outcome.rerun
    );
}

/// **The first hand-over stands.** A silently replaced program would be a change the model cannot
/// see, which is the same argument that makes a succession first-wins.
#[test]
fn a_second_hand_over_is_refused_and_the_first_stands() {
    let (outcome, _log) = run_as(
        &format!(
            "gg.programs.rerun(\"gg.log(\\\"first\\\")\")\n{}",
            caught("gg.programs.rerun(\"gg.log(\\\"second\\\")\")")
        ),
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["REFUSED on rerun"]);
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("gg.log(\"first\")"),
        "the program that runs next is the one the first call named"
    );
}

/// A program that did not run to its end did not decide which program should run next either, so
/// the hand-over goes with it.
#[test]
fn a_hand_over_is_revoked_when_the_program_then_throws() {
    let (outcome, _log) = run_as(
        r#"gg.programs.rerun("gg.log(\"again\")")
gg.log("handed over")
throw RuntimeException("and then it fell over")
"#,
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert!(
        trap(&outcome).contains("and then it fell over"),
        "{}",
        trap(&outcome)
    );
    assert_eq!(outcome.logs, ["handed over"]);
    assert!(
        outcome.rerun.is_none(),
        "the replacement program was revoked: {:?}",
        outcome.rerun
    );
}

#[test]
fn a_rerun_without_a_library_is_unavailable() {
    let (outcome, _log) = run_as(
        &caught("gg.programs.rerun(\"gg.log(\\\"again\\\")\")"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["UNAVAILABLE on rerun"]);
    assert!(outcome.rerun.is_none(), "{:?}", outcome.rerun);
}

// --- docs --------------------------------------------------------------------------------------

/// Every part of a search may be left out and the parts given compose — but **all of them at once**
/// may not, which is the one shape the default arguments can produce that gg has no answer for.
#[test]
fn a_search_carrying_neither_a_query_nor_a_filter_is_refused() {
    let (outcome, log) = run_with(
        &caught_with_message("gg.docs.search()"),
        &[],
        canned_outcome,
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("INVALID_ARGUMENT on search: "), "{line}");
    assert!(
        line.contains("a search needs something to look for"),
        "{line}"
    );
    assert!(
        log.names().is_empty(),
        "a documentation search is not a tool call: {:?}",
        log.names()
    );
}

/// Named for the module rather than for the call, because `gg.files`' own search already holds
/// [`a_search_limit_of_zero_is_refused_before_it_is_dispatched_in_kotlin`] and a failing case has to
/// name itself.
#[test]
fn a_search_limit_of_zero_is_refused() {
    let (outcome, _log) = run_with(
        &caught_with_message("gg.docs.search(\"view\", limit = 0)"),
        &[],
        canned_outcome,
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("INVALID_ARGUMENT on search: "), "{line}");
    assert!(line.contains("would answer nothing"), "{line}");
}

#[test]
fn a_blanket_close_without_the_capability_is_unavailable() {
    let (outcome, log) = run_with(
        &caught("gg.docs.closeAll()"),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["UNAVAILABLE on close_all"]);
    assert!(log.names().is_empty(), "{:?}", log.names());
}

// --- views -------------------------------------------------------------------------------------

/// A view of a picture is the one way a picture enters the window, so — unlike a bare
/// `gg.files.readFile` — this one comes back saying it is **shown**.
#[test]
fn an_image_file_view_reads_back_as_the_image_variant() {
    let (outcome, _log) = run_with(
        r#"when (val shown = gg.views.openFile("logo.png")) {
    is gg.files.ImageFile -> gg.log("${shown.label} ${shown.bytes} ${shown.shown}")
    is gg.files.TextFile -> gg.log("the view came back as text")
}
"#,
        &[VIEWS_OPEN_FILE],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["PNG 1234 true"]);
}

/// The **read** is what fails, and nothing is opened when it does.
#[test]
fn opening_a_view_of_a_file_that_is_not_there_opens_nothing() {
    let (outcome, log) = fails_granting(
        &caught("gg.views.openFile(\"gone.md\")"),
        &[VIEWS_OPEN_FILE],
        ToolFailure::NotFound,
        "read_file: no such file: gone.md",
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on open_file"]);
    assert_eq!(
        log.names(),
        ["read_file"],
        "a view of a file is the read it dispatches"
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

/// The one value in a view's window the membrane deliberately declines to normalise: a zero offset
/// plainly means the first line, and a zero line cut names nothing.
#[test]
fn a_line_cut_of_zero_is_refused() {
    let (outcome, log) = run_with(
        &caught_with_message("gg.views.openFile(\"wide.md\", maxLineChars = 0)"),
        &[VIEWS_OPEN_FILE],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "INVALID_ARGUMENT on open_file: `maxLineChars` must be between 1 and 65536 (0 given); \
             omit it to leave lines whole"
        ]
    );
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "wide.md", "offset": null, "limit": null, "maxLineChars": 0 }))
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

#[test]
fn a_line_cut_over_the_ceiling_is_refused() {
    let (outcome, _log) = run_with(
        &caught_with_message("gg.views.openFile(\"wide.md\", maxLineChars = 65537)"),
        &[VIEWS_OPEN_FILE],
        canned_outcome,
    );
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("INVALID_ARGUMENT on open_file: "),
        "{line}"
    );
    assert!(line.contains("65537") && line.contains("65536"), "{line}");
}

/// A view of a file is the **read** it dispatches, bought by the same capability — so an agent that
/// may not read cannot open one either.
#[test]
fn a_run_without_read_file_cannot_open_a_file_view() {
    let (outcome, log) = run_with(
        &caught("gg.views.openFile(\"notes.md\")"),
        &all_operations_without(CAPABILITY_READ_FILE),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["UNAVAILABLE on open_file"]);
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

/// Opening a second view under a selector the window already carries **replaces** it rather than
/// piling a second copy on: a program that recomputes a summary and shows it again spends the
/// window once.
#[test]
fn re_opening_the_same_selector_supersedes_the_view_it_replaces() {
    let (outcome, _log) = run_with(
        r#"gg.views.openText("summary", "eight files, two failing")
gg.views.openText("summary", "eight files, none failing")
"#,
        &[],
        canned_outcome,
    );
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| (view.selector.as_str(), view.superseded))
            .collect::<Vec<_>>(),
        [("summary", false), ("summary", true)]
    );
}

#[test]
fn a_blank_text_view_label_is_refused() {
    let (outcome, log) = run_with(
        &caught_with_message("gg.views.openText(\"   \", \"eight files, two failing\")"),
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["INVALID_ARGUMENT on open_text: a view needs a non-empty label"]
    );
    assert!(
        log.names().is_empty(),
        "a text view is not a tool call: {:?}",
        log.names()
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

/// Nothing is silently truncated, so the cap is **named**: a program told only "too large" cannot
/// know what to show instead.
#[test]
fn a_text_view_body_over_the_ceiling_is_refused() {
    let (outcome, _log) = evaluate_refusing(
        &prepare_program(&caught_with_message(
            "gg.views.openText(\"summary\", \"eight files, two failing\")",
        )),
        &[],
        VIEWS_OPEN_TEXT,
        ToolFailure::LimitExceeded,
        "view body exceeds max size (70000 bytes; max 65536)",
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("LIMIT_EXCEEDED on open_text: "), "{line}");
    assert!(
        line.contains("70000") && line.contains("65536"),
        "the refusal names the size and the bound: {line}"
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

/// A ceiling distinct from the body's, and a much smaller one: a label is an index entry rather than
/// a page, so the number the program is told is not the one above.
#[test]
fn a_text_view_label_over_the_ceiling_is_refused() {
    let (outcome, _log) = evaluate_refusing(
        &prepare_program(&caught_with_message(
            "gg.views.openText(\"summary\", \"eight files, two failing\")",
        )),
        &[],
        VIEWS_OPEN_TEXT,
        ToolFailure::LimitExceeded,
        "label exceeds max length (201 bytes; max 200)",
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("LIMIT_EXCEEDED on open_text: "), "{line}");
    assert!(
        line.contains("201") && line.contains("200"),
        "the refusal names the label's own cap rather than the body's: {line}"
    );
}

#[test]
fn a_documentation_view_of_a_name_nothing_declares_is_not_found() {
    let (outcome, _log) = evaluate_cataloguing(
        &prepare_program(&caught_with_message(
            "gg.views.openDocsView(\"gg.files.readNothing\")",
        )),
        &[("gg.files.readFile", true)],
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("NOT_FOUND on open_docs_view: "), "{line}");
    assert!(line.contains("`gg.files.readNothing`"), "{line}");
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

/// A real catalogue name **outside this agent's scope** is `not-found` too, and the message is about
/// the binding rather than the spelling — a model told "no such name" would spend a turn correcting
/// a name that was already right. It stays `not-found` because telling it the call exists would be
/// telling it about a call it may not make.
#[test]
fn a_documentation_view_of_a_name_this_agent_does_not_bind_is_not_found() {
    let (outcome, _log) = evaluate_cataloguing(
        &prepare_program(&caught_with_message(
            "gg.views.openDocsView(\"gg.delegation.fork\")",
        )),
        &[("gg.files.readFile", true), ("gg.delegation.fork", false)],
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("NOT_FOUND on open_docs_view: "), "{line}");
    assert!(line.contains("this session does not bind it"), "{line}");
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

#[test]
fn a_blank_close_selector_is_refused() {
    let (outcome, _log) = run_with(
        &caught_with_message("gg.views.close(\"   \")"),
        &[VIEWS_CLOSE],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["INVALID_ARGUMENT on close: `view.close` needs a non-empty selector"]
    );
}

/// Closing what the program opened is managing the window, exactly as evicting a file view is, so it
/// is bought by the same capability — and withheld, the call reaches no implementation at all.
#[test]
fn a_run_without_agent_managed_context_cannot_close_a_view() {
    let (outcome, log) = run_with(
        &caught("gg.views.close(\"summary\")"),
        &all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["UNAVAILABLE on close"]);
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "views.close"),
        "a withheld capability is what the refusal roster counts: {:?}",
        outcome
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>()
    );
    assert!(
        outcome.views_closed.is_empty(),
        "{:?}",
        outcome.views_closed
    );
}

// --- session -----------------------------------------------------------------------------------

/// The summary becomes the session's whole answer to whoever asked for the work, so "I am done and
/// have nothing to say about it" is not an ending gg accepts on the model's behalf.
#[test]
fn a_blank_finish_summary_is_refused() {
    let (outcome, _log) = run_as(
        &caught_with_message("gg.session.finish(\"   \")"),
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("INVALID_ARGUMENT on finish: "), "{line}");
    // The sentence tells the model to call it again, and names the call in this arm's own spelling.
    assert!(line.contains("`gg.session.finish`"), "{line}");
    assert!(
        outcome.completion.is_none(),
        "the run is still open: {:?}",
        outcome.completion
    );
}

/// **The last declaration wins.** An ending is a flag the program sets and the loop reads once the
/// program has ended, so a program that refines its own summary keeps the one it finished with.
#[test]
fn a_later_finish_replaces_the_summary_it_stands_on() {
    let (outcome, _log) = run_as(
        r#"gg.session.finish("read the file")
gg.session.finish("read the file and fixed the parser")
"#,
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::Finished { summary }) if summary == "read the file and fixed the parser"
        ),
        "{:?}",
        outcome.completion
    );
    assert_eq!(
        outcome
            .completion
            .as_ref()
            .map(|completion| completion.superseded),
        Some(1),
        "and the one it stood on is counted rather than silently dropped"
    );
}

/// A program that did not run to its end did not decide it was finished either: the checks the
/// ending rests on never finished, so the ending goes with them.
#[test]
fn a_completion_is_revoked_when_the_program_then_throws() {
    let (outcome, _log) = run_as(
        r#"gg.session.finish("the work is done")
gg.log("declared")
throw RuntimeException("and then it fell over")
"#,
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert!(
        trap(&outcome).contains("and then it fell over"),
        "{}",
        trap(&outcome)
    );
    assert_eq!(outcome.logs, ["declared"]);
    assert!(
        outcome.completion.is_none(),
        "the ending was revoked: {:?}",
        outcome.completion
    );
}

/// A rejection is dispatched verbatim to the agent that has to fix the work, so an empty list would
/// send it back to re-read criteria it already believed it had met.
#[test]
fn a_rejection_with_no_changes_at_all_is_refused() {
    let (outcome, _log) = run_as(
        &caught_with_message("gg.session.requestChanges()"),
        &[],
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("INVALID_ARGUMENT on request_changes: "),
        "{line}"
    );
    // The alternative is named, in this arm's own spelling: work that needs nothing is approved.
    assert!(line.contains("`gg.session.approve`"), "{line}");
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
}

/// A distinct cause from the empty list, because blank entries are **dropped first**: a program that
/// built its list from a filter that matched nothing writes this shape rather than the one above.
#[test]
fn a_rejection_whose_every_change_is_blank_is_refused() {
    let (outcome, _log) = run_as(
        &caught("gg.session.requestChanges(\"   \", \"\")"),
        &[],
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["INVALID_ARGUMENT on request_changes"]);
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
}

// --- feedback ----------------------------------------------------------------------------------
//
// `gg.log` is the whole of this arm's spelling of `test-cabinet:gg/feedback`: `Gg.kt` calls
// `feedback.log`, and nothing in this arm's SDK or in gg's generated entry class reaches
// `note-return`, `report-deferred`, `report-error` or `report-module-error`. An uncaught failure is
// captured as the guest runtime's own trap rather than intercepted, `fun main()` returns nothing for
// `note-return` to note, and a module that fails is refused at prepare — so no module error can
// reach a running program.

/// **A logged line is the only value a program shows gg, and it is not part of the surface.** The
/// catalogue describes the capability modules and `gg.log` belongs to none of them, so the reflector
/// skips it rather than publishing a function no operation backs.
#[test]
fn a_logged_line_is_the_only_value_a_program_shows_gg() {
    let kotlin =
        crate::sandbox::language::language(test_cabinet_core::gg::GgProgramLanguage::Kotlin);
    let catalogued = crate::sandbox::catalogue_functions(kotlin);
    assert!(
        !catalogued
            .iter()
            .any(|function| function.fqn == "gg.log" || function.name == "log"),
        "`gg.log` is catalogued, so a model is being told it is part of the gg surface: {:?}",
        catalogued
            .iter()
            .map(|function| function.fqn)
            .collect::<Vec<_>>()
    );
    // And the modules it is not in: the catalogue's own list names the capability packages, and the
    // package `gg.log` lives in is not one of them.
    assert!(
        !crate::sandbox::catalogue_modules(kotlin)
            .iter()
            .any(|module| module.id == "log"),
        "the feedback channel is not a capability module"
    );
}

/// **An ordinary throw reaches the model as its runtime's own words**, at the model's own line —
/// the half of the failure story that is not a `gg.core.ApiError`, with what the program logged
/// before it still standing.
#[test]
fn an_ordinary_throw_reaches_the_model_as_its_runtimes_own_words() {
    let (outcome, log) = run_with(
        r#"gg.log("before")
throw IllegalStateException("the model's own message")
"#,
        &[],
        canned_outcome,
    );
    let reported = trap(&outcome);
    assert!(
        reported.contains("IllegalStateException") && reported.contains("the model's own message"),
        "the failure says what went wrong, in the runtime's own words: {reported}"
    );
    // Line 3: the `fun main()` `whole` wrote is line 1 and the `gg.log` is line 2.
    assert!(
        reported.contains("Program.kt:3"),
        "and where, at the model's own line: {reported}"
    );
    assert!(
        !reported.contains("gg.core.ApiError"),
        "nothing gg wrote is in the way of it: {reported}"
    );
    assert_eq!(outcome.logs, ["before"], "what ran before it still stands");
    assert!(log.names().is_empty(), "{:?}", log.names());
}
