//! **The Rust arm's model-facing surface**, driven end to end through the real toolchain and the
//! real membrane: the hand-written SDK, and the catalogue reflected out of its own rustdoc.
//!
//! # Why these are not in the substrate file
//!
//! Because they are a different claim. [`substrate`](super::substrate) asks whether Rust runs here.
//! This asks whether the thing a model is **told** it may write is the thing the sandbox really has
//! — which is the only question a cross-language study rests on, and the one whose failure is
//! silent: an SDK and a catalogue that agree with each other and with nothing else are two green
//! test suites and an invalidated experiment.
//!
//! # How they are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in it costs a
//! real `rustc` and the component it produced. A function groups the programs that exercise one
//! behaviour, so they share that cost; one that grows into the slow end of the suite is split
//! rather than extended.

use serde_json::{Value, json};

use super::substrate::{
    evaluate, evaluate_closing_docviews, evaluate_with_program, logs, prepare, trap,
};
use crate::ending::{Ending, EndingRole};
use test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE;

use crate::sandbox::fake::{CallLog, all_operations, all_operations_without, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::SandboxOutcome;
use crate::tools::{ToolFailure, ToolOutcome};

/// The catalogue this arm's build reflects, read as a **document** rather than through
/// [`SignatureCatalogue`](crate::sandbox::signatures) — deliberately, and now that this arm is
/// registered, for a reason of its own: the parsed reading is a *projection*, and a field the parser
/// does not model is one these tests could not notice was missing. The parsed reading is asserted
/// next door, in [`rust.test.rs`](super::tests), where what is being checked is that the catalogue
/// gg loads is this language's. Here the JSON is read as JSON, which is what lets a test say the
/// file carries a section at all.
const SIGNATURES: &str = include_str!(concat!(env!("OUT_DIR"), "/signatures/rust.signatures.json"));

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

/// **A whole Rust program**, written the way a model writes one: the line the catalogue states for
/// each module it reaches, then the `fn main` this arm asks for, then `body`.
///
/// A helper rather than a literal in every test because the one thing every test in this file shares
/// is that **gg writes nothing around a program** — so the imports have to come from somewhere the
/// test can be read to have written them, and this is that place. Each module is reached by exactly
/// the line the catalogue publishes for it, `use gg::<module>;`, gathered into the one brace-list a
/// Rust author would write; `gg::log` and every other name a body spells in full needs no line at
/// all, because `--extern gg=…` puts the crate in the extern prelude.
///
/// `Result<(), gg::Failure>` because every body here composes a call with `?`.
fn whole(imports: &[&str], body: &str) -> String {
    let uses = match imports {
        [] => String::new(),
        [one] => format!("use gg::{one};\n\n"),
        many => format!("use gg::{{{}}};\n\n", many.join(", ")),
    };
    format!("{uses}fn main() -> Result<(), gg::Failure> {{\n{body}    Ok(())\n}}\n")
}

/// The module a call written `files::read_file(…)` reaches, which is the word in front of its first
/// `::` — so the import line a test writes is derived from the call it drives rather than restated
/// beside it.
fn module_of(statement: &str) -> &str {
    statement
        .split_once("::")
        .map(|(module, _)| module)
        .unwrap_or(statement)
}

/// Compile and run one Rust program with `enabled`'s operations offered and no ending group.
fn run_with(
    source: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(source),
        operations,
        &[],
        RunEnding::None,
        false,
        responder,
    )
}

// ---------------------------------------------------------------------------------------------
// Every operation, from its Rust spelling
// ---------------------------------------------------------------------------------------------

