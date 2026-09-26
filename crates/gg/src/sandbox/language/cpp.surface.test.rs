//! **The C++ arm's model-facing surface**, driven end to end through the real toolchain and the
//! real membrane: the hand-written SDK, the catalogue reflected out of its own documentation, and
//! the library set this arm says a program may include.
//!
//! # Why these are not in the substrate file
//!
//! Because they are a different claim. [`substrate`](super::substrate) asks whether C++ runs here.
//! This asks whether the thing a model is **told** it may write is the thing the sandbox really has
//! — which is the only question a cross-language study rests on, and the one whose failure is
//! silent: an SDK and a catalogue that agree with each other and with nothing else are two green
//! test suites and an invalidated experiment.
//!
//! # How they are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in it costs a
//! real `clang++` and the component it produced. A function groups the programs that exercise
//! one behaviour, so they share that cost; one that grows into the slow end of the suite is
//! split rather than extended.
//!
//! # What holds this arm's coverage against the others
//!
//! Not this file.
//! `operations.test.rs::every_operation_is_offered_by_every_arm_that_is_not_excused` asserts it
//! against **gg's own operations table** rather than against any one other arm, and the
//! [agreement gate](super::agreement) runs over this arm as over every registered one.

use serde_json::{Value, json};

use super::substrate::{evaluate, evaluate_closing_docviews, evaluate_with_api, logs, prepare};
use crate::ending::{Ending, EndingRole};
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY,
    GgProgramLanguage,
};

use crate::docs::DocKind;
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_operations, all_operations_without, canned_outcome,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::membrane::capture::{MAX_LOG_LINE_BYTES, MAX_LOG_LINES};
use crate::sandbox::operations::{OperationId, PROGRAMS_GET};
use crate::sandbox::outcome::SandboxOutcome;
use crate::tools::{
    ApiData, ArchiveSearchData, ReclaimData, SubagentResultData, ToolFailure, ToolOutcome,
};

/// The catalogue this arm's build reflects, read as a **document** rather than through
/// [`SignatureCatalogue`](crate::sandbox::signatures) — deliberately, and on this arm necessarily.
///
/// Deliberately, because the parsed reading is a *projection* and a field the parser does not model
/// is one these tests could not notice was missing. Necessarily, because this arm is not
/// [registered](super::super::ProgramLanguage) yet: `language: "cpp"` is not a
/// [`GgProgramLanguage`](test_cabinet_core::gg::GgProgramLanguage) anything can deserialise into
/// until it is, and the catalogue lands first so the surface it describes can be reviewed before it
/// is switched on.
const SIGNATURES: &str = include_str!(concat!(env!("OUT_DIR"), "/signatures/cpp.signatures.json"));

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

/// A whole program out of a body of statements, which is what C++ needs and no other arm does.
///
/// It is the one place these tests add anything to what a model would write, and what it adds is
/// what a model's own reply has to carry: the `#include` lines for the names the body writes, and the
/// entry point C++ has no top level to do without. The umbrella header rather than the thirteen
/// module ones, because the bodies below reach across most of them and a per-body include list would
/// be a second copy of what each one calls.
///
/// **The standard headers are on that list now**, and that is the
/// [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) rather than a
/// preference: nothing is put in front of a C++ program on this arm, so `std::format` is undeclared
/// until a program says `#include <format>`. These four are what the bodies below name between them;
/// a body reaching further writes its own list through [`program_with`].
fn program(body: &str) -> String {
    program_with(&["<cstdint>", "<format>", "<string>", "<variant>"], body)
}

/// [`program`] for a body that reaches further than the shared four — the standard headers first,
/// then gg's umbrella, which is the order this arm's own SDK writes its includes in.
fn program_with(headers: &[&str], body: &str) -> String {
    let includes: String = headers
        .iter()
        .map(|header| format!("#include {header}\n"))
        .collect();
    format!("{includes}\n#include <gg.hpp>\n\nint main() {{\n{body}\n  return 0;\n}}\n")
}

/// Compile and run one C++ program with `enabled`'s operations offered and no ending group.
fn run_with(
    body: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(&program(body)),
        operations,
        RunEnding::None,
        false,
        responder,
    )
}

// ---------------------------------------------------------------------------------------------
// Every operation, from its C++ spelling
// ---------------------------------------------------------------------------------------------

/// One operation, called through the C++ spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound operation, called through its idiomatic C++ function.
///
/// Deliberately the same table the other arms' surface tests drive theirs with, down to the
/// arguments and the expected JSON — because the expected JSON is the point. gg's dispatch is
/// language-independent: ten arms writing the same call in their own idioms must produce
/// **byte-identical** arguments, or they are not running the same experiment. A designated
/// initialiser lowered onto the wrong wire slot, a `gg::tasks::text_edit::clear()` read as "leave it alone"
/// instead of "clear it", an enumerator whose wire word did not translate — none of them is a
/// compile error in any of the ten, and all of them are visible here.
///
/// What differs from every other arm's table is the **designated initialiser**, which is C++20's own
/// answer to a call with several optional parts: `{.limit = 40}` names the one field it sets and
/// says nothing about the rest, where a defaulted parameter cannot be skipped over in a language
/// with no keyword arguments.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: r#"gg::shell::run("npm test", 30.0);"#,
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: r#"gg::files::read_file("src/a.cpp", {.offset = 2, .limit = 5});"#,
            expected: || json!({ "path": "src/a.cpp", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: r#"gg::files::write_file("out.txt", "hello");"#,
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: r#"gg::files::edit_file("src/a.cpp", "alpha", "beta");"#,
            expected: || json!({ "path": "src/a.cpp", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: r#"gg::files::list_dir("src");"#,
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            statement: r#"gg::files::tree({.path = "src", .depth = 3});"#,
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            statement: r#"gg::files::search("answer", {.path = "src", .limit = 10});"#,
            expected: || json!({ "query": "answer", "path": "src", "limit": 10 }),
        },
        Crossing {
            tool: "read_skill",
            statement: r#"gg::skills::read_skill("testing");"#,
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: r#"gg::memories::write_memory("layout", "d", "b");"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: r#"gg::memories::update_memory("layout", "d2", "b2");"#,
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, and the one that fills in a single
            // field of an options aggregate by name and leaves the other at its default.
            statement: r#"gg::memories::create_memory("layout", "d", "b",
                                                {.code = "int one() { return 1; }"});"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "int one() { return 1; }", "onUse": null })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: r#"gg::memories::read_memory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: r#"gg::memories::edit_memory("layout", "old", "new");"#,
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: r#"gg::memories::search_memories({"cargo", "nextest"});"#,
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: r#"gg::memories::delete_memory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: r#"gg::tasks::add_task("t1", "T", {.description = "D", .blocked_by = {"t0"}});"#,
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: r#"gg::tasks::update_task("t1", {.title = "T2",
                                                   .description = gg::tasks::text_edit::clear(),
                                                   .status = gg::tasks::task_status::in_progress});"#,
            expected: || {
                // `gg::tasks::text_edit::clear()` is what CLEARS it — a default-constructed `text_edit` is what
                // leaves it alone — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: r#"gg::tasks::set_blocked_by("t1", {});"#,
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: r#"gg::tasks::complete_task("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: r#"gg::tasks::remove_task("t1");"#,
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: r#"gg::board::create_epic("epc", "E", "D");"#,
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: r#"gg::board::create_issue("I", "s", "o", "c", "worker",
                                                {.reviewers = {"critic"}});"#,
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
            statement: r#"gg::board::update_issue("i1", {.status = gg::board::issue_status::done,
                                                      .epic = gg::board::epic_assignment::ungroup()});"#,
            expected: || {
                // `gg::board::epic_assignment::ungroup()` ungroups the issue, which gg's schema spells as the
                // empty string; a description the patch left default keeps the one it has, so its
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
            statement: r#"gg::board::set_issue_blocked_by("i1", {"i0"});"#,
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: r#"gg::board::remove_epic("e1");"#,
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: r#"gg::board::remove_issue("i1");"#,
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: r#"gg::board::wait_for_issue("i1");"#,
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: r#"gg::context::evict_file_view("src/a.cpp");"#,
            expected: || json!({ "path": "src/a.cpp" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is an ordinary aggregate here, so a list of them is a list of braced
            // pairs. C++ has no value type for a closed integer range — `std::ranges::iota_view` is
            // a sequence, which a span of turn numbers is not — so this is the one place the arm
            // spells with a record what Rust spells with `4..=19`.
            statement: r#"gg::context::archive_thread({{4, 19}, {30, 35}});"#,
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: r#"gg::context::search_archive("the parser");"#,
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: r#"gg::context::compact("scaffolded the page", {"src/main.cpp"});"#,
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/main.cpp"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is one value with two named factories rather than one of two optional
            // arguments, so "both" and "neither" are programs that do not compile.
            statement: r#"gg::delegation::spawn_subagent("subagent", gg::delegation::brief::prompt("write the lexer"));"#,
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            // The one function this SDK spells as an OVERLOAD PAIR rather than a default argument,
            // because "every outstanding child" and "these children" are two calls in C++ and an
            // `std::optional<std::vector<…>>` would have made the common one write `std::nullopt`.
            statement: r#"gg::delegation::wait_for_subagents({"agent-1"});"#,
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: r#"gg::delegation::send_message("agent-1", "prefer the simpler parser");"#,
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: r#"gg::delegation::transition_state("verify", "the build is green");"#,
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: r#"gg::delegation::exec("Builder", "pick it up from here");"#,
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: r#"gg::delegation::fork("try the other fix");"#,
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_operation_crosses_the_membrane_from_its_cpp_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: a compile here is ~90 ms warm, so thirty-five of
    // them would be three seconds of `clang++` for a table that reads the same. It is also the
    // stronger check — the calls must arrive in the order the program made them, so a call that
    // reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    let body = crossings
        .iter()
        .map(|crossing| format!("  {}\n", crossing.statement))
        .collect::<String>();
    let (outcome, log) = run_with(&body, &all_operations(), canned_outcome);
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
fn the_view_object_the_helper_and_the_standard_ending_are_reached_in_cpp_too() {
    // Three of the families that are NOT gg tools, so none of them appears in the crossing table
    // above — and they are where a program puts something in front of the model and finds out what
    // it may call at all, which makes them the ones a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(&program(
            r####"
  const auto read = gg::views::open_file("notes.md", {.offset = 1, .limit = 2});
  gg::views::open_text("summary", "eight files, two failing");
  gg::views::open_docs_view("read_file");
  const std::uint32_t closed = gg::views::close("summary");
  const std::uint32_t missing = gg::views::close("never opened");
  gg::log(std::format("{} {}", closed, missing));
  const std::string shown = std::holds_alternative<gg::files::text_file>(read)
                                ? std::get<gg::files::text_file>(read).contents
                                : std::get<gg::files::image_file>(read).label;
  gg::log(shown.substr(0, shown.find('\n')));
  const auto found = gg::docs::search(
      {.query = "open", .modules = {"views"}, .kind = gg::docs::doc_kind::function, .limit = 5});
  gg::log(std::format("{} {} {}", found.total, found.offset, found.hits.size()));
  try {
    gg::log(std::format("closed {}", gg::docs::close("gg::views::open_text")));
  } catch (const gg::core::api_error &failure) {
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.operation()));
  }
  try {
    gg::log(std::format("closed {}", gg::docs::close_all()));
  } catch (const gg::core::api_error &failure) {
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.operation()));
  }
  gg::session::finish("read the file and showed myself the result");
