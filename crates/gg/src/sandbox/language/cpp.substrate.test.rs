//! **The C++ arm's execution substrate** — the real `clang++`, the real component encode and the
//! real guest, driven end to end: C++ the way a model would write it, really compiled by the
//! toolchain in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as an ordinary translation unit, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, spawning a
//! real `clang++` through the seam's own isolated invocation, in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) — and what comes back is not source but a
//! **component**, which is then compiled with
//! [`compile_bytes`](crate::sandbox::engine::compile_bytes), linked with
//! [`linker`](crate::sandbox::linker) (the production linker: the whole membrane plus the whole
//! ambient WASI surface), put in a [`bounded_store`](crate::sandbox::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](crate::sandbox::membrane::Sandbox) and driven through its `run` export.
//!
//! There is no committed artifact anywhere in that path, which is what makes this arm's proof
//! *stronger* than the interpreted arms': what these tests instantiate was compiled from this
//! checkout's WIT, this checkout's prelude and this checkout's shell, seconds earlier.
//!
//! # What is here and what is not
//!
//! That a whole C++ program compiles, encodes, instantiates and runs; that what it says reaches the
//! host through the real membrane; that `throw` and `catch` **work**, which is the thing this arm
//! has and no other compiled arm does; that the three ways a C++ program fails reach a model with
//! what they have to say and where; that a reply with no `main` is refused before it is compiled
//! rather than linked into a component that traps; that the reply is compiled **verbatim**, so every
//! diagnostic carries the model's own line; the two bands `clang++` produces between them; and the
//! claim the seam's own isolation gate rests on, which is that two preparations of one C++ program
//! produce byte-identical components.
//!
//! The gate itself is **not** here. This arm's own hand-pointed copy of it was deleted at
//! registration, exactly as [Rust](super::super::rust)'s and [Swift](super::super::swift)'s were:
//! the seam derives its language list from the registry, so from the moment `language: "cpp"`
//! resolves, this arm's program and module steps are driven sixteen ways along with every other
//! registered language's.
//!
//! The programs below are written the way a model writes one — `gg::log`, `fs::read_file`,
//! `text_edit::set` — because the SDK is what a program actually has. What they are *for* is still
//! the substrate: that the crossing happens, not that it is spelled well.
//! [`surface`](super::surface) is where the spelling is driven, function by function.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in them costs a
//! `clang++` — ~85 ms once the precompiled prelude is warm, and ~1.2 s more in the process that
//! builds it. So each function drives *many* programs rather than being one behaviour per function,
//! exactly as `sandbox.test.rs` does. Add a program to an existing function rather than adding a
//! function.

use std::time::Instant;

use test_cabinet_core::gg::GgProgramLanguage;

use super::compile::{self, compile_program};
use crate::sandbox::fake::{CallLog, FakeToolApi, canned_outcome};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, PrepareError, PrepareFailure, ProgramScope, SandboxLimits,
    bounded_store, engine, keep_reported_error, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
pub(super) fn prepare(source: &str) -> Vec<u8> {
    match compile_program(source, &[], &PrepareContext::new()) {
        Ok(prepared) => {
            assert!(
                prepared.source.is_empty(),
                "a compiled arm hands back a component, not source for one"
            );
            prepared
                .component
                .expect("the C++ prepare step compiles the component its program is evaluated by")
        }
        Err(failure) => panic!("the C++ toolchain did not compile this program: {failure}"),
    }
}

