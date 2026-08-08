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

use serde_json::{Value, json};

use super::substrate::{evaluate, logs, prepare};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::SandboxOutcome;
use crate::tools::{ToolFailure, ToolOutcome};

/// The catalogue this arm commits, read as a **document** rather than through
/// [`SignatureCatalogue`](crate::sandbox::signatures) — deliberately, and on this arm necessarily.
///
/// Deliberately, because the parsed reading is a *projection* and a field the parser does not model
/// is one these tests could not notice was missing. Necessarily, because this arm is not
/// [registered](super::super::ProgramLanguage) yet: `language: "cpp"` is not a
/// [`GgProgramLanguage`](test_cabinet_core::gg::GgProgramLanguage) anything can deserialise into
/// until it is, and the catalogue lands first so the surface it describes can be reviewed before it
/// is switched on.
const SIGNATURES: &str = include_str!("../guests/cpp.signatures.json");

/// Another arm's catalogue, to compare **identity** against.
///
/// [Rust](super::super::rust)'s, because it is the closest arm in shape — an object is a
/// namespace-like path, an optional argument is a record — and therefore the one whose *spellings*
/// this arm's most resemble while still differing everywhere the two languages do. The
/// [agreement gate](super::agreement) will make this comparison for real the day this arm is
/// registered; making it here is what stops that day from being the first time anybody looked.
const OTHER_ARM: &str = include_str!("../guests/rust.signatures.json");

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

/// A whole program out of a body of statements, which is what C++ needs and no other arm does.
///
/// It is the one place these tests add anything to what a model would write, and it adds the two
/// lines C++ has no top level to do without. Nothing else is prepended: the SDK is in scope because
/// the prelude put it there, which is the claim being made.
fn program(body: &str) -> String {
    format!("int main() {{\n{body}\n  return 0;\n}}\n")
}

