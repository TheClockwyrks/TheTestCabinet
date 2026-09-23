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
//! # How they are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, so each obtains the embedded guest
//! once — the largest component any arm embeds — and every program in it costs a real `csc`. A
//! function groups the programs that exercise one behaviour, so they share that cost; one that
//! grows into the slow end of the suite is split rather than extended.
//!
//! # The feedback channel on this arm
//!
//! Of the feedback functions on `crates/gg/wit/gg-sandbox.wit`, this arm reaches two. `log` is every
//! `Console.Write` and `Console.WriteLine`, redirected by the `[ModuleInitializer]` in
//! `packages/gg-sandbox-csharp/src/Gg/Internal/OperatorConsole.cs`; `report-error` is reached from
//! the guest shell by an uncaught exception, a non-zero entry-point status and a guest-side failure
//! before the program runs. `note-return` and `report-module-error` have no call site here, and so
//! no test: a returned value is the entry-point status on this arm, and a code module reaches the
//! guest already compiled as one of the manifest's assemblies, so there is no module evaluation of
//! its own to fail.
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
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE, GgProgramLanguage,
};

use super::substrate::{
    evaluate, evaluate_closing_docviews, evaluate_granting, evaluate_with_program,
    evaluate_with_programs, logs, prepare, program_error,
};
use crate::context::ViewKind;
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_operations, all_operations_without, canned_outcome,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::operations::DELEGATION_TRANSITION_STATE;
use crate::sandbox::outcome::{ProgramErrorKind, SandboxOutcome};
use crate::tools::{
    AgentStatusData, ApiData, ArchiveSearchData, FileTextData, MAX_ARCHIVE_RANGES,
    SubagentResultData, ToolFailure, ToolOutcome,
};

/// The catalogue this arm's build reflects, read as a **document** rather than through
/// [`SignatureCatalogue`](crate::sandbox::signatures) — deliberately, because the parsed reading is
/// a *projection* and a field the parser does not model is one these tests could not notice was
/// missing.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/csharp.signatures.json"
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

/// Compile and run one C# program with `enabled`'s operations offered and no ending group.
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

/// Run one program body — the two `using` lines every program here writes are prepended — with every
/// operation offered and `responder` answering, and hand back what it wrote and what crossed. A
/// success case passes [`canned_outcome`], whose payloads are specific enough to assert on.
fn returns(
    body: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (Vec<String>, CallLog) {
    let (outcome, log) = run_with(
        &format!("using Gg;\nusing System;\n{body}"),
        &all_operations(),
        responder,
    );
    (logs(&outcome).to_vec(), log)
}

/// A responder answering every call successfully with one sidecar — the empty lists
/// [`canned_outcome`]'s single row per tool cannot carry.
fn sidecar(data: ApiData) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |_name: &str, _args: &Value| {
        ToolOutcome::ok("answered", "answered").with_data(data.clone())
    }
}

/// `call`, wrapped in the `try`/`catch` a program recovering from a failure writes: it writes the
/// failure's code and the operation it names on one line, and gg's own sentence on the next.
fn caught(call: &str) -> String {
    format!(
        "using Gg;\nusing System;\n\ntry\n{{\n    {call}\n    Console.WriteLine(\"it returned\");\n}}\n\
         catch (ApiException failure)\n{{\n    Console.WriteLine($\"{{failure.Code}} on {{failure.Operation}}\");\n\
         \x20   Console.WriteLine(failure.Message);\n}}\n"
    )
}

/// Run `call` under [`caught`] with every operation offered and every call answered by `failure`
/// carrying `detail`, and hand back the lines the program wrote and what crossed.
fn fails_with(call: &str, failure: ToolFailure, detail: &str) -> (Vec<String>, CallLog) {
    fails_granting(call, &all_operations(), failure, detail)
}

/// [`fails_with`], with the grant said out loud — for the refusal a run that withholds a family
/// makes before gg's dispatch is reached.
fn fails_granting(
    call: &str,
    operations: &[crate::sandbox::operations::OperationId],
    failure: ToolFailure,
    detail: &str,
) -> (Vec<String>, CallLog) {
    let message = detail.to_string();
    let (outcome, log) = run_with(&caught(call), operations, move |_: &str, _: &Value| {
        ToolOutcome::failed(failure, message.clone())
    });
    (logs(&outcome).to_vec(), log)
}

/// One operation, called through the C# spelling of it, and the JSON gg's dispatch must have seen.
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
            tool: "tree",
            statement: r#"Files.Tree("src", depth: 3);"#,
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            statement: r#"Files.Search("answer", path: "src", limit: 5);"#,
            expected: || json!({ "query": "answer", "path": "src", "limit": 5 }),
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
fn every_operation_crosses_the_membrane_from_its_csharp_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: a compile and an instantiate here cost seconds, so
    // thirty-five of them would be a minute of toolchain for a table that reads the same. It is also
    // the stronger check — the calls must arrive in the order the program made them, so a call that
    // reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    // Each row is a statement rather than a program, so the one line every one of them needs is
    // written once here — the same line this arm's catalogue states and a documentation view quotes.
    let program: String = std::iter::once(format!("{}\n", super::SURFACE_IMPORT))
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
fn the_view_object_the_documentation_the_helper_and_the_standard_ending_are_reached_too() {
    // Three of the five families that are NOT gg tools, so none of them appears in the crossing table
    // above — and two of them are where a program puts something in front of the model, which makes
    // them the ones a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(
            r####"
using Gg;
using System;

var read = Views.OpenFile("notes.md", offset: 1, limit: 2);
Views.OpenText("summary", "eight files, two failing");
Views.OpenDocsView("ReadFile");
Views.OpenFile("wide.md", offset: 1, limit: 2, maxLineChars: 80);
var closed = Views.Close("summary");
var missing = Views.Close("never opened");
Console.WriteLine($"{closed} {missing}");
Console.WriteLine(read is Files.TextFile file ? file.Contents.Split('\n')[0] : ((Files.ImageFile)read).Label);
Session.Finish("read the file and showed myself the result");
"####,
        ),
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
        ["notes.md", "summary", "ReadFile", "wide.md"]
    );
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::Finished { summary }) if summary.starts_with("read the file")
        ),
        "the ending the program declared: {:?}",
        outcome.completion
    );

    // Two reads reached gg's dispatch and both arrived as `read_file`: the two `Views.OpenFile`
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
using Gg;
using System;

var all = Docs.Search("view");
var narrowed = Docs.Search(modules: ["Gg.Views"], kind: Docs.DocKind.Function, limit: 5);
Console.WriteLine($"{all.Total} {all.Offset} {all.Hits.Count}");
Console.WriteLine(narrowed.Hits.Count == 0);
try
{
    Docs.Close("Gg.Files.ReadFile");
}
catch (ApiException failure)
{
    Console.WriteLine($"{failure.Code} {failure.Operation}");
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
using Gg;
using System;

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
using Gg;
using System;

var history = Programs.History();
Console.WriteLine(history.Count);
try
{
    Console.WriteLine(Programs.Get("zzzz"));
}
catch (ApiException failure)
{
    Console.WriteLine(failure.Code);
}
Programs.Rerun("using System;\nConsole.WriteLine(\"again\");");
Session.RequestChanges("widen the test", "name the file");
"####,
        ),
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never a failure — and an id it never
    // issued a program under is a `NotFound` the program catches in C#'s own idiom.
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
        &prepare("Gg.Session.Approve();\n"),
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
/// The four methods this SDK declares — `IssueCreated.Wait`, `MemoryHit.Read`,
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
    // Three of the four hang off a value a gg OPERATION produced, so the alias's own crossing
    // lands in the log beside the crossing that made its receiver. `Views.Close` is no alias — a
    // view is not a tool — and it is checked by what it answers instead.
    let (outcome, log) = evaluate(
        &prepare(
            r####"
using Gg;
using System;

var issue = Board.CreateIssue("Parse the manifest", "the parser", "the writer", "tests pass",
                              "Builder");
Console.WriteLine($"{issue.Id} {issue.Wait()}");

var hit = Memories.SearchMemories("build")[0];
Console.WriteLine($"{hit.Name} {hit.Read()}");

var child = Delegation.SpawnSubagent("Builder", Delegation.Brief.Prompt("take the writer"));
child.Send("prefer the simpler parser");
Console.WriteLine(child.Id);

Views.OpenText("summary", "eight files, two failing");
Console.WriteLine($"{Views.Close("summary")}");
"####,
        ),
        &all_operations(),
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
            // The close answered with the one view its label named.
            "1",
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

    // The fourth hangs off the program library, which is bought by a capability rather than by a
    // tool, and answers out of a history a fresh double has none of — so it needs one seeded.
    let (outcome, _log) = evaluate_with_program(
        &prepare(
            r####"
using Gg;
using System;

var summary = Programs.History()[0];
Console.WriteLine($"{summary.Turn} {summary.Source()}");
"####,
        ),
        "p3",
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
    // expects one failure and not the others writes. Nothing about it is exceptional — `ApiException`
    // is an ordinary `System.Exception`, so `catch`, `when` and `finally` all work on it without an
    // SDK-specific combinator.
    let (outcome, _log) = run_with(
        r####"
using Gg;
using System;

try
{
    Files.ReadFile("gone.cs");
    Console.WriteLine("read it");
}
catch (ApiException failure) when (failure.Code == ApiErrorCode.NotFound)
{
    Console.WriteLine($"{failure.Code} on {failure.Operation}");
}
Console.WriteLine("carried on");
"####,
        &all_operations(),
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
    let (outcome, _log) = run_with(LET_OUT, &all_operations(), |_name: &str, _args: &Value| {
        ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cs".to_string())
    });
    let reported = program_error(&outcome);
    assert!(
        reported.message.contains("Gg.ApiException")
            && reported.message.contains("no such file: gone.cs"),
        "an uncaught failure did not carry gg's own sentence under its own type: {}",
        reported.message
    );
    assert!(
        reported.message.contains("Gg.Files.ReadFile"),
        "an uncaught failure did not name the SDK function that raised it: {}",
        reported.message
    );
    assert_eq!(
        outcome.logs,
        ["before"],
        "what ran before it still stands: {:?}",
        outcome.logs
    );

    // AND IT IS CLASSED AS THE FAILED CALL IT WAS. The guest reads `ApiException.Code` off the
    // thrown object and reports the failure class with it, so the host files the turn the way it
    // files the identical event on every other arm whose guest reports. Reading the class rather
    // than only the message is what the recorded data is sliced on: `program_api_error` says the
    // model is fighting the API, `program_throw` says it wrote a bug.
    assert_eq!(
        reported.kind,
        ProgramErrorKind::ToolFailure,
        "an uncaught failed call was not classed as one: {reported:?}"
    );

    // Every class the wire carries lands there except `unavailable`, which is the one the host
    // reads differently and is measured below. Driving more than one is what pins the ordinals:
    // `ApiException.Code` is the wire's own `error-code` cast straight across in `Wire.Check`, so a
    // managed enum that renumbered would send one of these to the wrong class.
    for failure in [
        ToolFailure::InvalidArgument,
        ToolFailure::Conflict,
        ToolFailure::Refused,
        ToolFailure::LimitExceeded,
        ToolFailure::IoError,
    ] {
        let (outcome, _log) = run_with(LET_OUT, &all_operations(), move |_: &str, _: &Value| {
            ToolOutcome::failed(failure, "no such file: gone.cs".to_string())
        });
        assert_eq!(
            program_error(&outcome).kind,
            ProgramErrorKind::ToolFailure,
            "an uncaught {failure:?} was not classed as a failed call"
        );
    }

    // AND A THROW THE PROGRAM MADE ITSELF STILL IS ITS OWN. The guest classifies by the thrown
    // object's type against the SDK's own image, so nothing was widened into an API failure to buy
    // the assertions above.
    let (outcome, _log) = run_with(
        r####"
using System;

Console.WriteLine("before");
throw new InvalidOperationException("the model's own");
"####,
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        program_error(&outcome).kind,
        ProgramErrorKind::Other,
        "a throw the program made itself was classed as a failed gg call"
    );

    // AND THE SHAPE THAT ASKS WHETHER THIS RUNTIME WRAPS. The guest reads the outermost thrown
    // object, so an entry point the runtime reaches through machinery of its own is where a wrapper
    // would appear and the class would fall back to `Other`. An `async Task Main` is that entry
    // point, and it is the shape a model writes as readily as top-level statements.
    let (outcome, _log) = run_with(
        r####"
using Gg;
using System;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        await Task.CompletedTask;
        Console.WriteLine("before");
        Files.ReadFile("gone.cs");
    }
}
"####,
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cs".to_string())
        },
    );
    assert_eq!(
        program_error(&outcome).kind,
        ProgramErrorKind::ToolFailure,
        "an uncaught failed call let out of an async entry point was not classed as one"
    );
}

/// The program both halves of the uncaught-failure assertions above run: one call that fails,
/// nothing catching it.
const LET_OUT: &str = r####"
using Gg;
using System;