/// Evaluate an already-compiled component through the real membrane, with `enabled`'s gg tools
/// offered.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the resolution of the language
/// itself. Everything else is the production path, including
/// [`keep_reported_error`](crate::sandbox::keep_reported_error).
///
/// The [membrane state](MembraneState) is built with this arm, which is what a run resolves now
/// that `language: "cpp"` is a value an operator configures.
pub(super) fn evaluate(
    component: &[u8],
    enabled: &[String],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let compiled =
        engine::compile_bytes(component).expect("a freshly compiled C++ program is a component");
    let scope = ProgramScope {
        enabled,
        modules: &[],
        ending,
        library,
    };
    let mut store = bounded_store(
        MembraneState::new(
            api,
            crate::sandbox::language(GgProgramLanguage::Cpp),
            scope,
            limits,
            None,
        ),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, &compiled, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "a compiled C++ program instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(&mut store, "", &[], enabled, ending.into(), library)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    let returned = keep_reported_error(returned, &store);
    let (outcome, _api) = reclaim(store, returned, None, None, None);
    (outcome, log)
}

/// Compile and run one C++ program with no gg tool offered — the shape most cases here want.
fn run(source: &str) -> SandboxOutcome {
    evaluate(
        &prepare(source),
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0
}

/// What a program logged, insisting that the sandbox ran it and that it did not fail.
pub(super) fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program failed: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// The sandbox failure a program produced, insisting there was one.
pub(super) fn sandbox_error(outcome: &SandboxOutcome) -> &SandboxError {
    match &outcome.result {
        Err(error) => error,
        Ok(result) => panic!(
            "the program was expected to fail; it logged {:?} and reported {:?}",
            outcome.logs, result.error
        ),
    }
}

#[test]
fn a_real_cpp_program_runs_through_the_real_membrane() {
    // Ordinary C++23, exercising what a model actually writes — and deliberately three things a
    // *function body* would have refused outright: a `#include`, a `namespace`, and a `template`.
    // Plus a struct with a member function, a `std::map`, a ranges pipeline with a projection,
    // `std::format`, a structured binding, `std::optional` and `std::expected`. The point is not
    // that any one of them is doubtful — it is that a whole C++ program survives `clang++`, the
    // component encode and the crossing rather than a subset.
    let outcome = run("#include <algorithm>\n\
         #include <expected>\n\
         #include <format>\n\
         #include <map>\n\
         #include <optional>\n\
         #include <ranges>\n\
         #include <string>\n\
         #include <vector>\n\
         \n\
         namespace inventory {\n\
         \n\
         struct Entry {\n\
         \x20 std::string word;\n\
         \x20 int count;\n\
         \x20 std::string label() const { return std::format(\"{}={}\", word, count); }\n\
         };\n\
         \n\
         template <std::ranges::range R> int total(const R &rows) {\n\
         \x20 int sum = 0;\n\
         \x20 for (const auto &row : rows) sum += row.count;\n\
         \x20 return sum;\n\
         }\n\
         \n\
         std::expected<Entry, std::string> best(const std::vector<Entry> &rows) {\n\
         \x20 if (rows.empty()) return std::unexpected(\"nothing to rank\");\n\
         \x20 return rows.front();\n\
         }\n\
         \n\
         }  // namespace inventory\n\
         \n\
         int main() {\n\
         \x20 const std::string text = \"the quick brown fox the lazy dog the end\";\n\
         \x20 std::map<std::string, int> counts;\n\
         \x20 for (const auto part : std::views::split(text, ' ')) {\n\
         \x20   counts[std::string(part.begin(), part.end())] += 1;\n\
         \x20 }\n\
         \x20 std::vector<inventory::Entry> rows;\n\
         \x20 for (const auto &[word, count] : counts) rows.push_back({word, count});\n\
         \x20 std::ranges::sort(rows, [](const auto &a, const auto &b) {\n\
         \x20   return a.count != b.count ? a.count > b.count : a.word < b.word;\n\
         \x20 });\n\
         \x20 if (auto top = inventory::best(rows); top) {\n\
         \x20   log(std::format(\"top {}\", top->label()));\n\
         \x20 } else {\n\
         \x20   log(std::format(\"failed: {}\", top.error()));\n\
         \x20 }\n\
         \x20 log(std::format(\"distinct {} total {}\", rows.size(), inventory::total(rows)));\n\
         \x20 std::vector<std::string> shortest;\n\
         \x20 for (const auto &row : rows | std::views::filter([](const auto &row) {\n\
         \x20        return row.word.size() <= 3;\n\
         \x20      })) {\n\
         \x20   shortest.push_back(row.word);\n\
         \x20 }\n\
         \x20 std::ranges::sort(shortest);\n\
         \x20 std::string joined;\n\
         \x20 for (const auto &word : shortest) {\n\
         \x20   if (!joined.empty()) joined += \",\";\n\
         \x20   joined += word;\n\
         \x20 }\n\
         \x20 log(std::format(\"short {}\", joined));\n\
         \x20 return 0;\n\
         }\n");

    assert_eq!(
        logs(&outcome),
        ["top the=3", "distinct 7 total 9", "short dog,end,fox,the"],
        "a whole C++ program did not survive the crossing"
    );
}

#[test]
fn a_cpp_program_dispatches_a_real_call_through_the_membrane() {
    // `fs::read_file` takes a string and hands back a `std::variant`, which is the shortest round
    // trip this arm has through the membrane that is not a bare string. What it proves is that a
    // C++ program's arguments are lowered, that gg's host dispatches the tool, and that what comes
    // back is a value the program can compute with — through the SDK a model actually writes.
    let program = "#include <string>\n\
         int main() {\n\
         \x20 const auto read = fs::read_file(\"notes.md\");\n\
         \x20 const auto *text = std::get_if<text_file>(&read);\n\
         \x20 if (text == nullptr) {\n\
         \x20   log(\"that was a picture\");\n\
         \x20   return 1;\n\
         \x20 }\n\
         \x20 const std::string first = text->contents.substr(0, text->contents.find('\\n'));\n\
         \x20 std::string shouted;\n\
         \x20 for (char letter : first) shouted += (char)std::toupper((unsigned char)letter);\n\
         \x20 log(\"read \" + shouted);\n\
         \x20 return 0;\n\
         }\n";
    let (outcome, calls) = evaluate(
        &prepare(program),
        &["read_file".to_string()],
        RunEnding::None,
        false,
        canned_outcome,
    );

    assert_eq!(
        logs(&outcome),
        ["read CONTENTS OF NOTES.MD"],
        "a real membrane call did not come back into the program"
    );
    assert_eq!(
        calls.names(),
        ["read_file"],
        "a C++ program's call did not reach gg's tool dispatch"
    );
}

#[test]
fn a_cpp_program_throws_and_catches_which_no_other_compiled_arm_can_do() {
    // The thing this arm has that neither Rust nor Swift does: a working exception mechanism. It is
    // not a nicety — under `-fno-exceptions` every one of the lines below is a COMPILE error, so an
    // arm without this would be one where a model writing the language's own idiom fails on turn
    // one.
    //
    // Everything it takes is being exercised at once: `-fwasm-exceptions` with the standardised
    // encoding, libc++'s `eh` build, `-lunwind`, and `Config::wasm_exceptions` on gg's engine. Any
    // one of them missing and this program either does not link or does not load.
    let outcome = run("#include <stdexcept>\n\
         #include <string>\n\
         #include <vector>\n\
         struct TooSmall : std::runtime_error {\n\
         \x20 explicit TooSmall(const std::string &what) : std::runtime_error(what) {}\n\
         };\n\
         \n\
         static int checked(const std::vector<int> &values, std::size_t index) {\n\
         \x20 if (index >= values.size()) throw TooSmall(\"only \" + std::to_string(values.size()));\n\
         \x20 return values.at(index);\n\
         }\n\
         \n\
         int main() {\n\
         \x20 const std::vector<int> values{1, 2, 3};\n\
         \x20 try {\n\
         \x20   log(\"got \" + std::to_string(checked(values, 1)));\n\
         \x20   log(\"got \" + std::to_string(checked(values, 9)));\n\
         \x20 } catch (const TooSmall &failure) {\n\
         \x20   log(std::string(\"caught my own: \") + failure.what());\n\
         \x20 }\n\
         \x20 try {\n\
         \x20   (void)values.at(9);\n\
         \x20 } catch (const std::out_of_range &failure) {\n\
         \x20   log(\"caught the library's out_of_range\");\n\
         \x20 }\n\
         \x20 try {\n\
         \x20   (void)std::stoi(\"not a number\");\n\
         \x20 } catch (const std::exception &failure) {\n\
         \x20   log(\"caught stoi\");\n\
         \x20 }\n\
         \x20 log(\"still running\");\n\
         \x20 return 0;\n\
         }\n");

    assert_eq!(
        logs(&outcome),
        [
            "got 2",
            "caught my own: only 3",
            "caught the library's out_of_range",
            "caught stoi",
            "still running",
        ],
        "C++ exceptions did not survive the crossing"
    );
}

/// The model-facing error a program reported, insisting the sandbox ran it and that it failed.
pub(super) fn program_error(outcome: &SandboxOutcome) -> &crate::sandbox::outcome::ProgramError {
    match &outcome.result {
        Ok(result) => result.error.as_ref().unwrap_or_else(|| {
            panic!(
                "the program was expected to fail; it logged {:?}",
                outcome.logs
            )
        }),
        Err(error) => {
            panic!("that failure was a sandbox failure rather than the program's: {error}")
        }
    }
}

#[test]
fn the_three_ways_a_cpp_program_fails_reach_the_model_differently() {
    // This arm's error surface, which is the thing a study reads it for, so it is measured rather
    // than described. All three are here because they arrive by three different roads, and one of
    // them is a road no other compiled arm has.

    // 1. An uncaught throw, which arrives as a **recoverable, model-facing program error** carrying
    //    the exception's own class and its `what()`. That is what a C++ program failing SHOULD look
    //    like and it is not what it looks like by default: under `-fwasm-exceptions` an exception
    //    that escapes `main` never reaches `std::terminate` — it unwinds out of the module and
    //    becomes a host-visible wasm exception, which wasmtime reports as `thrown Wasm exception`
    //    and nothing else. gg's shell catches it, which is the C++ counterpart of the Rust arm's
    //    panic hook.
    //
    //    The class is the model's own, demangled: `inventory::TooSmall`, not `N9inventory8TooSmallE`
    //    and not `std::exception`.
    let uncaught = run("#include <stdexcept>\n\
         #include <string>\n\
         namespace inventory {\n\
         struct TooSmall : std::runtime_error {\n\
         \x20 explicit TooSmall(const std::string &what) : std::runtime_error(what) {}\n\
         };\n\
         }\n\
         \n\
         int main() {\n\
         \x20 log(\"before\");\n\
         \x20 throw inventory::TooSmall(\"gg substrate threw this\");\n\
         }\n");
    let error = program_error(&uncaught);
    assert!(
        error.message.contains("gg substrate threw this"),
        "an uncaught exception's own message did not reach the model: {}",
        error.message
    );
    assert!(
        error.message.contains("inventory::TooSmall"),
        "an uncaught exception's own class did not reach the model, demangled: {}",
        error.message
    );
    assert!(
        error.location.is_none(),
        "this arm cannot locate a caught exception and must not claim to: {:?}",
        error.location
    );
    assert_eq!(
        uncaught.logs,
        ["before"],
        "what the program logged before it failed was lost"
    );

    // A thrown value that is not a `std::exception` at all, which C++ allows and models write.
    // There is nothing to ask such a value, so what is reported is that it happened — still more
    // than `thrown Wasm exception`.
    let raw = run("int main() {\n\x20 log(\"before\");\n\x20 throw 42;\n}\n");
    assert!(
        program_error(&raw).message.contains("not a std::exception"),
        "a thrown `int` did not reach the model at all: {}",
        program_error(&raw).message
    );

    // 2. A libc++ HARDENING check. wasi-sdk ships libc++ configured to check NOTHING, and gg
    //    compiles every translation unit at `extensive` — so an out-of-bounds `operator[]` is a
    //    checked trap with the library's own message rather than a silent read of whatever was
    //    there. It traps rather than throwing, so gg's `catch` cannot stand in front of it; what
    //    carries the words is a synthetic inlined frame in the debug information, which is why
    //    `-g1` is what makes the sentence readable at all. It is the single largest thing standing
    //    between this arm and undefined behaviour.
    let hardened = run("#include <vector>\n\
         int main() {\n\
         \x20 std::vector<int> values{1, 2, 3};\n\
         \x20 log(\"before\");\n\
         \x20 log(std::to_string(values[9]));\n\
         \x20 return 0;\n\
         }\n");
    let failure = sandbox_error(&hardened).to_string();
    assert!(
        failure.contains("libc++ Hardening assertion") && failure.contains("index out of bounds"),
        "an out-of-bounds subscript did not carry libc++'s own words: {failure}"
    );
    assert!(
        failure.contains("main.cpp:"),
        "a hardening failure was not located at the model's own line, which is what `-g1` and the \
         engine's symbolication are for: {failure}"
    );
    assert!(
        !failure.contains("gg-wasi-sdk") && !failure.contains("/opt/gg/"),
        "the header that checked it was not shortened to gg's own toolchain prefix, so a model \
         reads ~90 characters of somebody's home directory on every frame: {failure}"
    );
    assert_eq!(hardened.logs, ["before"]);

    // 3. UNDEFINED BEHAVIOUR, which says nothing at all. A division by zero is a trap with no
    //    message and no class — the artifact's line table is the only thing that makes it a
    //    coordinate rather than an address, and there is nothing gg can do to make it more than
    //    that. This is the comparability risk this arm carries: in a run record, a failure the
    //    LANGUAGE caused here is hard to tell from a model that reasoned badly.
    let undefined = run(
        "         static int divide(int left, int right) { return left / right; }\n\
         \n\
         int main() {\n\
         \x20 log(\"before\");\n\
         \x20 int zero = 0;\n\
         \x20 log(std::to_string(divide(7, zero)));\n\
         \x20 return 0;\n\
         }\n",
    );
    let failure = sandbox_error(&undefined).to_string();
    assert!(
        failure.contains("main.cpp"),
        "an undefined-behaviour trap was not located in the model's own file, which is all `-g1` \
         can buy and all this failure has: {failure}"
    );
    assert!(
        !failure.contains("gg-prepare"),
        "the failure named gg's own temporary directory, which is gone by the time a model reads \
         it: {failure}"
    );
    assert_eq!(undefined.logs, ["before"]);
}

#[test]
fn what_a_program_writes_to_stderr_reaches_the_model() {
    // The guest's stderr is a real channel — ambient WASI gives every guest one, and gg keeps the
    // tail of it rather than letting it go to the run's own log. On this arm it is not merely
    // available but load-bearing: it is where libc++ puts BOTH of the failure messages the test
    // above reads. Here it is exercised the way a program would use it on purpose.
    let outcome = run("#include <cstdio>\n\
         int main() {\n\
         \x20 log(\"logged\");\n\
         \x20 std::fputs(\"gg substrate said this on stderr\\n\", stderr);\n\
         \x20 std::fflush(stderr);\n\
         \x20 std::abort();\n\
         }\n");

    let failure = sandbox_error(&outcome).to_string();
    assert!(
        failure.contains("gg substrate said this on stderr"),
        "what the program wrote to stderr did not reach the model: {failure}"
    );
    assert_eq!(outcome.logs, ["logged"]);
}

#[test]
fn a_reply_that_defines_no_main_is_refused_before_it_is_compiled() {
    // The one refusal this arm has, and the reason it exists is the surprising half: wasi-libc
    // references `main` WEAKLY, so a reply with no entry point LINKS. Without this refusal a model
    // would get a component that instantiates, traps immediately and says nothing about why — over
    // a turn whose program never ran, which round 1 established is the one failure a model cannot
    // recover from.
    let refused = compile_program(
        "#include <string>\n\nstatic std::string helper() { return \"nothing runs\"; }\n",
        &[],
        &PrepareContext::new(),
    );
    match refused {
        Err(PrepareFailure::Program(PrepareError::Unsupported(message))) => {
            assert!(
                message.contains("main"),
                "the refusal did not name what is missing: {message}"
            );
            assert!(
                message.contains("int main()"),
                "the refusal did not say what to write instead: {message}"
            );
        }
        other => panic!("a reply with no entry point is refused, not {other:?}"),
    }

    // And the linker really would have accepted it, which is what makes the refusal necessary rather
    // than defensive. The same source with a `main` that does nothing compiles and runs clean, so
    // the difference above is the entry point and not anything else about the program.
    let outcome = run("#include <string>\n\
         static std::string helper() { return \"something runs\"; }\n\
         \n\
         int main() {\n\
         \x20 log(helper());\n\
         \x20 return 0;\n\
         }\n");
    assert_eq!(logs(&outcome), ["something runs"]);
}

#[test]
fn a_code_module_is_linked_into_the_program_that_calls_it() {
    // The whole of the code-module path, through the real compiler and the real membrane: a module
    // is prepared on its own, the program that uses it is compiled against it, and the call
    // resolves. On this arm `lib::csv_tools::parse` is a NAME THE COMPILER RESOLVES rather than a
    // property looked up on a value, which is the visible consequence of a module being linked.
    compile::warm();
    let authored = "std::vector<std::string> split(std::string_view text, char sep = ',') {\n                      std::vector<std::string> out;\n                      std::string current;\n                      for (const char byte : text) {\n                        if (byte == sep) {\n                          out.push_back(current);\n                          current.clear();\n                          continue;\n                        }\n                        current.push_back(byte);\n                      }\n                      out.push_back(current);\n                      return out;\n                    }\n";
    let prepared = compile::compile_module(authored, &PrepareContext::new())
        .expect("an ordinary code module is prepared");
    // What comes back is the AUTHOR'S OWN BYTES, because the namespace is written under the key the
    // program knows and a module's own preparation is handed none — and the names its namespace
    // offers, read from that same source.
    assert_eq!(prepared.source, authored);
    assert_eq!(prepared.exports, vec!["split".to_string()]);

    let modules = [CodeModule {
        name: "csv_tools".to_string(),
        source: prepared.source.clone(),
    }];
    // The default argument the author wrote is the one the program gets, because nothing was
    // re-synthesized: the second call passes no separator at all.
    let component = compile_program(
        "int main() {\n           const auto fields = lib::csv_tools::split(\"a;b;c\", ';');\n           log(std::format(\"{} {}\", fields.size(), fields[1]));\n           log(std::format(\"{}\", lib::csv_tools::split(\"x,y\").size()));\n           return 0;\n         }\n",
        &modules,
        &PrepareContext::new(),
    )
    .expect("a program compiles against the module in its scope")
    .component
    .expect("a compiled arm hands back a component");
    let (outcome, _log) = evaluate(&component, &[], RunEnding::None, false, canned_outcome);
    assert_eq!(logs(&outcome), ["3 b", "2"]);

    // And the model's own line numbering is untouched by the module being there, which is what
    // `-include` buys over a prepended `#include` line: the diagnostic below is on line 2 of a
    // two-line program compiled with a module in front of it.
    let located = compile_program(
        "int main() {\n  return lib::csv_tools::split(1);\n}\n",
        &modules,
        &PrepareContext::new(),
    );
    match located {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => assert!(
            rendered.contains("main.cpp:2:"),
            "a diagnostic in a program compiled with a module is not at the model's own line: \
             {rendered}"
        ),
        other => panic!("a program that misuses a module is a compile error, not {other:?}"),
    }
}

#[test]
fn a_module_is_read_at_its_own_line_and_may_not_include_anything() {
    compile::warm();

    // A module that does not compile is reported AT THE AUTHOR'S OWN LINE, and that is the `#line`
    // directive doing its job: the declaration below is line 3 of what was written and line 5 of
    // what clang read.
    let broken = compile::compile_module(
        "int one() { return 1; }\n\n         std::string two() { return 2; }\n",
        &PrepareContext::new(),
    );
    match broken {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("module_module.hpp:3:"),
                "a module's diagnostic is not at its author's own line: {rendered}"
            );
        }
        other => panic!("a module that does not compile is a compile error, not {other:?}"),
    }

    // The one refusal this half has, made before any compiler runs — and it is not the compiler's
    // opinion: `#include <vector>` inside `namespace lib::<key>` would expand to NOTHING here,
    // because the prelude already read that header and its include guard is defined. The module
    // would compile, and the same line would detonate the day somebody wrote a header the prelude
    // does not carry.
    let included = compile::compile_module(
        "#include <vector>\nstd::vector<int> ones() { return {1}; }\n",
        &PrepareContext::new(),
    );
    match included {
        Err(PrepareFailure::Program(PrepareError::Unsupported(message))) => {
            assert!(message.starts_with("line 1:"), "{message}");
            assert!(message.contains("Delete the line"), "{message}");
        }
        other => panic!("a module carrying an include is refused, not {other:?}"),
    }

    // And the module that needs no include is the same module with the line taken out, which is
    // what makes the refusal a refusal rather than a loss: the prelude is in front of a module
    // exactly as it is in front of a program.
    let fine = compile::compile_module(
        "std::vector<int> ones() { return {1}; }\n",
        &PrepareContext::new(),
    )
    .expect("a module needs no include of its own");
    assert_eq!(fine.exports, vec!["ones".to_string()]);
}

