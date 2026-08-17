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
//! # Why they are consolidated all the same
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in here costs a real
//! `clang++` and a `Component::new`. So each function drives *many* statements rather than being one
//! behaviour per function. Add a statement to an existing function rather than adding a function.
//!
//! # What used to be here, and what covers it now
//!
//! A hand-wired comparison of this arm's catalogue against the **Rust** arm's, entry by entry,
//! written when neither was registered and kept afterwards as a second opinion. It is gone: it read
//! a five-part identity tuple — section, object, key, gate, ending — that no catalogue carries, and
//! a comparison of two catalogues neither of which has it reports every section missing rather than
//! finding a disagreement.
//!
//! What covers it is stronger than what it did:
//! `operations.test.rs::every_operation_is_offered_by_every_arm_that_is_not_excused` asserts the
//! same coverage against **gg's own operations table** rather than against whichever arm this file
//! happened to point at, and the [agreement gate](super::agreement) runs over this arm for real now
//! that it is registered.

use serde_json::{Value, json};

use super::substrate::{evaluate, evaluate_closing_docviews, logs, prepare};
use crate::ending::{Ending, EndingRole};
use test_cabinet_core::gg::{CAPABILITY_DOCVIEW_CLOSE, GgProgramLanguage};

use crate::sandbox::fake::{CallLog, all_operations, all_operations_without, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::SandboxOutcome;
use crate::tools::{ToolFailure, ToolOutcome};

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
/// what a model's own reply has to carry: the `#include` that declares gg's surface, and the entry
/// point C++ has no top level to do without. The umbrella header rather than the thirteen module
/// ones, because the bodies below reach across most of them and a per-body include list would be a
/// second copy of what each one calls.
fn program(body: &str) -> String {
    format!("#include <gg.hpp>\n\nint main() {{\n{body}\n  return 0;\n}}\n")
}

/// Compile and run one C++ program with `enabled`'s tools offered and no ending group.
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
// Every tool, from its C++ spelling
// ---------------------------------------------------------------------------------------------

/// One tool, called through the C++ spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic C++ function.
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
fn every_tool_crosses_the_membrane_from_its_cpp_spelling() {
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

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than
    // shipping as a typed function nobody ever called.
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
fn the_view_object_the_helper_and_the_standard_ending_are_reached_in_cpp_too() {
    // Three of the families that are NOT gg tools, so none of them appears in the crossing table
    // above — and they are where a program puts something in front of the model and finds out what
    // it may call at all, which makes them the ones a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(&program(
            r####"
  const std::string text = gg::files::read_text_file("notes.md", {.offset = 1, .limit = 2});
  const auto read = gg::views::open_file("notes.md", {.offset = 1, .limit = 2});
  gg::views::open_text("summary", text);
  gg::views::open_docs_view("read_file");
  const std::uint32_t closed = gg::views::close("summary");
  const std::uint32_t missing = gg::views::close("never opened");
  const auto open = gg::views::current();
  gg::log(std::format("{} {}", open[0].selector, open[0].kind == gg::views::view_kind::file));
  gg::log(std::format("{} {}", closed, missing));
  const std::string shown = std::holds_alternative<gg::files::text_file>(read)
                                ? std::get<gg::files::text_file>(read).contents
                                : std::get<gg::files::image_file>(read).label;
  gg::log(shown.substr(0, shown.find('\n')));
  const auto found = gg::docs::search(
      "open", {.module = "views", .kind = gg::docs::doc_kind::function, .limit = 5});
  gg::log(std::format("{} {} {}", found.total, found.offset, found.hits.size()));
  try {
    gg::log(std::format("closed {}", gg::docs::close("gg::views::open_text")));
  } catch (const gg::core::tool_error &failure) {
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.tool()));
  }
  try {
    gg::log(std::format("closed {}", gg::docs::close_all()));
  } catch (const gg::core::tool_error &failure) {
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.tool()));
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
    assert_eq!(lines[0], "notes.md true");
    // Closing something that is not open is `0` rather than a failure, so a program that tidies up
    // unconditionally does not have to guard every call.
    assert_eq!(lines[1], "1 0");
    assert_eq!(lines[2], "contents of notes.md");
    // A search hands the program a page it can read in the turn that asked for it — the count, the
    // echoed offset, and the hits themselves. The double models no catalogue, so the honest page is
    // an empty one; what this proves is the crossing, which is the half no other test covers on this
    // arm. The ranking over a real catalogue is the documentation runtime's own to prove.
    assert_eq!(lines[3], "0 0 0");
    // Closing documentation is the one part of this family a run buys, and this run did not: the
    // program is refused by the host, as the exception a C++ author catches, under the call's own
    // name rather than by a name that was never in scope — a compiled arm cannot withhold a name.
    assert_eq!(lines[4], "unavailable on close");
    assert_eq!(lines[5], "unavailable on close_all");
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

    // Two reads reached gg's dispatch and both arrived as `read_file`: the helper's, and the one
    // `gg::views::open_file` performs. Neither has a tool name of its own, which is exactly the point — a
    // helper is a spelling of the tool it is built on, and a view is a read gg also shows you.
    assert_eq!(log.names(), ["read_file", "read_file"]);
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
    gg::log(gg::programs::get(2));
  } catch (const gg::core::tool_error &failure) {
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
    // A session that has run nothing has an empty history — never a failure — and a turn it never
    // kept a program for is a `not_found` the program catches in C++'s own idiom.
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
    // Caught: an ordinary `catch` on `gg::core::tool_error` with a test on the code, which is what a program
    // that expects one failure and not the others writes. Nothing about it is exceptional —
    // `gg::core::tool_error` is a `std::runtime_error`, so `catch (const std::exception&)` sees it too and no
    // SDK-specific combinator is needed to compose with the standard library's own throws.
    let (outcome, _log) = run_with(
        r####"
  try {
    gg::log(gg::files::read_text_file("gone.cpp"));
  } catch (const gg::core::tool_error &failure) {
    if (failure.code() != gg::core::tool_error_code::not_found) throw;
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.tool()));
  }
  gg::log("carried on");
