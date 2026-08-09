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
//! # Why they are consolidated all the same
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 13.4 MB component and start a JVM that loads the Kotlin compiler and TeaVM. So each
//! function drives *many* programs rather than being one behaviour per function. Add a statement to
//! an existing function rather than adding a function.

use serde_json::{Value, json};

use super::compile::{compile_module, compile_program};
use super::substrate::{evaluate_as, logs, program_error};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::{ProgramErrorKind, SandboxOutcome};
use crate::sandbox::{CodeModule, PrepareContext};
use crate::tools::ToolOutcome;

/// The catalogue this arm commits, read as a **document** rather than through the language.
///
/// What every assertion below makes is a claim about the emitted JSON's own shape — which key a
/// parameter's prose hangs off, whether a default is recorded beside it — so reading it as a document
/// is the reading that can fail. Resolving it through the registry would only prove that the registry
/// hands back the bytes this file already has.
const SIGNATURES: &str = include_str!("../guests/kotlin.signatures.json");

/// Compile and run one Kotlin program, with the ending group and the library flag said out loud.
fn run_as(
    source: &str,
    enabled: &[String],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let prepared = match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the Kotlin toolchain did not compile this program: {failure}"),
    };
    evaluate_as(&prepared, enabled, &[], ending, library, responder)
}

/// Compile and run one Kotlin program with `enabled`'s tools offered and no ending group.
fn run_with(
    source: &str,
    enabled: &[String],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(source, enabled, RunEnding::None, false, responder)
}

// ---------------------------------------------------------------------------------------------
// Every tool, from its Kotlin spelling
// ---------------------------------------------------------------------------------------------