"####,
        )),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
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
    // arm. The ranking over a real catalogue is the documentation runtime's own to prove.
    assert_eq!(lines[2], "0 0 0");
    // Closing documentation is the one part of this family a run buys, and this run did not: the
    // program is refused by the host, as the exception a C++ author catches, under the call's own
    // name rather than by a name that was never in scope — a compiled arm cannot withhold a name.
    assert_eq!(lines[3], "unavailable on close");
    assert_eq!(lines[4], "unavailable on close_all");
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
    // their answer at all: refused, the count a program reads is never lifted. The double holds no
    // window, so nothing is open and `0` is the honest number — a success, exactly as it is in
    // production for a key that is not open.
    let (granted, _log) = evaluate_closing_docviews(
        &prepare(&program(
            r####"
  gg::log(std::format("{} {}", gg::docs::close("gg::views::open_text"), gg::docs::close_all()));
"####,
        )),
        canned_outcome,
    );
    assert_eq!(logs(&granted), ["0 0"]);

    // One read reached gg's dispatch and arrived as `read_file`: the one `gg::views::open_file`
    // performs. It has no tool name of its own, which is exactly the point — a view is a read gg
    // also shows you.
    assert_eq!(log.names(), ["read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );
}

#[test]
fn the_program_library_and_a_reviewers_verdict_are_reached_in_cpp_too() {
    // The program library is bound from the CAPABILITY rather than from a tool name, and a reviewer
    // gets the other ending group. Between this and the two functions above, every function this
    // arm's catalogue describes has been driven through the real membrane.
    let (outcome, _log) = evaluate(
        &prepare(&program(
            r####"
  gg::log(std::to_string(gg::programs::history().size()));
  try {
    gg::log(gg::programs::get("k3p9"));
  } catch (const gg::core::api_error &failure) {
    gg::log(std::string(gg::core::gg_name(failure.code())));
  }
  gg::programs::rerun("int main() { gg::log(\"again\"); return 0; }");
  gg::session::request_changes({"widen the test", "name the file"});
"####,
        )),
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never a failure — and an id it never
    // issued a program under is a `not_found` the program catches in C++'s own idiom.
    assert_eq!(logs(&outcome), ["0", "not-found"]);
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
        &prepare(&program("  gg::session::approve();")),
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
    // Caught: an ordinary `catch` on `gg::core::api_error` with a test on the code, which is what a program
    // that expects one failure and not the others writes. Nothing about it is exceptional —
    // `gg::core::api_error` is a `std::runtime_error`, so `catch (const std::exception&)` sees it too and no
    // SDK-specific combinator is needed to compose with the standard library's own throws.
    let (outcome, _log) = run_with(
        r####"
  try {
    gg::files::read_file("gone.cpp");
    gg::log("read it");
  } catch (const gg::core::api_error &failure) {
    if (failure.code() != gg::core::api_error_code::not_found) throw;
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.operation()));
  }
  gg::log("carried on");
"####,
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cpp".to_string())
        },
    );
    assert_eq!(logs(&outcome), ["not-found on read_file", "carried on"]);

    // Let out: gg's shell catches what escapes `main`, so an uncaught failure is a reported,
    // RECOVERABLE program error rather than a trap — and it carries the failed call's own gg code,
    // which is what the host classifies the turn by. That code is read off the `gg::core::api_error` itself:
    // an arm whose uncaught gg failure was recorded as `other` would be an arm whose error rates a
    // study could not compare with any other.
    let (outcome, _log) = run_with(
        r####"
  gg::log("before");
  gg::files::read_file("gone.cpp");
  gg::log("after");
"####,
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cpp".to_string())
        },
    );
    let error = super::substrate::program_error(&outcome);
    assert!(
        error
            .message
            .contains("`read_file` failed (not-found): no such file: gone.cpp"),
        "the model reads gg's own sentence rather than a C++ type name: {}",
        error.message
    );
    assert_eq!(
        error.kind,
        crate::sandbox::outcome::ProgramErrorKind::ToolFailure,
        "an uncaught gg failure is classified from the CODE gg's shell read off the `gg::core::api_error`;          without that it would land in `Other` beside a model that threw an `int`: {error:?}"
    );
    assert_eq!(
        outcome.logs,
        ["before"],
        "what the program logged before it failed is kept, and what came after it never ran"
    );
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // Every name in this SDK is in scope whatever a run enables, because the SDK is compiled once
    // and a run's capability set is decided per run. So a call gg withheld is a THROW carrying
    // `unavailable` rather than a compile error — the same answer every other arm's host-side gate
    // gives, reached here through a linked library that has no name to withhold.
    let (outcome, log) = run_with(
        r####"
  try {
    gg::files::write_file("out.txt", "hello");
  } catch (const gg::core::api_error &failure) {
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.operation()));
  }
  gg::log("carried on");
"####,
        &[crate::sandbox::operations::FILES_READ_FILE],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on write_file", "carried on"]);
    assert!(
        log.names().is_empty(),
        "a withheld call must never reach a tool implementation: {:?}",
        log.names()
    );
}

#[test]
fn cpp_reaches_every_library() {
    // Every header the catalogue's `libraries` section names, included and used for what it is there
    // for. The claim is not that these compile in the abstract: it is that a MODEL'S PROGRAM,
    // compiled by the production prepare step against the archive this build cut, can name them.
    //
    // WHAT IT DEFENDS HAS CHANGED, and the test is worth keeping for the second thing rather than
    // the first. It used to be the guard on a hand-cut archive going stale — a committed `.a` that
    // no longer carried what the catalogue claimed, with nothing to say so. That state is not
    // reachable any more. What is still reachable, and is what this asserts, is the two halves of
    // one arm DISAGREEING at one vintage: `Sources/prelude.hpp` declares which headers this arm says
    // it makes available and the catalogue's `libraries` section is reflected separately, so a header
    // added to one and not the other is a library gg offers a model and the compile refuses.
    //
    // `prelude.hpp` is a DECLARATION and no longer a compile input. Nothing is put in front of a
    // program on this arm, so what the list means is "write the include and this header is there",
    // which is what the program at the bottom of this function measures header by header.
    let catalogue = catalogue();
    let named: Vec<&str> = section(&catalogue, "libraries")
        .iter()
        .flat_map(|group| group["modules"].as_array().expect("a group lists modules"))
        .map(|module| module.as_str().expect("a module is named by a string"))
        .collect();

    // The other direction, which nothing else closes: the set `build.sh` read out of that same file
    // into this arm's manifest. A header declared in `prelude.hpp` and left out of a group heading
    // would be a library this arm ships and never mentions.
    let mut declared: Vec<String> = named
        .iter()
        .map(|module| module.trim_matches(['<', '>']).to_string())
        .collect();
    declared.sort();
    let mut shipped: Vec<String> = super::compile::prelude_headers()
        .map(str::to_string)
        .collect();
    shipped.sort();
    assert_eq!(
        declared, shipped,
        "the set a model is told it may include and the set `prelude.hpp` declares differ"
    );

    // And a program that reaches for a representative of each group, written the way a model writes
    // one: an `#include` line of its own for every library it names, gg's among them. That is what
    // "the catalogue advertises this header" now costs a program and it is the whole of what it
    // buys — the header resolves, compiles, links and runs, and nothing was in front of the program
    // to make it look reachable when it was not.
    let outcome = evaluate(
        &prepare(&program_with(
            &[
                "<algorithm>",
                "<chrono>",
                "<expected>",
                "<format>",
                "<map>",
                "<numbers>",
                "<random>",
                "<ranges>",
                "<regex>",
                "<sstream>",
                "<string>",
                "<utility>",
                "<vector>",
            ],
            r####"
  std::vector<int> values{3, 1, 2};
  std::ranges::sort(values);
  std::map<std::string, int> counts{{"a", 1}};
  counts["b"] = 2;
  const std::expected<int, std::string> parsed = values.front();
  std::ostringstream built;
  built << "n=" << counts.size();
  const std::regex word("[a-z]+");
  const bool matched = std::regex_search(built.str(), word);
  const auto pi = std::numbers::pi_v<double>;
  std::mt19937 engine(7);
  const auto rolled = std::uniform_int_distribution<int>(1, 6)(engine);
  const auto span = std::chrono::seconds(90) + std::chrono::minutes(1);
  gg::log(std::format("{} {} {} {} {} {} {} {}", values[0], parsed.value_or(-1), built.str(),
                  matched, (int)(pi * 100), rolled > 0, span.count(),
                  std::to_underlying(gg::files::entry_kind::directory)));
"####,
        )),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["1 1 n=2 true 314 true 150 1"]);
}

#[test]
fn cpp_tells_the_truth_about_what_is_off_the_library_set() {
    // The direction [`cpp_reaches_every_library`] does not close: what happens to a header this arm
    // does NOT list. The library set is a DECLARATION, not an allowlist — clang's
    // default include path is the whole of libc++ — so what the catalogue's library set means for a
    // header outside it is a fact about this toolchain, measured here rather than inferred from the
    // list. There are three different answers, so each is one statement here.

    // 1. A standard header off the set **resolves, compiles, links and runs**. `<iostream>` is off
    //    the set because nothing reads a program's stdout, not because it is unavailable — so a
    //    refusal built out of the set would cost a model a turn on a program that would have worked.
    let reached = evaluate(
        &prepare(
            "#include <gg.hpp>\n\n#include <iostream>\n\
             #include <sstream>\n\
             int main() {\n\
             \x20 std::ostringstream built;\n\
             \x20 built << \"off the set\";\n\
             \x20 std::cout << built.str() << std::endl;\n\
             \x20 gg::log(built.str());\n\
             \x20 return 0;\n\
             }\n",
        ),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0;
    assert_eq!(
        logs(&reached),
        ["off the set"],
        "a standard header off this arm's set must still compile and run"
    );

    // 2. `<thread>` is the header whose absence from the set is most likely to be read as
    //    unavailability, so what really happens to it is the assertion: it compiles, it links, and
    //    the failure is at RUN time — a recoverable, model-facing `system_error` carrying libc++'s
    //    own sentence, not a diagnostic and not silence. This is the arm's honest position beside
    //    Rust's, whose `std::thread::spawn` also compiles and then does nothing at all.
    let threaded = evaluate(
        &prepare(
            "#include <gg.hpp>\n\n#include <thread>\n\
             int main() {\n\
             \x20 gg::log(\"before\");\n\
             \x20 std::thread worker([] {});\n\
             \x20 worker.join();\n\
             \x20 return 0;\n\
             }\n",
        ),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0;
    let failure = super::substrate::program_error(&threaded);
    assert!(
        failure.message.contains("thread constructor failed"),
        "a `std::thread` must fail at run time with libc++'s own sentence rather than before it \
         runs: {}",
        failure.message
    );
    // Spelled the way the model would write it. gg's shell demangles the class by hand and drops
    // libc++'s inline namespace, so this is `std::system_error` and not `std::__2::system_error` —
    // a name a model asked to catch would have to be told to write back wrongly.
    assert!(
        failure.message.contains("uncaught std::system_error:"),
        "the run-time failure is a `std::system_error`, spelled the way a model would catch \
         one: {}",
        failure.message
    );
    assert_eq!(
        threaded.logs,
        ["before"],
        "the work a threaded program did before it reached the constructor was lost"
    );

    // 3. And what really is `file not found` is a header that is not the standard library's,
    //    because there is nothing here to fetch one from. A model-facing compile error at the
    //    model's own line, not a toolchain failure.
    let refused = super::compile::compile_program(
        "#include <boost/asio.hpp>\nint main() { return 0; }\n",
        &[],
        &crate::sandbox::PrepareContext::detached(),
    );
    match refused {
        Err(crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            rendered,
        ))) => {
            assert!(
                rendered.contains("file not found") && rendered.contains("main.cpp:1"),
                "a third-party header is the one thing that is `file not found`, at the model's \
                 own line: {rendered}"
            );
        }
        other => {
            panic!("a third-party header must be the model's compile error, not gg's: {other:?}")
        }
    }
}