"####,
        &all_operations(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cpp".to_string())
        },
    );
    assert_eq!(
        logs(&outcome),
        ["not-found on read_text_file", "carried on"]
    );

    // Let out: gg's shell catches what escapes `main`, so an uncaught failure is a reported,
    // RECOVERABLE program error rather than a trap — and it carries the failed call's own gg code,
    // which is what the host classifies the turn by. That code is read off the `gg::core::tool_error` itself:
    // an arm whose uncaught gg failure was recorded as `other` would be an arm whose error rates a
    // study could not compare with any other.
    let (outcome, _log) = run_with(
        r####"
  gg::log("before");
  gg::files::read_text_file("gone.cpp");
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
            .contains("`read_text_file` failed (not-found): no such file: gone.cpp"),
        "the model reads gg's own sentence rather than a C++ type name: {}",
        error.message
    );
    assert_eq!(
        error.kind,
        crate::sandbox::outcome::ProgramErrorKind::ToolFailure,
        "an uncaught gg failure is classified from the CODE gg's shell read off the `gg::core::tool_error`;          without that it would land in `Other` beside a model that threw an `int`: {error:?}"
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
  } catch (const gg::core::tool_error &failure) {
    gg::log(std::format("{} on {}", gg::core::gg_name(failure.code()), failure.tool()));
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
    // one arm DISAGREEING at one vintage: `Sources/prelude.hpp` decides which headers the archive
    // carries and the catalogue's `libraries` section is reflected separately, so a header added to
    // one and not the other is a library gg offers a model and the compile refuses.
    let catalogue = catalogue();
    let named: Vec<&str> = section(&catalogue, "libraries")
        .iter()
        .flat_map(|group| group["modules"].as_array().expect("a group lists modules"))
        .map(|module| module.as_str().expect("a module is named by a string"))
        .collect();

    // The other direction, which nothing else closes: what the prelude really puts in front of a
    // program, read off the manifest `build.sh` wrote out of that same file. A header added to the
    // prelude and left out of a group heading would be a library this arm ships and never mentions.
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
        "the set a model is told it may include and the set the prelude really includes differ"
    );

    // And a program that reaches for a representative of each group, written the way a model writes
    // one: with no `#include` of the standard library at all, because the precompiled prelude is
    // already in front of it. The one include it does carry is gg's, which is the line every
    // program on this arm writes for itself.
    let outcome = evaluate(
        &prepare(&program(
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
    // does NOT list. The prelude is what is put in FRONT of a program, not an allowlist — clang's
    // default include path is the whole of libc++ — so what the catalogue's library set means for a
    // header outside it is a fact about this toolchain, measured here rather than inferred from the
    // list. It is what a compile failure naming that set is allowed to imply, and there are three
    // different answers, so each is one statement here.

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
        &crate::sandbox::PrepareContext::new(),
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
fn the_artifact_binds_exactly_the_tools_gg_offers() {
    // The one drift no source-level test can catch, asked of the artifact rather than of a source
    // file. On this arm the artifact cannot be STALE — it was compiled from this checkout's SDK
    // moments ago — so what it catches instead is the SDK's own per-object binding table falling out
    // of step with the functions beside it, which is the second, independent statement of the same
    // fact that makes asking the artifact worth anything.
    //
    // The language handed to the store is TypeScript's, and it changes nothing: an artifact is
    // supplied, so nothing reaches for a prebuilt guest, and this arm has no
    // `GgProgramLanguage` of its own until it is registered.
    let component = prepare(&program("  return 0;"));
    let mut bound = crate::sandbox::component_bound_tools(
        crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::TypeScript),
        Some(component),
    )
    .expect("a freshly compiled C++ program reports the tools its SDK binds");
    bound.sort();
    let mut expected: Vec<String> = crate::sandbox::signatures::sandbox_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    expected.sort();
    assert_eq!(
        bound, expected,
        "the SDK's own binding table and gg's tool vocabulary have drifted apart"
    );
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
            ("gg::core::tool_error", "gg::core::tool_error"),
            ("gg::core::tool_error_code", "gg::core::tool_error_code"),
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
            ("gg::views::open_view::close", "views.close"),
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
/// And the standard library the other way round, because the prompt makes a claim about it that is
/// the opposite claim: `std::vector` with no `#include` compiles, because the precompiled prelude
/// really does carry it. A program is told two different things about two different libraries and
/// both are true.
///
/// It compiles and never runs, so it instantiates no component: what a compiler refuses never
/// reaches a guest.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let compile = |source: &str| {
        super::compile::compile_program(source, &[], &crate::sandbox::PrepareContext::new())
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

    // And the half the prompt states positively: the standard library needs no line, because the
    // precompiled prelude carries it and carries nothing else.
    compile("int main() {\n  std::vector<int> values{1};\n  return (int)values.size() - 1;\n}\n")
        .expect(
            "the precompiled prelude declares the standard library with no line of the program's",
        );

    // **And the same question with a code module bound**, which is the one state in which this arm
    // has anything of gg's to put in front of a program that never asked. A module reaches gg's
    // whole surface through gg's own `#include` in its global module fragment, and the program that
    // binds it reaches the module's namespace and nothing else — so the same call is refused for
    // the same reason with a skill loaded as without one.
    let modules = [crate::sandbox::CodeModule {
        name: "csv_tools".to_string(),
        source: "std::string greeting() {\n  gg::log(\"from the module\");\n  return \
                 \"hi\";\n}\n"
            .to_string(),
    }];
    let with_module = |source: &str| {
        super::compile::compile_program(source, &modules, &crate::sandbox::PrepareContext::new())
    };
    with_module("int main() {\n  return (int)lib::csv_tools::greeting().size() - 2;\n}\n")
        .expect("a module a program binds reaches gg's surface through gg's own line");
    let bound = with_module(CALL).expect_err("a module in scope declares no gg name for a program");
    match bound {
        // Refused one step further in than the bare program above, and that is the module system
        // rather than a weaker answer: a name attached to the global module exists in the program's
        // translation unit and is not VISIBLE in it, which clang says by naming the include the
        // program has to write. Either way the call does not compile.
        crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(
            diagnostic,
        )) => assert!(
            diagnostic.starts_with("main.cpp:2:")
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
    let context = crate::sandbox::PrepareContext::new();
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
    super::compile::compile_program(&program, &[], &crate::sandbox::PrepareContext::new())
        .unwrap_or_else(|failure| {
            panic!("gg pushes a C++ program that does not compile into the transcript: {failure}\n\n{program}")
        });
}
