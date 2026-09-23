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
    evaluate, evaluate_closing_docviews, evaluate_refusing_view, evaluate_with_program, logs,
    prepare, trap,
};
use crate::ending::{Ending, EndingRole};
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_EXEC, CAPABILITY_FORK,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE,
};

use crate::sandbox::fake::{CallLog, all_operations, all_operations_without, canned_outcome};
use crate::sandbox::invoker::ViewRefusal;
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::operations::DELEGATION_TRANSITION_STATE;
use crate::sandbox::outcome::SandboxOutcome;
use crate::tools::{ApiData, ArchiveSearchData, SubagentResultData, ToolFailure, ToolOutcome};

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

// ---------------------------------------------------------------------------------------------
// What a successful call hands a program back, and what a program catches when one fails
// ---------------------------------------------------------------------------------------------

/// **Compile and run one program under a run that offers everything and fails every call.**
///
/// The other half of the [crossing table](crossings): that table is the argument-lowering gate, and
/// this is the gate on what comes *back*. Every runtime failure a well-typed Rust call can meet is
/// a `ToolFailure` gg's own tool implementation raises, so the arm's job is to lower it onto an
/// [`ApiError`](crate::sandbox::membrane) the program can read — under the operation's own name,
/// carrying gg's own words.
///
/// A responder that fails *every* call is the right shape here because each of these programs makes
/// exactly one, and it keeps a failure test to a program and its assertion.
fn fails_with(source: &str, failure: ToolFailure, detail: &str) -> (SandboxOutcome, CallLog) {
    let message = detail.to_string();
    run_with(
        source,
        &all_operations(),
        move |_name: &str, _args: &Value| ToolOutcome::failed(failure, message.clone()),
    )
}

/// **The body of a failure test's program**: make the call, and log the class and the operation of
/// the failure it came back with.
///
/// The `Ok` arm logs rather than panicking so a case that wrongly *succeeded* fails on the assertion
/// with the reason visible, instead of on a trap the reader has to decode.
fn caught(call: &str) -> String {
    let arms = "        Ok(_) => gg::log(\"it succeeded\"),\n        \
                Err(failure) => gg::log(format!(\"{:?} on {}\", failure.code, failure.operation)),\n    }\n";
    format!("    match {call} {{\n{arms}")
}

/// [`caught`], logging the failure's message too — for the cases where gg puts in it the one thing
/// the program needs to recover: how many times an ambiguous edit matched, which skills do exist.
fn caught_with_message(call: &str) -> String {
    let arms = "        Ok(_) => gg::log(\"it succeeded\"),\n        \
                Err(failure) => gg::log(format!(\"{:?} on {}: {}\", failure.code, failure.operation, failure.message)),\n    }\n";
    format!("    match {call} {{\n{arms}")
}

// --- shell -----------------------------------------------------------------------------------

#[test]
fn a_shell_run_hands_the_program_its_exit_code_and_output() {
    let (outcome, log) = run_with(
        &whole(
            &["shell"],
            r####"    let ran = shell::run("npm test", Some(5.0))?;
    gg::log(format!("{:?} {} {}", ran.exit_code, ran.output, ran.truncated));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Some(0) ran `npm test` false"]);
    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "npm test", "timeout_secs": 5.0 }))
    );
}

#[test]
fn a_non_zero_exit_is_a_value_the_program_reads() {
    // The double answers `ok: false` with a full sidecar and NO failure classification for a command
    // saying `fail`, which is exactly what the real tool produces for a process that ran and exited
    // non-zero. The membrane has to turn that back into a value: a failing test suite is a fact to
    // branch on, not an exception.
    let (outcome, _log) = run_with(
        &whole(
            &["shell"],
            r####"    let ran = shell::run("npm test || fail", None)?;
    gg::log(format!("{:?} {}", ran.exit_code, ran.exit_code == Some(0)));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Some(1) false"]);
}

#[test]
fn a_shell_timeout_reaches_the_program_as_limit_exceeded() {
    let (outcome, log) = fails_with(
        &whole(&["shell"], &caught(r#"shell::run("sleep 600", Some(1.0))"#)),
        ToolFailure::LimitExceeded,
        "shell: the command was killed after 1s",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on shell"]);
    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "sleep 600", "timeout_secs": 1.0 }))
    );
}

#[test]
fn a_shell_that_could_not_be_launched_is_an_io_error() {
    let (outcome, log) = fails_with(
        &whole(&["shell"], &caught(r#"shell::run("npm test", None)"#)),
        ToolFailure::IoError,
        "shell: could not spawn `sh`",
    );
    assert_eq!(logs(&outcome), ["IoError on shell"]);
    // The timeout the program left out is gg's default rather than an absent key: the arm lowers
    // `None` onto the clamped number the membrane computed, which is what really reached dispatch.
    assert_eq!(
        log.args("shell")
            .and_then(|args| args["command"].as_str().map(str::to_string)),
        Some("npm test".to_string())
    );
}

// --- files -----------------------------------------------------------------------------------

#[test]
fn a_text_read_hands_the_program_the_text_window() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    let files::FileRead::Text(file) =
        files::read_file("notes.md", files::ReadOptions { offset: Some(1), limit: Some(2) })?
    else {
        gg::log("the read was a picture");
        return Ok(());
    };
    gg::log(format!(
        "{} {} {} {} {}",
        file.contents.replace('\n', "|"), file.first_line, file.last_line, file.total_lines,
        file.byte_truncated
    ));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["contents of notes.md|line two| 1 2 2 false"]
    );
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );
}

#[test]
fn an_image_read_hands_the_program_the_image_variant() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    match files::read_file("logo.png", files::ReadOptions::default())? {
        files::FileRead::Image(picture) => gg::log(format!(
            "{} {} {} {} {:?}",
            picture.media_type, picture.label, picture.bytes, picture.shown,
            picture.not_shown_reason
        )),
        files::FileRead::Text(_) => gg::log("the read was text"),
    }
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    // The bytes never enter the program: what a read hands over is gg's description of the picture.
    // `shown` is `false` and the reason says why — a bare `read_file` places nothing in the window,
    // so the recovery named in the reason is the call that does, spelled this arm's way.
    assert_eq!(
        logs(&outcome),
        [
            "image/png PNG 1234 false Some(\"`gg::files::read_file` does not show images; open one \
             with `gg::views::open_file(path)`\")"
        ]
    );
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "logo.png", "offset": null, "limit": null }))
    );
}

#[test]
fn a_write_hands_the_program_the_byte_count() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    let written = files::write_file("out.txt", "hello")?;
    gg::log(written.to_string());
"####,
        ),
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
fn an_empty_write_path_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["files"], &caught(r#"files::write_file("", "hello")"#)),
        ToolFailure::InvalidArgument,
        "write_file: `path` must not be empty",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on write_file"]);
    // The refusal is gg's tool's; what is claimed here is that the empty path the program wrote
    // really crossed, and came back as a code the program can read under the call's own name.
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "", "contents": "hello" }))
    );
}

#[test]
fn a_write_that_failed_is_an_io_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(r#"files::write_file("out/a.txt", "hello")"#),
        ),
        ToolFailure::IoError,
        "write_file: could not create `out`: permission denied",
    );
    assert_eq!(logs(&outcome), ["IoError on write_file"]);
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out/a.txt", "contents": "hello" }))
    );
}

#[test]
fn an_edit_that_matched_once_returns_to_its_program() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    files::edit_file("src/a.rs", "alpha", "beta")?;
    gg::log("edited");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    // An edit hands back nothing at all — `Result<(), ApiError>` — so what a program reads is that
    // it carried on, which is the one thing the unit return has to mean.
    assert_eq!(logs(&outcome), ["edited"]);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.rs", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn an_edit_whose_text_is_absent_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(r#"files::edit_file("src/a.rs", "gamma", "delta")"#),
        ),
        ToolFailure::NotFound,
        "edit_file: `gamma` does not appear in `src/a.rs`",
    );
    assert_eq!(logs(&outcome), ["NotFound on edit_file"]);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.rs", "old_string": "gamma", "new_string": "delta" }))
    );
}

#[test]
fn an_edit_whose_text_repeats_is_a_conflict_carrying_the_count() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught_with_message(r#"files::edit_file("src/a.rs", "alpha", "beta")"#),
        ),
        ToolFailure::Conflict,
        "edit_file: `alpha` appears 3 times in `src/a.rs`; make it unique",
    );
    // The count is the recovery: a program that reads it knows to widen `old_string` rather than to
    // retry the same edit, so the detail has to survive the crossing rather than be flattened away.
    assert_eq!(
        logs(&outcome),
        ["Conflict on edit_file: edit_file: `alpha` appears 3 times in `src/a.rs`; make it unique"]
    );
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "src/a.rs", "old_string": "alpha", "new_string": "beta" }))
    );
}

#[test]
fn a_listing_hands_the_program_its_entries_and_their_kinds() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    for entry in files::list_dir(Some("src"))? {
        gg::log(format!("{} {:?}", entry.name, entry.kind));
    }
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["a.ts File", "b.test.ts File", "sub Directory"],
        "an entry is a name and a kind, not a line of rendered text"
    );
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "src" })));
}

#[test]
fn an_omitted_listing_path_lists_the_root() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    gg::log(files::list_dir(None)?.len().to_string());
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["3"]);
    // `None` crosses as the wire's own absence rather than as an empty string, which is the one
    // thing that separates "list the workspace root" from the argument error below it.
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_directory_is_an_empty_list() {
    let (outcome, _log) = run_with(
        &whole(
            &["files"],
            r####"    let entries = files::list_dir(Some("empty"))?;
    gg::log(format!("{} {}", entries.len(), entries.is_empty()));
"####,
        ),
        &all_operations(),
        |name: &str, _args: &Value| {
            assert_eq!(name, "list_dir");
            ToolOutcome::ok("", "0 entries").with_data(ApiData::DirEntries(Vec::new()))
        },
    );
    // Nothing in the directory is a `Vec` with nothing in it, never a `NotFound` — so a program that
    // walks a tree does not have to treat an empty leaf as an error.
    assert_eq!(logs(&outcome), ["0 true"]);
}

#[test]
fn a_listing_of_a_directory_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["files"], &caught(r#"files::list_dir(Some("gone"))"#)),
        ToolFailure::NotFound,
        "list_dir: no such directory: gone",
    );
    assert_eq!(logs(&outcome), ["NotFound on list_dir"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "gone" })));
}

#[test]
fn a_listing_path_that_is_given_but_empty_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["files"], &caught(r#"files::list_dir(Some(""))"#)),
        ToolFailure::InvalidArgument,
        "list_dir: `path` was given but empty",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on list_dir"]);
    // `Some("")` and `None` are two different calls in this arm's types, and they cross as two
    // different arguments: the empty string reaches dispatch and is refused there.
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "" })));
}

#[test]
fn a_tree_hands_the_program_its_rendering() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    let rendered = files::tree(files::TreeOptions { path: Some("src"), depth: Some(3) })?;
    gg::log(rendered);
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    // One block of text, indentation and trailing `/` included: a tree is rendered by gg and handed
    // over whole, not a structure the program reassembles.
    assert_eq!(logs(&outcome), ["a.ts\nb.test.ts\nsub/\n  c.ts"]);
    assert_eq!(log.args("tree"), Some(json!({ "path": "src", "depth": 3 })));
}

#[test]
fn a_tree_of_a_path_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(
                r#"files::tree(files::TreeOptions { path: Some("gone"), ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "tree: no such path: gone",
    );
    assert_eq!(logs(&outcome), ["NotFound on tree"]);
    assert_eq!(
        log.args("tree"),
        Some(json!({ "path": "gone", "depth": null }))
    );
}