/// Compile and run one C++ program with `enabled`'s tools offered and no ending group.
fn run_with(
    body: &str,
    enabled: &[String],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(&program(body)),
        enabled,
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
/// initialiser lowered onto the wrong wire slot, a `text_edit::clear()` read as "leave it alone"
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
            statement: r#"system::shell("npm test", 30.0);"#,
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: r#"fs::read_file("src/a.cpp", {.offset = 2, .limit = 5});"#,
            expected: || json!({ "path": "src/a.cpp", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: r#"fs::write_file("out.txt", "hello");"#,
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: r#"fs::edit_file("src/a.cpp", "alpha", "beta");"#,
            expected: || json!({ "path": "src/a.cpp", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: r#"fs::list_dir("src");"#,
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            statement: r#"skills::read_skill("testing");"#,
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: r#"memory::write_memory("layout", "d", "b");"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "body": "b",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "update_memory",
            statement: r#"memory::update_memory("layout", "d2", "b2");"#,
            expected: || {
                json!({ "name": "layout", "description": "d2", "body": "b2",
                        "code": null, "onUse": null })
            },
        },
        Crossing {
            tool: "create_memory",
            // The one crossing that carries a memory's CODE, and the one that fills in a single
            // field of an options aggregate by name and leaves the other at its default.
            statement: r#"memory::create_memory("layout", "d", "b",
                                                {.code = "int one() { return 1; }"});"#,
            expected: || {
                json!({ "name": "layout", "description": "d", "contents": "b",
                        "code": "int one() { return 1; }", "onUse": null })
            },
        },
        Crossing {
            tool: "read_memory",
            statement: r#"memory::read_memory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: r#"memory::edit_memory("layout", "old", "new");"#,
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: r#"memory::search_memories({"cargo", "nextest"});"#,
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: r#"memory::delete_memory("layout");"#,
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: r#"tasks::add_task("t1", "T", {.description = "D", .blocked_by = {"t0"}});"#,
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: r#"tasks::update_task("t1", {.title = "T2",
                                                   .description = text_edit::clear(),
                                                   .status = task_status::in_progress});"#,
            expected: || {
                // `text_edit::clear()` is what CLEARS it — a default-constructed `text_edit` is what
                // leaves it alone — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: r#"tasks::set_blocked_by("t1", {});"#,
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
            statement: r#"project::create_epic("epc", "E", "D");"#,
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: r#"project::create_issue("I", "s", "o", "c", "worker",
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
            statement: r#"project::update_issue("i1", {.status = issue_status::done,
                                                      .epic = epic_assignment::ungroup()});"#,
            expected: || {
                // `epic_assignment::ungroup()` ungroups the issue, which gg's schema spells as the
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
            statement: r#"project::set_issue_blocked_by("i1", {"i0"});"#,
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: r#"project::remove_epic("e1");"#,
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: r#"project::remove_issue("i1");"#,
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: r#"project::wait_for_issue("i1");"#,
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: r#"context::evict_file_view("src/a.cpp");"#,
            expected: || json!({ "path": "src/a.cpp" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is an ordinary aggregate here, so a list of them is a list of braced
            // pairs. C++ has no value type for a closed integer range — `std::ranges::iota_view` is
            // a sequence, which a span of turn numbers is not — so this is the one place the arm
            // spells with a record what Rust spells with `4..=19`.
            statement: r#"context::archive_thread({{4, 19}, {30, 35}});"#,
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: r#"context::search_archive("the parser");"#,
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: r#"context::compact("scaffolded the page", {"src/main.cpp"});"#,
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/main.cpp"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is one value with two named factories rather than one of two optional
            // arguments, so "both" and "neither" are programs that do not compile.
            statement: r#"agents::spawn_subagent("subagent", brief::prompt("write the lexer"));"#,
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            // The one function this SDK spells as an OVERLOAD PAIR rather than a default argument,
            // because "every outstanding child" and "these children" are two calls in C++ and an
            // `std::optional<std::vector<…>>` would have made the common one write `std::nullopt`.
            statement: r#"agents::wait_for_subagents({"agent-1"});"#,
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: r#"agents::send_message("agent-1", "prefer the simpler parser");"#,
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: r#"agents::transition_state("verify", "the build is green");"#,
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: r#"agents::exec("Builder", "pick it up from here");"#,
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: r#"agents::fork("try the other fix");"#,
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_tool_crosses_the_membrane_from_its_cpp_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: a compile here is ~85 ms warm, so thirty-five of
    // them would be three seconds of `clang++` for a table that reads the same. It is also the
    // stronger check — the calls must arrive in the order the program made them, so a call that
    // reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    let body = crossings
        .iter()
        .map(|crossing| format!("  {}\n", crossing.statement))
        .collect::<String>();
    let (outcome, log) = run_with(&body, &all_tools(), canned_outcome);
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
    // Two of the four families that are NOT gg tools, so neither appears in the crossing table
    // above — and both are where a program puts something in front of the model, which makes them
    // the ones a silent bridging mistake would cost the most.
    let (outcome, log) = evaluate(
        &prepare(&program(
            r####"
  const std::string text = fs::read_text_file("notes.md", {.offset = 1, .limit = 2});
  const auto read = view::open_file("notes.md", {.offset = 1, .limit = 2});
  view::open_text("summary", text);
  view::open_docs_view("read_file");
  const std::uint32_t closed = view::close("summary");
  const std::uint32_t missing = view::close("never opened");
  const auto open = view::current();
  const auto directory = fs::list();
  log(std::format("{} {}", open[0].selector, open[0].kind == view_kind::file));
  log(std::format("{} {}", closed, missing));
  const std::string shown = std::holds_alternative<text_file>(read)
                                ? std::get<text_file>(read).contents
                                : std::get<image_file>(read).label;
  log(shown.substr(0, shown.find('\n')));
  std::string names;
  for (const auto &function : directory) {
    if (!names.empty()) names += ",";
    names += function.name;
  }
  log(names);
  harness::finish("read the file and showed myself the result");
"####,
        )),
        &all_tools(),
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
    assert_eq!(lines[3], "fsFunction");
    // Every view the program opened is recorded, the documentation one included.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes.md", "summary", "read_file"]
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
    // `view::open_file` performs. Neither has a tool name of its own, which is exactly the point — a
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
  log(std::to_string(programs::history().size()));
  try {
    log(programs::get(2));
  } catch (const tool_error &failure) {
    log(std::string(gg_name(failure.code())));
  }
  programs::rerun("int main() { log(\"again\"); return 0; }");
  review::request_changes({"widen the test", "name the file"});
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
        &prepare(&program("  review::approve();")),
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
    // Caught: an ordinary `catch` on `tool_error` with a test on the code, which is what a program
    // that expects one failure and not the others writes. Nothing about it is exceptional —
    // `tool_error` is a `std::runtime_error`, so `catch (const std::exception&)` sees it too and no
    // SDK-specific combinator is needed to compose with the standard library's own throws.
    let (outcome, _log) = run_with(
        r####"
  try {
    log(fs::read_text_file("gone.cpp"));
  } catch (const tool_error &failure) {
    if (failure.code() != tool_error_code::not_found) throw;
    log(std::format("{} on {}", gg_name(failure.code()), failure.tool()));
  }
  log("carried on");
"####,
        &all_tools(),
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(ToolFailure::NotFound, "no such file: gone.cpp".to_string())
        },
    );
    assert_eq!(logs(&outcome), ["not-found on read_file", "carried on"]);

    // Let out: gg's shell catches what escapes `main`, so an uncaught failure is a reported,
    // RECOVERABLE program error rather than a trap — and it carries the failed call's own gg code,
    // which is what the host classifies the turn by. That code is read off the `tool_error` itself:
    // an arm whose uncaught gg failure was recorded as `other` would be an arm whose error rates a
    // study could not compare with any other.
    let (outcome, _log) = run_with(
        r####"
  log("before");
  fs::read_text_file("gone.cpp");
  log("after");
"####,
        &all_tools(),
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
        "an uncaught gg failure is classified from the CODE gg's shell read off the `tool_error`;          without that it would land in `Other` beside a model that threw an `int`: {error:?}"
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
    fs::write_file("out.txt", "hello");
  } catch (const tool_error &failure) {
    log(std::format("{} on {}", gg_name(failure.code()), failure.tool()));
  }
  log("carried on");
"####,
        &["read_file".to_string()],
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
    // compiled by the production prepare step against the committed archive, can name them — which
    // is the promise the prompt makes and the one a stale archive would break silently.
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
    // one: with no `#include` at all, because the precompiled prelude is already in front of it.
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
  log(std::format("{} {} {} {} {} {} {} {}", values[0], parsed.value_or(-1), built.str(),
                  matched, (int)(pi * 100), rolled > 0, span.count(),
                  std::to_underlying(entry_kind::directory)));
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
    // The direction [`cpp_reaches_every_library`] does not close, and the one the prompt gets wrong
    // if nobody looks: what happens to a header this arm does NOT list. The prelude is what is put
    // in FRONT of a program, not an allowlist — clang's default include path is the whole of libc++
    // — so the three sentences `system-code.cpp.hbs` writes about this have to be measured against
    // the toolchain rather than assumed from the list.
    //
    // Each of the three is one statement here, and together they are the whole claim.

    // 1. A standard header off the set **resolves, compiles, links and runs**. `<iostream>` is off
    //    the set because nothing reads a program's stdout, not because it is unavailable — and a
    //    prompt that said otherwise would cost a model a turn on a program it was told to avoid.
    let reached = evaluate(
        &prepare(
            "#include <iostream>\n\
             #include <sstream>\n\
             int main() {\n\
             \x20 std::ostringstream built;\n\
             \x20 built << \"off the set\";\n\
             \x20 std::cout << built.str() << std::endl;\n\
             \x20 log(built.str());\n\
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
        "a standard header off this arm's set must still compile and run, and the prompt says so"
    );

    // 2. `<thread>` is the one the prompt makes a specific promise about, so the promise is the
    //    assertion: it compiles, it links, and the failure is at RUN time — a recoverable,
    //    model-facing `system_error` carrying libc++'s own sentence, not a diagnostic and not
    //    silence. This is the arm's honest position beside Rust's, whose `std::thread::spawn` also
    //    compiles and then does nothing at all.
    let threaded = evaluate(
        &prepare(
            "#include <thread>\n\
             int main() {\n\
             \x20 log(\"before\");\n\
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
        "a `std::thread` must fail at run time with libc++'s own sentence, which is what the \
         prompt tells a model to expect: {}",
        failure.message
    );
    // Spelled the way the model would write it. gg's shell demangles the class by hand and drops
    // libc++'s inline namespace, so this is `std::system_error` and not `std::__2::system_error` —
    // a name a model asked to catch would have to be told to write back wrongly.
    assert!(
        failure.message.contains("uncaught std::system_error:"),
        "the run-time failure a model is promised is a `std::system_error`, spelled the way it \
         would catch one: {}",
        failure.message
    );
    assert_eq!(
        threaded.logs,
        ["before"],
        "the work a threaded program did before it reached the constructor was lost"
    );

    // 3. And what really is `file not found` is a header that is not the standard library's — which
    //    is the sentence the prompt may keep, because there is nothing here to fetch one from. A
    //    model-facing compile error at the model's own line, not a toolchain failure.
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
                "a third-party header is the one thing the prompt promises is `file not found`, at \
                 the model's own line: {rendered}"
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
    // supplied, so nothing reaches for a committed guest, and this arm has no
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
fn the_committed_catalogue_describes_the_surface_the_sdk_offers() {
    let catalogue = catalogue();
    assert_eq!(catalogue["language"], "cpp");
    assert_eq!(
        text(&catalogue, "generatedFrom"),
        "packages/gg-sandbox-cpp/Sources/sdk/ (clang++ -ast-dump=json)"
    );

    // One entry per gg tool, under gg's own name, and nothing else. On this arm the `tool` and the
    // `name` coincide for all thirty-five, because gg's vocabulary is `snake_case` and so is this
    // SDK — which is a spelling that happens to agree rather than an identity being borrowed, and
    // the reason `catalogue.py` still writes both.
    let mut tools: Vec<&str> = section(&catalogue, "tools")
        .iter()
        .map(|entry| text(entry, "tool"))
        .collect();
    let mut vocabulary = crate::sandbox::signatures::sandbox_tool_names();
    tools.sort_unstable();
    vocabulary.sort_unstable();
    assert_eq!(tools, vocabulary);
    for entry in section(&catalogue, "tools") {
        assert_eq!(
            text(entry, "tool"),
            text(entry, "name"),
            "this SDK spells a tool the way gg does; if that changes the two must still be an \
             identity and a spelling rather than one string used twice"
        );
    }

    // The twelve objects, in the order a model is presented with them, each with the one line it is
    // introduced by — which is the first paragraph of its namespace's own documentation.
    assert_eq!(
        section(&catalogue, "objects")
            .iter()
            .map(|object| text(object, "object"))
            .collect::<Vec<_>>(),
        [
            "fs", "system", "project", "tasks", "memory", "view", "context", "agents", "skills",
            "programs", "harness", "review"
        ]
    );

    // Nothing a model reads is blank, anywhere. The agreement gate makes this check the day this arm
    // is registered; making it here is what stops the catalogue from landing with a hole in it.
    for name in ["meta", "session", "views", "programs", "tools", "helpers"] {
        for entry in section(&catalogue, name) {
            let what = text(entry, "name");
            assert!(
                !text(entry, "doc").is_empty(),
                "`{what}` has no documentation"
            );
            let shapes = entry["signatures"]
                .as_array()
                .expect("an entry has signatures");
            assert!(!shapes.is_empty(), "`{what}` has no signature");
            for shape in shapes {
                let signature = text(shape, "signature");
                assert!(
                    signature.starts_with(what),
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
    }

    // Every type a signature mentions is declared, with its own documentation and its own members'.
    let declared: Vec<&str> = section(&catalogue, "types")
        .iter()
        .map(|declaration| text(declaration, "name"))
        .collect();
    for declaration in section(&catalogue, "types") {
        let name = text(declaration, "name");
        assert!(
            !text(declaration, "doc").is_empty(),
            "`{name}` is undocumented"
        );
        assert!(
            !text(declaration, "declaration").is_empty(),
            "`{name}` has no declaration"
        );
        for member in declaration["members"]
            .as_array()
            .expect("members is a list")
        {
            assert!(
                !text(member, "doc").is_empty(),
                "`{name}::{}` is undocumented",
                text(member, "name")
            );
        }
    }
    for name in ["meta", "session", "views", "programs", "tools", "helpers"] {
        for entry in section(&catalogue, name) {
            for referenced in entry["types"].as_array().expect("types is a list") {
                let referenced = referenced.as_str().expect("a type name is a string");
                assert!(
                    declared.contains(&referenced),
                    "`{}` refers to `{referenced}`, which nothing declares",
                    text(entry, "name")
                );
            }
        }
    }

    // The two things this arm's spelling does that no other's does, asserted so a rewrite has to
    // mean it: a default argument written into the signature, and the one overload pair.
    let read_file = section(&catalogue, "tools")
        .iter()
        .find(|entry| text(entry, "tool") == "read_file")
        .expect("read_file is catalogued");
    assert_eq!(
        text(&read_file["signatures"][0], "signature"),
        "read_file(std::string_view path, read_window window = {}) -> file_read"
    );
    // A `std::variant` alias closes over its ALTERNATIVES, which is the one place a type reference
    // is not a member of anything: a model shown `using file_read = std::variant<text_file,
    // image_file>` and neither alternative has been shown nothing at all.
    assert_eq!(
        read_file["types"]
            .as_array()
            .expect("types is a list")
            .iter()
            .map(|name| name.as_str().expect("a type name is a string"))
            .collect::<Vec<_>>(),
        [
            "read_window",
            "file_read",
            "tool_error",
            "tool_error_code",
            "text_file",
            "image_file"
        ]
    );

    let wait = section(&catalogue, "tools")
        .iter()
        .find(|entry| text(entry, "tool") == "wait_for_subagents")
        .expect("wait_for_subagents is catalogued");
    assert_eq!(
        wait["signatures"].as_array().map(Vec::len),
        Some(2),
        "the one function this SDK spells as an overload pair carries two signatures"
    );
}

#[test]
fn the_catalogue_agrees_with_another_arms_by_identity() {
    // What the agreement gate will compare the day this arm is registered, compared now: two
    // catalogues describe the SAME capabilities, and only their spellings differ. An arm whose SDK
    // quietly lost a function would otherwise be a green test suite and an invalidated experiment,
    // and it would stay one until registration.
    let mine = catalogue();
    let theirs: Value = serde_json::from_str(OTHER_ARM).expect("the Rust arm's catalogue is JSON");

    // Identity is the section, the key, the object it hangs off, the gate that binds it and the
    // ending role whose programs get it. Everything else — the name, the prose, the whole shape of
    // the call — is free.
    let identity = |catalogue: &Value| -> Vec<String> {
        let mut out = Vec::new();
        for name in ["meta", "session", "views", "programs", "tools", "helpers"] {
            for entry in section(catalogue, name) {
                let key = entry
                    .get("key")
                    .or_else(|| entry.get("tool"))
                    .and_then(Value::as_str)
                    .expect("an entry carries a key or a tool name");
                let object = entry.get("object").and_then(Value::as_str).unwrap_or("-");
                let gate = entry.get("requires").and_then(Value::as_str).unwrap_or("-");
                let ending = entry.get("ending").and_then(Value::as_str).unwrap_or("-");
                out.push(format!("{name} {key} {object} {gate} {ending}"));
            }
        }
        out.sort();
        out
    };
    assert_eq!(
        identity(&mine),
        identity(&theirs),
        "the C++ arm and the Rust arm describe different capabilities, so a study comparing them \
         would be measuring the surface rather than the language"
    );

    // And the objects, in the same order, with the same descriptions — because the order is
    // model-facing and the description is gg's rather than a language's.
    let objects = |catalogue: &Value| -> Vec<(String, String)> {
        section(catalogue, "objects")
            .iter()
            .map(|object| {
                (
                    text(object, "object").to_string(),
                    text(object, "doc").to_string(),
                )
            })
            .collect()
    };
    assert_eq!(objects(&mine), objects(&theirs));

    // The spellings really do differ, which is the other half of the claim: a gate that passed
    // because both arms were the same file would say nothing at all.
    let signature = |catalogue: &Value| -> String {
        section(catalogue, "tools")
            .iter()
            .find(|entry| text(entry, "tool") == "read_file")
            .map(|entry| text(&entry["signatures"][0], "signature").to_string())
            .expect("read_file is catalogued")
    };
    assert_ne!(signature(&mine), signature(&theirs));
}
