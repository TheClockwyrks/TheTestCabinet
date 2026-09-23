//! **The Java arm's model-facing surface**, driven end to end through the real toolchain and the
//! real membrane: the hand-written SDK, the catalogue reflected out of its own Javadoc, and the
//! libraries this arm says a program may reach.
//!
//! # Why these are not in the substrate file
//!
//! Because they are a different claim. [`substrate`](super::substrate) asks whether Java runs here.
//! This asks whether the thing a model is **told** it may write is the thing the sandbox really
//! has — which is the only question a cross-language study rests on, and the one whose failure is
//! silent: an SDK and a catalogue that agree with each other and with nothing else are two green
//! test suites and an invalidated experiment.
//!
//! # How they are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, so each starts a JVM that loads
//! TeaVM, and every program in it costs a build through that JVM. A function groups the
//! programs that exercise one behaviour, so they share that cost; one that grows into the slow
//! end of the suite is split rather than extended.

use serde_json::{Value, json};

use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY,
    CAPABILITY_READ_FILE,
};

use super::compile::compile_program;
use super::substrate::{
    evaluate_as, evaluate_closing_docviews, evaluate_with_api, java_language, logs, prepare, trap,
};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::PrepareContext;
use crate::sandbox::export_names;
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_operations, all_operations_without, canned_outcome,
    typescript as typescript_language,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::operations::{DELEGATION_TRANSITION_STATE, OperationId};
use crate::sandbox::outcome::{ProgramErrorKind, SandboxOutcome};
use crate::tools::{
    AgentStatusData, ApiData, ArchiveSearchData, SubagentResultData, ToolFailure, ToolOutcome,
};

/// The catalogue this arm's build reflects, read as a document rather than through the language, because what
/// is asserted below is a property of the emitted JSON.
const SIGNATURES: &str = include_str!(concat!(env!("OUT_DIR"), "/signatures/java.signatures.json"));

/// The `java.*` types the bodies below name, and the line each is reached by.
///
/// Written down because **gg writes no import into a program**: what makes these bodies compile is
/// that the test wrote the lines a Java author would, and a table is where they are written. Each
/// gg class is looked up in the catalogue instead — see [`whole`].
const JAVA_TYPES: [(&str, &str); 14] = [
    ("ArrayList", "java.util.ArrayList"),
    ("Arrays", "java.util.Arrays"),
    ("BigDecimal", "java.math.BigDecimal"),
    ("Collections", "java.util.Collections"),
    ("Collectors", "java.util.stream.Collectors"),
    ("DateTimeFormatter", "java.time.format.DateTimeFormatter"),
    ("Function", "java.util.function.Function"),
    ("List", "java.util.List"),
    ("LocalDate", "java.time.LocalDate"),
    ("Map", "java.util.Map"),
    ("NumberFormat", "java.text.NumberFormat"),
    ("Optional", "java.util.Optional"),
    ("Pattern", "java.util.regex.Pattern"),
    ("Stream", "java.util.stream.Stream"),
];

/// **A whole Java program**, written the way a model writes one: an `import` line for every type
/// `body` names, then the class and the `main` this arm asks for.
///
/// The gg lines come out of the **catalogue**, which is the one place that publishes them, so a
/// body that compiles is a body whose published import line resolves. A name written in full — a
/// `java.nio.file.Files` — needs no line and gets none, which is why a dot in front of a name
/// disqualifies it.
fn whole(body: &str) -> String {
    let catalogue = java_language().catalogue();
    let mut lines: Vec<String> = Vec::new();
    for module in &catalogue.modules {
        let Some(class) = module.path.rsplit('.').next() else {
            continue;
        };
        if names(body, class)
            && let Some(line) = &module.import
        {
            lines.push(line.clone());
        }
    }
    for class in ["Gg", "ApiError", "ApiErrorCode"] {
        if names(body, class) {
            lines.push(format!("import gg.{class};"));
        }
    }
    for (class, path) in JAVA_TYPES {
        if names(body, class) {
            lines.push(format!("import {path};"));
        }
    }
    lines.sort_unstable();
    lines.dedup();
    let imports = match lines.is_empty() {
        true => String::new(),
        false => format!("{}\n\n", lines.join("\n")),
    };
    let indented: String = body
        .lines()
        .map(|line| match line.is_empty() {
            true => "\n".to_string(),
            false => format!("        {line}\n"),
        })
        .collect();
    // `throws Exception` on `main`, which is what a Java author writes rather than wrapping every
    // library call in a `try` — and what gg's own export declares `throws Throwable` for. Several
    // of the library probes below reach a method with a checked exception.
    format!(
        "{imports}public final class Program {{\n\
         \x20   public static void main(String[] args) throws Exception {{\n\
         {indented}\
         \x20   }}\n\
         }}\n"
    )
}

/// Whether `body` names `class` as a bare identifier — not as part of a longer word, and not as the
/// tail of a name written in full.
fn names(body: &str, class: &str) -> bool {
    body.match_indices(class).any(|(at, _)| {
        let before = body[..at].chars().next_back();
        let after = body[at + class.len()..].chars().next();
        !before.is_some_and(|it| it.is_alphanumeric() || it == '_' || it == '.')
            && !after.is_some_and(|it| it.is_alphanumeric() || it == '_')
    })
}

