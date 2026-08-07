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
use super::substrate::{evaluate_as, logs, program_error};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::PrepareContext;
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome, typescript as typescript_language};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::{ProgramErrorKind, SandboxOutcome};
use crate::tools::ToolOutcome;

/// The catalogue this arm commits, read as a document rather than through the language, because what
/// is asserted below is a property of the emitted JSON.
const SIGNATURES: &str = include_str!("../guests/java.signatures.json");

/// This arm, resolved from the registry — the same trait object a run resolves.
fn java_language() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::Java)
}

/// Compile and run one Java program, with the ending group and the library flag said out loud.
fn run_as(
    source: &str,
    enabled: &[String],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let prepared = match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the Java toolchain did not compile this program: {failure}"),
    };
    evaluate_as(&prepared, enabled, &[], ending, library, responder)
}

/// Compile and run one Java program with `enabled`'s tools offered and no ending group.
fn run_with(
    source: &str,
    enabled: &[String],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(source, enabled, RunEnding::None, false, responder)
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
            statement: "system.shell(\"npm test\", 30);",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: "fs.readFile(\"src/a.java\", 2, 5);",
            expected: || json!({ "path": "src/a.java", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: "fs.writeFile(\"out.txt\", \"hello\");",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: "fs.editFile(\"src/a.java\", \"alpha\", \"beta\");",
            expected: || json!({ "path": "src/a.java", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: "fs.listDir(\"src\");",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            statement: "skills.readSkill(\"testing\");",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: "memory.writeMemory(\"layout\", \"d\", \"b\");",
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: "memory.updateMemory(\"layout\", \"d2\", \"b2\");",
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, because Java is the arm where the two
            // code halves are a typed value rather than two optional arguments: `MemoryCode.of`
            // makes "an on-use script and no module" expressible, which a telescoping overload
            // chain could not have said at all.
            statement: "memory.createMemory(\"layout\", \"d\", \"b\", \
                        MemoryCode.of(\"static int one() { return 1; }\", \"view.openText(1);\"));",
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "static int one() { return 1; }",
                        "onUse": "view.openText(1);" })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: "memory.readMemory(\"layout\");",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: "memory.editMemory(\"layout\", \"old\", \"new\");",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: "memory.searchMemories(\"cargo\", \"nextest\");",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: "memory.deleteMemory(\"layout\");",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: "tasks.addTask(\"t1\", \"T\", \"D\", List.of(\"t0\"));",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: "tasks.updateTask(\"t1\", new TaskPatch().title(\"T2\")\
                        .clearDescription().status(TaskStatus.IN_PROGRESS));",
            expected: || {
                // `clearDescription()` is what CLEARS it — a field the patch was never asked about
                // is the one that keeps it — and `in_progress` is gg's own spelling, so the
                // membrane's `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: "tasks.setBlockedBy(\"t1\");",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: "tasks.completeTask(\"t1\");",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: "tasks.removeTask(\"t1\");",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: "project.createEpic(\"epc\", \"E\", \"D\");",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: "project.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\", \
                        new IssueOptions().reviewers(\"critic\"));",
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
            statement: "project.updateIssue(\"i1\", \
                        new IssuePatch().status(IssueStatus.DONE).clearEpic());",
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
            statement: "project.setIssueBlockedBy(\"i1\", \"i0\");",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: "project.removeEpic(\"e1\");",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: "project.removeIssue(\"i1\");",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: "project.waitForIssue(\"i1\");",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: "context.evictFileView(\"src/a.java\");",
            expected: || json!({ "path": "src/a.java" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a record of the two fields the header of every result carries,
            // constructed and passed variadically — which is what a list of spans is in a language
            // with no range literal and a `...` for the trailing one.
            statement: "context.archiveThread(new TurnRange(4, 19), new TurnRange(30, 35));",
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: "context.searchArchive(\"the parser\");",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: "context.compact(\"scaffolded the page\", \"src/Main.java\");",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.java"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a typed value rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: "agents.spawnSubagent(\"subagent\", Brief.prompt(\"write the lexer\"));",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: "agents.waitForSubagents(\"agent-1\");",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: "agents.sendMessage(\"agent-1\", \"prefer the simpler parser\");",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: "agents.transitionState(\"verify\", \"the build is green\");",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: "agents.exec(\"Builder\", \"pick it up from here\");",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: "agents.fork(\"try the other fix\");",
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
fn the_view_object_the_program_library_the_helper_and_the_endings_are_reached_in_java_too() {
    // The four families that are NOT gg tools, so none of them appears in the crossing table above —
    // and two of them are where a program puts something in front of the model, which makes them the
    // ones a silent bridging mistake would cost the most. Between this and the table, every function
    // this arm's catalogue describes has been driven through the real membrane.
    let (outcome, log) = run_as(
        "String text = fs.readTextFile(\"notes.md\", 1, 2);\n\
         FileRead read = view.openFile(\"notes.md\", 1, 2);\n\
         view.openText(\"summary\", text);\n\
         view.openDocsView(\"readFile\");\n\
         int closed = view.close(\"summary\");\n\
         int missing = view.close(\"never opened\");\n\
         List<OpenView> open = view.current();\n\
         List<FunctionSummary> directory = fs.list();\n\
         System.out.println(open.get(0).selector() + \" \" + open.get(0).kind());\n\
         System.out.println(closed + \" \" + missing);\n\
         System.out.println(switch (read) {\n\
         \x20   case TextFile file -> file.contents().split(\"\\n\")[0];\n\
         \x20   case ImageFile picture -> picture.label();\n\
         });\n\
         System.out.println(directory.stream().map(FunctionSummary::name)\n\
         \x20       .collect(Collectors.joining(\",\")));\n\
         harness.finish(\"read the file and showed myself the result\");\n",
        &all_tools(),
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
    assert_eq!(lines[3], "fsFunction");
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
        "List<ProgramSummary> history = programs.history();\n\
         System.out.println(String.valueOf(history.size()));\n\
         try { programs.get(2); }\n\
         catch (ToolError failure) { System.out.println(failure.code().toString()); }\n\
         programs.rerun(\"System.out.println(\\\"again\\\");\");\n\
         review.requestChanges(\"widen the test\", \"name the file\");\n",
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
        "review.approve();\n",
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

#[test]
fn a_failure_is_a_java_exception_whether_it_is_caught_or_not() {
    // The whole of this arm's failure story, and the half of it that is Java's rather than gg's.
    // TeaVM wraps a JavaScript exception crossing into Java in a `RuntimeException` it prefixes
    // with `(JavaScript) `, so a `catch (ToolError failure)` would catch NOTHING if the SDK let the
    // guest's throw propagate. It catches the throw in JavaScript instead and raises a real Java
    // exception, which is what makes the clause below work at all.
    let (outcome, _log) = run_with(
        "try {\n\
         \x20   fs.readTextFile(\"gone.java\");\n\
         } catch (ToolError failure) {\n\
         \x20   System.out.println(failure.code() + \" on \" + failure.tool());\n\
         }\n\
         System.out.println(\"carried on\");\n",
        &all_tools(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.java".to_string(),
            )
        },
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on read_file", "carried on"]);

    // And the half that no SDK could do for itself: one that ESCAPED must still reach the guest as a
    // tool failure rather than as a Java exception, because gg classifies a turn's error from the
    // host's own code. gg's generated entry class records the three fields on the way past and the
    // bundle's tail throws those instead of the Java object.
    let (outcome, _log) = run_with(
        "System.out.println(\"before\");\n\
         fs.readTextFile(\"gone.java\");\n\
         System.out.println(\"after\");\n",
        &all_tools(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.java".to_string(),
            )
        },
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure, "{error:?}");
    assert!(
        error.message.contains("`read_file` failed (not-found)"),
        "the model reads gg's own sentence rather than a Java class: {}",
        error.message
    );
    assert_eq!(outcome.logs, ["before"], "what ran before it still stands");
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // The SDK exposes the whole surface — it is compiled once, into a jar, and a run's enabled set
    // is decided per run — so what stops a withheld capability from being reachable is a refusal
    // rather than a missing name. It carries the code the HOST refuses an out-of-set call with,
    // because gg classifies a turn's error from the code: a capability nobody granted must not be
    // recorded as a name the model got wrong.
    let (outcome, log) = run_with("fs.readTextFile(\"src/Main.java\");\n", &[], canned_outcome);
    let error = program_error(&outcome);
    // `UnknownName` is what gg makes of an `unavailable` code, whichever side raised it: the two are
    // one fact and one recovery — this run does not offer that call.
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
    assert!(
        error.message.contains("fs.readTextFile"),
        "the refusal names the call the model wrote: {}",
        error.message
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");

    // The same refusal is catchable, which is what makes a program able to probe its own surface
    // rather than crash on it.
    let (outcome, _log) = run_with(
        "try { agents.fork(\"a copy\"); }\n\
         catch (ToolError failure) { System.out.println(failure.code().wireName()); }\n",
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable"]);
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

#[test]
fn the_committed_catalogue_says_whose_spellings_it_carries() {
    // The agreement gate itself now runs over this arm for free, because the arm is registered:
    // `agreement.test.rs` compares every registered language identity-for-identity, and this
    // catalogue is in it. What is left here is the one claim that gate cannot make — that the
    // committed file was generated **for Java** — asserted against the document rather than through
    // the language, so it holds even if the registration's own provenance check were removed.
    let document: Value =
        serde_json::from_str(SIGNATURES).expect("the committed Java catalogue is valid JSON");
    assert_eq!(
        document["language"],
        json!("java"),
        "the catalogue says whose spellings it carries"
    );
    assert!(
        super::super::agreement::disagreements(&[typescript_language(), java_language()])
            .is_empty(),
        "the registered Java arm does not describe the same capability surface TypeScript does"
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
        serde_json::from_str(SIGNATURES).expect("the committed Java catalogue is valid JSON");

    let mut groups = 0usize;
    for section in ["meta", "session", "views", "programs", "tools", "helpers"] {
        for entry in document[section].as_array().expect("an array") {
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
    }
    assert_eq!(
        groups, 14,
        "the entries this arm expresses as an overload group rather than as a default argument"
    );

    // And not one argument on this arm is passed by NAME: Java has no keyword arguments, so every
    // one of them is positional, and a `kind` of `keyword` here would mean the reflector had
    // invented a shape the language does not have.
    for section in ["meta", "session", "views", "programs", "tools", "helpers"] {
        for entry in document[section].as_array().expect("an array") {
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
    ("java.lang", "System.out.println(Integer.toHexString(255));"),
    (
        "java.lang.annotation",
        "System.out.println(java.lang.annotation.RetentionPolicy.RUNTIME.name());",
    ),
    (
        "java.lang.ref",
        "System.out.println(new java.lang.ref.WeakReference<>(\"a\").get().toString());",
    ),
    (
        "java.lang.reflect",
        "System.out.println(String.valueOf(java.lang.reflect.Array.getLength(new int[3])));",
    ),
    (
        "java.util",
        "System.out.println(String.valueOf(new ArrayList<String>().size()));",
    ),
    (
        "java.util.function",
        "Function<String, String> same = value -> value; System.out.println(same.apply(\"a\"));",
    ),
    (
        "java.util.regex",
        "System.out.println(String.valueOf(Pattern.compile(\"a+\").matcher(\"aaa\").find()));",
    ),
    (
        "java.util.stream",
        "System.out.println(Stream.of(1, 2).map(String::valueOf).collect(Collectors.joining()));",
    ),
    (
        "java.util.concurrent",
        "System.out.println(String.valueOf(\
         new java.util.concurrent.ConcurrentHashMap<String, String>().size()));",
    ),
    (
        "java.util.concurrent.atomic",
        "System.out.println(String.valueOf(\
         new java.util.concurrent.atomic.AtomicLong(3).get()));",
    ),
    (
        "java.math",
        "System.out.println(new BigDecimal(\"1.5\").add(new BigDecimal(\"1\")).toString());",
    ),
    (
        "java.text",
        "System.out.println(NumberFormat.getInstance().format(1234));",
    ),
    (
        "java.nio.charset",
        "System.out.println(java.nio.charset.StandardCharsets.UTF_8.name());",
    ),
    (
        "java.time",
        "System.out.println(LocalDate.of(2026, 1, 2).toString());",
    ),
    (
        "java.time.chrono",
        "System.out.println(java.time.chrono.IsoChronology.INSTANCE.getId());",
    ),
    (
        "java.time.format",
        "System.out.println(DateTimeFormatter.ISO_DATE.format(LocalDate.of(2026, 1, 2)));",
    ),
    (
        "java.time.temporal",
        "System.out.println(String.valueOf(\
         LocalDate.of(2026, 1, 2).get(java.time.temporal.ChronoField.YEAR)));",
    ),
    (
        "java.time.zone",
        "System.out.println(String.valueOf(\
         java.time.zone.ZoneRulesProvider.getAvailableZoneIds().isEmpty()));",
    ),
    (
        "java.io",
        "java.io.StringWriter written = new java.io.StringWriter(); written.write(\"a\"); \
         System.out.println(written.toString());",
    ),
    (
        "java.nio",
        "System.out.println(String.valueOf(java.nio.ByteBuffer.allocate(4).capacity()));",
    ),
    (
        "java.util.zip",
        "System.out.println(String.valueOf(new java.util.zip.CRC32().getValue()));",
    ),
    (
        "java.net",
        "System.out.println(new java.net.URI(\"https://x/y\").getHost());",
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
    "System.out.println(\"  padded  \".strip());",
    // The workaround the prompt offers for the absent `String.lines()`, held to the artifact so the
    // advice is measured rather than plausible.
    "System.out.println(String.valueOf(\"a\\nb\".split(\"\\n\").length));",
    "System.out.println(\"ab\".repeat(2));",
    "System.out.println(String.valueOf(\" \".isBlank()));",
    "System.out.println(String.join(\"-\", \"a\", \"b\"));",
    "System.out.println(String.valueOf(Map.of(\"a\", 1).get(\"a\")));",
    "System.out.println(String.valueOf(Stream.of(1, 2).toList().size()));",
    "System.out.println(Optional.of(\"a\").orElseThrow());",
    "var inferred = List.of(\"a\", \"b\"); System.out.println(String.valueOf(inferred.size()));",
    "System.out.println(String.valueOf(Math.floorMod(-3, 5)));",
    "System.out.println(Arrays.toString(new int[] {1, 2}));",
    "System.out.println(String.valueOf(\
     Collections.unmodifiableList(new ArrayList<>(List.of(\"a\"))).size()));",
    "record Pair(int left, int right) {} System.out.println(new Pair(1, 2).toString());",
    "System.out.println(String.valueOf(new StringBuilder(\"ab\").reverse()));",
    "System.out.println(String.format(\"%.2f\", 1.5));",
];

/// Calls that a Java author would expect to work and that TeaVM's classlib does not carry.
///
/// Recorded rather than discovered in a transcript, because a study has to be able to say what each
/// arm was not given. The first two are whole packages; the last two are **methods inside packages
/// this arm declares**, which is the sharper fact: `String.lines()` is a first-reach-for method for
/// a model splitting a shell command's output, and `java.lang` is declared reachable.
///
/// Each costs the model a turn and nothing else — the diagnostic arrives at the model's own line on
/// the turn that wrote it — which is why the prompt and the docs name these by name rather than
/// leaving "a large subset" to be discovered.
const ABSENT: [&str; 4] = [
    "System.out.println(java.security.MessageDigest.getInstance(\"SHA-256\").getAlgorithm());\n",
    "System.out.println(String.valueOf(java.util.random.RandomGenerator.getDefault().nextInt(5)));\n",
    "System.out.println(String.valueOf(\"a\\nb\".lines().count()));\n",
    "System.out.println(new java.util.StringJoiner(\",\").add(\"a\").add(\"b\").toString());\n",
];

#[test]
fn java_reaches_every_library_this_arm_says_it_may() {
    // The claim `libraries.txt` makes about the ARTIFACT, held to the artifact. What a Java program
    // may reach is what TeaVM's classlib can translate, and a package this arm names that the
    // classlib does not carry would be a sentence in a system prompt sending a model down a path
    // that ends in a compile error it did not cause.
    let mut declared: Vec<String> = serde_json::from_str::<Value>(SIGNATURES)
        .expect("the committed Java catalogue is valid JSON")["libraries"]
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
        let failure = compile_program(absent, &PrepareContext::new())
            .err()
            .unwrap_or_else(|| panic!("a classlib gap is refused at compile time: {absent}"));
        assert!(
            failure.to_string().contains("program.java:1"),
            "and is refused at the model's own line rather than at run time: {failure}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// A code module, in Java
// ---------------------------------------------------------------------------------------------

#[test]
fn a_code_module_is_reached_from_java_rather_than_only_from_javascript() {
    // `lib` is the one place in this SDK where the PROGRAM says what type it expects, because a code
    // module is compiled separately and there is no `import` for javac to check the two against —
    // the position a Java author is in when they reach something with reflection, answered the way
    // Java answers it.
    let (module, exports) = super::compile::compile_module(
        "public static String greet(String who) { return \"hello, \" + who.toUpperCase(); }\n\
         \n\
         public static int add(int left, int right) { return left + right; }\n",
        &PrepareContext::new(),
    )
    .expect("the Java toolchain compiles a code module");
    assert_eq!(exports, ["greet", "add"]);

    let (outcome, _log) = evaluate_as(
        &match compile_program(
            "System.out.println(lib.text(\"helpers\", \"greet\", \"gg\"));\n\
             System.out.println(String.valueOf(lib.number(\"helpers\", \"add\", 40, 2)));\n\
             System.out.println(String.valueOf(lib.has(\"helpers\", \"greet\")));\n\
             System.out.println(String.valueOf(lib.has(\"helpers\", \"absent\")));\n\
             try { lib.run(\"helpers\", \"absent\"); }\n\
             catch (ToolError failure) { System.out.println(failure.code().wireName()); }\n",
            &PrepareContext::new(),
        ) {
            Ok(prepared) => prepared.source,
            Err(failure) => panic!("the Java toolchain did not compile this program: {failure}"),
        },
        &[],
        &[crate::sandbox::CodeModule {
            name: "helpers".to_string(),
            source: module,
        }],
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["hello, GG", "42", "true", "false", "not-found"]
    );
}