#[test]
fn the_generated_catalogue_describes_the_surface_the_sdk_offers() {
    let catalogue = catalogue();
    assert_eq!(catalogue["schema"], 1);
    assert_eq!(catalogue["language"], "cpp");
    assert_eq!(
        text(&catalogue, "generatedFrom"),
        "packages/gg-sandbox-cpp/Sources/sdk/ (clang++ -ast-dump=json)"
    );

    // The thirteen modules, in the order a model is presented with them, each spelled as a C++
    // program writes it and introduced by the first line of its own namespace's documentation.
    assert_eq!(
        section(&catalogue, "modules")
            .iter()
            .map(|module| (text(module, "id"), text(module, "path")))
            .collect::<Vec<_>>(),
        [
            ("files", "gg::files"),
            ("shell", "gg::shell"),
            ("board", "gg::board"),
            ("tasks", "gg::tasks"),
            ("memories", "gg::memories"),
            ("views", "gg::views"),
            ("docs", "gg::docs"),
            ("context", "gg::context"),
            ("delegation", "gg::delegation"),
            ("skills", "gg::skills"),
            ("programs", "gg::programs"),
            ("session", "gg::session"),
            ("core", "gg::core"),
        ]
    );
    // **The line a program writes to reach each of them**, which on this arm is one header per
    // module and the only part of a catalogue entry the arm composes rather than reflects: clang's
    // comment AST reports which declaration a comment belongs to and says nothing about which file
    // it is in. It is asserted for every module rather than sampled, because it is copied character
    // for character into a program and a wrong one is a turn spent on `file not found`.
    assert_eq!(
        section(&catalogue, "modules")
            .iter()
            .map(|module| text(module, "import"))
            .collect::<Vec<_>>(),
        [
            "#include <gg/files.hpp>",
            "#include <gg/shell.hpp>",
            "#include <gg/board.hpp>",
            "#include <gg/tasks.hpp>",
            "#include <gg/memories.hpp>",
            "#include <gg/views.hpp>",
            "#include <gg/docs.hpp>",
            "#include <gg/context.hpp>",
            "#include <gg/delegation.hpp>",
            "#include <gg/skills.hpp>",
            "#include <gg/programs.hpp>",
            "#include <gg/session.hpp>",
            "#include <gg/core.hpp>",
        ]
    );

    // Nothing a model reads is blank, anywhere, and every name it is shown is one it could type.
    // The register and coverage gates make these checks for real over the parsed catalogue; making
    // them here is what fails at this arm's own name rather than in a gate that reads eleven.
    for entry in section(&catalogue, "functions") {
        let what = text(entry, "fqn");
        let name = text(entry, "name");
        assert!(!text(entry, "brief").is_empty(), "`{what}` has no brief");
        assert!(
            !text(entry, "brief").contains('\n'),
            "`{what}`'s brief is more than one line"
        );
        assert!(
            what.starts_with("gg::") && what.ends_with(name),
            "`{what}` is not a module-qualified name ending in the name a program calls"
        );
        assert!(
            entry["call"].is_null(),
            "on this arm the fully-qualified name IS what a program writes: {what}"
        );
        let shapes = entry["signatures"]
            .as_array()
            .expect("an entry has signatures");
        assert!(!shapes.is_empty(), "`{what}` has no signature");
        for shape in shapes {
            let signature = text(shape, "signature");
            assert!(
                signature.starts_with(name),
                "`{what}`'s signature does not start with the name a program calls: {signature}"
            );
            assert!(
                signature.contains(") -> "),
                "`{what}`'s signature does not say what it hands back: {signature}"
            );
            for parameter in shape["parameters"]
                .as_array()
                .expect("a shape has parameters")
            {
                let argument = text(parameter, "name");
                assert!(
                    !text(parameter, "doc").is_empty(),
                    "`{what}`'s `{argument}` has no description"
                );
                assert!(
                    signature.contains(argument),
                    "`{what}` documents an argument its signature does not name: {argument}"
                );
                assert_eq!(
                    parameter["kind"], "positional",
                    "C++ has no keyword arguments; `{what}`'s `{argument}` says otherwise"
                );
            }
        }
    }

    // Every type a signature mentions is declared, under a name of its own module, with its own
    // documentation and its own members'.
    let declared: Vec<&str> = section(&catalogue, "types")
        .iter()
        .map(|declaration| text(declaration, "fqn"))
        .collect();
    for declaration in section(&catalogue, "types") {
        let fqn = text(declaration, "fqn");
        assert!(
            !text(declaration, "brief").is_empty(),
            "`{fqn}` has no brief"
        );
        assert!(
            !text(declaration, "declaration").is_empty(),
            "`{fqn}` has no declaration"
        );
        assert!(
            fqn.starts_with("gg::") && fqn.ends_with(text(declaration, "name")),
            "`{fqn}` is not a module-qualified name"
        );
        for member in declaration["members"]
            .as_array()
            .expect("members is a list")
        {
            assert!(
                !text(member, "brief").is_empty(),
                "`{fqn}::{}` has no brief",
                text(member, "name")
            );
        }
    }
    for entry in section(&catalogue, "functions") {
        for referenced in entry["types"].as_array().expect("types is a list") {
            let resolved = text(referenced, "fqn");
            assert!(
                declared.contains(&resolved),
                "`{}` refers to `{resolved}`, which nothing declares",
                text(entry, "fqn")
            );
        }
    }

    // The three things this arm's spelling does that no other's does, asserted so a rewrite has to
    // mean it: a default argument written into the signature, the one overload pair, and a named
    // factory listed as a member because it is how a value of that type is built.
    let read_file = section(&catalogue, "functions")
        .iter()
        .find(|entry| text(entry, "operation") == "files.read_file")
        .expect("read_file is catalogued");
    assert_eq!(
        text(&read_file["signatures"][0], "signature"),
        "read_file(std::string_view path, gg::files::read_window window = {}) -> gg::files::file_read"
    );
    // A `std::variant` alias closes over its ALTERNATIVES, which is the one place a type reference
    // is not a member of anything: a model shown `using file_read = std::variant<gg::files::text_file,
    // gg::files::image_file>` and neither alternative has been shown nothing at all.
    assert_eq!(
        read_file["types"]
            .as_array()
            .expect("types is a list")
            .iter()
            .map(|reference| (text(reference, "spelled"), text(reference, "fqn")))
            .collect::<Vec<_>>(),
        [
            ("gg::files::read_window", "gg::files::read_window"),
            ("gg::files::file_read", "gg::files::file_read"),
            ("gg::core::api_error", "gg::core::api_error"),
            ("gg::core::api_error_code", "gg::core::api_error_code"),
            ("gg::files::text_file", "gg::files::text_file"),
            ("gg::files::image_file", "gg::files::image_file"),
        ]
    );

    let wait = section(&catalogue, "functions")
        .iter()
        .find(|entry| text(entry, "operation") == "delegation.wait_for_subagents")
        .expect("wait_for_subagents is catalogued");
    assert_eq!(
        wait["signatures"].as_array().map(Vec::len),
        Some(2),
        "the one function this SDK spells as an overload pair carries two signatures"
    );

    let text_edit = section(&catalogue, "types")
        .iter()
        .find(|declaration| text(declaration, "fqn") == "gg::tasks::text_edit")
        .expect("text_edit is catalogued");
    assert_eq!(
        text_edit["members"]
            .as_array()
            .expect("members is a list")
            .iter()
            .map(|member| text(member, "name"))
            .collect::<Vec<_>>(),
        ["text_edit()", "clear()", "set(std::string text)"],
        "a named factory is how a value of this type is built, so it is listed on the type rather \
         than as a call in its own right — it binds no gg operation"
    );
    assert!(
        text_edit["memberFunctions"]
            .as_array()
            .expect("memberFunctions is a list")
            .is_empty(),
        "a member function is a call that binds an operation, which a factory does not"
    );

    // The five member functions this arm offers, each a SECOND way to reach an operation some free
    // function binds canonically — and each listed on the type it hangs off, which is the menu a
    // model reads when it opens that type.
    let members: Vec<(&str, &str)> = section(&catalogue, "functions")
        .iter()
        .filter(|entry| !entry["aliasOf"].is_null())
        .map(|entry| (text(entry, "fqn"), text(entry, "operation")))
        .collect();
    assert_eq!(
        members,
        [
            ("gg::board::issue_created::wait", "board.wait_for_issue"),
            ("gg::memories::memory_hit::read", "memories.read_memory"),
            (
                "gg::delegation::subagent_handle::send",
                "delegation.send_message"
            ),
            ("gg::programs::program_summary::source", "programs.get"),
        ]
    );
    let handle = section(&catalogue, "types")
        .iter()
        .find(|declaration| text(declaration, "fqn") == "gg::delegation::subagent_handle")
        .expect("subagent_handle is catalogued");
    assert_eq!(
        text(&handle["memberFunctions"][0], "fqn"),
        "gg::delegation::subagent_handle::send"
    );
}

// ---------------------------------------------------------------------------------------------
// The line the program writes
// ---------------------------------------------------------------------------------------------

/// **No name gg offers resolves without a line the program wrote**, measured by compiling a program
/// that writes none and watching `clang++` refuse it.
///
/// The claim the [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) rest on
/// for this arm, and the one a reading of the sources cannot settle: gg puts its SDK's headers on
/// the compile's include path and links its bodies into every artifact, and what that buys is the
/// library *existing* rather than any name being in scope. The difference is invisible in the
/// command line and decided by the compiler, so it is asked of the compiler.
///
/// Four programs, one call each, differing only in what stands above it:
///
/// * nothing — refused, *use of undeclared identifier 'gg'*, which is what "no name is in scope"
///   looks like in this language;
/// * the module's own [import line](crate::sandbox::ModuleView::import), which is what a
///   documentation view quotes — accepted;
/// * the umbrella [`SURFACE_INCLUDE`](super::source::SURFACE_INCLUDE) — accepted;
/// * some *other* module's line — refused, and refused one step further in: `namespace gg` now
///   exists and *no member named 'views'* is in it, which is the diagnostic that proves the
///   acceptance above is that header doing the work rather than any include at all being enough.
///
/// **And the standard library under the same rule, which is the half that changed.** It used to be
/// the exception — a precompiled prelude carried it, so `std::vector` with no `#include` compiled —
/// and that was the one place a name reached a model's program without a line the model wrote. The
/// prelude is off the compile, so the two libraries now answer identically: `std` is as undeclared as
/// `gg` until the program says which header it wants, and it is the *same sentence* from the same
/// compiler that says so.
///
/// It compiles and never runs, so it instantiates no component: what a compiler refuses never
/// reaches a guest.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let compile = |source: &str| {
        super::compile::compile_program(source, &[], &crate::sandbox::PrepareContext::detached())
    };
    const CALL: &str = "int main() {\n  gg::views::open_text(\"t\", \"b\");\n  return 0;\n}\n";

    let bare = compile(CALL).expect_err("a gg name with no line above it does not compile");
    match bare {
        crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            diagnostic,
        )) => assert!(
            diagnostic.starts_with("main.cpp:2:")
                && diagnostic.contains("use of undeclared identifier 'gg'"),
            "a program naming gg's surface with no include line was refused for another reason: \
             {diagnostic}"
        ),
        other => panic!(
            "a name that is not in scope is the model's compile error, not {other:?}. gg's surface \
             is reaching a program that never asked for it."
        ),
    }

    // The line this arm's catalogue states for the module the call is filed under, read out of the
    // catalogue rather than typed here — a line that worked and a line a model is shown have to be
    // the same line.
    let stated =
        crate::sandbox::catalogue_modules(crate::sandbox::language(GgProgramLanguage::Cpp))
            .into_iter()
            .find(|module| module.id == "views")
            .and_then(|module| module.import)
            .expect("the views module states the line a program writes to reach it");
    compile(&format!("{stated}\n{CALL}"))
        .expect("the line this arm's catalogue states declares the call it is filed with");

    compile(&format!("{}\n{CALL}", super::source::SURFACE_INCLUDE))
        .expect("the umbrella header declares the whole surface");

    let wrong = compile(&format!("#include <gg/tasks.hpp>\n{CALL}"))
        .expect_err("another module's header does not declare this call");
    assert!(
        format!("{wrong:?}").contains("no member named 'views' in namespace 'gg'"),
        "including some other module's header was refused for another reason: {wrong:?}"
    );

    // And the standard library, which is now the same answer rather than the opposite one. A
    // program naming `std::vector` above no include of its own is refused, and refused with the
    // sentence the bare gg call above earned — which is the ruling stated by the compiler: this arm
    // resolves nothing a program did not ask for, its own language's library included.
    const VECTOR: &str =
        "int main() {\n  std::vector<int> values{1};\n  return (int)values.size() - 1;\n}\n";
    let unasked = compile(VECTOR).expect_err("the standard library is not in front of a program");
    match unasked {
        crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            diagnostic,
        )) => assert!(
            diagnostic.starts_with("main.cpp:2:")
                && diagnostic.contains("use of undeclared identifier 'std'"),
            "a program naming the standard library with no include line was refused for another \
             reason: {diagnostic}"
        ),
        other => panic!(
            "a name that is not in scope is the model's compile error, not {other:?}. The standard \
             library is reaching a program that never asked for it, which is the one thing the \
             prelude used to do and no longer may."
        ),
    }

    // And with the line the program has to write for itself, it compiles — so what the catalogue's
    // library set advertises is reachable, exactly as gg's own modules are.
    compile(&format!("#include <vector>\n{VECTOR}"))
        .expect("the header a program includes declares the library it names");

    // **And the same question with a code module in scope**, which is the one state in which this
    // arm has anything of gg's to put in front of a program that never asked. A module reaches gg's
    // whole surface through gg's own `#include` in its global module fragment, and the program that
    // imports it reaches the module's namespace and nothing else — so the same call is refused for
    // the same reason with a skill loaded as without one.
    let modules = [crate::sandbox::CodeModule {
        name: "csv_tools".to_string(),
        source: "std::string greeting() {\n  gg::log(\"from the module\");\n  return \
                 \"hi\";\n}\n"
            .to_string(),
    }];
    let with_module = |source: &str| {
        super::compile::compile_program(
            source,
            &modules,
            &crate::sandbox::PrepareContext::detached(),
        )
    };
    // The module's own line, written by the program: nothing declares `lib` for it either.
    let import = crate::sandbox::language(GgProgramLanguage::Cpp)
        .lib_import("csv_tools")
        .expect("this arm reaches a code module through a line a program writes");
    with_module(&format!(
        "{import}\nint main() {{\n  return (int)lib::csv_tools::greeting().size() - 2;\n}}\n"
    ))
    .expect("a module a program imports reaches gg's surface through gg's own line");
    let bound = with_module(&format!("{import}\n{CALL}"))
        .expect_err("a module in scope declares no gg name for a program");
    match bound {
        // Refused one step further in than the bare program above, and that is the module system
        // rather than a weaker answer: a name attached to the global module exists in the program's
        // translation unit and is not VISIBLE in it, which clang says by naming the include the
        // program has to write. Either way the call does not compile.
        crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            diagnostic,
        )) => assert!(
            diagnostic.starts_with("main.cpp:3:")
                && diagnostic.contains("missing '#include'")
                && diagnostic.contains("'open_text' must be declared before it is used"),
            "a program naming gg's surface with a code module in scope was refused for another \
             reason: {diagnostic}"
        ),
        other => panic!(
            "a name that is not in scope is the model's compile error, not {other:?}. gg's surface \
             is reaching a program through the code module in its scope."
        ),
    }
}

/// **The bytes `clang++` reads are the bytes the model sent**, compared byte for byte in the
/// preparation's own workspace.
///
/// The [authorship gate](super::super::authorship) asserts this across every arm from the outside.
/// This asks it of the one file that matters here and names it: `main.cpp`, the file every
/// diagnostic and every located trap on this arm is reported in. A program carrying an `#include`,
/// a comment, an odd indent and no trailing newline, so that anything that normalised, re-indented
/// or terminated the text would show.
#[test]
fn the_bytes_the_compiler_reads_are_the_bytes_the_model_sent() {
    let source = "#include <gg/views.hpp>\n\n// a comment gg has no business touching\nint main() \
                  {\n     gg::views::open_text(\"t\", \"b\");\n  return 0;\n}";
    let context = crate::sandbox::PrepareContext::detached();
    super::compile::compile_program(source, &[], &context).expect("the subject compiles");
    let workspace = context
        .opened_workspace()
        .expect("this arm's preparation opens a workspace to run a compiler in");
    let written =
        std::fs::read_to_string(workspace.join("work").join(super::compile::PROGRAM_FILE))
            .expect("the file the compiler was given is readable");
    assert_eq!(
        written, source,
        "gg wrote something other than the model's own text into the file clang++ read"
    );
}

/// **The file-view program gg synthesizes is a program this arm compiles.**
///
/// gg pushes it into an agent's transcript as an assistant turn — every file a test case provided,
/// or one restored view — and a model reads its own transcript as the example of what a well-formed
/// reply looks like. Nothing on the turn path compiles it, so a text that could not have been sent
/// would teach the wrong shape and never fail anything, which is what this is for. On this arm that
/// is two things at once: the include, and the entry point a statement list has not got.
#[test]
fn the_file_view_program_gg_synthesizes_is_a_program_that_compiles() {
    let arm = crate::sandbox::language(GgProgramLanguage::Cpp);
    let window = crate::sandbox::FileWindow {
        offset: 400,
        limit: 200,
    };
    let program = arm.open_file_program(&[("src/main.cpp", None), ("docs/spec.md", Some(window))]);
    assert!(
        super::source::defines_main(&program),
        "the synthesized file-view program defines no entry point:\n{program}"
    );
    super::compile::compile_program(&program, &[], &crate::sandbox::PrepareContext::detached())
        .unwrap_or_else(|failure| {
            panic!("gg pushes a C++ program that does not compile into the transcript: {failure}\n\n{program}")
        });
}