/// Compile and run one Java program, with the ending group and the library flag said out loud.
fn run_as(
    body: &str,
    operations: &[crate::sandbox::operations::OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_as(
        &prepare(&whole(body)),
        operations,
        &[],
        ending,
        library,
        responder,
    )
}

/// Compile and run one Java program with `enabled`'s operations offered and no ending group.
fn run_with(
    body: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(body, operations, RunEnding::None, false, responder)
}

// ---------------------------------------------------------------------------------------------
// Every operation, from its Java spelling
// ---------------------------------------------------------------------------------------------

/// One operation, called through the Java spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic Java method.
///
/// Deliberately the same table `sandbox.membrane.test.rs` drives the TypeScript arm with and the
/// Python, Ruby and PureScript substrate tests drive theirs with, down to the arguments and the
/// expected JSON — because the expected JSON is the point. gg's dispatch is language-independent:
/// six arms writing the same call in their own idioms must produce **byte-identical** arguments, or
/// they are not running the same experiment. An overload that lowered onto the wrong wire field, a
/// `clearDescription()` read as "leave it alone" instead of "clear it", an enum constant whose wire
/// word did not translate — none of them is a compile error in any of the six, and all of them are
/// visible here.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: "Shell.shell(\"npm test\", 30);",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: "Files.readFile(\"src/a.java\", 2, 5);",
            expected: || json!({ "path": "src/a.java", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: "Files.writeFile(\"out.txt\", \"hello\");",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: "Files.editFile(\"src/a.java\", \"alpha\", \"beta\");",
            expected: || json!({ "path": "src/a.java", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: "Files.listDir(\"src\");",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            statement: "Files.tree(\"src\", 3);",
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            statement: "Files.search(\"answer\", \"src\", 5);",
            expected: || json!({ "query": "answer", "path": "src", "limit": 5 }),
        },
        Crossing {
            tool: "read_skill",
            statement: "Skills.readSkill(\"testing\");",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: "Memories.writeMemory(\"layout\", \"d\", \"b\");",
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: "Memories.updateMemory(\"layout\", \"d2\", \"b2\");",
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, because Java is the arm where the two
            // code halves are a typed value rather than two optional arguments: `Memories.MemoryCode.of`
            // makes "an on-use script and no module" expressible, which a telescoping overload
            // chain could not have said at all.
            statement: "Memories.createMemory(\"layout\", \"d\", \"b\", \
                        Memories.MemoryCode.of(\"static int one() { return 1; }\", \"Views.openText(1);\"));",
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "static int one() { return 1; }",
                        "onUse": "Views.openText(1);" })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: "Memories.readMemory(\"layout\");",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: "Memories.editMemory(\"layout\", \"old\", \"new\");",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: "Memories.searchMemories(\"cargo\", \"nextest\");",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: "Memories.deleteMemory(\"layout\");",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: "Tasks.addTask(\"t1\", \"T\", \"D\", List.of(\"t0\"));",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: "Tasks.updateTask(\"t1\", new Tasks.TaskPatch().title(\"T2\")\
                        .clearDescription().status(Tasks.TaskStatus.IN_PROGRESS));",
            expected: || {
                // `clearDescription()` is what CLEARS it — a field the patch was never asked about
                // is the one that keeps it — and `in_progress` is gg's own spelling, so the
                // membrane's `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: "Tasks.setBlockedBy(\"t1\");",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: "Tasks.completeTask(\"t1\");",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: "Tasks.removeTask(\"t1\");",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: "Board.createEpic(\"epc\", \"E\", \"D\");",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: "Board.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\", \
                        new Board.IssueOptions().reviewers(\"critic\"));",
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
            statement: "Board.updateIssue(\"i1\", \
                        new Board.IssuePatch().status(Board.IssueStatus.DONE).clearEpic());",
            expected: || {
                // `clearEpic()` ungroups the issue, which gg's schema spells as the empty string; a
                // description the patch never mentions keeps the one it has, so its key is absent.
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
            statement: "Board.setIssueBlockedBy(\"i1\", \"i0\");",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: "Board.removeEpic(\"e1\");",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: "Board.removeIssue(\"i1\");",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: "Board.waitForIssue(\"i1\");",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: "Context.evictFileView(\"src/a.java\");",
            expected: || json!({ "path": "src/a.java" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a record of the two fields the header of every result carries,
            // constructed and passed variadically — which is what a list of spans is in a language
            // with no range literal and a `...` for the trailing one.
            statement: "Context.archiveThread(new Context.TurnRange(4, 19), new Context.TurnRange(30, 35));",
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: "Context.searchArchive(\"the parser\");",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: "Context.compact(\"scaffolded the page\", \"src/Main.java\");",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.java"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a typed value rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: "Delegation.spawnSubagent(\"subagent\", Delegation.Brief.prompt(\"write the lexer\"));",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: "Delegation.waitForSubagents(\"agent-1\");",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: "Delegation.sendMessage(\"agent-1\", \"prefer the simpler parser\");",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: "Delegation.transitionState(\"verify\", \"the build is green\");",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: "Delegation.exec(\"Builder\", \"pick it up from here\");",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: "Delegation.fork(\"try the other fix\");",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_operation_crosses_the_membrane_from_its_java_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing, for the reason the PureScript arm gives: a compile
    // here costs a warm JVM ~0.4 s, so thirty-five of them would be fifteen seconds of compiler for
    // a table that reads the same. It is also the stronger check — the calls must arrive in the
    // order the program made them, so a call that reached gg's dispatch under a NEIGHBOUR's name
    // fails here as well.
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

    // Exhaustive by construction: an operation added to gg with no row here fails now, rather than
    // shipping as a typed method nobody ever called.
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
        "Files.FileRead read = Views.openFile(\"notes.md\", 1, 2);\n\
         Views.openText(\"summary\", \"eight files, two failing\");\n\
         Views.openDocsView(\"readFile\");\n\
         Views.openFile(\"wide.md\", 1, 2, 80);\n\
         int closed = Views.close(\"summary\");\n\
         int missing = Views.close(\"never opened\");\n\
         Gg.log(closed + \" \" + missing);\n\
         Gg.log(switch (read) {\n\
         \x20   case Files.TextFile file -> file.contents().split(\"\\n\")[0];\n\
         \x20   case Files.ImageFile picture -> picture.label();\n\
         });\n\
         Session.finish(\"read the file and showed myself the result\");\n",
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

    // Two reads reached gg's dispatch and both arrived as `read_file`: the two `view.openFile`
    // performs. Neither has a tool name of its own, which is exactly the point — a view is a
    // read gg also shows you. The second carries the view's own line cut, which crosses only
    // when the program wrote one.
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
    // gets the other ending group and no `harness.finish` at all.
    let (outcome, _log) = run_as(
        "List<Programs.ProgramSummary> history = Programs.history();\n\
         Gg.log(String.valueOf(history.size()));\n\
         try { Programs.get(\"p2\"); }\n\
         catch (ApiError failure) { Gg.log(failure.code().toString()); }\n\
         Programs.rerun(\"Gg.log(\\\"again\\\");\");\n\
         Session.requestChanges(\"widen the test\", \"name the file\");\n",
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never an error — and an id it was never
    // issued is a `NOT_FOUND` the program catches in Java's own idiom.
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
        "Session.approve();\n",
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
    // the call before it handed back. They are the five entries the crossing table cannot reach,
    // because each is an ALIAS of a tool the table already drives from its module spelling — so
    // without this, the five names a model is shown would be the five nothing ever executed.
    let (outcome, log) = run_as(
        "Board.IssueCreated created = Board.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\");\n\
         Gg.log(created.await());\n\
         List<Memories.MemoryHit> hits = Memories.searchMemories(\"build\");\n\
         Gg.log(hits.get(0).read());\n\
         Delegation.SubagentHandle child =\n\
         \x20       Delegation.spawnSubagent(\"subagent\", Delegation.Brief.prompt(\"go\"));\n\
         child.send(\"prefer the simpler parser\");\n\
         Views.openText(\"scratch\", \"body\");\n\
         Gg.log(String.valueOf(Views.close(\"scratch\")));\n\
         try {\n\
         \x20   new Programs.ProgramSummary(\"p2\", 2, 1, 1, true, Optional.empty()).source();\n\
         } catch (ApiError failure) {\n\
         \x20   Gg.log(String.valueOf(failure.code()));\n\
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
    // Each member carried the receiver's own component across: the issue's id, the hit's slug, the
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
    // driven from Java's own spelling of a call whose every argument is optional — the chained
    // `SearchFilters` this arm has in place of keyword arguments — once carrying words alone, and
    // once carrying a union of two modules with no words at all.
    //
    // The double models no catalogue, so an empty page is the honest answer and the ranking is
    // `DocsRuntime`'s to be right about. What is observed here is this arm's own half: that the
    // chained builder a program writes is unpacked into the six positional arguments the wire
    // takes, that a `modules` filter crosses as a list, and that the envelope comes back as a
    // `DocSearch` a program reads fields off.
    let (outcome, _log) = run_with(
        "Docs.DocSearch all = Docs.search(new Docs.SearchFilters().query(\"view\"));\n\
         Docs.DocSearch narrowed = Docs.search(\n\
         \x20       new Docs.SearchFilters().modules(\"gg.views.Views\", \"gg.files.Files\")\n\
         \x20               .kind(Docs.DocKind.FUNCTION).limit(5));\n\
         Gg.log(all.total() + \" \" + all.offset() + \" \" + all.hits().size());\n\
         Gg.log(String.valueOf(narrowed.hits().isEmpty()));\n\
         try {\n\
         \x20   Docs.close(\"gg.files.Files.readFile\");\n\
         } catch (ApiError failure) {\n\
         \x20   Gg.log(failure.code() + \" \" + failure.operation());\n\
         }\n",
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["0 0 0", "true", "UNAVAILABLE close"],
        "the documentation module did not answer from its Java spellings"
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
        &prepare(&whole(
            "Gg.log(Docs.close(\"gg.files.Files.readFile\") + \" \" + Docs.closeAll());\n",
        )),
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
    let mut catalogued: Vec<&str> = crate::sandbox::catalogue_functions(java_language())
        .iter()
        .filter(|function| function.receiver.is_some())
        .map(|function| function.fqn)
        .collect();
    catalogued.sort_unstable();
    assert_eq!(
        catalogued,
        [
            "gg.board.Board.IssueCreated#await",
            "gg.delegation.Delegation.SubagentHandle#send",
            "gg.memories.Memories.MemoryHit#read",
            "gg.programs.Programs.ProgramSummary#source",
        ],
        "every member function this arm catalogues needs a call in the program above"
    );
}

#[test]
fn a_failure_is_a_java_exception_whether_it_is_caught_or_not() {
    // The whole of this arm's failure story, and the half of it that is Java's rather than gg's.
    // TeaVM wraps a JavaScript exception crossing into Java in a `RuntimeException` it prefixes
    // with `(JavaScript) `, so a `catch (ApiError failure)` would catch NOTHING if the SDK let the
    // guest's throw propagate. It catches the throw in JavaScript instead and raises a real Java
    // exception, which is what makes the clause below work at all.
    let (outcome, _log) = run_with(
        "try {\n\
         \x20   Files.readFile(\"gone.java\");\n\
         } catch (ApiError failure) {\n\
         \x20   Gg.log(failure.code() + \" on \" + failure.operation());\n\
         }\n\
         Gg.log(\"carried on\");\n",
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.java".to_string(),
            )
        },
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on read_file", "carried on"]);

    // And the half that no SDK could do for itself: one that ESCAPED kills the program the way its
    // runtime kills it, and what the model reads is the exception's own message — which is why
    // `ApiError` builds one carrying all three of gg's fields — and the model's own line.
    let (outcome, _log) = run_with(
        "Gg.log(\"before\");\n\
         Files.readFile(\"gone.java\");\n\
         Gg.log(\"after\");\n",
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.java".to_string(),
            )
        },
    );
    let reported = trap(&outcome);
    assert!(
        reported.contains("`read_file` failed (not-found): no such file: gone.java"),
        "the model reads gg's own sentence about all three fields: {reported}"
    );
    assert!(
        reported.contains("Program.java:"),
        "and the model's own file and line: {reported}"
    );
    assert_eq!(outcome.logs, ["before"], "what ran before it still stands");
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // The SDK exposes the whole surface — it is compiled once, into a jar, and a run's operations set
    // is decided per run — so what stops a withheld capability from being reachable is a refusal
    // rather than a missing name. It carries the code the HOST refuses an out-of-set call with,
    // because gg classifies a turn's error from the code: a capability nobody granted must not be
    // recorded as a name the model got wrong.
    //
    // The refusal is the **host's**: the SDK is one jar and every class on it compiles, so the call
    // reaches the membrane and comes back named the way this arm's catalogue names it.
    let (outcome, log) = run_with("Files.readFile(\"src/Main.java\");\n", &[], canned_outcome);
    let reported = trap(&outcome);
    assert!(
        reported.contains("`gg.files.Files.readFile` is not available."),
        "the refusal names the call the way this arm's catalogue spells it: {reported}"
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");

    // The same refusal is catchable, which is what makes a program able to probe its own surface
    // rather than crash on it.
    let (outcome, _log) = run_with(
        "try { Delegation.fork(\"a copy\"); }\n\
         catch (ApiError failure) { Gg.log(failure.code().wireName()); }\n",
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable"]);
}

// ---------------------------------------------------------------------------------------------
// What a workspace call hands back, and every way one fails
// ---------------------------------------------------------------------------------------------

/// A responder answering **every** call with one injected failure — what a failure case drives.
///
/// The double is the only place a workspace failure can come from here: the tools themselves are
/// not in this process, so the way to ask "what does this arm's SDK do with a `conflict`?" is to
/// hand the membrane one and read what the program caught.
fn refusing(
    failure: ToolFailure,
    message: &'static str,
) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |_name: &str, _args: &Value| ToolOutcome::failed(failure, message.to_string())
}

/// A responder answering every call `ok` with one sidecar — what the empty shapes drive.
///
/// [`canned_outcome`] carries a populated listing, a match and a hit, which is what makes the
/// success cases assertable without arranging anything. The shapes it therefore cannot carry — an
/// empty directory, a search that found nothing, a memory search that matched nothing — come from
/// here, and each is a **success** rather than a failure, which is the claim those cases make.
fn answering(data: ApiData) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |_name: &str, _args: &Value| ToolOutcome::ok("", "answered").with_data(data.clone())
}

/// Run one program and hand back what it logged, with the calls it made.
fn ran(
    body: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (Vec<String>, CallLog) {
    let (outcome, log) = run_with(body, &all_operations(), responder);
    (logs(&outcome).to_vec(), log)
}

/// What a `catch (ApiError failure)` clause read off the exception.
struct Caught {
    /// `failure.code()` and `failure.operation()` — the pair every failure case asserts, because
    /// between them they are what a program branches on.
    code_and_operation: String,
    /// `failure.detail()`, gg's own sentence — asserted where the message is the contract.
    detail: String,
}

/// **One failure case**: `statement` inside the `catch` a program writes, against an injected
/// failure.
///
/// The clause always reads all three fields, so every case can assert the two that are always the
/// contract and the third where it is one. The [`CallLog`] comes back beside it because a refusal
/// the SDK itself raises must reach no dispatch at all, and that is only sayable about the log.
fn caught(statement: &str, failure: ToolFailure, message: &'static str) -> (Caught, CallLog) {
    let (caught, _outcome, log) = caught_as(
        statement,
        &all_operations(),
        RunEnding::None,
        false,
        refusing(failure, message),
    );
    (caught, log)
}

/// The `try`/`catch` a failure case's program is, written the way a model writes one.
///
/// Its own function because three entry points share it — an injected tool failure, a refusal the
/// double raises out of the api, and a refusal the *grant* raises before either — and what a case
/// reads back has to be the same three fields whichever of the three refused.
fn catching(statement: &str) -> String {
    format!(
        "try {{\n\
         \x20   {statement}\n\
         \x20   Gg.log(\"the call did not fail\");\n\
         }} catch (ApiError failure) {{\n\
         \x20   Gg.log(failure.code() + \" \" + failure.operation());\n\
         \x20   Gg.log(failure.detail());\n\
         }}\n"
    )
}

/// What the `catch` clause wrote, insisting that there was something to catch.
fn read_caught(statement: &str, lines: &[String]) -> Caught {
    assert_eq!(
        lines.len(),
        2,
        "`{statement}` did not raise an `ApiError`: {lines:?}"
    );
    Caught {
        code_and_operation: lines[0].clone(),
        detail: lines[1].clone(),
    }
}

/// [`caught`] with the grant, the ending group and the library flag said out loud, handing back the
/// whole turn beside the exception.
///
/// The turn is what a case about the state a refused call left behind has to read: that no view was
/// opened, that no ending was recorded, that the refusal landed on the roster.
fn caught_as(
    statement: &str,
    operations: &[OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (Caught, SandboxOutcome, CallLog) {
    let (outcome, log) = run_as(&catching(statement), operations, ending, library, responder);
    let caught = read_caught(statement, logs(&outcome));
    (caught, outcome, log)
}

/// [`caught_as`] over an already-prepared double — the refusals no responder can inject, because
/// the calls that raise them dispatch no tool for one to answer.
fn caught_with_api(
    statement: &str,
    operations: &[OperationId],
    ending: RunEnding,
    library: bool,
    api: FakeOperationApi,
) -> (Caught, SandboxOutcome) {
    let outcome = run_api(&catching(statement), operations, ending, library, api);
    let caught = read_caught(statement, logs(&outcome));
    (caught, outcome)
}

/// Compile and run one Java program against an already-prepared double.
///
/// The knobs the cases below arm — a seeded program library, a bounded retention, a standing
/// refusal for the view or documentation families — live on the api rather than on a responder,
/// so a case that needs one cannot go through [`run_as`].
fn run_api(
    body: &str,
    operations: &[OperationId],
    ending: RunEnding,
    library: bool,
    api: FakeOperationApi,
) -> SandboxOutcome {
    evaluate_with_api(&prepare(&whole(body)), operations, ending, library, api)
}

// ---------------------------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------------------------

#[test]
fn a_shell_command_hands_java_its_exit_code_and_output() {
    let (lines, log) = ran(
        r#"Shell.ShellOutput ran = Shell.shell("npm test");
Gg.log(ran.exitCode().getAsInt() + " " + ran.output() + " " + ran.truncated());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["0 ran `npm test` false"]);
    assert_eq!(log.names(), ["shell"]);
}

/// **A non-zero exit is a value.** It arrives with no failure class at all, and an SDK that read
/// `ok: false` as a throw would make every program that checks whether a build passed die on the
/// build failing.
#[test]
fn a_non_zero_exit_is_a_shell_output_not_a_throw() {
    let (lines, _log) = ran(
        r#"Shell.ShellOutput ran = Shell.shell("npm test -- --fail");
Gg.log(String.valueOf(ran.exitCode().getAsInt()));
Gg.log("carried on");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1", "carried on"]);
}

#[test]
fn a_shell_timeout_is_a_limit_exceeded_api_error() {
    let (failure, _log) = caught(
        r#"Shell.shell("sleep 600");"#,
        ToolFailure::LimitExceeded,
        "shell: command timed out after 120s and was killed",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED shell");
}

#[test]
fn a_shell_that_could_not_launch_is_an_io_error() {
    let (failure, _log) = caught(
        r#"Shell.shell("nope");"#,
        ToolFailure::IoError,
        "shell: could not launch `sh`",
    );
    assert_eq!(failure.code_and_operation, "IO_ERROR shell");
}

/// A timeout that names no duration is an argument error rather than gg's default, and the refusal
/// happens before anything runs.
#[test]
fn a_negative_shell_timeout_is_refused_before_dispatch() {
    let (failure, log) = caught(
        r#"Shell.shell("npm test", -5);"#,
        ToolFailure::NotFound,
        "the double never answered this call",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT shell");
    assert!(
        failure.detail.contains("positive number of seconds"),
        "{}",
        failure.detail
    );
    assert!(log.names().is_empty(), "no command was run");
}

// ---------------------------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------------------------

#[test]
fn a_text_read_hands_java_its_window_and_line_numbers() {
    let (lines, _log) = ran(
        r#"Files.TextFile text = (Files.TextFile) Files.readFile("notes.md", 1, 2);
Gg.log(text.contents().split("\n")[0] + " " + text.firstLine() + " " + text.lastLine()
        + " " + text.totalLines() + " " + text.byteTruncated());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["contents of notes.md 1 2 2 false"]);
}

/// The other arm of the sealed `FileRead`, which the documentation case never takes: it reads a
/// `notes.md`, so the `ImageFile` branch is written there and never entered.
#[test]
fn an_image_read_arrives_as_the_image_arm_of_file_read() {
    let (lines, _log) = ran(
        r#"Gg.log(switch (Files.readFile("logo.png")) {
    case Files.TextFile text -> "text, which is the wrong arm";
    case Files.ImageFile picture -> picture.mediaType() + " " + picture.label() + " "
            + picture.bytes() + " " + picture.shown();
});
"#,
        canned_outcome,
    );
    // `shown` is FALSE: a bare read describes a picture and does not put it in the window, which
    // is the one field of the four a program cannot guess from the path it passed.
    assert_eq!(lines, ["image/png PNG 1234 false"]);
}

#[test]
fn an_empty_path_read_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Files.readFile("");"#,
        ToolFailure::InvalidArgument,
        "read_file: `path` must not be empty",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT read_file");
}

#[test]
fn a_write_hands_java_the_byte_count() {
    let (lines, log) = ran(
        r#"Gg.log(String.valueOf(Files.writeFile("out.txt", "hello")));
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["5"]);
    assert_eq!(log.names(), ["write_file"]);
}

#[test]
fn an_empty_path_write_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Files.writeFile("", "hello");"#,
        ToolFailure::InvalidArgument,
        "write_file: `path` must not be empty",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT write_file");
}

#[test]
fn a_write_that_could_not_land_is_an_io_error() {
    let (failure, _log) = caught(
        r#"Files.writeFile("out.txt", "hello");"#,
        ToolFailure::IoError,
        "write_file: permission denied",
    );
    assert_eq!(failure.code_and_operation, "IO_ERROR write_file");
}

/// An edit that landed has nothing structured to say, so what says it landed is that the program
/// reached the line after it.
#[test]
fn an_edit_that_landed_returns_nothing_and_the_program_runs_on() {
    let (lines, log) = ran(
        r#"Files.editFile("src/a.java", "alpha", "beta");
Gg.log("edited");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["edited"]);
    assert_eq!(log.names(), ["edit_file"]);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.java", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn an_edit_whose_old_text_is_absent_is_not_found() {
    let (failure, _log) = caught(
        r#"Files.editFile("src/a.java", "alpha", "beta");"#,
        ToolFailure::NotFound,
        "edit_file: `alpha` does not appear in src/a.java",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND edit_file");
}

/// The count of matches is the contract: an ambiguous edit is fixed by widening the text until it
/// is unique, and the number is what says how far there is to go.
#[test]
fn an_edit_whose_old_text_repeats_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Files.editFile("src/a.java", "alpha", "beta");"#,
        ToolFailure::Conflict,
        "edit_file: `alpha` appears 3 times in src/a.java",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT edit_file");
    assert!(failure.detail.contains("3 times"), "{}", failure.detail);
}

#[test]
fn a_listing_hands_java_its_entries_and_their_kinds() {
    let (lines, _log) = ran(
        r#"for (Files.DirEntry entry : Files.listDir("src")) {
    Gg.log(entry.name() + " " + entry.kind());
}
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["a.ts FILE", "b.test.ts FILE", "sub DIRECTORY"]);
}

#[test]
fn an_empty_directory_is_an_empty_list() {
    let (lines, _log) = ran(
        r#"List<Files.DirEntry> entries = Files.listDir("empty");
Gg.log(entries.isEmpty() + " " + entries.size());
"#,
        answering(ApiData::DirEntries(Vec::new())),
    );
    assert_eq!(lines, ["true 0"]);
}

/// The overload that takes nothing lists the workspace root, and it says so by lowering **no**
/// path rather than an empty one.
#[test]
fn the_no_argument_listing_lowers_a_null_path() {
    let (lines, log) = ran(
        r#"Files.listDir();
Files.listDir("src");
Gg.log("both listed");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["both listed"]);
    let paths: Vec<Value> = log.calls().into_iter().map(|call| call.args).collect();
    assert_eq!(paths, [json!({ "path": null }), json!({ "path": "src" })]);
}

/// And the empty string is not that: it reaches dispatch as an empty path, where it is refused.
#[test]
fn an_empty_path_listing_is_an_argument_error() {
    let (failure, log) = caught(
        r#"Files.listDir("");"#,
        ToolFailure::InvalidArgument,
        "list_dir: `path` must not be empty",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT list_dir");
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "" })));
}

#[test]
fn a_listing_of_a_missing_directory_is_not_found() {
    let (failure, _log) = caught(
        r#"Files.listDir("gone");"#,
        ToolFailure::NotFound,
        "list_dir: no such directory: gone",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND list_dir");
}

#[test]
fn a_tree_hands_java_its_rendered_block() {
    let (lines, log) = ran(
        r#"Gg.log(Files.tree("src", 3).replace("\n", " | "));
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["a.ts | b.test.ts | sub/ |   c.ts"]);
    assert_eq!(log.args("tree"), Some(json!({ "path": "src", "depth": 3 })));
}

#[test]
fn a_tree_of_a_missing_path_is_not_found() {
    let (failure, _log) = caught(
        r#"Files.tree("gone");"#,
        ToolFailure::NotFound,
        "tree: no such path: gone",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND tree");
}

#[test]
fn a_tree_of_a_file_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Files.tree("src/a.java");"#,
        ToolFailure::InvalidArgument,
        "tree: src/a.java is a file, not a directory",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT tree");
}

/// The guard is the **SDK's**, so the refusal is raised without a crossing at all.
#[test]
fn a_tree_depth_below_one_is_refused_before_dispatch() {
    let (failure, log) = caught(
        r#"Files.tree("src", 0);"#,
        ToolFailure::NotFound,
        "the double never answered this call",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT tree");
    assert!(failure.detail.contains("depth"), "{}", failure.detail);
    assert!(log.names().is_empty(), "nothing reached gg's dispatch");
}

#[test]
fn a_search_hands_java_its_matches_with_paths_and_line_numbers() {
    let (lines, _log) = ran(
        r#"List<Files.SearchMatch> found = Files.search("answer", "src", 5);
Gg.log(found.size() + " " + found.get(0).path() + " " + found.get(0).line() + " "
        + found.get(0).text());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 src/a.ts 3 const answer = 42;"]);
}

#[test]
fn a_search_that_matched_nothing_is_an_empty_list() {
    let (lines, _log) = ran(
        r#"List<Files.SearchMatch> found = Files.search("nothing at all");
Gg.log(found.isEmpty() + " " + found.size());
"#,
        answering(ApiData::SearchMatches(Vec::new())),
    );
    assert_eq!(lines, ["true 0"]);
}

#[test]
fn a_blank_search_query_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Files.search("   ");"#,
        ToolFailure::InvalidArgument,
        "search: `query` must not be blank",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT search");
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Files.search("fn (");"#,
        ToolFailure::InvalidArgument,
        "search: `fn (` is not a valid regular expression: unclosed group",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT search");
}

#[test]
fn a_search_under_a_missing_path_is_not_found() {
    let (failure, _log) = caught(
        r#"Files.search("answer", "gone");"#,
        ToolFailure::NotFound,
        "search: no such path: gone",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND search");
}

/// The other SDK-side guard, refused the same way the depth one is.
#[test]
fn a_search_limit_of_zero_is_refused_before_dispatch() {
    let (failure, log) = caught(
        r#"Files.search("answer", "src", 0);"#,
        ToolFailure::NotFound,
        "the double never answered this call",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT search");
    assert!(failure.detail.contains("limit"), "{}", failure.detail);
    assert!(log.names().is_empty(), "nothing reached gg's dispatch");
}

// ---------------------------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_java_the_skill_body() {
    let (lines, log) = ran(
        r#"Gg.log(Skills.readSkill("testing"));
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["the skill body"]);
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "testing" })));
}

/// The catalogue in the message is the contract: a name the run does not have is recoverable on
/// the same turn only if the failure says which names it does have.
#[test]
fn an_unknown_skill_is_not_found_and_names_the_skills_that_exist() {
    let (failure, _log) = caught(
        r#"Skills.readSkill("nope");"#,
        ToolFailure::NotFound,
        "read_skill: no skill named `nope`; available skills: testing",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND read_skill");
    assert!(
        failure.detail.contains("available skills"),
        "{}",
        failure.detail
    );
}

// ---------------------------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------------------------

/// The three fields of the budget a write reports, read back off the record.
#[test]
fn a_memory_write_hands_java_its_usage_record() {
    let (lines, _log) = ran(
        r#"Memories.MemoryUsage usage = Memories.writeMemory("layout", "d", "b");
Gg.log(usage.count() + " " + usage.maxCount().getAsInt() + " " + usage.totalChars());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
}

#[test]
fn a_duplicate_memory_name_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Memories.writeMemory("layout", "d", "b");"#,
        ToolFailure::Conflict,
        "write_memory: a memory named `layout` already exists",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT write_memory");
}

#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded() {
    let (failure, _log) = caught(
        r#"Memories.writeMemory("layout", "d", "b");"#,
        ToolFailure::LimitExceeded,
        "write_memory: the body is 9000 characters, over this run's cap of 4000",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED write_memory");
}

#[test]
fn a_memory_update_hands_java_its_usage_record() {
    let (lines, _log) = ran(
        r#"Memories.MemoryUsage usage = Memories.updateMemory("layout", "d2", "b2");
Gg.log(usage.count() + " " + usage.maxCount().getAsInt() + " " + usage.totalChars());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
}

#[test]
fn an_update_of_an_unknown_memory_is_not_found() {
    let (failure, _log) = caught(
        r#"Memories.updateMemory("gone", "d2", "b2");"#,
        ToolFailure::NotFound,
        "update_memory: no memory named `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND update_memory");
}

#[test]
fn a_replacement_over_the_cap_is_limit_exceeded() {
    let (failure, _log) = caught(
        r#"Memories.updateMemory("layout", "d2", "b2");"#,
        ToolFailure::LimitExceeded,
        "update_memory: the body is 9000 characters, over this run's cap of 4000",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED update_memory");
}

#[test]
fn a_memory_creation_hands_java_its_usage_record() {
    let (lines, _log) = ran(
        r#"Memories.MemoryUsage usage = Memories.createMemory("layout", "d", "b");
Gg.log(usage.count() + " " + usage.maxCount().getAsInt() + " " + usage.totalChars());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
}

#[test]
fn a_duplicate_memory_slug_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Memories.createMemory("layout", "d", "b");"#,
        ToolFailure::Conflict,
        "create_memory: a memory named `layout` already exists",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT create_memory");
}

/// The first of the two ceilings a creation can breach.
#[test]
fn memory_contents_over_the_cap_are_limit_exceeded() {
    let (failure, _log) = caught(
        r#"Memories.createMemory("layout", "d", "b");"#,
        ToolFailure::LimitExceeded,
        "create_memory: the contents are 9000 characters, over this run's cap of 4000",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED create_memory");
    assert!(failure.detail.contains("contents"), "{}", failure.detail);
}

/// And the second, which shares its code and is told apart by what the sentence says.
#[test]
fn a_memory_index_entry_over_the_cap_is_limit_exceeded() {
    let (failure, _log) = caught(
        r#"Memories.createMemory("layout", "d", "b");"#,
        ToolFailure::LimitExceeded,
        "create_memory: the index entry would take the index to 900 characters, over this run's \
         cap of 800",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED create_memory");
    assert!(failure.detail.contains("index entry"), "{}", failure.detail);
}

/// The module spelling of a read, beside the member form the documentation case drives.
#[test]
fn a_memory_read_hands_java_its_contents() {
    let (lines, log) = ran(
        r#"Gg.log(Memories.readMemory("layout"));
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["the memory contents"]);
    assert_eq!(log.args("read_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn a_read_of_an_unknown_memory_is_not_found() {
    let (failure, _log) = caught(
        r#"Memories.readMemory("gone");"#,
        ToolFailure::NotFound,
        "read_memory: no memory named `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND read_memory");
}

#[test]
fn a_memory_edit_hands_java_its_usage_record() {
    let (lines, _log) = ran(
        r#"Memories.MemoryUsage usage = Memories.editMemory("layout", "old", "new");
Gg.log(usage.count() + " " + usage.maxCount().getAsInt() + " " + usage.totalChars());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
}

#[test]
fn an_edit_whose_text_is_absent_is_not_found() {
    let (failure, _log) = caught(
        r#"Memories.editMemory("layout", "old", "new");"#,
        ToolFailure::NotFound,
        "edit_memory: `old` does not appear in `layout`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND edit_memory");
}

#[test]
fn an_edit_whose_text_repeats_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Memories.editMemory("layout", "old", "new");"#,
        ToolFailure::Conflict,
        "edit_memory: `old` appears 2 times in `layout`",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT edit_memory");
}

#[test]
fn an_edit_that_would_overrun_the_cap_is_limit_exceeded() {
    let (failure, _log) = caught(
        r#"Memories.editMemory("layout", "old", "new");"#,
        ToolFailure::LimitExceeded,
        "edit_memory: the result is 9000 characters, over this run's cap of 4000",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED edit_memory");
}

#[test]
fn an_edit_that_would_empty_the_memory_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Memories.editMemory("layout", "old", "");"#,
        ToolFailure::InvalidArgument,
        "edit_memory: the edit would leave `layout` empty",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT edit_memory");
}

/// A hit is **data** rather than prose: the five fields a program ranks and reports on.
#[test]
fn a_memory_search_hands_java_its_hits_as_data() {
    let (lines, _log) = ran(
        r#"Memories.MemoryHit first = Memories.searchMemories("cargo", "nextest").get(0);
Gg.log(first.name() + " " + first.description() + " " + first.matched() + " "
        + first.occurrences() + " " + first.excerpt());
"#,
        canned_outcome,
    );
    assert_eq!(
        lines,
        ["build-commands How to build 2 3 …cargo nextest run --workspace…"]
    );
}

#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_list() {
    let (lines, _log) = ran(
        r#"List<Memories.MemoryHit> hits = Memories.searchMemories("nothing");
Gg.log(hits.isEmpty() + " " + hits.size());
"#,
        answering(ApiData::MemoryHits(Vec::new())),
    );
    assert_eq!(lines, ["true 0"]);
}

#[test]
fn a_search_whose_keywords_are_all_empty_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Memories.searchMemories("", "");"#,
        ToolFailure::InvalidArgument,
        "search_memories: every keyword is empty",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT search_memories"
    );
}

#[test]
fn a_memory_deletion_hands_java_its_usage_record() {
    let (lines, _log) = ran(
        r#"Memories.MemoryUsage usage = Memories.deleteMemory("layout");
Gg.log(usage.count() + " " + usage.maxCount().getAsInt() + " " + usage.totalChars());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
}

#[test]
fn a_deletion_of_an_unknown_memory_is_not_found() {
    let (failure, _log) = caught(
        r#"Memories.deleteMemory("gone");"#,
        ToolFailure::NotFound,
        "delete_memory: no memory named `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND delete_memory");
}

// ---------------------------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------------------------

#[test]
fn a_task_addition_hands_java_its_usage_record() {
    let (lines, _log) = ran(
        r#"Tasks.TaskUsage usage = Tasks.addTask("t1", "T");
Gg.log(usage.count() + " " + usage.maxTasks());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["2 20"]);
}

#[test]
fn a_duplicate_task_id_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Tasks.addTask("t1", "T");"#,
        ToolFailure::Conflict,
        "add_task: a task `t1` already exists",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT add_task");
}

#[test]
fn a_task_edge_that_would_close_a_cycle_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Tasks.addTask("t1", "T", "D", List.of("t0"));"#,
        ToolFailure::Conflict,
        "add_task: `t1` blocked by `t0` would close a cycle",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT add_task");
}

#[test]
fn a_task_patch_returns_nothing_and_the_program_runs_on() {
    let (lines, log) = ran(
        r#"Tasks.updateTask("t1", new Tasks.TaskPatch().status(Tasks.TaskStatus.DONE));
Gg.log("patched");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["patched"]);
    assert_eq!(log.names(), ["update_task"]);
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": null, "status": "done" }))
    );
}

#[test]
fn an_update_of_an_unknown_task_is_not_found() {
    let (failure, _log) = caught(
        r#"Tasks.updateTask("gone", new Tasks.TaskPatch().title("T2"));"#,
        ToolFailure::NotFound,
        "update_task: no task `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND update_task");
}

#[test]
fn restating_a_tasks_blockers_returns_nothing_and_the_program_runs_on() {
    let (lines, log) = ran(
        r#"Tasks.setBlockedBy("t1", "t0");
Gg.log("restated");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["restated"]);
    assert_eq!(log.names(), ["set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t0"] }))
    );
}

#[test]
fn blocking_an_unknown_task_is_not_found() {
    let (failure, _log) = caught(
        r#"Tasks.setBlockedBy("gone", "t0");"#,
        ToolFailure::NotFound,
        "set_blocked_by: no task `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND set_blocked_by");
}

#[test]
fn a_task_blocker_edge_that_would_close_a_cycle_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Tasks.setBlockedBy("t1", "t0");"#,
        ToolFailure::Conflict,
        "set_blocked_by: `t1` blocked by `t0` would close a cycle",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT set_blocked_by");
}

#[test]
fn completing_a_task_returns_nothing_and_the_program_runs_on() {
    let (lines, log) = ran(
        r#"Tasks.completeTask("t1");
Gg.log("completed");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["completed"]);
    assert_eq!(log.names(), ["complete_task"]);
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn completing_an_unknown_task_is_not_found() {
    let (failure, _log) = caught(
        r#"Tasks.completeTask("gone");"#,
        ToolFailure::NotFound,
        "complete_task: no task `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND complete_task");
}

#[test]
fn a_task_removal_hands_java_its_usage_record() {
    let (lines, _log) = ran(
        r#"Tasks.TaskUsage usage = Tasks.removeTask("t1");
Gg.log(usage.count() + " " + usage.maxTasks());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["2 20"]);
}

#[test]
fn removing_an_unknown_task_is_not_found() {
    let (failure, _log) = caught(
        r#"Tasks.removeTask("gone");"#,
        ToolFailure::NotFound,
        "remove_task: no task `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND remove_task");
}

// ---------------------------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------------------------

#[test]
fn an_epic_creation_hands_java_its_id_and_board_usage() {
    let (lines, _log) = ran(
        r#"Board.EpicCreated created = Board.createEpic("epc", "E", "D");
Board.BoardUsage board = created.board();
Gg.log(created.id() + " " + board.epics() + " " + board.maxEpics() + " " + board.issues()
        + " " + board.maxIssues());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["EPIC 1 4 3 20"]);
}

#[test]
fn an_epic_prefix_below_three_letters_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Board.createEpic("ep", "E", "D");"#,
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be three to six letters (`ep` given)",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT create_epic");
}

#[test]
fn an_epic_prefix_above_six_letters_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Board.createEpic("epicprefix", "E", "D");"#,
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be three to six letters (`epicprefix` given)",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT create_epic");
}