#[test]
fn the_compiler_tells_a_rejected_program_from_a_toolchain_that_could_not_run() {
    // A program `clang++` rejected. One band, because C++ has no parse-only phase a program passes
    // before meaning is considered: an unclosed brace and a failed overload resolution are both an
    // `error:` from one invocation.
    let syntax = compile_program(
        "int main() {\n  int x = (1 + 2;\n  return x;\n}\n",
        &[],
        &PrepareContext::new(),
    );
    match syntax {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("error:"),
                "a rejected program did not carry the compiler's diagnostic: {rendered}"
            );
            assert!(
                rendered.contains("main.cpp:2"),
                "a diagnostic was not located in the model's own coordinates: {rendered}"
            );
        }
        other => panic!("an unclosed parenthesis is a program failure, not {other:?}"),
    }

    // A type error, which is the band a study reads: a program written whole and coherently, wrong
    // about the surface it was written against.
    let typed = compile_program(
        "#include <string>\nint main() {\n  std::string total = 12;\n  return 0;\n}\n",
        &[],
        &PrepareContext::new(),
    );
    match typed {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("main.cpp:3"),
                "a type error was not located in the model's own coordinates: {rendered}"
            );
        }
        other => panic!("a type error is a program failure, not {other:?}"),
    }

    // A template error, which in C++ is reported INSIDE the library with a note pointing at the
    // model's own line. An arm that read only the error's path would file the most ordinary C++
    // mistake there is under "gg's toolchain broke".
    let template = compile_program(
        "#include <format>\n\
         struct Widget {};\n\
         int main() {\n\
         \x20 (void)std::format(\"{}\", Widget{});\n\
         \x20 return 0;\n\
         }\n",
        &[],
        &PrepareContext::new(),
    );
    match template {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("main.cpp:4"),
                "a template error did not carry the note naming the model's own line: {rendered}"
            );
        }
        other => panic!("a template error is the model's program, not {other:?}"),
    }

    // A compiler that is not there at all. Never a diagnostic, because nothing was decided about the
    // program — and the message names what an operator can fix.
    let missing = temp_env(
        compile::WASI_SDK_HOME_ENV,
        "/nonexistent/gg-wasi-sdk",
        || {
            compile_program(
                "int main() { log(\"hi\"); return 0; }\n",
                &[],
                &PrepareContext::new(),
            )
        },
    );
    match missing {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(
                message.contains("/nonexistent/gg-wasi-sdk"),
                "the toolchain failure did not say where gg looked: {message}"
            );
            assert!(
                message.contains(compile::WASI_SDK_HOME_ENV),
                "the toolchain failure did not name the variable that fixes it: {message}"
            );
        }
        other => panic!("a missing toolchain is not the model's failure: {other:?}"),
    }
}