// ---------------------------------------------------------------------------------------------
// Every workspace operation, driven from a C++ program that reads its answer back
// ---------------------------------------------------------------------------------------------
//
// The [crossing table](crossings) above proves what gg's dispatch *saw*. These prove what a C++
// program *gets*: the value lifted back out of a successful call, and the `gg::core::api_error` a
// refused one throws. Between them every `\throws` line in `shell.hpp`, `files.hpp`, `skills.hpp`,
// `memories.hpp`, `tasks.hpp` and `board.hpp` is a failure some program below caught.
//
// This arm's SDK adds no guard of its own — `Sources/sdk/files.cpp` and its neighbours lower, call
// and lift — so every refusal here is the HOST's, injected through the responder. The one exception
// is the negative shell timeout, which the membrane's own `clamp_timeout` refuses before dispatch,
// and whose case therefore also asserts that nothing reached a tool at all.

/// One program, granted every operation, answered by `responder`, with only the headers its body
/// names.
fn answering(
    headers: &[&str],
    body: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(&program_with(headers, body)),
        &all_operations(),
        RunEnding::None,
        false,
        responder,
    )
}

/// [`answering`] with the canned table: the success cases' responder.
fn succeeding(headers: &[&str], body: &str) -> (SandboxOutcome, CallLog) {
    answering(headers, body, canned_outcome)
}

/// [`answering`] with a responder that refuses **every** call with one failure class — which is all
/// a one-call program needs, and is how each failure below is injected.
fn refusing(
    headers: &[&str],
    body: &str,
    failure: ToolFailure,
    message: &str,
) -> (SandboxOutcome, CallLog) {
    let message = message.to_string();
    answering(headers, body, move |_name: &str, _args: &Value| {
        ToolOutcome::failed(failure, message.clone())
    })
}

/// The program a failure case runs: the one statement, and the `catch` that logs exactly what a
/// model reads off the failure — gg's own word for the class, and gg's own name for the call.
fn catching(statement: &str) -> String {
    format!(
        "  try {{\n    {statement}\n    gg::log(\"the call did not throw\");\n  }} catch \
         (const gg::core::api_error &failure) {{\n    gg::log(std::format(\"{{}} on {{}}\", \
         gg::core::gg_name(failure.code()), failure.operation()));\n  }}"
    )
}

/// [`catching`], with gg's **sentence** logged as well — for the two cases whose message is the
/// thing that has to reach the program.
fn catching_message(statement: &str) -> String {
    format!(
        "  try {{\n    {statement}\n    gg::log(\"the call did not throw\");\n  }} catch \
         (const gg::core::api_error &failure) {{\n    gg::log(std::format(\"{{}} on {{}}: {{}}\", \
         gg::core::gg_name(failure.code()), failure.operation(), failure.message()));\n  }}"
    )
}

/// Drive one statement into `failure` and assert the program read `expected` back off the
/// `gg::core::api_error` it caught.
fn assert_refused(statement: &str, failure: ToolFailure, message: &str, expected: &str) {
    let (outcome, _log) = refusing(&["<format>"], &catching(statement), failure, message);
    assert_eq!(
        logs(&outcome),
        [expected],
        "what a C++ program reads off `{statement}` when the host refuses it"
    );
}

/// [`assert_refused`], asserting gg's sentence reached the program too.
fn assert_refused_saying(statement: &str, failure: ToolFailure, message: &str, expected: &str) {
    let (outcome, _log) = refusing(
        &["<format>"],
        &catching_message(statement),
        failure,
        message,
    );
    assert_eq!(
        logs(&outcome),
        [expected],
        "what a C++ program reads off `{statement}` when the host refuses it"
    );
}

// ---------------------------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------------------------

#[test]
fn a_shell_run_hands_a_cpp_program_its_exit_code_and_output() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto ran = gg::shell::run("npm test");
  gg::log(std::format("{} {} {}", ran.exit_code.value_or(-1), ran.output, ran.truncated));
"####,
    );
    assert_eq!(logs(&outcome), ["0 ran `npm test` false"]);
}

#[test]
fn a_non_zero_shell_exit_is_a_value_a_cpp_program_reads() {
    // The one call in the surface whose failure is a VALUE: the process ran, so the program branches
    // on `exit_code` rather than catching anything, and the statements after it run.
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto ran = gg::shell::run("npm test -- fail");
  gg::log(std::format("{}", ran.exit_code.value_or(-1)));
  gg::log("carried on");
"####,
    );
    assert_eq!(logs(&outcome), ["1", "carried on"]);
}

#[test]
fn a_shell_timeout_reaches_a_cpp_program_as_limit_exceeded() {
    assert_refused(
        r#"gg::shell::run("sleep 600", 1.0);"#,
        ToolFailure::LimitExceeded,
        "`sleep 600` was killed after 1s",
        "limit-exceeded on shell",
    );
}

#[test]
fn a_shell_that_could_not_be_launched_is_an_io_error_in_cpp() {
    assert_refused(
        r#"gg::shell::run("npm test");"#,
        ToolFailure::IoError,
        "could not spawn `sh`: No such file or directory",
        "io-error on shell",
    );
}

#[test]
fn a_negative_shell_timeout_is_an_argument_error_in_cpp() {
    // The arm's ONE pre-dispatch refusal, and it is not the SDK's: the membrane's `clamp_timeout`
    // refuses a timeout that names no duration, so the tool is never reached and the canned
    // responder never answers.
    let (outcome, log) = succeeding(
        &["<format>"],
        &catching(r#"gg::shell::run("npm test", -4.0);"#),
    );
    assert_eq!(logs(&outcome), ["invalid-argument on shell"]);
    assert!(
        log.names().is_empty(),
        "a timeout the membrane refused must never reach a tool: {:?}",
        log.names()
    );
}

// ---------------------------------------------------------------------------------------------
// files
//
// `read_file`'s text success is read back by `the_view_object_the_helper_and_the_standard_ending…`
// through `gg::views::open_file`, its `not_found` is caught by `a_failure_is_thrown_whether_it_is…`
// and let out of `main` by the same, and `write_file`'s refusal when the run withheld it is
// `a_capability_this_run_withheld_is_refused_as_unavailable`.
// ---------------------------------------------------------------------------------------------

#[test]
fn an_image_read_reaches_a_cpp_program_as_the_image_variant() {
    let (outcome, _log) = succeeding(
        &["<format>", "<variant>"],
        r####"
  const auto read = gg::files::read_file("logo.png");
  if (const auto *picture = std::get_if<gg::files::image_file>(&read)) {
    gg::log(std::format("{} {} {}", picture->label, picture->bytes, picture->shown));
    gg::log(picture->not_shown_reason.value_or("shown"));
  } else {
    gg::log("the read came back as text");
  }
"####,
    );
    // The pixels never enter the program: a bare read hands over gg's DESCRIPTION of the picture,
    // narrowed out of the variant with `std::get_if`. `shown` is `false` because this path withholds
    // the attachment, and the reason names the recovery in this arm's own spelling — which is the
    // only place a C++ program is told what to call instead.
    assert_eq!(
        logs(&outcome),
        [
            "PNG 1234 false",
            "`gg::files::read_file` does not show images; open one with `gg::views::open_file(path)`"
        ]
    );
}

#[test]
fn an_empty_path_read_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::read_file("");"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty",
        "invalid-argument on read_file",
    );
}

#[test]
fn a_write_hands_a_cpp_program_the_byte_count() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  gg::log(std::format("{}", gg::files::write_file("out.txt", "hello")));
"####,
    );
    assert_eq!(logs(&outcome), ["5"]);
}

#[test]
fn an_empty_path_write_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::write_file("", "hello");"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty",
        "invalid-argument on write_file",
    );
}

#[test]
fn a_write_that_could_not_land_is_an_io_error_in_cpp() {
    assert_refused(
        r#"gg::files::write_file("out.txt", "hello");"#,
        ToolFailure::IoError,
        "could not create the parent directories of `out.txt`: Permission denied",
        "io-error on write_file",
    );
}

#[test]
fn an_edit_that_succeeded_lets_a_cpp_program_carry_on() {
    // `edit_file` returns nothing, so what a success means to a program is the two facts below: the
    // call reached gg's dispatch under its own name, and the statement after it ran.
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::files::edit_file("src/a.cpp", "alpha", "beta");
  gg::log("edited");
"####,
    );
    assert_eq!(logs(&outcome), ["edited"]);
    assert_eq!(log.names(), ["edit_file"]);
}

#[test]
fn an_edit_whose_old_text_is_absent_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::files::edit_file("src/a.cpp", "alpha", "beta");"#,
        ToolFailure::NotFound,
        "`alpha` does not appear in src/a.cpp",
        "not-found on edit_file",
    );
}

#[test]
fn an_edit_whose_old_text_repeats_is_a_conflict_in_cpp() {
    // The count is the only thing that makes this failure actionable — a program that is told
    // "ambiguous" and not "three of them" has nothing to widen its `old_string` by — so the case
    // asserts gg's sentence reached the program rather than only its class.
    assert_refused_saying(
        r#"gg::files::edit_file("src/a.cpp", "alpha", "beta");"#,
        ToolFailure::Conflict,
        "`alpha` appears 3 times in src/a.cpp; include more surrounding text",
        "conflict on edit_file: `alpha` appears 3 times in src/a.cpp; include more surrounding text",
    );
}

#[test]
fn an_empty_old_string_edit_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::edit_file("src/a.cpp", "", "beta");"#,
        ToolFailure::InvalidArgument,
        "`old_string` must not be empty",
        "invalid-argument on edit_file",
    );
}

#[test]
fn an_edit_whose_two_strings_match_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::edit_file("src/a.cpp", "alpha", "alpha");"#,
        ToolFailure::InvalidArgument,
        "`old_string` and `new_string` must differ",
        "invalid-argument on edit_file",
    );
}

#[test]
fn a_listing_hands_a_cpp_program_its_entries_and_their_kinds() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  for (const auto &entry : gg::files::list_dir("src")) {
    gg::log(std::format("{} {}", entry.name,
                        entry.kind == gg::files::entry_kind::directory ? "directory" : "file"));
  }
"####,
    );
    assert_eq!(
        logs(&outcome),
        ["a.ts file", "b.test.ts file", "sub directory"]
    );
}

#[test]
fn an_omitted_listing_path_lists_the_root_from_cpp() {
    let (outcome, log) = succeeding(
        &["<format>"],
        r####"
  gg::log(std::format("{}", gg::files::list_dir().size()));
"####,
    );
    assert_eq!(logs(&outcome), ["3"]);
    // The default argument is an absent `std::optional`, and what an absent path arrives as is a
    // null rather than a directory the SDK chose on the program's behalf.
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_listing_path_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::list_dir("");"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty",
        "invalid-argument on list_dir",
    );
}

#[test]
fn a_listing_of_a_directory_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::files::list_dir("nowhere");"#,
        ToolFailure::NotFound,
        "no such directory: nowhere",
        "not-found on list_dir",
    );
}

#[test]
fn a_tree_hands_a_cpp_program_its_rendering() {
    let (outcome, _log) = succeeding(
        &[],
        r####"
  gg::log(gg::files::tree({.path = "src", .depth = 3}));
"####,
    );
    assert_eq!(logs(&outcome), ["a.ts\nb.test.ts\nsub/\n  c.ts"]);
}

#[test]
fn a_tree_of_a_path_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::files::tree({.path = "nowhere"});"#,
        ToolFailure::NotFound,
        "no such path: nowhere",
        "not-found on tree",
    );
}

#[test]
fn a_tree_of_something_that_is_not_a_directory_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::tree({.path = "src/a.ts"});"#,
        ToolFailure::InvalidArgument,
        "`src/a.ts` is not a directory",
        "invalid-argument on tree",
    );
}

#[test]
fn a_tree_depth_of_zero_is_an_argument_error_in_cpp() {
    // A depth of `0` is a number the SDK lowers as written — this arm guards nothing — so the
    // refusal a program reads back is the host's, arriving as the exception every other one does.
    assert_refused(
        r#"gg::files::tree({.path = "src", .depth = 0});"#,
        ToolFailure::InvalidArgument,
        "`depth` must be at least 1",
        "invalid-argument on tree",
    );
}

#[test]
fn a_search_hands_a_cpp_program_its_matches() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto found = gg::files::search("answer", {.path = "src"});
  gg::log(std::format("{} {} {}", found.at(0).path, found.at(0).line, found.at(0).text));
"####,
    );
    assert_eq!(logs(&outcome), ["src/a.ts 3 const answer = 42;"]);
}

#[test]
fn a_search_that_matched_nothing_is_an_empty_vector_in_cpp() {
    // Nothing matching is a VALUE, so the program counts rather than catching — which is the half of
    // `\returns` a failure case could never show.
    let (outcome, _log) = answering(
        &["<format>"],
        r####"
  gg::log(std::format("{}", gg::files::search("nothing at all").size()));
"####,
        |_name: &str, _args: &Value| {
            ToolOutcome::ok("no matches", "0 matches").with_data(ApiData::SearchMatches(Vec::new()))
        },
    );
    assert_eq!(logs(&outcome), ["0"]);
}

#[test]
fn a_blank_search_query_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::search("   ");"#,
        ToolFailure::InvalidArgument,
        "`query` must not be blank",
        "invalid-argument on search",
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::search("(unclosed");"#,
        ToolFailure::InvalidArgument,
        "`query` is not a valid regular expression: unclosed group",
        "invalid-argument on search",
    );
}

#[test]
fn a_search_limit_of_zero_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::files::search("answer", {.limit = 0});"#,
        ToolFailure::InvalidArgument,
        "`limit` must be at least 1",
        "invalid-argument on search",
    );
}