#[test]
fn a_tree_rooted_at_a_file_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(
                r#"files::tree(files::TreeOptions { path: Some("src/a.ts"), ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "tree: `src/a.ts` is a file, not a directory",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on tree"]);
    assert_eq!(
        log.args("tree"),
        Some(json!({ "path": "src/a.ts", "depth": null }))
    );
}

#[test]
fn a_tree_depth_of_zero_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(r#"files::tree(files::TreeOptions { depth: Some(0), ..Default::default() })"#),
        ),
        ToolFailure::InvalidArgument,
        "tree: `depth` must be at least 1",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on tree"]);
    // A NEGATIVE depth is not a case this arm has — `Option<u32>` makes it a compile error — but a
    // zero is well-typed, so it is gg's to refuse and this arm's to lower back.
    assert_eq!(log.args("tree"), Some(json!({ "path": null, "depth": 0 })));
}

#[test]
fn a_search_hands_the_program_its_matches() {
    let (outcome, log) = run_with(
        &whole(
            &["files"],
            r####"    for found in files::search("answer", files::SearchOptions { path: Some("src"), limit: Some(10) })? {
        gg::log(format!("{} {} {}", found.path, found.line, found.text));
    }
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["src/a.ts 3 const answer = 42;"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "src", "limit": 10 }))
    );
}

#[test]
fn a_search_that_matched_nothing_is_an_empty_list() {
    let (outcome, _log) = run_with(
        &whole(
            &["files"],
            r####"    let found = files::search("nothing", files::SearchOptions::default())?;
    gg::log(format!("{} {}", found.len(), found.is_empty()));
"####,
        ),
        &all_operations(),
        |name: &str, _args: &Value| {
            assert_eq!(name, "search");
            ToolOutcome::ok("", "0 matches").with_data(ApiData::SearchMatches(Vec::new()))
        },
    );
    assert_eq!(logs(&outcome), ["0 true"]);
}

#[test]
fn a_blank_search_query_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(r#"files::search("   ", files::SearchOptions::default())"#),
        ),
        ToolFailure::InvalidArgument,
        "search: `query` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on search"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "   ", "path": null, "limit": null }))
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(r#"files::search("(unclosed", files::SearchOptions::default())"#),
        ),
        ToolFailure::InvalidArgument,
        "search: `(unclosed` is not a valid regular expression: unclosed group",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on search"]);
    // A pattern is a string in every arm, so this is one of the few argument errors Rust's types
    // cannot remove: it is a runtime refusal here exactly as it is everywhere else.
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "(unclosed", "path": null, "limit": null }))
    );
}

#[test]
fn a_search_limit_of_zero_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(
                r#"files::search("answer", files::SearchOptions { limit: Some(0), ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "search: `limit` must be at least 1",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on search"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": null, "limit": 0 }))
    );
}

#[test]
fn a_search_path_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["files"],
            &caught(
                r#"files::search("answer", files::SearchOptions { path: Some("gone"), ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "search: no such path: gone",
    );
    assert_eq!(logs(&outcome), ["NotFound on search"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "gone", "limit": null }))
    );
}

// --- skills ----------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_the_program_the_skill_body() {
    let (outcome, log) = run_with(
        &whole(
            &["skills"],
            r####"    gg::log(skills::read_skill("testing")?);
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["the skill body"]);
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "testing" })));
}

#[test]
fn an_unknown_skill_names_the_skills_that_exist() {
    let (outcome, log) = fails_with(
        &whole(
            &["skills"],
            &caught_with_message(r#"skills::read_skill("nope")"#),
        ),
        ToolFailure::NotFound,
        "read_skill: no skill named `nope`; available skills: testing",
    );
    // The recovery is in the message: the list of names that do exist, which is what gg's own tool
    // puts there and what a program has to be able to read back to ask for a real one.
    let line = &logs(&outcome)[0];
    assert!(line.starts_with("NotFound on read_skill: "), "{line}");
    assert!(line.contains("available skills"), "{line}");
    assert_eq!(log.args("read_skill"), Some(json!({ "name": "nope" })));
}

// --- memories --------------------------------------------------------------------------------

#[test]
fn a_written_memory_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["memories"],
            r####"    let usage = memories::write_memory("layout", "where things are", "the crate map",
                                       memories::MemoryOptions::default())?;
    gg::log(format!("{} {:?} {}", usage.count, usage.max_count, usage.total_chars));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 Some(8) 12"]);
    assert_eq!(
        log.args("write_memory"),
        Some(json!({ "name": "layout", "description": "where things are",
                     "body": "the crate map", "code": null, "onUse": null }))
    );
}

#[test]
fn a_duplicate_memory_name_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(
                r#"memories::write_memory("layout", "d", "b", memories::MemoryOptions::default())"#,
            ),
        ),
        ToolFailure::Conflict,
        "write_memory: a memory named `layout` already exists",
    );
    assert_eq!(logs(&outcome), ["Conflict on write_memory"]);
    assert_eq!(
        log.args("write_memory"),
        Some(json!({ "name": "layout", "description": "d", "body": "b",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(
                r#"memories::write_memory("layout", "d", "b", memories::MemoryOptions::default())"#,
            ),
        ),
        ToolFailure::LimitExceeded,
        "write_memory: the body would take this run past its 4000-character budget",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on write_memory"]);
    assert_eq!(
        log.args("write_memory"),
        Some(json!({ "name": "layout", "description": "d", "body": "b",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn an_updated_memory_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["memories"],
            r####"    let usage = memories::update_memory("layout", "d2", "b2",
                                        memories::MemoryOptions::default())?;
    gg::log(format!("{} {:?} {}", usage.count, usage.max_count, usage.total_chars));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 Some(8) 12"]);
    assert_eq!(
        log.args("update_memory"),
        Some(json!({ "name": "layout", "description": "d2", "body": "b2",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn an_update_of_a_memory_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(
                r#"memories::update_memory("gone", "d", "b", memories::MemoryOptions::default())"#,
            ),
        ),
        ToolFailure::NotFound,
        "update_memory: no memory named `gone`",
    );
    assert_eq!(logs(&outcome), ["NotFound on update_memory"]);
    assert_eq!(
        log.args("update_memory"),
        Some(json!({ "name": "gone", "description": "d", "body": "b",
                     "code": null, "onUse": null }))
    );
}

#[test]
fn a_created_memory_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["memories"],
            r####"    let usage = memories::create_memory("layout", "where things are", "the crate map",
                                        memories::MemoryOptions {
                                            code: Some("pub fn one() -> i32 { 1 }"),
                                            ..Default::default()
                                        })?;
    gg::log(format!("{} {:?} {}", usage.count, usage.max_count, usage.total_chars));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 Some(8) 12"]);
    // The code half is not context and counts against no body limit, so the usage it comes back
    // with is the prose's alone — and the wire key for the body here is `contents`, not `body`.
    assert_eq!(
        log.args("create_memory"),
        Some(json!({ "name": "layout", "description": "where things are",
                     "contents": "the crate map", "code": "pub fn one() -> i32 { 1 }",
                     "onUse": null }))
    );
}

#[test]
fn a_blank_field_on_a_new_memory_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(
                r#"memories::create_memory("layout", "", "b", memories::MemoryOptions::default())"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "create_memory: `description` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_memory"]);
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_slug_a_name_may_not_hold_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(
                r#"memories::create_memory("my layout!", "d", "b", memories::MemoryOptions::default())"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "create_memory: `my layout!` is not a slug: letters, digits, `-`, `_` and `.` only",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_memory"]);
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "my layout!", "description": "d", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_duplicate_memory_slug_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(
                r#"memories::create_memory("layout", "d", "b", memories::MemoryOptions::default())"#,
            ),
        ),
        ToolFailure::Conflict,
        "create_memory: a memory named `layout` already exists",
    );
    assert_eq!(logs(&outcome), ["Conflict on create_memory"]);
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_new_memory_over_a_limit_is_limit_exceeded() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(
                r#"memories::create_memory("layout", "d", "b", memories::MemoryOptions::default())"#,
            ),
        ),
        ToolFailure::LimitExceeded,
        "create_memory: the index entry would take this run past its index budget",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on create_memory"]);
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_memory_read_hands_the_program_its_contents() {
    let (outcome, log) = run_with(
        &whole(
            &["memories"],
            r####"    gg::log(memories::read_memory("layout")?);
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["the memory contents"]);
    assert_eq!(log.args("read_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn a_read_of_a_memory_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["memories"], &caught(r#"memories::read_memory("gone")"#)),
        ToolFailure::NotFound,
        "read_memory: no memory named `gone`",
    );
    assert_eq!(logs(&outcome), ["NotFound on read_memory"]);
    assert_eq!(log.args("read_memory"), Some(json!({ "name": "gone" })));
}

#[test]
fn an_edited_memory_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["memories"],
            r####"    let usage = memories::edit_memory("layout", "old", "new")?;
    gg::log(format!("{} {:?} {}", usage.count, usage.max_count, usage.total_chars));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 Some(8) 12"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn a_memory_edit_whose_text_is_absent_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(r#"memories::edit_memory("layout", "gamma", "delta")"#),
        ),
        ToolFailure::NotFound,
        "edit_memory: `gamma` does not appear in `layout`",
    );
    assert_eq!(logs(&outcome), ["NotFound on edit_memory"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "gamma", "new_string": "delta" }))
    );
}

#[test]
fn a_memory_edit_whose_text_repeats_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught_with_message(r#"memories::edit_memory("layout", "old", "new")"#),
        ),
        ToolFailure::Conflict,
        "edit_memory: `old` appears 2 times in `layout`; make it unique",
    );
    assert_eq!(
        logs(&outcome),
        ["Conflict on edit_memory: edit_memory: `old` appears 2 times in `layout`; make it unique"]
    );
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn a_memory_edit_over_the_cap_is_limit_exceeded() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(r#"memories::edit_memory("layout", "old", "new")"#),
        ),
        ToolFailure::LimitExceeded,
        "edit_memory: the result would take this run past its 4000-character budget",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on edit_memory"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "old", "new_string": "new" }))
    );
}

#[test]
fn a_memory_edit_that_would_empty_it_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(r#"memories::edit_memory("layout", "the whole body", "")"#),
        ),
        ToolFailure::InvalidArgument,
        "edit_memory: the edit would leave `layout` empty; delete it instead",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on edit_memory"]);
    assert_eq!(
        log.args("edit_memory"),
        Some(json!({ "name": "layout", "old_string": "the whole body", "new_string": "" }))
    );
}

#[test]
fn a_memory_search_hands_the_program_each_hits_ranking() {
    let (outcome, log) = run_with(
        &whole(
            &["memories"],
            r####"    for hit in memories::search_memories(&["cargo", "nextest"])? {
        gg::log(format!("{} {} {} {}", hit.description, hit.matched, hit.occurrences, hit.excerpt));
    }
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    // The ranking numbers and the window are what let a program choose which hit to read; the hit's
    // `name` and its `read` alias are driven by the alias test above.
    assert_eq!(
        logs(&outcome),
        ["How to build 2 3 …cargo nextest run --workspace…"]
    );
    assert_eq!(
        log.args("search_memories"),
        Some(json!({ "keywords": ["cargo", "nextest"] }))
    );
}

#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_list() {
    let (outcome, _log) = run_with(
        &whole(
            &["memories"],
            r####"    let hits = memories::search_memories(&["nothing"])?;
    gg::log(format!("{} {}", hits.len(), hits.is_empty()));
"####,
        ),
        &all_operations(),
        |name: &str, _args: &Value| {
            assert_eq!(name, "search_memories");
            ToolOutcome::ok("0 of 1 memories match", "searched memories")
                .with_data(ApiData::MemoryHits(Vec::new()))
        },
    );
    assert_eq!(logs(&outcome), ["0 true"]);
}