#[test]
fn an_epic_prefix_that_is_not_letters_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Board.createEpic("ep1", "E", "D");"#,
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be letters only (`ep1` given)",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT create_epic");
}

#[test]
fn an_epic_prefix_another_epic_holds_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Board.createEpic("epc", "E", "D");"#,
        ToolFailure::Conflict,
        "create_epic: an epic `EPC` already exists",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT create_epic");
}

/// The id the board assigned and the budget behind it, which is the half the `await` member leaves
/// unread.
#[test]
fn an_issue_creation_hands_java_its_id_and_board_usage() {
    let (lines, _log) = ran(
        r#"Board.IssueCreated created = Board.createIssue("I", "s", "o", "c", "worker");
Board.BoardUsage board = created.board();
Gg.log(created.id() + " " + board.epics() + " " + board.maxEpics() + " " + board.issues()
        + " " + board.maxIssues());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["EPIC-1 1 4 3 20"]);
}

#[test]
fn an_agent_this_run_may_not_assign_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Board.createIssue("I", "s", "o", "c", "nobody");"#,
        ToolFailure::InvalidArgument,
        "create_issue: `nobody` is not an agent this run may assign",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT create_issue");
}

#[test]
fn a_reviewer_this_run_may_not_assign_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Board.createIssue("I", "s", "o", "c", "worker", new Board.IssueOptions().reviewers("nobody"));"#,
        ToolFailure::InvalidArgument,
        "create_issue: `nobody` is not an agent this run may assign as a reviewer",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT create_issue");
}