#[test]
fn a_search_of_a_path_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::files::search("answer", {.path = "nowhere"});"#,
        ToolFailure::NotFound,
        "no such path: nowhere",
        "not-found on search",
    );
}

// ---------------------------------------------------------------------------------------------
// skills
// ---------------------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_a_cpp_program_the_skill_body() {
    let (outcome, _log) = succeeding(&[], r#"  gg::log(gg::skills::read_skill("testing"));"#);
    assert_eq!(logs(&outcome), ["the skill body"]);
}

#[test]
fn an_unknown_skill_is_not_found_in_cpp() {
    // The catalogue in the message is the point: a program that asked for a skill by the wrong name
    // has to be able to name a real one on its next line, which is why the sentence is asserted
    // rather than only the class.
    assert_refused_saying(
        r#"gg::skills::read_skill("nope");"#,
        ToolFailure::NotFound,
        "read_skill: no skill named `nope`; available skills: testing",
        "not-found on read_skill: read_skill: no skill named `nope`; available skills: testing",
    );
}

// ---------------------------------------------------------------------------------------------
// memories
// ---------------------------------------------------------------------------------------------

/// The three budget fields every memory mutation hands back, logged the same way in each case below.
const MEMORY_BUDGET: &str = r####"
  gg::log(std::format("{} {} {}", usage.count, usage.max_count.value_or(0), usage.total_chars));
"####;

#[test]
fn a_memory_write_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &format!(
            r#"  const auto usage = gg::memories::write_memory("layout", "d", "b");{MEMORY_BUDGET}"#
        ),
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn a_duplicate_memory_name_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::memories::write_memory("layout", "d", "b");"#,
        ToolFailure::Conflict,
        "a memory named `layout` already exists",
        "conflict on write_memory",
    );
}

#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded_in_cpp() {
    assert_refused(
        r#"gg::memories::write_memory("layout", "d", "b");"#,
        ToolFailure::LimitExceeded,
        "that body would take this run past its 4000-character memory budget",
        "limit-exceeded on write_memory",
    );
}

#[test]
fn a_memory_update_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &format!(
            r#"  const auto usage = gg::memories::update_memory("layout", "d2", "b2");{MEMORY_BUDGET}"#
        ),
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn an_update_of_a_memory_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::memories::update_memory("layout", "d2", "b2");"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
        "not-found on update_memory",
    );
}

#[test]
fn an_update_over_the_cap_is_limit_exceeded_in_cpp() {
    assert_refused(
        r#"gg::memories::update_memory("layout", "d2", "b2");"#,
        ToolFailure::LimitExceeded,
        "that body would take this run past its 4000-character memory budget",
        "limit-exceeded on update_memory",
    );
}

#[test]
fn a_memory_creation_hands_a_cpp_program_its_budget() {
    let (outcome, log) = succeeding(
        &["<format>"],
        &format!(
            r#"  const auto usage = gg::memories::create_memory("layout", "d", "b");{MEMORY_BUDGET}"#
        ),
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
    // The crossing's point, kept where the value is read back: this arm's `body` parameter lowers
    // onto gg's `contents` key, which is the one memory call whose wire name differs from its C++
    // spelling.
    assert_eq!(
        log.args("create_memory"),
        Some(
            json!({ "name": "layout", "description": "d", "contents": "b",
                     "code": null, "onUse": null })
        )
    );
}

#[test]
fn a_duplicate_memory_slug_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::memories::create_memory("layout", "d", "b");"#,
        ToolFailure::Conflict,
        "a memory named `layout` already exists",
        "conflict on create_memory",
    );
}

#[test]
fn memory_contents_over_the_cap_are_limit_exceeded_in_cpp() {
    assert_refused(
        r#"gg::memories::create_memory("layout", "d", "b");"#,
        ToolFailure::LimitExceeded,
        "that memory would take this run past its 4000-character budget",
        "limit-exceeded on create_memory",
    );
}

#[test]
fn a_memory_read_hands_a_cpp_program_its_contents() {
    let (outcome, _log) = succeeding(&[], r#"  gg::log(gg::memories::read_memory("layout"));"#);
    assert_eq!(logs(&outcome), ["the memory contents"]);
}

#[test]
fn a_read_of_a_memory_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::memories::read_memory("layout");"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
        "not-found on read_memory",
    );
}

#[test]
fn a_memory_edit_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &format!(
            r#"  const auto usage = gg::memories::edit_memory("layout", "old", "new");{MEMORY_BUDGET}"#
        ),
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn an_edit_whose_text_is_absent_from_a_memory_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::memories::edit_memory("layout", "old", "new");"#,
        ToolFailure::NotFound,
        "`old` does not appear in `layout`",
        "not-found on edit_memory",
    );
}

#[test]
fn an_edit_whose_text_repeats_in_a_memory_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::memories::edit_memory("layout", "old", "new");"#,
        ToolFailure::Conflict,
        "`old` appears 2 times in `layout`",
        "conflict on edit_memory",
    );
}

#[test]
fn an_edit_that_would_overrun_a_memory_is_limit_exceeded_in_cpp() {
    assert_refused(
        r#"gg::memories::edit_memory("layout", "old", "new");"#,
        ToolFailure::LimitExceeded,
        "that edit would take this run past its 4000-character memory budget",
        "limit-exceeded on edit_memory",
    );
}

#[test]
fn an_edit_that_would_empty_a_memory_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::memories::edit_memory("layout", "old", "");"#,
        ToolFailure::InvalidArgument,
        "that edit would leave `layout` empty; delete it instead",
        "invalid-argument on edit_memory",
    );
}

#[test]
fn a_memory_hit_hands_a_cpp_program_its_ranking() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto hits = gg::memories::search_memories({"cargo", "nextest"});
  gg::log(std::format("{} {} {} {} {}", hits.at(0).name, hits.at(0).description, hits.at(0).matched,
                      hits.at(0).occurrences, hits.at(0).excerpt));
"####,
    );
    assert_eq!(
        logs(&outcome),
        ["build-commands How to build 2 3 …cargo nextest run --workspace…"]
    );
}

#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_vector_in_cpp() {
    let (outcome, _log) = answering(
        &["<format>"],
        r####"
  gg::log(std::format("{}", gg::memories::search_memories({"nothing"}).size()));
"####,
        |_name: &str, _args: &Value| {
            ToolOutcome::ok("0 of 2 memories match", "searched memories")
                .with_data(ApiData::MemoryHits(Vec::new()))
        },
    );
    assert_eq!(logs(&outcome), ["0"]);
}

#[test]
fn a_memory_search_of_empty_keywords_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::memories::search_memories({""});"#,
        ToolFailure::InvalidArgument,
        "`keywords` must carry at least one non-empty word",
        "invalid-argument on search_memories",
    );
}

#[test]
fn a_hit_reads_its_own_memory_from_a_cpp_program() {
    // The one member function on a returned value in this module: it is an ALIAS of
    // `memories.read_memory`, so it must reach gg's dispatch under that name and carry the slug the
    // hit was ranked under rather than one the program had to copy out by hand.
    let (outcome, log) = succeeding(
        &[],
        r####"
  const auto hits = gg::memories::search_memories({"cargo"});
  gg::log(hits.at(0).read());
"####,
    );
    assert_eq!(logs(&outcome), ["the memory contents"]);
    assert_eq!(log.names(), ["search_memories", "read_memory"]);
    assert_eq!(
        log.args("read_memory"),
        Some(json!({ "name": "build-commands" }))
    );
}

#[test]
fn a_hit_whose_memory_was_deleted_is_not_found_in_cpp() {
    let (outcome, _log) = answering(
        &["<format>"],
        r####"
  const auto hits = gg::memories::search_memories({"cargo"});
  try {
    gg::log(hits.at(0).read());
  } catch (const gg::core::api_error &failure) {
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.operation()));
  }
"####,
        |name: &str, args: &Value| match name {
            "read_memory" => ToolOutcome::failed(
                ToolFailure::NotFound,
                "no memory named `build-commands`".to_string(),
            ),
            other => canned_outcome(other, args),
        },
    );
    assert_eq!(logs(&outcome), ["not-found on read_memory"]);
}

#[test]
fn a_memory_deletion_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &format!(r#"  const auto usage = gg::memories::delete_memory("layout");{MEMORY_BUDGET}"#),
    );
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn a_deletion_of_a_memory_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::memories::delete_memory("layout");"#,
        ToolFailure::NotFound,
        "no memory named `layout`",
        "not-found on delete_memory",
    );
}

// ---------------------------------------------------------------------------------------------
// tasks
//
// `update_task`, `set_blocked_by` and `complete_task` return nothing — their argument lowering is
// pinned by the crossing table above — so what a success means to a program is that the call reached
// dispatch under its own name and the statement after it ran.
// ---------------------------------------------------------------------------------------------

#[test]
fn adding_a_task_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto usage = gg::tasks::add_task("t1", "T");
  gg::log(std::format("{} {}", usage.count, usage.max_tasks));
"####,
    );
    assert_eq!(logs(&outcome), ["2 20"]);
}

#[test]
fn a_duplicate_task_id_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::tasks::add_task("t1", "T");"#,
        ToolFailure::Conflict,
        "a task with id `t1` already exists",
        "conflict on add_task",
    );
}

#[test]
fn a_task_edge_that_would_close_a_cycle_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::tasks::add_task("t1", "T", {.blocked_by = {"t2"}});"#,
        ToolFailure::Conflict,
        "`t1` blocked by `t2` would close a cycle",
        "conflict on add_task",
    );
}

#[test]
fn a_task_update_lets_a_cpp_program_carry_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::tasks::update_task("t1", {.status = gg::tasks::task_status::done});
  gg::log("updated");
"####,
    );
    assert_eq!(logs(&outcome), ["updated"]);
    assert_eq!(log.names(), ["update_task"]);
}

#[test]
fn an_update_of_a_task_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::tasks::update_task("t1", {.title = "T2"});"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "not-found on update_task",
    );
}

#[test]
fn a_task_patch_that_changes_nothing_is_an_argument_error_in_cpp() {
    // A default-constructed patch is what "leave everything alone" spells, and `tasks.hpp` states at
    // both the type and the function that the call refuses one.
    assert_refused(
        r#"gg::tasks::update_task("t1", {});"#,
        ToolFailure::InvalidArgument,
        "at least one of `title`, `description` or `status` is required",
        "invalid-argument on update_task",
    );
}

#[test]
fn re_blocking_a_task_lets_a_cpp_program_carry_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::tasks::set_blocked_by("t1", {"t0"});
  gg::log("re-blocked");
"####,
    );
    assert_eq!(logs(&outcome), ["re-blocked"]);
    assert_eq!(log.names(), ["set_blocked_by"]);
}

#[test]
fn re_blocking_a_task_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::tasks::set_blocked_by("t1", {"t0"});"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "not-found on set_blocked_by",
    );
}

#[test]
fn a_blocker_set_that_would_close_a_cycle_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::tasks::set_blocked_by("t1", {"t2"});"#,
        ToolFailure::Conflict,
        "`t1` blocked by `t2` would close a cycle",
        "conflict on set_blocked_by",
    );
}

#[test]
fn completing_a_task_lets_a_cpp_program_carry_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::tasks::complete_task("t1");
  gg::log("completed");
"####,
    );
    assert_eq!(logs(&outcome), ["completed"]);
    assert_eq!(log.names(), ["complete_task"]);
}

#[test]
fn completing_a_task_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::tasks::complete_task("t1");"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "not-found on complete_task",
    );
}

#[test]
fn removing_a_task_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto usage = gg::tasks::remove_task("t1");
  gg::log(std::format("{} {}", usage.count, usage.max_tasks));
"####,
    );
    assert_eq!(logs(&outcome), ["2 20"]);
}

#[test]
fn removing_a_task_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::tasks::remove_task("t1");"#,
        ToolFailure::NotFound,
        "no task with id `t1`",
        "not-found on remove_task",
    );
}

// ---------------------------------------------------------------------------------------------
// board
//
// `update_issue` and `set_issue_blocked_by` return nothing, and their argument lowering is pinned by
// the crossing table above.
// ---------------------------------------------------------------------------------------------

/// The four board-budget fields every board call hands back, logged the same way in each case below.
const BOARD_BUDGET: &str = r#"usage.epics, usage.max_epics, usage.issues, usage.max_issues"#;

#[test]
fn creating_an_epic_hands_a_cpp_program_its_id_and_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto made = gg::board::create_epic("epc", "E", "D");
  gg::log(std::format("{} {} {} {} {}", made.id, made.board.epics, made.board.max_epics,
                      made.board.issues, made.board.max_issues));
"####,
    );
    assert_eq!(logs(&outcome), ["EPIC 1 4 3 20"]);
}

#[test]
fn an_epic_prefix_under_three_letters_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::board::create_epic("ep", "E", "D");"#,
        ToolFailure::InvalidArgument,
        "`prefix` must be 3-6 letters (`ep` given)",
        "invalid-argument on create_epic",
    );
}

#[test]
fn an_epic_prefix_over_six_letters_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::board::create_epic("epicprefix", "E", "D");"#,
        ToolFailure::InvalidArgument,
        "`prefix` must be 3-6 letters (`epicprefix` given)",
        "invalid-argument on create_epic",
    );
}

#[test]
fn an_epic_prefix_that_is_not_letters_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::board::create_epic("ep1", "E", "D");"#,
        ToolFailure::InvalidArgument,
        "`prefix` must be 3-6 letters (`ep1` given)",
        "invalid-argument on create_epic",
    );
}

#[test]
fn an_epic_prefix_another_epic_holds_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::board::create_epic("epc", "E", "D");"#,
        ToolFailure::Conflict,
        "an epic with id `EPC` already exists",
        "conflict on create_epic",
    );
}