Console.WriteLine("before");
Files.ReadFile("gone.cs");
Console.WriteLine("after");
"####;

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // This arm cannot withhold a NAME: its SDK is compiled into the program, so every function is in
    // scope whatever a run enables and the host is the only thing that can refuse. That is exactly
    // the case `error-code.unavailable` exists for, and the recovery is the same one a name that was
    // never in scope gets.
    let (outcome, log) = run_with(
        r####"
using Gg;
using System;

try
{
    Shell.Run("dotnet build");
    Console.WriteLine("ran");
}
catch (ApiException failure)
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
    // The roster is the source a cross-arm count of withheld reaches joins on, uniform across all
    // eleven arms whatever each one's runtime does with the throw, and it is asserted here so that
    // stays true. See `sandbox.test.rs`'s
    // `a_refused_call_is_the_same_turn_error_as_an_unbound_name`.
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

    // AND AN UNCAUGHT ONE IS THE UNKNOWN NAME IT IS. This arm cannot withhold a name, so a withheld
    // capability arrives as the host's `unavailable` rather than as a `ReferenceError`, and the two
    // have to be counted as one event. The guest reads the code off the uncaught `ApiException` and
    // the host reads `unavailable` out of it, which is the only route this arm has to
    // `program_unknown_name`.
    let (outcome, log) = run_with(
        r####"
using Gg;
using System;

Console.WriteLine("before");
Shell.Run("dotnet build");
"####,
        &[],
        canned_outcome,
    );
    assert_eq!(
        program_error(&outcome).kind,
        ProgramErrorKind::UnknownName,
        "an uncaught refusal was not classed as a name this run does not offer"
    );
    assert!(
        log.names().is_empty(),
        "a withheld tool must not reach gg's dispatch at all"
    );
}

#[test]
fn csharp_reaches_every_library() {
    // Every namespace the catalogue's `libraries` section names, imported and used for what it is
    // there for. The claim is not that these compile in the abstract: it is that a MODEL'S PROGRAM,
    // compiled by the production prepare step against the installed reference pack and run by the
    // embedded guest, can name them — which is two artifacts that have to agree, and a promise the
    // prompt makes that a pin move on either could break.
    let outcome = evaluate(
        &prepare(
            r####"
using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Collections.Immutable;
using System.Linq.Expressions;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Encodings.Web;
using System.Globalization;
using System.Linq;
using System.IO;
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
    let catalogue = catalogue();
    let groups: Vec<&str> = section(&catalogue, "libraries")
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
fn the_generated_catalogue_describes_the_surface_the_sdk_offers() {
    let catalogue = catalogue();
    assert_eq!(
        text(&catalogue, "language"),
        "csharp",
        "the catalogue must say whose spellings it carries, and this arm's id is what a run will \
         resolve it by"
    );
    assert_eq!(
        catalogue["schema"].as_u64(),
        Some(1),
        "a catalogue declares which shape it is written in, and one that stopped saying so would \
         not be readable at all"
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
    let mut vocabulary: Vec<&str> = crate::sandbox::signatures::sandbox_operation_names();
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

/// **No name gg offers resolves without a line the program wrote**, measured by compiling a program
/// that writes none and watching Roslyn refuse it.
///
/// The claim the [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) rest on
/// for this arm, and the one a reading of the sources cannot settle: gg's SDK is a **referenced
/// assembly**, and what a reference buys is the library existing rather than any name being in
/// scope. The difference is invisible in the source and decided by Roslyn, so it is asked of Roslyn.
///
/// Three programs, one call each, differing only in what stands above the call:
///
/// * nothing — refused, `CS0103`, which is what "no name is in scope" looks like;
/// * [`SURFACE_IMPORT`](super::SURFACE_IMPORT) — accepted, which is what makes the line a
///   documentation view quotes a line worth quoting;
/// * the module's own path written out — accepted, which is the route that needs no line and the
///   one every statement gg synthesizes takes.
///
/// The refusal's own text is held to `program.cs(` as well, because that is the file name the
/// model's coordinates are reported under and `-pathmap` rewrites the paths a *runtime* frame
/// carries. A flag that reached the compiler's diagnostics too would move every location this arm
/// reports into a spelling nothing else expects.
///
/// It compiles and never runs, so it instantiates no component: what a compiler refuses never
/// reaches a guest.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let compile = |source: &str| {
        super::compile::compile_program(source, &[], &crate::sandbox::PrepareContext::detached())
    };

    let bare = compile("Views.OpenText(\"t\", \"b\");\n")
        .expect_err("a bare gg name with no line above it does not compile");
    match bare {
        crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            diagnostic,
        )) => assert!(
            diagnostic.starts_with("program.cs(")
                && diagnostic.contains("CS0103")
                && diagnostic.contains("'Views'"),
            "a program naming gg's surface with no import line was refused for another reason: \
             {diagnostic}"
        ),
        other => panic!(
            "a name that is not in scope is the model's compile error, not {other:?}. gg's surface \
             is reaching a program that never asked for it."
        ),
    }

    compile(&format!(
        "{}\nViews.OpenText(\"t\", \"b\");\n",
        super::SURFACE_IMPORT
    ))
    .expect("the line this arm's catalogue states brings the surface into scope");

    compile("Gg.Views.OpenText(\"t\", \"b\");\n")
        .expect("a module's own path resolves with no line at all");

    // The .NET class libraries arrive the same way, so the prompt's account of them is true of the
    // whole compilation rather than of gg's half.
    let console = compile("Console.WriteLine(\"hi\");\n")
        .expect_err("a BCL name with no line above it does not compile");
    assert!(
        format!("{console:?}").contains("CS0103"),
        "a program naming `Console` with no `using System;` was refused for another reason: \
         {console:?}"
    );
}

/// **The bytes Roslyn reads are the bytes the model sent**, compared byte for byte in the
/// preparation's own workspace.
///
/// The [authorship gate](super::authorship) asserts this across every arm from the outside. This
/// asks it of the one file that matters here and names it: `program.cs`, the file every diagnostic
/// on this arm is located in. A program carrying a `using`, a comment, an odd indent and no trailing
/// newline, so that anything that normalised, re-indented or terminated the text would show.
#[test]
fn the_bytes_the_compiler_reads_are_the_bytes_the_model_sent() {
    let source = "using Gg;\n\n// a comment gg has no business touching\n   \
                  Views.OpenText(\"t\", \"b\");";
    let context = crate::sandbox::PrepareContext::detached();
    super::compile::compile_program(source, &[], &context).expect("the subject compiles");
    let workspace = context
        .opened_workspace()
        .expect("this arm's preparation opens a workspace to run a compiler in");
    // `work/` is the directory a preparation writes its compiler's inputs into
    // (`language/compile.rs`'s `Workspace`), and `program.cs` is the one file in it that carries
    // the model's own text.
    let written =
        std::fs::read_to_string(workspace.join("work").join(super::compile::PROGRAM_FILE))
            .expect("the file the compiler was given is readable");
    assert_eq!(
        written, source,
        "gg wrote something other than the model's own text into the file Roslyn read"
    );
}

/// **The file-view statements gg synthesizes are a program this arm compiles.**
///
/// gg pushes them into an agent's transcript as an assistant turn, several of them joined into one
/// program, and a model reads its own transcript as the example of what a well-formed reply looks
/// like. Nothing on the turn path compiles that program, so a statement that could not stand beside
/// its neighbours would teach the wrong shape and never fail anything — which is what this is for.
#[test]
fn the_file_view_statements_gg_synthesizes_join_into_a_program_that_compiles() {
    let arm = crate::sandbox::language(GgProgramLanguage::CSharp);
    let window = crate::sandbox::FileWindow {
        offset: 400,
        limit: 200,
    };
    let program = [
        arm.open_file_statement("src/Program.cs", None),
        arm.open_file_statement("docs/notes.md", Some(window)),
        arm.open_file_statement("a\"b\\c.cs", None),
    ]
    .join("\n");
    super::compile::compile_program(&program, &[], &crate::sandbox::PrepareContext::detached())
        .unwrap_or_else(|failure| {
            panic!("the statements gg writes into a transcript are not a program: {failure:?}")
        });
}

// --- shell ------------------------------------------------------------------------------------------

#[test]
fn a_shell_run_hands_the_program_its_exit_code_and_output() {
    let (lines, log) = returns(
        r####"
var ran = Shell.Run("npm test", timeoutSeconds: 5);
Console.WriteLine($"{ran.ExitCode} {ran.Output} {ran.Truncated}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["0 ran `npm test` False"]);
    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "npm test", "timeout_secs": 5.0 }))
    );
}

#[test]
fn a_non_zero_exit_is_a_value_the_program_reads() {
    // `canned_outcome` answers a command saying `fail` with `ok: false` and no failure class, which
    // is the shape the membrane must hand back as a value rather than throw.
    let (lines, log) = returns(
        r####"
var ran = Shell.Run("npm run fail");
Console.WriteLine($"{ran.ExitCode} {ran.Output} {ran.Truncated}");
Console.WriteLine("carried on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 ran `npm run fail` False", "carried on"]);
    assert_eq!(log.names(), ["shell"]);
}

#[test]
fn a_shell_timeout_reaches_the_program_as_limit_exceeded() {
    let (lines, log) = fails_with(
        r#"Shell.Run("sleep 60", timeoutSeconds: 1);"#,
        ToolFailure::LimitExceeded,
        "command timed out after 1s and was killed",
    );
    assert_eq!(
        lines,
        [
            "LimitExceeded on shell",
            "command timed out after 1s and was killed"
        ]
    );
    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "sleep 60", "timeout_secs": 1.0 }))
    );
}

#[test]
fn a_shell_that_could_not_be_started_is_an_io_error() {
    let (lines, log) = fails_with(
        r#"Shell.Run("npm test", timeoutSeconds: 5);"#,
        ToolFailure::IoError,
        "could not start `sh`: No such file or directory",
    );
    assert_eq!(
        lines,
        [
            "IOError on shell",
            "could not start `sh`: No such file or directory"
        ]
    );
    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "npm test", "timeout_secs": 5.0 }))
    );
}

// --- files ------------------------------------------------------------------------------------------

#[test]
fn a_text_read_hands_the_program_the_text_window() {
    let (lines, log) = returns(
        r####"
var read = Files.ReadFile("notes.md");
if (read is Files.TextFile file)
{
    Console.WriteLine(file.Contents.Replace("\n", "|"));
    Console.WriteLine($"{file.FirstLine} {file.LastLine} {file.TotalLines} {file.ByteTruncated}");
}
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["contents of notes.md|line two|", "1 2 2 False"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": null, "limit": null }))
    );
}

#[test]
fn an_image_read_hands_the_program_the_image_record() {
    // A bare read hands the record back without placing the picture in front of the model, so
    // `Shown` is false and the reason says where a picture is shown instead.
    let (lines, log) = returns(
        r####"
var read = Files.ReadFile("shot.png");
if (read is Files.ImageFile image)
{
    Console.WriteLine($"{image.MediaType} {image.Label} {image.Bytes} {image.Shown} [{image.NotShownReason}]");
}
"####,
        canned_outcome,
    );
    assert_eq!(
        lines,
        [
            "image/png PNG 1234 False [`Gg.Files.ReadFile` does not show images; open one with `Gg.Views.OpenFile(path)`]"
        ]
    );
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "shot.png", "offset": null, "limit": null }))
    );
}

#[test]
fn a_write_hands_the_program_the_byte_count() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Files.WriteFile("out.txt", "hello"));
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["5"]);
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out.txt", "contents": "hello" }))
    );
}

#[test]
fn an_empty_write_path_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Files.WriteFile("", "hello");"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty",
    );
    assert_eq!(
        lines,
        ["InvalidArgument on write_file", "`path` must not be empty"]
    );
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "", "contents": "hello" }))
    );
}

#[test]
fn a_write_that_failed_is_an_io_error() {
    let (lines, log) = fails_with(
        r#"Files.WriteFile("locked/out.txt", "hello");"#,
        ToolFailure::IoError,
        "could not create `locked`: Permission denied",
    );
    assert_eq!(
        lines,
        [
            "IOError on write_file",
            "could not create `locked`: Permission denied"
        ]
    );
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "locked/out.txt", "contents": "hello" }))
    );
}