#[test]
fn a_cpp_program_is_compiled_verbatim() {
    // The property this arm shares with Swift and with no other: the bytes the model wrote are the
    // bytes the compiler reads. A wrapper of even one line would put every diagnostic and every
    // located trap one line out, and gg would have to subtract it everywhere — so this asserts the
    // offset is zero by making the error's line arbitrary rather than first.
    let program = "int main() {\n\
                   \x20 int a = 1;\n\
                   \x20 int b = 2;\n\
                   \x20 int c = 3;\n\
                   \x20 int d = missingName;\n\
                   \x20 return a + b + c + d;\n\
                   }\n";
    match compile_program(program, &[], &PrepareContext::new()) {
        Err(PrepareFailure::Program(PrepareError::Compile(rendered))) => {
            assert!(
                rendered.contains("main.cpp:5:11"),
                "the model's line and column were not the compiler's: {rendered}"
            );
        }
        other => panic!("an unresolved name is a program failure, not {other:?}"),
    }

    // And the reverse: an `#include`, a `namespace` and a `template` all compile, which is the whole
    // reason a reply is a translation unit rather than a function body — a `template` may not be
    // declared at block scope at all.
    let outcome = run("#include <string>\n\
         namespace greeting {\n\
         template <typename T> std::string shout(const T &value) {\n\
         \x20 std::string text = std::string(value);\n\
         \x20 for (auto &letter : text) letter = (char)std::toupper((unsigned char)letter);\n\
         \x20 return text;\n\
         }\n\
         }\n\
         \n\
         int main() {\n\
         \x20 log(greeting::shout(\"hello\"));\n\
         \x20 return 0;\n\
         }\n");
    assert_eq!(logs(&outcome), ["HELLO"]);
}