#[test]
fn a_memory_search_of_empty_keywords_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["memories"],
            &caught(r#"memories::search_memories(&["", "   "])"#),
        ),
        ToolFailure::InvalidArgument,
        "search_memories: every keyword was empty",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on search_memories"]);
    assert_eq!(
        log.args("search_memories"),
        Some(json!({ "keywords": ["", "   "] }))
    );
}

#[test]
fn a_deleted_memory_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["memories"],
            r####"    let usage = memories::delete_memory("layout")?;
    gg::log(format!("{} {:?} {}", usage.count, usage.max_count, usage.total_chars));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1 Some(8) 12"]);
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "layout" })));
}

#[test]
fn a_delete_of_a_memory_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["memories"], &caught(r#"memories::delete_memory("gone")"#)),
        ToolFailure::NotFound,
        "delete_memory: no memory named `gone`",
    );
    assert_eq!(logs(&outcome), ["NotFound on delete_memory"]);
    assert_eq!(log.args("delete_memory"), Some(json!({ "name": "gone" })));
}

// --- tasks -----------------------------------------------------------------------------------

#[test]
fn an_added_task_hands_the_program_the_task_usage() {
    let (outcome, log) = run_with(
        &whole(
            &["tasks"],
            r####"    let usage = tasks::add_task("t1", "Parse the manifest", tasks::TaskOptions {
        description: Some("the reader, not the writer"),
        blocked_by: &["t0"],
    })?;
    gg::log(format!("{} {}", usage.count, usage.max_tasks));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 20"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t1", "title": "Parse the manifest",
                     "description": "the reader, not the writer", "blockedBy": ["t0"] }))
    );
}

#[test]
fn a_blank_task_id_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::add_task("", "Parse the manifest", tasks::TaskOptions::default())"#),
        ),
        ToolFailure::InvalidArgument,
        "add_task: `id` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "", "title": "Parse the manifest",
                     "description": null, "blockedBy": [] }))
    );
}

#[test]
fn a_blank_task_title_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::add_task("t1", "   ", tasks::TaskOptions::default())"#),
        ),
        ToolFailure::InvalidArgument,
        "add_task: `title` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t1", "title": "   ", "description": null, "blockedBy": [] }))
    );
}

#[test]
fn a_duplicate_task_id_is_a_conflict() {
    // The very refusal gg's own store raises, injected here and caught in Rust: what this adds to
    // the membrane's own test of it is that a compiled program reads the CLASS rather than a string.
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::add_task("t1", "T", tasks::TaskOptions::default())"#),
        ),
        ToolFailure::Conflict,
        "add_task: a task `t1` already exists",
    );
    assert_eq!(logs(&outcome), ["Conflict on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t1", "title": "T", "description": null, "blockedBy": [] }))
    );
}

#[test]
fn a_task_edge_that_closes_a_cycle_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(
                r#"tasks::add_task("t2", "T", tasks::TaskOptions { blocked_by: &["t1"], ..Default::default() })"#,
            ),
        ),
        ToolFailure::Conflict,
        "add_task: `t1` already waits on `t2`; the edge would close a cycle",
    );
    assert_eq!(logs(&outcome), ["Conflict on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t2", "title": "T", "description": null, "blockedBy": ["t1"] }))
    );
}

#[test]
fn an_unknown_task_blocker_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(
                r#"tasks::add_task("t2", "T", tasks::TaskOptions { blocked_by: &["gone"], ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "add_task: no task `gone` to block on",
    );
    assert_eq!(logs(&outcome), ["NotFound on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t2", "title": "T", "description": null, "blockedBy": ["gone"] }))
    );
}

#[test]
fn a_task_over_the_cap_is_limit_exceeded() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::add_task("t21", "T", tasks::TaskOptions::default())"#),
        ),
        ToolFailure::LimitExceeded,
        "add_task: this run allows 20 tasks",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on add_task"]);
    assert_eq!(
        log.args("add_task"),
        Some(json!({ "id": "t21", "title": "T", "description": null, "blockedBy": [] }))
    );
}

#[test]
fn an_updated_task_returns_to_its_program() {
    let (outcome, log) = run_with(
        &whole(
            &["tasks"],
            r####"    tasks::update_task("t1", tasks::TaskPatch {
        description: tasks::TextEdit::Clear,
        status: Some(tasks::TaskStatus::Done),
        ..Default::default()
    })?;
    gg::log("updated");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["updated"]);
    // `Clear` is an EMPTY description on the wire, and the title the patch left alone is `null` —
    // two different absences that a three-way field exists to keep apart.
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": null, "status": "done", "description": "" }))
    );
}

#[test]
fn a_task_patch_with_no_field_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::update_task("t1", tasks::TaskPatch::default())"#),
        ),
        ToolFailure::InvalidArgument,
        "update_task: at least one field must be supplied",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on update_task"]);
    // A patch that changes nothing crosses as every key absent, which is what gg refuses on.
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": null, "status": null }))
    );
}

#[test]
fn a_blanked_task_field_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(
                r#"tasks::update_task("t1", tasks::TaskPatch { title: Some("  "), ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "update_task: `title` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on update_task"]);
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "t1", "title": "  ", "status": null }))
    );
}

#[test]
fn an_update_of_a_task_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(
                r#"tasks::update_task("gone", tasks::TaskPatch { status: Some(tasks::TaskStatus::InProgress), ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "update_task: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NotFound on update_task"]);
    assert_eq!(
        log.args("update_task"),
        Some(json!({ "id": "gone", "title": null, "status": "in_progress" }))
    );
}

#[test]
fn a_cleared_task_blocker_list_returns_to_its_program() {
    let (outcome, log) = run_with(
        &whole(
            &["tasks"],
            r####"    tasks::set_blocked_by("t1", &[])?;
    gg::log("cleared");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["cleared"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": [] }))
    );
}

#[test]
fn a_blank_id_on_a_task_blocker_list_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["tasks"], &caught(r#"tasks::set_blocked_by("", &["t0"])"#)),
        ToolFailure::InvalidArgument,
        "set_blocked_by: `id` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "", "blockedBy": ["t0"] }))
    );
}

#[test]
fn a_blank_blocker_on_a_task_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["tasks"], &caught(r#"tasks::set_blocked_by("t1", &[""])"#)),
        ToolFailure::InvalidArgument,
        "set_blocked_by: a blocker id must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": [""] }))
    );
}

#[test]
fn blocking_a_task_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::set_blocked_by("gone", &["t0"])"#),
        ),
        ToolFailure::NotFound,
        "set_blocked_by: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NotFound on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "gone", "blockedBy": ["t0"] }))
    );
}

#[test]
fn a_task_blocker_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::set_blocked_by("t1", &["gone"])"#),
        ),
        ToolFailure::NotFound,
        "set_blocked_by: no task `gone` to block on",
    );
    assert_eq!(logs(&outcome), ["NotFound on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["gone"] }))
    );
}

#[test]
fn a_task_blocker_that_closes_a_cycle_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::set_blocked_by("t1", &["t2"])"#),
        ),
        ToolFailure::Conflict,
        "set_blocked_by: `t2` already waits on `t1`; the edge would close a cycle",
    );
    assert_eq!(logs(&outcome), ["Conflict on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t2"] }))
    );
}

#[test]
fn a_task_blocked_on_itself_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["tasks"],
            &caught(r#"tasks::set_blocked_by("t1", &["t1"])"#),
        ),
        ToolFailure::Conflict,
        "set_blocked_by: `t1` cannot block on itself",
    );
    assert_eq!(logs(&outcome), ["Conflict on set_blocked_by"]);
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t1"] }))
    );
}

#[test]
fn a_completed_task_returns_to_its_program() {
    let (outcome, log) = run_with(
        &whole(
            &["tasks"],
            r####"    tasks::complete_task("t1")?;
    gg::log("completed");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["completed"]);
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn completing_a_task_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["tasks"], &caught(r#"tasks::complete_task("gone")"#)),
        ToolFailure::NotFound,
        "complete_task: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NotFound on complete_task"]);
    assert_eq!(log.args("complete_task"), Some(json!({ "id": "gone" })));
}

#[test]
fn a_removed_task_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["tasks"],
            r####"    let usage = tasks::remove_task("t1")?;
    gg::log(format!("{} {}", usage.count, usage.max_tasks));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 20"]);
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "t1" })));
}

#[test]
fn removing_a_task_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["tasks"], &caught(r#"tasks::remove_task("gone")"#)),
        ToolFailure::NotFound,
        "remove_task: no task `gone`",
    );
    assert_eq!(logs(&outcome), ["NotFound on remove_task"]);
    assert_eq!(log.args("remove_task"), Some(json!({ "id": "gone" })));
}

// --- board -----------------------------------------------------------------------------------

#[test]
fn a_created_epic_hands_the_program_its_id_and_usage() {
    let (outcome, log) = run_with(
        &whole(
            &["board"],
            r####"    let epic = board::create_epic("epc", "The parser", "everything under the parser")?;
    gg::log(format!("{} {} {}", epic.id, epic.board.issues, epic.board.max_issues));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    // The id is the board's to mint — the prefix upper-cased — and it comes back beside the budget,
    // which is what a program needs to decide whether to create the next one.
    assert_eq!(logs(&outcome), ["EPIC 3 20"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epc", "title": "The parser",
                     "description": "everything under the parser" }))
    );
}

#[test]
fn a_prefix_under_three_letters_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["board"], &caught(r#"board::create_epic("ep", "E", "D")"#)),
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be 3-6 letters",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "ep", "title": "E", "description": "D" }))
    );
}

#[test]
fn a_prefix_over_six_letters_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::create_epic("epicical", "E", "D")"#),
        ),
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be 3-6 letters",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epicical", "title": "E", "description": "D" }))
    );
}

#[test]
fn a_prefix_that_is_not_letters_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::create_epic("ep1", "E", "D")"#),
        ),
        ToolFailure::InvalidArgument,
        "create_epic: `prefix` must be letters only",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "ep1", "title": "E", "description": "D" }))
    );
}

#[test]
fn a_blank_epic_field_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["board"], &caught(r#"board::create_epic("epc", "", "D")"#)),
        ToolFailure::InvalidArgument,
        "create_epic: `title` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epc", "title": "", "description": "D" }))
    );
}

#[test]
fn a_prefix_another_epic_holds_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::create_epic("epc", "E", "D")"#),
        ),
        ToolFailure::Conflict,
        "create_epic: an epic `EPC` already exists",
    );
    assert_eq!(logs(&outcome), ["Conflict on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epc", "title": "E", "description": "D" }))
    );
}

#[test]
fn an_epic_over_the_cap_is_limit_exceeded() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::create_epic("epc", "E", "D")"#),
        ),
        ToolFailure::LimitExceeded,
        "create_epic: this run allows 4 epics",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on create_epic"]);
    assert_eq!(
        log.args("create_epic"),
        Some(json!({ "prefix": "epc", "title": "E", "description": "D" }))
    );
}

#[test]
fn a_created_issue_hands_the_program_the_board_usage() {
    let (outcome, log) = run_with(
        &whole(
            &["board"],
            r####"    let issue = board::create_issue("Parse the manifest", "the parser", "the writer",
                                    "tests pass", "Builder", board::IssueOptions::default())?;
    gg::log(format!("{} {} {}", issue.id, issue.board.issues, issue.board.max_issues));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["EPIC-1 3 20"]);
    assert_eq!(
        log.args("create_issue"),
        Some(json!({
            "title": "Parse the manifest",
            "description": null,
            "inScope": "the parser",
            "outOfScope": "the writer",
            "completionCriteria": "tests pass",
            "blockedBy": [],
            "epicId": null,
            "agent": "Builder",
            "reviewers": [],
        }))
    );
}