#[test]
fn an_edit_that_matched_once_returns_to_its_program() {
    let (lines, log) = returns(
        r####"
Files.EditFile("src/a.cs", "alpha", "beta");
Console.WriteLine("carried on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["carried on"]);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.cs", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn an_edit_whose_text_is_absent_is_not_found() {
    let (lines, log) = fails_with(
        r#"Files.EditFile("src/a.cs", "alpha", "beta");"#,
        ToolFailure::NotFound,
        "`alpha` does not appear in src/a.cs",
    );
    assert_eq!(
        lines,
        [
            "NotFound on edit_file",
            "`alpha` does not appear in src/a.cs"
        ]
    );
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.cs", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn an_edit_whose_text_repeats_is_a_conflict_carrying_the_count() {
    // How many times it matched is what the program needs to widen its text, so the message
    // is asserted whole.
    let (lines, log) = fails_with(
        r#"Files.EditFile("src/a.cs", "alpha", "beta");"#,
        ToolFailure::Conflict,
        "`alpha` appears 3 times in src/a.cs; include more context to make it unique",
    );
    assert_eq!(
        lines,
        [
            "Conflict on edit_file",
            "`alpha` appears 3 times in src/a.cs; include more context to make it unique"
        ]
    );
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.cs", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn a_listing_hands_the_program_its_entries_and_their_kinds() {
    let (lines, log) = returns(
        r####"
foreach (var entry in Files.ListDir("src"))
{
    Console.WriteLine($"{entry.Name} {entry.Kind}");
}
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["a.ts File", "b.test.ts File", "sub Directory"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "src" })));
}

#[test]
fn an_omitted_listing_path_lists_the_root() {
    // The default argument crosses as the wire's absence rather than as an empty string, which is
    // the one thing separating "list the root" from the argument error below.
    let (lines, log) = returns(
        r####"
Console.WriteLine(Files.ListDir().Count);
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["3"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_directory_is_an_empty_list() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Files.ListDir("empty").Count);
"####,
        sidecar(ApiData::DirEntries(Vec::new())),
    );
    assert_eq!(lines, ["0"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "empty" })));
}

#[test]
fn a_listing_of_a_directory_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Files.ListDir("nowhere");"#,
        ToolFailure::NotFound,
        "no such directory: nowhere",
    );
    assert_eq!(
        lines,
        ["NotFound on list_dir", "no such directory: nowhere"]
    );
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "nowhere" })));
}

#[test]
fn a_listing_path_that_is_given_but_empty_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Files.ListDir("");"#,
        ToolFailure::InvalidArgument,
        "`path` was given but empty; leave it out to list the workspace root",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on list_dir",
            "`path` was given but empty; leave it out to list the workspace root"
        ]
    );
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "" })));
}

#[test]
fn a_tree_hands_the_program_its_rendering() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Files.Tree("src", depth: 2).Replace("\n", "|"));
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["a.ts|b.test.ts|sub/|  c.ts"]);
    assert_eq!(log.args("tree"), Some(json!({ "path": "src", "depth": 2 })));
}

#[test]
fn a_tree_of_a_path_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Files.Tree("nowhere");"#,
        ToolFailure::NotFound,
        "no such path: nowhere",
    );
    assert_eq!(lines, ["NotFound on tree", "no such path: nowhere"]);
    assert_eq!(
        log.args("tree"),
        Some(json!({ "path": "nowhere", "depth": null }))
    );
}

#[test]
fn a_tree_rooted_at_a_file_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Files.Tree("src/a.cs");"#,
        ToolFailure::InvalidArgument,
        "`src/a.cs` is a file, not a directory",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on tree",
            "`src/a.cs` is a file, not a directory"
        ]
    );
    assert_eq!(
        log.args("tree"),
        Some(json!({ "path": "src/a.cs", "depth": null }))
    );
}

#[test]
fn a_tree_depth_of_zero_is_refused_before_it_crosses() {
    // Raised guest-side: the whole point of the guard is that nothing crosses, so gg's dispatch
    // sees no call and the message is the SDK's own.
    let (lines, log) = fails_with(
        r#"Files.Tree("src", depth: 0);"#,
        ToolFailure::InvalidArgument,
        "the responder is never reached",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on tree",
            "depth must be at least 1 (0 given); leave it out for gg's default"
        ]
    );
    assert!(
        log.names().is_empty(),
        "the refusal must not reach gg's dispatch: {:?}",
        log.names()
    );
}

#[test]
fn a_search_hands_the_program_its_matches() {
    let (lines, log) = returns(
        r####"
foreach (var match in Files.Search("answer", path: "src"))
{
    Console.WriteLine($"{match.Path} {match.Line} {match.Text}");
}
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["src/a.ts 3 const answer = 42;"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "src", "limit": null }))
    );
}

#[test]
fn a_search_that_matched_nothing_is_an_empty_list() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Files.Search("nothing matches this").Count);
"####,
        sidecar(ApiData::SearchMatches(Vec::new())),
    );
    assert_eq!(lines, ["0"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "nothing matches this", "path": null, "limit": null }))
    );
}

#[test]
fn a_blank_search_query_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Files.Search("   ");"#,
        ToolFailure::InvalidArgument,
        "`query` must not be blank",
    );
    assert_eq!(
        lines,
        ["InvalidArgument on search", "`query` must not be blank"]
    );
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "   ", "path": null, "limit": null }))
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Files.Search("(unclosed");"#,
        ToolFailure::InvalidArgument,
        "`query` is not a valid pattern: unclosed group",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on search",
            "`query` is not a valid pattern: unclosed group"
        ]
    );
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "(unclosed", "path": null, "limit": null }))
    );
}

#[test]
fn a_search_limit_of_zero_is_refused_before_it_crosses() {
    // Raised guest-side, like the tree's depth: nothing reaches gg's dispatch.
    let (lines, log) = fails_with(
        r#"Files.Search("answer", limit: 0);"#,
        ToolFailure::InvalidArgument,
        "the responder is never reached",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on search",
            "limit must be at least 1 (0 given); leave it out for gg's default"
        ]
    );
    assert!(
        log.names().is_empty(),
        "the refusal must not reach gg's dispatch: {:?}",
        log.names()
    );
}

#[test]
fn a_search_path_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Files.Search("answer", path: "nowhere");"#,
        ToolFailure::NotFound,
        "no such path: nowhere",
    );
    assert_eq!(lines, ["NotFound on search", "no such path: nowhere"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "nowhere", "limit": null }))
    );
}

// --- skills -----------------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_the_program_the_skill_body() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Skills.ReadSkill("testing"));
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["the skill body"]);
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "testing" })));
}

#[test]
fn an_unknown_skill_names_the_skills_that_exist() {
    // gg's own sentence, as `knowledge.test.rs` has it: the skills that do exist are what the
    // program's next call needs.
    let (lines, log) = fails_with(
        r#"Skills.ReadSkill("nope");"#,
        ToolFailure::NotFound,
        "read_skill: no skill named `nope`; available skills: testing",
    );
    assert_eq!(
        lines,
        [
            "NotFound on read_skill",
            "read_skill: no skill named `nope`; available skills: testing"
        ]
    );
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "nope" })));
}

// --- memories ---------------------------------------------------------------------------------------

#[test]
fn a_written_memory_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Memories.WriteMemory("layout", "d", "b");
Console.WriteLine($"{usage.Count} {usage.MaxCount} {usage.TotalChars}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
    assert_eq!(
        log.args("write_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_duplicate_memory_name_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Memories.WriteMemory("layout", "d", "b");"#,
        ToolFailure::Conflict,
        "a memory named `layout` already exists; update it instead",
    );
    assert_eq!(
        lines,
        [
            "Conflict on write_memory",
            "a memory named `layout` already exists; update it instead"
        ]
    );
    assert_eq!(
        log.args("write_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded() {
    let (lines, log) = fails_with(
        r#"Memories.WriteMemory("layout", "d", "b");"#,
        ToolFailure::LimitExceeded,
        "memories would total 4012 characters; max 4000",
    );
    assert_eq!(
        lines,
        [
            "LimitExceeded on write_memory",
            "memories would total 4012 characters; max 4000"
        ]
    );
    assert_eq!(
        log.args("write_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn an_updated_memory_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Memories.UpdateMemory("layout", "d", "b");
Console.WriteLine($"{usage.Count} {usage.MaxCount} {usage.TotalChars}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
    assert_eq!(
        log.args("update_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn an_update_of_a_memory_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Memories.UpdateMemory("layout", "d", "b");"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
    );
    assert_eq!(
        lines,
        ["NotFound on update_memory", "no memory named `layout`"]
    );
    assert_eq!(
        log.args("update_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_created_memory_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Memories.CreateMemory("layout", "d", "b", code: "static int One() => 1;");
Console.WriteLine($"{usage.Count} {usage.MaxCount} {usage.TotalChars}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b", "code": "static int One() => 1;", "onUse": null })
        )
    );
}

#[test]
fn a_blank_field_on_a_new_memory_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Memories.CreateMemory("layout", "d", " ");"#,
        ToolFailure::InvalidArgument,
        "`contents` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_memory",
            "`contents` must not be blank"
        ]
    );
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": " ", "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_slug_a_name_may_not_hold_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Memories.CreateMemory("Build Commands!", "d", "b");"#,
        ToolFailure::InvalidArgument,
        "`Build Commands!` is not a slug: use lowercase letters, digits and hyphens",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_memory",
            "`Build Commands!` is not a slug: use lowercase letters, digits and hyphens"
        ]
    );
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "Build Commands!", "description": "d", "contents": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_duplicate_memory_slug_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Memories.CreateMemory("layout", "d", "b");"#,
        ToolFailure::Conflict,
        "a memory named `layout` already exists",
    );
    assert_eq!(
        lines,
        [
            "Conflict on create_memory",
            "a memory named `layout` already exists"
        ]
    );
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_new_memory_over_a_limit_is_limit_exceeded() {
    let (lines, log) = fails_with(
        r#"Memories.CreateMemory("layout", "d", "b");"#,
        ToolFailure::LimitExceeded,
        "the memory index would be 2100 characters; max 2000",
    );
    assert_eq!(
        lines,
        [
            "LimitExceeded on create_memory",
            "the memory index would be 2100 characters; max 2000"
        ]
    );
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b", "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_memory_read_hands_the_program_its_contents() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Memories.ReadMemory("layout"));
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["the memory contents"]);
    assert_eq!(log.args("read_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn a_read_of_a_memory_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Memories.ReadMemory("layout");"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
    );
    assert_eq!(
        lines,
        ["NotFound on read_memory", "no memory named `layout`"]
    );
    assert_eq!(log.args("read_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn an_edited_memory_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Memories.EditMemory("layout", "old", "new");
Console.WriteLine($"{usage.Count} {usage.MaxCount} {usage.TotalChars}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn a_memory_edit_whose_text_is_absent_is_not_found() {
    let (lines, log) = fails_with(
        r#"Memories.EditMemory("layout", "old", "new");"#,
        ToolFailure::NotFound,
        "`old` does not appear in memory `layout`",
    );
    assert_eq!(
        lines,
        [
            "NotFound on edit_memory",
            "`old` does not appear in memory `layout`"
        ]
    );
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn a_memory_edit_whose_text_repeats_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Memories.EditMemory("layout", "old", "new");"#,
        ToolFailure::Conflict,
        "`old` appears 2 times in memory `layout`",
    );
    assert_eq!(
        lines,
        [
            "Conflict on edit_memory",
            "`old` appears 2 times in memory `layout`"
        ]
    );
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn a_memory_edit_over_the_cap_is_limit_exceeded() {
    let (lines, log) = fails_with(
        r#"Memories.EditMemory("layout", "old", "new");"#,
        ToolFailure::LimitExceeded,
        "memories would total 4012 characters; max 4000",
    );
    assert_eq!(
        lines,
        [
            "LimitExceeded on edit_memory",
            "memories would total 4012 characters; max 4000"
        ]
    );
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn a_memory_edit_that_would_empty_it_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Memories.EditMemory("layout", "old", "");"#,
        ToolFailure::InvalidArgument,
        "the edit would leave memory `layout` empty; delete it instead",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on edit_memory",
            "the edit would leave memory `layout` empty; delete it instead"
        ]
    );
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "" }))
    );
}

#[test]
fn a_memory_search_hands_the_program_each_hits_ranking() {
    let (lines, log) = returns(
        r####"
foreach (var hit in Memories.SearchMemories("cargo", "nextest"))
{
    Console.WriteLine($"{hit.Description}|{hit.Matched}|{hit.Occurrences}|{hit.Excerpt}");
}
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["How to build|2|3|…cargo nextest run --workspace…"]);
    assert_eq!(
        log.args("search_memories"),
        Some(json!({ "keywords": ["cargo", "nextest"] }))
    );
}

#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_list() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Memories.SearchMemories("nothing").Count);
"####,
        sidecar(ApiData::MemoryHits(Vec::new())),
    );
    assert_eq!(lines, ["0"]);
    assert_eq!(
        log.args("search_memories"),
        Some(json!({ "keywords": ["nothing"] }))
    );
}

#[test]
fn a_memory_search_of_empty_keywords_is_an_argument_error() {
    let (lines, log) = fails_with(
        "Memories.SearchMemories();",
        ToolFailure::InvalidArgument,
        "`keywords` must name at least one keyword",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on search_memories",
            "`keywords` must name at least one keyword"
        ]
    );
    assert_eq!(log.args("search_memories"), Some(json!({ "keywords": [] })));
}