#[test]
fn creating_an_issue_hands_a_cpp_program_its_id_and_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto filed = gg::board::create_issue("I", "s", "o", "c", "worker");
  gg::log(std::format("{} {} {} {} {}", filed.id, filed.board.epics, filed.board.max_epics,
                      filed.board.issues, filed.board.max_issues));
"####,
    );
    assert_eq!(logs(&outcome), ["EPIC-1 1 4 3 20"]);
}

#[test]
fn an_issue_agent_that_cannot_be_assigned_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::board::create_issue("I", "s", "o", "c", "nobody");"#,
        ToolFailure::InvalidArgument,
        "`nobody` is not an agent this run declares",
        "invalid-argument on create_issue",
    );
}

#[test]
fn an_issue_reviewer_that_cannot_be_assigned_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::board::create_issue("I", "s", "o", "c", "worker", {.reviewers = {"nobody"}});"#,
        ToolFailure::InvalidArgument,
        "`nobody` is not an agent this run declares",
        "invalid-argument on create_issue",
    );
}

#[test]
fn an_issue_blocker_that_would_close_a_cycle_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::board::create_issue("I", "s", "o", "c", "worker", {.blocked_by = {"i0"}});"#,
        ToolFailure::Conflict,
        "blocking on `i0` would close a cycle",
        "conflict on create_issue",
    );
}

#[test]
fn an_issue_update_lets_a_cpp_program_carry_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::board::update_issue("i1", {.status = gg::board::issue_status::done});
  gg::log("updated");
"####,
    );
    assert_eq!(logs(&outcome), ["updated"]);
    assert_eq!(log.names(), ["update_issue"]);
}

#[test]
fn an_update_of_an_issue_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::board::update_issue("i1", {.title = "I2"});"#,
        ToolFailure::NotFound,
        "no issue with id `i1`",
        "not-found on update_issue",
    );
}

#[test]
fn an_issue_patch_that_changes_nothing_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::board::update_issue("i1", {});"#,
        ToolFailure::InvalidArgument,
        "at least one field of the patch is required",
        "invalid-argument on update_issue",
    );
}

#[test]
fn re_blocking_an_issue_lets_a_cpp_program_carry_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::board::set_issue_blocked_by("i1", {"i0"});
  gg::log("re-blocked");
"####,
    );
    assert_eq!(logs(&outcome), ["re-blocked"]);
    assert_eq!(log.names(), ["set_issue_blocked_by"]);
}

#[test]
fn re_blocking_an_issue_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::board::set_issue_blocked_by("i1", {"i0"});"#,
        ToolFailure::NotFound,
        "no issue with id `i1`",
        "not-found on set_issue_blocked_by",
    );
}

#[test]
fn an_issue_edge_that_would_close_a_cycle_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::board::set_issue_blocked_by("i1", {"i0"});"#,
        ToolFailure::Conflict,
        "`i1` blocked by `i0` would close a cycle",
        "conflict on set_issue_blocked_by",
    );
}

#[test]
fn removing_an_epic_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &format!(
            r####"
  const auto usage = gg::board::remove_epic("e1");
  gg::log(std::format("{{}} {{}} {{}} {{}}", {BOARD_BUDGET}));
"####
        ),
    );
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
}

#[test]
fn removing_an_epic_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::board::remove_epic("e1");"#,
        ToolFailure::NotFound,
        "no epic with id `e1`",
        "not-found on remove_epic",
    );
}

#[test]
fn removing_an_issue_hands_a_cpp_program_its_budget() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &format!(
            r####"
  const auto usage = gg::board::remove_issue("i1");
  gg::log(std::format("{{}} {{}} {{}} {{}}", {BOARD_BUDGET}));
"####
        ),
    );
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
}

#[test]
fn removing_an_issue_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::board::remove_issue("i1");"#,
        ToolFailure::NotFound,
        "no issue with id `i1`",
        "not-found on remove_issue",
    );
}

#[test]
fn a_wait_is_registered_and_a_cpp_program_runs_on() {
    // A wait does not block inside the program: the whole of what deferred registration means to a
    // C++ author is that the acknowledgement comes back and the next statement runs.
    let (outcome, _log) = succeeding(
        &[],
        r####"
  gg::log(gg::board::wait_for_issue("i1"));
  gg::log("carried on");
"####,
    );
    assert_eq!(logs(&outcome), ["wait registered", "carried on"]);
}

#[test]
fn waiting_on_an_issue_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::board::wait_for_issue("i1");"#,
        ToolFailure::NotFound,
        "no issue with id `i1`",
        "not-found on wait_for_issue",
    );
}

#[test]
fn waiting_on_this_sessions_own_issue_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::board::wait_for_issue("i1");"#,
        ToolFailure::InvalidArgument,
        "`i1` is the issue this session was assigned; it cannot wait on itself",
        "invalid-argument on wait_for_issue",
    );
}

#[test]
fn a_created_issue_waits_on_itself_from_a_cpp_program() {
    // The board mints the id, not the caller, so the member function is the only way a program can
    // wait on what it just filed without copying the id back out by hand — and it must reach gg's
    // dispatch under `wait_for_issue` carrying exactly the id the board handed back.
    let (outcome, log) = succeeding(
        &[],
        r####"
  const auto filed = gg::board::create_issue("I", "s", "o", "c", "worker");
  gg::log(filed.wait());
"####,
    );
    assert_eq!(logs(&outcome), ["wait registered"]);
    assert_eq!(log.names(), ["create_issue", "wait_for_issue"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );
}

// ---------------------------------------------------------------------------------------------
// Every session-side operation, driven from a C++ program that reads its answer back
// ---------------------------------------------------------------------------------------------
//
// The six modules whose effect is on the **session** rather than on the workspace: `context`,
// `delegation`, `programs`, `docs`, `views` and `session`. The [crossing table](crossings) covers
// the first two, which are gg tools, and proves what gg's dispatch *saw*; it reads no value back
// and injects no failure. The other four are answered **inside the membrane** with no tool behind
// them, which is why they are absent from that table.
//
// So each case below is a whole program of its own: a success reads the value back through
// `gg::log`, and a failure catches `gg::core::api_error` and logs gg's own word for the class beside
// gg's own name for the call — which is what a model reads, and the only thing it can branch on.
//
// A failure on a tool-backed call is injected through a [responder](refusing). A failure on a
// membrane-answered call has no tool for a responder to fail, so it is pulled out of one of three
// levers instead: the argument the program passes, the scope the evaluation grants, or a refusal
// armed on the double itself through [`over`].

/// One program, granted every operation, run against a double the case **already built**.
///
/// The knobs the cases below arm — a seeded program library, a seeded documentation hit, a
/// catalogue, a standing refusal for a family no tool backs — live on the [`FakeOperationApi`]
/// rather than on a [responder](answering), so a case that needs one cannot go through
/// [`answering`].
fn over(headers: &[&str], body: &str, api: FakeOperationApi) -> SandboxOutcome {
    over_as(
        headers,
        body,
        &all_operations(),
        RunEnding::None,
        false,
        api,
    )
}

/// [`over`] with the grant, the ending group and the library flag said out loud.
fn over_as(
    headers: &[&str],
    body: &str,
    operations: &[OperationId],
    ending: RunEnding,
    library: bool,
    api: FakeOperationApi,
) -> SandboxOutcome {
    evaluate_with_api(
        &prepare(&program_with(headers, body)),
        operations,
        ending,
        library,
        api,
    )
}

/// [`answering`] with the scope said out loud — what the program library and the three endings need,
/// since each of them is bought by something other than the blanket grant.
fn answering_as(
    headers: &[&str],
    body: &str,
    operations: &[OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(&program_with(headers, body)),
        operations,
        ending,
        library,
        responder,
    )
}

/// A responder answering **every** call with one sidecar — the shapes [`canned_outcome`]'s single
/// row per tool cannot carry, each of them a success rather than a failure.
fn sidecar(data: ApiData) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |_name: &str, _args: &Value| ToolOutcome::ok("", "answered").with_data(data.clone())
}

// ---------------------------------------------------------------------------------------------
// context
//
// All four are gg tools, so both halves of each are driven through a responder.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_file_view_eviction_hands_a_cpp_program_what_it_freed() {
    let (outcome, log) = succeeding(
        &["<format>"],
        r####"
  const auto freed = gg::context::evict_file_view("src/a.cpp");
  gg::log(std::format("{} {} {} {}", freed.items, freed.reclaimed_tokens, freed.paths.size(),
                      freed.detail));
"####,
    );
    assert_eq!(logs(&outcome), ["2 300 1 dropped 2 items"]);
    assert_eq!(
        log.args("evict_file_view"),
        Some(json!({ "path": "src/a.cpp" }))
    );
}

/// The default argument is the whole of how a program says "every file view": the key is **absent**
/// rather than empty, because an empty path is the one spelling gg refuses.
#[test]
fn an_omitted_eviction_path_drops_every_file_view_from_cpp() {
    let (outcome, log) = succeeding(
        &["<format>"],
        r####"
  gg::log(std::format("{}", gg::context::evict_file_view().items));
"####,
    );
    assert_eq!(logs(&outcome), ["2"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_eviction_path_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::context::evict_file_view("");"#,
        ToolFailure::InvalidArgument,
        "`path` must not be empty; leave it out to drop every file view",
        "invalid-argument on evict_file_view",
    );
}

/// An archive frees turns rather than files, so the report it hands back carries **no paths** — the
/// one field of a `reclaim_report` whose emptiness is the answer rather than a missing one.
#[test]
fn an_archive_hands_a_cpp_program_what_it_freed() {
    let (outcome, log) = answering(
        &["<format>"],
        r####"
  const auto freed = gg::context::archive_thread({{4, 19}});
  gg::log(std::format("{} {} {} {}", freed.items, freed.reclaimed_tokens, freed.paths.size(),
                      freed.detail));
"####,
        sidecar(ApiData::Reclaim(ReclaimData {
            items: 16,
            reclaimed_tokens: 9_400,
            paths: Vec::new(),
            detail: "archived turns 4-19".to_string(),
        })),
    );
    assert_eq!(logs(&outcome), ["16 9400 0 archived turns 4-19"]);
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[4, 19]] }))
    );
}

#[test]
fn a_span_that_is_not_turn_numbers_is_an_argument_error_in_cpp() {
    let (outcome, log) = refusing(
        &["<format>"],
        &catching(r#"gg::context::archive_thread({{19, 4}});"#),
        ToolFailure::InvalidArgument,
        "the range 19-4 ends before it starts",
    );
    assert_eq!(logs(&outcome), ["invalid-argument on archive_thread"]);
    // The ends arrived in the order the aggregate declares them, which is the only thing that makes
    // "ends before it starts" a statement about the program rather than about the lowering.
    assert_eq!(
        log.args("archive_thread"),
        Some(json!({ "ranges": [[19, 4]] }))
    );
}

#[test]
fn an_archive_search_hands_a_cpp_program_its_hits() {
    let (outcome, log) = succeeding(
        &["<format>", "<utility>"],
        r####"
  const auto found = gg::context::search_archive("the parser");
  const auto &hit = found.hits[0];
  gg::log(std::format("{} {} {} {}", found.archive_empty, hit.seq,
                      std::to_underlying(hit.role), hit.text));
  gg::log(std::format("{}", hit.role == gg::context::message_role::assistant));
"####,
    );
    assert_eq!(
        logs(&outcome),
        ["false 3 2 the earlier answer", "true"],
        "the role arrived as this arm's own enumerator rather than as a word"
    );
    assert_eq!(
        log.args("search_archive"),
        Some(json!({ "query": "the parser" }))
    );
}

/// The reason the envelope carries a flag at all: a program told only "no hits" would archive its
/// thread a second time believing the first had failed. So an empty archive is a **value** a program
/// reads, never something it catches.
#[test]
fn an_archive_with_nothing_in_it_is_not_a_failure_in_cpp() {
    let (outcome, _log) = answering(
        &["<format>"],
        r####"
  const auto found = gg::context::search_archive("the parser");
  gg::log(std::format("{} {}", found.archive_empty, found.hits.size()));
"####,
        sidecar(ApiData::ArchiveSearch(ArchiveSearchData {
            archive_empty: true,
            hits: Vec::new(),
        })),
    );
    assert_eq!(logs(&outcome), ["true 0"]);
}

#[test]
fn an_empty_archive_query_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::context::search_archive("");"#,
        ToolFailure::InvalidArgument,
        "`query` must not be empty",
        "invalid-argument on search_archive",
    );
}

/// A compaction is **registered**, not performed: the call returns, the program runs on, and the
/// loop rewrites the window once it has ended.
#[test]
fn a_compaction_is_registered_and_a_cpp_program_runs_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::context::compact("scaffolded the page", {"src/main.cpp"});
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "scaffolded the page", "files": ["src/main.cpp"] }))
    );
}

#[test]
fn a_blank_compaction_summary_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::context::compact("   ", {});"#,
        ToolFailure::InvalidArgument,
        "`summary` must not be blank",
        "invalid-argument on compact",
    );
}

// ---------------------------------------------------------------------------------------------
// delegation
// ---------------------------------------------------------------------------------------------

#[test]
fn a_spawn_hands_a_cpp_program_its_childs_handle() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto child =
      gg::delegation::spawn_subagent("subagent", gg::delegation::brief::prompt("write the lexer"));
  gg::log(std::format("{} {} {}", child.id, child.slot, child.model_id));
"####,
    );
    assert_eq!(logs(&outcome), ["agent-1 primary test/model"]);
}

/// The brief's other factory, which the crossing table leaves undriven: an issue id crosses under
/// its own key with **no prompt beside it**, rather than both being optional strings a program could
/// fill in together.
#[test]
fn a_brief_naming_an_issue_spawns_from_the_board_in_cpp() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::log(gg::delegation::spawn_subagent("subagent", gg::delegation::brief::issue("i1")).id);
"####,
    );
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "subagent", "prompt": null, "issueId": "i1" }))
    );
}