#[test]
fn a_blank_issue_field_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::create_issue("I", "", "o", "c", "Builder", board::IssueOptions::default())"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "create_issue: `inScope` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_issue"]);
    assert_eq!(
        log.args("create_issue").map(|args| args["inScope"].clone()),
        Some(json!(""))
    );
}

#[test]
fn an_agent_this_session_may_not_assign_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::create_issue("I", "s", "o", "c", "Stranger", board::IssueOptions::default())"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "create_issue: this session may not assign `Stranger`",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_issue"]);
    assert_eq!(
        log.args("create_issue").map(|args| args["agent"].clone()),
        Some(json!("Stranger"))
    );
}

#[test]
fn a_reviewer_this_session_may_not_assign_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::create_issue("I", "s", "o", "c", "Builder", board::IssueOptions { reviewers: &["Stranger"], ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "create_issue: this session may not assign the reviewer `Stranger`",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on create_issue"]);
    assert_eq!(
        log.args("create_issue")
            .map(|args| args["reviewers"].clone()),
        Some(json!(["Stranger"]))
    );
}

#[test]
fn an_issue_under_an_epic_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::create_issue("I", "s", "o", "c", "Builder", board::IssueOptions { epic_id: Some("GONE"), ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "create_issue: no epic `GONE`",
    );
    assert_eq!(logs(&outcome), ["NotFound on create_issue"]);
    assert_eq!(
        log.args("create_issue").map(|args| args["epicId"].clone()),
        Some(json!("GONE"))
    );
}

#[test]
fn an_issue_blocker_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::create_issue("I", "s", "o", "c", "Builder", board::IssueOptions { blocked_by: &["GONE-1"], ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "create_issue: no issue `GONE-1` to block on",
    );
    assert_eq!(logs(&outcome), ["NotFound on create_issue"]);
    assert_eq!(
        log.args("create_issue")
            .map(|args| args["blockedBy"].clone()),
        Some(json!(["GONE-1"]))
    );
}

#[test]
fn an_issue_over_the_cap_is_limit_exceeded() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::create_issue("I", "s", "o", "c", "Builder", board::IssueOptions::default())"#,
            ),
        ),
        ToolFailure::LimitExceeded,
        "create_issue: this run allows 20 issues",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on create_issue"]);
    assert_eq!(
        log.args("create_issue").map(|args| args["title"].clone()),
        Some(json!("I"))
    );
}

#[test]
fn an_updated_issue_returns_to_its_program() {
    let (outcome, log) = run_with(
        &whole(
            &["board"],
            r####"    board::update_issue("EPIC-1", board::IssuePatch {
        status: Some(board::IssueStatus::Done),
        epic: board::EpicAssignment::Ungroup,
        ..Default::default()
    })?;
    gg::log("updated");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["updated"]);
    // `Ungroup` detaches the issue, which gg's schema spells as the empty string; the description
    // this patch left at `Keep` is an absent key rather than a `null`.
    assert_eq!(
        log.args("update_issue"),
        Some(json!({
            "id": "EPIC-1",
            "title": null,
            "inScope": null,
            "outOfScope": null,
            "completionCriteria": null,
            "status": "done",
            "epicId": "",
        }))
    );
}

#[test]
fn an_issue_patch_with_no_field_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::update_issue("EPIC-1", board::IssuePatch::default())"#),
        ),
        ToolFailure::InvalidArgument,
        "update_issue: at least one field must be supplied",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on update_issue"]);
    assert_eq!(
        log.args("update_issue"),
        Some(json!({
            "id": "EPIC-1",
            "title": null,
            "inScope": null,
            "outOfScope": null,
            "completionCriteria": null,
            "status": null,
        }))
    );
}

#[test]
fn a_blanked_issue_field_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::update_issue("EPIC-1", board::IssuePatch { in_scope: Some("  "), ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "update_issue: `inScope` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on update_issue"]);
    assert_eq!(
        log.args("update_issue").map(|args| args["inScope"].clone()),
        Some(json!("  "))
    );
}

#[test]
fn an_update_of_an_issue_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::update_issue("GONE-1", board::IssuePatch { status: Some(board::IssueStatus::InProgress), ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "update_issue: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NotFound on update_issue"]);
    assert_eq!(
        log.args("update_issue").map(|args| args["status"].clone()),
        Some(json!("in_progress"))
    );
}

#[test]
fn a_patch_naming_an_epic_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(
                r#"board::update_issue("EPIC-1", board::IssuePatch { epic: board::EpicAssignment::Set("GONE"), ..Default::default() })"#,
            ),
        ),
        ToolFailure::NotFound,
        "update_issue: no epic `GONE`",
    );
    assert_eq!(logs(&outcome), ["NotFound on update_issue"]);
    // `Set` puts the epic's id on the wire where `Ungroup` puts the empty string, so the id the
    // program named is what reached dispatch and what gg could not find.
    assert_eq!(
        log.args("update_issue").map(|args| args["epicId"].clone()),
        Some(json!("GONE"))
    );
}

#[test]
fn an_issue_blocker_list_returns_to_its_program() {
    let (outcome, log) = run_with(
        &whole(
            &["board"],
            r####"    board::set_issue_blocked_by("EPIC-2", &["EPIC-1"])?;
    gg::log("blocked");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["blocked"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "EPIC-2", "blockedBy": ["EPIC-1"] }))
    );
}

#[test]
fn a_blank_id_on_an_issue_blocker_list_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::set_issue_blocked_by("", &["EPIC-1"])"#),
        ),
        ToolFailure::InvalidArgument,
        "set_issue_blocked_by: `id` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "", "blockedBy": ["EPIC-1"] }))
    );
}

#[test]
fn a_blank_blocker_on_an_issue_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::set_issue_blocked_by("EPIC-2", &[""])"#),
        ),
        ToolFailure::InvalidArgument,
        "set_issue_blocked_by: a blocker id must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "EPIC-2", "blockedBy": [""] }))
    );
}

#[test]
fn blocking_an_issue_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::set_issue_blocked_by("GONE-1", &["EPIC-1"])"#),
        ),
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NotFound on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "GONE-1", "blockedBy": ["EPIC-1"] }))
    );
}

#[test]
fn an_issue_blocker_the_board_lacks_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::set_issue_blocked_by("EPIC-2", &["GONE-1"])"#),
        ),
        ToolFailure::NotFound,
        "set_issue_blocked_by: no issue `GONE-1` to block on",
    );
    assert_eq!(logs(&outcome), ["NotFound on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "EPIC-2", "blockedBy": ["GONE-1"] }))
    );
}

#[test]
fn an_issue_edge_that_closes_a_cycle_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::set_issue_blocked_by("EPIC-1", &["EPIC-2"])"#),
        ),
        ToolFailure::Conflict,
        "set_issue_blocked_by: `EPIC-2` already waits on `EPIC-1`; the edge would close a cycle",
    );
    assert_eq!(logs(&outcome), ["Conflict on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "EPIC-1", "blockedBy": ["EPIC-2"] }))
    );
}

#[test]
fn an_issue_blocked_on_itself_is_a_conflict() {
    let (outcome, log) = fails_with(
        &whole(
            &["board"],
            &caught(r#"board::set_issue_blocked_by("EPIC-1", &["EPIC-1"])"#),
        ),
        ToolFailure::Conflict,
        "set_issue_blocked_by: `EPIC-1` cannot block on itself",
    );
    assert_eq!(logs(&outcome), ["Conflict on set_issue_blocked_by"]);
    assert_eq!(
        log.args("set_issue_blocked_by"),
        Some(json!({ "id": "EPIC-1", "blockedBy": ["EPIC-1"] }))
    );
}

#[test]
fn a_removed_epic_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["board"],
            r####"    let usage = board::remove_epic("EPIC")?;
    gg::log(format!("{} {} {} {}", usage.epics, usage.max_epics, usage.issues, usage.max_issues));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    // A removal hands back the budget and no id: the epic's issues survive it ungrouped, so the
    // issue count is the number a program reads to know nothing else went with it.
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "EPIC" })));
}

#[test]
fn removing_an_epic_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["board"], &caught(r#"board::remove_epic("GONE")"#)),
        ToolFailure::NotFound,
        "remove_epic: no epic `GONE`",
    );
    assert_eq!(logs(&outcome), ["NotFound on remove_epic"]);
    assert_eq!(log.args("remove_epic"), Some(json!({ "id": "GONE" })));
}

#[test]
fn a_removed_issue_hands_the_program_the_usage_after_it() {
    let (outcome, log) = run_with(
        &whole(
            &["board"],
            r####"    let usage = board::remove_issue("EPIC-1")?;
    gg::log(format!("{} {}", usage.issues, usage.max_issues));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["3 20"]);
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "EPIC-1" })));
}

#[test]
fn removing_an_issue_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["board"], &caught(r#"board::remove_issue("GONE-1")"#)),
        ToolFailure::NotFound,
        "remove_issue: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NotFound on remove_issue"]);
    assert_eq!(log.args("remove_issue"), Some(json!({ "id": "GONE-1" })));
}