/// One operation, called through the Rust spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound operation, called through its idiomatic Rust function.
///
/// Deliberately the same table the other arms' surface tests drive theirs with, down to the
/// arguments and the expected JSON — because the expected JSON is the point. gg's dispatch is
/// language-independent: seven arms writing the same call in their own idioms must produce
/// **byte-identical** arguments, or they are not running the same experiment. An options field
/// lowered onto the wrong wire slot, a `TextEdit::Clear` read as "leave it alone" instead of "clear
/// it", an enum variant whose wire word did not translate — none of them is a compile error in any
/// of the seven, and all of them are visible here.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: r#"shell::run("npm test", Some(30.0));"#,
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: r#"files::read_file("src/a.rs", files::ReadOptions { offset: Some(2), limit: Some(5) });"#,
            expected: || json!({ "path": "src/a.rs", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: r#"files::write_file("out.txt", "hello");"#,
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: r#"files::edit_file("src/a.rs", "alpha", "beta");"#,
            expected: || json!({ "path": "src/a.rs", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: r#"files::list_dir(Some("src"));"#,
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            statement: r#"files::tree(files::TreeOptions { path: Some("src"), depth: Some(3) });"#,
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            statement: r#"files::search("answer", files::SearchOptions { path: Some("src"), limit: Some(10) });"#,
            expected: || json!({ "query": "answer", "path": "src", "limit": 10 }),
        },
        Crossing {
            tool: "read_skill",
            statement: r#"skills::read_skill("testing");"#,
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: r#"memories::write_memory("layout", "d", "b", memories::MemoryOptions::default());"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: r#"memories::update_memory("layout", "d2", "b2", memories::MemoryOptions::default());"#,
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, and the one that exercises functional
            // update over an options struct with something already in it.
            statement: r#"memories::create_memory("layout", "d", "b", memories::MemoryOptions {
                code: Some("fn one() -> i32 { 1 }"),
                ..Default::default()
            });"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "fn one() -> i32 { 1 }", "onUse": null })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: r#"memories::read_memory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: r#"memories::edit_memory("layout", "old", "new");"#,
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: r#"memories::search_memories(&["cargo", "nextest"]);"#,
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: r#"memories::delete_memory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: r#"tasks::add_task("t1", "T", tasks::TaskOptions {
                description: Some("D"),
                blocked_by: &["t0"],
            });"#,
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: r#"tasks::update_task("t1", tasks::TaskPatch {
                title: Some("T2"),
                description: tasks::TextEdit::Clear,
                status: Some(tasks::TaskStatus::InProgress),
            });"#,
            expected: || {
                // `TextEdit::Clear` is what CLEARS it — the default `Keep` is what leaves it alone —
                // and `in_progress` is gg's own spelling, so the membrane's `in-progress` reaches
                // neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: r#"tasks::set_blocked_by("t1", &[]);"#,
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: r#"tasks::complete_task("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: r#"tasks::remove_task("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: r#"board::create_epic("epc", "E", "D");"#,
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: r#"board::create_issue("I", "s", "o", "c", "worker", board::IssueOptions {
                reviewers: &["critic"],
                ..Default::default()
            });"#,
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
            statement: r#"board::update_issue("i1", board::IssuePatch {
                status: Some(board::IssueStatus::Done),
                epic: board::EpicAssignment::Ungroup,
                ..Default::default()
            });"#,
            expected: || {
                // `EpicAssignment::Ungroup` ungroups the issue, which gg's schema spells as the
                // empty string; a description the patch left at `Keep` keeps the one it has, so its
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
            statement: r#"board::set_issue_blocked_by("i1", &["i0"]);"#,
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: r#"board::remove_epic("e1");"#,
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: r#"board::remove_issue("i1");"#,
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: r#"board::wait_for_issue("i1");"#,
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: r#"context::evict_file_view(Some("src/a.rs"));"#,
            expected: || json!({ "path": "src/a.rs" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a Rust INCLUSIVE RANGE — `4..=19` — rather than a record with two
            // fields, because that is what a span of integers is in this language. It is the one
            // place this arm's spelling is shorter than the wire's, and the lowering is here.
            statement: r#"context::archive_thread(&[4..=19, 30..=35]);"#,
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: r#"context::search_archive("the parser");"#,
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: r#"context::compact("scaffolded the page", &["src/main.rs"]);"#,
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/main.rs"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a typed value rather than one of two optional arguments, so "both" and
            // "neither" are programs that do not compile.
            statement: r#"delegation::spawn_subagent("subagent", delegation::Brief::Prompt("write the lexer"));"#,
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: r#"delegation::wait_for_subagents(Some(&["agent-1"]));"#,
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: r#"delegation::send_message("agent-1", "prefer the simpler parser");"#,
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: r#"delegation::transition_state("verify", Some("the build is green"));"#,
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: r#"delegation::exec("Builder", Some("pick it up from here"));"#,
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: r#"delegation::fork("try the other fix");"#,
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_operation_crosses_the_membrane_from_its_rust_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: a compile here is ~70 ms, so thirty-five of them
    // would be two and a half seconds of `rustc` for a table that reads the same. It is also the
    // stronger check — the calls must arrive in the order the program made them, so a call that
    // reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    let mut imports: Vec<&str> = crossings
        .iter()
        .map(|crossing| module_of(crossing.statement))
        .collect();
    imports.sort_unstable();
    imports.dedup();
    let body = crossings
        .iter()
        .map(|crossing| format!("    {}\n", crossing.statement))
        .collect::<String>();
    let (outcome, log) = run_with(&whole(&imports, &body), &all_operations(), canned_outcome);
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
    // shipping as a typed function nobody ever called.
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
fn the_views_module_the_helper_and_the_standard_ending_are_reached_in_rust_too() {
    // Three of the families that are NOT gg tools, so none of them appears in the crossing table
    // above — and they are where a program puts something in front of the model and finds out what
    // it may call at all, which makes them the ones a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(&whole(
            &["docs", "files", "session", "views"],
            r####"    let shown = views::ViewOptions { offset: Some(1), limit: Some(2), ..Default::default() };
    let read = views::open_file("notes.md", shown)?;
    views::open_text("summary", "eight files, two failing")?;
    views::open_docs_view("read_file")?;
    let closed = views::close("summary")?;
    let missing = views::close("never opened")?;
    gg::log(format!("{closed} {missing}"));
    gg::log(match read {
        files::FileRead::Text(file) => file.contents.lines().next().unwrap_or_default().to_string(),
        files::FileRead::Image(picture) => picture.label,
    });
    let found = docs::search(docs::SearchOptions {
        query: Some("open"),
        modules: &["views"],
        kind: Some(docs::DocKind::Function),
        limit: Some(5),
        ..Default::default()
    })?;
    gg::log(format!("{} {} {}", found.total, found.offset, found.hits.len()));
    match docs::close("gg::views::open_text") {
        Ok(count) => gg::log(format!("closed {count}")),
        Err(failure) => gg::log(format!("{:?} on {}", failure.code, failure.operation)),
    }
    match docs::close_all() {
        Ok(count) => gg::log(format!("closed {count}")),
        Err(failure) => gg::log(format!("{:?} on {}", failure.code, failure.operation)),
    }
    session::finish("read the file and showed the result")?;
"####,
        )),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // Closing something that is not open is `0` rather than a failure, so a program that tidies up
    // unconditionally does not have to guard every call.
    assert_eq!(lines[0], "1 0");
    assert_eq!(lines[1], "contents of notes.md");
    // A search hands the program a page it can read in the turn that asked for it — the count, the
    // echoed offset, and the hits themselves. The double models no catalogue, so the honest page is
    // an empty one; what this proves is the crossing, which is the half no other test covers on this
    // arm. The ranking over a real catalogue is `docs::search`'s own to prove.
    assert_eq!(lines[2], "0 0 0");
    // Closing documentation is the one part of this family a run buys, and this run did not: the
    // program is refused by the host under the call's own name rather than by a name that was never
    // in scope, because a compiled arm cannot withhold a name.
    assert_eq!(lines[3], "Unavailable on close");
    assert_eq!(lines[4], "Unavailable on close_all");
    // Every view the program opened is recorded, the documentation one and the search's own
    // included — a search puts its page in the window as well as handing it back.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes.md", "summary", "read_file", "search results"]
    );
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::Finished { summary }) if summary.starts_with("read the file")
        ),
        "the ending the program declared: {:?}",
        outcome.completion
    );

    // And the same two calls once the run has bought the capability, which is the only way to reach
    // their answer at all: refused, the count a program reads is never lowered. The double holds no
    // window, so nothing is open and `0` is the honest number — a success, exactly as it is in
    // production for a key that is not open.
    let (granted, _log) = evaluate_closing_docviews(
        &prepare(&whole(
            &["docs"],
            r####"    gg::log(format!("{} {}", docs::close("gg::views::open_text")?, docs::close_all()?));
"####,
        )),
        canned_outcome,
    );
    assert_eq!(logs(&granted), ["0 0"]);

    // One read reached gg's dispatch and arrived as `read_file`: the one `views::open_file`
    // performs. It has no tool name of its own, which is exactly the point — a view is a read gg
    // also shows.
    assert_eq!(log.names(), ["read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );
}

#[test]
fn the_program_library_and_a_reviewers_verdict_are_reached_in_rust_too() {
    // The program library is bound from the CAPABILITY rather than from a tool name, and a reviewer
    // gets the other ending group. Between this, the two functions above and the alias case below,
    // every function this arm's catalogue describes has been driven through the real membrane.
    let (outcome, _log) = evaluate(
        &prepare(&whole(
            &["programs", "session"],
            r####"    let history = programs::history()?;
    gg::log(history.len().to_string());
    match programs::get("p2") {
        Ok(source) => gg::log(source),
        Err(failure) => gg::log(format!("{:?}", failure.code)),
    }
    programs::rerun("gg::log(\"again\");")?;
    session::request_changes(&["widen the test", "name the file"])?;
"####,
        )),
        &[],
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never an error — and an id it never
    // issued a program under is a `NotFound` the program matches on in Rust's own idiom.
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
        &prepare(&whole(&["session"], "    session::approve()?;\n")),
        &[],
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

/// **Every inherent method reaches the operation it says it is an alias of, carrying the field its
/// own receiver holds.**
///
/// The four methods this SDK declares — `IssueCreated::wait`, `MemoryHit::read`,
/// `SubagentHandle::send` and `ProgramSummary::source` — are one line of body each: they take a
/// field off the value they hang off and call the free function beside them with it. That one line
/// is the thing no other gate can see. The catalogue records which operation each is an alias of and
/// the [coverage gate](super::agreement) reads that record rather than the body; the [register
/// gate](super::register) reads only the prose. So a method passing `self.slot` where the call wants
/// `self.id` would document perfectly, catalogue perfectly, and message a child that does not exist.
///
/// Each is therefore driven against the real membrane from the value the producing operation really
/// handed back, rather than from a literal built here — which proves both halves at once: that the
/// method is on the value a program actually gets, and that the field it reads is the one gg filled
/// in.
#[test]
fn an_inherent_method_reaches_the_operation_it_is_an_alias_of() {
    // Three of the four hang off a value a gg OPERATION produced, so the alias's own crossing lands
    // in the log beside the crossing that made its receiver.
    let (outcome, log) = evaluate(
        &prepare(&whole(
            &["board", "delegation", "memories", "views"],
            r####"    let issue = board::create_issue("Parse the manifest", "the parser", "the writer", "tests pass",
                                    "Builder", board::IssueOptions::default())?;
    gg::log(format!("{} {}", issue.id, issue.wait()?));

    let hits = memories::search_memories(&["build"])?;
    gg::log(format!("{} {}", hits[0].name, hits[0].read()?));

    let child = delegation::spawn_subagent("Builder", delegation::Brief::Prompt("take the writer"))?;
    child.send("prefer the simpler parser")?;
    gg::log(child.id.clone());

    views::open_text("summary", "eight files, two failing")?;
    gg::log(format!("{}", views::close("summary")?));
"####,
        )),
        &all_operations(),
        &[],
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
    // And carrying the receiver's own key, which is the half a wrong field would fail.
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
        &prepare(&whole(
            &["programs"],
            r####"    let history = programs::history()?;
    gg::log(format!("{} {}", history[0].turn, history[0].source()?));
"####,
        )),
        "p3",
        3,
        "gg::log(\"the program that ran\");",
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["3 gg::log(\"the program that ran\");"]);
}

#[test]
fn a_failure_is_a_result_whether_it_is_matched_on_or_let_out() {
    // Matched on: an ordinary `match` on the code, which is what a program that expects a failure
    // writes. Nothing about it is exceptional — it is the same `Result` every fallible Rust call
    // hands back, so `?` and `match` and `unwrap_or_else` all work on it without an SDK-specific
    // combinator.
    let (outcome, _log) = run_with(
        &whole(
            &["files"],
            r####"    match files::read_file("gone.rs", files::ReadOptions::default()) {
        Ok(_) => gg::log("read it"),
        Err(failure) => gg::log(format!("{:?} on {}", failure.code, failure.operation)),
    }
    gg::log("carried on");
"####,
        ),
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.rs".to_string())
        },
    );
    assert_eq!(logs(&outcome), ["NotFound on read_file", "carried on"]);

    // Let out with `?`: the program's own body returns `Result<(), Failure>`, so the failure ends
    // the turn — carrying the CODE the call itself failed with, which is the field the host
    // classifies a turn's error from and the one a `Failure` that flattened its error to a string at
    // the `?` would have lost.
    let (outcome, _log) = run_with(
        &whole(
            &["files"],
            r####"    gg::log("before");
    files::read_file("gone.rs", files::ReadOptions::default())?;
    gg::log("after");
"####,
        ),
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.rs".to_string())
        },
    );
    let reported = trap(&outcome);
    assert!(
        reported.contains("`read_file` failed (not-found)"),
        "the model reads gg's own sentence rather than a Rust type name: {reported}"
    );
    assert!(
        reported.contains("no such file: gone.rs"),
        "the failure's own detail is what `Failure` walks the chain for: {reported}"
    );
    assert_eq!(outcome.logs, ["before"], "what ran before it still stands");
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // This arm cannot withhold a NAME: its SDK is a library linked into the program, so every
    // function is in scope whatever a run enables and the host is the only thing that can refuse.
    // That is exactly the case `error-code.unavailable` exists for, and the recovery is the same one
    // a name that was never in scope gets.
    let (outcome, log) = run_with(
        &whole(
            &["shell"],
            r####"    match shell::run("cargo build", None) {
        Ok(_) => gg::log("ran"),
        Err(failure) => gg::log(format!("{:?}", failure.code)),
    }
"####,
        ),
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
fn a_program_reaches_every_library_this_arm_says_it_may() {
    // Every crate the catalogue's `libraries` section names, used for what it is there for. The
    // claim is not that these compile in the abstract: it is that a MODEL'S PROGRAM, compiled by the
    // production prepare step against the committed set, can name them — which is the promise the
    // prompt makes and the one a stale tarball or a missing `--extern` would break silently.
    let catalogue = catalogue();
    let named: Vec<&str> = section(&catalogue, "libraries")
        .iter()
        .flat_map(|group| group["modules"].as_array().expect("a group lists modules"))
        .map(|module| module.as_str().expect("a module is named by a string"))
        .filter(|module| !module.starts_with("std::"))
        .collect();
    assert_eq!(
        named,
        ["regex", "serde_json", "base64", "itertools", "indexmap"],
        "the set a program is told it may reach has changed; the program below must follow it"
    );

    // And the other direction, which nothing else closes: the set a program may NAME is the
    // manifest's `extern` crates, and a crate `--extern`ed but left out of the catalogue would be a
    // library this arm offers and never mentions. The two are one declaration in `Cargo.toml` and
    // two readers of it — `build.sh` for the manifest, `tools/signatures.py` for the catalogue — and
    // both are now run by the same `cargo build`, which makes this an AGREEMENT check between two
    // generators rather than a staleness check on a committed file. That is the stronger of the two
    // readings, and it is the one this always wanted: what it catches is one reader of `Cargo.toml`
    // learning something the other did not.
    let manifest: Value = serde_json::from_str(include_str!(concat!(
        env!("GG_ARTIFACTS_RUST"),
        "/rust.toolchain.json"
    )))
    .expect("the toolchain manifest this build cut is JSON");
    let externed: Vec<&str> = manifest["crates"]
        .as_array()
        .expect("the manifest lists crates")
        .iter()
        .filter(|crate_| crate_["extern"].as_bool().unwrap_or_default())
        .map(|crate_| text(crate_, "name"))
        .filter(|name| *name != "gg")
        .collect();
    let mut sorted = named.clone();
    sorted.sort_unstable();
    let mut externed_sorted = externed;
    externed_sorted.sort_unstable();
    assert_eq!(
        externed_sorted, sorted,
        "the crates a program is compiled with and the crates it is told about have drifted apart"
    );

    let (outcome, _log) = run_with(
        r####"use itertools::Itertools;

fn main() {
    let words = ["beta", "alpha", "beta"];
    let unique = words.iter().unique().sorted().join(",");

    let pattern = regex::Regex::new(r"(\w+)-(\d+)").expect("a literal pattern compiles");
    let matched = pattern
        .captures("issue AUTH-14 is open")
        .map(|found| found[1].to_string() + "/" + &found[2])
        .unwrap_or_default();

    let parsed: serde_json::Value =
        serde_json::from_str(r#"{"ok":true,"count":3}"#).expect("literal JSON parses");
    let count = parsed["count"].as_u64().unwrap_or_default();

    let encoded = {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode("gg")
    };

    let mut order = indexmap::IndexMap::new();
    order.insert("second", 2);
    order.insert("first", 1);
    let kept = order.keys().copied().collect::<Vec<_>>().join(",");

    gg::log(format!("{unique} {matched} {count} {encoded} {kept}"));
}
"####,
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["alpha,beta AUTH/14 3 Z2c= second,first".to_string()],
        "a library this arm ships was not reachable, or did not behave"
    );
}

/// **Nothing this arm offers resolves without a line the program wrote, or the path written in
/// full.**
///
/// The claim the conversion rests on, put through `rustc` rather than argued from the source.
/// `--extern gg=…` is packaging: it puts the crate name `gg` in the **extern prelude** and no name
/// of gg's in a program's own scope. So there are exactly two ways to reach a call, and a third
/// that does not compile.
///
/// Driven through the production prepare step, because what is being asserted is what the compiler
/// a turn really runs does with these four files.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let refused = |source: &str| -> String {
        let failure = super::compile::compile_program(
            source,
            &[],
            &crate::sandbox::PrepareContext::detached(),
        )
        .expect_err("a name nothing brought into scope is refused");
        failure.to_string()
    };

    // A module reached by its short name with no line above it: `rustc`'s own unresolved-path
    // diagnostic, at the model's own line.
    let diagnostic = refused(
        "fn main() -> Result<(), gg::Failure> {\n    \
             let _ = files::read_file(\"a.md\", files::ReadOptions::default())?;\n    \
             Ok(())\n}\n",
    );
    assert!(
        diagnostic.contains("E0433") && diagnostic.contains("line 2"),
        "{diagnostic}"
    );

    // And a `core` type by its bare name, which is the one place the deleted prelude used to make
    // an exception: the catalogue now spells it `core::ApiError`, and that is what compiles.
    let diagnostic = refused(
        "fn main() -> Result<(), gg::Failure> {\n    \
             let _: Option<ApiErrorCode> = None;\n    Ok(())\n}\n",
    );
    assert!(diagnostic.contains("line 2"), "{diagnostic}");

    // The two that do compile, and the second is the line the catalogue states. Both are driven
    // end to end rather than only compiled, so what is asserted is that the call crossed.
    for source in [
        "fn main() -> Result<(), gg::Failure> {\n    \
             let gg::files::FileRead::Text(file) = gg::files::read_file(\"a.md\", gg::files::ReadOptions::default())? else { return Ok(()) };\n    \
             gg::log(file.contents);\n    Ok(())\n}\n",
        "use gg::files;\n\nfn main() -> Result<(), gg::Failure> {\n    \
             let files::FileRead::Text(file) = files::read_file(\"a.md\", files::ReadOptions::default())? else { return Ok(()) };\n    \
             gg::log(file.contents);\n    Ok(())\n}\n",
    ] {
        let (outcome, log) = run_with(source, &all_operations(), canned_outcome);
        assert!(
            logs(&outcome)[0].starts_with("contents of a.md"),
            "{source}\n{:?}",
            outcome.logs
        );
        assert_eq!(log.names(), ["read_file"], "{source}");
    }
}