#[test]
fn an_issue_blocker_that_would_close_a_cycle_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Board.createIssue("I", "s", "o", "c", "worker", new Board.IssueOptions().blockedBy("i0"));"#,
        ToolFailure::Conflict,
        "create_issue: blocked by `i0` would close a cycle",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT create_issue");
}

#[test]
fn an_issue_patch_returns_nothing_and_the_program_runs_on() {
    let (lines, log) = ran(
        r#"Board.updateIssue("i1", new Board.IssuePatch().status(Board.IssueStatus.DONE));
Gg.log("patched");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["patched"]);
    assert_eq!(log.names(), ["update_issue"]);
    assert_eq!(
        log.args("update_issue"),
        Some(json!({
            "id": "i1",
            "title": null,
            "inScope": null,
            "outOfScope": null,
            "completionCriteria": null,
            "status": "done",
        }))
    );
}

#[test]
fn an_update_of_an_unknown_issue_is_not_found() {
    let (failure, _log) = caught(
        r#"Board.updateIssue("gone", new Board.IssuePatch().title("I2"));"#,
        ToolFailure::NotFound,
        "update_issue: no issue `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND update_issue");
}

#[test]
fn restating_an_issues_blockers_returns_nothing_and_the_program_runs_on() {
    let (lines, log) = ran(
        r#"Board.setIssueBlockedBy("i1", "i0");
Gg.log("restated");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["restated"]);
    assert_eq!(log.names(), ["set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "i1", "blockedBy": ["i0"] }))
    );
}

#[test]
fn blocking_an_unknown_issue_is_not_found() {
    let (failure, _log) = caught(
        r#"Board.setIssueBlockedBy("gone", "i0");"#,
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND set_issue_blocked_by");
}

#[test]
fn an_issue_blocker_edge_that_would_close_a_cycle_is_a_conflict() {
    let (failure, _log) = caught(
        r#"Board.setIssueBlockedBy("i1", "i0");"#,
        ToolFailure::Conflict,
        "set_issue_blocked_by: `i1` blocked by `i0` would close a cycle",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT set_issue_blocked_by");
}

#[test]
fn an_epic_removal_hands_java_the_boards_remaining_budget() {
    let (lines, _log) = ran(
        r#"Board.BoardUsage board = Board.removeEpic("EPIC");
Gg.log(board.epics() + " " + board.maxEpics() + " " + board.issues() + " " + board.maxIssues());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 4 3 20"]);
}

#[test]
fn removing_an_unknown_epic_is_not_found() {
    let (failure, _log) = caught(
        r#"Board.removeEpic("gone");"#,
        ToolFailure::NotFound,
        "remove_epic: no epic `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND remove_epic");
}

#[test]
fn an_issue_removal_hands_java_the_boards_remaining_budget() {
    let (lines, _log) = ran(
        r#"Board.BoardUsage board = Board.removeIssue("EPIC-1");
Gg.log(board.epics() + " " + board.maxEpics() + " " + board.issues() + " " + board.maxIssues());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1 4 3 20"]);
}

#[test]
fn removing_an_unknown_issue_is_not_found() {
    let (failure, _log) = caught(
        r#"Board.removeIssue("gone");"#,
        ToolFailure::NotFound,
        "remove_issue: no issue `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND remove_issue");
}

/// The wait is **registered** rather than awaited, so the line after it is part of the claim.
#[test]
fn a_registered_wait_hands_java_its_acknowledgement_and_the_program_runs_on() {
    let (lines, log) = ran(
        r#"Gg.log(Board.waitForIssue("EPIC-1"));
Gg.log("carried on");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["wait registered", "carried on"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );
}

#[test]
fn waiting_on_an_unknown_issue_is_not_found() {
    let (failure, _log) = caught(
        r#"Board.waitForIssue("gone");"#,
        ToolFailure::NotFound,
        "wait_for_issue: no issue `gone`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND wait_for_issue");
}

/// A session cannot wait on the issue it was itself assigned, which would suspend it until it had
/// done the thing it is suspended from doing.
#[test]
fn waiting_on_this_sessions_own_issue_is_an_argument_error() {
    let (failure, _log) = caught(
        r#"Board.waitForIssue("EPIC-2");"#,
        ToolFailure::InvalidArgument,
        "wait_for_issue: `EPIC-2` is the issue this session was assigned",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT wait_for_issue"
    );
}

// ---------------------------------------------------------------------------------------------
// context
// ---------------------------------------------------------------------------------------------

/// The blanket form, which says "every file view" by lowering **no** path rather than an empty one
/// — the shape `crate::sandbox::membrane::context`'s own case records.
#[test]
fn an_eviction_of_every_file_view_sends_no_path_from_java() {
    let (lines, log) = ran(
        r#"Context.ReclaimReport freed = Context.evictFileView();
Gg.log(freed.items() + " " + freed.reclaimedTokens() + " " + freed.detail());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["2 300 dropped 2 items"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_eviction_of_one_file_view_hands_a_java_program_its_reclaim() {
    let (lines, log) = ran(
        r#"Context.ReclaimReport freed = Context.evictFileView("src/a.java");
Gg.log(freed.items() + " " + freed.reclaimedTokens() + " " + freed.detail());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["2 300 dropped 2 items"]);
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.java" }))
    );
}

#[test]
fn an_empty_eviction_path_is_an_argument_error_in_java() {
    let (failure, _log) = caught(
        r#"Context.evictFileView("");"#,
        ToolFailure::InvalidArgument,
        "evict_file_view: `path` must not be empty; call it with no path to drop every file view",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT evict_file_view"
    );
}

#[test]
fn an_archive_hands_a_java_program_its_reclaim() {
    let (lines, log) = ran(
        r#"Context.ReclaimReport freed = Context.archiveThread(new Context.TurnRange(4, 19));
Gg.log(freed.items() + " " + freed.reclaimedTokens() + " " + freed.detail());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["2 300 dropped 2 items"]);
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19]] }))
    );
}

/// The varargs with nothing in it is a list with nothing in it, which crosses and is refused —
/// unlike a collection, where naming none means "all of them".
#[test]
fn an_archive_of_no_spans_is_an_argument_error_in_java() {
    let (failure, log) = caught(
        r#"Context.archiveThread();"#,
        ToolFailure::InvalidArgument,
        "archive_thread: name at least one range of turns to archive",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT archive_thread"
    );
    assert_eq!(log.args("archive_thread"), Some(json!({ "ranges": [] })));
}

#[test]
fn an_archive_of_more_than_thirty_two_spans_is_an_argument_error_in_java() {
    let spans: Vec<String> = (0..33)
        .map(|turn| format!("new Context.TurnRange({turn}, {turn})"))
        .collect();
    let (failure, log) = caught(
        &format!("Context.archiveThread({});", spans.join(", ")),
        ToolFailure::InvalidArgument,
        "archive_thread: at most 32 ranges may be archived in one call, and this names 33",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT archive_thread"
    );
    // The whole list crossed as one call, so what gg refused is what the program wrote.
    assert_eq!(log.names(), ["archive_thread"]);
    assert_eq!(
        log.args("archive_thread")
            .and_then(|args| args.get("ranges").and_then(Value::as_array).map(Vec::len)),
        Some(33)
    );
}

#[test]
fn an_archive_span_that_ends_before_it_starts_is_an_argument_error_in_java() {
    let (failure, log) = caught(
        r#"Context.archiveThread(new Context.TurnRange(19, 4));"#,
        ToolFailure::InvalidArgument,
        "archive_thread: the range 19-4 ends before it starts",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT archive_thread"
    );
    // The ends arrived in the order the record declares them, which is the only thing that makes
    // "ends before it starts" a statement about the program rather than about the lowering.
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[19, 4]] }))
    );
}

#[test]
fn an_archive_search_hands_a_java_program_its_hits() {
    let (lines, log) = ran(
        r#"Context.ArchiveSearch found = Context.searchArchive("the parser");
Context.ArchiveHit hit = found.hits().get(0);
Gg.log(found.archiveEmpty() + " " + hit.seq() + " " + hit.role() + " " + hit.text());
Gg.log(String.valueOf(hit.role() == Context.MessageRole.ASSISTANT));
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["false 3 ASSISTANT the earlier answer", "true"]);
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the parser" }))
    );
}

#[test]
fn an_archive_search_that_matched_nothing_is_an_empty_list_in_java() {
    let (lines, _log) = ran(
        r#"Context.ArchiveSearch found = Context.searchArchive("nothing at all");
Gg.log(found.archiveEmpty() + " " + found.hits().size());
"#,
        answering(ApiData::ArchiveSearch(ArchiveSearchData {
            archive_empty: false,
            hits: Vec::new(),
        })),
    );
    assert_eq!(lines, ["false 0"]);
}