#[test]
fn a_registered_wait_does_not_stop_the_program() {
    // The surprising half of the call, and the one a model gets wrong: nothing blocks INSIDE the
    // program. The wait is registered, the call returns gg's acknowledgement at once, and the rest
    // of the program runs — the suspension happens after the turn ends.
    let (outcome, log) = run_with(
        &whole(
            &["board"],
            r####"    gg::log("before the wait");
    gg::log(board::wait_for_issue("EPIC-1")?);
    gg::log("after the wait");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["before the wait", "wait registered", "after the wait"],
        "a registered wait suspended the program instead of returning to it"
    );
    assert_eq!(log.names(), ["wait_for_issue"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );
}

#[test]
fn a_blank_wait_id_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["board"], &caught(r#"board::wait_for_issue("")"#)),
        ToolFailure::InvalidArgument,
        "wait_for_issue: `issueId` must not be blank",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on wait_for_issue"]);
    assert_eq!(log.args("wait_for_issue"), Some(json!({ "issueId": "" })));
}

#[test]
fn waiting_on_this_sessions_own_issue_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["board"], &caught(r#"board::wait_for_issue("EPIC-1")"#)),
        ToolFailure::InvalidArgument,
        "wait_for_issue: `EPIC-1` is the issue this session was assigned",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on wait_for_issue"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );
}

#[test]
fn waiting_on_an_issue_that_is_not_there_is_not_found() {
    let (outcome, log) = fails_with(
        &whole(&["board"], &caught(r#"board::wait_for_issue("GONE-1")"#)),
        ToolFailure::NotFound,
        "wait_for_issue: no issue `GONE-1`",
    );
    assert_eq!(logs(&outcome), ["NotFound on wait_for_issue"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "GONE-1" }))
    );
}

#[test]
fn waiting_without_a_board_is_unavailable() {
    // The one failure of the six modules that no responder can produce, because the membrane refuses
    // it before a responder is reached: a run with no board withholds the call, and a compiled arm
    // cannot withhold the NAME, so the program compiles and the host refuses it.
    let (outcome, log) = run_with(
        &whole(&["board"], &caught(r#"board::wait_for_issue("EPIC-1")"#)),
        &all_operations_without(CAPABILITY_PROJECT_MANAGEMENT),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Unavailable on wait_for_issue"]);
    assert!(
        log.names().is_empty(),
        "a withheld call must not reach gg's dispatch at all"
    );
}

// ---------------------------------------------------------------------------------------------
// The session-side families: what each call leaves behind, and what a program reads when one fails
// ---------------------------------------------------------------------------------------------

/// Compile and run one program under `ending`'s group, with every operation offered and no library.
///
/// The [`run_with`] beside it fixes the ending group at [`None`](RunEnding::None), which is the
/// right scope for everything that is not an ending — and the wrong one for the three calls that
/// are, since the group is exactly what binds them.
fn run_as(source: &str, ending: RunEnding) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(source),
        &all_operations(),
        &[],
        ending,
        false,
        canned_outcome,
    )
}

/// Compile and run one program for an agent that **keeps a program library**, granting nothing else.
///
/// The library is a scope flag rather than an entry in the allowlist, so it is the one thing a
/// `programs` case cannot express by naming operations — see
/// [`granted_operations`](crate::sandbox::fake::granted_operations).
fn run_with_library(source: &str) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(source),
        &[],
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    )
}

/// A view or documentation refusal the [double](crate::sandbox::fake::FakeOperationApi) is armed
/// with, for the failures the api raises rather than a tool.
fn refusal(failure: ToolFailure, message: &str) -> ViewRefusal {
    ViewRefusal {
        failure,
        message: message.to_string(),
    }
}

// --- context ---------------------------------------------------------------------------------

#[test]
fn an_evicted_file_view_hands_the_program_the_reclaim_report() {
    let (outcome, log) = run_with(
        &whole(
            &["context"],
            r####"    let freed = context::evict_file_view(Some("src/a.ts"))?;
    gg::log(format!("{} {} {:?} {}", freed.items, freed.reclaimed_tokens, freed.paths, freed.detail));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [r#"2 300 ["src/a.ts"] dropped 2 items"#]);
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.ts" }))
    );
}

#[test]
fn evicting_every_file_view_is_an_absent_path_rather_than_a_list() {
    // `None` is the whole of how a program says "all of them": there is no second call and no
    // sentinel path, so a lowering that sent an empty string instead would drop nothing and report
    // success.
    let (outcome, log) = run_with(
        &whole(
            &["context"],
            r####"    let freed = context::evict_file_view(None)?;
    gg::log(freed.detail);
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["dropped 2 items"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_eviction_path_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(
            &["context"],
            &caught(r#"context::evict_file_view(Some(""))"#),
        ),
        ToolFailure::InvalidArgument,
        "`path` must not be empty; omit it to drop every file view",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on evict_file_view"]);
}

#[test]
fn an_archived_thread_hands_the_program_the_reclaim_report() {
    let (outcome, log) = run_with(
        &whole(
            &["context"],
            r####"    let freed = context::archive_thread(&[4..=19, 30..=31])?;
    gg::log(format!("{} {} {} {}", freed.items, freed.reclaimed_tokens, freed.paths.len(), freed.detail));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["2 300 1 dropped 2 items"]);
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19], [30, 31]] }))
    );
}

#[test]
fn an_empty_archive_span_list_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(&["context"], &caught("context::archive_thread(&[])")),
        ToolFailure::InvalidArgument,
        "`ranges` must name at least one span of turns",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on archive_thread"]);
}

#[test]
fn more_archive_spans_than_the_cap_is_an_argument_error() {
    let spans = "    let spans: Vec<std::ops::RangeInclusive<u32>> =\n        \
                 (0..64u32).map(|turn| turn..=turn).collect();\n";
    let (outcome, _log) = fails_with(
        &whole(
            &["context"],
            &format!("{spans}{}", caught("context::archive_thread(&spans)")),
        ),
        ToolFailure::InvalidArgument,
        "at most 16 spans may be archived at once",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on archive_thread"]);
}

#[test]
fn an_archive_span_that_ends_before_it_starts_is_an_argument_error() {
    let (outcome, log) = fails_with(
        &whole(&["context"], &caught("context::archive_thread(&[19..=4])")),
        ToolFailure::InvalidArgument,
        "a span ends before it starts: 19..=4",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on archive_thread"]);
    // The two ends reached the host the way round the program wrote them, which is the half of this
    // an arm could get wrong on its own: a lowering that sorted them would turn a program's mistake
    // into a silently different archive.
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[19, 4]] }))
    );
}

#[test]
fn an_archive_search_hands_the_program_each_hits_role_and_text() {
    let (outcome, log) = run_with(
        &whole(
            &["context"],
            r####"    let found = context::search_archive("the earlier")?;
    let hit = &found.hits[0];
    gg::log(format!("{} {} {:?} {}", found.archive_empty, hit.seq, hit.role, hit.text));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["false 3 Assistant the earlier answer"]);
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the earlier" }))
    );
}

#[test]
fn an_empty_archive_is_told_apart_from_a_search_that_matched_nothing() {
    // The one field that distinguishes them, read on both shapes by one program: an empty answer
    // alone cannot say whether the archive is empty or the words are not in it, and the recovery is
    // opposite — archive more, or search for something else.
    let mut answered = 0u32;
    let (outcome, _log) = run_with(
        &whole(
            &["context"],
            r####"    for query in ["anything", "nothing"] {
        let found = context::search_archive(query)?;
        gg::log(format!("{} {}", found.archive_empty, found.hits.len()));
    }
"####,
        ),
        &all_operations(),
        move |_name: &str, _args: &Value| {
            answered += 1;
            ToolOutcome::ok("0 hits", "searched").with_data(ApiData::ArchiveSearch(
                ArchiveSearchData {
                    archive_empty: answered == 1,
                    hits: Vec::new(),
                },
            ))
        },
    );
    assert_eq!(logs(&outcome), ["true 0", "false 0"]);
}

#[test]
fn an_empty_archive_query_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(&["context"], &caught(r#"context::search_archive("")"#)),
        ToolFailure::InvalidArgument,
        "`query` must not be empty",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on search_archive"]);
}

#[test]
fn a_compaction_is_registered_and_the_program_runs_on() {
    // The call that would be an exception on any other design: it rewrites the very window the
    // program is composing into. It returns nothing, the program keeps running, and gg performs the
    // rewrite once the turn has ended — so what a test can observe is that the program reached its
    // own last line after making it.
    let (outcome, log) = run_with(
        &whole(
            &["context"],
            r####"    context::compact("parsed the manifest; the writer is next", &["src/a.ts"])?;
    gg::log("still running");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["still running"]);
    assert_eq!(
        log.args("compact"),
        Some(
            json!({ "summary": "parsed the manifest; the writer is next", "files": ["src/a.ts"] })
        )
    );
}

#[test]
fn a_blank_compaction_summary_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(&["context"], &caught(r#"context::compact("   ", &[])"#)),
        ToolFailure::InvalidArgument,
        "`summary` must not be blank; it is the whole of the restarted window",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on compact"]);
}

// --- delegation ------------------------------------------------------------------------------

#[test]
fn a_spawned_child_hands_the_program_its_handle() {
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    let child = delegation::spawn_subagent("Builder", delegation::Brief::Prompt("take the writer"))?;
    gg::log(format!("{} {} {}", child.id, child.slot, child.model_id));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-1 primary test/model"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "Builder", "prompt": "take the writer", "issueId": null }))
    );
}

#[test]
fn a_child_briefed_from_an_issue_carries_the_issue_id_and_no_prompt() {
    // The other arm of `Brief`, and the one an enum could get wrong silently: both variants carry a
    // string, so a lowering that filled the wrong slot would spawn a child briefed with an issue id
    // as its whole instructions.
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    let child = delegation::spawn_subagent("Builder", delegation::Brief::Issue("AUTH-1"))?;
    gg::log(child.id);
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "Builder", "prompt": null, "issueId": "AUTH-1" }))
    );
}

#[test]
fn a_spawn_at_the_delegation_depth_cap_is_limit_exceeded() {
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught(
                r#"delegation::spawn_subagent("Builder", delegation::Brief::Prompt("take the writer"))"#,
            ),
        ),
        ToolFailure::LimitExceeded,
        "this session is already 3 levels deep; no further children may be spawned",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on spawn_subagent"]);
}

#[test]
fn an_agent_this_session_may_not_spawn_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught_with_message(
                r#"delegation::spawn_subagent("Nobody", delegation::Brief::Prompt("take the writer"))"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "`Nobody` is not an agent this session may spawn; it may spawn `Builder`",
    );
    assert_eq!(
        logs(&outcome),
        [
            "InvalidArgument on spawn_subagent: `Nobody` is not an agent this session may spawn; it may spawn `Builder`"
        ]
    );
}

#[test]
fn waiting_on_children_hands_the_program_each_result() {
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    let collected = delegation::wait_for_subagents(Some(&["agent-1"]))?;
    let first = &collected[0];
    gg::log(format!("{} {:?} {}", first.id, first.status, first.summary));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-1 Some(Completed) did the work"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

#[test]
fn waiting_with_no_ids_waits_for_every_outstanding_child() {
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    let collected = delegation::wait_for_subagents(None)?;
    gg::log(collected.len().to_string());
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

#[test]
fn a_child_that_produced_no_ending_has_no_status() {
    // The `Option` is the point: a child that never declared an ending is a fact the parent has to
    // be able to read, and an arm that defaulted it to `Completed` would have the parent believe
    // work was finished that nobody finished.
    let (outcome, _log) = run_with(
        &whole(
            &["delegation"],
            r####"    let collected = delegation::wait_for_subagents(Some(&["agent-1"]))?;
    gg::log(format!("{:?} {:?}", collected[0].status, collected[0].summary));
"####,
        ),
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(vec![
                SubagentResultData {
                    id: "agent-1".to_string(),
                    status: None,
                    summary: String::new(),
                },
            ]))
        },
    );
    assert_eq!(logs(&outcome), [r#"None """#]);
}

#[test]
fn waiting_on_an_id_this_session_did_not_spawn_is_not_found() {
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught(r#"delegation::wait_for_subagents(Some(&["agent-9"]))"#),
        ),
        ToolFailure::NotFound,
        "no child was spawned under the id `agent-9`",
    );
    assert_eq!(logs(&outcome), ["NotFound on wait_for_subagents"]);
}

#[test]
fn a_message_to_a_running_child_is_delivered_and_the_program_runs_on() {
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    delegation::send_message("agent-1", "prefer the simpler parser")?;
    gg::log("carried on");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["carried on"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn a_message_to_an_unknown_agent_is_not_found() {
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught(r#"delegation::send_message("agent-9", "look again")"#),
        ),
        ToolFailure::NotFound,
        "no child is running under the id `agent-9`",
    );
    assert_eq!(logs(&outcome), ["NotFound on send_message"]);
}

#[test]
fn a_message_to_a_child_that_has_returned_is_a_conflict() {
    // A different class from an unknown id, and the difference is what the program does next: a
    // child that has returned has a result to collect, so there is nothing to retry and nothing to
    // correct.
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught(r#"delegation::send_message("agent-1", "look again")"#),
        ),
        ToolFailure::Conflict,
        "`agent-1` has already returned; collect its result instead",
    );
    assert_eq!(logs(&outcome), ["Conflict on send_message"]);
}

#[test]
fn a_state_transition_is_registered_and_the_program_runs_to_its_end() {
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    delegation::transition_state("review", Some("the parser is done"))?;
    gg::log("ran to the end");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["ran to the end"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "review", "note": "the parser is done" }))
    );
}

#[test]
fn a_state_this_session_may_not_move_to_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught_with_message(r#"delegation::transition_state("shipping", None)"#),
        ),
        ToolFailure::InvalidArgument,
        "`shipping` is not an edge of the current state; it may move to `review`",
    );
    assert_eq!(
        logs(&outcome),
        [
            "InvalidArgument on transition_state: `shipping` is not an edge of the current state; it may move to `review`"
        ]
    );
}