#[test]
fn a_deleted_memory_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Memories.DeleteMemory("layout");
Console.WriteLine($"{usage.Count} {usage.MaxCount} {usage.TotalChars}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 8 12"]);
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn a_delete_of_a_memory_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Memories.DeleteMemory("layout");"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
    );
    assert_eq!(
        lines,
        ["NotFound on delete_memory", "no memory named `layout`"]
    );
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "layout" })));
}

// --- tasks ------------------------------------------------------------------------------------------

#[test]
fn an_added_task_hands_the_program_the_task_usage() {
    let (lines, log) = returns(
        r####"
var usage = Tasks.AddTask("t1", "Write the lexer");
Console.WriteLine($"{usage.Count} {usage.MaxTasks}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["2 20"]);
    assert_eq!(
        log.args("add_task"),
        Some(
            json!({ "id": "t1", "title": "Write the lexer", "description": null, "blockedBy": [] })
        )
    );
}

#[test]
fn a_blank_task_id_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Tasks.AddTask(" ", "Write the lexer");"#,
        ToolFailure::InvalidArgument,
        "add_task: `id` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on add_task",
            "add_task: `id` must not be blank"
        ]
    );
    assert_eq!(
        log.args("add_task"),
        Some(
            json!({ "id": " ", "title": "Write the lexer", "description": null, "blockedBy": [] })
        )
    );
}

#[test]
fn a_blank_task_title_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Tasks.AddTask("t1", "");"#,
        ToolFailure::InvalidArgument,
        "add_task: `title` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on add_task",
            "add_task: `title` must not be blank"
        ]
    );
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t1", "title": "", "description": null, "blockedBy": [] }))
    );
}

#[test]
fn a_duplicate_task_id_is_a_conflict() {
    // The same failure `knowledge.test.rs` has the store produce, caught in C#.
    let (lines, log) = fails_with(
        r#"Tasks.AddTask("t1", "Write the lexer");"#,
        ToolFailure::Conflict,
        "add_task: a task `t1` already exists",
    );
    assert_eq!(
        lines,
        [
            "Conflict on add_task",
            "add_task: a task `t1` already exists"
        ]
    );
    assert_eq!(
        log.args("add_task"),
        Some(
            json!({ "id": "t1", "title": "Write the lexer", "description": null, "blockedBy": [] })
        )
    );
}

#[test]
fn a_task_edge_that_closes_a_cycle_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Tasks.AddTask("t1", "Write the lexer", blockedBy: ["t2"]);"#,
        ToolFailure::Conflict,
        "add_task: blocking `t1` on `t2` would make a cycle",
    );
    assert_eq!(
        lines,
        [
            "Conflict on add_task",
            "add_task: blocking `t1` on `t2` would make a cycle"
        ]
    );
    assert_eq!(
        log.args("add_task"),
        Some(
            json!({ "id": "t1", "title": "Write the lexer", "description": null, "blockedBy": ["t2"] })
        )
    );
}

#[test]
fn an_unknown_task_blocker_is_not_found() {
    let (lines, log) = fails_with(
        r#"Tasks.AddTask("t1", "Write the lexer", blockedBy: ["t9"]);"#,
        ToolFailure::NotFound,
        "add_task: no task `t9` to block on",
    );
    assert_eq!(
        lines,
        ["NotFound on add_task", "add_task: no task `t9` to block on"]
    );
    assert_eq!(
        log.args("add_task"),
        Some(
            json!({ "id": "t1", "title": "Write the lexer", "description": null, "blockedBy": ["t9"] })
        )
    );
}

#[test]
fn a_task_over_the_cap_is_limit_exceeded() {
    let (lines, log) = fails_with(
        r#"Tasks.AddTask("t1", "Write the lexer");"#,
        ToolFailure::LimitExceeded,
        "add_task: the list already holds 20 tasks; max 20",
    );
    assert_eq!(
        lines,
        [
            "LimitExceeded on add_task",
            "add_task: the list already holds 20 tasks; max 20"
        ]
    );
    assert_eq!(
        log.args("add_task"),
        Some(
            json!({ "id": "t1", "title": "Write the lexer", "description": null, "blockedBy": [] })
        )
    );
}

#[test]
fn an_updated_task_returns_to_its_program() {
    let (lines, log) = returns(
        r####"
Tasks.UpdateTask("t1", description: Tasks.TextEdit.Clear, status: Tasks.TaskStatus.Done);
Console.WriteLine("carried on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["carried on"]);
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": null, "status": "done", "description": "" }))
    );
}

#[test]
fn a_task_patch_with_no_field_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Tasks.UpdateTask("t1");"#,
        ToolFailure::InvalidArgument,
        "update_task: nothing to change",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on update_task",
            "update_task: nothing to change"
        ]
    );
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": null, "status": null }))
    );
}

#[test]
fn a_blanked_task_field_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Tasks.UpdateTask("t1", title: "");"#,
        ToolFailure::InvalidArgument,
        "update_task: `title` may not be blanked",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on update_task",
            "update_task: `title` may not be blanked"
        ]
    );
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": "", "status": null }))
    );
}

#[test]
fn an_update_of_a_task_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Tasks.UpdateTask("t9", status: Tasks.TaskStatus.InProgress);"#,
        ToolFailure::NotFound,
        "update_task: no task `t9`",
    );
    assert_eq!(
        lines,
        ["NotFound on update_task", "update_task: no task `t9`"]
    );
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t9", "title": null, "status": "in_progress" }))
    );
}

#[test]
fn a_cleared_task_blocker_list_returns_to_its_program() {
    let (lines, log) = returns(
        r####"
Tasks.SetBlockedBy("t1");
Console.WriteLine("carried on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["carried on"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": [] }))
    );
}

#[test]
fn a_blank_id_on_a_task_blocker_list_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Tasks.SetBlockedBy("", "t0");"#,
        ToolFailure::InvalidArgument,
        "set_blocked_by: `id` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on set_blocked_by",
            "set_blocked_by: `id` must not be blank"
        ]
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "", "blockedBy": ["t0"] }))
    );
}

#[test]
fn a_blank_blocker_on_a_task_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Tasks.SetBlockedBy("t1", " ");"#,
        ToolFailure::InvalidArgument,
        "set_blocked_by: a blocker must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on set_blocked_by",
            "set_blocked_by: a blocker must not be blank"
        ]
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": [" "] }))
    );
}

#[test]
fn blocking_a_task_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Tasks.SetBlockedBy("t9", "t0");"#,
        ToolFailure::NotFound,
        "set_blocked_by: no task `t9`",
    );
    assert_eq!(
        lines,
        ["NotFound on set_blocked_by", "set_blocked_by: no task `t9`"]
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t9", "blockedBy": ["t0"] }))
    );
}

#[test]
fn a_task_blocker_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Tasks.SetBlockedBy("t1", "t9");"#,
        ToolFailure::NotFound,
        "set_blocked_by: no task `t9` to block on",
    );
    assert_eq!(
        lines,
        [
            "NotFound on set_blocked_by",
            "set_blocked_by: no task `t9` to block on"
        ]
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t9"] }))
    );
}

#[test]
fn a_task_blocker_that_closes_a_cycle_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Tasks.SetBlockedBy("t1", "t2");"#,
        ToolFailure::Conflict,
        "set_blocked_by: blocking `t1` on `t2` would make a cycle",
    );
    assert_eq!(
        lines,
        [
            "Conflict on set_blocked_by",
            "set_blocked_by: blocking `t1` on `t2` would make a cycle"
        ]
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t2"] }))
    );
}

#[test]
fn a_task_blocked_on_itself_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Tasks.SetBlockedBy("t1", "t1");"#,
        ToolFailure::Conflict,
        "set_blocked_by: `t1` cannot block itself",
    );
    assert_eq!(
        lines,
        [
            "Conflict on set_blocked_by",
            "set_blocked_by: `t1` cannot block itself"
        ]
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t1"] }))
    );
}

#[test]
fn a_completed_task_returns_to_its_program() {
    let (lines, log) = returns(
        r####"
Tasks.CompleteTask("t1");
Console.WriteLine("carried on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["carried on"]);
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn completing_a_task_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Tasks.CompleteTask("t9");"#,
        ToolFailure::NotFound,
        "complete_task: no task `t9`",
    );
    assert_eq!(
        lines,
        ["NotFound on complete_task", "complete_task: no task `t9`"]
    );
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "t9" })));
}

#[test]
fn a_removed_task_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Tasks.RemoveTask("t1");
Console.WriteLine($"{usage.Count} {usage.MaxTasks}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["2 20"]);
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn removing_a_task_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Tasks.RemoveTask("t9");"#,
        ToolFailure::NotFound,
        "remove_task: no task `t9`",
    );
    assert_eq!(
        lines,
        ["NotFound on remove_task", "remove_task: no task `t9`"]
    );
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "t9" })));
}

// --- board ------------------------------------------------------------------------------------------

#[test]
fn a_created_epic_hands_the_program_its_id_and_usage() {
    let (lines, log) = returns(
        r####"
var epic = Board.CreateEpic("PARSE", "Parser", "the parser");
Console.WriteLine($"{epic.Id} {epic.Board.Epics} {epic.Board.MaxEpics} {epic.Board.Issues} {epic.Board.MaxIssues}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["EPIC 1 4 3 20"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "PARSE", "title": "Parser", "description": "the parser" }))
    );
}

#[test]
fn a_prefix_under_three_letters_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.CreateEpic("PA", "Parser", "the parser");"#,
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be 3 to 6 letters (`PA` is 2)",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_epic",
            "create_epic: `prefix` must be 3 to 6 letters (`PA` is 2)"
        ]
    );
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "PA", "title": "Parser", "description": "the parser" }))
    );
}

#[test]
fn a_prefix_over_six_letters_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.CreateEpic("PARSERS", "Parser", "the parser");"#,
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be 3 to 6 letters (`PARSERS` is 7)",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_epic",
            "create_epic: `prefix` must be 3 to 6 letters (`PARSERS` is 7)"
        ]
    );
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "PARSERS", "title": "Parser", "description": "the parser" }))
    );
}

#[test]
fn a_prefix_that_is_not_letters_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.CreateEpic("PA1", "Parser", "the parser");"#,
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be letters only",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_epic",
            "create_epic: `prefix` must be letters only"
        ]
    );
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "PA1", "title": "Parser", "description": "the parser" }))
    );
}

#[test]
fn a_blank_epic_field_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.CreateEpic("PARSE", " ", "the parser");"#,
        ToolFailure::InvalidArgument,
        "create_epic: `title` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_epic",
            "create_epic: `title` must not be blank"
        ]
    );
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "PARSE", "title": " ", "description": "the parser" }))
    );
}

#[test]
fn a_prefix_another_epic_holds_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Board.CreateEpic("PARSE", "Parser", "the parser");"#,
        ToolFailure::Conflict,
        "create_epic: the prefix `PARSE` is already in use",
    );
    assert_eq!(
        lines,
        [
            "Conflict on create_epic",
            "create_epic: the prefix `PARSE` is already in use"
        ]
    );
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "PARSE", "title": "Parser", "description": "the parser" }))
    );
}

#[test]
fn an_epic_over_the_cap_is_limit_exceeded() {
    let (lines, log) = fails_with(
        r#"Board.CreateEpic("PARSE", "Parser", "the parser");"#,
        ToolFailure::LimitExceeded,
        "create_epic: the board already holds 4 epics; max 4",
    );
    assert_eq!(
        lines,
        [
            "LimitExceeded on create_epic",
            "create_epic: the board already holds 4 epics; max 4"
        ]
    );
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "PARSE", "title": "Parser", "description": "the parser" }))
    );
}

#[test]
fn a_created_issue_hands_the_program_the_board_usage() {
    let (lines, log) = returns(
        r####"
var issue = Board.CreateIssue("Parse", "the parser", "the writer", "tests pass", "Builder");
Console.WriteLine($"{issue.Id} {issue.Board.Epics} {issue.Board.MaxEpics} {issue.Board.Issues} {issue.Board.MaxIssues}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["EPIC-1 1 4 3 20"]);
    assert_eq!(
        log.args("create_issue"),
        Some(
            json!({ "title": "Parse", "description": null, "inScope": "the parser", "outOfScope": "the writer", "completionCriteria": "tests pass", "blockedBy": [], "epicId": null, "agent": "Builder", "reviewers": [] })
        )
    );
}

#[test]
fn a_blank_issue_field_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.CreateIssue(" ", "the parser", "the writer", "tests pass", "Builder");"#,
        ToolFailure::InvalidArgument,
        "create_issue: `title` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_issue",
            "create_issue: `title` must not be blank"
        ]
    );
    assert_eq!(
        log.args("create_issue"),
        Some(
            json!({ "title": " ", "description": null, "inScope": "the parser", "outOfScope": "the writer", "completionCriteria": "tests pass", "blockedBy": [], "epicId": null, "agent": "Builder", "reviewers": [] })
        )
    );
}