/// **A code module is reachable exactly as gg's SDK is, and no further.**
///
/// The [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) let an arm supply
/// a module through the mechanism it supplies its own SDK through, and this arm's is `--extern`,
/// which needs no line at all. So the claim to hold is the other half of that rule: supplying a
/// crate declares **no name**. A program reaches `csv_tools::shout` because it wrote the path, and a
/// program that writes the bare name reaches nothing.
///
/// The second half is the one a binding written into the program's own crate cannot keep: every
/// declaration the module made would be an item of the crate the model is writing, and a bare
/// `shout()` would be one `use` away from resolving without the program ever naming the module.
/// Driven through the production prepare step, because the compiler a turn really runs is what
/// decides it.
#[test]
fn a_code_module_puts_no_name_in_a_programs_scope() {
    let modules = [crate::sandbox::CodeModule {
        name: "csv_tools".to_string(),
        source: "pub fn shout(word: &str) -> String {\n    word.to_uppercase()\n}\n".to_string(),
    }];
    let with_module = |source: &str| {
        super::compile::compile_program(
            source,
            &modules,
            &crate::sandbox::PrepareContext::detached(),
        )
    };

    // The path the module's own documentation view quotes, with no line above it.
    with_module("fn main() {\n    let _ = csv_tools::shout(\"ok\");\n}\n")
        .expect("the key is a crate in the extern prelude, which a program reaches by writing it");

    // The same call by the bare name the module declares it under: `rustc`'s own unresolved-name
    // diagnostic, at the model's own line.
    let refused = with_module("fn main() {\n    let _ = shout(\"ok\");\n}\n")
        .expect_err("a module in scope declares no name of its own for a program");
    match refused {
        crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            diagnostic,
        )) => assert!(
            diagnostic.contains("E0425") && diagnostic.contains("line 2"),
            "a program naming a module's export with no path was refused for another reason: \
             {diagnostic}"
        ),
        other => panic!(
            "a name that is not in scope is the model's compile error, not {other:?}. A code \
             module is putting its own declarations in the program's scope."
        ),
    }

    // And gg's surface is no more in scope with a module loaded than without one, which is the
    // question this arm answers the same way in both states.
    let refused = with_module(
        "fn main() -> Result<(), gg::Failure> {\n    \
             let _ = files::read_file(\"a.md\", files::ReadOptions::default())?;\n    \
             Ok(())\n}\n",
    )
    .expect_err("a module in scope brings no name of gg's with it");
    match refused {
        crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            diagnostic,
        )) => assert!(
            diagnostic.contains("E0433") && diagnostic.contains("line 2"),
            "{diagnostic}"
        ),
        other => panic!(
            "gg's surface is reaching a program through the code module in its scope: {other:?}"
        ),
    }
}

