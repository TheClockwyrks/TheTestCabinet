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
//! # What is not here yet
//!
//! The [agreement gate](super::super::agreement) proper, which iterates the **registered** set — this arm
//! is not in it, because a language cannot be half-registered. What stands in for it is
//! [`the_catalogue_agrees_with_a_registered_arm`], which runs gg's own comparison over this arm's
//! committed catalogue against TypeScript's, so the surface is held to the seam's rule before the
//! registration that will hold it there automatically.

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use super::GUEST_COMPONENT;
use super::substrate::{evaluate, logs, prepare, program_error};
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
/// lowered onto the wrong wire slot, a `TextEdit.Clear` read as "leave it alone" instead of "clear
/// it", an enum member whose wire word did not translate — none of them is a compile error in any of
/// the ten, and all of them are visible here.
///
/// What differs from every other arm's table is **named arguments**: C#'s way of skipping over the
/// optional arguments you do not want is to name the one you do, so `project.CreateIssue(title: …,
/// agent: …, reviewers: …)` reads as a call whose five required arguments happen to be written the
/// same way. That is the language's own answer to the shape every other arm answers differently, and
/// it is why nothing here is an options record.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: r#"system.Shell("npm test", timeoutSeconds: 30);"#,
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: r#"fs.ReadFile("src/a.cs", offset: 2, limit: 5);"#,
            expected: || json!({ "path": "src/a.cs", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: r#"fs.WriteFile("out.txt", "hello");"#,
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: r#"fs.EditFile("src/a.cs", "alpha", "beta");"#,
            expected: || json!({ "path": "src/a.cs", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: r#"fs.ListDir("src");"#,
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            statement: r#"skills.ReadSkill("testing");"#,
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: r#"memory.WriteMemory("layout", "d", "b");"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: r#"memory.UpdateMemory("layout", "d2", "b2");"#,
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
            statement: r#"memory.CreateMemory("layout", "d", "b", code: "static int One() => 1;");"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "static int One() => 1;", "onUse": null })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: r#"memory.ReadMemory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: r#"memory.EditMemory("layout", "old", "new");"#,
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            // A variadic list, which is what `params` is for: no array literal at the call site.
            statement: r#"memory.SearchMemories("cargo", "nextest");"#,
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: r#"memory.DeleteMemory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: r#"tasks.AddTask("t1", "T", description: "D", blockedBy: ["t0"]);"#,
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: r#"tasks.UpdateTask("t1", title: "T2", description: TextEdit.Clear, status: Gg.TaskStatus.InProgress);"#,
            expected: || {
                // `TextEdit.Clear` is what CLEARS it — the `default`, which is `TextEdit.Keep`, is
                // what leaves it alone — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: r#"tasks.SetBlockedBy("t1");"#,
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: r#"tasks.CompleteTask("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: r#"tasks.RemoveTask("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: r#"project.CreateEpic("epc", "E", "D");"#,
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: r#"project.CreateIssue("I", "s", "o", "c", "worker", reviewers: ["critic"]);"#,
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
            statement: r#"project.UpdateIssue("i1", status: IssueStatus.Done, epic: EpicAssignment.Ungroup);"#,
            expected: || {
                // `EpicAssignment.Ungroup` ungroups the issue, which gg's schema spells as the empty
                // string; a description the call left at its `default` — which is `TextEdit.Keep` —
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
            statement: r#"project.SetIssueBlockedBy("i1", "i0");"#,
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: r#"project.RemoveEpic("e1");"#,
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: r#"project.RemoveIssue("i1");"#,
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: r#"project.WaitForIssue("i1");"#,
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: r#"context.EvictFileView("src/a.cs");"#,
            expected: || json!({ "path": "src/a.cs" }),
        },
        Crossing {
            tool: "archive_thread",
            statement: r#"context.ArchiveThread(new TurnRange(4, 19), new TurnRange(30, 35));"#,
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: r#"context.SearchArchive("the parser");"#,
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: r#"context.Compact("scaffolded the page", "src/Main.cs");"#,
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.cs"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a typed value rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: r#"agents.SpawnSubagent("subagent", Brief.Prompt("write the lexer"));"#,
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: r#"agents.WaitForSubagents("agent-1");"#,
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: r#"agents.SendMessage("agent-1", "prefer the simpler parser");"#,
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: r#"agents.TransitionState("verify", note: "the build is green");"#,
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: r#"agents.Exec("Builder", prompt: "pick it up from here");"#,
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: r#"agents.Fork("try the other fix");"#,
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
fn the_view_object_the_helper_and_the_standard_ending_are_reached_in_csharp_too() {
    // Two of the four families that are NOT gg tools, so neither appears in the crossing table above
    // — and both are where a program puts something in front of the model, which makes them the ones
    // a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(
            r####"
var text = fs.ReadTextFile("notes.md", offset: 1, limit: 2);
var read = view.OpenFile("notes.md", offset: 1, limit: 2);
view.OpenText("summary", text);
view.OpenDocsView("ReadFile");
var closed = view.Close("summary");
var missing = view.Close("never opened");
var open = view.Current();
var directory = fs.List();
Console.WriteLine($"{open[0].Selector} {open[0].Kind}");
Console.WriteLine($"{closed} {missing}");
Console.WriteLine(read is TextFile file ? file.Contents.Split('\n')[0] : ((ImageFile)read).Label);
Console.WriteLine(string.Join(",", directory.Select(entry => entry.Name)));
harness.Finish("read the file and showed myself the result");
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
    assert_eq!(lines[3], "fsFunction");
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
    // `view.OpenFile` performs. Neither has a tool name of its own, which is exactly the point — a
    // helper is a spelling of the tool it is built on, and a view is a read gg also shows you.
    assert_eq!(log.names(), ["read_file", "read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );
}

#[test]
fn the_program_library_and_a_reviewers_verdict_are_reached_in_csharp_too() {
    // The program library is bound from the CAPABILITY rather than from a tool name, and a reviewer
    // gets the other ending group. Between this and the two functions above, every function this
    // arm's catalogue describes has been driven through the real membrane.
    let (outcome, _log) = evaluate(
        &prepare(
            r####"
var history = programs.History();
Console.WriteLine(history.Count);
try
{
    Console.WriteLine(programs.Get(2));
}
catch (ToolException failure)
{
    Console.WriteLine(failure.Code);
}
programs.Rerun("Console.WriteLine(\"again\");");
review.RequestChanges("widen the test", "name the file");
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
        &prepare("review.Approve();\n"),
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
    // Caught: an ordinary `catch` with a `when` clause on the code, which is what a program that
    // expects one failure and not the others writes. Nothing about it is exceptional — `ToolException`
    // is an ordinary `System.Exception`, so `catch`, `when` and `finally` all work on it without an
    // SDK-specific combinator.
    let (outcome, _log) = run_with(
        r####"
try
{
    Console.WriteLine(fs.ReadTextFile("gone.cs"));
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
fs.ReadTextFile("gone.cs");
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
        reported.message.contains("Gg.fs.ReadTextFile"),
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
    system.Shell("dotnet build");
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

// Networking types: the vocabulary is here, and the transport is `system.Shell`.
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

    // Identity: the objects, in the order the surface is presented in, and every gg tool spelled the
    // way this arm spells it. This is the half the agreement gate compares against the other nine,
    // and it is compared against gg's own vocabulary here as well, so the catalogue cannot ship
    // describing a surface nobody has.
    let objects: Vec<&str> = section(&catalogue, "objects")
        .iter()
        .map(|object| text(object, "object"))
        .collect();
    assert_eq!(
        objects,
        [
            "fs", "system", "project", "tasks", "memory", "view", "context", "agents", "skills",
            "programs", "harness", "review"
        ],
        "the objects, or their order, are not the surface's"
    );

    let mut catalogued: Vec<&str> = section(&catalogue, "tools")
        .iter()
        .map(|tool| text(tool, "tool"))
        .collect();
    catalogued.sort_unstable();
    let mut vocabulary = crate::sandbox::signatures::sandbox_tool_names();
    vocabulary.sort_unstable();
    assert_eq!(
        catalogued, vocabulary,
        "the catalogue and gg's tool vocabulary have drifted apart"
    );

    // Spelling: `PascalCase`, because that is what C# spells a method in. gg's vocabulary is
    // `snake_case`, so on this arm the two differ for every tool — which is what the `key` exists
    // for, and what a catalogue that quietly used gg's spelling would hide.
    for tool in section(&catalogue, "tools") {
        let name = text(tool, "name");
        assert!(
            !name.contains('_') && name.starts_with(|first: char| first.is_ascii_uppercase()),
            "`{name}` is not how C# spells a method"
        );
    }

    // The idiom this arm exists to produce, asserted where a model reads it: required arguments
    // positional, optional ones expressed as DEFAULT VALUES a call names rather than as a record, a
    // variadic list where the wire has a list a call would otherwise wrap in an array literal, and a
    // typed three-way value where the wire has a variant.
    let signature = |tool: &str| {
        let entry = section(&catalogue, "tools")
            .iter()
            .find(|entry| text(entry, "tool") == tool)
            .unwrap_or_else(|| panic!("`{tool}` is catalogued"));
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
        signature("read_file"),
        "ReadFile(string path, uint? offset = null, uint? limit = null) -> FileRead"
    );
    assert_eq!(
        signature("shell"),
        "Shell(string command, double? timeoutSeconds = null) -> ShellOutput"
    );
    assert_eq!(
        signature("edit_file"),
        "EditFile(string path, string oldString, string newString) -> void"
    );
    assert_eq!(
        signature("archive_thread"),
        "ArchiveThread(params TurnRange[] ranges) -> ReclaimReport"
    );
    assert_eq!(
        signature("update_task"),
        "UpdateTask(string id, string? title = null, TextEdit description = default, \
         TaskStatus? status = null) -> void"
    );
    assert_eq!(
        signature("create_issue"),
        "CreateIssue(string title, string inScope, string outOfScope, string completionCriteria, \
         string agent, string? description = null, string[]? blockedBy = null, \
         string? epicId = null, string[]? reviewers = null) -> IssueCreated"
    );

    // The one overload group on this arm, and the shape the catalogue exists to be able to carry:
    // "wait for these children" and "wait for all of them" are one capability written two ways,
    // because C# expresses "no argument at all" as a second method rather than as a default a
    // variadic parameter cannot have.
    let waiting = section(&catalogue, "tools")
        .iter()
        .find(|entry| text(entry, "tool") == "wait_for_subagents")
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
            "WaitForSubagents() -> IReadOnlyList<SubagentResult>",
            "WaitForSubagents(params string[] ids) -> IReadOnlyList<SubagentResult>",
        ],
        "the one overload group is not both of its shapes"
    );

    // A default value is what makes an argument optional in C#, so the catalogue's two fields must
    // say the same thing about every argument of every shape — and an optional one is `keyword`,
    // because naming it is how a call skips the ones before it.
    for name in ["session", "views", "programs", "tools", "helpers", "meta"] {
        for entry in section(&catalogue, name) {
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
    }

    // Every word of it is written on a declaration: nothing blank, an argument documented for every
    // argument a signature names, and a member documented for every member of every type. The
    // reflector refuses to emit a catalogue that breaks this, and this is the second reading of it —
    // over the emitted JSON, where it is the same check for every language there will ever be.
    for name in ["session", "views", "programs", "tools", "helpers", "meta"] {
        for entry in section(&catalogue, name) {
            let called = text(entry, "name");
            assert!(
                !text(entry, "doc").trim().is_empty(),
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
    }
    for declaration in section(&catalogue, "types") {
        let named = text(declaration, "name");
        assert!(
            !text(declaration, "doc").trim().is_empty(),
            "the type `{named}` has no documentation"
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
                !text(member, "doc").trim().is_empty(),
                "`{named}.{member_name}` has no documentation"
            );
        }
    }
}

#[test]
fn the_catalogue_agrees_with_a_registered_arm() {
    // The [agreement gate](super::super::agreement) iterates the REGISTERED set, and this arm is not in it
    // — a language cannot be half-registered, because the registry's `match` is exhaustive. So the
    // gate is run by hand over this arm's committed catalogue, against TypeScript's, and it is worth
    // having early for exactly the reason the gate exists at all: an SDK and a catalogue that agree
    // with each other and with nothing else are two green test suites and an invalidated experiment.
    //
    // The catalogue is carried in on the [fixture](super::super::fixture), whose whole job is to be a second
    // `ProgramLanguage` with no wire id, since this one has no `GgProgramLanguage` to be parsed
    // under yet. Only the `language` field is rewritten; every spelling, signature, argument and
    // type below it is this arm's own.
    let language = super::super::fixture::a_language_whose_catalogue(|document| {
        let mut mine: Value =
            serde_json::from_str(SIGNATURES).expect("the committed catalogue is JSON");
        mine["language"] = json!("typescript");
        *document = mine;
    });
    let disagreements = super::super::agreement::disagreements(&[
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        language,
    ]);
    assert!(
        disagreements.is_empty(),
        "the C# catalogue does not describe the same capability surface as a registered arm: {}",
        disagreements
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    );
}