#[test]
fn an_agent_outside_the_spawnable_set_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.CreateIssue("Parse", "the parser", "the writer", "tests pass", "Nobody");"#,
        ToolFailure::InvalidArgument,
        "create_issue: `Nobody` is not an agent this run may spawn; spawnable: Builder",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on create_issue",
            "create_issue: `Nobody` is not an agent this run may spawn; spawnable: Builder"
        ]
    );
    assert_eq!(
        log.args("create_issue"),
        Some(
            json!({ "title": "Parse", "description": null, "inScope": "the parser", "outOfScope": "the writer", "completionCriteria": "tests pass", "blockedBy": [], "epicId": null, "agent": "Nobody", "reviewers": [] })
        )
    );
}

#[test]
fn an_issue_under_an_epic_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.CreateIssue("Parse", "the parser", "the writer", "tests pass", "Builder", epicId: "NOPE");"#,
        ToolFailure::NotFound,
        "create_issue: no epic `NOPE`",
    );
    assert_eq!(
        lines,
        ["NotFound on create_issue", "create_issue: no epic `NOPE`"]
    );
    assert_eq!(
        log.args("create_issue"),
        Some(
            json!({ "title": "Parse", "description": null, "inScope": "the parser", "outOfScope": "the writer", "completionCriteria": "tests pass", "blockedBy": [], "epicId": "NOPE", "agent": "Builder", "reviewers": [] })
        )
    );
}

#[test]
fn an_issue_blocker_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.CreateIssue("Parse", "the parser", "the writer", "tests pass", "Builder", blockedBy: ["NOPE-1"]);"#,
        ToolFailure::NotFound,
        "create_issue: no issue `NOPE-1` to block on",
    );
    assert_eq!(
        lines,
        [
            "NotFound on create_issue",
            "create_issue: no issue `NOPE-1` to block on"
        ]
    );
    assert_eq!(
        log.args("create_issue"),
        Some(
            json!({ "title": "Parse", "description": null, "inScope": "the parser", "outOfScope": "the writer", "completionCriteria": "tests pass", "blockedBy": ["NOPE-1"], "epicId": null, "agent": "Builder", "reviewers": [] })
        )
    );
}

#[test]
fn an_issue_over_the_cap_is_limit_exceeded() {
    let (lines, log) = fails_with(
        r#"Board.CreateIssue("Parse", "the parser", "the writer", "tests pass", "Builder");"#,
        ToolFailure::LimitExceeded,
        "create_issue: the board already holds 20 issues; max 20",
    );
    assert_eq!(
        lines,
        [
            "LimitExceeded on create_issue",
            "create_issue: the board already holds 20 issues; max 20"
        ]
    );
    assert_eq!(
        log.args("create_issue"),
        Some(
            json!({ "title": "Parse", "description": null, "inScope": "the parser", "outOfScope": "the writer", "completionCriteria": "tests pass", "blockedBy": [], "epicId": null, "agent": "Builder", "reviewers": [] })
        )
    );
}

#[test]
fn an_updated_issue_returns_to_its_program() {
    let (lines, log) = returns(
        r####"
Board.UpdateIssue("PARSE-1", status: Board.IssueStatus.InProgress, epic: Board.EpicAssignment.Ungroup);
Console.WriteLine("carried on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["carried on"]);
    assert_eq!(
        log.args("update_issue"),
        Some(
            json!({ "id": "PARSE-1", "title": null, "inScope": null, "outOfScope": null, "completionCriteria": null, "status": "in_progress", "epicId": "" })
        )
    );
}

#[test]
fn an_issue_patch_with_no_field_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.UpdateIssue("PARSE-1");"#,
        ToolFailure::InvalidArgument,
        "update_issue: nothing to change",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on update_issue",
            "update_issue: nothing to change"
        ]
    );
    assert_eq!(
        log.args("update_issue"),
        Some(
            json!({ "id": "PARSE-1", "title": null, "inScope": null, "outOfScope": null, "completionCriteria": null, "status": null })
        )
    );
}

#[test]
fn a_blanked_issue_field_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.UpdateIssue("PARSE-1", title: "");"#,
        ToolFailure::InvalidArgument,
        "update_issue: `title` may not be blanked",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on update_issue",
            "update_issue: `title` may not be blanked"
        ]
    );
    assert_eq!(
        log.args("update_issue"),
        Some(
            json!({ "id": "PARSE-1", "title": "", "inScope": null, "outOfScope": null, "completionCriteria": null, "status": null })
        )
    );
}

#[test]
fn an_update_of_an_issue_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.UpdateIssue("NOPE-1", status: Board.IssueStatus.Done);"#,
        ToolFailure::NotFound,
        "update_issue: no issue `NOPE-1`",
    );
    assert_eq!(
        lines,
        [
            "NotFound on update_issue",
            "update_issue: no issue `NOPE-1`"
        ]
    );
    assert_eq!(
        log.args("update_issue"),
        Some(
            json!({ "id": "NOPE-1", "title": null, "inScope": null, "outOfScope": null, "completionCriteria": null, "status": "done" })
        )
    );
}

#[test]
fn a_patch_naming_an_epic_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.UpdateIssue("PARSE-1", epic: Board.EpicAssignment.Set("NOPE"));"#,
        ToolFailure::NotFound,
        "update_issue: no epic `NOPE`",
    );
    assert_eq!(
        lines,
        ["NotFound on update_issue", "update_issue: no epic `NOPE`"]
    );
    assert_eq!(
        log.args("update_issue"),
        Some(
            json!({ "id": "PARSE-1", "title": null, "inScope": null, "outOfScope": null, "completionCriteria": null, "status": null, "epicId": "NOPE" })
        )
    );
}

#[test]
fn an_issue_blocker_list_returns_to_its_program() {
    let (lines, log) = returns(
        r####"
Board.SetIssueBlockedBy("PARSE-2", "PARSE-1");
Console.WriteLine("carried on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["carried on"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "PARSE-2", "blockedBy": ["PARSE-1"] }))
    );
}

#[test]
fn a_blank_id_on_an_issue_blocker_list_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.SetIssueBlockedBy("", "PARSE-1");"#,
        ToolFailure::InvalidArgument,
        "set_issue_blocked_by: `id` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on set_issue_blocked_by",
            "set_issue_blocked_by: `id` must not be blank"
        ]
    );
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "", "blockedBy": ["PARSE-1"] }))
    );
}

#[test]
fn a_blank_blocker_on_an_issue_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.SetIssueBlockedBy("PARSE-2", " ");"#,
        ToolFailure::InvalidArgument,
        "set_issue_blocked_by: a blocker must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on set_issue_blocked_by",
            "set_issue_blocked_by: a blocker must not be blank"
        ]
    );
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "PARSE-2", "blockedBy": [" "] }))
    );
}

#[test]
fn blocking_an_issue_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.SetIssueBlockedBy("NOPE-1", "PARSE-1");"#,
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue `NOPE-1`",
    );
    assert_eq!(
        lines,
        [
            "NotFound on set_issue_blocked_by",
            "set_issue_blocked_by: no issue `NOPE-1`"
        ]
    );
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "NOPE-1", "blockedBy": ["PARSE-1"] }))
    );
}

#[test]
fn an_issue_blocker_the_board_lacks_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.SetIssueBlockedBy("PARSE-2", "NOPE-1");"#,
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue `NOPE-1` to block on",
    );
    assert_eq!(
        lines,
        [
            "NotFound on set_issue_blocked_by",
            "set_issue_blocked_by: no issue `NOPE-1` to block on"
        ]
    );
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "PARSE-2", "blockedBy": ["NOPE-1"] }))
    );
}

#[test]
fn an_issue_edge_that_closes_a_cycle_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Board.SetIssueBlockedBy("PARSE-1", "PARSE-2");"#,
        ToolFailure::Conflict,
        "set_issue_blocked_by: blocking `PARSE-1` on `PARSE-2` would make a cycle",
    );
    assert_eq!(
        lines,
        [
            "Conflict on set_issue_blocked_by",
            "set_issue_blocked_by: blocking `PARSE-1` on `PARSE-2` would make a cycle"
        ]
    );
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "PARSE-1", "blockedBy": ["PARSE-2"] }))
    );
}

#[test]
fn an_issue_blocked_on_itself_is_a_conflict() {
    let (lines, log) = fails_with(
        r#"Board.SetIssueBlockedBy("PARSE-1", "PARSE-1");"#,
        ToolFailure::Conflict,
        "set_issue_blocked_by: `PARSE-1` cannot block itself",
    );
    assert_eq!(
        lines,
        [
            "Conflict on set_issue_blocked_by",
            "set_issue_blocked_by: `PARSE-1` cannot block itself"
        ]
    );
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "PARSE-1", "blockedBy": ["PARSE-1"] }))
    );
}

#[test]
fn a_removed_epic_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Board.RemoveEpic("PARSE");
Console.WriteLine($"{usage.Epics} {usage.MaxEpics} {usage.Issues} {usage.MaxIssues}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 4 3 20"]);
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "PARSE" })));
}

#[test]
fn removing_an_epic_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.RemoveEpic("NOPE");"#,
        ToolFailure::NotFound,
        "remove_epic: no epic `NOPE`",
    );
    assert_eq!(
        lines,
        ["NotFound on remove_epic", "remove_epic: no epic `NOPE`"]
    );
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "NOPE" })));
}

#[test]
fn a_removed_issue_hands_the_program_the_usage_after_it() {
    let (lines, log) = returns(
        r####"
var usage = Board.RemoveIssue("PARSE-1");
Console.WriteLine($"{usage.Epics} {usage.MaxEpics} {usage.Issues} {usage.MaxIssues}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["1 4 3 20"]);
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "PARSE-1" })));
}

#[test]
fn removing_an_issue_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.RemoveIssue("NOPE-1");"#,
        ToolFailure::NotFound,
        "remove_issue: no issue `NOPE-1`",
    );
    assert_eq!(
        lines,
        [
            "NotFound on remove_issue",
            "remove_issue: no issue `NOPE-1`"
        ]
    );
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "NOPE-1" })));
}

#[test]
fn a_registered_wait_does_not_stop_the_program() {
    // A wait is registered, not served: the program runs on past it to its end, and the loop
    // parks the agent afterwards. Both lines, in order, are the claim.
    let (lines, log) = returns(
        r####"
Console.WriteLine("before");
Board.WaitForIssue("PARSE-1");
Console.WriteLine("after");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["before", "after"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "PARSE-1" }))
    );
    assert_eq!(log.names(), ["wait_for_issue"]);
}

#[test]
fn a_blank_wait_id_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.WaitForIssue(" ");"#,
        ToolFailure::InvalidArgument,
        "wait_for_issue: `issueId` must not be blank",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on wait_for_issue",
            "wait_for_issue: `issueId` must not be blank"
        ]
    );
    assert_eq!(log.args("wait_for_issue"), Some(json!({ "issueId": " " })));
}

#[test]
fn waiting_on_this_runs_own_issue_is_an_argument_error() {
    let (lines, log) = fails_with(
        r#"Board.WaitForIssue("PARSE-1");"#,
        ToolFailure::InvalidArgument,
        "wait_for_issue: `PARSE-1` is the issue this run was assigned; it cannot wait on itself",
    );
    assert_eq!(
        lines,
        [
            "InvalidArgument on wait_for_issue",
            "wait_for_issue: `PARSE-1` is the issue this run was assigned; it cannot wait on itself"
        ]
    );
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "PARSE-1" }))
    );
}

#[test]
fn waiting_on_an_issue_that_is_not_there_is_not_found() {
    let (lines, log) = fails_with(
        r#"Board.WaitForIssue("NOPE-1");"#,
        ToolFailure::NotFound,
        "wait_for_issue: no issue `NOPE-1`",
    );
    assert_eq!(
        lines,
        [
            "NotFound on wait_for_issue",
            "wait_for_issue: no issue `NOPE-1`"
        ]
    );
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "NOPE-1" }))
    );
}

#[test]
fn waiting_without_a_board_is_unavailable() {
    // A run with no board withholds the whole family, so the host refuses the call before
    // gg's dispatch sees it.
    let (lines, log) = fails_granting(
        r#"Board.WaitForIssue("PARSE-1");"#,
        &all_operations_without(CAPABILITY_PROJECT_MANAGEMENT),
        ToolFailure::Unavailable,
        "the responder is never reached",
    );
    assert_eq!(
        lines,
        [
            "Unavailable on wait_for_issue",
            "`Gg.Board.WaitForIssue` is not available."
        ]
    );
    assert!(
        log.names().is_empty(),
        "the refusal must not reach gg's dispatch: {:?}",
        log.names()
    );
}

// --- the session-side surface: helpers ---------------------------------------------------------------

/// A whole program from a body, with the two `using` lines every program here writes.
fn csharp(body: &str) -> String {
    format!("using Gg;\nusing System;\n{body}")
}

/// Run a whole `program` with every operation offered and `responder` answering, handing back the
/// outcome itself — for the cases that read a view, an ending or a hand-over off it.
fn responding(
    program: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_with(program, &all_operations(), responder)
}