/// One tool, called through the Kotlin spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic Kotlin function.
///
/// Deliberately the same table `sandbox.membrane.test.rs` drives the TypeScript arm with and the
/// Python, Ruby, PureScript and Java arms drive theirs with, down to the arguments and the expected
/// JSON — because the expected JSON is the point. gg's dispatch is language-independent: seven arms
/// writing the same call in their own idioms must produce **byte-identical** arguments, or they are
/// not running the same experiment. A named argument bound to the wrong wire field, a `Patch.Clear`
/// read as "leave it alone" instead of "clear it", an enum entry whose wire word did not translate —
/// none of them is a compile error in any of the seven, and all of them are visible here.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: "system.shell(\"npm test\", timeoutSecs = 30)",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: "fs.readFile(\"src/a.kt\", offset = 2, limit = 5)",
            expected: || json!({ "path": "src/a.kt", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: "fs.writeFile(\"out.txt\", \"hello\")",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: "fs.editFile(\"src/a.kt\", \"alpha\", \"beta\")",
            expected: || json!({ "path": "src/a.kt", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: "fs.listDir(\"src\")",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            statement: "skills.readSkill(\"testing\")",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: "memory.writeMemory(\"layout\", \"d\", \"b\")",
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: "memory.updateMemory(\"layout\", \"d2\", \"b2\")",
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
            statement: "memory.createMemory(\"layout\", \"d\", \"b\", \
                        code = \"fun one() = 1\", onUse = \"view.openText(\\\"n\\\", \\\"1\\\")\")",
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "fun one() = 1",
                        "onUse": "view.openText(\"n\", \"1\")" })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: "memory.readMemory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: "memory.editMemory(\"layout\", \"old\", \"new\")",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: "memory.searchMemories(\"cargo\", \"nextest\")",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: "memory.deleteMemory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: "tasks.addTask(\"t1\", \"T\", \"D\", listOf(\"t0\"))",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: "tasks.updateTask(\"t1\", title = \"T2\", \
                        description = Patch.Clear, status = TaskStatus.IN_PROGRESS)",
            expected: || {
                // `Patch.Clear` is what CLEARS it — a field the call never names is the one that
                // keeps it — and `in_progress` is gg's own spelling, so the membrane's `in-progress`
                // reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: "tasks.setBlockedBy(\"t1\")",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: "tasks.completeTask(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: "tasks.removeTask(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: "project.createEpic(\"epc\", \"E\", \"D\")",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: "project.createIssue(\"I\", \"s\", \"o\", \"c\", \"worker\", \
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
            statement: "project.updateIssue(\"i1\", status = IssueStatus.DONE, \
                        epicId = Patch.Clear)",
            expected: || {
                // `Patch.Clear` on the epic ungroups the issue, which gg's schema spells as the
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
            statement: "project.setIssueBlockedBy(\"i1\", \"i0\")",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: "project.removeEpic(\"e1\")",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: "project.removeIssue(\"i1\")",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: "project.waitForIssue(\"i1\")",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: "context.evictFileView(\"src/a.kt\")",
            expected: || json!({ "path": "src/a.kt" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a **range**, because that is what a span of integers is in this
            // language — and `..<` says the same span the other way, which is the shape a model
            // reaching for an exclusive end writes.
            statement: "context.archiveThread(4..19, 30..<36)",
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: "context.searchArchive(\"the parser\")",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: "context.compact(\"scaffolded the page\", \"src/Main.kt\")",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.kt"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a sealed type rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: "agents.spawnSubagent(\"subagent\", Brief.Prompt(\"write the lexer\"))",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: "agents.waitForSubagents(\"agent-1\")",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: "agents.sendMessage(\"agent-1\", \"prefer the simpler parser\")",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: "agents.transitionState(\"verify\", note = \"the build is green\")",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: "agents.exec(\"Builder\", prompt = \"pick it up from here\")",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: "agents.fork(\"try the other fix\")",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_tool_crosses_the_membrane_from_its_kotlin_spelling() {
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

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than shipping
    // as a typed function nobody ever called.
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
fn the_view_object_the_program_library_the_helper_and_the_endings_are_reached_in_kotlin_too() {
    // The four families that are NOT gg tools, so none of them appears in the crossing table above —
    // and two of them are where a program puts something in front of the model, which makes them the
    // ones a silent bridging mistake would cost the most. Between this and the table, every function
    // this arm's catalogue describes has been driven through the real membrane.
    let (outcome, log) = run_as(
        "val text = fs.readTextFile(\"notes.md\", offset = 1, limit = 2)\n\
         val read = view.openFile(\"notes.md\", offset = 1, limit = 2)\n\
         view.openText(\"summary\", text)\n\
         view.openDocsView(\"readFile\")\n\
         val closed = view.close(\"summary\")\n\
         val missing = view.close(\"never opened\")\n\
         val open = view.current()\n\
         val directory = fs.list()\n\
         println(open[0].selector + \" \" + open[0].kind)\n\
         println(\"$closed $missing\")\n\
         println(when (read) {\n\
         \x20   is TextFile -> read.contents.lines()[0]\n\
         \x20   is ImageFile -> read.label\n\
         })\n\
         println(directory.joinToString(\",\") { it.name })\n\
         harness.finish(\"read the file and showed myself the result\")\n",
        &all_tools(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // What is still open is the file view, carrying the enum entry rather than the word the wire
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
        "val history = programs.history()\n\
         println(history.size.toString())\n\
         try {\n\
         \x20   programs.get(2)\n\
         } catch (failure: ToolError) {\n\
         \x20   println(failure.code.toString())\n\
         }\n\
         programs.rerun(\"println(\\\"again\\\")\")\n\
         review.requestChanges(\"widen the test\", \"name the file\")\n",
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never an error — and a turn it never kept
    // a program for is a `NOT_FOUND` the program catches in Kotlin's own idiom.
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
        "review.approve()\n",
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
fn a_failure_is_a_kotlin_exception_whether_it_is_caught_or_not() {
    // The whole of this arm's failure story, and the half of it that is the toolchain's rather than
    // gg's. TeaVM wraps a JavaScript exception crossing into the JVM world in a `RuntimeException` it
    // prefixes with `(JavaScript) `, so a `catch (failure: ToolError)` would catch NOTHING if the SDK
    // let the guest's throw propagate. It catches the throw in JavaScript instead and raises a real
    // Kotlin exception, which is what makes the clause below work at all.
    let (outcome, _log) = run_with(
        "try {\n\
         \x20   fs.readTextFile(\"gone.kt\")\n\
         } catch (failure: ToolError) {\n\
         \x20   println(\"${failure.code} on ${failure.tool}\")\n\
         }\n\
         println(\"carried on\")\n",
        &all_tools(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.kt".to_string(),
            )
        },
    );
    assert_eq!(logs(&outcome), ["NOT_FOUND on read_file", "carried on"]);

    // And the half that no SDK could do for itself: one that ESCAPED must still reach the guest as a
    // tool failure rather than as a JVM exception, because gg classifies a turn's error from the
    // host's own code. gg's generated entry class records the three fields on the way past and the
    // bundle's tail throws those instead of the exception object.
    let (outcome, _log) = run_with(
        "println(\"before\")\n\
         fs.readTextFile(\"gone.kt\")\n\
         println(\"after\")\n",
        &all_tools(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.kt".to_string(),
            )
        },
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure, "{error:?}");
    assert!(
        error.message.contains("`read_file` failed (not-found)"),
        "the model reads gg's own sentence rather than a Kotlin class: {}",
        error.message
    );
    assert_eq!(outcome.logs, ["before"], "what ran before it still stands");

    // A `runCatching` is the other way a Kotlin author reaches a failure, and it works for the same
    // reason: what the SDK raises is an ordinary exception rather than something the bridge wrapped.
    let (outcome, _log) = run_with(
        "val read = runCatching { fs.readTextFile(\"gone.kt\") }\n\
         println(read.exceptionOrNull().let { it is ToolError }.toString())\n",
        &all_tools(),
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
    // The SDK exposes the whole surface — it is compiled once, into a jar, and a run's enabled set is
    // decided per run — so what stops a withheld capability from being reachable is a refusal rather
    // than a missing name. It carries the code the HOST refuses an out-of-set call with, because gg
    // classifies a turn's error from the code: a capability nobody granted must not be recorded as a
    // name the model got wrong.
    let (outcome, log) = run_with("fs.readTextFile(\"src/Main.kt\")\n", &[], canned_outcome);
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
        "try {\n\
         \x20   agents.fork(\"a copy\")\n\
         } catch (failure: ToolError) {\n\
         \x20   println(failure.code.wireName)\n\
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
        serde_json::from_str(SIGNATURES).expect("the committed Kotlin catalogue is valid JSON");

    let mut defaults = 0usize;
    let mut varargs = 0usize;
    for section in ["meta", "session", "views", "programs", "tools", "helpers"] {
        for entry in document[section].as_array().expect("an array") {
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
                    // POSITION: `memory.searchMemories("a", "b")` names no parameter.
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
            probe: "println((\"ab\".repeat(2)))",
            expected: "abab",
        },
        Library {
            package: "kotlin.collections",
            probe: "println(listOf(3, 1, 2).sorted().joinToString(\"-\"))",
            expected: "1-2-3",
        },
        Library {
            package: "kotlin.text",
            probe: "println(Regex(\"a(\\\\d+)\").find(\"a42\")!!.groupValues[1])",
            expected: "42",
        },
        Library {
            package: "kotlin.ranges",
            probe: "println((1..4).sum().toString())",
            expected: "10",
        },
        Library {
            package: "kotlin.sequences",
            probe: "println(sequenceOf(1, 2, 3).map { it * 2 }.joinToString(\",\"))",
            expected: "2,4,6",
        },
        Library {
            package: "kotlin.comparisons",
            probe: "println(listOf(\"bb\", \"a\").sortedWith(compareBy { it.length })[0])",
            expected: "a",
        },
        Library {
            package: "kotlin.io",
            probe: "print(\"printed\\n\")",
            expected: "printed",
        },
        Library {
            package: "kotlin.math",
            probe: "println(kotlin.math.max(2, 3).toString())",
            expected: "3",
        },
        Library {
            package: "kotlin.random",
            probe: "println((kotlin.random.Random(7).nextInt(10) in 0..9).toString())",
            expected: "true",
        },
        Library {
            package: "kotlin.time",
            probe: "println(kotlin.time.Duration.parse(\"1m\").toString())",
            expected: "1m",
        },
        Library {
            package: "java.lang",
            probe: "println(java.lang.Integer.toHexString(255))",
            expected: "ff",
        },
        Library {
            package: "java.util",
            probe: "println(java.util.ArrayList(listOf(\"x\")).size.toString())",
            expected: "1",
        },
        Library {
            package: "java.math",
            probe: "println(java.math.BigInteger(\"2\").pow(70).toString())",
            expected: "1180591620717411303424",
        },
        Library {
            package: "java.time",
            probe: "println(java.time.LocalDate.of(2026, 8, 7).toString())",
            expected: "2026-08-07",
        },
        Library {
            package: "java.time.format",
            probe: "println(java.time.LocalDate.of(2026, 8, 7).format(\
                    java.time.format.DateTimeFormatter.ofPattern(\"yyyy/MM\")))",
            expected: "2026/08",
        },
        Library {
            package: "java.io",
            probe: "println(java.io.StringWriter().apply { write(\"w\") }.toString())",
            expected: "w",
        },
        Library {
            package: "java.nio.charset",
            probe: "println(java.nio.charset.StandardCharsets.UTF_8.name())",
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
            "import kotlinx.coroutines.runBlocking\nrunBlocking { }\n",
            "program.kts:1:8: Unresolved reference 'kotlinx'.",
        ),
        // A thread is scheduled with `setTimeout`, which this sandbox denies — and this arm finds out
        // at COMPILE time, inside the standard library's own file, which is the answer that arm's
        // `verdict` calls the model's rather than gg's.
        ("kotlin.concurrent.thread { println(\"x\") }\n", "Thread"),
    ] {
        let failure = compile_program(source, &PrepareContext::new())
            .err()
            .unwrap_or_else(|| panic!("this arm compiled `{source}`, which it must not"));
        let rendered = failure.to_string();
        assert!(
            rendered.contains(expected),
            "the diagnostic for `{source}` does not name what a model would act on: {rendered}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// A code module, reached from Kotlin
// ---------------------------------------------------------------------------------------------

#[test]
fn a_code_module_is_reached_from_kotlin_rather_than_only_from_javascript() {
    // `lib` is the one place in this SDK where the PROGRAM says what type it expects, because a code
    // module is compiled separately and there is no `import` for the compiler to check the two
    // against — the position a Kotlin author is in when they reach something at run time, answered
    // the way Kotlin answers it. That makes it the one part of the surface a compile cannot vouch
    // for, so the whole of it is driven here: the four readings, the presence check, the refusal, and
    // the lowering each Kotlin value goes through on the way across.
    //
    // [The substrate's own module test](super::substrate) reaches the same namespace from
    // JavaScript, which is the claim that the guest binds `lib.<key>` at all. This is the different
    // claim that Kotlin's own `Lib` reaches it — and it is the claim the study rests on, because
    // `lib` is the surface where [Java's arm](super::super::java) and this one are deliberately
    // alike, so a difference in what a model can do with it would be a difference in the harness
    // rather than in the language.
    let (module, exports) = compile_module(
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
        &PrepareContext::new(),
    )
    .expect("the Kotlin toolchain compiles a code module");
    assert_eq!(
        exports,
        [
            "greet", "add", "negated", "describe", "remember", "recalled"
        ],
        "a module's public top-level functions are its namespace, in the order it declares them",
    );

    let (outcome, _log) = evaluate_as(
        &match compile_program(
            r#"println(lib.text("helpers", "greet", "gg"))
println(lib.number("helpers", "add", 40, 2))
println(lib.flag("helpers", "negated", false))
println(lib.text("helpers", "describe", 1.5, listOf(1, 2)))
println(lib.has("helpers", "greet"))
println(lib.has("helpers", "absent"))
lib.run("helpers", "remember", "one")
lib.run("helpers", "remember", "two")
println(lib.text("helpers", "recalled"))
try {
    lib.run("helpers", "absent")
} catch (failure: ToolError) {
    println(failure.code.wireName)
}
"#,
            &PrepareContext::new(),
        ) {
            Ok(prepared) => prepared.source,
            Err(failure) => panic!("the Kotlin toolchain did not compile this program: {failure}"),
        },
        &[],
        &[CodeModule {
            name: "helpers".to_string(),
            source: module,
        }],
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            // The four readings, one per lowering: text, a whole number, a flag, and the two values
            // `lower` has no branch of its own for — a `Double`, and anything else, which crosses as
            // its `toString()`.
            "hello, GG",
            "42",
            "true",
            "1.5/[1, 2]",
            // A namespace answers about itself before it is called, which is what lets a program
            // depend on a module it is not certain was read.
            "true",
            "false",
            // `run` really calls: the module remembered both words across two crossings, so a `run`
            // that quietly did nothing would read here rather than pass.
            "one+two",
            // And a missing export is a gg failure an ordinary Kotlin `catch` catches, rather than a
            // null the next line trips over.
            "not-found",
        ]
    );
}