#[test]
fn the_generated_catalogue_describes_the_surface_the_sdk_offers() {
    let catalogue = catalogue();
    assert_eq!(
        text(&catalogue, "language"),
        "rust",
        "the catalogue must say whose spellings it carries"
    );
    assert_eq!(
        catalogue["schema"].as_u64(),
        Some(1),
        "a catalogue declares which shape it is written in, and one that stopped saying so would \
         not be readable at all"
    );

    // Identity: the modules, in the order the surface is presented in, spelled the way a program
    // writes them. `core` is last and declares no function of its own — it is where the two error
    // types and the directory summary live, which every other module's signatures name.
    let modules: Vec<&str> = section(&catalogue, "modules")
        .iter()
        .map(|module| text(module, "path"))
        .collect();
    assert_eq!(
        modules,
        [
            "gg::files",
            "gg::shell",
            "gg::board",
            "gg::tasks",
            "gg::memories",
            "gg::views",
            "gg::docs",
            "gg::context",
            "gg::delegation",
            "gg::skills",
            "gg::programs",
            "gg::session",
            "gg::core",
        ],
        "the modules, or their order, are not the surface's"
    );

    // Every gg tool is bound exactly once, under gg's own operation id — which on this arm is also
    // the function's own name, because gg's vocabulary is already `snake_case`. That coincidence is
    // worth stating rather than relying on: the operation is the identity and the name is the
    // spelling, and `shell.shell` is the one row where the two differ, since Rust does not stutter a
    // module's name into the function it holds.
    //
    // An operation counts as a tool's when its key is a tool's name AND gg binds it the way it binds
    // that tool — bought by the tool's capability, or held by position for the one machine row —
    // the second half because a key alone is ambiguous now that `files.search` and `docs.search`
    // share one: the first is the `search` tool, the second is the always-bound docs carve-out, and
    // a count that went by the key would report the tool bound twice.
    let functions = section(&catalogue, "functions");
    let mut bound: Vec<&str> = functions
        .iter()
        .filter(|entry| entry["aliasOf"].is_null())
        .map(|entry| text(entry, "operation"))
        .filter_map(|operation| {
            let (_, key) = operation.split_once('.')?;
            let bought_by = crate::tools::tool_capability(key)?;
            let as_tool = match crate::sandbox::operation_by_id(operation)?.binding {
                crate::sandbox::Binding::Capability(capability) => capability == bought_by,
                crate::sandbox::Binding::Machine => true,
                crate::sandbox::Binding::Always | crate::sandbox::Binding::Ending(_) => false,
            };
            as_tool.then_some(key)
        })
        .collect();
    bound.sort_unstable();
    let mut vocabulary = crate::sandbox::signatures::sandbox_operation_names();
    vocabulary.sort_unstable();
    assert_eq!(
        bound, vocabulary,
        "the catalogue and gg's tool vocabulary have drifted apart"
    );
    for entry in functions {
        let operation = text(entry, "operation");
        let name = text(entry, "name");
        // An alias is a second way to reach one operation and is free to be spelled for the site it
        // is written at — `handle.send(…)` rather than `handle.send_message(…)`, which would say the
        // word `message` twice.
        if !entry["aliasOf"].is_null() {
            continue;
        }
        if operation == "shell.shell" {
            assert_eq!(
                name, "run",
                "`gg::shell::shell` would stutter, so this arm spells it `run`"
            );
            continue;
        }
        assert_eq!(
            operation.split_once('.').map(|(_, key)| key),
            Some(name),
            "a gg operation's Rust name is gg's own key for it"
        );
    }

    // Five member functions, each built deliberately: a value gg hands back already carries the one
    // argument the follow-up call takes, so an inherent method on it is the whole of that call. Each
    // is an ALIAS — the operation is bound canonically by the free function beside it — so it counts
    // toward no coverage and is documented like anything else. Rust returns owned structs from every
    // one of these five producers, so an `impl` block is the idiomatic form and no free-function
    // fallback is needed.
    let aliases: Vec<(&str, &str)> = functions
        .iter()
        .filter(|entry| !entry["aliasOf"].is_null())
        .map(|entry| (text(entry, "fqn"), text(entry, "aliasOf")))
        .collect();
    assert_eq!(
        aliases,
        [
            ("gg::board::IssueCreated::wait", "board.wait_for_issue"),
            ("gg::memories::MemoryHit::read", "memories.read_memory"),
            (
                "gg::delegation::SubagentHandle::send",
                "delegation.send_message"
            ),
            ("gg::programs::ProgramSummary::source", "programs.get"),
        ]
    );
    for entry in functions.iter().filter(|entry| !entry["aliasOf"].is_null()) {
        assert_eq!(
            text(entry, "kind"),
            "method",
            "`{}` is an inherent method on the value that produced it",
            text(entry, "fqn")
        );
        assert!(
            !text(entry, "receiver").is_empty(),
            "`{}` names the type it hangs off",
            text(entry, "fqn")
        );
    }
    // And each is listed on its receiver's own declaration, which is the menu a model reads when it
    // opens the type a call handed it.
    let handle = section(&catalogue, "types")
        .iter()
        .find(|declaration| text(declaration, "fqn") == "gg::delegation::SubagentHandle")
        .expect("SubagentHandle is catalogued");
    assert_eq!(
        text(&handle["memberFunctions"][0], "fqn"),
        "gg::delegation::SubagentHandle::send"
    );

    // The idiom this arm exists to produce, asserted where a model reads it: required arguments
    // positional, an options struct for the optional ones, an `Option<T>` where there is exactly
    // one, `Result<_, core::ApiError>` on the way out, an inclusive range where the wire has a
    // record, and every SDK type written under the module that declares it — including the two in
    // `core`, because gg puts no name of its own in a program's scope and `core::ApiError` is what
    // `use gg::core;` leaves resolvable.
    let signature = |operation: &str| {
        let entry = functions
            .iter()
            .find(|entry| text(entry, "operation") == operation && entry["aliasOf"].is_null())
            .unwrap_or_else(|| panic!("`{operation}` is catalogued"));
        let shapes = entry["signatures"].as_array().expect("an entry has shapes");
        assert_eq!(
            shapes.len(),
            1,
            "Rust has no overloads, so every entry has exactly one shape"
        );
        text(&shapes[0], "signature").to_string()
    };
    assert_eq!(
        signature("files.read_file"),
        "read_file(path: &str, options: files::ReadOptions) \
         -> Result<files::FileRead, core::ApiError>"
    );
    assert_eq!(
        signature("shell.shell"),
        "run(command: &str, timeout_secs: Option<f64>) -> Result<shell::ShellOutput, core::ApiError>"
    );
    assert_eq!(
        signature("context.archive_thread"),
        "archive_thread(ranges: &[RangeInclusive<u32>]) \
         -> Result<context::ReclaimReport, core::ApiError>"
    );
    assert_eq!(
        signature("board.create_issue"),
        "create_issue(title: &str, in_scope: &str, out_of_scope: &str, \
         completion_criteria: &str, agent: &str, options: board::IssueOptions<'_>) \
         -> Result<board::IssueCreated, core::ApiError>"
    );

    // Every word of it is written on a declaration: a brief on everything, an argument documented
    // for every argument a signature names, and a member documented for every member of every type.
    // The reflector refuses to emit a catalogue that breaks this, and this is the second reading of
    // it — over the emitted JSON, where the register gate then holds the same strings to a register.
    for entry in functions {
        let called = text(entry, "fqn");
        assert!(
            !text(entry, "brief").trim().is_empty(),
            "`{called}` has no brief"
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
            named.starts_with("gg::"),
            "the type `{named}` is not module-qualified, and a name is what a documentation view \
             is keyed by"
        );
        assert!(
            !text(declaration, "brief").trim().is_empty(),
            "the type `{named}` has no brief"
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
                "`{named}::{member_name}` has no brief"
            );
        }
    }
}

/// **The default execution ceiling is an infinite-loop guard, not a work ration**, proven on a
/// compiled arm beside the interpreted proof in `python.substrate.test.rs`: a program that spends
/// a whole model reply's worth of output on large writes — dozens of 64 KiB files in one program —
/// completes under the default limits (`SandboxLimits::AMPLE`) rather than being stopped by them.
#[test]
fn dozens_of_large_writes_complete_under_the_default_ceiling() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    let body = "x".repeat(64 * 1024);
    let mut total: u64 = 0;
    for index in 0..48 {
        total += files::write_file(&format!("out/f{index}.txt"), &body)?;
    }
    gg::log(format!("done {}", total > 0));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["done true"],
        "48 large writes did not complete under the default ceiling: {:?}",
        outcome.result
    );
    assert_eq!(log.calls().len(), 48, "every write crossed the membrane");
}