/// Run [`caught`]`(call)` with `tool` answering `failure` carrying `message`, and every other call
/// answered from the canned table — the seam a tool-backed failure is injected through without
/// failing a neighbour.
fn failing(
    call: &str,
    tool: &'static str,
    failure: ToolFailure,
    message: &'static str,
) -> (SandboxOutcome, CallLog) {
    responding(&caught(call), move |name: &str, args: &Value| {
        if name == tool {
            ToolOutcome::failed(failure, message)
        } else {
            canned_outcome(name, args)
        }
    })
}

/// Run the body `body` with `tool` answering `outcome` — a success the canned table does not carry —
/// and every other call canned.
fn answering(body: &str, tool: &'static str, outcome: ToolOutcome) -> (SandboxOutcome, CallLog) {
    responding(&csharp(body), move |name: &str, args: &Value| {
        if name == tool {
            outcome.clone()
        } else {
            canned_outcome(name, args)
        }
    })
}

/// Run a whole `program` against the double `build` makes, offered `operations` in `ending`'s group.
fn over(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    ending: RunEnding,
    build: impl FnOnce(&CallLog) -> FakeOperationApi,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(&prepare(program), operations, ending, false, build)
}

/// Run a whole `program` in `role`'s ending group with every operation offered.
fn as_role(program: &str, role: EndingRole) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(program),
        &all_operations(),
        RunEnding::Role(role),
        false,
        canned_outcome,
    )
}

/// Assert what a [`caught`] program wrote: `Code on Operation` exactly, then gg's sentence carrying
/// `fragment`.
fn assert_refused(outcome: &SandboxOutcome, head: &str, fragment: &str) {
    let lines = logs(outcome);
    assert_eq!(
        lines.len(),
        2,
        "expected the caught failure's two lines: {lines:?}"
    );
    assert_eq!(lines[0], head, "{lines:?}");
    assert!(
        lines[1].contains(fragment),
        "gg's own words must reach the program, {fragment:?} among them: {lines:?}"
    );
}

/// Assert `operation` is on the run's refusal roster, under gg's own id for it.
fn assert_on_the_roster(outcome: &SandboxOutcome, operation: &str) {
    assert!(
        outcome
            .refusals
            .iter()
            .any(|refusal| refusal.name == operation),
        "a withheld reach is recorded under gg's own id for it: {:?}",
        outcome.refusals
    );
}

/// The kinds and selectors a run opened views under.
fn opened(outcome: &SandboxOutcome) -> Vec<(ViewKind, &str)> {
    outcome
        .views_opened
        .iter()
        .map(|view| (view.kind, view.selector.as_str()))
        .collect()
}

/// A responder handing `archive_thread`'s composed arguments to gg's own guard, so a span refusal
/// carries production's sentence, and answering everything else from the canned table.
fn archiving(name: &str, args: &Value) -> ToolOutcome {
    if name != "archive_thread" {
        return canned_outcome(name, args);
    }
    let ranges = args["ranges"]
        .as_array()
        .map(|pairs| {
            pairs
                .iter()
                .map(|pair| crate::context::TurnRange {
                    from: pair[0].as_u64().unwrap_or_default(),
                    to: pair[1].as_u64().unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    crate::tools::ArchiveThreadTool.archive(ranges)
}

/// A wait answered with exactly `results`.
fn collected(results: Vec<SubagentResultData>) -> ToolOutcome {
    ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(results))
}

// --- context ------------------------------------------------------------------------------------------
//
// The four crossings are pinned by `crossings()` above.

#[test]
fn an_eviction_hands_a_csharp_program_what_it_freed() {
    let (outcome, log) = run_with(
        &csharp(
            r####"
var freed = Context.EvictFileView("src/a.cs");
Console.WriteLine($"{freed.Items} {freed.ReclaimedTokens} {string.Join(",", freed.Paths)} {freed.Detail}");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 300 src/a.ts dropped 2 items"]);
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.cs" }))
    );
}

#[test]
fn an_omitted_eviction_path_drops_every_view_from_csharp() {
    let (lines, log) = returns(
        "Console.WriteLine(Context.EvictFileView().Items);\n",
        canned_outcome,
    );
    assert_eq!(lines, ["2"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_eviction_path_is_an_argument_error_in_csharp() {
    let (outcome, log) = failing(
        r#"Context.EvictFileView("");"#,
        "evict_file_view",
        ToolFailure::InvalidArgument,
        "`evict_file_view`: `path` must not be empty; omit it to drop every file view",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on evict_file_view",
        "omit it to drop every file view",
    );
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": "" })));
}

#[test]
fn an_archive_hands_a_csharp_program_what_it_freed() {
    let (lines, log) = returns(
        r####"
var freed = Context.ArchiveThread(new Context.TurnRange(4, 19));
Console.WriteLine($"{freed.Items} {freed.ReclaimedTokens} {freed.Detail}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["2 300 dropped 2 items"]);
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19]] }))
    );
}

#[test]
fn an_empty_archive_list_is_an_argument_error_in_csharp() {
    let (outcome, log) = responding(&caught("Context.ArchiveThread();"), archiving);
    assert_refused(
        &outcome,
        "InvalidArgument on archive_thread",
        "between 1 and 32 inclusive turn ranges",
    );
    assert_eq!(log.args("archive_thread"), Some(json!({ "ranges": [] })));
}

#[test]
fn more_archive_spans_than_gg_takes_is_an_argument_error_in_csharp() {
    let spans: Vec<String> = (0..=MAX_ARCHIVE_RANGES)
        .map(|turn| format!("new Context.TurnRange({turn}, {turn})"))
        .collect();
    let (outcome, log) = responding(
        &caught(&format!("Context.ArchiveThread({});", spans.join(", "))),
        archiving,
    );
    assert_refused(
        &outcome,
        "InvalidArgument on archive_thread",
        "between 1 and 32 inclusive turn ranges",
    );
    assert_eq!(
        log.args("archive_thread")
            .and_then(|args| args["ranges"].as_array().map(Vec::len)),
        Some(MAX_ARCHIVE_RANGES + 1),
        "the whole list crossed as one call"
    );
}

#[test]
fn an_archive_span_that_ends_before_it_starts_is_an_argument_error_in_csharp() {
    let (outcome, log) = responding(
        &caught("Context.ArchiveThread(new Context.TurnRange(19, 4));"),
        archiving,
    );
    assert_refused(
        &outcome,
        "InvalidArgument on archive_thread",
        "the range [19, 4] ends before it starts",
    );
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[19, 4]] }))
    );
}

#[test]
fn an_archive_search_hands_a_csharp_program_its_hits() {
    let (lines, log) = returns(
        r####"
var found = Context.SearchArchive("the parser");
var hit = found.Hits[0];
Console.WriteLine($"{found.ArchiveEmpty} {hit.Seq} {hit.Role} {hit.Text}");
Console.WriteLine(hit.Role == Context.MessageRole.Assistant);
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["False 3 Assistant the earlier answer", "True"]);
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the parser" }))
    );
}

#[test]
fn an_archive_search_that_matched_nothing_is_an_empty_hit_list_in_csharp() {
    let (outcome, _log) = answering(
        r####"
var found = Context.SearchArchive("nothing at all");
Console.WriteLine($"{found.ArchiveEmpty} {found.Hits.Count}");
"####,
        "search_archive",
        ToolOutcome::ok("no hits", "searched").with_data(ApiData::ArchiveSearch(
            ArchiveSearchData {
                archive_empty: false,
                hits: Vec::new(),
            },
        )),
    );
    assert_eq!(logs(&outcome), ["False 0"]);
}

#[test]
fn an_empty_archive_says_so_rather_than_matching_nothing_in_csharp() {
    let (outcome, _log) = answering(
        r####"
var found = Context.SearchArchive("the parser");
Console.WriteLine($"{found.ArchiveEmpty} {found.Hits.Count}");
"####,
        "search_archive",
        ToolOutcome::ok("nothing archived", "searched").with_data(ApiData::ArchiveSearch(
            ArchiveSearchData {
                archive_empty: true,
                hits: Vec::new(),
            },
        )),
    );
    assert_eq!(logs(&outcome), ["True 0"]);
}

#[test]
fn an_empty_archive_query_is_an_argument_error_in_csharp() {
    let (outcome, _log) = failing(
        r#"Context.SearchArchive("");"#,
        "search_archive",
        ToolFailure::InvalidArgument,
        "`search_archive`: `query` must not be empty",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on search_archive",
        "`query` must not be empty",
    );
}

#[test]
fn a_compaction_is_registered_and_a_csharp_program_runs_on() {
    let (lines, log) = returns(
        r####"
Context.Compact("scaffolded the page", "src/Main.cs");
Console.WriteLine("ran on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["ran on"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "scaffolded the page", "files": ["src/Main.cs"] }))
    );
}

#[test]
fn a_blank_compaction_summary_is_an_argument_error_in_csharp() {
    let (outcome, _log) = failing(
        r#"Context.Compact("   ");"#,
        "compact",
        ToolFailure::InvalidArgument,
        "`compact`: `summary` must be a non-empty string",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on compact",
        "`summary` must be a non-empty string",
    );
}

// --- delegation ---------------------------------------------------------------------------------------
//
// The six crossings are pinned by `crossings()` above, and `SubagentHandle.Send` is driven from a real
// handle by `a_member_method_reaches_the_operation_it_is_an_alias_of`.

#[test]
fn a_spawn_hands_a_csharp_program_its_childs_handle() {
    let (lines, log) = returns(
        r####"
var child = Delegation.SpawnSubagent("subagent", Delegation.Brief.Prompt("write the lexer"));
Console.WriteLine($"{child.Id} {child.Slot} {child.ModelId}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-1 primary test/model"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }))
    );
}

#[test]
fn an_issue_brief_crosses_from_csharp_as_an_issue_id() {
    let (lines, log) = returns(
        r####"
Console.WriteLine(Delegation.SpawnSubagent("subagent", Delegation.Brief.Issue("AUTH-1")).Id);
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": null, "issueId": "AUTH-1" }))
    );
}

#[test]
fn an_agent_this_session_may_not_spawn_is_an_argument_error_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.SpawnSubagent("nope", Delegation.Brief.Prompt("write it"));"#,
        "spawn_subagent",
        ToolFailure::InvalidArgument,
        "`spawn_subagent`: this session may not spawn `nope`; agents it may spawn: subagent",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on spawn_subagent",
        "agents it may spawn: subagent",
    );
}

#[test]
fn a_spawn_at_the_delegation_depth_cap_is_limit_exceeded_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.SpawnSubagent("subagent", Delegation.Brief.Prompt("write it"));"#,
        "spawn_subagent",
        ToolFailure::LimitExceeded,
        "`spawn_subagent`: this run's delegation depth cap of 2 is already reached",
    );
    assert_refused(
        &outcome,
        "LimitExceeded on spawn_subagent",
        "delegation depth cap",
    );
}

#[test]
fn a_wait_hands_a_csharp_program_each_childs_result() {
    let (lines, log) = returns(
        r####"
var result = Delegation.WaitForSubagents("agent-1")[0];
Console.WriteLine($"{result.Id} {result.Status} {result.Summary}");
Console.WriteLine(result.Status == Delegation.AgentStatus.Completed);
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-1 Completed did the work", "True"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

#[test]
fn a_wait_with_no_ids_collects_every_child_from_csharp() {
    let (lines, log) = returns(
        "Console.WriteLine(Delegation.WaitForSubagents().Count);\n",
        canned_outcome,
    );
    assert_eq!(lines, ["1"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

#[test]
fn a_child_with_no_ending_reports_no_status_in_csharp() {
    let (outcome, _log) = answering(
        r####"
var result = Delegation.WaitForSubagents()[0];
Console.WriteLine($"{result.Status is null} {result.Id} {result.Summary}");
"####,
        "wait_for_subagents",
        collected(vec![SubagentResultData {
            id: "agent-9".to_string(),
            status: None,
            summary: "it said this much".to_string(),
        }]),
    );
    assert_eq!(logs(&outcome), ["True agent-9 it said this much"]);
}

#[test]
fn every_agent_status_reaches_a_csharp_program_as_its_own_member() {
    let statuses = [
        AgentStatusData::Completed,
        AgentStatusData::Exhausted,
        AgentStatusData::TimedOut,
        AgentStatusData::ModelError,
        AgentStatusData::AuthError,
        AgentStatusData::LimitExceeded,
    ];
    let (outcome, _log) = answering(
        r####"
foreach (var result in Delegation.WaitForSubagents())
{
    Console.WriteLine($"{result.Id} {result.Status}");
}
"####,
        "wait_for_subagents",
        collected(
            statuses
                .iter()
                .enumerate()
                .map(|(index, status)| SubagentResultData {
                    id: format!("agent-{index}"),
                    status: Some(*status),
                    summary: "did the work".to_string(),
                })
                .collect(),
        ),
    );
    assert_eq!(
        logs(&outcome),
        [
            "agent-0 Completed",
            "agent-1 Exhausted",
            "agent-2 TimedOut",
            "agent-3 ModelError",
            "agent-4 AuthError",
            "agent-5 LimitExceeded",
        ]
    );
}

#[test]
fn waiting_on_a_child_this_session_never_spawned_is_not_found_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.WaitForSubagents("agent-9");"#,
        "wait_for_subagents",
        ToolFailure::NotFound,
        "`wait_for_subagents`: no child agent `agent-9`",
    );
    assert_refused(
        &outcome,
        "NotFound on wait_for_subagents",
        "no child agent `agent-9`",
    );
}

#[test]
fn a_message_reaches_a_running_child_from_csharp() {
    let (lines, log) = returns(
        r####"
Delegation.SendMessage("agent-1", "prefer the simpler parser");
Console.WriteLine("delivered");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["delivered"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn a_message_to_a_child_that_is_not_there_is_not_found_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.SendMessage("agent-9", "prefer the simpler parser");"#,
        "send_message",
        ToolFailure::NotFound,
        "`send_message`: no agent `agent-9`",
    );
    assert_refused(&outcome, "NotFound on send_message", "no agent `agent-9`");
}

#[test]
fn a_message_to_a_child_that_has_returned_is_a_conflict_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.SendMessage("agent-1", "prefer the simpler parser");"#,
        "send_message",
        ToolFailure::Conflict,
        "`send_message`: `agent-1` has already returned",
    );
    assert_refused(
        &outcome,
        "Conflict on send_message",
        "`agent-1` has already returned",
    );
}

#[test]
fn a_transition_is_registered_and_a_csharp_program_runs_on() {
    let (lines, log) = returns(
        r####"
Delegation.TransitionState("verify", note: "the build is green");
Console.WriteLine("ran on");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["ran on"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "verify", "note": "the build is green" }))
    );
}