#[test]
fn a_second_state_transition_in_one_turn_is_refused_and_the_first_stands() {
    let mut seen = 0u32;
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            &format!(
                "    delegation::transition_state(\"review\", None)?;\n    gg::log(\"the first stands\");\n{}",
                caught(r#"delegation::transition_state("writing", None)"#)
            ),
        ),
        &all_operations(),
        move |_name: &str, _args: &Value| {
            seen += 1;
            if seen == 1 {
                ToolOutcome::ok("moving on once this turn ends", "transition")
            } else {
                ToolOutcome::failed(
                    ToolFailure::Refused,
                    "this turn has already declared where it goes next".to_string(),
                )
            }
        },
    );
    assert_eq!(
        logs(&outcome),
        ["the first stands", "Refused on transition_state"]
    );
    // The first declaration reached the host with its own target, which is what "the first stands"
    // means: `CallLog::args` answers with the FIRST call under a name.
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "review", "note": null }))
    );
    assert_eq!(log.names(), ["transition_state", "transition_state"]);
}

#[test]
fn a_state_transition_this_run_withheld_is_unavailable() {
    // The one operation an instance holds rather than a capability, so the grant that withholds it
    // is a subtraction of one row rather than of a capability's whole family: everything else this
    // agent may do it still may.
    let granted: Vec<_> = all_operations()
        .into_iter()
        .filter(|id| *id != DELEGATION_TRANSITION_STATE)
        .collect();
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            &caught_with_message(r#"delegation::transition_state("review", None)"#),
        ),
        &granted,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["Unavailable on transition_state: `gg::delegation::transition_state` is not available."]
    );
    assert!(
        log.names().is_empty(),
        "an operation this agent does not hold must not reach gg's dispatch"
    );
}

#[test]
fn an_exec_is_registered_and_the_program_runs_on() {
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    delegation::exec("Builder", Some("pick it up from here"))?;
    gg::log("still this agent, for now");
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["still this agent, for now"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": "pick it up from here" }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught_with_message(r#"delegation::exec("Nobody", None)"#),
        ),
        ToolFailure::InvalidArgument,
        "`Nobody` is not an agent this session may become; it may become `Builder`",
    );
    assert_eq!(
        logs(&outcome),
        [
            "InvalidArgument on exec: `Nobody` is not an agent this session may become; it may become `Builder`"
        ]
    );
}

#[test]
fn an_exec_a_machine_driven_session_does_not_hold_is_unavailable() {
    // A session inside a state machine does not bind `exec` at all: the succession it makes is the
    // machine's, and the way out of the state is `delegation::transition_state` — which the same
    // grant still holds, because the two are bound by different things.
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            &caught_with_message(r#"delegation::exec("Builder", None)"#),
        ),
        &all_operations_without(CAPABILITY_EXEC),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["Unavailable on exec: `gg::delegation::exec` is not available."]
    );
    assert!(
        log.names().is_empty(),
        "a withheld succession must not reach gg's dispatch"
    );
}

#[test]
fn an_exec_after_a_state_transition_is_refused() {
    // The two are one succession slot, declared two ways, and the first declaration wins — so a
    // program that took the machine's edge and then tried to choose its own successor is told the
    // question is already settled.
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            &format!(
                "    delegation::transition_state(\"review\", None)?;\n{}",
                caught(r#"delegation::exec("Builder", None)"#)
            ),
        ),
        &all_operations(),
        |name: &str, _args: &Value| match name {
            "exec" => ToolOutcome::failed(
                ToolFailure::Refused,
                "this turn has already declared where it goes next".to_string(),
            ),
            _ => ToolOutcome::ok("moving on once this turn ends", "transition"),
        },
    );
    assert_eq!(logs(&outcome), ["Refused on exec"]);
    assert_eq!(log.names(), ["transition_state", "exec"]);
}

#[test]
fn a_fork_hands_the_program_the_copys_handle_before_the_copy_has_started() {
    // The handle is minted at the call and the copy is started when the turn ends, which is what
    // lets the program name the copy in the very program that made it — and why the id it reads is
    // a second one rather than this session's own.
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            r####"    let copy = delegation::fork("try the other fix")?;
    gg::log(format!("{} {} {}", copy.id, copy.slot, copy.model_id));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["agent-2 primary test/model"]);
    assert_eq!(
        log.args("fork"),
        Some(json!({ "prompt": "try the other fix" }))
    );
}