#[test]
fn a_spawn_at_the_delegation_depth_cap_is_limit_exceeded_in_cpp() {
    assert_refused(
        r#"gg::delegation::spawn_subagent("subagent", gg::delegation::brief::prompt("write the lexer"));"#,
        ToolFailure::LimitExceeded,
        "this run's delegation depth cap of 2 is already reached",
        "limit-exceeded on spawn_subagent",
    );
}

#[test]
fn a_spawn_of_an_agent_this_run_forbids_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::delegation::spawn_subagent("nope", gg::delegation::brief::prompt("write the lexer"));"#,
        ToolFailure::InvalidArgument,
        "this run may not spawn `nope`; agents it may spawn: subagent",
        "invalid-argument on spawn_subagent",
    );
}

/// The no-argument overload waits for **every** outstanding child, and says so by lowering an absent
/// list rather than an empty one — an empty list would ask gg to wait for exactly nothing.
#[test]
fn waiting_for_every_child_hands_a_cpp_program_their_results() {
    let (outcome, log) = succeeding(
        &["<format>", "<utility>"],
        r####"
  const auto results = gg::delegation::wait_for_subagents();
  const auto &first = results[0];
  gg::log(std::format("{} {} {}", first.id, std::to_underlying(*first.status), first.summary));
  gg::log(std::format("{}", *first.status == gg::delegation::agent_status::completed));
"####,
    );
    assert_eq!(logs(&outcome), ["agent-1 0 did the work", "true"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

#[test]
fn waiting_for_named_children_hands_a_cpp_program_their_results() {
    let (outcome, log) = succeeding(
        &["<format>", "<utility>"],
        r####"
  const auto results = gg::delegation::wait_for_subagents({"agent-1"});
  const auto &first = results[0];
  gg::log(std::format("{} {} {}", first.id, std::to_underlying(*first.status), first.summary));
"####,
    );
    assert_eq!(logs(&outcome), ["agent-1 0 did the work"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

#[test]
fn waiting_on_a_child_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::delegation::wait_for_subagents({"agent-9"});"#,
        ToolFailure::NotFound,
        "no child agent `agent-9`",
        "not-found on wait_for_subagents",
    );
}

/// A child that produced no recognisable ending reports **no** status: an empty `std::optional` the
/// program branches on, rather than an enumerator it would read and be wrong about.
#[test]
fn a_child_that_returned_nothing_is_an_empty_status_in_cpp() {
    let (outcome, _log) = answering(
        &["<format>"],
        r####"
  const auto first = gg::delegation::wait_for_subagents()[0];
  gg::log(std::format("{} {} {}", first.id, first.status.has_value(), first.summary));
"####,
        sidecar(ApiData::SubagentResults(vec![SubagentResultData {
            id: "agent-9".to_string(),
            status: None,
            summary: "it said this much".to_string(),
        }])),
    );
    assert_eq!(logs(&outcome), ["agent-9 false it said this much"]);
}

#[test]
fn a_message_reaches_a_running_child_from_cpp() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::delegation::send_message("agent-1", "prefer the simpler parser");
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(log.names(), ["send_message"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn messaging_a_child_that_is_not_there_is_not_found_in_cpp() {
    assert_refused(
        r#"gg::delegation::send_message("agent-9", "prefer the simpler parser");"#,
        ToolFailure::NotFound,
        "no agent `agent-9`",
        "not-found on send_message",
    );
}

#[test]
fn messaging_a_child_that_already_returned_is_a_conflict_in_cpp() {
    assert_refused(
        r#"gg::delegation::send_message("agent-1", "prefer the simpler parser");"#,
        ToolFailure::Conflict,
        "`agent-1` has already returned",
        "conflict on send_message",
    );
}

/// The alias `delegation.hpp:64-67` claims: a handle's own `send` is the free function, reached
/// without the program copying the id back out by hand — and it must arrive under `send_message`
/// carrying exactly the id the spawn handed back.
#[test]
fn a_handles_own_send_reaches_the_same_child_from_cpp() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  const auto child =
      gg::delegation::spawn_subagent("subagent", gg::delegation::brief::prompt("write the lexer"));
  child.send("prefer the simpler parser");
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(log.names(), ["spawn_subagent", "send_message"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn a_handles_send_to_a_child_that_returned_is_a_conflict_in_cpp() {
    let (outcome, _log) = answering(
        &["<format>"],
        &format!(
            "  const auto child = gg::delegation::spawn_subagent(\n      \"subagent\", \
             gg::delegation::brief::prompt(\"write the lexer\"));\n{}",
            catching(r#"child.send("prefer the simpler parser");"#)
        ),
        |name: &str, args: &Value| match name {
            "send_message" => ToolOutcome::failed(
                ToolFailure::Conflict,
                "`agent-1` has already returned".to_string(),
            ),
            _ => canned_outcome(name, args),
        },
    );
    assert_eq!(logs(&outcome), ["conflict on send_message"]);
}

/// A transition is **registered**, not performed: the call validates the target and returns, and the
/// next state's agent is stood up once the program has ended.
#[test]
fn a_state_transition_is_registered_and_a_cpp_program_runs_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::delegation::transition_state("verify", "the build is green");
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
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
fn an_omitted_transition_note_tells_the_next_state_nothing_in_cpp() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::delegation::transition_state("verify");
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("transition_state"),
        Some(json!({ "state": "verify", "note": null }))
    );
}

#[test]
fn a_state_this_session_may_not_move_to_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::delegation::transition_state("nowhere");"#,
        ToolFailure::InvalidArgument,
        "`verify` is the only state this one has an edge to",
        "invalid-argument on transition_state",
    );
}

/// **The first declaration in a turn stands.** A silently replaced transition would be a change the
/// model cannot see, so the second is refused and the program is told which call it was.
#[test]
fn a_second_transition_in_one_turn_is_refused_in_cpp() {
    let mut declared = false;
    let (outcome, log) = answering(
        &["<format>"],
        &format!(
            "  gg::delegation::transition_state(\"verify\");\n{}\n  gg::log(\"ran on\");",
            catching(r#"gg::delegation::transition_state("ship");"#)
        ),
        move |name: &str, args: &Value| match declared {
            true => ToolOutcome::failed(
                ToolFailure::Refused,
                "this session already declared a transition this turn".to_string(),
            ),
            false => {
                declared = true;
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["refused on transition_state", "ran on"]);
    assert_eq!(
        log.names(),
        ["transition_state", "transition_state"],
        "both reached dispatch; it is the second gg declined"
    );
}

/// A succession is the same registered move a transition is, declared by the model rather than by a
/// machine — so it too returns and lets the program run on.
#[test]
fn a_succession_is_registered_and_a_cpp_program_runs_on() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::delegation::exec("Builder", "pick it up from here");
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": "pick it up from here" }))
    );
    assert_eq!(
        outcome
            .tool_calls
            .iter()
            .map(|call| (call.name.as_str(), call.ok))
            .collect::<Vec<_>>(),
        [("delegation.exec", true)],
        "the succession is on the turn's own roster"
    );
}

#[test]
fn an_omitted_succession_prompt_tells_the_next_agent_nothing_in_cpp() {
    let (outcome, log) = succeeding(
        &[],
        r####"
  gg::delegation::exec("Builder");
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["ran on"]);
    assert_eq!(
        log.args("exec"),
        Some(json!({ "agent": "Builder", "prompt": null }))
    );
}

#[test]
fn an_agent_this_session_may_not_become_is_an_argument_error_in_cpp() {
    assert_refused(
        r#"gg::delegation::exec("nope");"#,
        ToolFailure::InvalidArgument,
        "this run may not become `nope`; agents it may become: Builder",
        "invalid-argument on exec",
    );
}

#[test]
fn a_second_succession_in_one_turn_is_refused_in_cpp() {
    let mut declared = false;
    let (outcome, log) = answering(
        &["<format>"],
        &format!(
            "  gg::delegation::exec(\"Builder\");\n{}\n  gg::log(\"ran on\");",
            catching(r#"gg::delegation::exec("Reviewer");"#)
        ),
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
    assert_eq!(logs(&outcome), ["refused on exec", "ran on"]);
    assert_eq!(log.names(), ["exec", "exec"]);
}

/// The copy's handle comes back **immediately** even though the copy itself is dispatched when the
/// turn closes, so the program can name it and carry on.
#[test]
fn a_fork_hands_a_cpp_program_the_copys_handle() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        r####"
  const auto copy = gg::delegation::fork("try the other fix");
  gg::log(std::format("{} {} {}", copy.id, copy.slot, copy.model_id));
  gg::log("ran on");
"####,
    );
    assert_eq!(logs(&outcome), ["agent-2 primary test/model", "ran on"]);
}

#[test]
fn a_fork_at_the_delegation_depth_cap_is_limit_exceeded_in_cpp() {
    assert_refused(
        r#"gg::delegation::fork("try the other fix");"#,
        ToolFailure::LimitExceeded,
        "this run's delegation depth cap of 2 is already reached",
        "limit-exceeded on fork",
    );
}

// ---------------------------------------------------------------------------------------------
// programs
//
// The empty history, `get`'s `not_found` and a registered hand-over are read back by
// `the_program_library_and_a_reviewers_verdict_are_reached_in_cpp_too`.
// ---------------------------------------------------------------------------------------------

/// The source the library cases seed the double with — one line, so the two counts a summary reports
/// are this string's own rather than a figure this file has to recompute.
const SEEDED_PROGRAM: &str = "int main() { gg::log(\"one\"); return 0; }\n";

/// A double holding one program the library issued an id for, answering everything else as usual.
fn holding_a_program() -> FakeOperationApi {
    FakeOperationApi::new(&CallLog::default()).with_program("k3p9", 3, SEEDED_PROGRAM)
}

#[test]
fn a_history_hands_a_cpp_program_every_programs_shape() {
    let outcome = over_as(
        &["<format>"],
        r####"
  const auto first = gg::programs::history()[0];
  gg::log(std::format("{} {} {} {} {} {}", first.id, first.turn, first.lines, first.chars,
                      first.ok, first.error.value_or("none")));
"####,
        &[],
        RunEnding::None,
        true,
        holding_a_program(),
    );
    assert_eq!(
        logs(&outcome),
        [format!("k3p9 3 1 {} true none", SEEDED_PROGRAM.len())]
    );
}

#[test]
fn a_session_that_keeps_no_library_is_unavailable_in_cpp() {
    let (outcome, log) = answering_as(
        &["<format>"],
        &catching("gg::programs::history();"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on history"]);
    assert!(
        log.names().is_empty(),
        "a library this run does not keep must never reach a tool: {:?}",
        log.names()
    );
}

#[test]
fn a_fetch_hands_a_cpp_program_the_source_that_ran() {
    let outcome = over_as(
        &[],
        r####"
  gg::log(gg::programs::get("k3p9"));
"####,
        &[],
        RunEnding::None,
        true,
        holding_a_program(),
    );
    // The bytes the library holds, newline and all — a fetch hands back what ran rather than a
    // rendering of it.
    assert_eq!(logs(&outcome), [SEEDED_PROGRAM]);
}

/// The alias `programs.hpp:41-46` claims: a summary's own `source()` is `programs::get` under the id
/// that summary carries, so a program that listed its history can read one back without restating
/// the id.
#[test]
fn a_summarys_own_source_call_fetches_the_same_program_in_cpp() {
    let outcome = over_as(
        &[],
        r####"
  gg::log(gg::programs::history()[0].source());
"####,
        &[],
        RunEnding::None,
        true,
        holding_a_program(),
    );
    assert_eq!(logs(&outcome), [SEEDED_PROGRAM]);
}

#[test]
fn a_summarys_source_call_for_a_dropped_program_is_not_found_in_cpp() {
    let outcome = over_as(
        &["<format>"],
        &catching("gg::log(gg::programs::history()[0].source());"),
        &[],
        RunEnding::None,
        true,
        holding_a_program().refusing(
            PROGRAMS_GET,
            ToolFailure::NotFound,
            "the library has since dropped `k3p9`",
        ),
    );
    assert_eq!(logs(&outcome), ["not-found on get"]);
}

/// **The first hand-over stands.** A silently replaced program would be a change the model cannot
/// see, which is the same argument that makes a succession first-wins.
#[test]
fn a_second_hand_over_from_one_cpp_program_is_refused() {
    let (outcome, _log) = answering_as(
        &["<format>"],
        &format!(
            "  gg::programs::rerun(\"int main() {{ gg::log(\\\"first\\\"); return 0; }}\");\n{}",
            catching(r#"gg::programs::rerun("int main() { gg::log(\"second\"); return 0; }");"#)
        ),
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["refused on rerun"]);
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("int main() { gg::log(\"first\"); return 0; }"),
        "the program that runs next is the one the first call named"
    );
}

#[test]
fn a_blank_hand_over_source_is_an_argument_error_in_cpp() {
    let (outcome, _log) = answering_as(
        &["<format>"],
        &catching(r#"gg::programs::rerun("   ");"#),
        &[],
        RunEnding::None,
        true,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["invalid-argument on rerun"]);
    assert!(outcome.rerun.is_none(), "{:?}", outcome.rerun);
}

// ---------------------------------------------------------------------------------------------
// docs
//
// The empty page a search hands back, and both closes refused as `unavailable`, are read back by
// `the_view_object_the_helper_and_the_standard_ending_are_reached_in_cpp_too`; the granted closes
// are its second program.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_documentation_search_hands_a_cpp_program_its_hits() {
    let outcome = over(
        &["<format>", "<utility>"],
        r####"
  const auto found = gg::docs::search({.query = "text view"});
  const auto &hit = found.hits[0];
  gg::log(std::format("{} {} {} {} {} {} {}", found.total, found.offset, hit.key,
                      std::to_underlying(hit.kind), hit.module, hit.name, hit.summary));
"####,
        FakeOperationApi::new(&CallLog::default()).finding(
            "gg::views::open_text",
            DocKind::Function,
            "gg::views",
            "open_text",
            "Show a value the program computed.",
        ),
    );
    assert_eq!(
        logs(&outcome),
        ["1 0 gg::views::open_text 1 gg::views open_text Show a value the program computed."],
        "the kind arrived as this arm's own enumerator, `function` being the second of the three"
    );
}

/// Every part of a search may be left out and the parts given compose — but **all of them at once**
/// may not, which is the one shape the aggregate can produce that gg has no answer for.
#[test]
fn a_search_naming_nothing_at_all_is_an_argument_error_in_cpp() {
    let (outcome, log) = succeeding(&["<format>"], &catching("gg::docs::search({});"));
    assert_eq!(logs(&outcome), ["invalid-argument on search"]);
    assert!(
        log.names().is_empty(),
        "a documentation search is not a tool call: {:?}",
        log.names()
    );
}

/// Named for the module rather than for the call, because `files`' own search already holds
/// [`a_search_limit_of_zero_is_an_argument_error_in_cpp`] and a failing case has to name itself.
#[test]
fn a_documentation_search_limit_of_zero_is_an_argument_error_in_cpp() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &catching(r#"gg::docs::search({.query = "view", .limit = 0});"#),
    );
    assert_eq!(logs(&outcome), ["invalid-argument on search"]);
}

// ---------------------------------------------------------------------------------------------
// views
//
// The text open, the text read-back, the documentation open, a close that closed one and a close
// that closed nothing are read back by
// `the_view_object_the_helper_and_the_standard_ending_are_reached_in_cpp_too`.
// ---------------------------------------------------------------------------------------------

/// A view of a picture is the one way a picture enters the window, so — unlike a bare
/// `gg::files::read_file` — this one comes back saying it is **shown**.
#[test]
fn an_image_view_reaches_a_cpp_program_as_the_image_variant() {
    let (outcome, _log) = succeeding(
        &["<format>", "<variant>"],
        r####"
  const auto shown = gg::views::open_file("logo.png");
  if (const auto *picture = std::get_if<gg::files::image_file>(&shown)) {
    gg::log(std::format("{} {} {}", picture->label, picture->bytes, picture->shown));
  } else {
    gg::log("the view came back as text");
  }
"####,
    );
    assert_eq!(logs(&outcome), ["PNG 1234 true"]);
}

/// The **read** is what fails, and nothing is opened when it does.
#[test]
fn opening_a_view_on_a_file_that_is_not_there_is_not_found_in_cpp() {
    let (outcome, log) = refusing(
        &["<format>"],
        &catching(r#"gg::views::open_file("gone.md");"#),
        ToolFailure::NotFound,
        "no such file: gone.md",
    );
    assert_eq!(logs(&outcome), ["not-found on open_file"]);
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

#[test]
fn an_offset_past_the_end_of_a_file_is_an_argument_error_in_cpp() {
    let (outcome, log) = refusing(
        &["<format>"],
        &catching(r#"gg::views::open_file("notes.md", {.offset = 900, .limit = 20});"#),
        ToolFailure::InvalidArgument,
        "notes.md has 2 lines, so line 900 is past its end",
    );
    assert_eq!(logs(&outcome), ["invalid-argument on open_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 900, "limit": 20 }))
    );
}

/// The one value in `view_options` the membrane deliberately declines to normalise: a zero offset
/// plainly means the first line, and a zero line cut names nothing.
#[test]
fn a_line_cut_outside_its_range_is_an_argument_error_in_cpp() {
    let (outcome, log) = succeeding(
        &["<format>"],
        &catching_message(r#"gg::views::open_file("wide.md", {.max_line_chars = 0});"#),
    );
    assert_eq!(
        logs(&outcome),
        [
            "invalid-argument on open_file: `maxLineChars` must be between 1 and 65536 (0 given); \
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

/// The size **and** the bound both reach the program, because a view refused for being too large is
/// fixed by asking for a window — and the numbers say how small a one.
#[test]
fn a_view_body_over_the_window_cap_is_limit_exceeded_in_cpp() {
    let (outcome, _log) = answering(
        &["<format>"],
        &catching_message(r#"gg::views::open_file("huge.md");"#),
        |_name: &str, _args: &Value| ToolOutcome::ok("x".repeat(70_000), "read a big file"),
    );
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("limit-exceeded on open_file: ")
            && line.contains("70000")
            && line.contains("65536"),
        "the refusal names the size and the bound: {line}"
    );
    assert!(
        outcome.views_opened.is_empty(),
        "nothing is opened when the window is refused: {:?}",
        outcome.views_opened
    );
}

#[test]
fn an_empty_text_view_label_is_an_argument_error_in_cpp() {
    let (outcome, log) = succeeding(
        &["<format>"],
        &catching_message(r#"gg::views::open_text("", "eight files, two failing");"#),
    );
    assert_eq!(
        logs(&outcome),
        ["invalid-argument on open_text: a view needs a non-empty label"]
    );
    assert!(
        log.names().is_empty(),
        "a text view is not a tool call: {:?}",
        log.names()
    );
}

/// Nothing is silently truncated, so the cap is **named**: a program told only "too large" cannot
/// know what to show instead.
#[test]
fn a_text_view_over_its_cap_is_limit_exceeded_in_cpp() {
    let (outcome, _log) = succeeding(
        &["<format>", "<string>"],
        &catching_message(r#"gg::views::open_text("summary", std::string(70000, 'x'));"#),
    );
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("limit-exceeded on open_text: ")
            && line.contains("70000")
            && line.contains("65536"),
        "the refusal names the size and the cap: {line}"
    );
}

/// A real catalogue name **outside this agent's scope** is `not_found`, and the message is about the
/// binding rather than the spelling — a model told "no such name" would spend a turn correcting a
/// name that was already right. It stays `not_found` because telling it the call exists would be
/// telling it about a call it may not make.
#[test]
fn opening_documentation_for_a_name_that_is_not_bound_is_not_found_in_cpp() {
    let outcome = over(
        &["<format>"],
        &catching_message(r#"gg::views::open_docs_view("gg::delegation::fork");"#),
        FakeOperationApi::new(&CallLog::default()).cataloguing(&[
            ("gg::views::open_text", true),
            ("gg::delegation::fork", false),
        ]),
    );
    let line = &logs(&outcome)[0];
    assert!(
        line.starts_with("not-found on open_docs_view: ")
            && line.contains("this session does not bind it"),
        "{line}"
    );
    assert!(
        outcome.views_opened.is_empty(),
        "{:?}",
        outcome.views_opened
    );
}

#[test]
fn an_empty_view_selector_is_an_argument_error_in_cpp() {
    let (outcome, _log) = succeeding(&["<format>"], &catching_message(r#"gg::views::close("");"#));
    assert_eq!(
        logs(&outcome),
        ["invalid-argument on close: `view.close` needs a non-empty selector"]
    );
}

/// Closing what the program opened is managing the window, exactly as evicting a file view is, so it
/// is bought by the same capability — and withheld, the call reaches no implementation at all.
#[test]
fn closing_a_view_without_the_capability_is_unavailable_in_cpp() {
    let (outcome, log) = answering_as(
        &["<format>"],
        &catching(r#"gg::views::close("summary");"#),
        &all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT),
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on close"]);
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

// ---------------------------------------------------------------------------------------------
// session
//
// `finish`'s success, and both of a reviewer's verdicts, are read back by
// `the_view_object_the_helper_and_the_standard_ending_are_reached_in_cpp_too` and
// `the_program_library_and_a_reviewers_verdict_are_reached_in_cpp_too`.
// ---------------------------------------------------------------------------------------------

/// "The work is complete" is not a verdict a reviewer is asked for, so the role that ends another
/// way is refused — under `finish`'s own name, because a compiled arm cannot withhold a name.
#[test]
fn finishing_a_session_that_ends_another_way_is_unavailable_in_cpp() {
    let (outcome, _log) = answering_as(
        &["<format>"],
        &catching(r#"gg::session::finish("the work is done");"#),
        &all_operations(),
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on finish"]);
    assert!(outcome.completion.is_none(), "{:?}", outcome.completion);
}

/// The summary becomes the session's whole answer to whoever asked for the work, so "I am done and
/// have nothing to say about it" is not an ending gg accepts on the model's behalf.
#[test]
fn an_empty_finishing_summary_is_an_argument_error_in_cpp() {
    let (outcome, _log) = answering_as(
        &["<format>"],
        &catching(r#"gg::session::finish("   ");"#),
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["invalid-argument on finish"]);
    assert!(
        outcome.completion.is_none(),
        "the run is still open: {:?}",
        outcome.completion
    );
}

#[test]
fn approving_outside_a_review_is_unavailable_in_cpp() {
    let (outcome, _log) = answering_as(
        &["<format>"],
        &catching("gg::session::approve();"),
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on approve"]);
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

#[test]
fn requesting_changes_outside_a_review_is_unavailable_in_cpp() {
    let (outcome, _log) = answering_as(
        &["<format>"],
        &catching(r#"gg::session::request_changes({"widen the test"});"#),
        &all_operations(),
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["unavailable on request_changes"]);
    assert!(outcome.completion.is_none());
}

/// A rejection is dispatched verbatim to the agent that has to fix the work, so an empty list would
/// send it back to re-read criteria it already believed it had met.
#[test]
fn an_empty_change_list_is_an_argument_error_in_cpp() {
    let (outcome, _log) = answering_as(
        &["<format>"],
        &catching("gg::session::request_changes({});"),
        &all_operations(),
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["invalid-argument on request_changes"]);
    assert!(outcome.completion.is_none());
}

// ---------------------------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------------------------
//
// `gg::log` is the only channel a program has for showing gg a value
// (`crates/gg/wit/gg-sandbox.wit:1096-1098`), and `report-error` is the only other member of the
// interface this arm's shell calls: an uncaught throw (`Sources/shell.cpp:143-157`), read back by
// `a_failure_is_thrown_whether_it_is_caught_or_let_out`, and a non-zero entry-point status
// (`:166-173`), read back in `cpp.substrate.test.rs`.
//
// **`note-return`, `report-deferred` and `report-module-error` are unreachable on this arm, and that
// is the contract rather than a gap.** A C++ entry point returns a *status*, which this arm reports
// through `report-error` rather than as a returned value, so there is nothing for `note-return` to
// note. The deferred channel describes work pushed into a microtask
// (`crates/gg/wit/gg-sandbox.wit:1109-1116`), and this arm has no engine to hold one — work a C++
// program defers runs inside the turn, in a destructor, as an ordinary recorded call. And a code
// module here is an *input to the compile* that binds it (`cpp.substrate.test.rs`), so a module that
// does not build is refused at prepare — the last case below — rather than handed to a running
// program as an empty namespace for `report-module-error` to describe.

/// **Past the kept cap the tail is what a program reads back.** The natural shape is to log per item
/// and then log the conclusion, so a head-biased capture would discard exactly the line the program
/// wrote for the model to read (`capture.rs:240-245`).
#[test]
fn what_a_cpp_program_logs_past_the_kept_cap_is_its_tail() {
    let (outcome, _log) = succeeding(
        &["<format>"],
        &format!(
            "  for (int index = 0; index < {}; ++index) {{\n    \
             gg::log(std::format(\"line {{}}\", index));\n  }}",
            MAX_LOG_LINES + 5
        ),
    );
    let kept = logs(&outcome);
    assert_eq!(kept.len(), MAX_LOG_LINES);
    assert_eq!(
        kept[0], "line 5",
        "the first five were evicted, not the last"
    );
    assert_eq!(
        kept[MAX_LOG_LINES - 1],
        format!("line {}", MAX_LOG_LINES + 4)
    );
    assert_eq!(
        outcome.logs_suppressed, 5,
        "and what was lost is counted rather than silently dropped"
    );
}

/// **One enormous line arrives cut and marked.** An unmarked truncation reads as a program that
/// logged half a value, so the ellipsis is as much of the contract as the cut (`capture.rs:378-392`).
#[test]
fn a_log_line_past_its_own_cap_is_cut_and_marked_in_cpp() {
    let (outcome, _log) = succeeding(
        &["<string>"],
        &format!(
            "  gg::log(std::string({}, 'x'));\n  gg::log(\"after\");",
            MAX_LOG_LINE_BYTES + 40
        ),
    );
    let kept = logs(&outcome);
    assert_eq!(kept.len(), 2);
    assert!(kept[0].ends_with('…'), "the cut is marked");
    assert_eq!(
        kept[0].len(),
        MAX_LOG_LINE_BYTES + '…'.len_utf8(),
        "cut to the cap, with the marker added past it"
    );
    assert_eq!(
        kept[1], "after",
        "and the cap is per line rather than a state the channel is left in"
    );
}

/// **A module that does not build never reaches a program.** On this arm a module is an input to the
/// compile that binds it, so the refusal is the author's own compile error at the module's own
/// coordinates — and no program ever runs with a namespace that is missing its exports.
#[test]
fn a_module_that_does_not_build_is_refused_before_a_cpp_program_binds_it() {
    let failure = super::compile::compile_module(
        "broken",
        "#include <string>\n\nstd::string shout(std::string who) { return 42; }\n",
        &crate::sandbox::PrepareContext::detached(),
    )
    .expect_err("a module with a type error does not build");
    let crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(rendered)) =
        &failure
    else {
        panic!("a module's own type error is its author's compile error, not {failure:?}");
    };
    assert!(
        rendered.contains("module_broken.cppm:"),
        "the diagnostic is located in the module gg compiled, at its own line: {rendered}"
    );
}