/// The other empty answer, and the reason the envelope carries a flag at all: a program told only
/// "no hits" would archive its thread a second time believing the first had failed.
#[test]
fn an_empty_archive_is_told_apart_from_no_match_in_java() {
    let (lines, _log) = ran(
        r#"Context.ArchiveSearch found = Context.searchArchive("the parser");
Gg.log(found.archiveEmpty() + " " + found.hits().size());
"#,
        answering(ApiData::ArchiveSearch(ArchiveSearchData {
            archive_empty: true,
            hits: Vec::new(),
        })),
    );
    assert_eq!(lines, ["true 0"]);
}

#[test]
fn an_empty_archive_query_is_an_argument_error_in_java() {
    let (failure, _log) = caught(
        r#"Context.searchArchive("");"#,
        ToolFailure::InvalidArgument,
        "search_archive: `query` must not be empty",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT search_archive"
    );
}

/// A compaction is **registered**, not performed: the call returns, the program runs on, and the
/// loop rewrites the window once it has ended.
#[test]
fn a_compaction_is_registered_and_a_java_program_runs_on() {
    let (lines, log) = ran(
        r#"Context.compact("scaffolded the page", "src/Main.java");
Gg.log("ran on");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["ran on"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "scaffolded the page", "files": ["src/Main.java"] }))
    );
}

#[test]
fn a_blank_compaction_summary_is_an_argument_error_in_java() {
    let (failure, _log) = caught(
        r#"Context.compact("   ");"#,
        ToolFailure::InvalidArgument,
        "compact: `summary` must not be blank",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT compact");
}

// ---------------------------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------------------------

#[test]
fn a_spawn_hands_a_java_program_its_childs_handle() {
    let (lines, _log) = ran(
        r#"Delegation.SubagentHandle child =
        Delegation.spawnSubagent("subagent", Delegation.Brief.prompt("write the lexer"));
Gg.log(child.id() + " " + child.slot() + " " + child.modelId());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-1 primary test/model"]);
}

/// The other arm of the brief, which the crossing table leaves undriven: an issue id crosses under
/// its own key and the prompt is absent, rather than both being optional strings the program could
/// fill in together.
#[test]
fn a_spawn_on_an_issue_carries_the_issue_id_from_java() {
    let (lines, log) = ran(
        r#"Gg.log(Delegation.spawnSubagent("subagent", Delegation.Brief.issue("EPIC-1")).id());
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": null, "issueId": "EPIC-1" }))
    );
}

#[test]
fn a_spawn_at_the_delegation_depth_cap_is_limit_exceeded_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.spawnSubagent("subagent", Delegation.Brief.prompt("write the lexer"));"#,
        ToolFailure::LimitExceeded,
        "spawn_subagent: this run's delegation depth cap of 2 is already reached",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED spawn_subagent");
}

#[test]
fn a_spawn_of_an_agent_this_session_may_not_start_is_an_argument_error_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.spawnSubagent("nope", Delegation.Brief.prompt("write the lexer"));"#,
        ToolFailure::InvalidArgument,
        "spawn_subagent: this run may not spawn `nope`; agents it may spawn: subagent",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT spawn_subagent"
    );
}

#[test]
fn a_collection_hands_a_java_program_each_childs_ending() {
    let (lines, log) = ran(
        r#"Delegation.SubagentResult first = Delegation.waitForSubagents("agent-1").get(0);
Gg.log(first.id() + " " + first.status().get() + " " + first.summary());
Gg.log(String.valueOf(first.status().get() == Delegation.AgentEnding.COMPLETED));
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-1 COMPLETED did the work", "true"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

/// **Every ending, as its own constant.** A word this arm failed to translate would fall through
/// `Read`'s `default` and read as `MODEL_ERROR`, which is a plausible-looking wrong answer rather
/// than a failure — so the only way to see it is to drive one child per constant at once.
#[test]
fn every_agent_ending_reaches_a_java_program_as_its_own_constant() {
    let endings = [
        (AgentStatusData::Completed, "completed"),
        (AgentStatusData::Exhausted, "exhausted"),
        (AgentStatusData::TimedOut, "timed-out"),
        (AgentStatusData::ModelError, "model-error"),
        (AgentStatusData::AuthError, "auth-error"),
        (AgentStatusData::LimitExceeded, "limit-exceeded"),
    ];
    let (lines, _log) = ran(
        r#"for (Delegation.SubagentResult result : Delegation.waitForSubagents()) {
    Gg.log(result.id() + " " + result.status().get());
}
"#,
        answering(ApiData::SubagentResults(
            endings
                .iter()
                .map(|(status, id)| SubagentResultData {
                    id: (*id).to_string(),
                    status: Some(*status),
                    summary: "did the work".to_string(),
                })
                .collect(),
        )),
    );
    assert_eq!(
        lines,
        [
            "completed COMPLETED",
            "exhausted EXHAUSTED",
            "timed-out TIMED_OUT",
            "model-error MODEL_ERROR",
            "auth-error AUTH_ERROR",
            "limit-exceeded LIMIT_EXCEEDED",
        ]
    );
}

/// A child that produced no recognisable ending reports **no** status: an empty `Optional` rather
/// than a constant the program would branch on and be wrong about.
#[test]
fn a_child_with_no_ending_reports_no_status_in_java() {
    let (lines, _log) = ran(
        r#"Delegation.SubagentResult first = Delegation.waitForSubagents().get(0);
Gg.log(first.status().isPresent() + " " + first.summary());
"#,
        answering(ApiData::SubagentResults(vec![SubagentResultData {
            id: "agent-9".to_string(),
            status: None,
            summary: "it said this much".to_string(),
        }])),
    );
    assert_eq!(lines, ["false it said this much"]);
}

/// Naming no child waits for **every** outstanding one, and it says so by lowering an absent list
/// rather than an empty one — the shape the membrane records for the blanket form. An empty list
/// would ask gg to wait for exactly nothing.
#[test]
fn collecting_every_child_sends_no_ids_from_java() {
    let (lines, log) = ran(
        r#"Gg.log(String.valueOf(Delegation.waitForSubagents().size()));
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["1"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

#[test]
fn collecting_an_id_that_is_not_there_is_not_found_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.waitForSubagents("agent-9");"#,
        ToolFailure::NotFound,
        "wait_for_subagents: no child agent `agent-9`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND wait_for_subagents");
}

#[test]
fn a_message_to_a_child_is_delivered_from_java() {
    let (lines, log) = ran(
        r#"Delegation.sendMessage("agent-1", "prefer the simpler parser");
Gg.log("ran on");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["ran on"]);
    assert_eq!(log.names(), ["send_message"]);
}

#[test]
fn a_message_to_an_agent_that_is_not_there_is_not_found_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.sendMessage("agent-9", "prefer the simpler parser");"#,
        ToolFailure::NotFound,
        "send_message: no agent `agent-9`",
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND send_message");
}

#[test]
fn a_message_to_a_child_that_already_returned_is_a_conflict_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.sendMessage("agent-1", "prefer the simpler parser");"#,
        ToolFailure::Conflict,
        "send_message: `agent-1` has already returned",
    );
    assert_eq!(failure.code_and_operation, "CONFLICT send_message");
}

/// The one-argument overload, which tells the next state's agent nothing as it starts — and says so
/// with an absent note rather than an empty one.
#[test]
fn a_transition_is_registered_and_a_java_program_runs_on() {
    let (lines, log) = ran(
        r#"Delegation.transitionState("verify");
Gg.log("ran on");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["ran on"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "verify", "note": null }))
    );
}

#[test]
fn a_state_this_session_may_not_move_to_is_an_argument_error_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.transitionState("nowhere");"#,
        ToolFailure::InvalidArgument,
        "transition_state: `verify` is the only state this one has an edge to",
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT transition_state"
    );
}

