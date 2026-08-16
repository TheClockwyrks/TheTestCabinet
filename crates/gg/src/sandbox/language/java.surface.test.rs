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
//! # Why they are consolidated all the same
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 20 MB component and start a JVM that loads TeaVM. So each function drives *many*
//! programs rather than being one behaviour per function. Add a statement to an existing function
//! rather than adding a function.

use serde_json::{Value, json};

use super::compile::compile_program;
use super::substrate::{
    evaluate_as, evaluate_closing_docviews, java_language, logs, prepare, trap,
};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::PrepareContext;
use crate::sandbox::fake::{
    CallLog, all_operations, canned_outcome, typescript as typescript_language,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::SandboxOutcome;
use crate::tools::ToolOutcome;

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
    for class in ["Gg", "ToolError", "ToolErrorCode"] {
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

/// Compile and run one Java program with `enabled`'s tools offered and no ending group.
fn run_with(
    body: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(body, operations, RunEnding::None, false, responder)
}

// ---------------------------------------------------------------------------------------------
// Every tool, from its Java spelling
// ---------------------------------------------------------------------------------------------

/// One tool, called through the Java spelling of it, and the JSON gg's dispatch must have seen.
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
fn every_tool_crosses_the_membrane_from_its_java_spelling() {
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

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than
    // shipping as a typed method nobody ever called.
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
fn the_documentation_the_views_the_program_library_the_helper_and_the_endings_are_reached_too() {
    // The five families that are NOT gg tools, so none of them appears in the crossing table above —
    // and two of them are where a program puts something in front of the model, which makes them the
    // ones a silent bridging mistake would cost the most. Between this, the table, and the member
    // functions driven at the end of this function, every entry this arm's catalogue describes has
    // been driven through the real membrane.
    let (outcome, log) = run_as(
        "String text = Files.readTextFile(\"notes.md\", 1, 2);\n\
         Files.FileRead read = Views.openFile(\"notes.md\", 1, 2);\n\
         Views.openText(\"summary\", text);\n\
         Views.openDocsView(\"readFile\");\n\
         int closed = Views.close(\"summary\");\n\
         int missing = Views.close(\"never opened\");\n\
         List<Views.OpenView> open = Views.current();\n\
         Gg.log(open.get(0).selector() + \" \" + open.get(0).kind());\n\
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
    // What is still open is the file view, carrying the enum constant rather than the word the wire
    // used; the text view the program closed is gone, and a documentation view is gg's to deliver on
    // the next turn rather than something `current` reports.
    assert_eq!(lines[0], "notes.md FILE");
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
    // `view.openFile` performs. Neither has a tool name of its own, which is exactly the point — a
    // helper is a spelling of the tool it is built on, and a view is a read gg also shows you.
    assert_eq!(log.names(), ["read_file", "read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );

    // The program library is bound from the capability rather than from a tool name, and a reviewer
    // gets the other ending group and no `harness.finish` at all.
    let (outcome, _log) = run_as(
        "List<Programs.ProgramSummary> history = Programs.history();\n\
         Gg.log(String.valueOf(history.size()));\n\
         try { Programs.get(2); }\n\
         catch (ToolError failure) { Gg.log(failure.code().toString()); }\n\
         Programs.rerun(\"Gg.log(\\\"again\\\");\");\n\
         Session.requestChanges(\"widen the test\", \"name the file\");\n",
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never an error — and a turn it never
    // kept a program for is a `NOT_FOUND` the program catches in Java's own idiom.
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
         Gg.log(String.valueOf(Views.current().get(0).close()));\n\
         try {\n\
         \x20   new Programs.ProgramSummary(2, 1, 1, true, Optional.empty()).source();\n\
         } catch (ToolError failure) {\n\
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
    // driven from Java's own spellings — the bare overload, and the one that carries the filters as
    // a chained `SearchFilters`, which is how this arm expresses an options object a language with
    // keyword arguments would write inline.
    //
    // The double models no catalogue, so an empty page is the honest answer and the ranking is
    // `DocsRuntime`'s to be right about. What is observed here is this arm's own half: that the
    // filters reach the guest as one object rather than as five arguments, and that the envelope
    // comes back as a `DocSearch` a program reads fields off.
    let (outcome, _log) = run_with(
        "Docs.DocSearch all = Docs.search(\"view\");\n\
         Docs.DocSearch narrowed = Docs.search(\"\",\n\
         \x20       new Docs.SearchFilters().module(\"gg.views.Views\")\n\
         \x20               .kind(Docs.DocKind.FUNCTION).limit(5));\n\
         Gg.log(all.total() + \" \" + all.offset() + \" \" + all.hits().size());\n\
         Gg.log(String.valueOf(narrowed.hits().isEmpty()));\n\
         try {\n\
         \x20   Docs.close(\"gg.files.Files.readFile\");\n\
         } catch (ToolError failure) {\n\
         \x20   Gg.log(failure.code() + \" \" + failure.tool());\n\
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

    // Exhaustive by construction, the way the crossing table is: a sixth member function added to
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
            "gg.views.Views.OpenView#close",
        ],
        "every member function this arm catalogues needs a call in the program above"
    );
}

#[test]
fn a_failure_is_a_java_exception_whether_it_is_caught_or_not() {
    // The whole of this arm's failure story, and the half of it that is Java's rather than gg's.
    // TeaVM wraps a JavaScript exception crossing into Java in a `RuntimeException` it prefixes
    // with `(JavaScript) `, so a `catch (ToolError failure)` would catch NOTHING if the SDK let the
    // guest's throw propagate. It catches the throw in JavaScript instead and raises a real Java
    // exception, which is what makes the clause below work at all.
    let (outcome, _log) = run_with(
        "try {\n\
         \x20   Files.readTextFile(\"gone.java\");\n\
         } catch (ToolError failure) {\n\
         \x20   Gg.log(failure.code() + \" on \" + failure.tool());\n\
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
    assert_eq!(
        logs(&outcome),
        ["NOT_FOUND on read_text_file", "carried on"]
    );

    // And the half that no SDK could do for itself: one that ESCAPED kills the program the way its
    // runtime kills it, and what the model reads is the exception's own message — which is why
    // `ToolError` builds one carrying all three of gg's fields — and the model's own line.
    let (outcome, _log) = run_with(
        "Gg.log(\"before\");\n\
         Files.readTextFile(\"gone.java\");\n\
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
        reported.contains("`read_text_file` failed (not-found): no such file: gone.java"),
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
    let (outcome, log) = run_with(
        "Files.readTextFile(\"src/Main.java\");\n",
        &[],
        canned_outcome,
    );
    let reported = trap(&outcome);
    assert!(
        reported.contains("`gg.files.Files.readTextFile` is not available."),
        "the refusal names the call the way this arm's catalogue spells it: {reported}"
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");

    // The same refusal is catchable, which is what makes a program able to probe its own surface
    // rather than crash on it.
    let (outcome, _log) = run_with(
        "try { Delegation.fork(\"a copy\"); }\n\
         catch (ToolError failure) { Gg.log(failure.code().wireName()); }\n",
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable"]);
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
        compile_program(source, &[], &PrepareContext::new())
            .expect_err("a name nothing brought into scope is refused")
            .to_string()
    };

    // A module reached by its short name with no import above it: javac's own unresolved-symbol
    // diagnostic, at the model's own line.
    let diagnostic = refused(
        "public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       String text = Files.readTextFile(\"a.md\");\n\
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
         \x20       ToolErrorCode code = null;\n\
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
         \x20       Gg.log(gg.files.Files.readTextFile(\"a.md\"));\n\
         \x20   }\n\
         }\n",
        "import gg.Gg;\n\
         import gg.files.Files;\n\
         \n\
         public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       Gg.log(Files.readTextFile(\"a.md\"));\n\
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

    // And the line the catalogue publishes for `files` is the one written above, character for
    // character, rather than a second answer this test invented.
    let published = java_language()
        .catalogue()
        .modules
        .iter()
        .find(|module| module.id == "files")
        .and_then(|module| module.import.clone())
        .expect("the catalogue states a line for `files`");
    assert_eq!(published, "import gg.files.Files;");
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
    let document: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Java catalogue is valid JSON");

    let mut groups = 0usize;
    for entry in document["functions"].as_array().expect("an array") {
        let shapes = entry["signatures"].as_array().expect("an array");
        if shapes.len() < 2 {
            continue;
        }
        groups += 1;
        let lists: Vec<usize> = shapes
            .iter()
            .map(|shape| shape["parameters"].as_array().expect("an array").len())
            .collect();
        let mut distinct = lists.clone();
        distinct.sort_unstable();
        distinct.dedup();
        assert_eq!(
            distinct.len(),
            lists.len(),
            "`{}` carries two signatures taking the same number of arguments",
            entry["name"]
        );
    }
    assert_eq!(
        groups, 15,
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
        let failure = compile_program(&whole(absent), &[], &PrepareContext::new())
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
    // `Lib.<key>.<name>` is a path rather than a string, because a Java code module is compiled
    // **into** the program that uses it: there is an `import`-free path for javac to check the two
    // against, so a key or an export a session does not have is a diagnostic on the turn that wrote
    // it rather than a failure at run time.
    let prepared = super::compile::compile_module(
        "public static String greet(String who) { return \"hello, \" + who.toUpperCase(); }\n\
         \n\
         public static int add(int left, int right) { return left + right; }\n",
        &PrepareContext::new(),
    )
    .expect("the Java toolchain compiles a code module");
    assert_eq!(prepared.exports, ["greet", "add"]);

    let modules = vec![crate::sandbox::CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];
    let body = "Gg.log(Lib.helpers.greet(\"gg\"));\n\
                Gg.log(String.valueOf(Lib.helpers.add(40, 2)));\n";
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
        &whole("Lib.helpers.absent();\n"),
        &modules,
        &PrepareContext::new(),
    )
    .expect_err("a name a module does not offer does not compile");
    assert!(failure.to_string().contains("Program.java:"), "{failure}");
}