#[test]
fn a_blank_fork_prompt_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(&["delegation"], &caught(r#"delegation::fork("   ")"#)),
        ToolFailure::InvalidArgument,
        "`prompt` must not be blank; it is the only difference the copy has",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on fork"]);
}

#[test]
fn a_fork_at_the_delegation_depth_cap_is_limit_exceeded() {
    let (outcome, _log) = fails_with(
        &whole(
            &["delegation"],
            &caught(r#"delegation::fork("try the other fix")"#),
        ),
        ToolFailure::LimitExceeded,
        "this session is already 3 levels deep; no further copies may be started",
    );
    assert_eq!(logs(&outcome), ["LimitExceeded on fork"]);
}

#[test]
fn a_fork_this_run_withheld_is_unavailable() {
    let (outcome, log) = run_with(
        &whole(
            &["delegation"],
            &caught_with_message(r#"delegation::fork("try the other fix")"#),
        ),
        &all_operations_without(CAPABILITY_FORK),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["Unavailable on fork: `gg::delegation::fork` is not available."]
    );
    assert!(log.names().is_empty());
}

// --- programs --------------------------------------------------------------------------------

#[test]
fn an_empty_program_library_is_an_empty_history_rather_than_a_failure() {
    // The first turn of every session, and the reason `history` answers with a `Result` at all: an
    // empty list and a refusal are different facts, and a session that keeps a library and has run
    // nothing into it has the first of them.
    let (outcome, _log) = run_with_library(&whole(
        &["programs"],
        r####"    gg::log(programs::history()?.len().to_string());
"####,
    ));
    assert_eq!(logs(&outcome), ["0"]);
}

#[test]
fn a_seeded_library_hands_the_program_each_programs_shape() {
    let (outcome, _log) = evaluate_with_program(
        &prepare(&whole(
            &["programs"],
            r####"    let history = programs::history()?;
    let first = &history[0];
    gg::log(format!("{} {} {} {} {} {:?}", first.id, first.turn, first.lines, first.chars, first.ok, first.error));
"####,
        )),
        "p3",
        3,
        r#"gg::log("the program that ran");"#,
        canned_outcome,
    );
    // A shape and never a source: the id `get` takes, the turn it ran on, how big it was, and that
    // it ran to its end with nothing to report.
    assert_eq!(logs(&outcome), ["p3 3 1 32 true None"]);
}

#[test]
fn a_history_without_a_library_is_unavailable() {
    let (outcome, _log) = run_with(
        &whole(&["programs"], &caught("programs::history()")),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Unavailable on history"]);
}

#[test]
fn a_seeded_program_hands_the_program_its_source() {
    let (outcome, _log) = evaluate_with_program(
        &prepare(&whole(
            &["programs"],
            r####"    gg::log(programs::get("p3")?);
"####,
        )),
        "p3",
        3,
        r#"gg::log("the program that ran");"#,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [r#"gg::log("the program that ran");"#]);
}

#[test]
fn an_id_the_library_never_issued_is_not_found() {
    let (outcome, _log) = run_with_library(&whole(
        &["programs"],
        &caught_with_message(r#"programs::get("p2")"#),
    ));
    assert_eq!(
        logs(&outcome),
        ["NotFound on get: no program is kept under the id `p2`; no program has been kept yet"]
    );
}

#[test]
fn an_id_a_non_empty_library_does_not_hold_names_the_ids_it_does() {
    // The other way to miss, and the one where the sentence is worth something: the model asked for
    // a program that is not there, and what it needs is the list of the ones that are — rather than
    // a second turn spent discovering the same thing.
    let (outcome, _log) = evaluate_with_program(
        &prepare(&whole(
            &["programs"],
            &caught_with_message(r#"programs::get("p9")"#),
        )),
        "p3",
        3,
        r#"gg::log("the program that ran");"#,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["NotFound on get: no program is kept under the id `p9`; ids held: `p3` (turn 3)"]
    );
}

#[test]
fn a_program_fetch_without_a_library_is_unavailable() {
    let (outcome, _log) = run_with(
        &whole(&["programs"], &caught(r#"programs::get("p3")"#)),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Unavailable on get"]);
}

#[test]
fn a_handed_over_program_is_recorded_on_the_outcome() {
    let (outcome, log) = run_with_library(&whole(
        &["programs"],
        r####"    programs::rerun("gg::log(\"again\");")?;
    gg::log("the calling program still finished");
"####,
    ));
    assert_eq!(logs(&outcome), ["the calling program still finished"]);
    assert_eq!(outcome.rerun.as_deref(), Some(r#"gg::log("again");"#));
    assert!(!outcome.revoked_rerun);
    // It touches no tool at all: what it sets is a field in this agent's host-side state, which the
    // loop reads once the program has ended.
    assert!(log.names().is_empty());
}

#[test]
fn a_blank_rerun_source_is_an_argument_error() {
    let (outcome, _log) = run_with_library(&whole(
        &["programs"],
        &caught_with_message(r#"programs::rerun("   ")"#),
    ));
    assert_eq!(
        logs(&outcome),
        ["InvalidArgument on rerun: `source` must not be blank"]
    );
    assert!(outcome.rerun.is_none());
}

#[test]
fn a_second_rerun_in_one_program_is_refused_and_the_first_stands() {
    let (outcome, _log) = run_with_library(&whole(
        &["programs"],
        &format!(
            "    programs::rerun(\"gg::log(\\\"first\\\");\")?;\n{}",
            caught_with_message(r#"programs::rerun("gg::log(\"second\");")"#)
        ),
    ));
    assert_eq!(
        logs(&outcome),
        ["Refused on rerun: this program already handed one over"]
    );
    assert_eq!(outcome.rerun.as_deref(), Some(r#"gg::log("first");"#));
}

#[test]
fn a_rerun_without_a_library_is_unavailable() {
    let (outcome, _log) = run_with(
        &whole(
            &["programs"],
            &caught(r#"programs::rerun("gg::log(\"again\");")"#),
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Unavailable on rerun"]);
    assert!(outcome.rerun.is_none());
}

#[test]
fn a_hand_over_from_a_program_that_then_fails_is_taken_back() {
    // What the program chose rests on checks it never finished running, so the hand-over goes with
    // everything else it decided — and the turn ends in an ordinary error rather than in a second
    // program the model no longer has a reason to want.
    let (outcome, _log) = run_with_library(&whole(
        &["programs"],
        r####"    programs::rerun("gg::log(\"again\");")?;
    panic!("the work after the hand-over failed");
"####,
    ));
    assert!(
        trap(&outcome).contains("the work after the hand-over failed"),
        "the program failed with its own words: {}",
        trap(&outcome)
    );
    assert!(outcome.rerun.is_none(), "the hand-over was taken back");
    assert!(outcome.revoked_rerun, "and the turn's feedback can say so");
}

// --- docs ------------------------------------------------------------------------------------

#[test]
fn a_documentation_search_hands_the_program_a_page_and_opens_its_view() {
    // The result is a value AND a view: the page is readable in the turn that asked for it, and the
    // same page is put in the next prompt under `search results`.
    let (outcome, log) = run_with(
        &whole(
            &["docs"],
            r####"    let found = docs::search(docs::SearchOptions {
        query: Some("open"),
        modules: &["views"],
        kind: Some(docs::DocKind::Function),
        limit: Some(5),
        ..Default::default()
    })?;
    gg::log(format!("{} {} {}", found.total, found.offset, found.hits.len()));
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    // The double models no catalogue, so the honest page is an empty one; the ranking over a real
    // catalogue is `docs::search`'s own to prove, next to the catalogue.
    assert_eq!(logs(&outcome), ["0 0 0"]);
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["search results"]
    );
    assert!(
        log.names().is_empty(),
        "a documentation search dispatches no gg tool"
    );
}

#[test]
fn a_documentation_search_answers_a_program_granted_nothing() {
    // The `Always` binding, which is the whole of how a model with no capabilities at all can learn
    // what it holds: the prompt names no function, so a run that offered nothing would otherwise
    // leave the model nothing to ask.
    let (outcome, _log) = run_with(
        &whole(
            &["docs"],
            r####"    gg::log(docs::search(docs::SearchOptions { query: Some("open"), ..Default::default() })?.total.to_string());
"####,
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["0"]);
}

#[test]
fn a_search_with_neither_a_query_nor_a_filter_is_an_argument_error() {
    let (outcome, _log) = evaluate_refusing_view(
        &prepare(&whole(
            &["docs"],
            &caught_with_message("docs::search(docs::SearchOptions::default())"),
        )),
        refusal(
            ToolFailure::InvalidArgument,
            "`docs::search` needs a query, a module, a type or a kind; it narrows nothing as it is",
        ),
    );
    assert_eq!(
        logs(&outcome),
        [
            "InvalidArgument on search: `docs::search` needs a query, a module, a type or a kind; it narrows nothing as it is"
        ]
    );
}

#[test]
fn a_documentation_search_limit_of_zero_is_an_argument_error() {
    // The one number in the call whose zero is not a clamp: a larger limit than the ceiling clamps
    // rather than fails, so a program could read the refusal as "any limit is advisory" if this did
    // the same.
    let (outcome, _log) = evaluate_refusing_view(
        &prepare(&whole(
            &["docs"],
            &caught_with_message(
                r#"docs::search(docs::SearchOptions { query: Some("open"), limit: Some(0), ..Default::default() })"#,
            ),
        )),
        refusal(
            ToolFailure::InvalidArgument,
            "`limit` must be at least 1; leave it out for the default page of 20",
        ),
    );
    assert_eq!(
        logs(&outcome),
        [
            "InvalidArgument on search: `limit` must be at least 1; leave it out for the default page of 20"
        ]
    );
}

#[test]
fn closing_a_documentation_view_without_the_capability_is_unavailable() {
    // This arm cannot withhold a NAME: `docs::close` is compiled into every program, so the host is
    // the only thing that can refuse it — under the call's own key, rather than as a name that was
    // never in scope.
    let (outcome, _log) = run_with(
        &whole(&["docs"], &caught(r#"docs::close("gg::views::open_text")"#)),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Unavailable on close"]);
}

#[test]
fn closing_every_documentation_view_without_the_capability_is_unavailable() {
    let (outcome, _log) = run_with(
        &whole(&["docs"], &caught("docs::close_all()")),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["Unavailable on close_all"]);
}

#[test]
fn closing_a_documentation_view_that_is_not_open_is_zero() {
    // Refused, the count a program reads is never lowered: nothing is open here, and `0` is a
    // success exactly as it is in production for a key that is not open.
    let (granted, _log) = evaluate_closing_docviews(
        &prepare(&whole(
            &["docs"],
            r####"    gg::log(docs::close("gg::views::open_text")?.to_string());
"####,
        )),
        canned_outcome,
    );
    assert_eq!(logs(&granted), ["0"]);
}

#[test]
fn closing_every_documentation_view_when_none_is_open_is_zero() {
    let (granted, _log) = evaluate_closing_docviews(
        &prepare(&whole(
            &["docs"],
            r####"    gg::log(docs::close_all()?.to_string());
"####,
        )),
        canned_outcome,
    );
    assert_eq!(logs(&granted), ["0"]);
}

// --- views -----------------------------------------------------------------------------------

#[test]
fn a_file_view_hands_the_program_the_window_and_records_the_view() {
    // The value and the view are separate copies of one read: the program reads the window in the
    // turn that asked for it, and the same window is in the next prompt under the path.
    let (outcome, log) = run_with(
        &whole(
            &["files", "views"],
            r####"    let shown = views::ViewOptions { offset: Some(1), limit: Some(2), ..Default::default() };
    match views::open_file("notes.md", shown)? {
        files::FileRead::Text(file) => gg::log(format!(
            "{} {} {}",
            file.contents.lines().next().unwrap_or_default(), file.first_line, file.total_lines
        )),
        files::FileRead::Image(picture) => gg::log(picture.label),
    }
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["contents of notes.md 1 2"]);
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes.md"]
    );
    // One read reached gg's dispatch, and it arrived as `read_file`: a view has no tool name of its
    // own, which is exactly the point — it is a read gg also shows.
    assert_eq!(log.names(), ["read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );
}

#[test]
fn a_file_view_of_a_path_that_is_not_there_opens_nothing() {
    // The refusal is the one thing this feature must never let happen quietly: the material never
    // reached the window, so a view that failed is reported rather than left as a silence the model
    // would read as evidence its program never ran.
    let (outcome, _log) = fails_with(
        &whole(
            &["views"],
            &caught(r#"views::open_file("gone.md", views::ViewOptions::default())"#),
        ),
        ToolFailure::NotFound,
        "no such file: gone.md",
    );
    assert_eq!(logs(&outcome), ["NotFound on open_file"]);
    assert!(outcome.views_opened.is_empty(), "nothing was opened");
    assert_eq!(outcome.view_refusals, ["no such file: gone.md"]);
}

#[test]
fn a_view_offset_past_the_end_of_the_file_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(
            &["views"],
            &caught_with_message(
                r#"views::open_file("notes.md", views::ViewOptions { offset: Some(900), ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "`offset` 900 is past the end of notes.md, which has 2 lines",
    );
    assert_eq!(
        logs(&outcome),
        [
            "InvalidArgument on open_file: `offset` 900 is past the end of notes.md, which has 2 lines"
        ]
    );
}

#[test]
fn a_view_line_cut_of_zero_is_an_argument_error() {
    // Unlike a zero `offset`, which plainly means the first line, a zero line cut names nothing —
    // so it is refused by name rather than normalised into "leave every line whole".
    let (outcome, log) = fails_with(
        &whole(
            &["views"],
            &caught(
                r#"views::open_file("notes.md", views::ViewOptions { max_line_chars: Some(0), ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "`max_line_chars` must be between 1 and 65536",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on open_file"]);
    assert_eq!(
        log.args("read_file")
            .map(|args| args["maxLineChars"].clone()),
        Some(json!(0)),
        "the zero reached the host rather than being dropped on the way"
    );
}

#[test]
fn a_view_line_cut_over_the_ceiling_is_an_argument_error() {
    let (outcome, _log) = fails_with(
        &whole(
            &["views"],
            &caught(
                r#"views::open_file("notes.md", views::ViewOptions { max_line_chars: Some(70000), ..Default::default() })"#,
            ),
        ),
        ToolFailure::InvalidArgument,
        "`max_line_chars` must be between 1 and 65536",
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on open_file"]);
}

#[test]
fn a_file_view_over_the_size_cap_names_the_size_and_the_bound() {
    // Nothing is ever silently truncated: a window that would carry more than the view body's cap
    // is refused, and the sentence carries both numbers so the program can pick a smaller window
    // rather than guess at one.
    let (outcome, _log) = fails_with(
        &whole(
            &["views"],
            &caught_with_message(r#"views::open_file("huge.md", views::ViewOptions::default())"#),
        ),
        ToolFailure::LimitExceeded,
        "the window is 131,072 bytes; a view body is capped at 65,536",
    );
    assert_eq!(
        logs(&outcome),
        [
            "LimitExceeded on open_file: the window is 131,072 bytes; a view body is capped at 65,536"
        ]
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_file_view_with_the_read_withheld_is_unavailable() {
    // It shares the read gate with `files::read_file`, so a run that did not buy reading cannot buy
    // showing either — and the refusal names `views::open_file`, which is the call the model wrote.
    let (outcome, log) = run_with(
        &whole(
            &["views"],
            &caught_with_message(r#"views::open_file("notes.md", views::ViewOptions::default())"#),
        ),
        &all_operations_without(CAPABILITY_READ_FILE),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["Unavailable on open_file: `gg::views::open_file` is not available."]
    );
    assert!(log.names().is_empty());
}

#[test]
fn opening_one_path_twice_supersedes_rather_than_duplicating() {
    // Re-opening the same page replaces what it showed, and the turn's feedback says so — which is
    // what lets a program refresh a view in a loop without the window growing a copy each time.
    let (outcome, _log) = run_with(
        &whole(
            &["views"],
            r####"    views::open_file("notes.md", views::ViewOptions::default())?;
    views::open_file("notes.md", views::ViewOptions::default())?;
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    let opened: Vec<(&str, bool)> = outcome
        .views_opened
        .iter()
        .map(|view| (view.selector.as_str(), view.superseded))
        .collect();
    assert_eq!(opened, [("notes.md", false), ("notes.md", true)]);
}

#[test]
fn a_text_view_puts_what_the_program_computed_in_the_window() {
    let (outcome, log) = run_with(
        &whole(
            &["views"],
            r####"    views::open_text("summary", "eight files, two failing")?;
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert!(logs(&outcome).is_empty());
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["summary"]
    );
    assert!(
        log.names().is_empty(),
        "showing the model a value dispatches no gg tool"
    );
}

#[test]
fn a_text_view_is_shown_by_a_program_granted_nothing() {
    // The other `Always` binding, and the reason it is one: a run that offered no capability at all
    // would otherwise be a run whose model can compute something and show it to nobody.
    let (outcome, _log) = run_with(
        &whole(
            &["views"],
            r####"    views::open_text("summary", "eight files, two failing")?;
"####,
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["summary"]
    );
}

#[test]
fn an_empty_text_view_label_is_an_argument_error() {
    // A view is filed under its label, so a view with no label is a view nothing could ever name to
    // close it.
    let (outcome, _log) = run_with(
        &whole(
            &["views"],
            &caught(r#"views::open_text("", "eight files")"#),
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on open_text"]);
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_text_view_body_over_the_cap_names_the_cap() {
    let (outcome, _log) = evaluate_refusing_view(
        &prepare(&whole(
            &["views"],
            &caught_with_message(r#"views::open_text("summary", "eight files, two failing")"#),
        )),
        refusal(
            ToolFailure::LimitExceeded,
            "the body is 98,304 characters; a text view is capped at 65,536",
        ),
    );
    assert_eq!(
        logs(&outcome),
        [
            "LimitExceeded on open_text: the body is 98,304 characters; a text view is capped at 65,536"
        ]
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_text_view_label_over_the_cap_names_its_own_cap() {
    // A cap of its own, and a much smaller one: the label is a selector rather than material, and a
    // program told only "over the cap" would shorten the wrong half of the call.
    let (outcome, _log) = evaluate_refusing_view(
        &prepare(&whole(
            &["views"],
            &caught_with_message(r#"views::open_text("summary", "eight files, two failing")"#),
        )),
        refusal(
            ToolFailure::LimitExceeded,
            "the label is 400 characters; a view label is capped at 200",
        ),
    );
    assert_eq!(
        logs(&outcome),
        ["LimitExceeded on open_text: the label is 400 characters; a view label is capped at 200"]
    );
}

#[test]
fn a_documentation_view_is_recorded_under_the_name_it_opened() {
    // Every view the call placed is recorded, which is why the api answers with a list: one call can
    // place a function's view and one per type in its signature, and the turn's feedback has to
    // report the window the model actually got.
    let (outcome, log) = run_with(
        &whole(
            &["views"],
            r####"    views::open_docs_view("read_file")?;
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["read_file"]
    );
    assert!(log.names().is_empty());
}

#[test]
fn a_documentation_view_is_opened_by_a_program_granted_nothing() {
    let (outcome, _log) = run_with(
        &whole(
            &["views"],
            r####"    views::open_docs_view("gg::views::open_text")?;
"####,
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["gg::views::open_text"]
    );
}

#[test]
fn a_documentation_view_of_an_unknown_name_is_not_found() {
    let (outcome, _log) = evaluate_refusing_view(
        &prepare(&whole(
            &["views"],
            &caught_with_message(r#"views::open_docs_view("open_tex")"#),
        )),
        refusal(
            ToolFailure::NotFound,
            "no documentation entry is keyed by `open_tex`",
        ),
    );
    assert_eq!(
        logs(&outcome),
        ["NotFound on open_docs_view: no documentation entry is keyed by `open_tex`"]
    );
    assert!(outcome.views_opened.is_empty());
}

#[test]
fn a_documentation_view_of_a_name_this_agent_does_not_bind_points_at_the_search() {
    // Unknown and unbound are one class deliberately: what the model has to do next is the same in
    // both cases, and the sentence names the one call that enumerates what it does hold.
    let (outcome, _log) = evaluate_refusing_view(
        &prepare(&whole(
            &["views"],
            &caught_with_message(r#"views::open_docs_view("gg::shell::run")"#),
        )),
        refusal(
            ToolFailure::NotFound,
            "`gg::shell::run` is not part of this session's surface; `docs::search` lists what is",
        ),
    );
    assert_eq!(
        logs(&outcome),
        [
            "NotFound on open_docs_view: `gg::shell::run` is not part of this session's surface; `docs::search` lists what is"
        ]
    );
}

#[test]
fn closing_a_view_reports_how_many_it_closed() {
    let (outcome, _log) = run_with(
        &whole(
            &["views"],
            r####"    views::open_text("summary", "eight files, two failing")?;
    gg::log(views::close("summary")?.to_string());
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["1"]);
    assert_eq!(outcome.views_closed, ["summary"]);
}

#[test]
fn closing_a_selector_nothing_is_open_under_is_zero_rather_than_a_failure() {
    // So a program that tidies up unconditionally does not have to guard every call.
    let (outcome, _log) = run_with(
        &whole(
            &["views"],
            r####"    gg::log(views::close("never opened")?.to_string());
"####,
        ),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["0"]);
    assert!(
        outcome.views_closed.is_empty(),
        "a close that closed nothing is not a close"
    );
}

#[test]
fn an_empty_close_selector_is_an_argument_error() {
    // An empty selector names nothing rather than everything, which is the reading that would make
    // a typo empty the whole window.
    let (outcome, _log) = run_with(
        &whole(&["views"], &caught(r#"views::close("")"#)),
        &all_operations(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["InvalidArgument on close"]);
}

#[test]
fn closing_a_view_without_agent_managed_context_is_unavailable() {
    let (outcome, _log) = run_with(
        &whole(
            &["views"],
            &caught_with_message(r#"views::close("summary")"#),
        ),
        &all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["Unavailable on close: `gg::views::close` is not available."]
    );
}

// --- session ---------------------------------------------------------------------------------

#[test]
fn the_standard_endings_summary_reaches_the_outcome() {
    let (outcome, log) = run_as(
        &whole(
            &["session"],
            r####"    session::finish("read the file and showed the result")?;
    gg::log("the program did not stop");
"####,
        ),
        RunEnding::Role(EndingRole::Standard),
    );
    assert_eq!(logs(&outcome), ["the program did not stop"]);
    let completion = outcome.completion.as_ref().expect("the session ended");
    assert_eq!(
        completion.ending,
        Ending::Finished {
            summary: "read the file and showed the result".to_string()
        }
    );
    assert_eq!(completion.superseded, 0);
    assert!(log.names().is_empty(), "an ending dispatches no gg tool");
}

#[test]
fn a_blank_ending_summary_is_an_argument_error() {
    // The summary becomes the session's whole answer to whoever asked for the work, so "I am done
    // and have nothing to say about it" is not an ending gg accepts on the model's behalf.
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            &caught_with_message(r#"session::finish("   ")"#),
        ),
        RunEnding::Role(EndingRole::Standard),
    );
    assert_eq!(logs(&outcome).len(), 1);
    assert!(
        logs(&outcome)[0].starts_with(
            "InvalidArgument on finish: `gg::session::finish` requires a non-empty summary"
        ),
        "{:?}",
        logs(&outcome)
    );
    assert!(outcome.completion.is_none(), "nothing ended the session");
}

#[test]
fn a_second_ending_replaces_the_first_and_the_replacement_is_counted() {
    // With no unwind, ending twice is an ordinary thing for a program to do — two branches that both
    // run, an ending inside a loop — and the later declaration is the one made with more of the
    // program's work behind it. The count is kept because it is worth a line on the operator's
    // stream.
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            r####"    session::finish("parsed the manifest")?;
    session::finish("parsed the manifest and wrote the tests")?;
"####,
        ),
        RunEnding::Role(EndingRole::Standard),
    );
    let completion = outcome.completion.as_ref().expect("the session ended");
    assert_eq!(
        completion.ending,
        Ending::Finished {
            summary: "parsed the manifest and wrote the tests".to_string()
        }
    );
    assert_eq!(completion.superseded, 1);
}

#[test]
fn an_ending_from_a_program_that_then_fails_is_revoked() {
    // The declaration rests on checks the program never finished running, so it goes with everything
    // else that program decided — and the turn's feedback can say the ending was cancelled and what
    // it was.
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            r####"    session::finish("parsed the manifest")?;
    panic!("the work after the ending failed");
"####,
        ),
        RunEnding::Role(EndingRole::Standard),
    );
    assert!(trap(&outcome).contains("the work after the ending failed"));
    assert!(outcome.completion.is_none(), "the session did not end");
    assert_eq!(
        outcome.revoked_completion,
        Some(Ending::Finished {
            summary: "parsed the manifest".to_string()
        })
    );
}

#[test]
fn an_ending_a_reviewer_may_not_declare_names_the_two_it_may() {
    // An agent that reached for the wrong ending has a right one, and being told which is the
    // difference between a turn it recovers from and a turn it spends guessing.
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            &caught_with_message(r#"session::finish("read the file")"#),
        ),
        RunEnding::Role(EndingRole::Review),
    );
    assert_eq!(
        logs(&outcome),
        [
            "Unavailable on finish: `gg::session::finish` is not available. Use `gg::session::approve` or `gg::session::request_changes` instead."
        ]
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn an_approval_from_a_standard_session_is_unavailable() {
    let (outcome, _log) = run_as(
        &whole(&["session"], &caught_with_message("session::approve()")),
        RunEnding::Role(EndingRole::Standard),
    );
    assert_eq!(
        logs(&outcome),
        [
            "Unavailable on approve: `gg::session::approve` is not available. Use `gg::session::finish` instead."
        ]
    );
}

#[test]
fn a_reviewers_approval_reaches_the_outcome() {
    // The one call in the whole surface that takes nothing at all.
    let (outcome, _log) = run_as(
        &whole(&["session"], "    session::approve()?;\n"),
        RunEnding::Role(EndingRole::Review),
    );
    assert_eq!(
        outcome.completion.as_ref().map(|done| &done.ending),
        Some(&Ending::Approved)
    );
}

#[test]
fn a_reviewers_change_request_reaches_the_outcome_with_every_item() {
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            r####"    session::request_changes(&["widen the test", "name the file"])?;
"####,
        ),
        RunEnding::Role(EndingRole::Review),
    );
    assert_eq!(
        outcome.completion.as_ref().map(|done| &done.ending),
        Some(&Ending::ChangesRequested {
            items: vec!["widen the test".to_string(), "name the file".to_string()],
        })
    );
}

#[test]
fn an_empty_change_list_is_an_argument_error() {
    // The list is dispatched verbatim to the agent that must fix the work, so a rejection with
    // nothing in it would send that agent back to re-read criteria it already believed it had met.
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            &caught_with_message("session::request_changes(&[])"),
        ),
        RunEnding::Role(EndingRole::Review),
    );
    assert!(
        logs(&outcome)[0].starts_with(
            "InvalidArgument on request_changes: `gg::session::request_changes` requires at least one change"
        ),
        "{:?}",
        logs(&outcome)
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn a_change_list_whose_entries_are_all_blank_is_an_argument_error() {
    // A distinct cause from the empty list and the same refusal: blank entries are dropped, and what
    // is left is nothing — so a reviewer whose loop built a list of empty strings is told the same
    // thing as one that built no list at all, rather than having the whitespace dispatched.
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            &caught_with_message(r#"session::request_changes(&["   ", ""])"#),
        ),
        RunEnding::Role(EndingRole::Review),
    );
    assert!(
        logs(&outcome)[0].starts_with(
            "InvalidArgument on request_changes: `gg::session::request_changes` requires at least one change"
        ),
        "{:?}",
        logs(&outcome)
    );
    assert!(outcome.completion.is_none());
}

#[test]
fn a_change_request_from_a_standard_session_is_unavailable() {
    let (outcome, _log) = run_as(
        &whole(
            &["session"],
            &caught_with_message(r#"session::request_changes(&["widen the test"])"#),
        ),
        RunEnding::Role(EndingRole::Standard),
    );
    assert_eq!(
        logs(&outcome),
        [
            "Unavailable on request_changes: `gg::session::request_changes` is not available. Use `gg::session::finish` instead."
        ]
    );
}

// --- feedback --------------------------------------------------------------------------------
//
// The caps themselves — a line over the per-line ceiling, more lines than the line ceiling, and
// lines past the byte ceiling — are driven from this arm's programs in
// [`feedback`](super::feedback), which is the file that carries the same eight
// rows for every arm. What is here is the rest of the channel: what `gg::log` accepts, what the
// channel beside it does not carry, and the three outcome fields this arm never fills.

#[test]
fn a_value_that_is_not_a_string_reaches_the_operator_log_through_its_display() {
    // `gg::log` takes `impl Display` rather than `&str`, which is what lets a program log the value
    // it already has instead of formatting one first — so the thing to prove is that the
    // implementation the PROGRAM wrote is what the operator reads.
    let (outcome, _log) = run_with(
        &whole(
            &[],
            r####"    struct Progress { done: u32, total: u32 }

    impl std::fmt::Display for Progress {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(formatter, "{} of {}", self.done, self.total)
        }
    }

    gg::log(Progress { done: 8, total: 12 });
    gg::log(42);
"####,
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["8 of 12", "42"]);
}

#[test]
fn standard_output_reaches_nobody_and_the_logged_line_is_kept() {
    // gg attaches no standard output to the guest, so a `println!` succeeds and its bytes are kept
    // by nothing. That is the whole reason `gg::log` exists, and the failure it guards against is
    // silent: a program that reported its work with `println!` would look, from every record gg
    // keeps, like a program that reported nothing.
    let (outcome, _log) = run_with(
        &whole(
            &[],
            r####"    println!("nobody reads this");
    gg::log("this is the channel");
"####,
        ),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["this is the channel"]);
}

#[test]
fn a_program_that_logs_and_returns_uses_no_other_channel() {
    // The three the arm never fills, pinned rather than exercised: this arm's shell reaches the
    // model's own `main` through the platform entry symbol and propagates its status, so there is no
    // return value for gg to discard, no microtask to run after the program, and no module to fail
    // to load. A future shell that grew one of them would be reported to the model as a fact about
    // its program, and this is what would say so first.
    let (outcome, _log) = run_with(
        &whole(&[], "    gg::log(\"did the work\");\n"),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["did the work"]);
    assert!(
        !outcome.returned_value,
        "a Rust `main` returns no value gg discards"
    );
    assert_eq!(outcome.deferred_note, None);
    assert!(outcome.module_errors.is_empty());
}