#[test]
fn a_state_this_session_cannot_reach_is_an_argument_error_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.TransitionState("nowhere");"#,
        "transition_state",
        ToolFailure::InvalidArgument,
        "`transition_state`: `verify` is the only state this one has an edge to",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on transition_state",
        "the only state this one has an edge to",
    );
}

#[test]
fn a_second_succession_declared_from_one_csharp_program_is_refused() {
    // The two share one slot: the first declaration is the one gg keeps, and the second is refused.
    let mut declared = false;
    let (outcome, log) = responding(
        &csharp(
            r####"
Delegation.Exec("Builder");
Console.WriteLine("the exec stands");
try
{
    Delegation.TransitionState("verify");
    Console.WriteLine("it returned");
}
catch (ApiException failure)
{
    Console.WriteLine($"{failure.Code} on {failure.Operation}");
}
"####,
        ),
        move |name: &str, args: &Value| {
            if declared {
                return ToolOutcome::failed(
                    ToolFailure::Refused,
                    "this session already declared a succession this turn",
                );
            }
            declared = true;
            canned_outcome(name, args)
        },
    );
    assert_eq!(
        logs(&outcome),
        ["the exec stands", "Refused on transition_state"]
    );
    assert_eq!(log.names(), ["exec", "transition_state"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": null }))
    );
}

#[test]
fn a_transition_with_no_machine_driving_the_session_is_unavailable_in_csharp() {
    // The one `Binding::Machine` operation: no capability buys it, so it is withheld by leaving it
    // out of the allowlist, which is what an agent standing in no state machine has.
    let operations: Vec<_> = all_operations()
        .into_iter()
        .filter(|id| *id != DELEGATION_TRANSITION_STATE)
        .collect();
    let (outcome, log) = run_with(
        &caught(r#"Delegation.TransitionState("verify");"#),
        &operations,
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "Unavailable on transition_state",
        "is not available.",
    );
    assert_on_the_roster(&outcome, "delegation.transition_state");
    assert!(
        log.names().is_empty(),
        "the refusal must not reach gg's dispatch: {:?}",
        log.names()
    );
}

#[test]
fn an_exec_is_registered_and_a_csharp_program_runs_to_its_end() {
    let (lines, log) = returns(
        r####"
Delegation.Exec("Builder", prompt: "pick it up from here");
Console.WriteLine("still running");
Files.WriteFile("notes.md", "handed over");
Console.WriteLine("ran to the end");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["still running", "ran to the end"]);
    assert_eq!(log.names(), ["exec", "write_file"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": "pick it up from here" }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_an_argument_error_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.Exec("nope");"#,
        "exec",
        ToolFailure::InvalidArgument,
        "`exec`: this session may not become `nope`; agents it may become: Builder",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on exec",
        "agents it may become: Builder",
    );
}

#[test]
fn an_exec_inside_a_state_machine_is_unavailable_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.Exec("Builder");"#,
        "exec",
        ToolFailure::Unavailable,
        "`exec`: this session runs inside a state machine; leave it with a transition instead",
    );
    assert_refused(&outcome, "Unavailable on exec", "inside a state machine");
}

#[test]
fn a_fork_hands_a_csharp_program_the_copys_handle() {
    let (lines, log) = returns(
        r####"
var copy = Delegation.Fork("try the other fix");
Console.WriteLine($"{copy.Id} {copy.Slot} {copy.ModelId}");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["agent-2 primary test/model"]);
    assert_eq!(
        log.args("fork"),
        Some(json!({ "prompt": "try the other fix" }))
    );
}

#[test]
fn a_blank_fork_prompt_is_an_argument_error_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.Fork("  ");"#,
        "fork",
        ToolFailure::InvalidArgument,
        "`fork`: `prompt` must not be blank",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on fork",
        "`prompt` must not be blank",
    );
}

#[test]
fn a_fork_at_the_delegation_depth_cap_is_limit_exceeded_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.Fork("try the other fix");"#,
        "fork",
        ToolFailure::LimitExceeded,
        "`fork`: this run's delegation depth cap of 2 is already reached",
    );
    assert_refused(&outcome, "LimitExceeded on fork", "delegation depth cap");
}

#[test]
fn a_fork_with_no_delegation_runtime_is_unavailable_in_csharp() {
    let (outcome, _log) = failing(
        r#"Delegation.Fork("try the other fix");"#,
        "fork",
        ToolFailure::Unavailable,
        "`fork`: there is no delegation runtime to collect the copy with",
    );
    assert_refused(&outcome, "Unavailable on fork", "no delegation runtime");
}

// --- programs -----------------------------------------------------------------------------------------

#[test]
fn a_history_hands_a_csharp_program_each_programs_shape() {
    let source = "var x = 1;\nConsole.WriteLine(x);";
    let (outcome, _log) = evaluate_with_programs(
        &prepare(&csharp(
            r####"
var held = Programs.History()[0];
Console.WriteLine($"{held.Id} {held.Turn} {held.Lines} {held.Chars} {held.Ok} {held.Error ?? "none"}");
"####,
        )),
        None,
        &[("k3p9", 3, source), ("m7q2", 4, "Console.WriteLine(2);")],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [format!("k3p9 3 2 {} True none", source.chars().count())]
    );
}