#[test]
fn the_prelude_is_precompiled_once_and_read_only_afterwards() {
    // The decision this arm's affordability rests on. Parsing the prelude costs ~850 ms of EVERY
    // compile and reading it back precompiled costs ~40 ms, which is the difference between an 85 ms
    // floor and a second.
    //
    // What is asserted is what the seam's contract asks: that the artifact exists where a shared
    // toolchain directory puts it, and that it is SEALED — because a shared tree a compilation can
    // write to is the measured `purs` corruption exactly, and this is the one shared file on this arm
    // that gg produces rather than ships.
    let component = prepare("int main() { log(\"warm\"); return 0; }\n");
    assert!(!component.is_empty());

    let home = compile::wasi_sdk_home().expect("resolving the wasi-sdk home never fails");
    let guest = compile::guest().expect("the committed C++ guest unpacks");
    let prelude = compile::precompiled_prelude(&home, guest, &PrepareContext::new())
        .expect("the prelude precompiles");
    let metadata = std::fs::metadata(&prelude).expect("the precompiled prelude is on disk");
    assert!(
        metadata.len() > 1024 * 1024,
        "a {} byte precompiled prelude is not the ~26 MB one this arm builds",
        metadata.len()
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            metadata.permissions().mode() & 0o222,
            0,
            "{} is writable inside a shared toolchain directory",
            prelude.display()
        );
    }

    // And what it buys, which is the arm's whole cost argument: a program that includes NOTHING
    // still has the standard library, because the prelude is in front of it. A model that writes
    // `#include <vector>` anyway gets the same program — the include is a second, free read of a
    // header the preamble already saw.
    let outcome = run("int main() {\n\
         \x20 std::vector<int> values{3, 1, 2};\n\
         \x20 std::ranges::sort(values);\n\
         \x20 log(std::format(\"{} {} {}\", values[0], values[1], values[2]));\n\
         \x20 return 0;\n\
         }\n");
    assert_eq!(logs(&outcome), ["1 2 3"]);
}