/// **The surface's one positional binding.** `delegation.transition_state` is bought by where an
/// instance stands rather than by a capability, so the only way to withhold it is to take it out of
/// the allowlist — which is what an agent in no machine state has.
#[test]
fn a_transition_from_an_agent_in_no_machine_state_is_unavailable_in_java() {
    let granted: Vec<OperationId> = all_operations()
        .into_iter()
        .filter(|id| *id != DELEGATION_TRANSITION_STATE)
        .collect();
    let (failure, _outcome, log) = caught_as(
        r#"Delegation.transitionState("verify");"#,
        &granted,
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE transition_state");
    assert!(
        failure
            .detail
            .contains("gg.delegation.Delegation.transitionState"),
        "the refusal names the call the way this arm spells it: {}",
        failure.detail
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");
}

/// **One succession per turn**, whichever of the two declared it: a program that has already moved
/// its machine on cannot then hand the session to another agent, and the first declaration stands.
#[test]
fn a_succession_after_a_transition_is_refused_in_java() {
    let mut declared = false;
    let (outcome, log) = run_with(
        r#"Delegation.transitionState("verify");
try {
    Delegation.exec("Builder");
} catch (ApiError failure) {
    Gg.log(failure.code() + " " + failure.operation());
}
Gg.log("ran on");
"#,
        &all_operations(),
        move |name: &str, args: &Value| match declared {
            true => ToolOutcome::failed(
                ToolFailure::Refused,
                "this session already declared a succession this turn".to_string(),
            ),
            false => {
                declared = true;
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["REFUSED exec", "ran on"]);
    assert_eq!(
        log.names(),
        ["transition_state", "exec"],
        "both reached dispatch; it is the second gg declined"
    );
}

#[test]
fn an_exec_is_registered_and_a_java_program_runs_on() {
    let (lines, log) = ran(
        r#"Delegation.exec("Builder");
Gg.log("ran on");
Gg.log("and reached the end");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["ran on", "and reached the end"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": null }))
    );
}

#[test]
fn an_agent_this_run_may_not_become_is_an_argument_error_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.exec("nope");"#,
        ToolFailure::InvalidArgument,
        "exec: this run may not become `nope`; agents it may become: Builder",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT exec");
}

/// The copy's handle comes back immediately even though the copy itself is dispatched when the turn
/// closes, so the program can name it — and carries on.
#[test]
fn a_fork_hands_a_java_program_the_copys_handle_and_runs_on() {
    let (lines, _log) = ran(
        r#"Delegation.SubagentHandle copy = Delegation.fork("try the other fix");
Gg.log(copy.id() + " " + copy.slot() + " " + copy.modelId());
Gg.log("ran on");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-2 primary test/model", "ran on"]);
}

#[test]
fn a_fork_at_the_delegation_depth_cap_is_limit_exceeded_in_java() {
    let (failure, _log) = caught(
        r#"Delegation.fork("try the other fix");"#,
        ToolFailure::LimitExceeded,
        "fork: this run's delegation depth cap of 2 is already reached",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED fork");
}

// ---------------------------------------------------------------------------------------------
// programs
// ---------------------------------------------------------------------------------------------

/// The source the library cases seed the double with — one line, so the two counts a summary
/// reports are the two numbers written here rather than a figure this file has to recompute.
const SEEDED_PROGRAM: &str = "Gg.log(\"one\");\n";

/// A double holding one program the library issued an id for, and answering everything else as
/// usual.
fn holding_a_program(log: &CallLog) -> FakeOperationApi {
    FakeOperationApi::with(log, canned_outcome).with_program("aaaa", 1, SEEDED_PROGRAM)
}

#[test]
fn a_history_hands_a_java_program_each_programs_summary() {
    let log = CallLog::default();
    let outcome = run_api(
        r#"Programs.ProgramSummary first = Programs.history().get(0);
Gg.log(first.id() + " " + first.turn() + " " + first.lines() + " " + first.chars() + " "
        + first.ok());
"#,
        &[],
        RunEnding::None,
        true,
        holding_a_program(&log),
    );
    // One line of 15 characters, the newline included, and it ran to its end.
    assert_eq!(logs(&outcome), ["aaaa 1 1 15 true"]);
}

#[test]
fn a_history_without_a_library_is_unavailable_in_java() {
    let (failure, _outcome, log) = caught_as(
        "Programs.history();",
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE history");
    assert!(
        failure.detail.contains("gg.programs.Programs.history"),
        "{}",
        failure.detail
    );
    assert!(log.names().is_empty());
}

#[test]
fn a_stored_program_hands_a_java_program_its_source() {
    let log = CallLog::default();
    let outcome = run_api(
        r#"Gg.log(Programs.get("aaaa").trim());
"#,
        &[],
        RunEnding::None,
        true,
        holding_a_program(&log),
    );
    assert_eq!(logs(&outcome), [SEEDED_PROGRAM.trim()]);
}

/// The catalogue in the message is the contract, exactly as it is for a skill: an id the model got
/// wrong is recoverable on the same turn only because the refusal says which ids are held.
#[test]
fn an_id_the_library_never_issued_is_not_found_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        r#"Programs.get("zzzz");"#,
        &[],
        RunEnding::None,
        true,
        holding_a_program(&log),
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND get");
    assert!(
        failure.detail.contains("`aaaa` (turn 1)"),
        "{}",
        failure.detail
    );
}

/// The other way to miss, which has the same remedy and therefore the same answer: an id this
/// session really was issued, whose program the retention has since dropped.
#[test]
fn an_id_the_library_has_dropped_is_not_found_in_java() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome)
        .keeping(1)
        .with_program("aaaa", 1, SEEDED_PROGRAM)
        .with_program("bbbb", 2, SEEDED_PROGRAM);
    let (failure, _outcome) =
        caught_with_api(r#"Programs.get("aaaa");"#, &[], RunEnding::None, true, api);
    assert_eq!(failure.code_and_operation, "NOT_FOUND get");
    assert!(
        failure.detail.contains("`bbbb` (turn 2)") && !failure.detail.contains("(turn 1)"),
        "the one that is still held, and only it: {}",
        failure.detail
    );
}

/// **The capability is read before the argument.** With a library, this id is a `NOT_FOUND`;
/// without one it is `UNAVAILABLE`, because an agent that keeps no library has one problem rather
/// than two.
#[test]
fn a_program_fetch_without_a_library_is_unavailable_in_java() {
    let (failure, _outcome, log) = caught_as(
        r#"Programs.get("zzzz");"#,
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE get");
    assert!(
        failure.detail.contains("gg.programs.Programs.get"),
        "{}",
        failure.detail
    );
    assert!(log.names().is_empty());
}

#[test]
fn a_hand_over_is_registered_and_a_java_program_runs_on() {
    let (outcome, _log) = run_as(
        r#"Programs.rerun("Gg.log(\"again\");");
Gg.log("ran on");
"#,
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(outcome.rerun.as_deref(), Some("Gg.log(\"again\");"));
}

#[test]
fn a_blank_hand_over_source_is_an_argument_error_in_java() {
    let (failure, outcome, _log) = caught_as(
        r#"Programs.rerun("   ");"#,
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT rerun");
    assert!(failure.detail.contains("blank"), "{}", failure.detail);
    assert!(outcome.rerun.is_none());
}

/// **The first hand-over stands.** A silently replaced program would be a change the model cannot
/// see, which is the same argument that makes a succession first-wins.
#[test]
fn a_second_hand_over_from_one_java_program_is_refused() {
    let (outcome, _log) = run_as(
        r#"Programs.rerun("Gg.log(\"first\");");
try {
    Programs.rerun("Gg.log(\"second\");");
} catch (ApiError failure) {
    Gg.log(failure.code() + " " + failure.operation());
}
"#,
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["REFUSED rerun"]);
    assert_eq!(outcome.rerun.as_deref(), Some("Gg.log(\"first\");"));
}

/// A program that chose which program should run next and then failed did not finish the checks its
/// choice rested on, so the hand-over goes with everything else it decided.
#[test]
fn a_hand_over_is_revoked_when_the_java_program_then_fails() {
    let (outcome, _log) = run_as(
        r#"Programs.rerun("Gg.log(\"again\");");
throw new IllegalStateException("the checks did not pass");
"#,
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert!(
        trap(&outcome).contains("the checks did not pass"),
        "{}",
        trap(&outcome)
    );
    assert!(outcome.rerun.is_none());
    assert!(outcome.revoked_rerun);
}

#[test]
fn a_hand_over_without_a_library_is_unavailable_in_java() {
    let (failure, outcome, _log) = caught_as(
        r#"Programs.rerun("Gg.log(\"again\");");"#,
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE rerun");
    assert!(outcome.rerun.is_none());
}

// ---------------------------------------------------------------------------------------------
// docs
// ---------------------------------------------------------------------------------------------

/// A double refusing every documentation call with `failure` and `message`.
///
/// The documentation family dispatches no gg tool, so a responder cannot fail it: the refusals its
/// Javadoc names are the api's, and this is the seam that raises one.
fn refusing_docs(log: &CallLog, failure: ToolFailure, message: &str) -> FakeOperationApi {
    FakeOperationApi::with(log, canned_outcome).refusing_docs(failure, message)
}

/// Filters that name none of the six ask for nothing and narrow nothing, which is the one shape the
/// chained builder can produce that gg has no answer for.
#[test]
fn a_search_carrying_no_words_and_no_filters_is_an_argument_error_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        "Docs.search(new Docs.SearchFilters());",
        &[],
        RunEnding::None,
        false,
        refusing_docs(
            &log,
            ToolFailure::InvalidArgument,
            "docs.search: name some words, or a module, a type or a kind to narrow to",
        ),
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT search");
    assert!(
        failure.detail.contains("name some words"),
        "{}",
        failure.detail
    );
}

/// This arm spells the kind as an **enum**, so the filter a program writes is always one of the
/// three gg has — which is precisely why what has to be driven here is the host's refusal arriving,
/// rather than a program that could compose a bad one.
#[test]
fn a_search_kind_that_is_not_a_kind_is_an_argument_error_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        "Docs.search(new Docs.SearchFilters().query(\"view\").kind(Docs.DocKind.FUNCTION));",
        &[],
        RunEnding::None,
        false,
        refusing_docs(
            &log,
            ToolFailure::InvalidArgument,
            "docs.search: `funciton` is not a kind; the kinds are module, function and type",
        ),
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT search");
    assert!(
        failure.detail.contains("the kinds are"),
        "the refusal names the three, which is what makes it recoverable: {}",
        failure.detail
    );
}

#[test]
fn a_search_limit_of_zero_is_an_argument_error_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        "Docs.search(new Docs.SearchFilters().query(\"view\").limit(0));",
        &[],
        RunEnding::None,
        false,
        refusing_docs(
            &log,
            ToolFailure::InvalidArgument,
            "docs.search: a `limit` of zero asks for no hits at all; 20 is the default and 100 the \
             most",
        ),
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT search");
}

/// The count a successful close hands back, on a key that really is open: the program opens one
/// documentation view and takes it straight back out.
#[test]
fn closing_a_documentation_view_hands_a_java_program_the_count() {
    let (outcome, _log) = evaluate_closing_docviews(
        &prepare(&whole(
            "Views.openDocsView(\"readFile\");\n\
             Gg.log(String.valueOf(Docs.close(\"readFile\")));\n",
        )),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(outcome.views_closed, ["readFile"]);
}

#[test]
fn closing_every_documentation_view_is_unavailable_in_java() {
    let (failure, outcome, _log) = caught_as(
        "Docs.closeAll();",
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE close_all");
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "docs.close_all"),
        "a withheld capability is what the refusal roster counts: {:?}",
        outcome
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>()
    );
}

// ---------------------------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------------------------

/// A double refusing every view call the api itself decides — the caps and the catalogue lookups
/// that no dispatched tool carries.
fn refusing_views(log: &CallLog, failure: ToolFailure, message: &str) -> FakeOperationApi {
    FakeOperationApi::with(log, canned_outcome).refusing_views(failure, message)
}

#[test]
fn a_bare_file_view_sends_no_window_from_java() {
    let (lines, log) = ran(
        r#"Files.TextFile shown = (Files.TextFile) Views.openFile("notes.md");
Gg.log(shown.contents().split("\n")[0]);
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["contents of notes.md"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": null, "limit": null }))
    );
}

/// **The overload a reader most easily mistakes for a window.** Two ints are a page; one is the
/// line cut, and it crosses under `maxLineChars` with no offset beside it.
#[test]
fn a_file_views_second_int_is_its_line_cut_in_java() {
    let (lines, log) = ran(
        r#"Views.openFile("wide.md", 80);
Gg.log("opened");
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["opened"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "wide.md", "offset": null, "limit": null, "maxLineChars": 80 }))
    );
}

/// A view of a picture is the one way a picture enters the window, so unlike a bare read this one
/// comes back saying it is **shown**.
#[test]
fn an_image_file_view_reaches_a_java_program_as_the_image_variant() {
    let (lines, _log) = ran(
        r#"Gg.log(switch (Views.openFile("logo.png")) {
    case Files.TextFile text -> "text, which is the wrong arm";
    case Files.ImageFile picture -> picture.label() + " " + picture.bytes() + " "
            + picture.shown();
});
"#,
        canned_outcome,
    );
    assert_eq!(lines, ["PNG 1234 true"]);
}

/// The read is what fails, and **nothing is opened when it does** — the rule the membrane holds,
/// read here off the turn the program left behind.
#[test]
fn a_file_view_of_a_path_that_is_not_there_is_not_found_in_java() {
    let (failure, outcome, _log) = caught_as(
        r#"Views.openFile("gone.md");"#,
        &all_operations(),
        RunEnding::None,
        false,
        refusing(
            ToolFailure::NotFound,
            "views.open_file: no such file: gone.md",
        ),
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND open_file");
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

#[test]
fn a_file_view_offset_past_the_end_is_an_argument_error_in_java() {
    let (failure, log) = caught(
        r#"Views.openFile("notes.md", 900, 20);"#,
        ToolFailure::InvalidArgument,
        "views.open_file: notes.md has 2 lines, so line 900 is past its end",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT open_file");
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 900, "limit": 20 }))
    );
}

/// The cut the membrane deliberately declines to normalise: a zero offset plainly means the first
/// line, and a zero line cut names nothing.
#[test]
fn a_file_view_line_cut_of_zero_is_an_argument_error_in_java() {
    let (failure, log) = caught(
        r#"Views.openFile("wide.md", 0);"#,
        ToolFailure::InvalidArgument,
        "views.open_file: `maxLineChars` must be from 1 to 65536",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT open_file");
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "wide.md", "offset": null, "limit": null, "maxLineChars": 0 }))
    );
}

#[test]
fn a_file_view_line_cut_over_sixty_five_thousand_is_an_argument_error_in_java() {
    let (failure, log) = caught(
        r#"Views.openFile("wide.md", 65537);"#,
        ToolFailure::InvalidArgument,
        "views.open_file: `maxLineChars` must be from 1 to 65536",
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT open_file");
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "wide.md", "offset": null, "limit": null, "maxLineChars": 65_537 }))
    );
}

/// The size and the bound both reach the program, because a view refused for being too large is
/// fixed by asking for a window — and the number says how small a one.
#[test]
fn a_file_view_over_the_window_cap_is_limit_exceeded_in_java() {
    let (failure, _log) = caught(
        r#"Views.openFile("huge.md");"#,
        ToolFailure::LimitExceeded,
        "views.open_file: huge.md is 131072 bytes, over the 65536-byte cap for a text view",
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED open_file");
    assert!(
        failure.detail.contains("131072") && failure.detail.contains("65536"),
        "{}",
        failure.detail
    );
}

#[test]
fn reopening_a_file_view_supersedes_it_in_java() {
    let (outcome, _log) = run_with(
        r#"Views.openFile("notes.md");
Views.openFile("notes.md");
Gg.log("opened twice");
"#,
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["opened twice"]);
    assert_eq!(outcome.views_opened.len(), 2);
    assert!(!outcome.views_opened[0].superseded);
    assert!(
        outcome.views_opened[1].superseded,
        "the second replaced what the first showed rather than piling up"
    );
}

/// A view of a file is a **read** gg also shows you, so it is bought by the read capability and
/// refused with it.
#[test]
fn a_file_view_without_the_read_capability_is_unavailable_in_java() {
    let (failure, _outcome, log) = caught_as(
        r#"Views.openFile("notes.md");"#,
        &all_operations_without(CAPABILITY_READ_FILE),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE open_file");
    assert!(log.names().is_empty(), "and nothing was read");
}

#[test]
fn an_empty_text_view_label_is_an_argument_error_in_java() {
    let (failure, _outcome, _log) = caught_as(
        r#"Views.openText("", "eight files, two failing");"#,
        &all_operations(),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT open_text");
    assert!(
        failure.detail.contains("non-empty label"),
        "{}",
        failure.detail
    );
}

/// Nothing is silently truncated, so the cap is named: a program told only "too large" cannot know
/// what to show instead.
#[test]
fn a_text_view_body_over_the_cap_is_limit_exceeded_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        r#"Views.openText("summary", "eight files, two failing");"#,
        &all_operations(),
        RunEnding::None,
        false,
        refusing_views(
            &log,
            ToolFailure::LimitExceeded,
            "views.open_text: the body is 90000 characters, over this run's cap of 65536",
        ),
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED open_text");
    assert!(failure.detail.contains("65536"), "{}", failure.detail);
}

/// The label has a cap of its own, far smaller than the body's, and the two are told apart by what
/// the sentence says rather than by the class.
#[test]
fn a_text_view_label_over_the_cap_is_limit_exceeded_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        r#"Views.openText("summary", "eight files, two failing");"#,
        &all_operations(),
        RunEnding::None,
        false,
        refusing_views(
            &log,
            ToolFailure::LimitExceeded,
            "views.open_text: the label is 300 characters, over this run's cap of 120",
        ),
    );
    assert_eq!(failure.code_and_operation, "LIMIT_EXCEEDED open_text");
    assert!(
        failure.detail.contains("label") && failure.detail.contains("120"),
        "{}",
        failure.detail
    );
}

#[test]
fn a_documentation_view_of_an_unknown_name_is_not_found_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        r#"Views.openDocsView("nope");"#,
        &all_operations(),
        RunEnding::None,
        false,
        refusing_views(
            &log,
            ToolFailure::NotFound,
            "views.open_docs_view: nothing is documented under `nope`; search for what this run \
             has with `gg.docs.Docs.search`",
        ),
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND open_docs_view");
    assert!(
        failure.detail.contains("gg.docs.Docs.search"),
        "the refusal points at the one call that enumerates what it does have: {}",
        failure.detail
    );
}

/// A name that exists and is **not bound for this agent** is the same answer, and the message is
/// about the binding rather than about the spelling — a model told "no such name" would spend a
/// turn correcting a name that was already right.
#[test]
fn a_documentation_view_of_a_name_this_agent_does_not_bind_is_not_found_in_java() {
    let log = CallLog::default();
    let (failure, _outcome) = caught_with_api(
        r#"Views.openDocsView("gg.delegation.Delegation.fork");"#,
        &all_operations(),
        RunEnding::None,
        false,
        refusing_views(
            &log,
            ToolFailure::NotFound,
            "views.open_docs_view: `gg.delegation.Delegation.fork` is not bound for this agent",
        ),
    );
    assert_eq!(failure.code_and_operation, "NOT_FOUND open_docs_view");
    assert!(
        failure.detail.contains("not bound for this agent"),
        "{}",
        failure.detail
    );
}