#[test]
fn a_history_without_a_library_is_unavailable_in_csharp() {
    let (outcome, log) = run_with(
        &caught("Programs.History();"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        canned_outcome,
    );
    assert_refused(&outcome, "Unavailable on history", "is not available.");
    assert_on_the_roster(&outcome, "programs.history");
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn a_get_hands_a_csharp_program_the_source_that_ran() {
    let (outcome, _log) = evaluate_with_programs(
        &prepare(&csharp("Console.WriteLine(Programs.Get(\"bbbb\"));\n")),
        None,
        &[
            ("aaaa", 1, "Console.WriteLine(\"first\");"),
            ("bbbb", 2, "Console.WriteLine(\"second\");"),
        ],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Console.WriteLine(\"second\");"]);
}

#[test]
fn an_id_the_library_has_dropped_is_not_found_in_csharp() {
    // Five programs into a library that keeps the most recent four: `aaaa` really was issued, and
    // has been let go.
    let (outcome, _log) = evaluate_with_programs(
        &prepare(&caught(r#"Programs.Get("aaaa");"#)),
        Some(4),
        &[
            ("aaaa", 1, "Console.WriteLine(1);"),
            ("bbbb", 2, "Console.WriteLine(2);"),
            ("cccc", 3, "Console.WriteLine(3);"),
            ("dddd", 4, "Console.WriteLine(4);"),
            ("eeee", 5, "Console.WriteLine(5);"),
        ],
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "NotFound on get",
        "no program is kept under the id `aaaa`",
    );
    let said = &logs(&outcome)[1];
    assert!(
        said.contains("`bbbb` (turn 2)") && said.contains("`eeee` (turn 5)"),
        "the ids still held are named: {said}"
    );
    assert!(
        !said.contains("(turn 1)"),
        "and the dropped one is not: {said}"
    );
}

#[test]
fn a_get_without_a_library_is_unavailable_in_csharp() {
    let (outcome, log) = run_with(
        &caught(r#"Programs.Get("aaaa");"#),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        canned_outcome,
    );
    assert_refused(&outcome, "Unavailable on get", "is not available.");
    assert_on_the_roster(&outcome, "programs.get");
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn a_blank_rerun_source_is_an_argument_error_in_csharp() {
    let (outcome, _log) = evaluate_with_programs(
        &prepare(&caught(r#"Programs.Rerun("   ");"#)),
        None,
        &[],
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "InvalidArgument on rerun",
        "`source` must not be blank",
    );
    assert!(outcome.rerun.is_none());
}

#[test]
fn a_second_rerun_from_one_csharp_program_is_refused() {
    let (outcome, _log) = evaluate_with_programs(
        &prepare(&csharp(
            r####"
Programs.Rerun("Console.WriteLine(\"the first\");");
try
{
    Programs.Rerun("Console.WriteLine(\"the second\");");
    Console.WriteLine("it returned");
}
catch (ApiException failure)
{
    Console.WriteLine($"{failure.Code} on {failure.Operation}");
    Console.WriteLine(failure.Message);
}
"####,
        )),
        None,
        &[],
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "Refused on rerun",
        "this program already handed one over",
    );
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("Console.WriteLine(\"the first\");"),
        "the first hand-over stands"
    );
}

#[test]
fn a_rerun_a_failing_csharp_program_declared_is_revoked() {
    let (outcome, _log) = evaluate_with_programs(
        &prepare(&csharp(
            r####"
Programs.Rerun("Console.WriteLine(\"never\");");
throw new InvalidOperationException("the checks did not pass");
"####,
        )),
        None,
        &[],
        canned_outcome,
    );
    assert!(outcome.rerun.is_none(), "{:?}", outcome.rerun);
    assert!(outcome.revoked_rerun, "the model is told it was cancelled");
    assert!(
        program_error(&outcome)
            .message
            .contains("the checks did not pass")
    );
}

#[test]
fn a_rerun_without_a_library_is_unavailable_in_csharp() {
    let (outcome, log) = run_with(
        &caught(r#"Programs.Rerun("Console.WriteLine(\"again\");");"#),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        canned_outcome,
    );
    assert_refused(&outcome, "Unavailable on rerun", "is not available.");
    assert!(outcome.rerun.is_none());
    assert_on_the_roster(&outcome, "programs.rerun");
    assert!(log.names().is_empty(), "{:?}", log.names());
}

// --- docs ---------------------------------------------------------------------------------------------

#[test]
fn a_search_with_no_query_and_no_filter_is_an_argument_error_in_csharp() {
    let (outcome, _log) = responding(&caught("Docs.Search();"), canned_outcome);
    assert_refused(
        &outcome,
        "InvalidArgument on search",
        "a search needs something to look for",
    );
}

#[test]
fn a_search_limit_of_zero_is_an_argument_error_in_csharp() {
    let (outcome, _log) = responding(&caught(r#"Docs.Search("view", limit: 0);"#), canned_outcome);
    assert_refused(
        &outcome,
        "InvalidArgument on search",
        "a page of zero hits would answer nothing",
    );
}

#[test]
fn a_search_answers_a_csharp_program_granted_nothing() {
    let (outcome, log) = run_with(
        &csharp(
            r####"
var page = Docs.Search("view");
Console.WriteLine($"{page.Total} {page.Offset} {page.Hits.Count}");
"####,
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["0 0 0"]);
    assert_eq!(
        opened(&outcome),
        [(ViewKind::Search, crate::context::SEARCH_RESULTS_VIEW)]
    );
    assert!(outcome.refusals.is_empty(), "{:?}", outcome.refusals);
    assert!(log.names().is_empty(), "a search is not a tool call");
}

#[test]
fn a_close_takes_one_documentation_view_back_out_in_csharp() {
    let (outcome, _log) = responding(
        &csharp(
            r####"
Views.OpenDocsView("Gg.Views.OpenText");
Console.WriteLine(Docs.Close("Gg.Views.OpenText"));
"####,
        ),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(outcome.views_closed, ["Gg.Views.OpenText"]);
}

#[test]
fn a_close_all_takes_every_documentation_view_out_in_csharp() {
    let (outcome, _log) = responding(
        &csharp(
            r####"
Views.OpenDocsView("Gg.Views.OpenText");
Views.OpenDocsView("Gg.Files.ReadFile");
Console.WriteLine(Docs.CloseAll());
"####,
        ),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2"]);
    assert_eq!(
        outcome.views_closed,
        ["(every documentation view)"],
        "one call is recorded as one close, under gg's own word for all of them"
    );
}

#[test]
fn a_close_all_without_the_capability_is_unavailable_in_csharp() {
    let (outcome, log) = run_with(
        &caught("Docs.CloseAll();"),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        canned_outcome,
    );
    assert_refused(&outcome, "Unavailable on close_all", "is not available.");
    assert_on_the_roster(&outcome, "docs.close_all");
    assert!(log.names().is_empty(), "{:?}", log.names());
}

// --- views --------------------------------------------------------------------------------------------

#[test]
fn an_image_view_reaches_a_csharp_program_as_the_image_variant() {
    let (outcome, log) = responding(
        &csharp(
            r####"
var read = Views.OpenFile("logo.png");
if (read is Files.ImageFile image)
{
    Console.WriteLine($"{image.MediaType} {image.Label} {image.Bytes} {image.Shown}");
}
"####,
        ),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["image/png PNG 1234 True"]);
    assert_eq!(opened(&outcome), [(ViewKind::File, "logo.png")]);
    assert_eq!(log.names(), ["read_file"]);
}

#[test]
fn a_file_view_of_a_path_that_is_not_there_is_not_found_in_csharp() {
    let (outcome, _log) = failing(
        r#"Views.OpenFile("missing.md");"#,
        "read_file",
        ToolFailure::NotFound,
        "`read_file`: no such file `missing.md`",
    );
    assert_refused(
        &outcome,
        "NotFound on open_file",
        "no such file `missing.md`",
    );
    assert!(
        outcome.views_opened.is_empty(),
        "a failed read opens nothing: {:?}",
        outcome.views_opened
    );
}

#[test]
fn a_file_view_offset_past_the_end_is_an_argument_error_in_csharp() {
    let (outcome, log) = failing(
        r#"Views.OpenFile("notes.md", offset: 40);"#,
        "read_file",
        ToolFailure::InvalidArgument,
        "`read_file`: offset 40 is past the end of notes.md (2 lines)",
    );
    assert_refused(
        &outcome,
        "InvalidArgument on open_file",
        "offset 40 is past the end",
    );
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 40, "limit": null }))
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_file_view_width_of_zero_is_an_argument_error_in_csharp() {
    let (outcome, _log) = responding(
        &caught(r#"Views.OpenFile("src/a.cs", maxLineChars: 0);"#),
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "InvalidArgument on open_file",
        "`maxLineChars` must be between 1 and 65536 (0 given)",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_file_view_width_over_the_bound_is_an_argument_error_in_csharp() {
    let (outcome, _log) = responding(
        &caught(r#"Views.OpenFile("src/a.cs", maxLineChars: 65537);"#),
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "InvalidArgument on open_file",
        "`maxLineChars` must be between 1 and 65536 (65537 given)",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_file_view_over_the_size_cap_is_limit_exceeded_in_csharp() {
    let oversized = "x".repeat(70_000);
    let (outcome, _log) = responding(&caught(r#"Views.OpenFile("src/Wide.cs");"#), {
        let oversized = oversized.clone();
        move |name: &str, args: &Value| {
            if name != "read_file" {
                return canned_outcome(name, args);
            }
            ToolOutcome::ok(oversized.clone(), "read 1 line").with_data(ApiData::FileText(
                FileTextData {
                    contents: oversized.clone(),
                    first_line: 1,
                    last_line: 1,
                    total_lines: 1,
                    byte_truncated: false,
                },
            ))
        }
    });
    assert_refused(
        &outcome,
        "LimitExceeded on open_file",
        "view body exceeds max size (70000 bytes; max 65536)",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_file_view_without_read_file_is_unavailable_in_csharp() {
    let (outcome, log) = run_with(
        &caught(r#"Views.OpenFile("src/a.cs");"#),
        &all_operations_without(CAPABILITY_READ_FILE),
        canned_outcome,
    );
    assert_refused(&outcome, "Unavailable on open_file", "is not available.");
    assert_on_the_roster(&outcome, "views.open_file");
    assert!(
        log.names().is_empty(),
        "the refusal must not reach gg's dispatch: {:?}",
        log.names()
    );
}

#[test]
fn an_empty_text_view_label_is_an_argument_error_in_csharp() {
    let (outcome, _log) = responding(
        &caught(r#"Views.OpenText("", "eight files");"#),
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "InvalidArgument on open_text",
        "a view needs a non-empty label",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_text_view_body_over_the_cap_is_limit_exceeded_in_csharp() {
    let (outcome, _log) = responding(
        &caught(r#"Views.OpenText("summary", new string('x', 65537));"#),
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "LimitExceeded on open_text",
        "view body exceeds max size (65537 bytes; max 65536)",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_text_view_label_over_the_cap_is_limit_exceeded_in_csharp() {
    let (outcome, _log) = responding(
        &caught(r#"Views.OpenText(new string('l', 201), "eight files, two failing");"#),
        canned_outcome,
    );
    assert_refused(
        &outcome,
        "LimitExceeded on open_text",
        "label exceeds max length (201 bytes; max 200)",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_documentation_name_nothing_on_this_surface_has_is_not_found_in_csharp() {
    let (outcome, _log) = over(
        &caught(r#"Views.OpenDocsView("Gg.Views.NoSuchThing");"#),
        &all_operations(),
        RunEnding::None,
        |log| {
            FakeOperationApi::with(log, canned_outcome).docs_index(
                &["Gg.Views.OpenText", "Gg.Delegation.Fork"],
                &["Gg.Views.OpenText"],
            )
        },
    );
    assert_refused(
        &outcome,
        "NotFound on open_docs_view",
        "no documentation for `Gg.Views.NoSuchThing`; this session binds `Gg.Views.OpenText`",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_documentation_name_this_agent_does_not_bind_is_not_found_in_csharp() {
    let (outcome, _log) = over(
        &caught(r#"Views.OpenDocsView("Gg.Delegation.Fork");"#),
        &all_operations(),
        RunEnding::None,
        |log| {
            FakeOperationApi::with(log, canned_outcome).docs_index(
                &["Gg.Views.OpenText", "Gg.Delegation.Fork"],
                &["Gg.Views.OpenText"],
            )
        },
    );
    assert_refused(
        &outcome,
        "NotFound on open_docs_view",
        "this session does not bind it; it binds `Gg.Views.OpenText`",
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn an_empty_view_selector_is_an_argument_error_in_csharp() {
    let (outcome, _log) = responding(&caught(r#"Views.Close("");"#), canned_outcome);
    assert_refused(
        &outcome,
        "InvalidArgument on close",
        "needs a non-empty selector",
    );
}

#[test]
fn a_view_close_without_agent_managed_context_is_unavailable_in_csharp() {
    let (outcome, log) = run_with(
        &caught(r#"Views.Close("summary");"#),
        &all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT),
        canned_outcome,
    );
    // `close` is the key `Docs.Close` fails under too, so what tells the two apart is the sentence,
    // which names this call in this arm's spelling, and the roster, which names it under gg's id.
    assert_refused(
        &outcome,
        "Unavailable on close",
        "`Gg.Views.Close` is not available.",
    );
    assert!(
        !logs(&outcome)[1].contains("Docs"),
        "the refusal names the view call, not its neighbour: {:?}",
        logs(&outcome)
    );
    assert_on_the_roster(&outcome, "views.close");
    assert!(
        outcome
            .refusals
            .iter()
            .all(|refusal| refusal.name != "docs.close"),
        "{:?}",
        outcome.refusals
    );
    assert!(log.names().is_empty(), "{:?}", log.names());
}

// --- session ------------------------------------------------------------------------------------------

#[test]
fn a_blank_finish_summary_is_an_argument_error_in_csharp() {
    let (outcome, _log) = as_role(&caught(r#"Session.Finish("  ");"#), EndingRole::Standard);
    assert_refused(
        &outcome,
        "InvalidArgument on finish",
        "The session is NOT over",
    );
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
}

#[test]
fn a_later_finish_in_one_csharp_program_replaces_the_summary() {
    let (outcome, _log) = as_role(
        &csharp(
            r####"
Session.Finish("the first attempt");
Session.Finish("the second, with the tests green");
"####,
        ),
        EndingRole::Standard,
    );
    let completion = outcome
        .completion
        .as_ref()
        .expect("the program declared an ending");
    assert_eq!(
        completion.ending,
        Ending::Finished {
            summary: "the second, with the tests green".to_string()
        }
    );
    assert_eq!(completion.superseded, 1);
}

#[test]
fn a_completion_a_failing_csharp_program_declared_is_revoked() {
    let (outcome, _log) = as_role(
        &csharp(
            r####"
Session.Finish("the work is done");
throw new InvalidOperationException("the checks did not pass");
"####,
        ),
        EndingRole::Standard,
    );
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
    assert_eq!(
        outcome.revoked_completion,
        Some(Ending::Finished {
            summary: "the work is done".to_string()
        })
    );
    assert!(
        program_error(&outcome)
            .message
            .contains("the checks did not pass"),
        "the program error is kept beside the revoked ending"
    );
}

#[test]
fn a_reviewers_program_cannot_finish_in_csharp() {
    let (outcome, log) = as_role(&caught(r#"Session.Finish("done");"#), EndingRole::Review);
    assert_refused(
        &outcome,
        "Unavailable on finish",
        "Use `Gg.Session.Approve` or `Gg.Session.RequestChanges` instead.",
    );
    assert_on_the_roster(&outcome, "session.finish");
    assert!(outcome.completion.is_none());
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn a_standard_agents_program_cannot_approve_in_csharp() {
    let (outcome, log) = as_role(&caught("Session.Approve();"), EndingRole::Standard);
    assert_refused(
        &outcome,
        "Unavailable on approve",
        "Use `Gg.Session.Finish` instead.",
    );
    assert_on_the_roster(&outcome, "session.approve");
    assert!(outcome.completion.is_none());
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn a_standard_agents_program_cannot_request_changes_in_csharp() {
    let (outcome, log) = as_role(
        &caught(r#"Session.RequestChanges("widen the test");"#),
        EndingRole::Standard,
    );
    assert_refused(
        &outcome,
        "Unavailable on request_changes",
        "Use `Gg.Session.Finish` instead.",
    );
    assert_on_the_roster(&outcome, "session.request_changes");
    assert!(outcome.completion.is_none());
    assert!(log.names().is_empty(), "{:?}", log.names());
}

#[test]
fn an_empty_change_list_is_an_argument_error_in_csharp() {
    let (outcome, _log) = as_role(&caught("Session.RequestChanges();"), EndingRole::Review);
    assert_refused(
        &outcome,
        "InvalidArgument on request_changes",
        "requires at least one change",
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn a_change_list_of_blank_entries_is_an_argument_error_in_csharp() {
    let (outcome, _log) = as_role(
        &caught(r#"Session.RequestChanges("", "  ");"#),
        EndingRole::Review,
    );
    assert_refused(
        &outcome,
        "InvalidArgument on request_changes",
        "requires at least one change",
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn a_verdict_a_failing_csharp_program_declared_is_revoked() {
    let (outcome, _log) = as_role(
        &csharp(
            r####"
Session.Approve();
throw new InvalidOperationException("one more check failed");
"####,
        ),
        EndingRole::Review,
    );
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
    assert_eq!(outcome.revoked_completion, Some(Ending::Approved));
    assert!(
        program_error(&outcome)
            .message
            .contains("one more check failed")
    );
}

// --- feedback -----------------------------------------------------------------------------------------
//
// The uncaught `ApiException` path is held by `a_failure_is_thrown_whether_it_is_caught_or_let_out`,
// and every way an entry-point status reaches the model by the substrate file.

#[test]
fn a_partial_line_a_csharp_program_wrote_still_reaches_the_model() {
    let (lines, _log) = returns(
        r####"
Console.WriteLine("a whole line");
Console.Write("half, ");
Console.Write("and never ended");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["a whole line", "half, and never ended"]);
}

#[test]
fn console_error_is_a_different_channel_from_a_csharp_programs_log() {
    let (lines, _log) = returns(
        r####"
Console.Error.WriteLine("for the runtime's own dying words");
Console.WriteLine("for the model");
"####,
        canned_outcome,
    );
    assert_eq!(lines, ["for the model"]);
}

#[test]
fn a_csharp_program_that_logged_before_it_threw_keeps_what_it_logged() {
    let (outcome, _log) = responding(
        &csharp(
            r####"
Console.WriteLine("one");
Console.WriteLine("two");
throw new InvalidOperationException("the model's own");
"####,
        ),
        canned_outcome,
    );
    assert!(
        program_error(&outcome).message.contains("the model's own"),
        "{:?}",
        outcome.result
    );
    assert_eq!(outcome.logs, ["one", "two"]);
}