#[test]
fn what_compiling_a_cpp_program_cost_is_a_reading_the_seam_can_take() {
    // The compile is this arm's dominant per-turn cost and the number a cross-language study is for,
    // so it is measured here rather than assumed — on both paths, because a program the compiler
    // REJECTED cost exactly as much as one it accepted and an arm that reported only the successes
    // would understate itself by every failed turn.
    //
    // Bounds rather than a figure: the reading is a wall clock on a shared machine. What would fail
    // this is a compile that did not happen at all.
    compile::warm();
    let _ = prepare("int main() { log(\"warmed\"); return 0; }\n");

    let started = Instant::now();
    let _ = prepare("int main() { log(\"compiled\"); return 0; }\n");
    let accepted = started.elapsed();

    let started = Instant::now();
    let rejected = compile_program(
        "#include <string>\nint main() { std::string x = 12; return 0; }\n",
        &[],
        &PrepareContext::new(),
    );
    let refused = started.elapsed();

    assert!(rejected.is_err(), "that program does not compile");
    assert!(
        accepted.as_millis() > 10,
        "a C++ compile that took {accepted:?} did not run a compiler"
    );
    assert!(
        refused.as_millis() > 10,
        "a C++ rejection that took {refused:?} did not run a compiler"
    );
}

#[test]
fn what_a_compiled_cpp_program_weighs_is_a_per_turn_cost() {
    // Two figures a study needs and neither is an accident: the artifact is compiled by the engine
    // on **every** turn, because this arm has no committed component to compile once — so its size
    // is a per-turn cost in a way no interpreted arm's is.
    //
    // The band is wide and low-sided on purpose. What would fail it is a jump, and a jump would mean
    // the link stopped dead-stripping or something new became reachable from the shell.
    let started = Instant::now();
    let component = prepare("int main() { log(\"weighed\"); return 0; }\n");
    let compiled = started.elapsed();

    assert!(
        (128 * 1024..=8 * 1024 * 1024).contains(&component.len()),
        "a small compiled C++ program is {} bytes, outside the documented 128 KiB-8 MiB band — \
         libc++ is statically linked into every artifact, so a jump here means something new became \
         reachable",
        component.len()
    );

    // Printed rather than asserted, because it is the arm's cost rather than its correctness and a
    // shared machine is the wrong place to fail over a stopwatch. `cargo nextest run --no-capture`
    // is where the figures this arm's documentation quotes come from.
    let started = Instant::now();
    engine::compile_bytes(&component).expect("a freshly compiled C++ program is a component");
    println!(
        "clang++ and the component encode {compiled:?}; wasmtime Component::new {:?}; {} bytes",
        started.elapsed(),
        component.len()
    );

    let (outcome, _log) = evaluate(&component, &[], RunEnding::None, false, canned_outcome);
    assert_eq!(logs(&outcome), ["weighed"]);
}

