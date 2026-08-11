//! **The C# arm's model-facing surface**, driven end to end through the real Roslyn and the real
//! membrane: the hand-written SDK, the catalogue reflected out of its own XML documentation
//! comments, and the libraries this arm says a program may reach.
//!
//! # Why these are not in the substrate file
//!
//! Because they are a different claim. [`substrate`](super::substrate) asks whether C# runs here.
//! This asks whether the thing a model is **told** it may write is the thing the sandbox really has
//! — which is the only question a cross-language study rests on, and the one whose failure is
//! silent: an SDK and a catalogue that agree with each other and with nothing else are two green
//! test suites and an invalidated experiment.
//!
//! # Why they are consolidated all the same
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 34.9 MB component. So each function drives *many* statements rather than being one
//! behaviour per function. Add a statement to an existing function rather than adding a function.
//!
//! # What holds the surface, and what is here instead
//!
//! Not the cross-arm rules. This arm is registered, so the
//! [capability gate](super::super::agreement) holds it exactly as it holds every other — by its
//! coverage half, one arm at a time against gg's own operations table, with nothing compared to any
//! other arm. Everything below is therefore about *this* arm's own machinery: that Roslyn really reflects the
//! SDK it is pointed at, that the membrane really binds what the catalogue documents, and that the
//! libraries this arm names are ones a program can reach.

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use super::GUEST_COMPONENT;
use super::substrate::{
    evaluate, evaluate_closing_docviews, evaluate_with_program, logs, prepare, program_error,
};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{CallLog, FakeToolApi, all_tools, canned_outcome};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::SandboxOutcome;
use crate::sandbox::{ProgramScope, SandboxLimits, bounded_store, engine, linker};
use crate::tools::{ToolFailure, ToolOutcome};

/// The catalogue this arm commits, read as a **document** rather than through
/// [`SignatureCatalogue`](crate::sandbox::signatures) — deliberately, because the parsed reading is
/// a *projection* and a field the parser does not model is one these tests could not notice was
/// missing.
const SIGNATURES: &str = include_str!("../guests/csharp.signatures.json");

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

/// Compile and run one C# program with `enabled`'s tools offered and no ending group.
fn run_with(
    source: &str,
    enabled: &[String],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(&prepare(source), enabled, RunEnding::None, false, responder)
}