#[test]
fn an_empty_view_selector_is_an_argument_error_in_java() {
    let (failure, _outcome, _log) = caught_as(
        r#"Views.close("");"#,
        &all_operations(),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT close");
    assert!(
        failure.detail.contains("non-empty selector"),
        "{}",
        failure.detail
    );
}

/// Closing what the program opened is managing the window, exactly as evicting a file view is, so
/// it is bought by the same capability.
#[test]
fn closing_a_view_without_agent_managed_context_is_unavailable_in_java() {
    let (failure, _outcome, _log) = caught_as(
        r#"Views.close("summary");"#,
        &all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE close");
    assert!(
        failure.detail.contains("gg.views.Views.close"),
        "{}",
        failure.detail
    );
}

// ---------------------------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------------------------

/// The summary becomes the session's whole answer to whoever asked for the work, so "I am done and
/// have nothing to say about it" is not an ending gg accepts on the model's behalf — and the
/// sentence it is refused with tells the model the run is still open.
#[test]
fn a_blank_finish_summary_is_an_argument_error_in_java() {
    let (failure, outcome, _log) = caught_as(
        r#"Session.finish("   ");"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "INVALID_ARGUMENT finish");
    assert!(
        failure.detail.contains("requires a non-empty summary")
            && failure.detail.contains("The session is NOT over"),
        "{}",
        failure.detail
    );
    assert!(outcome.completion.is_none(), "the run is still open");
}

/// **Last call wins**, and the replacement is counted: a program that declared its session over
/// twice in two different words is worth a line on the operator's stream.
#[test]
fn a_later_finish_replaces_the_summary_in_java() {
    let (outcome, _log) = run_as(
        r#"Session.finish("the first attempt");
Session.finish("the second, with the tests green");
"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let completion = outcome
        .completion
        .as_ref()
        .expect("the program declared an ending");
    assert!(
        matches!(&completion.ending, Ending::Finished { summary }
            if summary == "the second, with the tests green"),
        "{:?}",
        completion.ending
    );
    assert_eq!(completion.superseded, 1);
}

/// A program that ended the run and then threw did not run the checks its summary claims, so the
/// ending is taken back — and kept, so the model can be told it was.
#[test]
fn a_finish_declared_then_thrown_away_is_revoked_in_java() {
    let (outcome, _log) = run_as(
        r#"Session.finish("the work is done");
throw new IllegalStateException("the checks did not pass");
"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert!(
        trap(&outcome).contains("the checks did not pass"),
        "{}",
        trap(&outcome)
    );
    assert!(outcome.completion.is_none());
    assert!(
        matches!(&outcome.revoked_completion, Some(Ending::Finished { summary })
            if summary == "the work is done"),
        "{:?}",
        outcome.revoked_completion
    );
}

/// "The work is complete" is not a verdict a reviewer is asked for — and the refusal names the two
/// endings the role **does** hold, in this arm's own spelling of them.
#[test]
fn a_finish_from_a_reviewing_java_program_is_unavailable() {
    let (failure, outcome, _log) = caught_as(
        r#"Session.finish("the work is done");"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE finish");
    assert!(
        failure.detail.contains("gg.session.Session.approve")
            && failure.detail.contains("gg.session.Session.requestChanges"),
        "{}",
        failure.detail
    );
    assert!(
        !failure.detail.contains("request_changes"),
        "and never gg's own internal name, which no SDK binds: {}",
        failure.detail
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn an_approval_from_a_standard_java_program_is_unavailable() {
    let (failure, outcome, _log) = caught_as(
        "Session.approve();",
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE approve");
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == "session.approve"),
        "{:?}",
        outcome
            .refusals
            .iter()
            .map(|refusal| refusal.name.as_str())
            .collect::<Vec<_>>()
    );
    assert!(outcome.completion.is_none());
}

/// A rejection is dispatched verbatim to the agent that has to fix the work, so an empty list would
/// send it back to re-read criteria it already believed it had met.
#[test]
fn a_rejection_with_no_changes_is_an_argument_error_in_java() {
    let (failure, outcome, _log) = caught_as(
        "Session.requestChanges();",
        &all_operations(),
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT request_changes"
    );
    assert!(
        failure.detail.contains("requires at least one change")
            && failure.detail.contains("gg.session.Session.approve"),
        "{}",
        failure.detail
    );
    assert!(outcome.completion.is_none());
}

/// The separate cause: a list with entries in it, all of them blank. They are dropped first, and
/// what is refused is the empty result.
#[test]
fn a_rejection_whose_changes_are_all_blank_is_an_argument_error_in_java() {
    let (failure, outcome, _log) = caught_as(
        r#"Session.requestChanges("  ", "");"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert_eq!(
        failure.code_and_operation,
        "INVALID_ARGUMENT request_changes"
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn a_rejection_from_a_standard_java_program_is_unavailable() {
    let (failure, outcome, _log) = caught_as(
        r#"Session.requestChanges("widen the test");"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert_eq!(failure.code_and_operation, "UNAVAILABLE request_changes");
    assert!(outcome.completion.is_none());
}

/// **An on-use program has no ending at all.** It is not a session: it runs because a memory was
/// read, and there is nothing for it to end — so all three are refused and none of them is a
/// spelling mistake the model could correct.
#[test]
fn an_on_use_java_program_has_no_ending_calls_in_scope() {
    let (outcome, log) = run_as(
        r#"try { Session.finish("the work is done"); }
catch (ApiError failure) { Gg.log(failure.code() + " " + failure.operation()); }
try { Session.approve(); }
catch (ApiError failure) { Gg.log(failure.code() + " " + failure.operation()); }
try { Session.requestChanges("widen the test"); }
catch (ApiError failure) { Gg.log(failure.code() + " " + failure.operation()); }
"#,
        &all_operations(),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "UNAVAILABLE finish",
            "UNAVAILABLE approve",
            "UNAVAILABLE request_changes"
        ]
    );
    assert!(outcome.completion.is_none());
    assert!(log.names().is_empty());
}

// ---------------------------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------------------------

/// The four ids below belong to a **guest's runtime** rather than to a model, and this arm's
/// runtime does not send them: an uncaught failure here is a trap carrying TeaVM's own words, and a
/// broken code module is a compile refusal. They are still gg's protocol, and this arm's own door —
/// `gg.internal.Coding.call` — is exactly the call a runtime that did send them would make, so each
/// is driven through it and asserted on the turn state the host kept.
///
/// `Gg.log` is the arm's model-facing half of the same channel, and is read by every case above.
#[test]
fn a_java_programs_logs_arrive_in_the_order_it_wrote_them() {
    let (outcome, _log) = run_with(
        r#"Gg.log("first");
Gg.log("second");
Gg.log("third");
"#,
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["first", "second", "third"]);
}

/// **The capture keeps the tail.** The natural shape is to log per item in a loop and then log the
/// conclusion, so a head-biased capture would discard exactly the line the program wrote last — and
/// what went is counted rather than silently dropped.
#[test]
fn a_java_program_over_the_log_cap_keeps_the_last_lines_and_counts_the_rest() {
    // Five past the 200-line cap, each line far too short for the byte cap to be what bites.
    let (outcome, _log) = run_with(
        r#"for (int line = 0; line < 205; line++) {
    Gg.log("line " + line);
}
"#,
        &[],
        canned_outcome,
    );
    let lines = logs(&outcome);
    assert_eq!(lines.len(), 200);
    assert_eq!(lines[0], "line 5", "the oldest five were evicted");
    assert_eq!(lines[199], "line 204", "and the newest is the one kept");
    assert_eq!(outcome.logs_suppressed, 5);
}

/// The channel is gated by **nothing**: it is the shim's own, belongs to no capability, and a
/// program in a run that enables no tools at all can still say what it did.
#[test]
fn logging_is_answered_for_a_java_program_granted_nothing() {
    let (outcome, log) = run_with(
        r#"Gg.log("heard");
"#,
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["heard"]);
    assert!(log.names().is_empty());
}

/// A returned value is **discarded**, and the fact is recorded so the turn's feedback can tell the
/// model where its value went. The value itself never crosses; there is nothing here to serialise.
#[test]
fn a_returned_value_is_noted_for_a_java_program() {
    let (outcome, _log) = run_with(
        r#"gg.internal.Coding.call("feedback.note_return");
Gg.log("noted");
"#,
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["noted"]);
    assert!(outcome.returned_value);
}

/// First one wins: a runtime sends this at most once per run, and a second would say nothing new.
#[test]
fn a_deferred_call_is_noted_once_for_a_java_program() {
    let (outcome, _log) = run_with(
        r#"gg.internal.Coding.call("feedback.report_deferred",
        gg.internal.Value.of("a call landed after the program ended"));
gg.internal.Coding.call("feedback.report_deferred",
        gg.internal.Value.of("and a second one"));
"#,
        &[],
        canned_outcome,
    );
    assert_eq!(
        outcome.deferred_note.as_deref(),
        Some("a call landed after the program ended")
    );
}

/// A reported failure **revokes** an ending the same program declared, on exactly the evidence a
/// trap does: the program did not run the checks its summary rests on. The kind gg records is the
/// host's reading of the code the record carried, not the guest's word for it.
#[test]
fn a_reported_failure_revokes_a_java_programs_completion() {
    let (outcome, _log) = run_as(
        r#"Session.finish("the work is done");
gg.internal.Coding.call("feedback.report_error", gg.internal.Value.record()
        .put("kind", gg.internal.Value.of("api-failure"))
        .put("code", gg.internal.Value.of("not-found"))
        .put("message", gg.internal.Value.of("`read_file` failed (not-found): no such file"))
        .put("location", gg.internal.Value.of("Program.java:9")));
"#,
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let error = match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .expect("the reported failure is the turn's error"),
        Err(error) => panic!("the program itself ran to its end: {error}"),
    };
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure);
    assert!(error.message.contains("no such file"), "{}", error.message);
    assert_eq!(error.location.as_deref(), Some("Program.java:9"));
    assert!(outcome.completion.is_none());
    assert!(
        matches!(&outcome.revoked_completion, Some(Ending::Finished { summary })
            if summary == "the work is done"),
        "{:?}",
        outcome.revoked_completion
    );
}

/// **Every** broken module is kept rather than only the first: they are independent, they came from
/// different skills and memories, and a model told about one of three would fix that one and meet
/// the next next turn.
#[test]
fn every_broken_module_is_reported_to_a_java_program() {
    let (outcome, _log) = run_with(
        r#"gg.internal.Coding.call("feedback.report_module_error",
        gg.internal.Value.of("lint"), gg.internal.Value.of("the rules file is empty"));
gg.internal.Coding.call("feedback.report_module_error",
        gg.internal.Value.of("fixtures"), gg.internal.Value.of("no such directory"));
"#,
        &[],
        canned_outcome,
    );
    assert_eq!(
        outcome.module_errors,
        [
            ("lint".to_string(), "the rules file is empty".to_string()),
            ("fixtures".to_string(), "no such directory".to_string()),
        ]
    );
}

/// **Nothing this arm offers resolves without a line the program wrote**, and the line the catalogue
/// states is the line that makes it resolve.
///
/// The jar on the classpath is packaging: it makes `gg.files.Files` reachable by its own
/// fully-qualified name and puts no short name in a program's scope. So a program writes the name in
/// full, or the single-type `import` the catalogue publishes, and a bare `Files` resolves to
/// nothing.
///
/// Both halves are driven end to end rather than only compiled, so what is asserted about the two
/// that work is that the call really crossed.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let refused = |source: &str| -> String {
        compile_program(source, &[], &PrepareContext::detached())
            .expect_err("a name nothing brought into scope is refused")
            .to_string()
    };

    // A module reached by its short name with no import above it: javac's own unresolved-symbol
    // diagnostic, at the model's own line.
    let diagnostic = refused(
        "public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       Files.FileRead text = Files.readFile(\"a.md\");\n\
         \x20   }\n\
         }\n",
    );
    assert!(
        diagnostic.contains("cannot find symbol") && diagnostic.contains("Program.java:3"),
        "{diagnostic}"
    );

    // And the exception by its bare name, which is the `core` module's own package and the one place
    // an on-demand import used to make an exception.
    let diagnostic = refused(
        "public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       ApiErrorCode code = null;\n\
         \x20   }\n\
         }\n",
    );
    assert!(
        diagnostic.contains("cannot find symbol") && diagnostic.contains("Program.java:3"),
        "{diagnostic}"
    );

    // The two that do compile: the name in full, and the line the catalogue states.
    for source in [
        "import gg.Gg;\n\
         \n\
         public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       Gg.log(((gg.files.Files.TextFile) gg.files.Files.readFile(\"a.md\")).contents());\n\
         \x20   }\n\
         }\n",
        "import gg.Gg;\n\
         import gg.files.Files;\n\
         \n\
         public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       Gg.log(((Files.TextFile) Files.readFile(\"a.md\")).contents());\n\
         \x20   }\n\
         }\n",
    ] {
        let (outcome, log) = evaluate_as(
            &prepare(source),
            &all_operations(),
            &[],
            RunEnding::None,
            false,
            canned_outcome,
        );
        assert!(
            logs(&outcome)[0].starts_with("contents of a.md"),
            "{source}\n{:?}",
            outcome.logs
        );
        assert_eq!(log.names(), ["read_file"], "{source}");
    }

    // The `core` module's own line resolves the name refused above. It is a package rather than a
    // class, so the line the catalogue states is an on-demand import — and this is the case that
    // decides whether the exception the prompt tells every model to catch has a line to write.
    let published = |id: &str| -> String {
        java_language()
            .catalogue()
            .modules
            .iter()
            .find(|module| module.id == id)
            .and_then(|module| module.import.clone())
            .unwrap_or_else(|| panic!("the catalogue states a line for `{id}`"))
    };
    let (outcome, _) = evaluate_as(
        &prepare(&format!(
            "{}\n\
             \n\
             public final class Program {{\n\
             \x20   public static void main(String[] args) {{\n\
             \x20       ApiErrorCode code = ApiErrorCode.NOT_FOUND;\n\
             \x20       gg.Gg.log(code.toString());\n\
             \x20   }}\n\
             }}\n",
            published("core"),
        )),
        &all_operations(),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND"]);

    // And the lines the catalogue publishes are the ones written above, character for character,
    // rather than a second answer this test invented.
    assert_eq!(published("files"), "import gg.files.Files;");
    assert_eq!(published("core"), "import gg.*;");
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

#[test]
fn the_generated_catalogue_says_whose_spellings_it_carries() {
    // The capability gate itself now runs over this arm for free, because the arm is registered:
    // `agreement.test.rs` holds every registered language to gg's operations table, and this
    // catalogue is in it. What is left here is the one claim that gate cannot make — that the
    // committed file was generated **for Java** — asserted against the document rather than through
    // the language, so it holds even if the registration's own provenance check were removed.
    let document: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Java catalogue is valid JSON");
    assert_eq!(
        document["language"],
        json!("java"),
        "the catalogue says whose spellings it carries"
    );
    // Run here over this arm beside the one it was written against, which is a convenience rather
    // than a comparison: nothing in the gate reads one arm against another any more.
    assert!(
        super::super::agreement::disagreements(&[typescript_language(), java_language()])
            .is_empty(),
        "the registered Java arm does not offer gg's capability surface"
    );
}

#[test]
fn the_catalogue_carries_the_overload_groups_this_arm_exists_to_produce() {
    // Java has no default arguments, so every optional argument on this arm is an **overload** —
    // which is the shape the catalogue's `signatures` array was built for and which, until this arm,
    // only Ruby's block-or-argument pair had produced. What is asserted is that the shape is really
    // there and really carries different argument lists, because an overload group whose signatures
    // were identical would be a reflector bug that reads as a feature.
    //
    // The discriminator is the argument TYPES rather than the argument count, because on this arm
    // the count is not always what separates two overloads: `files.tree` offers `tree(String path)`
    // and `tree(int depth)` side by side, so that walking the root at a chosen depth does not have
    // to be written `tree(null, 3)`. Two one-argument signatures are what Java's own overload
    // resolution reads, and the catalogue has to carry both; two signatures of the same types are
    // what nothing could choose between.
    let document: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Java catalogue is valid JSON");

    let mut groups = 0usize;
    for entry in document["functions"].as_array().expect("an array") {
        let shapes = entry["signatures"].as_array().expect("an array");
        if shapes.len() < 2 {
            continue;
        }
        groups += 1;
        let lists: Vec<Vec<&str>> = shapes
            .iter()
            .map(|shape| {
                shape["parameters"]
                    .as_array()
                    .expect("an array")
                    .iter()
                    .map(|parameter| parameter["type"].as_str().expect("a type"))
                    .collect()
            })
            .collect();
        let mut distinct = lists.clone();
        distinct.sort_unstable();
        distinct.dedup();
        assert_eq!(
            distinct.len(),
            lists.len(),
            "`{}` carries two signatures taking the same argument types: {lists:?}",
            entry["name"]
        );
    }
    assert_eq!(
        groups, 14,
        "the entries this arm expresses as an overload group rather than as a default argument"
    );

    // And not one argument on this arm is passed by NAME: Java has no keyword arguments, so every
    // one of them is positional, and a `kind` of `keyword` here would mean the reflector had
    // invented a shape the language does not have.
    for entry in document["functions"].as_array().expect("an array") {
        for shape in entry["signatures"].as_array().expect("an array") {
            for parameter in shape["parameters"].as_array().expect("an array") {
                assert_eq!(
                    parameter["kind"],
                    json!("positional"),
                    "`{}` passes `{}` by name, which Java cannot do",
                    entry["name"],
                    parameter["name"]
                );
                assert_eq!(parameter["default"], json!(null), "Java states no defaults");
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The libraries
// ---------------------------------------------------------------------------------------------

/// One package this arm says a program may reach, and a real class in it to prove the claim.
///
/// The probe is deliberately a call rather than an import: TeaVM emits only what a program's call
/// graph reached, so an `import` alone proves nothing about whether the classlib carries anything
/// usable behind the name.
const PROBES: [(&str, &str); 22] = [
    ("java.lang", "Gg.log(Integer.toHexString(255));"),
    (
        "java.lang.annotation",
        "Gg.log(java.lang.annotation.RetentionPolicy.RUNTIME.name());",
    ),
    (
        "java.lang.ref",
        "Gg.log(new java.lang.ref.WeakReference<>(\"a\").get().toString());",
    ),
    (
        "java.lang.reflect",
        "Gg.log(String.valueOf(java.lang.reflect.Array.getLength(new int[3])));",
    ),
    (
        "java.util",
        "Gg.log(String.valueOf(new ArrayList<String>().size()));",
    ),
    (
        "java.util.function",
        "Function<String, String> same = value -> value; Gg.log(same.apply(\"a\"));",
    ),
    (
        "java.util.regex",
        "Gg.log(String.valueOf(Pattern.compile(\"a+\").matcher(\"aaa\").find()));",
    ),
    (
        "java.util.stream",
        "Gg.log(Stream.of(1, 2).map(String::valueOf).collect(Collectors.joining()));",
    ),
    (
        "java.util.concurrent",
        "Gg.log(String.valueOf(\
         new java.util.concurrent.ConcurrentHashMap<String, String>().size()));",
    ),
    (
        "java.util.concurrent.atomic",
        "Gg.log(String.valueOf(\
         new java.util.concurrent.atomic.AtomicLong(3).get()));",
    ),
    (
        "java.math",
        "Gg.log(new BigDecimal(\"1.5\").add(new BigDecimal(\"1\")).toString());",
    ),
    (
        "java.text",
        "Gg.log(NumberFormat.getInstance().format(1234));",
    ),
    (
        "java.nio.charset",
        "Gg.log(java.nio.charset.StandardCharsets.UTF_8.name());",
    ),
    ("java.time", "Gg.log(LocalDate.of(2026, 1, 2).toString());"),
    (
        "java.time.chrono",
        "Gg.log(java.time.chrono.IsoChronology.INSTANCE.getId());",
    ),
    (
        "java.time.format",
        "Gg.log(DateTimeFormatter.ISO_DATE.format(LocalDate.of(2026, 1, 2)));",
    ),
    (
        "java.time.temporal",
        "Gg.log(String.valueOf(\
         LocalDate.of(2026, 1, 2).get(java.time.temporal.ChronoField.YEAR)));",
    ),
    (
        "java.time.zone",
        "Gg.log(String.valueOf(\
         java.time.zone.ZoneRulesProvider.getAvailableZoneIds().isEmpty()));",
    ),
    (
        "java.io",
        "java.io.StringWriter written = new java.io.StringWriter(); written.write(\"a\"); \
         Gg.log(written.toString());",
    ),
    (
        "java.nio",
        "Gg.log(String.valueOf(java.nio.ByteBuffer.allocate(4).capacity()));",
    ),
    (
        "java.util.zip",
        "Gg.log(String.valueOf(new java.util.zip.CRC32().getValue()));",
    ),
    (
        "java.net",
        "Gg.log(new java.net.URI(\"https://x/y\").getHost());",
    ),
    // `java.util.logging` is declared and deliberately has no probe here: it is a package whose
    // whole point is a side effect, and a program that logged would be asserting on gg's operator
    // stream rather than on the classlib. It is covered by the manifest check below.
];

/// Methods a model reaches for first, inside packages [`PROBES`] has already established.
///
/// The package probes answer "may I import this?"; these answer the question a model actually asks,
/// which is "may I call this?". They are different questions because TeaVM's classlib is a subset of
/// `java.base` at **method** granularity as well as class granularity — a declared package can carry
/// a class that is missing a method every Java author uses. Two such gaps are recorded in
/// [`ABSENT`], and they are the reason this list exists: a declaration that is true of the package
/// and false of the call is a claim a model pays for.
const IDIOMS: [&str; 15] = [
    "Gg.log(\"  padded  \".strip());",
    // The workaround for the absent `String.lines()`, held to the artifact so the alternative this
    // arm's docs record is measured rather than plausible.
    "Gg.log(String.valueOf(\"a\\nb\".split(\"\\n\").length));",
    "Gg.log(\"ab\".repeat(2));",
    "Gg.log(String.valueOf(\" \".isBlank()));",
    "Gg.log(String.join(\"-\", \"a\", \"b\"));",
    "Gg.log(String.valueOf(Map.of(\"a\", 1).get(\"a\")));",
    "Gg.log(String.valueOf(Stream.of(1, 2).toList().size()));",
    "Gg.log(Optional.of(\"a\").orElseThrow());",
    "var inferred = List.of(\"a\", \"b\"); Gg.log(String.valueOf(inferred.size()));",
    "Gg.log(String.valueOf(Math.floorMod(-3, 5)));",
    "Gg.log(Arrays.toString(new int[] {1, 2}));",
    "Gg.log(String.valueOf(\
     Collections.unmodifiableList(new ArrayList<>(List.of(\"a\"))).size()));",
    "record Pair(int left, int right) {} Gg.log(new Pair(1, 2).toString());",
    "Gg.log(String.valueOf(new StringBuilder(\"ab\").reverse()));",
    "Gg.log(String.format(\"%.2f\", 1.5));",
];

/// Calls that a Java author would expect to work and that TeaVM's classlib does not carry.
///
/// Recorded rather than discovered in a transcript, because a study has to be able to say what each
/// arm was not given. The first two are whole packages; the last two are **methods inside packages
/// this arm declares**, which is the sharper fact: `String.lines()` is a first-reach-for method for
/// a model splitting a shell command's output, and `java.lang` is declared reachable.
///
/// Each costs the model a turn and nothing else — the diagnostic arrives at the model's own line on
/// the turn that wrote it — which is why this arm's docs name these by name rather than leaving
/// "a large subset" to be discovered.
const ABSENT: [&str; 4] = [
    "Gg.log(java.security.MessageDigest.getInstance(\"SHA-256\").getAlgorithm());\n",
    "Gg.log(String.valueOf(java.util.random.RandomGenerator.getDefault().nextInt(5)));\n",
    "Gg.log(String.valueOf(\"a\\nb\".lines().count()));\n",
    "Gg.log(new java.util.StringJoiner(\",\").add(\"a\").add(\"b\").toString());\n",
];

#[test]
fn java_reaches_every_library_this_arm_says_it_may() {
    // The claim `libraries.txt` makes about the ARTIFACT, held to the artifact. What a Java program
    // may reach is what TeaVM's classlib can translate, and a package this arm names that the
    // classlib does not carry would be a sentence in a system prompt sending a model down a path
    // that ends in a compile error it did not cause.
    let mut declared: Vec<String> = serde_json::from_str::<Value>(SIGNATURES)
        .expect("the generated Java catalogue is valid JSON")["libraries"]
        .as_array()
        .expect("an array")
        .iter()
        .flat_map(|group| group["modules"].as_array().expect("an array"))
        .map(|module| module.as_str().expect("a string").to_string())
        .collect();
    declared.sort();

    let mut probed: Vec<String> = PROBES
        .iter()
        .map(|(package, _)| (*package).to_string())
        .collect();
    probed.push("java.util.logging".to_string());
    probed.sort();
    assert_eq!(
        declared, probed,
        "every package the catalogue declares needs a probe, and only declared packages may have \
         one"
    );

    // One program, for the reason the crossing table is one: a compile costs a warm JVM ~0.4 s.
    // Every probe prints, so a package that compiled and then failed at run time is caught too —
    // and the method-level idioms ride in the same program, since they are the same question asked
    // at the granularity a model experiences.
    let program: String = PROBES
        .iter()
        .map(|(_, statement)| *statement)
        .chain(IDIOMS)
        .map(|statement| format!("{statement}\n"))
        .collect();
    let (outcome, _log) = run_with(&program, &[], canned_outcome);
    assert_eq!(
        logs(&outcome).len(),
        PROBES.len() + IDIOMS.len(),
        "every probe printed exactly once: {:?}",
        outcome.logs
    );

    // The absences are facts about TeaVM's classlib rather than policies, and are recorded as such:
    // a study has to say what each arm was NOT given. Two are packages and two are methods inside
    // packages this arm declares — the shape a "large subset" claim hides.
    for absent in ABSENT {
        let failure = compile_program(&whole(absent), &[], &PrepareContext::detached())
            .err()
            .unwrap_or_else(|| panic!("a classlib gap is refused at compile time: {absent}"));
        assert!(
            failure.to_string().contains("Program.java:"),
            "and is refused at the model's own line rather than at run time: {failure}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// A code module, in Java
// ---------------------------------------------------------------------------------------------

#[test]
fn a_code_module_is_reached_from_java_as_a_name_javac_checks() {
    // `lib.<key>.<name>` is a path rather than a string, because a Java code module is a class on
    // the program's own classpath: javac checks the call against the class it was compiled from, so
    // a key or an export a session does not have is a diagnostic on the turn that wrote it rather
    // than a failure at run time.
    let prepared = super::compile::compile_module(
        "helpers",
        "public static String greet(String who) { return \"hello, \" + who.toUpperCase(); }\n\
         \n\
         public static int add(int left, int right) { return left + right; }\n",
        &PrepareContext::detached(),
    )
    .expect("the Java toolchain compiles a code module");
    assert_eq!(export_names(&prepared.exports), ["greet", "add"]);

    let modules = vec![crate::sandbox::CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];
    let body = "Gg.log(lib.helpers.greet(\"gg\"));\n\
                Gg.log(String.valueOf(lib.helpers.add(40, 2)));\n";
    let (outcome, _log) = evaluate_as(
        &super::substrate::prepare_with(&whole(body), &modules),
        &[],
        &modules,
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["hello, GG", "42"]);

    // An export the module does not have is javac's own diagnostic, at the model's own line.
    let failure = compile_program(
        &whole("lib.helpers.absent();\n"),
        &modules,
        &PrepareContext::detached(),
    )
    .expect_err("a name a module does not offer does not compile");
    assert!(failure.to_string().contains("Program.java:"), "{failure}");
}