// ---------------------------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------------------------

/// Compile `source` and hand back the component's bytes, or what the toolchain said.
fn artifact(source: &str, context: &PrepareContext) -> Result<Vec<u8>, String> {
    compile_program(source, &[], context)
        .map_err(|failure| failure.to_string())
        .map(|prepared| {
            prepared
                .component
                .expect("a compiled arm hands back a component")
        })
}

#[test]
fn two_preparations_of_one_program_are_byte_identical() {
    // The claim the [seam's isolation gate](crate::sandbox::language::isolation) rests on for this
    // arm, asserted on its own so that a failure there is read as an isolation failure rather than
    // as a compiler that started stamping something.
    //
    // It is a stronger claim than either of the other compiled arms can make, and it is why this
    // arm is the only one that hands that gate WHOLE artifacts rather than a projection with its
    // compiler's entropy set aside. Swift's artifacts differ across 1.5 MB of debug sections and a
    // 16-byte module hash for reasons that are the isolation contract working as designed. clang
    // records only the paths, and `-ffile-prefix-map` rewrites the one path that is per-preparation
    // to a fixed name.
    //
    // The marker rides inside a CALL'S ARGUMENT, where a compiler that eliminates dead code cannot
    // drop it — which on this arm is not a precaution: the link runs `--gc-sections`, and a marker
    // in an unused constant would vanish from every artifact.
    compile::warm();
    let marker = "gg-isolation-identical-marker";
    let source = format!("int main() {{\n  log(\"{marker}\");\n  return 0;\n}}\n");
    let first = artifact(&source, &PrepareContext::new()).expect("the subject compiles");
    let second = artifact(&source, &PrepareContext::new()).expect("the subject compiles");
    assert_eq!(
        first, second,
        "two preparations of one C++ program produced different bytes — if a compiler flag started \
         recording something per-invocation, this arm needs a stable projection the way the Swift \
         arm does, and the seam's isolation gate must be told about it rather than left failing \
         over it"
    );
    assert!(
        first
            .windows(marker.len())
            .any(|window| window == marker.as_bytes()),
        "the artifact does not carry its own program's marker, so the seam's gate — which searches \
         for exactly this — would assert nothing"
    );
}

/// Run `body` with `key` set to `value` in this process's environment, and put it back afterwards.
///
/// Serialised on nothing, because these tests are the only readers of this variable and each
/// `#[test]` is its own process under `cargo nextest` — so the only race is within one test
/// function, and there is none.
fn temp_env<T>(key: &str, value: &str, body: impl FnOnce() -> T) -> T {
    let previous = std::env::var_os(key);
    // SAFETY: single-threaded within this test, and restored below.
    unsafe { std::env::set_var(key, value) };
    let outcome = body();
    match previous {
        Some(had) => unsafe { std::env::set_var(key, had) },
        None => unsafe { std::env::remove_var(key) },
    }
    outcome
}