/// One tool, called through the C# spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic C# method.
///
/// Deliberately the same table the other arms' surface tests drive theirs with, down to the
/// arguments and the expected JSON — because the expected JSON is the point. gg's dispatch is
/// language-independent: ten arms writing the same call in their own idioms must produce
/// **byte-identical** arguments, or they are not running the same experiment. A default argument
/// lowered onto the wrong wire slot, a `Tasks.TextEdit.Clear` read as "leave it alone" instead of "clear
/// it", an enum member whose wire word did not translate — none of them is a compile error in any of
/// the ten, and all of them are visible here.
///
/// What differs from every other arm's table is **named arguments**: C#'s way of skipping over the
/// optional arguments you do not want is to name the one you do, so `Board.CreateIssue(title: …,
/// agent: …, reviewers: …)` reads as a call whose five required arguments happen to be written the
/// same way. That is the language's own answer to the shape every other arm answers differently, and
/// it is why nothing here is an options record.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: r#"Shell.Run("npm test", timeoutSeconds: 30);"#,
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: r#"Files.ReadFile("src/a.cs", offset: 2, limit: 5);"#,
            expected: || json!({ "path": "src/a.cs", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: r#"Files.WriteFile("out.txt", "hello");"#,
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: r#"Files.EditFile("src/a.cs", "alpha", "beta");"#,
            expected: || json!({ "path": "src/a.cs", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: r#"Files.ListDir("src");"#,
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            statement: r#"Skills.ReadSkill("testing");"#,
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: r#"Memories.WriteMemory("layout", "d", "b");"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: r#"Memories.UpdateMemory("layout", "d2", "b2");"#,
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, and the one that names an optional
            // argument while skipping the one beside it — which is what a C# author writes instead
            // of filling in a record.
            statement: r#"Memories.CreateMemory("layout", "d", "b", code: "static int One() => 1;");"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "static int One() => 1;", "onUse": null })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: r#"Memories.ReadMemory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: r#"Memories.EditMemory("layout", "old", "new");"#,
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            // A variadic list, which is what `params` is for: no array literal at the call site.
            statement: r#"Memories.SearchMemories("cargo", "nextest");"#,
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: r#"Memories.DeleteMemory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: r#"Tasks.AddTask("t1", "T", description: "D", blockedBy: ["t0"]);"#,
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: r#"Tasks.UpdateTask("t1", title: "T2", description: Tasks.TextEdit.Clear, status: Gg.Tasks.TaskStatus.InProgress);"#,
            expected: || {
                // `Tasks.TextEdit.Clear` is what CLEARS it — the `default`, which is `Tasks.TextEdit.Keep`, is
                // what leaves it alone — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: r#"Tasks.SetBlockedBy("t1");"#,
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: r#"Tasks.CompleteTask("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: r#"Tasks.RemoveTask("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: r#"Board.CreateEpic("epc", "E", "D");"#,
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: r#"Board.CreateIssue("I", "s", "o", "c", "worker", reviewers: ["critic"]);"#,
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
            statement: r#"Board.UpdateIssue("i1", status: Board.IssueStatus.Done, epic: Board.EpicAssignment.Ungroup);"#,
            expected: || {
                // `Board.EpicAssignment.Ungroup` ungroups the issue, which gg's schema spells as the empty
                // string; a description the call left at its `default` — which is `Tasks.TextEdit.Keep` —
                // keeps the one it has, so its key is absent.
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
            statement: r#"Board.SetIssueBlockedBy("i1", "i0");"#,
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: r#"Board.RemoveEpic("e1");"#,
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: r#"Board.RemoveIssue("i1");"#,
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: r#"Board.WaitForIssue("i1");"#,
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: r#"Context.EvictFileView("src/a.cs");"#,
            expected: || json!({ "path": "src/a.cs" }),
        },
        Crossing {
            tool: "archive_thread",
            statement: r#"Context.ArchiveThread(new Context.TurnRange(4, 19), new Context.TurnRange(30, 35));"#,
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: r#"Context.SearchArchive("the parser");"#,
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: r#"Context.Compact("scaffolded the page", "src/Main.cs");"#,
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.cs"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a typed value rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: r#"Delegation.SpawnSubagent("subagent", Delegation.Brief.Prompt("write the lexer"));"#,
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: r#"Delegation.WaitForSubagents("agent-1");"#,
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: r#"Delegation.SendMessage("agent-1", "prefer the simpler parser");"#,
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: r#"Delegation.TransitionState("verify", note: "the build is green");"#,
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: r#"Delegation.Exec("Builder", prompt: "pick it up from here");"#,
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: r#"Delegation.Fork("try the other fix");"#,
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_tool_crosses_the_membrane_from_its_csharp_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: a compile and an instantiate here cost seconds, so
    // thirty-five of them would be a minute of toolchain for a table that reads the same. It is also
    // the stronger check — the calls must arrive in the order the program made them, so a call that
    // reached gg's dispatch under a NEIGHBOUR's name fails here as well.
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
fn the_view_object_the_documentation_the_helper_and_the_standard_ending_are_reached_too() {
    // Three of the five families that are NOT gg tools, so none of them appears in the crossing table
    // above — and two of them are where a program puts something in front of the model, which makes
    // them the ones a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(
            r####"
var text = Files.ReadTextFile("notes.md", offset: 1, limit: 2);
var read = Views.OpenFile("notes.md", offset: 1, limit: 2);
Views.OpenText("summary", text);
Views.OpenDocsView("ReadFile");
var closed = Views.Close("summary");
var missing = Views.Close("never opened");
var open = Views.Current();
Console.WriteLine($"{open[0].Selector} {open[0].Kind}");
Console.WriteLine($"{closed} {missing}");
Console.WriteLine(read is Files.TextFile file ? file.Contents.Split('\n')[0] : ((Files.ImageFile)read).Label);
Session.Finish("read the file and showed myself the result");
"####,
        ),
        &all_tools(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // What is still open is the file view, carrying the enum member rather than the word the wire
    // used; the text view the program closed is gone, and a documentation view is gg's to deliver on
    // the next turn rather than something `Current` reports.
    assert_eq!(lines[0], "notes.md File");
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
        ["notes.md", "summary", "ReadFile"]
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
    // `Views.OpenFile` performs. Neither has a tool name of its own, which is exactly the point — a
    // helper is a spelling of the tool it is built on, and a view is a read gg also shows you.
    assert_eq!(log.names(), ["read_file", "read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );

    // THE DOCUMENTATION MODULE, which is the family a session begins in: the prompt names no
    // function, so this is the only call a model can make before it has been told a name. It is also
    // the one part of this arm's surface with a *new* lowering under it — the search's page crosses
    // the interpreter's frame as one array per hit field, plus a sixth array carrying the page's own
    // two numbers — so what is checked here is that the envelope survives that trip whole.
    //
    // The double models no catalogue, so an empty page is the honest answer and the ranking is
    // `DocsRuntime`'s to be right about.
    let (outcome, _log) = run_with(
        r####"
var all = Docs.Search("view");
var narrowed = Docs.Search("", module: "Gg.Views", kind: Docs.DocKind.Function, limit: 5);
Console.WriteLine($"{all.Total} {all.Offset} {all.Hits.Count}");
Console.WriteLine(narrowed.Hits.Count == 0);
try
{
    Docs.Close("Gg.Files.ReadFile");
}
catch (ToolException failure)
{
    Console.WriteLine($"{failure.Code} {failure.Tool}");
}
"####,
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["0 0 0", "True", "Unavailable close"],
        "the documentation module did not answer from its C# spellings"
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

    // And the same two closing calls for an agent that HOLDS `docview-close`. This is the only path
    // that reaches `gg_close_doc_view` and `gg_close_doc_views` in the bridge at all: without the
    // capability the membrane refuses before either C function runs. The double holds no window, so
    // `0` is the honest count and a successful call rather than a failure.
    let (outcome, _log) = evaluate_closing_docviews(
        &prepare(
            r####"
Console.WriteLine($"{Docs.Close("Gg.Files.ReadFile")} {Docs.CloseAll()}");
"####,
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
fn the_program_library_and_a_reviewers_verdict_are_reached_in_csharp_too() {
    // The program library is bound from the CAPABILITY rather than from a tool name, and a reviewer
    // gets the other ending group. Between this, the two functions above and the alias case below,
    // every function this arm's catalogue describes has been driven through the real membrane.
    let (outcome, _log) = evaluate(
        &prepare(
            r####"
var history = Programs.History();
Console.WriteLine(history.Count);
try
{
    Console.WriteLine(Programs.Get(2));
}
catch (ToolException failure)
{
    Console.WriteLine(failure.Code);
}
Programs.Rerun("Console.WriteLine(\"again\");");
Session.RequestChanges("widen the test", "name the file");
"####,
        ),
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never a failure — and a turn it never
    // kept a program for is a `NotFound` the program catches in C#'s own idiom.
    assert_eq!(logs(&outcome), ["0", "NotFound"]);
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
        &prepare("Session.Approve();\n"),
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

/// **Every member method reaches the operation it says it is an alias of, carrying the field its own
/// receiver holds.**
///
/// The five methods this SDK declares — `IssueCreated.Wait`, `MemoryHit.Read`, `OpenView.Close`,
/// `SubagentHandle.Send` and `ProgramSummary.Source` — are one expression-bodied line each: they
/// take a component off the record they hang off and call the static method beside it with it. That
/// one line is the thing no other gate can see. The catalogue records which operation each is an
/// alias of and the [coverage gate](super::agreement) reads that record rather than the body; the
/// [register gate](super::register) reads only the prose. So a method passing the wrong component
/// would document perfectly, catalogue perfectly, and message a child that does not exist.
///
/// Each is therefore driven against the real membrane from the value the producing operation really
/// handed back, rather than from a record built here — which proves both halves at once: that the
/// method is on the value a program actually gets, and that the component it reads is the one gg
/// filled in.
#[test]
fn a_member_method_reaches_the_operation_it_is_an_alias_of() {
    // Four of the five hang off a value a gg TOOL produced, so the alias's own crossing lands in the
    // log beside the crossing that made its receiver. `Views.Close` is the exception — a view is not
    // a tool — and it is checked by what it answers instead.
    let (outcome, log) = evaluate(
        &prepare(
            r####"
var issue = Board.CreateIssue("Parse the manifest", "the parser", "the writer", "tests pass",
                              "Builder");
Console.WriteLine($"{issue.Id} {issue.Wait()}");

var hit = Memories.SearchMemories("build")[0];
Console.WriteLine($"{hit.Name} {hit.Read()}");

var child = Delegation.SpawnSubagent("Builder", Delegation.Brief.Prompt("take the writer"));
child.Send("prefer the simpler parser");
Console.WriteLine(child.Id);

Views.OpenText("summary", "eight files, two failing");
Console.WriteLine($"{Views.Current()[0].Close()} {Views.Current().Count}");
"####,
        ),
        &all_tools(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "EPIC-1 wait registered",
            "build-commands the memory contents",
            "agent-1",
            // The view the method closed was the one it hung off, and nothing is left behind it.
            "1 0",
        ]
    );
    assert_eq!(
        log.names(),
        [
            "create_issue",
            "wait_for_issue",
            "search_memories",
            "read_memory",
            "spawn_subagent",
            "send_message",
        ],
        "each method reached gg's dispatch under the operation it is an alias of"
    );
    // And carrying the receiver's own component, which is the half a wrong one would fail.
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

    // The fifth hangs off the program library, which is bought by a capability rather than by a
    // tool, and answers out of a history a fresh double has none of — so it needs one seeded.
    let (outcome, _log) = evaluate_with_program(
        &prepare(
            r####"
var summary = Programs.History()[0];
Console.WriteLine($"{summary.Turn} {summary.Source()}");
"####,
        ),
        3,
        "Console.WriteLine(\"the program that ran\");",
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["3 Console.WriteLine(\"the program that ran\");"]
    );
}

#[test]
fn a_failure_is_thrown_whether_it_is_caught_or_let_out() {
    // Caught: an ordinary `catch` with a `when` clause on the code, which is what a program that
    // expects one failure and not the others writes. Nothing about it is exceptional — `ToolException`
    // is an ordinary `System.Exception`, so `catch`, `when` and `finally` all work on it without an
    // SDK-specific combinator.
    let (outcome, _log) = run_with(
        r####"
try
{
    Console.WriteLine(Files.ReadTextFile("gone.cs"));
}
catch (ToolException failure) when (failure.Code == ToolErrorCode.NotFound)
{
    Console.WriteLine($"{failure.Code} on {failure.Tool}");
}
Console.WriteLine("carried on");
"####,
        &all_tools(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cs".to_string())
        },
    );
    assert_eq!(logs(&outcome), ["NotFound on read_file", "carried on"]);

    // Let out: reported as a recoverable model-facing error carrying the exception's own
    // `ToString()` — the type, gg's own sentence, AND the managed frames. This arm is the only
    // compiled one whose uncaught failure carries a stack at all, and the frame a model needs is the
    // SDK function that failed rather than the bridge under it, which is what
    // `Wire.Check`'s `NoInlining` buys.
    let (outcome, _log) = run_with(
        r####"
Console.WriteLine("before");
Files.ReadTextFile("gone.cs");
Console.WriteLine("after");
"####,
        &all_tools(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cs".to_string())
        },
    );
    let reported = program_error(&outcome);
    assert!(
        reported.message.contains("Gg.ToolException")
            && reported.message.contains("no such file: gone.cs"),
        "an uncaught failure did not carry gg's own sentence under its own type: {}",
        reported.message
    );
    assert!(
        reported.message.contains("Gg.Files.ReadTextFile"),
        "an uncaught failure did not name the SDK function that raised it: {}",
        reported.message
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
    // This arm cannot withhold a NAME: its SDK is compiled into the program, so every function is in
    // scope whatever a run enables and the host is the only thing that can refuse. That is exactly
    // the case `error-code.unavailable` exists for, and the recovery is the same one a name that was
    // never in scope gets.
    let (outcome, log) = run_with(
        r####"
try
{
    Shell.Run("dotnet build");
    Console.WriteLine("ran");
}
catch (ToolException failure)
{
    Console.WriteLine(failure.Code);
}
"####,
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["Unavailable".to_string()],
        "a tool this run does not offer was not refused as unavailable"
    );
    assert!(
        log.names().is_empty(),
        "a withheld tool must not reach gg's dispatch at all"
    );

    // AND IT LANDS ON THE TURN'S REFUSAL ROSTER, under gg's own key rather than this arm's spelling.
    // That matters more here than on most arms: this guest reports every UNCAUGHT managed exception
    // as `error-kind.other` with no code (`Sources/shell.c`'s `report`), so an uncaught refusal is
    // recorded as `program_throw` and the turn error type a cross-arm study would otherwise count
    // withheld reaches by says nothing about this arm. The roster is the source that is uniform
    // across all eleven, and it is asserted here so that stays true. See `sandbox.test.rs`'s
    // `a_refused_call_is_the_same_turn_error_as_an_unbound_name`.
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
fn csharp_reaches_every_library() {
    // Every namespace the catalogue's `libraries` section names, imported and used for what it is
    // there for. The claim is not that these compile in the abstract: it is that a MODEL'S PROGRAM,
    // compiled by the production prepare step against the installed reference pack and run by the
    // committed guest, can name them — which is two artifacts that have to agree, and a promise the
    // prompt makes that a pin move on either could break.
    let outcome = evaluate(
        &prepare(
            r####"
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Linq.Expressions;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Encodings.Web;
using System.Globalization;
using System.Buffers;
using System.IO.Compression;
using System.IO.Enumeration;
using System.IO.MemoryMappedFiles;
using System.Numerics;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Xml;
using System.Xml.Linq;
using System.Xml.XPath;
using System.Xml.Schema;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

// The everyday.
var queue = new Queue<int>([1, 2, 3]);
var bag = new ConcurrentBag<int>([4]);
ImmutableArray<int> frozen = [3, 1, 2];
Expression<Func<int, int>> doubled = value => value * 2;
Console.WriteLine($"{queue.Count} {bag.Count} {string.Join(",", frozen.Sort())} {doubled.Compile()(21)}");
Console.WriteLine(new ArrayList { "a" }.Count);

// Text, formatting and parsing.
var document = JsonSerializer.Deserialize<JsonNode>("""{"arms":10}""");
Console.WriteLine($"{document!["arms"]} {JavaScriptEncoder.Default.Encode("a<b")}");
Console.WriteLine($"{Regex.Match("gg-42", @"\d+").Value} {new StringBuilder("x").Append('y')}");
Console.WriteLine($"{1234.5.ToString("N2", new CultureInfo("de-DE"))} {new ArrayBufferWriter<byte>(16).FreeCapacity > 0}");
Console.WriteLine(typeof(JsonSerializerOptions).Name);

// Files, paths and streams.
var compressed = new MemoryStream();
using (var gzip = new GZipStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
{
    gzip.Write(Encoding.UTF8.GetBytes("compress me"));
}
Console.WriteLine($"{Path.Combine("a", "b.txt")} {compressed.Length > 0} {typeof(FileSystemName).Name} {typeof(MemoryMappedFile).Name}");

// Numbers and time.
Console.WriteLine($"{BigInteger.Pow(7, 8)} {Stopwatch.StartNew().Elapsed.Ticks >= 0} {typeof(NotNullWhenAttribute).Name}");

// Structured data.
var xml = XDocument.Parse("<runs><run id='1'/></runs>");
Console.WriteLine($"{xml.XPathSelectElement("//run")!.Attribute("id")!.Value} {new XmlDocument().GetType().Name} {typeof(XmlSchema).Name}");

// Reflection and runtime services.
Console.WriteLine($"{typeof(string).GetMethod("Trim", Type.EmptyTypes)!.Name} {typeof(AssemblyBuilder).Name} {typeof(GCSettings).Name} {RuntimeHelpers.GetHashCode("x") != 0} {Marshal.SizeOf<int>()} {TypeDescriptor.GetClassName(typeof(int))}");

// Networking types: the vocabulary is here, and the transport is `Shell.Run`.
Console.WriteLine($"{new Uri("https://example.test/a").Host} {IPAddress.Loopback} {typeof(HttpClient).Name} {typeof(Socket).Name}");

// Threading types: they compile, and a `lock` is ordinary C#.
var gate = new object();
lock (gate) { Console.WriteLine($"{Monitor.IsEntered(gate)} {typeof(Task).Name}"); }
"####,
        ),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0;

    assert_eq!(
        logs(&outcome),
        [
            "3 1 1,2,3 42",
            "1",
            "10 a\\u003Cb",
            "42 xy",
            "1.234,50 True",
            "JsonSerializerOptions",
            "a/b.txt True FileSystemName MemoryMappedFile",
            "5764801 True NotNullWhenAttribute",
            "1 XmlDocument XmlSchema",
            "Trim AssemblyBuilder GCSettings True 4 System.Int32",
            "example.test 127.0.0.1 HttpClient Socket",
            "True Task",
        ],
        "a namespace this arm says a program may reach did not compile, or did not run"
    );

    // And the claim is held to the file that makes it: every group in `libraries.txt` is exercised
    // above, and a group added to it without a line here fails rather than reaching a model
    // undriven.
    let committed = catalogue();
    let groups: Vec<&str> = section(&committed, "libraries")
        .iter()
        .map(|group| text(group, "group"))
        .collect();
    assert_eq!(
        groups,
        [
            "The everyday",
            "Text, formatting and parsing",
            "Files, paths and streams",
            "Numbers and time",
            "Structured data",
            "Reflection and runtime services",
            "Networking types",
            "Threading types",
        ],
        "the library groups have changed and the program above has not"
    );
}

#[test]
fn the_artifact_binds_exactly_the_tools_gg_offers() {
    // The one drift no source-level test can catch, asked of the **committed artifact** rather than
    // of a source file: `Sources/bridge.c` answers `bound-tools` off its own registration table, so
    // a gg function bound with no tool name beside it — or a tool gg gained since the guest was last
    // built — fails here and nowhere else.
    //
    // It is asked directly rather than through `component_bound_tools`, which takes a registered
    // language and this arm is not one yet.
    let limits = SandboxLimits::default();
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let component =
        engine::compile_bytes(GUEST_COMPONENT).expect("the committed C# guest is a component");
    let enabled: Vec<String> = Vec::new();
    let mut store = bounded_store(
        MembraneState::new(
            FakeToolApi::with(&CallLog::default(), canned_outcome),
            crate::sandbox::language(GgProgramLanguage::TypeScript),
            ProgramScope {
                enabled: &enabled,
                modules: &[],
                ending: RunEnding::None,
                library: false,
                docview_close: false,
            },
            limits,
            None,
        ),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, &component, &linker)
        .expect("the committed C# guest instantiates");
    let mut answered = bound
        .call_bound_tools(&mut store)
        .expect("the guest answers which tools its bridge binds");
    answered.sort();
    let mut expected: Vec<String> = crate::sandbox::signatures::sandbox_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    expected.sort();
    assert_eq!(
        answered, expected,
        "the bridge's own binding table and gg's tool vocabulary have drifted apart"
    );
}

#[test]
fn the_committed_catalogue_describes_the_surface_the_sdk_offers() {
    let catalogue = catalogue();
    assert_eq!(
        text(&catalogue, "language"),
        "csharp",
        "the catalogue must say whose spellings it carries, and this arm's id is what a run will \
         resolve it by"
    );
    assert_eq!(
        catalogue["schema"].as_u64(),
        Some(2),
        "this arm has been converted to the normalized doc model, and the schema number is what \
         turns the gates that read it on"
    );

    // Identity: the modules, in the order the surface is presented in, each with gg's cross-arm id
    // beside this arm's own spelling of the path. The id is what a study joins eleven arms on; the
    // path is what a model reads and what every fully-qualified name below is prefixed with.
    let modules: Vec<(&str, &str)> = section(&catalogue, "modules")
        .iter()
        .map(|module| (text(module, "id"), text(module, "path")))
        .collect();
    assert_eq!(
        modules,
        [
            ("files", "Gg.Files"),
            ("shell", "Gg.Shell"),
            ("board", "Gg.Board"),
            ("tasks", "Gg.Tasks"),
            ("memories", "Gg.Memories"),
            ("docs", "Gg.Docs"),
            ("views", "Gg.Views"),
            ("context", "Gg.Context"),
            ("delegation", "Gg.Delegation"),
            ("skills", "Gg.Skills"),
            ("programs", "Gg.Programs"),
            ("session", "Gg.Session"),
            ("core", "Gg"),
        ],
        "the modules, or their order, are not the surface's"
    );

    // Every gg tool is bound, spelled the way this arm spells it. The catalogue no longer files a
    // tool into a section of its own — a section was only ever a gate by another name — so the check
    // is over the operations the entries name, which is where gg states the gate once.
    let mut catalogued: Vec<&str> = section(&catalogue, "functions")
        .iter()
        .filter(|entry| entry["aliasOf"].is_null())
        .filter_map(|entry| text(entry, "operation").split_once('.').map(|(_, key)| key))
        .collect();
    catalogued.sort_unstable();
    let mut vocabulary: Vec<&str> = crate::sandbox::signatures::sandbox_tool_names();
    // Three operations share the `read_file` tool and one shares nothing, so the tool vocabulary is
    // a SUBSET of the operation keys rather than equal to it — every tool is bound, and the surface
    // is wider than the tools.
    vocabulary.sort_unstable();
    for tool in &vocabulary {
        assert!(
            catalogued.contains(tool),
            "the gg tool `{tool}` is not bound by any catalogued C# function"
        );
    }

    // Spelling: `PascalCase`, because that is what C# spells a method in. gg's vocabulary is
    // `snake_case`, so on this arm the two differ for every entry — which is what the operation id
    // exists for, and what a catalogue that quietly used gg's spelling would hide.
    for entry in section(&catalogue, "functions") {
        let name = text(entry, "name");
        assert!(
            !name.contains('_') && name.starts_with(|first: char| first.is_ascii_uppercase()),
            "`{name}` is not how C# spells a method"
        );
    }

    // Every name is module-qualified, and a static method on the module's own class is the shape
    // this language gives to what every other arm spells as a free function.
    for entry in section(&catalogue, "functions") {
        let fqn = text(entry, "fqn");
        let module = text(entry, "module");
        let path = section(&catalogue, "modules")
            .iter()
            .find(|candidate| text(candidate, "id") == module)
            .map(|candidate| text(candidate, "path"))
            .unwrap_or_else(|| panic!("`{fqn}` names the module `{module}`, which is declared"));
        assert!(
            fqn.starts_with(&format!("{path}.")),
            "`{fqn}` is not qualified by its module `{path}`"
        );
        let kind = text(entry, "kind");
        assert!(
            (kind == "static-method" && entry["receiver"].is_null())
                || (kind == "method" && !entry["receiver"].is_null()),
            "`{fqn}` is a `{kind}` and its receiver does not match"
        );
    }

    // The MEMBER functions this arm binds, each nested in the module that produces its receiver.
    // Every one is an ALIAS — a second way to reach one operation, spelled on the value that already
    // carries the argument the static method would be passed — so it counts toward no coverage and
    // is documented like anything else.
    let aliases: Vec<(&str, &str)> = section(&catalogue, "functions")
        .iter()
        .filter(|entry| !entry["aliasOf"].is_null())
        .map(|entry| (text(entry, "fqn"), text(entry, "aliasOf")))
        .collect();
    assert_eq!(
        aliases,
        [
            ("Gg.Board.IssueCreated.Wait", "board.wait_for_issue"),
            ("Gg.Memories.MemoryHit.Read", "memories.read_memory"),
            ("Gg.Views.OpenView.Close", "views.close"),
            (
                "Gg.Delegation.SubagentHandle.Send",
                "delegation.send_message"
            ),
            ("Gg.Programs.ProgramSummary.Source", "programs.get"),
        ]
    );
    for entry in section(&catalogue, "functions")
        .iter()
        .filter(|entry| !entry["aliasOf"].is_null())
    {
        let fqn = text(entry, "fqn");
        assert_eq!(text(entry, "kind"), "method", "`{fqn}` hangs off a value");
        assert!(
            !text(entry, "receiver").is_empty(),
            "`{fqn}` names the type it hangs off"
        );
    }
    // And each is listed on its receiver's own declaration, which is the menu a model reads when it
    // opens the type a call handed it.
    for (fqn, _) in &aliases {
        let (owner, _) = fqn
            .rsplit_once('.')
            .expect("a member is qualified by its type");
        let declaration = section(&catalogue, "types")
            .iter()
            .find(|entry| text(entry, "fqn") == owner)
            .unwrap_or_else(|| panic!("`{owner}` is declared"));
        let listed: Vec<&str> = declaration["memberFunctions"]
            .as_array()
            .expect("a type lists its member functions")
            .iter()
            .map(|entry| text(entry, "fqn"))
            .collect();
        assert_eq!(
            listed,
            [*fqn],
            "a type view is a menu of what a value can do, and this is the whole of `{owner}`'s"
        );
    }

    // The idiom this arm exists to produce, asserted where a model reads it: required arguments
    // positional, optional ones expressed as DEFAULT VALUES a call names rather than as a record, a
    // variadic list where the wire has a list a call would otherwise wrap in an array literal, and a
    // typed three-way value where the wire has a variant. Every type a signature writes is
    // module-qualified, because a bare `FileRead` is not a name a program could resolve.
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
             overload, so every entry but one has exactly one shape"
        );
        text(&shapes[0], "signature").to_string()
    };
    assert_eq!(
        signature("files.read_file"),
        "ReadFile(string path, uint? offset = null, uint? limit = null) -> Files.FileRead"
    );
    assert_eq!(
        signature("shell.shell"),
        "Run(string command, double? timeoutSeconds = null) -> Shell.ShellOutput"
    );
    assert_eq!(
        signature("files.edit_file"),
        "EditFile(string path, string oldString, string newString) -> void"
    );
    assert_eq!(
        signature("context.archive_thread"),
        "ArchiveThread(params Context.TurnRange[] ranges) -> Context.ReclaimReport"
    );
    assert_eq!(
        signature("tasks.update_task"),
        "UpdateTask(string id, string? title = null, Tasks.TextEdit description = default, \
         Tasks.TaskStatus? status = null) -> void"
    );
    assert_eq!(
        signature("board.create_issue"),
        "CreateIssue(string title, string inScope, string outOfScope, string completionCriteria, \
         string agent, string? description = null, string[]? blockedBy = null, \
         string? epicId = null, string[]? reviewers = null) -> Board.IssueCreated"
    );

    // The one overload group on this arm, and the shape the catalogue exists to be able to carry:
    // "wait for these children" and "wait for all of them" are one capability written two ways,
    // because C# expresses "no argument at all" as a second method rather than as a default a
    // variadic parameter cannot have.
    let waiting = section(&catalogue, "functions")
        .iter()
        .find(|entry| text(entry, "operation") == "delegation.wait_for_subagents")
        .expect("`wait_for_subagents` is catalogued");
    let shapes: Vec<&str> = waiting["signatures"]
        .as_array()
        .expect("an entry has shapes")
        .iter()
        .map(|shape| text(shape, "signature"))
        .collect();
    assert_eq!(
        shapes,
        [
            "WaitForSubagents() -> IReadOnlyList<Delegation.SubagentResult>",
            "WaitForSubagents(params string[] ids) -> IReadOnlyList<Delegation.SubagentResult>",
        ],
        "the one overload group is not both of its shapes"
    );

    // A default value is what makes an argument optional in C#, so the catalogue's two fields must
    // say the same thing about every argument of every shape — and an optional one is `keyword`,
    // because naming it is how a call skips the ones before it.
    for entry in section(&catalogue, "functions") {
        for shape in entry["signatures"].as_array().expect("an entry has shapes") {
            for parameter in shape["parameters"]
                .as_array()
                .expect("a shape has parameters")
            {
                let optional = parameter["optional"].as_bool().expect("a flag");
                assert_eq!(
                    optional,
                    !parameter["default"].is_null(),
                    "`{}`'s `{}` disagrees with itself about being optional",
                    text(entry, "name"),
                    text(parameter, "name")
                );
                assert_eq!(
                    text(parameter, "kind"),
                    if optional { "keyword" } else { "positional" },
                    "`{}`'s `{}` is passed the wrong way",
                    text(entry, "name"),
                    text(parameter, "name")
                );
            }
        }
    }

    // Every word of it is written on a declaration, in the authored brief-and-detail shape: nothing
    // blank, a brief that is one line, an argument documented for every argument a signature names,
    // and a member documented for every member of every type. The reflector refuses to emit a
    // catalogue that breaks this, the register gate holds the same text to the register gg chose,
    // and this is the third reading of it — over the emitted JSON, entry by entry.
    let brief = |entry: &Value, what: &str| {
        let written = text(entry, "brief");
        assert!(!written.trim().is_empty(), "{what} has no brief");
        assert!(
            !written.contains('\n'),
            "{what}'s brief is more than one line: {written}"
        );
    };
    for entry in section(&catalogue, "modules") {
        brief(entry, &format!("the module `{}`", text(entry, "path")));
    }
    for entry in section(&catalogue, "functions") {
        let called = text(entry, "fqn");
        brief(entry, &format!("`{called}`"));
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
        brief(declaration, &format!("the type `{named}`"));
        let members = declaration["members"]
            .as_array()
            .expect("a type declares members");
        assert!(
            !members.is_empty(),
            "the type `{named}` declares no members"
        );
        for member in members {
            brief(member, &format!("`{named}.{}`", text(member, "name")));
        }
    }
}
