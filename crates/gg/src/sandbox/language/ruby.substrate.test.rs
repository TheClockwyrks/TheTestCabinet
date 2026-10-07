//! **The Ruby arm's guest and its SDK**, driven end to end: real Ruby, really compiled by a real
//! `node`, really evaluated against gg's real membrane, through the hand-written Ruby SDK a model
//! is actually given.
//!
//! # What "real" means here
//!
//! All of it. A program starts as Ruby the way a model would write it, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, spawning the
//! production compiler in a [`PrepareContext`](crate::sandbox::PrepareContext) the sandbox mints —
//! and the JavaScript that comes back is compiled with
//! [`compile_bytes`](super::super::super::engine::compile_bytes), linked with
//! [`linker`](super::super::super::linker) (the production linker: the whole membrane plus the whole
//! ambient WASI surface), put in a [`bounded_store`](super::super::super::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](super::super::super::membrane::Sandbox) and driven through its `run` export. The tool
//! side is [`FakeOperationApi`](super::super::super::fake::FakeOperationApi), which is what every other
//! end-to-end sandbox test uses, and it records the exact JSON each call arrived as.
//!
//! # How these tests are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, so each obtains the embedded guest
//! once and materialises the Opal compiler, and every program in it costs a `node` running that
//! compiler. A function groups the programs that exercise one behaviour, so they share that
//! cost; one that grows into the slow end of the suite is split rather than extended.

use std::time::Instant;

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;
use wasmtime::component::Component;

use super::COMPONENT;
use super::compile::{compile_module, compile_program};
use crate::ending::{Ending, EndingRole};
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY,
    CAPABILITY_READ_FILE,
};

use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, all_operations_without,
    canned_outcome, granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, ProgramErrorKind, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, ProgramScope, SandboxLimits, bounded_store, bounded_store_on,
    engine, linker, linker_on, reclaim,
};
use crate::tools::{ApiData, ToolFailure, ToolOutcome};

/// This arm's [registered language](crate::sandbox::ProgramLanguage), reached through the registry
/// rather than by naming its module — so every case below exercises the same lookup a run does.
fn ruby() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Ruby)
}

/// The embedded guest, obtained once per test process through the **production** per-language
/// cache — the same bargain a run strikes: a compiled component is instantiated per program and
/// never compiled per program.
fn component() -> &'static Component {
    engine::component(ruby())
        .expect("the embedded Ruby guest compiles")
        .0
}

/// Compile `ruby` with the production prepare step, or panic with what the compiler said.
fn prepare(ruby: &str) -> String {
    match compile_program(ruby, &PrepareContext::detached()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the embedded Opal did not compile this Ruby: {failure}"),
    }
}

/// Compile `ruby` as a code module, or panic with what the compiler said.
pub(super) fn prepare_module(ruby: &str) -> String {
    match compile_module(ruby, &PrepareContext::detached()) {
        Ok(source) => source,
        Err(failure) => panic!("the embedded Opal did not compile this Ruby module: {failure}"),
    }
}

/// Compile and run one Ruby `program` through the real membrane, as an agent of `ending`'s role.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the per-language component cache,
/// which is indexed by the wire id this language does not have yet. [`component`] stands in for it,
/// so the compile is still paid once.
///
/// The [membrane state](MembraneState) is built with **Ruby** as its language, which is what a run
/// of this arm does: a language is held there to spell a call's name back at the model inside a
/// refusal, and gg spells one in Ruby now that the arm is registered.
fn run_as(
    ruby: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(ruby),
        operations,
        modules,
        ending,
        library,
        responder,
    )
}

/// Evaluate already-compiled JavaScript, so a measurement of what a *turn* costs is not a
/// measurement of what the compiler costs.
///
/// # Why the component is resolved before the store is built
///
/// Because the store's clock starts when the store is built, and it is a **wall** clock.
/// [`bounded_store`] arms an epoch deadline against [`SandboxLimits::timeout`] — 30 s by default —
/// and the callback behind it reads `guest_elapsed`, which is time since a `program_started` stamped
/// inside [`MembraneState::new`] less whatever was charged back for time parked in bridged tool
/// calls. Host work done after that stamp and before the guest runs is neither, so nothing gives it
/// back: it is charged in full to a program that has not started.
///
/// [`component`] is exactly that work: this arm's 21 MB embedded guest, compiled by `Component::new`
/// or loaded from the test suite's compiled-component cache, once per **process** — which under
/// `cargo nextest` means once per `#[test]`. A compile takes seconds, and many more on a machine
/// running the rest of the suite; charged to the store, it would count against the program's budget
/// and could end a program that never ran as a `Timeout`.
///
/// Production never had it — [`run_program`](crate::sandbox::run_program) resolves its component and
/// builds its linker and only then builds the store — so a run's 30 s is 30 s of the program. This
/// is that order, and it is also what keeps this function's own promise: a turn measured through it
/// is a turn, not a compiler.
fn evaluate(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_through(program, operations, modules, ending, library, None, |log| {
        FakeOperationApi::with(log, responder)
    })
}

/// [`run_as`] for an agent that keeps a program library with `source` already recorded under `id`
/// on `turn`, every operation granted and no ending.
///
/// The one thing a library-holding agent cannot be driven to without it: `GG::Programs.get` and the
/// `ProgramSummary#source` method that is a second spelling of it both answer out of a history a
/// fresh double has none of, so a test that seeded nothing can only ever observe a `:not_found`.
fn run_with_program(
    ruby: &str,
    id: &str,
    turn: u64,
    source: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_through(
        &prepare(ruby),
        &all_operations(),
        &[],
        RunEnding::None,
        true,
        None,
        |log| FakeOperationApi::with(log, responder).with_program(id, turn, source),
    )
}

/// What [`evaluate`] and [`run_with_program`] are: one evaluation, with everything the scope
/// carries stated.
///
/// The double is BUILT here rather than passed in, because the log it writes to is created here and
/// the two must be the same one. `build` takes that log and hands back the api, which is what lets a
/// caller seed the double — a program library with something in it — without a second parameter for
/// every thing a caller might seed.
///
/// `deadline` is the run's **wall-clock** budget, and `None` — every caller but one — is a run with
/// none. The one case that passes a spent one is about the single call the membrane services after
/// the budget is gone: an ending performs no work and ends the session, which is exactly what a
/// spent budget wants, so it is not refused the way every dispatched call is.
fn evaluate_through(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    deadline: Option<Instant>,
    build: impl FnOnce(&CallLog) -> FakeOperationApi,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let api = build(&log);
    // Both of these before the store exists, for the reason this function's documentation gives.
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules,
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    let mut store = bounded_store(
        MembraneState::new(api, ruby(), scope, limits, deadline),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the embedded Ruby guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
    let returned = bound
        .call_run(
            &mut store,
            program,
            modules,
            &granted,
            ending.into(),
            library,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let (outcome, _api) = reclaim(store, returned, None, None);
    (outcome, log)
}

/// Compile and run one Ruby `program` granting `operations` and no ending.
pub(super) fn run_with(
    ruby: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(ruby, operations, modules, RunEnding::None, false, responder)
}

/// Compile and run `ruby` with no gg tool offered — the shape most of these cases want.
pub(super) fn run(ruby: &str) -> SandboxOutcome {
    run_with(ruby, &[], &[], canned_outcome).0
}

/// One component's imported interfaces, sorted, with the version suffix dropped.
fn interface_imports(component: &Component) -> Vec<String> {
    let mut imports: Vec<String> = component
        .component_type()
        .imports(engine::shared_engine())
        .map(|(name, _)| name.split('@').next().unwrap_or(name).to_string())
        .collect();
    imports.sort_unstable();
    imports
}

/// What a program logged, insisting that the sandbox ran it and that it did not raise.
pub(super) fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program raised: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// The raise a program did not rescue, insisting that the sandbox itself did not fail.
fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .unwrap_or_else(|| panic!("the program did not raise; it logged {:?}", outcome.logs)),
        Err(error) => panic!("expected a program fault, but the sandbox failed: {error}"),
    }
}

#[test]
fn a_real_ruby_program_runs_through_the_real_membrane() {
    // Ordinary Ruby, exercising what a model actually writes: a class with state, keyword arguments,
    // blocks, string interpolation, chained enumerables, a hash, a range. The point is not that any
    // one of them is doubtful — it is that a whole Ruby program survives the compile and the
    // crossing, rather than a subset of one.
    let outcome = run(r##"
class Ledger
  def initialize(name)
    @name = name
    @entries = []
  end

  def add(amount, note: nil)
    @entries << { amount: amount, note: note }
    self
  end

  def total = @entries.sum { |entry| entry[:amount] }

  def to_s = "#{@name}: #{total} over #{@entries.size} entries"
end

ledger = Ledger.new("gg").add(3).add(4, note: "second").add(10)
puts ledger
puts ledger.total
puts (1..5).map { |n| n * n }.select(&:even?).inspect
puts({ a: 1, b: 2 }.map { |key, value| "#{key}=#{value}" }.join(","))
"##);
    assert_eq!(
        logs(&outcome),
        ["gg: 17 over 3 entries", "17", "[4, 16]", "a=1,b=2",]
    );

    // `warn` and `p` are the other two ways a Ruby program says something, and both have to reach
    // the operator's stream. Opal picks its write procedure once at load and captures the `console`
    // that existed while the component was being pre-initialised, so without the guest re-pointing
    // it on every run this produces nothing at all — which is exactly what it did before it was
    // fixed.
    let outcome = run("warn 'to stderr'\np({ a: 1 })\np [1, 2]\n");
    assert_eq!(logs(&outcome), ["to stderr", "{\"a\"=>1}", "[1, 2]"]);

    // A partial line still reaches the host: what a program `print`ed without ever ending the line
    // is flushed when the program ends rather than dropped.
    let outcome = run("print 'half a'\nprint \" line\\n\"\nprint 'no newline'\n");
    assert_eq!(logs(&outcome), ["half a line", "no newline"]);

    // Ruby 3 pattern matching is syntax rather than a library, and Opal lowers it to a call into a
    // corelib module the npm runtime bundle does not carry — so it is baked and loaded by this
    // guest's build. Without that, an ordinary `case … in` is `uninitialized constant
    // PatternMatching`, which is a sentence about gg's build rather than about the program.
    let outcome = run(r##"
case { name: "gg", parts: [1, 2, 3] }
in { name: String => name, parts: [_, *rest] }
  puts "#{name} and #{rest.size} more"
end
"##);
    assert_eq!(logs(&outcome), ["gg and 2 more"]);
}

#[test]
fn the_libraries_the_manifest_declares_are_really_in_the_embedded_guest() {
    // What a Ruby program may `require` is a **bake-time fact about this artifact**: it is what
    // `src/library.rb` declared and `tools/guest.mjs` compiled into it, and nothing else. That set
    // is what the catalogue's `libraries` section tells a model it has, so this drives every name
    // the catalogue names into the embedded component and requires it — a curated library dropped
    // in a rebuild fails here rather than in a run.
    let catalogue: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Ruby catalogue is valid JSON");
    let declared: Vec<String> = catalogue["libraries"]
        .as_array()
        .expect("the catalogue declares its libraries")
        .iter()
        .flat_map(|group| group["modules"].as_array().expect("a group's modules"))
        .map(|name| name.as_str().expect("a module name").to_string())
        .collect();
    assert!(
        declared.len() >= 20,
        "the manifest declares only {} libraries",
        declared.len()
    );

    let program = declared
        .iter()
        .map(|name| format!("require {name:?}\nputs {name:?}\n"))
        .collect::<String>();
    let outcome = run(&program);
    assert_eq!(
        logs(&outcome),
        declared.as_slice(),
        "every library the catalogue declares loads inside the embedded guest"
    );

    // And they are libraries rather than names: each of these is a call into the thing that was
    // required, so a module that loaded but did not define what it is for still fails.
    let outcome = run(r##"
require "json"
require "set"
require "time"
require "securerandom"
require "ostruct"
puts JSON.parse('{"a":[1,2]}')["a"].sum
puts Set.new([1, 2, 2, 3]).size
puts Time.at(0).utc.year
puts SecureRandom.hex(8).size
puts OpenStruct.new(name: "gg").name
"##);
    assert_eq!(logs(&outcome), ["3", "3", "1970", "16", "gg"]);

    // The absences are facts too, and a study has to be able to state them. `fileutils` and
    // `net/http` are Opal's Node- and browser-only stdlib, and this guest is neither.
    let outcome = run(r##"
["fileutils", "net/http", "socket"].each do |name|
  begin
    require name
    puts "#{name}: present"
  rescue LoadError
    puts "#{name}: absent"
  end
end
"##);
    assert_eq!(
        logs(&outcome),
        ["fileutils: absent", "net/http: absent", "socket: absent"]
    );
}

#[test]
fn the_sdk_hands_a_program_values_ruby_can_read() {
    // A result is a value object with readers, a boolean field is a predicate, a fixed choice is a
    // Symbol, and a read is one of two classes narrowed with an ordinary `case`. None of that is
    // available to a program that has to read a tagged wrapper, and all of it is what "idiomatic"
    // means concretely on this arm.
    let (outcome, _log) = run_with(
        r##"
require "gg"
read = GG::Files.read_file("notes.md")
case read
when GG::Files::TextFile
  puts "#{read.contents.lines.first.strip} #{read.first_line}..#{read.last_line} of #{read.total_lines}"
  puts read.byte_truncated?
when GG::Files::ImageFile
  puts "unexpectedly an image"
end

# A value object is a value: equality is by contents, `to_h` names its fields, and a pattern
# destructures it.
puts(GG::Files.read_file("notes.md") == read)
puts read.to_h.keys.join(",")
case read
in GG::Files::TextFile[contents:, total_lines:]
  puts "pattern #{contents.lines.first.strip} #{total_lines}"
end

entries = GG::Files.list_dir(".")
puts entries.map { |entry| "#{entry.name}:#{entry.kind}" }.join(" ")
puts(entries.first.kind == GG::Files::EntryKind::FILE)
puts entries.first.kind.inspect

out = GG::Shell.run("true")
puts "#{out.exit_code} #{out.truncated?}"
"##,
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "contents of notes.md 1..2 of 2",
            "false",
            "true",
            "contents,first_line,last_line,total_lines,byte_truncated",
            "pattern contents of notes.md 2",
            "a.ts:file b.test.ts:file sub:directory",
            "true",
            // Opal's `Symbol` IS `String` — a recorded parameter of this arm rather than a defect,
            // and the reason `Check.choice` writes an accepted set out by hand instead of with
            // `inspect`. What a program WRITES is still `:file`, and a misspelt one is still an
            // `invalid-argument` naming the set, which is the whole of what rule 3 asks for.
            "\"file\"",
            "0 false",
        ]
    );

    // A failure is a raised `ApiError` carrying a Symbol code, rescued by a name the prompt teaches
    // — and `rescue => failure` catches it too, because it is a `StandardError` like anything else a
    // Ruby library raises.
    let (outcome, _log) = run_with(
        r##"
require "gg"
begin
  GG::Files.read_file("missing.md")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.code == GG::Core::ApiErrorCode::NOT_FOUND}"
  puts failure.message
end

begin
  GG::Tasks.update_task("t1", status: :nearly)
rescue => failure
  puts failure.message
end
"##,
        &all_operations(),
        &[],
        |name: &str, args: &Value| {
            if name == "read_file" && args["path"] == json!("missing.md") {
                return ToolOutcome::failed(
                    crate::tools::ToolFailure::NotFound,
                    "no such file: missing.md".to_string(),
                );
            }
            canned_outcome(name, args)
        },
    );
    assert_eq!(
        logs(&outcome),
        [
            "read_file not_found true",
            "no such file: missing.md",
            "`status` must be one of :pending, :in_progress, :done, got :nearly",
        ]
    );
}

#[test]
fn a_ruby_program_is_gated_by_the_host_and_told_what_it_does_have() {
    // A tool this run does not offer is bound onto its module like every other — this arm's SDK is
    // static — so reaching for it is an ordinary Ruby call that reaches the HOST, and what comes
    // back is gg's own sentence naming the capability that buys it.
    let outcome = run("require \"gg\"\nGG::Shell.run(\"ls\")\n");
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error.message.ends_with("`GG::Shell.run` is not available."),
        "the refusal names the call this program wrote: {}",
        error.message
    );

    // The same for a module the run does buy something else from: the gate is per operation, so a
    // run with reading is still refused a write, on the same terms and in the same words.
    let (outcome, _log) = run_with(
        "require \"gg\"\nGG::Files.write_file(\"a\", \"b\")\n",
        &[crate::sandbox::operations::FILES_READ_FILE],
        &[],
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error
            .message
            .ends_with("`GG::Files.write_file` is not available."),
        "the refusal names the call this program wrote: {}",
        error.message
    );

    // A name gg does not have AT ALL is the other failure, and it is the one Ruby still answers for
    // itself: the module's `method_missing` says what that module declares, which is now the whole
    // of what gg declares there.
    let (outcome, _log) = run_with(
        "require \"gg\"\nGG::Files.read_fil(\"notes.md\")\n",
        &[crate::sandbox::operations::FILES_READ_FILE],
        &[],
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error
            .message
            .contains("is not one of the names gg declares there"),
        "{}",
        error.message
    );

    // AND A WITHHELD CALL NEVER REACHES THE INVOKER. The refusal is raised at the membrane, before
    // anything is dispatched, so the effect a program was refused is an effect that did not happen
    // — which is the property the whole gate exists for.
    let (outcome, log) = run_with(
        "require \"gg\"\nGG::Files.read_file(\"notes.md\")\n",
        &[crate::sandbox::operations::FILES_WRITE_FILE],
        &[],
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error.message.contains("GG::Files.read_file"),
        "the refusal names the call the model wrote: {}",
        error.message
    );
    assert!(
        log.calls().is_empty(),
        "a withheld tool never reaches the invoker"
    );

    // And it is a VALUE: a `rescue` clause catches it, reads the code off it, and the program runs
    // on. That is what a `NoMethodError` could never be.
    let (outcome, _log) = run_with(
        "require \"gg\"\nbegin\n  GG::Files.read_file(\"notes.md\")\nrescue GG::Core::ApiError => failure\n           puts \"#{failure.operation} #{failure.code}\"\nend\n",
        &[crate::sandbox::operations::FILES_WRITE_FILE],
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["read_file unavailable"]);
}

#[test]
fn an_uncaught_ruby_exception_is_reported_at_the_line_the_model_wrote() {
    // A raise has to come back as a `ProgramError` carrying Ruby's own class and message, not as an
    // opaque wasm trap — and, now that this guest owns its own `run`, at the line of the **Ruby**
    // rather than of the JavaScript Opal compiled it into. The map that makes that possible is
    // appended to every compile by gg's own driver, and read here, lazily, only because something
    // raised.
    let outcome = run(r##"
def risky(value)
  raise ArgumentError, "bad #{value}"
end

puts "before"
risky(7)
puts "after"
"##);
    let error = program_error(&outcome);
    assert!(
        error.message.contains("ArgumentError") && error.message.contains("bad 7"),
        "Ruby's own class and message: {}",
        error.message
    );
    assert_eq!(
        error.location.as_deref(),
        Some("line 3"),
        "the raise is located in the model's Ruby (line 3), not in the compiled JavaScript"
    );
    assert_eq!(
        outcome.logs,
        ["before"],
        "what ran before the raise is still reported"
    );

    // A program that rescues its own raise runs to completion, which is what says the exception is a
    // real Ruby exception rather than something the guest turned into one on the way out.
    let outcome = run(r##"
begin
  raise TypeError, "expected"
rescue TypeError => failure
  puts "caught #{failure.message}"
ensure
  puts "ensured"
end
"##);
    assert_eq!(logs(&outcome), ["caught expected", "ensured"]);

    // A failed tool call is reported as the tool failure it is, carrying the membrane's own code, so
    // gg classifies the turn from the code rather than from what this guest made of the raise.
    let (outcome, _log) = run_with(
        "require \"gg\"\nGG::Files.read_file(\"gone.md\")\n",
        &all_operations(),
        &[],
        |name: &str, args: &Value| {
            if name == "read_file" {
                return ToolOutcome::failed(
                    crate::tools::ToolFailure::NotFound,
                    "no such file".to_string(),
                );
            }
            canned_outcome(name, args)
        },
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure);
    assert!(
        error.message.contains("read_file") && error.message.contains("not-found"),
        "the failure names the call and the wire's own code: {}",
        error.message
    );

    // `exit` STOPS THE PROGRAM. Opal hands process termination to its host and this guest is that
    // host, so `exit` raises the `SystemExit` CRuby raises there, carrying the status the program
    // chose. What is asserted is the half a report cannot show: the statement after it did not run.
    let outcome = run("puts \"before\"\nexit(3)\nputs \"after\"\n");
    let error = program_error(&outcome);
    assert_eq!(error.message, "SystemExit: 3");
    assert_eq!(error.location.as_deref(), Some("line 2"));
    assert_eq!(
        outcome.logs,
        ["before"],
        "a program that called exit did not go on running"
    );

    // And the object a `rescue` catches answers what CRuby's answers, because Opal's `SystemExit`
    // has neither method and a program that rescues one asks for both.
    let outcome = run(
        "begin\n  exit 5\nrescue SystemExit => e\n  puts \"#{e.status} #{e.success?}\"\nend\nbegin\
         \n  exit 0\nrescue SystemExit => e\n  puts e.success?\nend\n",
    );
    assert_eq!(outcome.logs, ["5 false", "true"]);

    // Ruby's other two spellings of the same ending, which Opal defines neither of: a model that
    // reached for either had its program fail on the spelling rather than end on it.
    let outcome = run("puts \"one\"\nabort(\"stop now\")\nputs \"two\"\n");
    assert_eq!(program_error(&outcome).message, "SystemExit: 1");
    assert_eq!(outcome.logs, ["one", "stop now"]);
    let outcome = run("puts \"one\"\nexit!(4)\nputs \"two\"\n");
    assert_eq!(program_error(&outcome).message, "SystemExit: 4");
    assert_eq!(outcome.logs, ["one"]);

    // A raise inside a CODE MODULE is located at the line of the model's own program that reached
    // into it, and at no other line at all.
    //
    // A module is compiled on its own and carries its OWN source map, so the frame it raises from
    // is a position in a unit the program's map says nothing about. Reading it through the
    // program's map anyway is what this guest used to do, and what came out depended on nothing but
    // how long the model's program happened to be — which is the tell that the number never meant
    // anything. Both halves were measured before the fix: a 63-line program calling
    // `lib.helpers.boom` on its line 62 was told `line 10`, which was `a9 = 9`; the program below
    // fell off the end of the same map and was told nothing at all.
    //
    // The frames are told apart by name now (`//# sourceURL`), so the program's own frame is the
    // one that is mapped. It is also the line the model can act on: `lib.helpers.boom` is where its
    // program met the skill's failure.
    let (outcome, _log) = run_with(
        r##"
require "lib"
def summarise(rows)
  rows.map { |row| row.strip }.reject(&:empty?)
end

rows = [" alpha ", "", "beta"]
summary = summarise(rows)
puts summary.join(",")
puts "kept #{summary.size}"

widths = summary.map { |word| word.size }
puts widths.sum
longest = summary.max_by { |word| word.size }
puts longest
initials = summary.map { |word| word[0] }
puts initials.join
table = Hash[summary.zip(widths)]
puts table.size

lib.helpers.boom
puts "unreachable"
"##,
        &[],
        &[CodeModule {
            name: "helpers".to_string(),
            source: prepare_module(
                r##"
def boom
  raise ArgumentError, "the skill raised this"
end
"##,
            ),
        }],
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert!(
        error.message.contains("ArgumentError") && error.message.contains("the skill raised this"),
        "the module's own exception reaches the model: {}",
        error.message
    );
    assert_eq!(
        error.location.as_deref(),
        Some("line 21"),
        "a module's raise is located at the model's own call into it, never at a line read through \
         the wrong unit's source map"
    );
    assert_eq!(
        outcome.logs,
        ["alpha,beta", "kept 2", "9", "alpha", "ab", "2"]
    );
}

#[test]
fn code_modules_become_a_ruby_namespace_the_program_reaches_at_lib() {
    // A code skill's or code memory's module is evaluated when the program requires `lib`, and its
    // author writes the same `require "gg"` a program does to reach gg from inside it. A Ruby file
    // has no exports, so the host wraps the author's source in the `Module.new do` that makes its
    // body an anonymous `Module`: what it defines is what the namespace offers.
    let (outcome, log) = run_with(
        r##"
require "lib"
puts lib.helpers.double(21)
puts lib.helpers.greeting
puts lib.helpers.first_line("notes.md")
"##,
        &[crate::sandbox::operations::FILES_READ_FILE],
        &[CodeModule {
            name: "helpers".to_string(),
            source: prepare_module(
                r##"
require "gg"
def double(n) = n * 2

def greeting = "from a skill"

def first_line(path)
  GG::Files.read_file(path).contents.lines.first.strip
end
"##,
            ),
        }],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["42", "from a skill", "contents of notes.md"]
    );
    assert_eq!(
        log.names(),
        ["read_file"],
        "a module reaches the run's own tools, like anything else"
    );

    // A module that raises while loading does not take the turn down with it: its author is whoever
    // wrote the skill, not the model whose program merely has it in scope — and what the program
    // then gets is a `NoMethodError` naming the member it wanted rather than one naming `lib`.
    let (outcome, _log) = run_with(
        r##"
require "lib"
puts "the program still ran"
begin
  lib.broken.anything
rescue NoMethodError => failure
  puts failure.message
end
"##,
        &[],
        &[CodeModule {
            name: "broken".to_string(),
            source: prepare_module("raise 'this skill is broken'\n"),
        }],
        canned_outcome,
    );
    assert!(logs(&outcome)[0] == "the program still ran");
    assert!(
        logs(&outcome)[1].contains("anything"),
        "the failure names the member: {:?}",
        logs(&outcome)[1]
    );

    // No line, no `lib`, whatever the run bound.
    let outcome = run("puts lib\n");
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::UnknownName);

    // And with the line but no modules, the name is there and every key is refused by the object
    // that lists the keys this run really bound.
    let outcome = run("require \"lib\"\nputs lib.anything\n");
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error
            .message
            .contains("`lib.anything` is not bound this run"),
        "{}",
        error.message
    );

    // A syntax error in a module is reported at the author's own line, because the wrapper shares
    // it and nothing moves a number afterwards. Line 1 is the case that matters, since that is the
    // line the wrapper sits on.
    for (source, at) in [
        ("y = 2 +* 3\n", "module.rb:1:"),
        ("ok = 1\ny = 2 +* 3\n", "module.rb:2:"),
    ] {
        let failure = compile_module(source, &PrepareContext::detached())
            .expect_err("the module does not compile");
        assert!(
            failure.to_string().contains(at),
            "the diagnostic names the author's own line: {failure}"
        );
    }
}

/// One operation, called through the Ruby spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The call, exactly as a model would write it. The [`require`](super::SURFACE_IMPORT) that
    /// reaches it is written once, at the head of the one program the test runs every call in.
    program: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic Ruby method.
///
/// Deliberately the same table `sandbox.membrane.test.rs` drives the TypeScript arm with and
/// `python.substrate.test.rs` drives the Python arm with, down to the arguments and the expected
/// JSON — because the expected JSON is the point. gg's dispatch is language-independent: three arms
/// writing the same call in their own idioms must produce **byte identical** arguments, or they are
/// not running the same experiment. A keyword argument that lowered onto the wrong wire field, a
/// Symbol whose arm did not translate, a patch sentinel read the wrong way round — none of them is a
/// compile error in any of the three, and all of them are visible here.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            program: "GG::Shell.run(\"npm test\", timeout_secs: 30)",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            program: "GG::Files.read_file(\"src/a.rb\", offset: 2, limit: 5)",
            expected: || json!({ "path": "src/a.rb", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            program: "GG::Files.write_file(\"out.txt\") { \"hello\" }",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            program: "GG::Files.edit_file(\"src/a.rb\", \"alpha\", \"beta\")",
            expected: || json!({ "path": "src/a.rb", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            program: "GG::Files.list_dir(\"src\")",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            program: "GG::Files.tree(path: \"src\", depth: 3)",
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            program: "GG::Files.search(\"fn\\\\s+update\", path: \"src\", limit: 20)",
            expected: || json!({ "query": "fn\\s+update", "path": "src", "limit": 20 }),
        },
        Crossing {
            tool: "read_skill",
            program: "GG::Skills.read_skill(\"testing\")",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            program: "GG::Memories.write_memory(\"layout\", \"d\", \"b\")",
            expected: || json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "update_memory",
            program: "GG::Memories.update_memory(\"layout\", \"d2\", \"b2\")",
            expected: || json!({ "name": "layout", "description": "d2", "body": "b2", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "create_memory",
            program: "GG::Memories.create_memory(\"layout\", \"d\", \"b\")",
            expected: || json!({ "name": "layout", "description": "d", "contents": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "read_memory",
            program: "GG::Memories.read_memory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            program: "GG::Memories.edit_memory(\"layout\", \"old\", \"new\")",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            program: "GG::Memories.search_memories(\"cargo\", \"nextest\")",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            program: "GG::Memories.delete_memory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            program: "GG::Tasks.add_task(\"t1\", \"T\", description: \"D\", blocked_by: [\"t0\"])",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            program: "GG::Tasks.update_task(\"t1\", title: \"T2\", description: nil, status: :in_progress)",
            expected: || {
                // `description: nil` is the sentinel that CLEARS it — the argument left out is the
                // one that keeps it — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            program: "GG::Tasks.set_blocked_by(\"t1\")",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            program: "GG::Tasks.complete_task(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            program: "GG::Tasks.remove_task(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            program: "GG::Board.create_epic(\"epc\", \"E\", \"D\")",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            program: "GG::Board.create_issue(\"I\", \"s\", \"o\", \"c\", \"worker\", reviewers: [\"critic\"])",
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
            program: "GG::Board.update_issue(\"i1\", status: :done, epic_id: nil)",
            expected: || {
                // `epic_id: nil` ungroups the issue, which gg's schema spells as the empty string;
                // a `description` left out keeps the one it has, so its key is absent entirely.
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
            program: "GG::Board.set_issue_blocked_by(\"i1\", \"i0\")",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            program: "GG::Board.remove_epic(\"e1\")",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            program: "GG::Board.remove_issue(\"i1\")",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            program: "GG::Board.wait_for_issue(\"i1\")",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            program: "GG::Context.evict_file_view(\"src/a.rb\")",
            expected: || json!({ "path": "src/a.rb" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a Ruby `Range`, which is what a span of integers is in this
            // language — and an exclusive one means the same thing, which is why both are here.
            program: "GG::Context.archive_thread(4..19, 30...36)",
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            program: "GG::Context.search_archive(\"the parser\")",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            program: "GG::Context.compact(\"scaffolded the page\", files: [\"src/main.rb\"])",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/main.rb"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            program: "GG::Delegation.spawn_subagent(\"subagent\", prompt: \"write the lexer\")",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            program: "GG::Delegation.wait_for_subagents(\"agent-1\")",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            program: "GG::Delegation.send_message(\"agent-1\", \"prefer the simpler parser\")",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            program: "GG::Delegation.transition_state(\"verify\", \"the build is green\")",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            program: "GG::Delegation.exec(\"Builder\", \"pick it up from here\")",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            program: "GG::Delegation.fork(\"try the other fix\")",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_operation_crosses_the_membrane_from_its_ruby_spelling() {
    let crossings = crossings();
    let operations = all_operations();

    // One program rather than one per crossing, as every compiled arm does: each program is an Opal
    // compile, so thirty-five of them would be thirty-five compiler processes for a table that reads
    // the same. It is also the stronger check — the calls must arrive in the order the program made
    // them, so a call that reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    let program: String = std::iter::once(format!("{}\n", super::SURFACE_IMPORT))
        .chain(
            crossings
                .iter()
                .map(|crossing| format!("{}\n", crossing.program)),
        )
        .collect();
    let (outcome, log) = run_with(&program, &operations, &[], canned_outcome);
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
            crossing.program
        );
    }

    // Exhaustive by construction: an operation added to gg with no row here fails now, rather than
    // shipping as a typed method nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut expected = crate::sandbox::signatures::sandbox_operation_names();
    expected.sort_unstable();
    assert_eq!(
        covered, expected,
        "every bound operation needs a crossing, and only bound operations may have one"
    );
}

#[test]
fn the_views_docs_program_library_and_endings_modules_are_reached_in_ruby_too() {
    // None of the four families is a gg tool, so none appears in the crossing table above — two of
    // them are where a program puts something in front of the model and one is how it finds anything
    // at all, which makes them the ones a silent bridging mistake would cost the most.
    let (outcome, _log) = run_as(
        r##"
require "gg"
GG::Views.open_text("summary", "eight files, two failing")
GG::Views.open_text("scratch") { ["a", "b"].join("\n") }
puts "#{GG::Views.close("scratch")} #{GG::Views.close("never opened")}"

# The documentation of a function, named with a Symbol, with a String, and with the method itself.
GG::Views.open_docs_view(:read_file)
GG::Views.open_docs_view("write_file")
GG::Views.open_docs_view(GG::Files.method(:read_file))

whole = GG::Views.open_file("notes.md")
puts "#{whole.class} #{whole.first_line}-#{whole.last_line}"
GG::Session.finish("done")
"##,
        &all_operations(),
        &[],
        RunEnding::Role(EndingRole::Standard),
        true,
        canned_outcome,
    );
    let lines = logs(&outcome);
    assert_eq!(lines[0], "1 0");
    assert!(
        lines[1].starts_with("GG::Files::TextFile"),
        "{:?}",
        lines[1]
    );
    // The program library is bound from the capability rather than from a tool name, and a reviewer
    // gets the other ending group and no `finish` at all.
    let (outcome, _log) = run_as(
        r##"
require "gg"
puts GG::Programs.history.size
GG::Programs.rerun("puts 'the replacement'\n")
GG::Session.request_changes("widen the test", "name the file")
"##,
        &[],
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "{:?}",
        outcome.result
    );
    assert!(outcome.rerun.is_some(), "the hand-over is recorded");

    // A library with something in it: the summary carries the id its acknowledgement did, `get`
    // takes that id as a String and answers the source that ran, `#source` is the same fetch with
    // the id already supplied, and an id this agent was never issued is a `:not_found` that names
    // the ones it holds.
    let (outcome, log) = run_with_program(
        r##"
require "gg"
ran = GG::Programs.history
first = ran.first
puts "#{ran.size} #{first.id} #{first.id.class} #{first.turn} #{first.ok?} #{first.error.inspect}"
source = GG::Programs.get("p3")
puts source.inspect
puts (first.source == source).inspect
begin
  GG::Programs.get("p4")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code == GG::Core::ApiErrorCode::NOT_FOUND} #{failure.message.include?("p3")}"
end
GG::Programs.rerun(source.sub("ran", "walked"))
"##,
        "p3",
        3,
        "puts 'the program that ran'",
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "{:?}",
        outcome.result
    );
    assert_eq!(
        logs(&outcome),
        [
            "1 p3 String 3 true nil",
            "\"puts 'the program that ran'\"",
            "true",
            "get true true",
        ]
    );
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("puts 'the program that walked'"),
        "the patched program is what gg was handed"
    );
    assert!(
        log.calls().is_empty(),
        "the library is answered by the membrane, not by a tool: {:?}",
        log.calls()
    );

    // The one program gg **generates** rather than quotes: the on-use script of every built-in
    // family skill, written by this arm's own
    // [`open_docs_views_statement`](crate::sandbox::ProgramLanguage::open_docs_views_statement).
    // Driven end to end rather than merely compiled, because a generated program that names the
    // right call and does not parse — or parses and opens nothing — would fail on the first read of
    // a built-in skill, in a turn that has nothing to do with what the model wrote.
    let generated = ruby().open_docs_views_statement(&["read_file", "write_file", "list_dir"]);
    let (outcome, _log) = run_with(&generated, &all_operations(), &[], canned_outcome);
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "gg's own generated documentation program did not run: {:?}",
        outcome.result
    );
    assert_eq!(
        outcome.views_opened.len(),
        3,
        "one view per name: {:?}",
        outcome.views_opened
    );

    let outcome = run("require \"gg\"\nGG::Session.finish(\"done\")\n");
    assert_eq!(
        program_error(&outcome).kind,
        ProgramErrorKind::UnknownName,
        "an agent with no ending role has no `harness` at all"
    );

    // The documentation module, which is the loop the prompt describes made of real calls. `search`
    // is bound in every program whatever a run enables — so it is driven with **no** tool offered at
    // all — and `close`/`close_all` are bought by a capability, so this store grants it and the run
    // after it does not. The double answers an empty page, which is the whole of what a double can
    // honestly say about a real index; what is proven is the crossing, the keyword arguments, the
    // Array the module filter lowers from, the Symbol the kind filter lowers from, and the view the
    // host opens on the way back.
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log);
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let capabilities = vec![CAPABILITY_DOCVIEW_CLOSE.to_string()];
    let operations = crate::sandbox::capability_operations([CAPABILITY_DOCVIEW_CLOSE]);
    let scope = ProgramScope {
        capabilities: &capabilities,
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(MembraneState::new(api, ruby(), scope, limits, None), limits);
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    let searching = prepare(
        r##"
require "gg"
page = GG::Docs.search(query: "read", modules: ["files"], type: "FileRead",
                       kind: GG::Docs::DocKind::FUNCTION, limit: 5)
puts "#{page.class} #{page.total} #{page.offset} #{page.hits.inspect}"
puts "#{GG::Docs.close("GG::Files.read_file")} #{GG::Docs.close_all}"
"##,
    );
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
    bound
        .call_run(
            &mut store,
            &searching,
            &[],
            &[],
            RunEnding::None.into(),
            false,
        )
        .expect("the program runs");
    let (outcome, _api) = reclaim(store, Ok(()), None, None);
    assert_eq!(logs(&outcome), ["GG::Docs::DocSearch 0 0 []", "0 0"]);
    let searched: Vec<&str> = outcome
        .views_opened
        .iter()
        .filter(|view| view.kind == crate::context::ViewKind::Search)
        .map(|view| view.selector.as_str())
        .collect();
    assert_eq!(
        searched,
        [crate::context::SEARCH_RESULTS_VIEW],
        "a search leaves its own page in the window"
    );

    // And without the capability, closing is refused by the host rather than missing from the
    // module — the same shape every other bought call refuses in, and a value a `rescue` can catch.
    let (outcome, _log) = run_with(
        r##"
require "gg"
begin
  GG::Docs.close_all
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code == GG::Core::ApiErrorCode::UNAVAILABLE}"
end
"##,
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["close_all true"]);
}

/// The embedded guest compiled for the [metered engine](engine::metered_engine), once per process.
fn metered_component() -> &'static Component {
    static METERED: std::sync::OnceLock<Component> = std::sync::OnceLock::new();
    METERED.get_or_init(|| {
        engine::compile_metered(COMPONENT).expect("the embedded Ruby guest compiles")
    })
}

/// **How much work the guest does to run `program`**, instantiation included, as the number of wasm
/// instructions it executes on the [metered engine](engine::metered_engine).
///
/// A count rather than a time, so it reads the same on an idle machine and on one running forty
/// other tests: the guest executes the same instructions either way.
fn work_of(program: &str) -> u64 {
    const FUEL: u64 = u64::MAX;
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome);
    let linker = linker_on::<FakeOperationApi>(engine::metered_engine())
        .expect("the production linker builds on the metered engine");
    let operations = granted_operations(&[], false);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store_on(
        engine::metered_engine(),
        MembraneState::new(api, ruby(), scope, limits, None),
        limits,
    );
    store
        .set_fuel(FUEL)
        .expect("the metered engine counts fuel");
    let bound = Sandbox::instantiate(&mut store, metered_component(), &linker)
        .expect("the embedded Ruby guest instantiates on the metered engine");
    store.data_mut().start_program();
    let returned = bound
        .call_run(&mut store, program, &[], &[], RunEnding::None.into(), false)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let spent = FUEL - store.get_fuel().expect("the metered engine counts fuel");
    let (outcome, _api) = reclaim(store, returned, None, None);
    assert_eq!(logs(&outcome), ["1"], "the program ran to its end");
    spent
}

/// **Opal's runtime is not rebuilt for a program**: running a compiled Ruby program costs the guest
/// about what running a line of plain JavaScript on the same component does.
///
/// The runtime is 743 KB of JavaScript. The component is built with it already evaluated — its heap
/// snapshotted into the artifact — so a turn instantiates a runtime that exists rather than building
/// one. A build that stopped snapshotting it, or a guest that evaluated it on every call, would
/// still run every program correctly and pass every other test here; what it would change is how
/// much the guest executes per turn, by several times the whole of what a small program costs. So
/// that is what is compared, as a count of instructions (see [`work_of`]): a Ruby program that
/// prints one line against a JavaScript line that prints the same, both instantiation and all. The
/// two are close to equal when the runtime comes from the snapshot, and the Ruby one is allowed
/// twice the JavaScript one's count before this fails.
#[test]
fn opals_runtime_is_not_rebuilt_for_a_program() {
    let ruby_program = work_of(&prepare("puts 1\n"));
    let javascript = work_of("console.log(1)");
    println!("a Ruby program {ruby_program} instructions; a JavaScript line {javascript}");
    assert!(
        ruby_program < javascript * 2,
        "a one-line Ruby program executed {ruby_program} wasm instructions against {javascript} for \
         a line of JavaScript on the same component: something is building Opal's runtime per \
         program instead of reading it from the snapshot"
    );
}

/// **Opal's runtime comes with the component rather than with the program, and gg's SDK comes out
/// of `require "gg"`.**
///
/// Both halves are what keep a Ruby turn cheap and honest. The runtime is 743 KB of JavaScript that
/// the guest was pre-initialised with, so a compiled program must not carry it — that it is not
/// rebuilt on every turn either is [`opals_runtime_is_not_rebuilt_for_a_program`]. The SDK is
/// registered in the guest but not loaded, because a constant carried in the snapshot is a constant
/// a program reaches with no line it wrote; only `require "gg"` loads it, and loads it once.
#[test]
fn opal_comes_from_the_snapshot_and_gg_loads_once_on_require() {
    // The compiled program carries none of the runtime: it is a few hundred bytes against the
    // runtime's 743 KB, and it lacks the definitions only the runtime makes.
    let program = prepare("puts (1..20).reduce(:+)\n");
    assert!(
        program.len() < 64 * 1024,
        "a one-line program compiled to {} bytes; Opal's runtime is being bundled into it",
        program.len()
    );
    for runtime_only in [
        "Opal.add_stubs = function",
        "Opal.queue = function",
        "var Opal =",
    ] {
        assert!(
            !program.contains(runtime_only),
            "the compiled program defines `{runtime_only}`, which only Opal's runtime does:\n{program}"
        );
    }
    // Nor does it carry gg's SDK, which a program without the line must not reach.
    assert!(
        !program.contains("Opal.modules[\"gg\"]"),
        "the compiled program carries gg's SDK:\n{program}"
    );

    // And yet it runs Ruby, so the runtime it ran on is the one the component was baked with.
    let operations = all_operations();
    let outcome = evaluate(
        &program,
        &operations,
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["210"]);
    // The same holds from outside Ruby: a line of plain JavaScript finds Opal already defined.
    let outcome = evaluate(
        "console.log(typeof Opal, typeof Opal.modules[\"gg\"])",
        &operations,
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0;
    assert_eq!(
        logs(&outcome),
        ["object function"],
        "the runtime is in the snapshot and gg's SDK is registered in its require registry"
    );

    // gg's SDK is not loaded until a program asks for it, and a second `require` loads nothing.
    let outcome = run("puts defined?(GG).inspect
puts require \"gg\"
puts require \"gg\"
puts defined?(GG).inspect
");
    assert_eq!(
        logs(&outcome),
        ["nil", "true", "false", "\"constant\""],
        "`GG` is absent until `require \"gg\"`, which loads the SDK exactly once"
    );

    // What that one load builds: the lifted table `GG::Scope` needs in order to refuse a wrong
    // argument count or an unknown keyword, closed once it is built.
    let outcome = run("require \"gg\"
require \"gg\"
puts GG::Scope::IMPLEMENTATIONS.size
puts GG::Scope::IMPLEMENTATIONS.frozen?
");
    let lifted = logs(&outcome);
    assert_eq!(lifted[1], "true", "the table is closed once it is built");
    assert!(
        lifted[0].parse::<usize>().expect("a count") >= 35,
        "the lifted table has only {} entries",
        lifted[0]
    );
}

#[test]
fn opal_is_not_cruby_and_the_study_records_which_ways() {
    // Every one of these is a difference a model's program can observe, and a study that reported
    // "Ruby" without recording them would be reporting something else. Asserted against the
    // embedded artifact rather than described in prose, so the claim is checkable.
    let outcome = run(r##"
puts (1 / 0).to_s
puts (2 ** 64).to_s
puts :done.class
puts(:done == "done")
puts RUBY_ENGINE
"##);
    assert_eq!(
        logs(&outcome),
        [
            // Integer division is JavaScript's, so this is `Infinity` where CRuby raises.
            "Infinity",
            // No bignum.
            "18446744073709552000",
            // A Symbol IS a String here. What a program writes is unchanged (`:done`), and the SDK
            // still refuses a value outside a fixed set by name, but `:done.class` is not `Symbol`
            // and `:done == "done"` is true.
            "String",
            "true",
            "opal",
        ]
    );

    // The fourth divergence, and the boundary of gg's own arity promise. gg compiles the model's
    // program, this SDK and the curated libraries with `arity_check`, so a wrong argument count in
    // any of them is Ruby's own `ArgumentError`. Opal's CORELIB is not gg's to compile — `Array`,
    // `Hash`, `String` and `Integer` arrive already compiled inside `opal-runtime`'s `opal.js`,
    // built by Opal with the flag off — so a wrong-arity corelib call is not checked at all. That
    // is why the system prompt's promise is scoped to the model's own methods and the SDK's
    // functions rather than to "anything".
    //
    // What it fails as is worth pinning exactly, because it is not an `ArgumentError` and it is not
    // a Ruby exception either: the corelib method reads past its arguments and the JavaScript
    // engine raises. A bare `rescue` — which is `rescue StandardError` — does not see it.
    let outcome = run(r##"
begin
  puts [1, 2].fetch.to_s
rescue => failure
  puts "rescued #{failure.class}"
end
"##);
    let error = program_error(&outcome);
    assert!(
        !error.message.contains("ArgumentError"),
        "corelib is outside the arity promise, and saying otherwise would be the defect again: {}",
        error.message
    );
    assert!(
        outcome.logs.is_empty(),
        "a bare `rescue` does not see it, because it is not a StandardError: {:?}",
        outcome.logs
    );

    // `rescue Exception` does catch it, as the widest arm in Ruby catches anything — but the class
    // it hands over is bare `Exception`, not the `ArgumentError` the same mistake produces one
    // frame away in the model's own code. A program cannot tell from the class what it did wrong,
    // which is the whole content of this caveat.
    let outcome = run(r##"
begin
  puts [1, 2].fetch.to_s
rescue Exception => failure
  puts "rescued #{failure.class}"
end
"##);
    assert_eq!(logs(&outcome), ["rescued Exception"]);

    // `sleep` is a busy wait in Opal rather than a park in a host call, so the execution deadline
    // reaches it exactly as it reaches any other runaway — which is the opposite of what the Python
    // arm documents, and worth pinning for the same reason. The program sleeps forever, so it can
    // only end by being stopped; a deadline that could not reach the sleep would hang the test.
    let limits = SandboxLimits {
        timeout: std::time::Duration::from_millis(100),
        ..SandboxLimits::AMPLE
    };
    // The host's work — the real `opal` compile and the component lookup — is done before the store
    // is built, because `bounded_store` arms the deadline the moment it builds the state, and host
    // work done after that would be charged to a program that has not started.
    let program = prepare("puts 'sleeping'\nloop { sleep 1 }\nputs 'never'\n");
    let component = component();
    let log = CallLog::default();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let scope = ProgramScope {
        capabilities: &[],
        operations: &[],
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(
        MembraneState::new(
            FakeOperationApi::with(&log, canned_outcome),
            ruby(),
            scope,
            limits,
            None,
        ),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
    let returned = bound
        .call_run(
            &mut store,
            &program,
            &[],
            &[],
            RunEnding::None.into(),
            false,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let (outcome, _api) = reclaim(store, returned, None, None);
    assert!(
        matches!(outcome.result, Err(SandboxError::Timeout { .. })),
        "a sleeping Ruby program is stopped by the deadline: {:?}",
        outcome.result
    );
    assert_eq!(
        outcome.logs,
        ["sleeping"],
        "the deadline stopped the program inside its sleep"
    );
}

#[test]
fn the_embedded_guest_imports_the_membrane_and_the_wasi_it_was_baked_with() {
    // What this component asks the host for, written down rather than inferred: `wasi:filesystem`
    // and `wasi:sockets` are absent because it is baked without them, not because the host withholds
    // them — gg's linker defines the whole surface for every guest, so what a component declares is
    // the whole of what it can reach.
    let mut imports = interface_imports(component());
    imports.sort_unstable();
    assert_eq!(
        imports
            .iter()
            .filter(|name| name.starts_with("wasi:"))
            .map(String::as_str)
            .collect::<Vec<&str>>(),
        [
            "wasi:cli/stderr",
            "wasi:clocks/monotonic-clock",
            "wasi:clocks/wall-clock",
            "wasi:io/error",
            "wasi:io/poll",
            "wasi:io/streams",
            "wasi:random/random",
        ],
        "the embedded Ruby guest's WASI surface changed; if that was intended, update the prose \
         that describes what this guest can reach (`packages/gg-sandbox-ruby/README.md`, \
         `gg/languages/agent-surface.md`) in the same commit"
    );

    // Every gg interface the world declares is present, because this guest's entry module imports
    // every one of them — which is what puts them in the artifact. A binding that was not baked in
    // is a capability a program could not reach however well the host implements it.
    assert_eq!(
        imports
            .iter()
            .filter(|name| name.starts_with("test-cabinet:gg/"))
            .count(),
        14,
        "the whole gg half of the membrane, the shim's own feedback channel included"
    );

    // ~20 MiB: a whole JavaScript engine, plus Opal's corelib, the curated libraries and gg's Ruby
    // SDK as they stand after their top level has run. A band rather than a number because the build
    // snapshots a running engine's heap. Far smaller would mean something never got baked — the
    // failure this artifact exists to prevent — and far larger, that the build picked up something
    // it should not have.
    assert!(
        (18 * 1024 * 1024..=24 * 1024 * 1024).contains(&COMPONENT.len()),
        "the embedded Ruby guest is {} bytes, outside the documented 18–24 MiB band",
        COMPONENT.len()
    );

    // The bijection the embedded artifact is held to: this guest binds gg's whole tool vocabulary
    // and nothing else. It is the RUBY SDK's own catalogue doing the answering, so this is a check
    // of that SDK rather than a second reading of the TypeScript one.
    // The component before the store, as everywhere in this file: `bounded_store` arms the guest's
    // 30 s wall-clock deadline, and a `Component::new` of a 21 MB guest performed inside it is
    // charged to a program that has not started. See [`evaluate`] for the measurements.
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let scope = ProgramScope {
        capabilities: &[],
        operations: &[],
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(
        MembraneState::new(FakeOperationApi::new(&log), ruby(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    let mut answered = bound
        .call_bound_operations(&mut store)
        .expect("the guest answers");
    answered.sort();
    let mut expected = crate::sandbox::signatures::sandbox_operation_names();
    expected.sort_unstable();
    assert_eq!(answered, expected);
}

/// The catalogue this arm's build reflects, read a step before the language that owns it is registered.
const SIGNATURES: &str = include_str!(concat!(env!("OUT_DIR"), "/signatures/ruby.signatures.json"));

#[test]
fn the_generated_catalogue_agrees_with_the_arms_it_will_be_compared_against() {
    // The **real** capability gate, over the real Ruby catalogue. It is what stands between a
    // configured `language` param and an invalidated study: an arm that quietly offers a model
    // fewer capabilities than the arm it is measured against is a green test suite, and this is the
    // only thing that would notice.
    let document: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Ruby catalogue is valid JSON");
    assert_eq!(
        document["language"],
        json!("ruby"),
        "the catalogue says whose spellings it carries"
    );

    let found = super::super::agreement::disagreements(&[
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        ruby(),
    ]);
    assert!(
        found.is_empty(),
        "the Ruby catalogue does not offer gg's capability surface:\n{}",
        found
            .iter()
            .map(|disagreement| format!("  - {}\n", disagreement.detail))
            .collect::<String>()
    );

    // The first arm to carry an entry with more than one signature, which is the half of the
    // catalogue schema nothing had produced: a block is how a Ruby program passes a long body, and
    // an overload group is how that is said without changing what the function is.
    let overloaded: Vec<&str> = document["functions"]
        .as_array()
        .expect("the catalogue's `functions` is an array")
        .iter()
        .filter(|entry| entry["signatures"].as_array().is_some_and(|s| s.len() > 1))
        .map(|entry| entry["fqn"].as_str().expect("a name"))
        .collect();
    assert_eq!(overloaded, ["GG::Files.write_file", "GG::Views.open_text"]);
}

#[test]
fn the_generated_catalogue_describes_the_functions_the_guest_really_binds() {
    // The other half of the catalogue's honesty, and the one no cross-language comparison can see:
    // that the surface it *describes* is the surface the embedded `.wasm` really binds. A signature
    // reflected out of a source file that was never baked in would read perfectly and name a call
    // that is not there.
    let catalogue: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Ruby catalogue is valid JSON");
    let functions = catalogue["functions"]
        .as_array()
        .expect("the catalogue's `functions` is an array");

    // A standard agent that keeps a library is offered every operation but the reviewer's two
    // endings, so every other entry names something the guest must really bind. The fully-qualified
    // name says how to ask: `.` reaches a module function on its module, `#` an instance method on
    // the class it hangs off.
    let asked = |entry: &Value| -> Option<String> {
        let operation = entry["operation"].as_str().expect("an operation");
        if operation == "session.approve" || operation == "session.request_changes" {
            return None;
        }
        let fqn = entry["fqn"].as_str().expect("a fully-qualified name");
        Some(match fqn.split_once('#') {
            Some((owner, name)) => format!("{owner}.method_defined?(:{name})"),
            None => {
                let (owner, name) = fqn.rsplit_once('.').expect("a module-qualified name");
                format!("{owner}.respond_to?(:{name})")
            }
        })
    };
    let calls: Vec<String> = functions.iter().filter_map(asked).collect();

    let program = format!(
        "{}\nputs [{}].map {{ |ok| ok ? \"ok\" : \"missing\" }}.join(\",\")\n",
        super::SURFACE_IMPORT,
        calls.join(", ")
    );
    let (outcome, _log) = run_as(
        &program,
        &all_operations(),
        &[],
        RunEnding::Role(EndingRole::Standard),
        true,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [vec!["ok"; calls.len()].join(",")],
        "every call the catalogue describes is bound on the module it names"
    );

    // The reviewer's ending is the other group, and it is bound only for the role that produces it.
    let review: Vec<String> = functions
        .iter()
        .filter(|entry| {
            entry["operation"] == json!("session.approve")
                || entry["operation"] == json!("session.request_changes")
        })
        .map(|entry| {
            let fqn = entry["fqn"].as_str().expect("a fully-qualified name");
            let (owner, name) = fqn.rsplit_once('.').expect("a module-qualified name");
            format!("{owner}.respond_to?(:{name})")
        })
        .collect();
    let (outcome, _log) = run_as(
        &format!(
            "{}\nputs [{}].map {{ |ok| ok ? \"ok\" : \"missing\" }}.join(\",\")\n",
            super::SURFACE_IMPORT,
            review.join(", ")
        ),
        &[],
        &[],
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [vec!["ok"; review.len()].join(",")]);

    // And every TYPE it declares is a name a program can write, under the fully-qualified name the
    // catalogue advertises — because a signature that mentions one a program cannot name is a
    // signature a model cannot act on: `4..19` is an argument, `GG::Core::ApiError` is what a
    // `rescue` clause catches, and `GG::Tasks::TaskStatus::DONE` is a status. Named as constants
    // rather than asked for by string, so an absent one is a `NameError` on the line that wrote it.
    let types: Vec<&str> = catalogue["types"]
        .as_array()
        .expect("an array")
        .iter()
        .map(|entry| entry["fqn"].as_str().expect("a fully-qualified name"))
        .collect();
    let outcome = run(&format!(
        "{}\nputs [{}].size\n",
        super::SURFACE_IMPORT,
        types.join(", ")
    ));
    assert_eq!(logs(&outcome), [types.len().to_string()]);
}

#[test]
fn an_argument_mistake_is_an_argument_error_rather_than_silence() {
    // The defect this arm shipped with. Opal defaults `arity_check` OFF, so every `def` in a
    // compiled program — the model's own and gg's SDK's alike — bound a missing parameter to
    // JavaScript `undefined` and carried on. `def two(a, b)` called with one argument did not
    // raise; it died further down with `can't access property "$inspect", b is undefined`, a
    // message naming a variable of the COMPILED JavaScript, which is the one leak the source map
    // exists to prevent. `GG::Tasks.add_task("id")` reached the membrane and came back as
    // `TypeError: expected a string, received [undefined]` — a sentence about the wire, for a
    // mistake in the program.
    //
    // gg now compiles both halves with `arity_check`, and `GG::Scope` checks the surface it
    // binds before the call is made. All of what follows is measured through the real compiler and
    // the real membrane, because the claim is about the embedded artifacts and nothing else can
    // say it.
    //
    // Programs are batched — one compile drives many mistakes, each rescued and logged — because a
    // compile here spawns a real `node` over the 2.9 MB Opal bundle, and this file's own rule is
    // that a case is a program rather than a function.

    // A user-defined method, UNCAUGHT: Ruby's own exception, in the model's own file, naming the
    // count. This is what `arity_check` buys, and nothing else in the arm can produce it.
    let outcome = run(r##"
def two(a, b)
  "#{a}#{b}"
end

puts "before"
two("only")
"##);
    let error = program_error(&outcome);
    assert!(
        error.message.contains("ArgumentError") && error.message.contains("given 1, expected 2"),
        "a wrong positional count is Ruby's own ArgumentError naming the count: {}",
        error.message
    );
    assert!(
        !error.message.contains("undefined"),
        "the compiled JavaScript's variables never reach the model: {}",
        error.message
    );
    assert!(
        error.message.contains("two"),
        "and it names the method, which is how the model finds the call: {}",
        error.message
    );
    // Located at the `def` rather than at the call, because that is the frame Ruby itself raises
    // from — CRuby's own top frame for a wrong-arity call is `Object#two`, with the call site the
    // line below it — and gg reports one location rather than a backtrace. What matters for the
    // source map is that it is a line of the MODEL'S RUBY at all: without it the location would be
    // a line of the JavaScript Opal emitted.
    assert_eq!(
        error.location.as_deref(),
        Some("line 2"),
        "the location is Ruby's own frame, in the model's own file"
    );
    assert_eq!(outcome.logs, ["before"], "what ran before it still reports");

    // Too MANY is refused as well — which is what says this is an arity check rather than a nil
    // guard — and an `ArgumentError` is a `StandardError`, so a bare `rescue` catches it and the
    // program carries on. That is the half a model needs in order to recover inside one turn.
    let outcome = run(r##"
def one(a)
  a
end

begin
  one(1, 2, 3)
rescue => failure
  puts "#{failure.class}: #{failure.message}"
end
puts "carried on"
"##);
    let logged = logs(&outcome);
    assert!(
        logged[0].starts_with("ArgumentError:") && logged[0].contains("given 3, expected 1"),
        "too many positionals is a rescuable ArgumentError: {logged:?}"
    );
    assert_eq!(logged[1], "carried on");

    // THE SDK, positional. Every refusal names the call THE MODEL WROTE — `GG::Files.read_file`, not the
    // internal `GG::Files.read_file` — which is why the forwarder checks as well as the compiler:
    // the model has no idea `GG::Files` exists, and Opal's own message would also have rendered
    // Ruby's negative arity encoding (`expected -3`), a number no CRuby message ever prints.
    let (outcome, log) = run_with(
        r##"
require "gg"
def why
  yield
  puts "NOT REFUSED"
rescue ArgumentError => failure
  puts failure.message
end

why { GG::Files.read_file }
why { GG::Tasks.add_task("just-an-id") }
why { GG::Files.write_file("a.rb", "b", "c") }
why { GG::Tasks.set_blocked_by }
why { GG::Files.edit_file("a.rb", "old") }
"##,
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "wrong number of arguments (given 0, expected 1) — `GG::Files.read_file`",
            "wrong number of arguments (given 1, expected 2) — `GG::Tasks.add_task`",
            // An optional positional widens the accepted count rather than defeating the check.
            "wrong number of arguments (given 3, expected 1..2) — `GG::Files.write_file`",
            // A splat removes the ceiling without removing the floor.
            "wrong number of arguments (given 0, expected 1+) — `GG::Tasks.set_blocked_by`",
            "wrong number of arguments (given 2, expected 3) — `GG::Files.edit_file`",
        ]
    );
    assert!(
        log.calls().is_empty(),
        "not one of them reached the membrane: {:?}",
        log.names()
    );

    // THE KEYWORD HALF, which `arity_check` does not cover at all: Opal lowers keyword arguments to
    // a trailing hash and never reads the extra keys. `reviewer:` for `reviewers:` — the
    // singular/plural typo a model makes constantly — was ACCEPTED, and the issue was created with
    // `"reviewers": []` while the program believed it had named one. Silently losing an argument
    // the model did supply is worse than refusing the call, so it is refused, in CRuby's own words
    // and naming the set that would have worked.
    let (outcome, log) = run_with(
        r##"
require "gg"
def why
  yield
  puts "NOT REFUSED"
rescue ArgumentError => failure
  puts failure.message
end

why { GG::Board.create_issue("t", "in", "out", "done", "worker", reviewer: ["r1"]) }
why { GG::Tasks.add_task("id", "t", desc: "oops") }
why { GG::Files.read_file("a.rb", start: 3) }
why { GG::Files.list_dir("src", deep: true) }
why { GG::Programs.history(deep: true) }
"##,
        &all_operations(),
        &[],
        canned_outcome,
    );
    let refusals = logs(&outcome);
    assert!(
        refusals[0].contains("unknown keyword: :reviewer")
            && refusals[0].contains(":reviewers")
            && refusals[0].contains("`GG::Board.create_issue`"),
        "the typo is refused and the accepted set is named: {refusals:?}"
    );
    assert!(
        refusals[1].contains("unknown keyword: :desc"),
        "{refusals:?}"
    );
    assert!(
        refusals[2].contains("unknown keyword: :start"),
        "{refusals:?}"
    );
    assert!(
        refusals[3].contains("unknown keyword: :deep"),
        "{refusals:?}"
    );
    // A function that declares no keyword at all says so, rather than listing an empty set.
    assert!(
        refusals[4].contains("takes no keyword arguments"),
        "a nullary function names its own shape: {refusals:?}"
    );
    assert!(
        log.calls().is_empty(),
        "and no issue was created with an empty reviewer list: {:?}",
        log.args("create_issue")
    );

    // And none of this refuses what is correct — the check has to be invisible to a program that
    // gets it right, including through the two idioms the forwarder exists to preserve: a block
    // body, and a splat.
    let (outcome, log) = run_with(
        r##"
require "gg"
GG::Files.write_file("out/a.rb") { "from a block" }
GG::Tasks.add_task("t1", "title", description: "d", blocked_by: ["t0"])
GG::Tasks.set_blocked_by("t1", "t0", "t2")
puts "clean"
"##,
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["clean"]);
    assert_eq!(
        log.names(),
        ["write_file", "add_task", "set_blocked_by"],
        "correct calls are untouched by the check"
    );
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out/a.rb", "contents": "from a block" })),
        "the block body still arrives as the contents it is"
    );
    assert_eq!(
        log.args("set_blocked_by"),
        Some(json!({ "id": "t1", "blockedBy": ["t0", "t2"] })),
        "and the splat still arrives as the list it is"
    );
}

/// **Gate [G8](super::super::g8) for Ruby** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::Ruby,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"# G8 (a): a gg call the host answers `not-found`, uncaught.
require "gg"

text = GG::Files.read_file(
  "missing.md",
)
puts text
"#,
                names: &["read_file", "not-found", "missing.md"],
                located: Located::At("line 4"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramApiError),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"# G8 (b): an index past the end of an array.

values = [1, 2, 3]
puts(
  values.fetch(7),
)
"#,
                names: &["IndexError", "index 7 outside of array bounds"],
                located: Located::At("line 5"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"# G8 (c): ending by a failure value.

def outcome
  RuntimeError.new("the third step did not finish")
end

outcome
"#,
                names: &["the third step did not finish"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: None,
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"# G8 (d): unbounded recursion.

def deeper(n)
  deeper(n + 1)
end

deeper(0)
"#,
                names: &["too much recursion"],
                located: Located::At("line 4"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::Abort,
                program: r#"# G8 (e): stopping the process outright.

puts "before the exit"
exit(
  3,
)
puts "after the exit"
"#,
                names: &["SystemExit", "3"],
                located: Located::At("line 4"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
        ],
    );
}

/// **Nothing gg offers resolves without a line the program wrote** — the assertion behind
/// [ruling D3](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) on this arm.
///
/// Every program below is driven through the real guest. The negative half is what makes the
/// positive half mean anything: gg's SDK, the agent's own code and the library set are all
/// registered in Opal's require registry and none of them is loaded, so a program that writes no
/// `require` has Opal's corelib and its own text.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    // The commonest call there is, written without the line that reaches it. Ruby's own answer,
    // from Ruby's own constant lookup: there is no `GG`.
    let outcome = run("text = GG::Files.read_file(\"notes.md\")\nputs text.contents\n");
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error.message.starts_with("uninitialized constant GG"),
        "the reach for gg's surface is refused in Ruby's own words: {}",
        error.message
    );
    // And the sentence gg adds to it is the line that would have worked, with the modules it
    // reaches — the model's next program is one edit away.
    assert!(
        error
            .message
            .contains("`require \"gg\"` reaches GG::Docs, GG::Files"),
        "the refusal names the line that reaches the surface: {}",
        error.message
    );

    // And it is written only where it is a REMEDY. A `NoMethodError` on the program's own value has
    // nothing to do with gg's surface, and a program that already wrote the require cannot be told
    // to write it again — either way the sentence would be a fix for a failure with another cause.
    for (program, missing) in [
        ("puts 1\nputs nil.upcase\n", "undefined method"),
        ("require \"gg\"\nputs nil.upcase\n", "undefined method"),
    ] {
        let outcome = run(program);
        let error = program_error(&outcome);
        assert!(
            error.message.contains(missing),
            "`{program}` failed some other way: {}",
            error.message
        );
        assert!(
            !error.message.contains("`require \"gg\"` reaches"),
            "a failure gg's own line cannot fix was told to write it: {}",
            error.message
        );
    }

    // A type is behind the same line, and so is the constant a `rescue` clause names — this arm
    // has no half of its surface that arrives some other way.
    for reach in ["GG::Core::ApiError", "GG::Tasks::TaskStatus::DONE"] {
        let outcome = run(&format!("puts {reach}\n"));
        let error = program_error(&outcome);
        assert_eq!(error.kind, ProgramErrorKind::UnknownName);
        assert!(
            error.message.starts_with("uninitialized constant GG"),
            "{reach} resolves to nothing without the line: {}",
            error.message
        );
    }

    // The agent's own loaded code is behind a second line, and it is not the first one: `require
    // "gg"` is gg's surface and reaches no skill of the agent's.
    let module = CodeModule {
        name: "helpers".to_string(),
        source: prepare_module("def double(n) = n * 2\n"),
    };
    let outcome = run_with(
        "puts lib.helpers.double(21)\n",
        &[],
        std::slice::from_ref(&module),
        canned_outcome,
    )
    .0;
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::UnknownName);
    let outcome = run_with(
        "require \"gg\"\nputs lib.helpers.double(21)\n",
        &[],
        std::slice::from_ref(&module),
        canned_outcome,
    )
    .0;
    assert_eq!(
        program_error(&outcome).kind,
        ProgramErrorKind::UnknownName,
        "gg's surface is not a second way to reach the agent's own code"
    );

    // A library is behind the same mechanism, which is the point: there is no special case for
    // gg's own file in this guest's require registry.
    let outcome = run("puts JSON.parse('{\"a\": 1}')[\"a\"]\n");
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::UnknownName);

    // THE POSITIVE HALF, with the line read out of the catalogue rather than typed here — so what
    // is proven is that the line gg TELLS a model to write is the line that works.
    let import = ruby()
        .catalogue()
        .modules
        .iter()
        .find(|module| module.id == "files")
        .expect("this arm's catalogue declares the files module")
        .import
        .clone()
        .expect("this arm states an import line for every module");
    let (outcome, log) = run_with(
        &format!(
            "{import}\n\ntext = GG::Files.read_file(\"notes.md\")\nputs text.contents.lines.first.strip\n"
        ),
        &[crate::sandbox::operations::FILES_READ_FILE],
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["contents of notes.md"]);
    assert_eq!(log.names(), ["read_file"]);

    // And the other two lines, each reaching exactly what it names — the module's own line read
    // off the arm rather than typed here, so what is proven is that the line gg quotes in the
    // documentation view of a loaded module is the line that reaches it.
    let lib_import = ruby()
        .lib_import("helpers")
        .expect("this arm states the line a program writes to reach a loaded module");
    let (outcome, _log) = run_with(
        &format!("{lib_import}\nputs lib.helpers.double(21)\n"),
        &[],
        std::slice::from_ref(&module),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["42"]);
    let outcome = run("require \"json\"\nputs JSON.parse('{\"a\": 1}')[\"a\"]\n");
    assert_eq!(logs(&outcome), ["1"]);
}

/// **A whole Ruby program, of the shape a model writes one**, driven through
/// [`run_program`](crate::sandbox::run_program) — the function a turn calls, so the arm answers
/// through the registry, its real compiler, its real guest and the real membrane.
#[test]
fn a_whole_ruby_program_a_model_would_write_runs_through_the_turn_path() {
    let program = r##"require "gg"
require "json"

# The reading this turn is about, and what it is worth saying about it.
Reading = Struct.new(:path, :lines) do
  def summary = "#{path}: #{lines} lines"
end

file = GG::Files.read_file("notes.md")
reading = Reading.new("notes.md", file.contents.lines.size)
puts reading.summary

GG::Views.open_text("notes", JSON.parse(%({"label": "notes"}))["label"] + " #{reading.lines}")
"##;

    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome);
    let operations = granted_operations(&all_operations(), false);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let (outcome, _api) = crate::sandbox::run_program(
        crate::sandbox::language(GgProgramLanguage::Ruby),
        program,
        scope,
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        api,
    );

    assert_eq!(logs(&outcome), ["notes.md: 2 lines"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": null, "limit": null })),
        "the call the program wrote arrived at the host as itself"
    );
    assert!(
        outcome
            .views_opened
            .iter()
            .any(|view| view.selector.contains("notes")),
        "the view the program opened on the answer is in the turn's outcome: {:?}",
        outcome.views_opened
    );
}

/// The workspace search lowers each match to the model-facing class, a `limit` of zero and a
/// Regexp `query` are refused on this side of the membrane, and `open_file`'s line cut crosses
/// under the docs' name for it — added to the dispatch arguments only when the program wrote it.
#[test]
fn the_workspace_search_and_the_line_cut_cross_from_ruby() {
    let (outcome, log) = run_with(
        r##"
require "gg"
hits = GG::Files.search("answer", path: "src")
puts "#{hits.size} #{hits.first.class} #{hits.first.path} #{hits.first.line} #{hits.first.text}"
begin
  GG::Files.search("answer", limit: 0)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code == GG::Core::ApiErrorCode::INVALID_ARGUMENT}"
end
begin
  GG::Files.search(/answer/)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code == GG::Core::ApiErrorCode::INVALID_ARGUMENT}"
end
GG::Views.open_file("notes.md", max_line_chars: 40)
GG::Views.open_file("notes.md", offset: 2, limit: 1)
"##,
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "1 GG::Files::SearchMatch src/a.ts 3 const answer = 42;",
            "search true",
            "search true",
        ]
    );
    assert_eq!(log.names(), ["search", "read_file", "read_file"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "src", "limit": null }))
    );
    let reads: Vec<Value> = log
        .calls()
        .into_iter()
        .filter(|call| call.name == "read_file")
        .map(|call| call.args)
        .collect();
    assert_eq!(
        reads,
        [
            json!({ "path": "notes.md", "offset": null, "limit": null, "maxLineChars": 40 }),
            json!({ "path": "notes.md", "offset": 2, "limit": 1 }),
        ]
    );
}

// ---------------------------------------------------------------------------------------------
// Program-level cases: one call, read back the way a model reads it.
//
// Everything below drives ONE short Ruby program through the real membrane with every operation
// granted, and asserts on what the program PRINTED rather than on the JSON that crossed — which
// the crossing table above already asserts exhaustively. The two kinds of refusal are told apart
// by where they happen: a refusal the SDK raises guest-side asserts the wire stayed untouched
// (`refused`), and a refusal the host raises is one case per `ApiErrorCode` a program can branch
// on (`failing`).
// ---------------------------------------------------------------------------------------------

/// One Ruby program, every operation granted, answered by `responder`: what it printed, and what
/// reached the wire.
///
/// [`logs`] insists the program did not raise, so a case about a failure has to rescue it — which
/// is what makes "the model read this back" the assertion rather than "the program survived".
fn drive(
    ruby: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (Vec<String>, CallLog) {
    let (outcome, log) = sdk_with(ruby, responder);
    (logs(&outcome).to_vec(), log)
}

/// [`drive`] with the canned table answering every call — what a success case wants.
fn driven(ruby: &str) -> (Vec<String>, CallLog) {
    drive(ruby, canned_outcome)
}

/// [`driven`], for a program whose call the SDK refuses on this side of the membrane: what it
/// printed, insisting the value never reached the wire.
///
/// The assertion is the whole point of a guest-side check. A refusal the host would have written
/// anyway is worth nothing here; what these buy is that the bad value never became an effect.
fn refused(ruby: &str) -> Vec<String> {
    let (printed, log) = driven(ruby);
    assert!(
        log.calls().is_empty(),
        "a refusal the SDK raises never reaches the wire: {:?}",
        log.calls()
    );
    printed
}

/// A responder that answers `tool` with `failure` carrying `message`, and everything else from the
/// canned table.
///
/// One per `ApiErrorCode` a call can be branched on, never one per sentence: the double answers
/// whatever this returns, so a second injection of the same code with different words would be
/// testing this function.
fn failing(
    tool: &'static str,
    failure: ToolFailure,
    message: &'static str,
) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |name: &str, args: &Value| {
        if name == tool {
            return ToolOutcome::failed(failure, message.to_string());
        }
        canned_outcome(name, args)
    }
}

/// A responder that answers `tool` with `data`, and everything else from the canned table — for the
/// empty results the canned table has no way to ask for.
fn answering(
    tool: &'static str,
    data: ApiData,
) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |name: &str, args: &Value| {
        if name == tool {
            return ToolOutcome::ok("nothing matched", "nothing").with_data(data.clone());
        }
        canned_outcome(name, args)
    }
}

/// The timeout killing the process is one of the two things a shell call raises for at all.
#[test]
fn a_killed_shell_is_a_limit_exceeded_the_program_rescues() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Shell.run("sleep 600", timeout_secs: 1)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "shell",
            ToolFailure::LimitExceeded,
            "killed after 1s: `sleep 600`",
        ),
    );
    assert_eq!(
        printed,
        ["shell limit_exceeded killed after 1s: `sleep 600`"]
    );
}

/// And the other: a process that never started, which is an I/O failure rather than an exit code.
#[test]
fn a_shell_that_could_not_launch_is_an_io_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Shell.run("./missing-binary")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "shell",
            ToolFailure::IoError,
            "could not launch `sh`: No such file or directory",
        ),
    );
    assert_eq!(
        printed,
        ["shell io_error could not launch `sh`: No such file or directory"]
    );
}

/// An empty path is the host's to refuse, and the program reads the class of the refusal.
#[test]
fn an_empty_read_path_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.read_file("")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "read_file",
            ToolFailure::InvalidArgument,
            "`path` may not be empty",
        ),
    );
    assert_eq!(
        printed,
        ["read_file invalid_argument `path` may not be empty"]
    );
}

/// The same refusal on the way out: a write with nowhere to write it.
#[test]
fn an_empty_write_path_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.write_file("", "hello")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "write_file",
            ToolFailure::InvalidArgument,
            "`path` may not be empty",
        ),
    );
    assert_eq!(
        printed,
        ["write_file invalid_argument `path` may not be empty"]
    );
}

/// A write that reached the filesystem and lost is an `io-error`, told apart from a bad argument.
#[test]
fn a_write_that_failed_is_an_io_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.write_file("out/a.txt", "hello")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "write_file",
            ToolFailure::IoError,
            "could not create `out`: Permission denied",
        ),
    );
    assert_eq!(
        printed,
        ["write_file io_error could not create `out`: Permission denied"]
    );
}

/// An edit whose anchor is not in the file is a `not-found` about the text, not about the path.
#[test]
fn an_edit_whose_text_is_absent_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.edit_file("src/a.rb", "alpha", "beta")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "edit_file",
            ToolFailure::NotFound,
            "`alpha` does not appear in src/a.rb",
        ),
    );
    assert_eq!(
        printed,
        ["edit_file not_found `alpha` does not appear in src/a.rb"]
    );
}

/// An ambiguous edit is a `conflict`, and the COUNT survives into what the model reads — which is
/// the whole difference between "try again" and "include more surrounding text".
#[test]
fn an_edit_that_matches_twice_is_a_conflict_carrying_the_count() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.edit_file("src/a.rb", "alpha", "beta")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "edit_file",
            ToolFailure::Conflict,
            "`alpha` appears 3 times in src/a.rb; include more surrounding text",
        ),
    );
    assert_eq!(
        printed,
        ["edit_file conflict `alpha` appears 3 times in src/a.rb; include more surrounding text"]
    );
}

/// A listing of somewhere that is not there.
#[test]
fn a_missing_directory_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.list_dir("nowhere")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "list_dir",
            ToolFailure::NotFound,
            "no such directory: nowhere",
        ),
    );
    assert_eq!(printed, ["list_dir not_found no such directory: nowhere"]);
}

/// A path given and empty is refused, which is what makes leaving it out the way to list the root.
#[test]
fn an_empty_list_path_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.list_dir("")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "list_dir",
            ToolFailure::InvalidArgument,
            "`path` was given but empty; leave it out to list the workspace root",
        ),
    );
    assert_eq!(
        printed,
        [
            "list_dir invalid_argument `path` was given but empty; leave it out to list the workspace root"
        ]
    );
}

/// A walk of somewhere that is not there.
#[test]
fn a_tree_of_a_missing_path_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.tree(path: "nowhere")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing("tree", ToolFailure::NotFound, "no such path: nowhere"),
    );
    assert_eq!(printed, ["tree not_found no such path: nowhere"]);
}

/// A walk of a file is a bad argument rather than a missing one.
#[test]
fn a_tree_of_something_that_is_not_a_directory_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.tree(path: "notes.md")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "tree",
            ToolFailure::InvalidArgument,
            "`notes.md` is not a directory",
        ),
    );
    assert_eq!(
        printed,
        ["tree invalid_argument `notes.md` is not a directory"]
    );
}

/// A blank pattern, which is also what an unparseable one reads as: one refusal the host writes
/// two sentences for.
#[test]
fn a_blank_search_query_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.search("   ")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "search",
            ToolFailure::InvalidArgument,
            "`query` may not be blank",
        ),
    );
    assert_eq!(
        printed,
        ["search invalid_argument `query` may not be blank"]
    );
}

/// A search rooted somewhere that is not there.
#[test]
fn a_search_of_a_missing_path_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Files.search("answer", path: "nowhere")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing("search", ToolFailure::NotFound, "no such path: nowhere"),
    );
    assert_eq!(printed, ["search not_found no such path: nowhere"]);
}

/// An unknown skill comes back naming the ones that DO exist, and the list reaches the model —
/// which is the only thing that makes the failure recoverable inside the same turn.
#[test]
fn an_unknown_skill_names_the_skills_that_exist() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Skills.read_skill("testng")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "read_skill",
            ToolFailure::NotFound,
            "no skill `testng`; this run has: reviewing, testing",
        ),
    );
    assert_eq!(
        printed,
        ["read_skill not_found no skill `testng`; this run has: reviewing, testing"]
    );
}

/// A slug already taken.
#[test]
fn writing_a_memory_that_already_exists_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.write_memory("layout", "d", "b")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "write_memory",
            ToolFailure::Conflict,
            "a memory named `layout` already exists",
        ),
    );
    assert_eq!(
        printed,
        ["write_memory conflict a memory named `layout` already exists"]
    );
}

/// And the run's memory cap, which is a ceiling rather than a conflict.
#[test]
fn writing_a_memory_past_the_cap_is_a_limit_exceeded() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.write_memory("layout", "d", "b")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "write_memory",
            ToolFailure::LimitExceeded,
            "the memory store is full (8 of 8 memories)",
        ),
    );
    assert_eq!(
        printed,
        ["write_memory limit_exceeded the memory store is full (8 of 8 memories)"]
    );
}

/// A replacement keyed on a slug nothing holds.
#[test]
fn updating_a_memory_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.update_memory("layout", "d", "b")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "update_memory",
            ToolFailure::NotFound,
            "no memory named `layout`",
        ),
    );
    assert_eq!(
        printed,
        ["update_memory not_found no memory named `layout`"]
    );
}

/// A replacement whose new body would breach the aggregate.
#[test]
fn updating_a_memory_past_the_cap_is_a_limit_exceeded() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.update_memory("layout", "d", "b")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "update_memory",
            ToolFailure::LimitExceeded,
            "the new body would take the store past 4000 characters",
        ),
    );
    assert_eq!(
        printed,
        ["update_memory limit_exceeded the new body would take the store past 4000 characters"]
    );
}

/// The out-of-context creation refuses a duplicate slug on the same terms the in-context one does.
#[test]
fn creating_a_memory_whose_slug_is_taken_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.create_memory("layout", "d", "b")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "create_memory",
            ToolFailure::Conflict,
            "a memory named `layout` already exists",
        ),
    );
    assert_eq!(
        printed,
        ["create_memory conflict a memory named `layout` already exists"]
    );
}

/// And runs into the same ceiling.
#[test]
fn creating_a_memory_past_the_cap_is_a_limit_exceeded() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.create_memory("layout", "d", "b")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "create_memory",
            ToolFailure::LimitExceeded,
            "the memory store is full (8 of 8 memories)",
        ),
    );
    assert_eq!(
        printed,
        ["create_memory limit_exceeded the memory store is full (8 of 8 memories)"]
    );
}

/// A read of a slug nothing holds.
#[test]
fn reading_a_memory_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.read_memory("layout")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "read_memory",
            ToolFailure::NotFound,
            "no memory named `layout`",
        ),
    );
    assert_eq!(printed, ["read_memory not_found no memory named `layout`"]);
}

/// An edit whose anchor is not in the memory.
#[test]
fn editing_a_memory_whose_text_is_absent_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.edit_memory("layout", "old", "new")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "edit_memory",
            ToolFailure::NotFound,
            "`old` does not appear in `layout`",
        ),
    );
    assert_eq!(
        printed,
        ["edit_memory not_found `old` does not appear in `layout`"]
    );
}

/// An edit that is ambiguous.
#[test]
fn editing_a_memory_that_matches_twice_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.edit_memory("layout", "old", "new")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "edit_memory",
            ToolFailure::Conflict,
            "`old` appears 2 times in `layout`",
        ),
    );
    assert_eq!(
        printed,
        ["edit_memory conflict `old` appears 2 times in `layout`"]
    );
}

/// An edit whose result would be too long.
#[test]
fn editing_a_memory_past_the_cap_is_a_limit_exceeded() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.edit_memory("layout", "old", "new")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "edit_memory",
            ToolFailure::LimitExceeded,
            "the edit would take `layout` past 4000 characters",
        ),
    );
    assert_eq!(
        printed,
        ["edit_memory limit_exceeded the edit would take `layout` past 4000 characters"]
    );
}

/// And an edit that would leave nothing behind, which is a bad argument rather than a ceiling.
#[test]
fn an_edit_that_would_empty_a_memory_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.edit_memory("layout", "old", "new")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "edit_memory",
            ToolFailure::InvalidArgument,
            "the edit would leave `layout` empty; delete it instead",
        ),
    );
    assert_eq!(
        printed,
        ["edit_memory invalid_argument the edit would leave `layout` empty; delete it instead"]
    );
}

/// A search with nothing to look for — a keyword list the SDK let through because it was strings.
#[test]
fn a_memory_search_with_no_keywords_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.search_memories("")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "search_memories",
            ToolFailure::InvalidArgument,
            "`keywords` needs at least one non-empty word",
        ),
    );
    assert_eq!(
        printed,
        ["search_memories invalid_argument `keywords` needs at least one non-empty word"]
    );
}

/// An eviction of a slug nothing holds.
#[test]
fn deleting_a_memory_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Memories.delete_memory("layout")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "delete_memory",
            ToolFailure::NotFound,
            "no memory named `layout`",
        ),
    );
    assert_eq!(
        printed,
        ["delete_memory not_found no memory named `layout`"]
    );
}

/// An id already on the list.
#[test]
fn adding_a_task_whose_id_is_taken_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Tasks.add_task("t1", "T")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "add_task",
            ToolFailure::Conflict,
            "a task with id `t1` already exists",
        ),
    );
    assert_eq!(
        printed,
        ["add_task conflict a task with id `t1` already exists"]
    );
}

/// The other cause of the same code, told apart by the EDGE the sentence names — which is all a
/// model has to work with, since both arrive as `:conflict`.
#[test]
fn adding_a_task_that_would_close_a_cycle_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Tasks.add_task("t1", "T", blocked_by: ["t2"])
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "add_task",
            ToolFailure::Conflict,
            "`t1` blocked by `t2` would close a cycle",
        ),
    );
    assert_eq!(
        printed,
        ["add_task conflict `t1` blocked by `t2` would close a cycle"]
    );
}

/// A revision of an id nothing holds.
#[test]
fn updating_a_task_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Tasks.update_task("t9", status: :done)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing("update_task", ToolFailure::NotFound, "no task with id `t9`"),
    );
    assert_eq!(printed, ["update_task not_found no task with id `t9`"]);
}

/// A blocker set restated against an id nothing holds.
#[test]
fn restating_the_blockers_of_a_task_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Tasks.set_blocked_by("t9", "t0")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "set_blocked_by",
            ToolFailure::NotFound,
            "no task with id `t9`",
        ),
    );
    assert_eq!(printed, ["set_blocked_by not_found no task with id `t9`"]);
}

/// And one that would close a cycle.
#[test]
fn a_blocker_edge_that_would_close_a_cycle_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Tasks.set_blocked_by("t1", "t2")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "set_blocked_by",
            ToolFailure::Conflict,
            "`t1` blocked by `t2` would close a cycle",
        ),
    );
    assert_eq!(
        printed,
        ["set_blocked_by conflict `t1` blocked by `t2` would close a cycle"]
    );
}

/// A completion of an id nothing holds.
#[test]
fn completing_a_task_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Tasks.complete_task("t9")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "complete_task",
            ToolFailure::NotFound,
            "no task with id `t9`",
        ),
    );
    assert_eq!(printed, ["complete_task not_found no task with id `t9`"]);
}

/// A removal of an id nothing holds.
#[test]
fn removing_a_task_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Tasks.remove_task("t9")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing("remove_task", ToolFailure::NotFound, "no task with id `t9`"),
    );
    assert_eq!(printed, ["remove_task not_found no task with id `t9`"]);
}

/// A prefix outside three-to-six letters. The too-short, the too-long and the non-letter are one
/// refusal the host writes three sentences for, so this stands for all three.
#[test]
fn a_bad_epic_prefix_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.create_epic("au", "E", "D")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "create_epic",
            ToolFailure::InvalidArgument,
            "`prefix` must be three to six letters, got `au`",
        ),
    );
    assert_eq!(
        printed,
        ["create_epic invalid_argument `prefix` must be three to six letters, got `au`"]
    );
}

/// A prefix another epic already holds.
#[test]
fn an_epic_prefix_already_taken_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.create_epic("auth", "E", "D")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "create_epic",
            ToolFailure::Conflict,
            "an epic with prefix `AUTH` already exists",
        ),
    );
    assert_eq!(
        printed,
        ["create_epic conflict an epic with prefix `AUTH` already exists"]
    );
}

/// An agent this run does not declare — the same refusal an unassignable reviewer gets.
#[test]
fn an_unassignable_agent_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.create_issue("I", "s", "o", "c", "nobody")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "create_issue",
            ToolFailure::InvalidArgument,
            "`nobody` is not an agent this run declares",
        ),
    );
    assert_eq!(
        printed,
        ["create_issue invalid_argument `nobody` is not an agent this run declares"]
    );
}

/// A blocker named at creation that would close a cycle.
#[test]
fn an_issue_blocker_that_would_close_a_cycle_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.create_issue("I", "s", "o", "c", "worker", blocked_by: ["AUTH-1"])
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "create_issue",
            ToolFailure::Conflict,
            "`AUTH-1` would close a cycle",
        ),
    );
    assert_eq!(
        printed,
        ["create_issue conflict `AUTH-1` would close a cycle"]
    );
}

/// A revision of an id the board does not hold.
#[test]
fn updating_an_issue_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.update_issue("AUTH-9", status: :done)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "update_issue",
            ToolFailure::NotFound,
            "no issue with id `AUTH-9`",
        ),
    );
    assert_eq!(
        printed,
        ["update_issue not_found no issue with id `AUTH-9`"]
    );
}

/// A blocker set restated against an id the board does not hold.
#[test]
fn restating_the_blockers_of_an_issue_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.set_issue_blocked_by("AUTH-9", "AUTH-1")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "set_issue_blocked_by",
            ToolFailure::NotFound,
            "no issue with id `AUTH-9`",
        ),
    );
    assert_eq!(
        printed,
        ["set_issue_blocked_by not_found no issue with id `AUTH-9`"]
    );
}

/// And one that would close a cycle.
#[test]
fn an_issue_edge_that_would_close_a_cycle_is_a_conflict() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.set_issue_blocked_by("AUTH-1", "AUTH-2")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "set_issue_blocked_by",
            ToolFailure::Conflict,
            "`AUTH-1` blocked by `AUTH-2` would close a cycle",
        ),
    );
    assert_eq!(
        printed,
        ["set_issue_blocked_by conflict `AUTH-1` blocked by `AUTH-2` would close a cycle"]
    );
}

/// A removal of an epic the board does not hold.
#[test]
fn removing_an_epic_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.remove_epic("NOPE")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "remove_epic",
            ToolFailure::NotFound,
            "no epic with id `NOPE`",
        ),
    );
    assert_eq!(printed, ["remove_epic not_found no epic with id `NOPE`"]);
}

/// A removal of an issue the board does not hold.
#[test]
fn removing_an_issue_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.remove_issue("AUTH-9")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "remove_issue",
            ToolFailure::NotFound,
            "no issue with id `AUTH-9`",
        ),
    );
    assert_eq!(
        printed,
        ["remove_issue not_found no issue with id `AUTH-9`"]
    );
}

/// A wait registered against an id the board does not hold.
#[test]
fn waiting_on_an_issue_that_is_not_there_is_a_not_found() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.wait_for_issue("AUTH-9")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "wait_for_issue",
            ToolFailure::NotFound,
            "no issue with id `AUTH-9`",
        ),
    );
    assert_eq!(
        printed,
        ["wait_for_issue not_found no issue with id `AUTH-9`"]
    );
}

/// And a wait on the issue this session was assigned, which would suspend it on itself forever.
#[test]
fn waiting_on_this_sessions_own_issue_is_an_argument_error() {
    let (printed, _log) = drive(
        r##"
require "gg"
begin
  GG::Board.wait_for_issue("AUTH-1")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
        failing(
            "wait_for_issue",
            ToolFailure::InvalidArgument,
            "`AUTH-1` is the issue this session was assigned",
        ),
    );
    assert_eq!(
        printed,
        ["wait_for_issue invalid_argument `AUTH-1` is the issue this session was assigned"]
    );
}

/// A command that ran and exited non-zero is a VALUE — `exit_code` off the result, outside any
/// `begin` — which is the whole distinction `GG::Shell.run` draws between a failed process and a
/// failed call.
#[test]
fn a_non_zero_exit_is_a_value_rather_than_a_raise() {
    let (printed, log) = driven(
        r##"
require "gg"
out = GG::Shell.run("make fail")
puts "#{out.exit_code} #{out.truncated?}"
"##,
    );
    assert_eq!(printed, ["1 false"]);
    assert_eq!(log.names(), ["shell"]);
}

/// A timeout that is not a duration is refused by the SDK, naming the argument, and the process is
/// never started.
#[test]
fn a_nonsense_shell_timeout_never_reaches_the_wire() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Shell.run("ls", timeout_secs: -1)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        ["shell invalid_argument `timeout_secs` must be a positive number of seconds, got -1"]
    );
}

/// A read of a picture comes back as the other class, narrowed by the ordinary `case` the SDK
/// documents — and the pixels are described rather than handed over.
#[test]
fn an_image_read_narrows_to_the_image_class() {
    let (printed, _log) = driven(
        r##"
require "gg"
read = GG::Files.read_file("logo.png")
case read
when GG::Files::TextFile
  puts "unexpectedly text"
when GG::Files::ImageFile
  puts "#{read.media_type} #{read.label} #{read.bytes} #{read.shown?} #{read.not_shown_reason.inspect}"
end
"##,
    );
    // `shown?` is false and the reason says so: a bare read hands the program the DESCRIPTION, and
    // the membrane rewrites the descriptor to name the call that would actually put the picture in
    // front of the model.
    assert_eq!(
        printed,
        [
            "image/png PNG 1234 false \"`GG::Files.read_file` does not show images; open one with \
             `GG::Views.open_file(path)`\""
        ]
    );
}

/// A negative offset is refused by the SDK rather than wrapping into a `u32` and reading somewhere
/// nobody named.
#[test]
fn a_negative_read_offset_never_reaches_the_wire() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Files.read_file("notes.md", offset: -1)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        ["read_file invalid_argument `offset` must be a whole number 0..4294967295, got -1"]
    );
}

/// A write hands back how many bytes it wrote, as an `Integer` the program can add up.
#[test]
fn a_write_hands_back_the_bytes_it_wrote() {
    let (printed, _log) = driven(
        r##"
require "gg"
written = GG::Files.write_file("out.txt", "hello")
puts "#{written} #{written.is_a?(Integer)}"
"##,
    );
    assert_eq!(printed, ["5 true"]);
}

/// A write with no text at all — neither argument nor block — is the SDK's own refusal, and nothing
/// is created.
#[test]
fn a_write_with_neither_contents_nor_a_block_is_refused() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Files.write_file("out.txt")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        [
            "write_file invalid_argument `write_file` needs the text to write, as an argument or \
             as a block"
        ]
    );
}

/// An empty directory is an empty array rather than a failure, which is what lets a program loop
/// over a listing without rescuing anything.
#[test]
fn an_empty_directory_is_an_empty_array() {
    let (printed, _log) = drive(
        r##"
require "gg"
entries = GG::Files.list_dir("empty")
puts "#{entries.empty?} #{entries.size}"
"##,
        answering("list_dir", ApiData::DirEntries(vec![])),
    );
    assert_eq!(printed, ["true 0"]);
}

/// A listing with no argument at all lists the workspace root, and the omission arrives as a null
/// rather than as an empty string — which the host refuses.
#[test]
fn an_omitted_list_path_lowers_as_null() {
    let (printed, log) = driven(
        r##"
require "gg"
puts GG::Files.list_dir.size
"##,
    );
    assert_eq!(printed, ["3"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

/// A walk hands back its rendering as one `String`, which is what a program prints or cuts up.
#[test]
fn a_tree_hands_back_its_rendering() {
    let (printed, _log) = driven(
        r##"
require "gg"
puts GG::Files.tree(path: "src").split("\n").join(" | ")
"##,
    );
    assert_eq!(printed, ["a.ts | b.test.ts | sub/ |   c.ts"]);
}

/// A depth of zero would render nothing at all, so the SDK refuses it and says what leaving it out
/// does instead.
#[test]
fn a_tree_depth_of_zero_never_reaches_the_wire() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Files.tree(depth: 0)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        [
            "tree invalid_argument `depth` must be at least 1, got 0; leave it out for gg's default of 2"
        ]
    );
}

/// A skill reads back as its body, with nothing wrapped around it.
#[test]
fn a_skill_body_is_read_back_from_ruby() {
    let (printed, _log) = driven(
        r##"
require "gg"
puts GG::Skills.read_skill("testing")
"##,
    );
    assert_eq!(printed, ["the skill body"]);
}

/// Every memory mutation hands back the budget after it, which is what lets a program decide
/// whether it has room for another — starting with the in-context write.
#[test]
fn writing_a_memory_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
usage = GG::Memories.write_memory("layout", "d", "b")
puts "#{usage.count} #{usage.max_count} #{usage.total_chars} #{usage.max_total_chars}"
"##,
    );
    assert_eq!(printed, ["1 8 12 4000"]);
}

/// The two halves a memory may carry beside its prose both lower, under the wire's own names — the
/// crossing row sends them as null, so this is where a written one is checked.
#[test]
fn a_memory_carrying_code_and_an_on_use_note_lowers_both() {
    let (_printed, log) = driven(
        r##"
require "gg"
GG::Memories.write_memory("layout", "d", "b", code: "module Layout\nend", on_use: "puts 1")
"##,
    );
    assert_eq!(
        log.args("write_memory"),
        Some(json!({
            "name": "layout",
            "description": "d",
            "body": "b",
            "code": "module Layout\nend",
            "onUse": "puts 1",
        }))
    );
}

/// The replacement hands back the same budget.
#[test]
fn updating_a_memory_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
usage = GG::Memories.update_memory("layout", "d2", "b2")
puts "#{usage.count} #{usage.max_count} #{usage.total_chars} #{usage.max_total_chars}"
"##,
    );
    assert_eq!(printed, ["1 8 12 4000"]);
}

/// And so does the out-of-context creation.
#[test]
fn creating_a_memory_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
usage = GG::Memories.create_memory("layout", "d", "b")
puts "#{usage.count} #{usage.max_count} #{usage.total_chars} #{usage.max_total_chars}"
"##,
    );
    assert_eq!(printed, ["1 8 12 4000"]);
}

/// A read hands back the contents themselves, which is the one call that brings a memory into the
/// window.
#[test]
fn reading_a_memory_hands_back_its_contents() {
    let (printed, _log) = driven(
        r##"
require "gg"
puts GG::Memories.read_memory("layout")
"##,
    );
    assert_eq!(printed, ["the memory contents"]);
}

/// An in-place revision hands back the budget too.
#[test]
fn editing_a_memory_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
usage = GG::Memories.edit_memory("layout", "old", "new")
puts "#{usage.count} #{usage.max_count} #{usage.total_chars} #{usage.max_total_chars}"
"##,
    );
    assert_eq!(printed, ["1 8 12 4000"]);
}

/// A search hit is a value object with the two ranking numbers on it, so a program can say why one
/// memory came first.
#[test]
fn a_memory_search_hit_is_read_back_from_ruby() {
    let (printed, _log) = driven(
        r##"
require "gg"
hit = GG::Memories.search_memories("cargo", "nextest").first
puts "#{hit.name} #{hit.description} #{hit.matched} #{hit.occurrences} #{hit.excerpt}"
"##,
    );
    assert_eq!(
        printed,
        ["build-commands How to build 2 3 …cargo nextest run --workspace…"]
    );
}

/// And the hit reads its OWN memory: the member spelling arrives under `read_memory` carrying the
/// name the hit already knew, so a program never retypes a slug it was just handed.
#[test]
fn a_memory_hit_reads_its_own_memory() {
    let (printed, log) = driven(
        r##"
require "gg"
puts GG::Memories.search_memories("cargo").first.read
"##,
    );
    assert_eq!(printed, ["the memory contents"]);
    assert_eq!(log.names(), ["search_memories", "read_memory"]);
    assert_eq!(
        log.args("read_memory"),
        Some(json!({ "name": "build-commands" }))
    );
}

/// A search that matched nothing is an empty array rather than a `not-found`.
#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_array() {
    let (printed, _log) = drive(
        r##"
require "gg"
hits = GG::Memories.search_memories("nothing")
puts "#{hits.empty?} #{hits.size}"
"##,
        answering("search_memories", ApiData::MemoryHits(vec![])),
    );
    assert_eq!(printed, ["true 0"]);
}

/// A keyword that is not a String is refused by the SDK, naming the entry, and nothing is searched.
#[test]
fn a_non_string_keyword_never_reaches_the_wire() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Memories.search_memories("cargo", 7)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        ["search_memories invalid_argument every entry of `keywords` must be a string, got 7"]
    );
}

/// An eviction hands back what is still used, which is the point of evicting.
#[test]
fn deleting_a_memory_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
usage = GG::Memories.delete_memory("layout")
puts "#{usage.count} #{usage.max_count} #{usage.total_chars} #{usage.max_total_chars}"
"##,
    );
    assert_eq!(printed, ["1 8 12 4000"]);
}

/// Adding a task hands back the task budget.
#[test]
fn adding_a_task_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
usage = GG::Tasks.add_task("t1", "T")
puts "#{usage.count} #{usage.max_tasks}"
"##,
    );
    assert_eq!(printed, ["2 20"]);
}

/// A blocker that is not a String is refused by the SDK, and no task is filed with a bad edge.
#[test]
fn a_non_string_blocker_never_reaches_the_wire() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Tasks.add_task("t1", "T", blocked_by: ["t0", 7])
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        ["add_task invalid_argument every entry of `blocked_by` must be a string, got 7"]
    );
}

/// And removing one hands back what is left.
#[test]
fn removing_a_task_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
usage = GG::Tasks.remove_task("t1")
puts "#{usage.count} #{usage.max_tasks}"
"##,
    );
    assert_eq!(printed, ["2 20"]);
}

/// A created epic hands back the id its prefix resolved to alongside the board budget — the id is
/// the board's to choose, so reading it back is the only way a program can group anything under it.
#[test]
fn creating_an_epic_hands_back_its_id_and_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
created = GG::Board.create_epic("epc", "E", "D")
board = created.board
puts "#{created.id} #{board.epics} #{board.max_epics} #{board.issues} #{board.max_issues}"
"##,
    );
    assert_eq!(printed, ["EPIC 1 4 3 20"]);
}

/// The same for an issue, whose id is numbered under its epic's prefix.
#[test]
fn creating_an_issue_hands_back_its_id_and_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
created = GG::Board.create_issue("I", "s", "o", "c", "worker")
board = created.board
puts "#{created.id} #{board.epics} #{board.max_epics} #{board.issues} #{board.max_issues}"
"##,
    );
    assert_eq!(printed, ["EPIC-1 1 4 3 20"]);
}

/// A reviewer that is not a String is refused by the SDK, and no issue is filed.
#[test]
fn a_non_string_reviewer_never_reaches_the_wire() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Board.create_issue("I", "s", "o", "c", "worker", reviewers: ["critic", 7])
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        ["create_issue invalid_argument every entry of `reviewers` must be a string, got 7"]
    );
}

/// A status outside the fixed set is refused by the SDK, which names every symbol that WOULD have
/// worked — the whole difference from a branch that silently never runs.
#[test]
fn an_unknown_issue_status_never_reaches_the_wire() {
    let printed = refused(
        r##"
require "gg"
begin
  GG::Board.update_issue("AUTH-1", status: :shipped)
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code} #{failure.message}"
end
"##,
    );
    assert_eq!(
        printed,
        [
            "update_issue invalid_argument `status` must be one of :open, :in_progress, :done, got :shipped"
        ]
    );
}

/// Removing an epic hands back what is still on the board.
#[test]
fn removing_an_epic_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
board = GG::Board.remove_epic("EPIC")
puts "#{board.epics} #{board.max_epics} #{board.issues} #{board.max_issues}"
"##,
    );
    assert_eq!(printed, ["1 4 3 20"]);
}

/// And so does removing an issue.
#[test]
fn removing_an_issue_hands_back_the_budget() {
    let (printed, _log) = driven(
        r##"
require "gg"
board = GG::Board.remove_issue("EPIC-1")
puts "#{board.epics} #{board.max_epics} #{board.issues} #{board.max_issues}"
"##,
    );
    assert_eq!(printed, ["1 4 3 20"]);
}

/// A wait is REGISTERED rather than taken: the acknowledgement comes back and the statement after
/// it runs, which is the half a program could not otherwise tell apart from a block.
#[test]
fn a_registered_wait_lets_the_program_run_on() {
    let (printed, _log) = driven(
        r##"
require "gg"
puts GG::Board.wait_for_issue("EPIC-2")
puts "the program ran on"
"##,
    );
    assert_eq!(printed, ["wait registered", "the program ran on"]);
}

/// And a created issue waits on ITSELF: the member spelling arrives under `wait_for_issue` carrying
/// the id the board assigned, which the program never had to read off anything.
#[test]
fn a_created_issue_waits_on_itself() {
    let (printed, log) = driven(
        r##"
require "gg"
puts GG::Board.create_issue("I", "s", "o", "c", "worker").wait
"##,
    );
    assert_eq!(printed, ["wait registered"]);
    assert_eq!(log.names(), ["create_issue", "wait_for_issue"]);
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );
}

// -------------------------------------------------------------------------------------------------
// The session-side SDK, driven from Ruby programs
//
// One `#[test]` per behaviour, for the reason this file's header gives. Each is one short program:
// a successful call asserted on what the program PRINTED or on the state it left in the OUTCOME,
// an injected failure asserted on what the program RESCUED, and a refusal the SDK made itself
// asserted on the raise plus an empty call log.
//
// The workspace half is above. What follows acts on the SESSION — context, delegation, the program
// library, documentation, views, the endings and the feedback channel — and the difference is only
// what a case can assert on. A workspace call is read back through the exact JSON it composed; most
// of these leave their mark in the outcome instead, because nothing they did was a tool.
// -------------------------------------------------------------------------------------------------

/// One short Ruby program, every operation granted, the ample ceilings, and `responder` answering.
fn sdk_with(
    ruby: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_with(ruby, &all_operations(), &[], responder)
}

/// [`sdk_with`], answered by the canned table — the shape every successful-call case wants.
fn sdk(ruby: &str) -> (SandboxOutcome, CallLog) {
    sdk_with(ruby, canned_outcome)
}

/// [`sdk`] with **one** injected failure: `tool` fails with `failure` and `message`, and every other
/// call is still answered canned, so the program's setup is not collateral damage.
fn sdk_failing(
    ruby: &str,
    tool: &'static str,
    failure: ToolFailure,
    message: &'static str,
) -> (SandboxOutcome, CallLog) {
    sdk_with(ruby, failing(tool, failure, message))
}

/// [`sdk`], granting `operations` **alone** — what a case about a call this run withholds needs, and
/// what a case about a call nothing gates proves by granting nothing at all.
fn sdk_granting(
    ruby: &str,
    operations: &[crate::sandbox::operations::OperationId],
) -> (SandboxOutcome, CallLog) {
    run_with(ruby, operations, &[], canned_outcome)
}

/// [`sdk`] over a double the case **prepared**, with the program library bound when `library` is —
/// see [`evaluate_through`] for why the seam is a builder rather than a parameter.
fn sdk_over(
    ruby: &str,
    library: bool,
    build: impl FnOnce(&CallLog) -> FakeOperationApi,
) -> (SandboxOutcome, CallLog) {
    evaluate_through(
        &prepare(ruby),
        &all_operations(),
        &[],
        RunEnding::None,
        library,
        None,
        build,
    )
}

/// [`sdk`] in `role`'s [ending group](EndingRole) — what every `session` case runs through, since
/// which of the three endings a program may declare is the role's decision and nothing else's.
fn sdk_as(ruby: &str, role: EndingRole) -> (SandboxOutcome, CallLog) {
    run_as(
        ruby,
        &all_operations(),
        &[],
        RunEnding::Role(role),
        false,
        canned_outcome,
    )
}

/// [`sdk_as`] for a run whose **wall-clock budget is already spent** — the one configuration an
/// ending is still serviced under, and the only case that passes `evaluate_through` a deadline.
fn sdk_as_past_the_budget(ruby: &str, role: EndingRole) -> (SandboxOutcome, CallLog) {
    evaluate_through(
        &prepare(ruby),
        &all_operations(),
        &[],
        RunEnding::Role(role),
        false,
        Some(Instant::now()),
        |log| FakeOperationApi::with(log, canned_outcome),
    )
}

/// A program making `call` inside a `begin`, printing the failure's identity and its sentence, and
/// then reaching a line after the `rescue`.
///
/// The trailing `puts` is not decoration: a failure a program *rescued* must leave the program
/// running, and a raise that escaped the clause would take that line with it.
fn caught(call: &str) -> String {
    format!(
        "require \"gg\"\n\
         begin\n  \
           {call}\n\
         rescue GG::Core::ApiError => failure\n  \
           puts \"#{{failure.operation}} #{{failure.code}}\"\n  \
           puts failure.message\n\
         end\n\
         puts \"after\"\n"
    )
}

/// What a [`caught`] program must have printed: the failure's `operation` and its `code` — a Ruby
/// Symbol, so `invalid_argument` rather than the wire's `invalid-argument` — then gg's own sentence,
/// then the line that proves the program carried on.
fn assert_caught(outcome: &SandboxOutcome, operation: &str, code: &str, message: &str) {
    let identity = format!("{operation} {code}");
    assert_eq!(logs(outcome), [identity.as_str(), message, "after"]);
}

/// [`caught`] for a refusal whose **sentence** is asserted where the sentence is written: the
/// program prints the failure's identity alone, and then a line proving it carried on.
fn caught_code(call: &str) -> String {
    format!(
        "require \"gg\"\n\
         begin\n  \
           {call}\n\
         rescue GG::Core::ApiError => failure\n  \
           puts \"#{{failure.operation}} #{{failure.code}}\"\n\
         end\n\
         puts \"after\"\n"
    )
}

/// What a [`caught_code`] program must have printed: the failure's `operation` and `code`, and the
/// line that proves the program carried on.
fn assert_caught_code(outcome: &SandboxOutcome, operation: &str, code: &str) {
    let identity = format!("{operation} {code}");
    assert_eq!(logs(outcome), [identity.as_str(), "after"]);
}

/// [`assert_caught`] for a refusal the SDK raised on the **guest** side: the same three lines, plus
/// the empty call log that tells this apart from the same class raised by the host.
fn assert_refused_before_the_host(
    outcome: &SandboxOutcome,
    log: &CallLog,
    operation: &str,
    message: &str,
) {
    assert_caught(outcome, operation, "invalid_argument", message);
    assert!(
        log.calls().is_empty(),
        "a refusal the SDK raises never reaches the wire: {:?}",
        log.calls()
    );
}

/// The selectors a program's views were opened under, in call order — the state an opening call
/// left, read the way the turn's feedback reads it.
fn opened(outcome: &SandboxOutcome) -> Vec<&str> {
    outcome
        .views_opened
        .iter()
        .map(|view| view.selector.as_str())
        .collect()
}

/// The [operation ids](crate::sandbox::operations::OperationId) of the calls that reached the loop,
/// in call order — what an `exec` or a transition leaves on the outcome, neither of them being a
/// thing a program can read back for itself.
fn serviced(outcome: &SandboxOutcome) -> Vec<&str> {
    outcome
        .tool_calls
        .iter()
        .map(|call| call.name.as_str())
        .collect()
}

// -------------------------------------------------------------------------------------------------
// context
//
// The three reclaims and the compaction, each driven for what it hands a program back and for every
// distinct way it is refused. The successful *crossings* are the table above's; what is here is the
// state each call left and what a program reads when one fails.
// -------------------------------------------------------------------------------------------------

/// An eviction's whole report reaches the program: what went, what that freed, whose views, and the
/// sentence gg wrote about it.
#[test]
fn an_eviction_hands_back_what_it_reclaimed() {
    let (outcome, _log) = sdk(r##"
require "gg"
report = GG::Context.evict_file_view("src/a.rb")
puts "#{report.items} #{report.reclaimed_tokens} #{report.paths.inspect} #{report.detail}"
"##);
    assert_eq!(logs(&outcome), [r#"2 300 ["src/a.ts"] dropped 2 items"#]);
}

/// The default drops **every** file view, which has to reach the host as an absent path rather than
/// as an empty one — the empty one is a different call, and a refusal.
#[test]
fn an_eviction_with_no_path_sends_no_path() {
    let (outcome, log) = sdk("require \"gg\"\nputs GG::Context.evict_file_view.items\n");
    assert_eq!(logs(&outcome), ["2"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

/// A path that names nothing is not a path that names everything: leaving it out is how a program
/// says *all of them*, so an empty string is a typo rather than a spelling of it.
#[test]
fn an_eviction_of_an_empty_path_is_an_argument_error() {
    let message = "`path` was given but empty; leave it out to drop every file view";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Context.evict_file_view("")"#),
        "evict_file_view",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "evict_file_view", "invalid_argument", message);
}

/// A span is a Ruby `Range`, and both spellings of one name the same turns: `4...20` is `4..19`, so
/// the report a program reads back is the same report.
#[test]
fn an_inclusive_and_an_exclusive_range_archive_the_same_span() {
    let (outcome, log) = sdk(r##"
require "gg"
[4..19, 4...20].each do |span|
  report = GG::Context.archive_thread(span)
  puts "#{report.items} #{report.reclaimed_tokens} #{report.paths.inspect} #{report.detail}"
end
"##);
    assert_eq!(
        logs(&outcome),
        [
            r#"2 300 ["src/a.ts"] dropped 2 items"#,
            r#"2 300 ["src/a.ts"] dropped 2 items"#
        ]
    );
    let spans: Vec<Value> = log
        .calls()
        .into_iter()
        .map(|call| call.args["ranges"].clone())
        .collect();
    assert_eq!(spans, [json!([[4, 19]]), json!([[4, 19]])]);
}

#[test]
fn an_archive_of_an_empty_list_is_an_argument_error() {
    let message = "`archive_thread`: name between 1 and 32 inclusive turn ranges to archive";
    let (outcome, _log) = sdk_failing(
        &caught("GG::Context.archive_thread"),
        "archive_thread",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "archive_thread", "invalid_argument", message);
}

#[test]
fn an_archive_of_more_than_thirty_two_spans_is_an_argument_error() {
    let message = "`archive_thread`: name between 1 and 32 inclusive turn ranges to archive";
    let (outcome, _log) = sdk_failing(
        &caught("GG::Context.archive_thread((0..32).map { |turn| turn..turn })"),
        "archive_thread",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "archive_thread", "invalid_argument", message);
}

/// `19..4` is a `Range` of whole numbers and lowers without complaint, so the span that ends before
/// it starts is the host's to refuse — and it names the pair rather than the argument.
#[test]
fn an_archive_of_a_span_that_ends_before_it_starts_is_an_argument_error() {
    let message = "`archive_thread`: the range [19, 4] ends before it starts";
    let (outcome, _log) = sdk_failing(
        &caught("GG::Context.archive_thread(19..4)"),
        "archive_thread",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "archive_thread", "invalid_argument", message);
}

/// An Array that looks like a span is the mistake that actually happens, and it is refused by name
/// on the guest side: a pair lowered as two turn numbers would archive turns nobody named.
#[test]
fn an_archive_of_something_that_is_not_a_range_is_refused_before_the_host() {
    let (outcome, log) = sdk(&caught("GG::Context.archive_thread([[4, 19]])"));
    assert_refused_before_the_host(
        &outcome,
        &log,
        "archive_thread",
        "every entry of `ranges` must be a Range of turn numbers (`4..19`), got 4",
    );
}

/// A hit is read field by field, and `archive_empty?` is false because the search really ran.
#[test]
fn an_archive_search_reads_its_hits_back_field_by_field() {
    let (outcome, _log) = sdk(r##"
require "gg"
found = GG::Context.search_archive("the parser")
hit = found.hits.first
puts "#{found.archive_empty?} #{found.hits.size} #{hit.seq} #{hit.role} #{hit.text}"
"##);
    assert_eq!(logs(&outcome), ["false 1 3 assistant the earlier answer"]);
}

/// A search that ran and matched nothing still reports a **non-empty** archive, which is the whole
/// of the difference a model has to be able to read.
#[test]
fn an_archive_search_that_matched_nothing_reports_a_non_empty_archive() {
    let (printed, _log) = drive(
        r##"
require "gg"
found = GG::Context.search_archive("the parser")
puts "#{found.archive_empty?} #{found.hits.inspect}"
"##,
        answering(
            "search_archive",
            ApiData::ArchiveSearch(crate::tools::ArchiveSearchData {
                archive_empty: false,
                hits: Vec::new(),
            }),
        ),
    );
    assert_eq!(printed, ["false []"]);
}

/// Nothing archived yet is a **different answer** from a search that ran and matched nothing, and
/// the flag is what carries the difference.
#[test]
fn a_search_of_an_empty_archive_says_so() {
    let (printed, _log) = drive(
        r##"
require "gg"
found = GG::Context.search_archive("the parser")
puts "#{found.archive_empty?} #{found.hits.inspect}"
"##,
        answering(
            "search_archive",
            ApiData::ArchiveSearch(crate::tools::ArchiveSearchData {
                archive_empty: true,
                hits: Vec::new(),
            }),
        ),
    );
    assert_eq!(printed, ["true []"]);
}

#[test]
fn an_archive_search_of_an_empty_query_is_an_argument_error() {
    let message = "`search_archive`: `query` must not be empty";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Context.search_archive("")"#),
        "search_archive",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "search_archive", "invalid_argument", message);
}

/// A compaction is **registered**, not performed: the call hands back `nil` and the program runs on
/// to its end, which is the whole difference between it and a window rewritten underneath a running
/// turn.
#[test]
fn a_compaction_is_registered_and_the_program_carries_on() {
    let (outcome, _log) = sdk(r##"
require "gg"
puts GG::Context.compact("scaffolded the page").inspect
puts "after"
"##);
    assert_eq!(logs(&outcome), ["nil", "after"]);
}

#[test]
fn a_compaction_of_a_blank_summary_is_an_argument_error() {
    let message = "`compact`: `summary` must be a non-empty string";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Context.compact("   ")"#),
        "compact",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "compact", "invalid_argument", message);
}

// -------------------------------------------------------------------------------------------------
// delegation
//
// The six calls that hand work to another agent — three about children, two about this session's
// own succession, and the fork that is both.
// -------------------------------------------------------------------------------------------------

/// The handle is what a parent names its child by afterwards, so all three of its fields have to
/// reach the program rather than only the id.
#[test]
fn a_spawned_child_hands_back_the_handle_its_parent_names_it_by() {
    let (outcome, _log) = sdk(r##"
require "gg"
child = GG::Delegation.spawn_subagent("worker", prompt: "write the lexer")
puts "#{child.id} #{child.slot} #{child.model_id}"
"##);
    assert_eq!(logs(&outcome), ["agent-1 primary test/model"]);
}

/// The other half of the brief: an issue id crosses as `issueId` with no prompt beside it, which is
/// the choice the SDK refuses to let a program make twice.
#[test]
fn a_subagent_briefed_from_an_issue_crosses_carrying_the_issue() {
    let (outcome, log) = sdk(
        "require \"gg\"\nputs GG::Delegation.spawn_subagent(\"worker\", issue_id: \"AUTH-1\").id\n",
    );
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "worker", "prompt": null, "issueId": "AUTH-1" }))
    );
}

/// Neither is the mistake that actually happens — the membrane's own schema declares both fields
/// optional — so the SDK refuses it here, naming both ways out.
#[test]
fn a_brief_that_is_neither_a_prompt_nor_an_issue_is_refused_before_the_host() {
    let (outcome, log) = sdk(&caught(r#"GG::Delegation.spawn_subagent("worker")"#));
    assert_refused_before_the_host(
        &outcome,
        &log,
        "spawn_subagent",
        "expected exactly one of `prompt` or `issue_id`",
    );
}

/// And both, which is the same refusal in the same words: a child briefed twice would run on
/// whichever of them the host happened to read first.
#[test]
fn a_brief_that_is_both_a_prompt_and_an_issue_is_refused_before_the_host() {
    let (outcome, log) = sdk(&caught(
        r#"GG::Delegation.spawn_subagent("worker", prompt: "write the lexer", issue_id: "AUTH-1")"#,
    ));
    assert_refused_before_the_host(
        &outcome,
        &log,
        "spawn_subagent",
        "expected exactly one of `prompt` or `issue_id`",
    );
}

#[test]
fn a_spawn_at_the_delegation_depth_cap_is_limit_exceeded() {
    let message = "the delegation depth cap is 2, and this session is already at it";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.spawn_subagent("worker", prompt: "write the lexer")"#),
        "spawn_subagent",
        ToolFailure::LimitExceeded,
        message,
    );
    assert_caught(&outcome, "spawn_subagent", "limit_exceeded", message);
}

#[test]
fn a_spawn_of_an_agent_this_session_may_not_spawn_is_an_argument_error() {
    let message = "`archivist` is not an agent this session may spawn";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.spawn_subagent("archivist", prompt: "tidy up")"#),
        "spawn_subagent",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "spawn_subagent", "invalid_argument", message);
}

/// A collected result is read whole — the id it is filed under, how its loop ended, and the sentence
/// it left behind.
#[test]
fn named_children_are_waited_for_and_read_back_whole() {
    let (outcome, log) = sdk(r##"
require "gg"
GG::Delegation.wait_for_subagents("agent-1").each do |result|
  puts "#{result.id} #{result.status} #{result.summary}"
end
"##);
    assert_eq!(logs(&outcome), ["agent-1 completed did the work"]);
    assert_eq!(
        log.args("wait_for_subagents"),
        Some(json!({ "ids": ["agent-1"] }))
    );
}

/// The no-argument form waits for **every** outstanding child, which reaches the host as an absent
/// id list rather than as an empty one: an empty list is a wait on nothing at all.
#[test]
fn every_child_is_waited_for_when_none_is_named() {
    let (outcome, log) =
        sdk("require \"gg\"\nputs GG::Delegation.wait_for_subagents.map(&:id).join(\",\")\n");
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(log.args("wait_for_subagents"), Some(json!({ "ids": null })));
}

/// A child that produced no return value at all has **no status**, which is `nil` rather than an
/// arm a program would have to invent a meaning for.
#[test]
fn a_child_that_ended_with_no_verdict_reads_back_without_one() {
    let (printed, _log) = drive(
        r##"
require "gg"
result = GG::Delegation.wait_for_subagents.first
puts "#{result.id} #{result.status.inspect} #{result.summary}"
"##,
        answering(
            "wait_for_subagents",
            ApiData::SubagentResults(vec![crate::tools::SubagentResultData {
                id: "agent-1".to_string(),
                status: None,
                summary: "still working".to_string(),
            }]),
        ),
    );
    assert_eq!(printed, ["agent-1 nil still working"]);
}

/// Every way a child's loop can end lowers onto **its own** Symbol, and onto the constant a program
/// compares against: a status collapsed onto its neighbour would send a spawner looking for a
/// failure that did not happen.
#[test]
fn every_agent_ending_lowers_onto_the_symbol_a_program_compares_against() {
    let statuses = [
        crate::tools::AgentStatusData::Completed,
        crate::tools::AgentStatusData::Exhausted,
        crate::tools::AgentStatusData::TimedOut,
        crate::tools::AgentStatusData::ModelError,
        crate::tools::AgentStatusData::AuthError,
        crate::tools::AgentStatusData::LimitExceeded,
    ];
    let (printed, _log) = drive(
        r##"
require "gg"
expected = [GG::Delegation::AgentEnding::COMPLETED, GG::Delegation::AgentEnding::EXHAUSTED,
            GG::Delegation::AgentEnding::TIMED_OUT, GG::Delegation::AgentEnding::MODEL_ERROR,
            GG::Delegation::AgentEnding::AUTH_ERROR, GG::Delegation::AgentEnding::LIMIT_EXCEEDED]
collected = GG::Delegation.wait_for_subagents.map(&:status)
puts (collected == expected).to_s
puts collected.map(&:to_s).join(" ")
"##,
        answering(
            "wait_for_subagents",
            ApiData::SubagentResults(
                statuses
                    .into_iter()
                    .enumerate()
                    .map(|(index, status)| crate::tools::SubagentResultData {
                        id: format!("agent-{index}"),
                        status: Some(status),
                        summary: "done".to_string(),
                    })
                    .collect(),
            ),
        ),
    );
    assert_eq!(
        printed,
        [
            "true",
            "completed exhausted timed_out model_error auth_error limit_exceeded"
        ]
    );
}

#[test]
fn a_wait_on_an_unknown_id_is_not_found() {
    let message = "no child agent `agent-9` was spawned by this session";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.wait_for_subagents("agent-9")"#),
        "wait_for_subagents",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "wait_for_subagents", "not_found", message);
}

/// A delivery is an effect rather than a value: the call hands back `nil`, and what is worth
/// asserting is the pair of arguments that crossed.
#[test]
fn a_message_is_delivered_and_hands_the_program_nothing_back() {
    let (outcome, log) = sdk(
        "require \"gg\"\nputs GG::Delegation.send_message(\"agent-1\", \"prefer the simpler parser\").inspect\n",
    );
    assert_eq!(logs(&outcome), ["nil"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

/// The handle carries the id, so the second spelling of the same call takes only the message — and
/// it has to reach the wire as the same `send_message`, addressed to the child it was taken from.
#[test]
fn a_handle_delivers_its_own_message() {
    let (outcome, log) = sdk(r##"
require "gg"
child = GG::Delegation.spawn_subagent("worker", prompt: "write the lexer")
child.send_message("prefer the simpler parser")
"##);
    assert!(logs(&outcome).is_empty());
    assert_eq!(log.names(), ["spawn_subagent", "send_message"]);
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );
}

#[test]
fn a_message_to_an_unknown_agent_is_not_found() {
    let message = "no agent `agent-9` in this session";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.send_message("agent-9", "prefer the simpler parser")"#),
        "send_message",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "send_message", "not_found", message);
}

#[test]
fn a_message_to_a_child_that_already_returned_is_a_conflict() {
    let message = "`agent-1` has already returned; there is no turn left to read an inbox";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.send_message("agent-1", "prefer the simpler parser")"#),
        "send_message",
        ToolFailure::Conflict,
        message,
    );
    assert_caught(&outcome, "send_message", "conflict", message);
}

/// Registered rather than performed: the call validates the target, hands back `nil`, and the lines
/// after it still run.
#[test]
fn a_state_transition_is_declared_and_the_program_carries_on() {
    let (outcome, _log) = sdk(r##"
require "gg"
puts GG::Delegation.transition_state("verify").inspect
puts "after"
"##);
    assert_eq!(logs(&outcome), ["nil", "after"]);
    assert_eq!(serviced(&outcome), ["delegation.transition_state"]);
}

#[test]
fn a_transition_to_a_state_this_session_may_not_move_to_is_an_argument_error() {
    let message = "`archive` is not a state this session may move on to";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.transition_state("archive")"#),
        "transition_state",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "transition_state", "invalid_argument", message);
}

/// The two successions share **one** slot, so an `exec` after a transition is the second declaration
/// in the turn — refused rather than silently dropped, with the transition left standing.
#[test]
fn a_transition_then_an_exec_in_one_program_is_refused() {
    let (outcome, log) = sdk_with(
        r##"
require "gg"
GG::Delegation.transition_state("verify")
begin
  GG::Delegation.exec("Builder")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code}"
end
puts "after"
"##,
        failing(
            "exec",
            ToolFailure::Refused,
            "this turn already declared a succession",
        ),
    );
    assert_eq!(logs(&outcome), ["exec refused", "after"]);
    assert_eq!(log.names(), ["transition_state", "exec"]);
}

/// The one operation no capability can switch on: an agent standing in no machine state does not
/// hold it, so the allowlist that omits the [`Binding::Machine`](crate::sandbox::Binding) row is
/// exactly the configuration a run really has.
#[test]
fn a_transition_from_outside_a_state_machine_is_unavailable() {
    let (outcome, _log) = sdk_granting(
        &caught(r#"GG::Delegation.transition_state("verify")"#),
        &crate::sandbox::capability_operations(crate::sandbox::operations::gating_capabilities()),
    );
    assert_caught(
        &outcome,
        "transition_state",
        "unavailable",
        "`GG::Delegation.transition_state` is not available.",
    );
}

/// An `exec` is the same registered succession a transition is, declared by the model rather than by
/// a machine: it returns, the program runs to its end, and the succession is on the outcome.
#[test]
fn an_exec_is_declared_and_the_program_runs_to_its_end() {
    let (outcome, _log) = sdk(r##"
require "gg"
puts GG::Delegation.exec("Builder", "pick it up from here").inspect
puts "after"
"##);
    assert_eq!(logs(&outcome), ["nil", "after"]);
    assert_eq!(serviced(&outcome), ["delegation.exec"]);
}

#[test]
fn an_exec_of_an_agent_this_session_may_not_become_is_an_argument_error() {
    let message = "`Archivist` is not an agent this session may become";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.exec("Archivist")"#),
        "exec",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "exec", "invalid_argument", message);
}

/// And the other way round, because the slot is one slot whichever call filled it first.
#[test]
fn an_exec_then_a_transition_in_one_program_is_refused() {
    let (outcome, log) = sdk_with(
        r##"
require "gg"
GG::Delegation.exec("Builder")
begin
  GG::Delegation.transition_state("verify")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code}"
end
puts "after"
"##,
        failing(
            "transition_state",
            ToolFailure::Refused,
            "this turn already declared a succession",
        ),
    );
    assert_eq!(logs(&outcome), ["transition_state refused", "after"]);
    assert_eq!(log.names(), ["exec", "transition_state"]);
}

/// A fork's dispatch waits for the end of the turn, but its **handle** does not: the id is minted at
/// the call, which is what lets a later turn collect the copy by name.
#[test]
fn a_fork_hands_back_a_handle_the_program_can_name() {
    let (outcome, _log) = sdk(r##"
require "gg"
copy = GG::Delegation.fork("try the other fix")
puts "#{copy.id} #{copy.slot} #{copy.model_id}"
"##);
    assert_eq!(logs(&outcome), ["agent-2 primary test/model"]);
}

/// And waiting on it in the program that made it never returns it: the copy is dispatched once this
/// turn's results are recorded, so within the turn it is an id nothing spawned.
#[test]
fn the_forked_id_is_not_found_by_a_wait_in_the_same_program() {
    let message = "no child agent `agent-2` was spawned by this session";
    let (outcome, _log) = sdk_failing(
        &caught(
            r#"GG::Delegation.wait_for_subagents(GG::Delegation.fork("try the other fix").id)"#,
        ),
        "wait_for_subagents",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "wait_for_subagents", "not_found", message);
}

#[test]
fn a_fork_at_the_delegation_depth_cap_is_limit_exceeded() {
    let message = "the delegation depth cap is 2, and this session is already at it";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Delegation.fork("try the other fix")"#),
        "fork",
        ToolFailure::LimitExceeded,
        message,
    );
    assert_caught(&outcome, "fork", "limit_exceeded", message);
}

// -------------------------------------------------------------------------------------------------
// programs
//
// The library a run buys separately: the history of what this session already ran, the source of one
// of them, and the hand-over that runs a patched copy in this program's place. Reading a summary
// back, fetching a source by id, `ProgramSummary#source` as the second spelling of that fetch and
// the miss for an id the library was never issued are driven by the module walk above.
// -------------------------------------------------------------------------------------------------

/// A library with nothing in it is an **empty Array**, which is the honest answer on the first turn
/// of every session — and a different fact from having no library at all.
#[test]
fn a_history_before_the_first_program_is_an_empty_list() {
    let (outcome, _log) = sdk_over(
        "require \"gg\"\nputs GG::Programs.history.inspect\n",
        true,
        |log| FakeOperationApi::with(log, canned_outcome),
    );
    assert_eq!(logs(&outcome), ["[]"]);
}

/// This arm's SDK is static, so the whole module is still there for a run that keeps no library:
/// what it gets is the host's refusal naming the call it wrote.
#[test]
fn a_history_is_unavailable_to_a_run_that_keeps_no_library() {
    let (outcome, _log) = sdk_granting(
        &caught("GG::Programs.history"),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
    );
    assert_caught(
        &outcome,
        "history",
        "unavailable",
        "`GG::Programs.history` is not available.",
    );
}

#[test]
fn a_get_is_unavailable_to_a_run_that_keeps_no_library() {
    let (outcome, _log) = sdk_granting(
        &caught(r#"GG::Programs.get("p3")"#),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
    );
    assert_caught(
        &outcome,
        "get",
        "unavailable",
        "`GG::Programs.get` is not available.",
    );
}

#[test]
fn a_rerun_is_unavailable_to_a_run_that_keeps_no_library() {
    let (outcome, _log) = sdk_granting(
        &caught(r#"GG::Programs.rerun("puts 1")"#),
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
    );
    assert_caught(
        &outcome,
        "rerun",
        "unavailable",
        "`GG::Programs.rerun` is not available.",
    );
}

/// An id the library really issued and has since let go is `:not_found`, exactly as one it never
/// issued is: the retention is what the two have in common, and a program cannot tell them apart.
#[test]
fn a_get_of_an_id_the_library_has_dropped_is_not_found() {
    let (outcome, _log) = sdk_over(&caught_code(r#"GG::Programs.get("p1")"#), true, |log| {
        FakeOperationApi::with(log, canned_outcome)
            .keeping(1)
            .with_program("p1", 1, "puts 'the first program'")
            .with_program("p2", 2, "puts 'the second program'")
    });
    assert_caught_code(&outcome, "get", "not_found");
}

/// A blank source is a compiler handed nothing, which is a failure one stage later and in words
/// about Ruby rather than about the call that was made.
#[test]
fn a_rerun_of_a_blank_source_is_an_argument_error() {
    let (outcome, _log) = sdk_over(&caught(r#"GG::Programs.rerun("   ")"#), true, |log| {
        FakeOperationApi::with(log, canned_outcome)
    });
    assert_caught(
        &outcome,
        "rerun",
        "invalid_argument",
        "`source` must not be blank",
    );
}

/// The **first** hand-over is the one that stands: a silently replaced program is a change the model
/// cannot see, so the second is refused and the first is what gg is handed.
#[test]
fn a_second_hand_over_is_refused_and_the_first_stands() {
    let (outcome, _log) = sdk_over(
        r##"
require "gg"
GG::Programs.rerun("puts 'the first'")
begin
  GG::Programs.rerun("puts 'the second'")
rescue GG::Core::ApiError => failure
  puts "#{failure.operation} #{failure.code}"
end
"##,
        true,
        |log| FakeOperationApi::with(log, canned_outcome),
    );
    assert_eq!(logs(&outcome), ["rerun refused"]);
    assert_eq!(outcome.rerun.as_deref(), Some("puts 'the first'"));
}

/// A hand-over rests on checks the program never finished running, so a program that then raises
/// loses it — and the turn's feedback says the replacement was not run rather than leaving the model
/// waiting for a program that never ran.
#[test]
fn a_program_that_hands_over_and_then_raises_has_the_hand_over_revoked() {
    let (outcome, _log) = sdk_over(
        r##"
require "gg"
GG::Programs.rerun("puts 'the replacement'")
raise ArgumentError, "boom"
"##,
        true,
        |log| FakeOperationApi::with(log, canned_outcome),
    );
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::Other);
    assert!(
        outcome.rerun.is_none() && outcome.revoked_rerun,
        "the hand-over was revoked: {:?}",
        outcome.rerun
    );
}

/// A refusal over the call's own **argument** is not a call this run withheld, so it leaves the
/// refusal roster empty — the roster answers "what did the model reach for that it does not have",
/// which is a different question and the one a comparison of two configurations counts.
#[test]
fn a_hand_over_refused_over_its_argument_leaves_the_refusal_roster_empty() {
    let (outcome, _log) = sdk_over(&caught_code(r#"GG::Programs.rerun("")"#), true, |log| {
        FakeOperationApi::with(log, canned_outcome)
    });
    assert_caught_code(&outcome, "rerun", "invalid_argument");
    assert!(
        outcome.refusals.is_empty(),
        "nothing was withheld: {:?}",
        outcome.refusals
    );
}

// -------------------------------------------------------------------------------------------------
// docs
//
// The only way a program finds anything: searching is bound to every program whatever a run enables,
// and taking a documentation view back out of the window is bought by a capability.
// -------------------------------------------------------------------------------------------------

/// Searching is [`Binding::Always`](crate::sandbox::Binding), which means it answers a program that
/// was granted **nothing at all** — the one route to the surface a run that enables no tool has.
#[test]
fn a_search_answers_a_program_granted_nothing_at_all() {
    let (outcome, _log) = sdk_granting(
        "require \"gg\"\nputs GG::Docs.search(query: \"read\").total\n",
        &[],
    );
    assert_eq!(logs(&outcome), ["0"]);
}

/// *You gave me nothing to look for* and *nothing here matches* are different answers, and a model
/// that could not tell them apart would rewrite a query that was never the problem.
#[test]
fn a_search_with_neither_a_query_nor_a_filter_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught("GG::Docs.search"));
    assert_caught(
        &outcome,
        "search",
        "invalid_argument",
        "a search needs something to look for: a query, or a `modules`, `type` or `kind` filter",
    );
}

/// The Symbol is a typed choice rather than a free string, and the SDK is where that is enforced —
/// `:functions` is a value Ruby will happily construct, so the refusal names every arm that would
/// have worked.
#[test]
fn a_search_with_an_unrecognised_kind_is_refused_naming_the_accepted_set() {
    let (outcome, log) = sdk(&caught(
        r#"GG::Docs.search(query: "read", kind: :functions)"#,
    ));
    assert_refused_before_the_host(
        &outcome,
        &log,
        "search",
        "`kind` must be one of :module, :function, :type, got :functions",
    );
}

/// A page of zero hits is a call that can never return anything, and reading it as *the default*
/// would be gg deciding what the model meant.
#[test]
fn a_search_with_a_limit_of_zero_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught(r#"GG::Docs.search(query: "read", limit: 0)"#));
    assert_caught(
        &outcome,
        "search",
        "invalid_argument",
        "a page of zero hits would answer nothing; leave `limit` out for the default",
    );
}

/// A key that is open is closed once and then gone: the second close of the same key has nothing to
/// take out of the window and says so rather than failing.
#[test]
fn a_key_that_is_open_is_closed_and_is_then_gone() {
    let (outcome, _log) = sdk(r##"
require "gg"
GG::Views.open_docs_view("GG::Files.read_file")
puts "#{GG::Docs.close("GG::Files.read_file")} #{GG::Docs.close("GG::Files.read_file")}"
"##);
    assert_eq!(logs(&outcome), ["1 0"]);
}

/// The single-key close is bought by the same capability the blanket one is, and a run that did not
/// enable it is told so rather than told the call does not exist.
#[test]
fn a_documentation_close_is_unavailable_without_the_capability() {
    let (outcome, _log) = sdk_granting(
        &caught(r#"GG::Docs.close("GG::Files.read_file")"#),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
    );
    assert_caught(
        &outcome,
        "close",
        "unavailable",
        "`GG::Docs.close` is not available.",
    );
}

// -------------------------------------------------------------------------------------------------
// views
//
// The only channel material has into the context window, which is what makes a silently refused one
// the most expensive failure on this surface: the model would read the silence as a program that
// never ran.
// -------------------------------------------------------------------------------------------------

/// The read is what fails, and nothing is opened when it does — there is no half-open state to
/// report.
#[test]
fn an_open_of_a_missing_path_is_not_found_and_opens_no_view() {
    let message = "no such file `missing.md`";
    let (outcome, _log) = sdk_failing(
        &caught(r#"GG::Views.open_file("missing.md")"#),
        "read_file",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "open_file", "not_found", message);
    assert!(opened(&outcome).is_empty(), "nothing was opened");
}

/// A window over the byte cap is refused **naming the size and the bound**, and never truncated
/// behind the model's back — with the two ways out of it in the same sentence.
#[test]
fn an_open_whose_window_is_over_the_byte_cap_is_limit_exceeded() {
    let (outcome, _log) = sdk_with(
        &caught(r#"GG::Views.open_file("huge.md")"#),
        |name, args| {
            if name == "read_file" {
                let body = "x".repeat(70_000);
                ToolOutcome::ok(body.clone(), "read 1 line").with_data(ApiData::FileText(
                    crate::tools::FileTextData {
                        contents: body,
                        first_line: 1,
                        last_line: 1,
                        total_lines: 1,
                        byte_truncated: false,
                    },
                ))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_caught(
        &outcome,
        "open_file",
        "limit_exceeded",
        "view body exceeds max size (70000 bytes; max 65536); open fewer lines with \
         `offset`/`limit`, or cut long lines with `maxLineChars`",
    );
    assert!(opened(&outcome).is_empty(), "nothing was opened");
}

/// Zero would cut every line to its annotation alone, so it is an argument error rather than a
/// setting — stated with the range, so the program can pick a number that means something.
#[test]
fn an_open_with_a_line_cut_of_zero_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught(
        r#"GG::Views.open_file("notes.md", max_line_chars: 0)"#,
    ));
    assert_caught(
        &outcome,
        "open_file",
        "invalid_argument",
        "`maxLineChars` must be between 1 and 65536 (0 given); omit it to leave lines whole",
    );
}

#[test]
fn an_open_with_a_line_cut_over_the_bound_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught(
        r#"GG::Views.open_file("notes.md", max_line_chars: 65537)"#,
    ));
    assert_caught(
        &outcome,
        "open_file",
        "invalid_argument",
        "`maxLineChars` must be between 1 and 65536 (65537 given); omit it to leave lines whole",
    );
}

/// The view's read is bought by the same capability a bare read is, so a run that withholds it
/// withholds both.
#[test]
fn an_open_is_unavailable_when_the_run_withholds_reading_files() {
    let (outcome, _log) = sdk_granting(
        &caught(r#"GG::Views.open_file("notes.md")"#),
        &all_operations_without(CAPABILITY_READ_FILE),
    );
    assert_caught(
        &outcome,
        "open_file",
        "unavailable",
        "`GG::Views.open_file` is not available.",
    );
}

/// One label is one view: re-opening it **supersedes** what it showed rather than adding a second,
/// which is the accounting a program that redraws in a loop has to be able to read correctly.
#[test]
fn re_opening_one_label_supersedes_the_view() {
    let (outcome, _log) = sdk(r##"
require "gg"
GG::Views.open_text("summary", "eight files")
GG::Views.open_text("summary", "eight files, two failing")
"##);
    let views: Vec<(&str, bool)> = outcome
        .views_opened
        .iter()
        .map(|view| (view.selector.as_str(), view.superseded))
        .collect();
    assert_eq!(views, [("summary", false), ("summary", true)]);
}

/// A view with no selector could never be closed, so a blank label is refused and nothing is opened.
#[test]
fn a_text_view_with_a_blank_label_is_an_argument_error_and_opens_nothing() {
    let (outcome, _log) = sdk(&caught(r#"GG::Views.open_text("   ", "eight files")"#));
    assert_caught(
        &outcome,
        "open_text",
        "invalid_argument",
        "a view needs a non-empty label",
    );
    assert!(opened(&outcome).is_empty(), "nothing was opened");
}

/// The body may be an argument or a block, and neither is the SDK's own refusal: `nil` is a body a
/// program could mean, so the absence has to be caught here rather than shown as an empty view.
#[test]
fn a_text_view_with_neither_a_body_nor_a_block_is_refused_before_the_host() {
    let (outcome, _log) = sdk(&caught(r#"GG::Views.open_text("summary")"#));
    assert_caught(
        &outcome,
        "open_text",
        "invalid_argument",
        "`open_text` needs the body to show, as an argument or as a block",
    );
    assert!(opened(&outcome).is_empty(), "nothing was opened");
}

#[test]
fn a_text_view_with_a_body_over_the_ceiling_is_limit_exceeded() {
    let (outcome, _log) = sdk(&caught(r#"GG::Views.open_text("summary", "x" * 70000)"#));
    assert_caught(
        &outcome,
        "open_text",
        "limit_exceeded",
        "view body exceeds max size (70000 bytes; max 65536)",
    );
}

/// The label has a cap of its own, an order of magnitude below the body's: a selector is a handle
/// rather than a place to put material.
#[test]
fn a_text_view_with_a_label_over_the_ceiling_is_limit_exceeded() {
    let (outcome, _log) = sdk(&caught(r#"GG::Views.open_text("L" * 201, "eight files")"#));
    assert_caught(
        &outcome,
        "open_text",
        "limit_exceeded",
        "label exceeds max length (201 bytes; max 200)",
    );
}

#[test]
fn a_documentation_lookup_of_an_unknown_name_is_not_found() {
    let (outcome, _log) = sdk_over(
        &caught(r#"GG::Views.open_docs_view("read_fille")"#),
        false,
        |log| FakeOperationApi::with(log, canned_outcome).cataloguing(&[("read_file", true)]),
    );
    assert_caught(
        &outcome,
        "open_docs_view",
        "not_found",
        "no documentation for `read_fille`",
    );
}

/// A name the catalogue holds and this agent does not bind is `:not_found` too, and says so: telling
/// a model that a call exists which it may not make is worse than telling it nothing.
#[test]
fn a_documentation_lookup_of_a_name_this_agent_does_not_bind_is_not_found() {
    let (outcome, _log) = sdk_over(
        &caught(r#"GG::Views.open_docs_view("fork")"#),
        false,
        |log| {
            FakeOperationApi::with(log, canned_outcome)
                .cataloguing(&[("read_file", true), ("fork", false)])
        },
    );
    assert_caught(
        &outcome,
        "open_docs_view",
        "not_found",
        "no documentation for `fork`: this session does not bind it",
    );
}

/// A Symbol, a String and a `Method` are the three things that name an entry; anything else is
/// refused here, before the lookup, so a value that came from somewhere else is not looked up as an
/// entry literally called "" and reported as an unknown name nobody wrote.
#[test]
fn a_documentation_target_that_is_neither_a_name_nor_a_method_is_refused_before_the_host() {
    let (outcome, _log) = sdk(&caught("GG::Views.open_docs_view(42)"));
    assert_caught(
        &outcome,
        "open_docs_view",
        "invalid_argument",
        "expected an entry name or a method, got 42",
    );
    assert!(opened(&outcome).is_empty(), "nothing was opened");
}

/// An empty selector names nothing rather than everything, and a close of it is a typo rather than a
/// way of saying *all of them*.
#[test]
fn a_close_of_an_empty_selector_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught(r#"GG::Views.close("")"#));
    assert_caught(
        &outcome,
        "close",
        "invalid_argument",
        "`view.close` needs a non-empty selector",
    );
}

#[test]
fn a_close_is_unavailable_when_the_run_withholds_managing_the_window() {
    let (outcome, _log) = sdk_granting(
        &caught(r#"GG::Views.close("summary")"#),
        &all_operations_without(CAPABILITY_AGENT_MANAGED_CONTEXT),
    );
    assert_caught(
        &outcome,
        "close",
        "unavailable",
        "`GG::Views.close` is not available.",
    );
}

// -------------------------------------------------------------------------------------------------
// session
//
// The one declaration nothing downstream re-examines, which is why the role gate is checked at the
// membrane as well as bound into the guest's scope: a guest that links its SDK as a library has no
// scope to withhold a name from.
// -------------------------------------------------------------------------------------------------

#[test]
fn a_finish_records_a_completion_carrying_the_summary() {
    let (outcome, _log) = sdk_as(
        "require \"gg\"\nGG::Session.finish(\"scaffolded the page\")\n",
        EndingRole::Standard,
    );
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::Finished {
            summary: "scaffolded the page".to_string()
        })
    );
}

/// "I am done and have nothing to say about it" is not an ending gg accepts on the model's behalf,
/// and refusing it leaves the session **live**.
#[test]
fn a_finish_of_a_blank_summary_is_an_argument_error_and_the_run_stays_live() {
    let (outcome, _log) = sdk_as(
        &caught_code(r#"GG::Session.finish("   ")"#),
        EndingRole::Standard,
    );
    assert_caught_code(&outcome, "finish", "invalid_argument");
    assert!(outcome.completion.is_none(), "the session is still live");
}

/// No unwind, so calling it twice is an ordinary thing for a program to do — the later declaration
/// is the one made with more of the program's work behind it, and the replacement is counted.
#[test]
fn a_second_finish_replaces_the_summary_and_is_counted() {
    let (outcome, _log) = sdk_as(
        r##"
require "gg"
GG::Session.finish("scaffolded the page")
GG::Session.finish("scaffolded the page and wired the router")
"##,
        EndingRole::Standard,
    );
    let completion = outcome.completion.expect("the program declared an ending");
    assert_eq!(
        (completion.ending, completion.superseded),
        (
            Ending::Finished {
                summary: "scaffolded the page and wired the router".to_string()
            },
            1
        )
    );
}

/// The declaration rests on checks the program never finished running, so a program that then raises
/// loses the ending — and the turn's feedback can say it was cancelled rather than leaving the
/// session over for a reason nobody can see.
#[test]
fn a_program_that_finishes_and_then_raises_has_its_completion_revoked() {
    let (outcome, _log) = sdk_as(
        r##"
require "gg"
GG::Session.finish("scaffolded the page")
raise ArgumentError, "boom"
"##,
        EndingRole::Standard,
    );
    assert!(outcome.completion.is_none(), "the ending was revoked");
    assert_eq!(
        outcome.revoked_completion,
        Some(Ending::Finished {
            summary: "scaffolded the page".to_string()
        })
    );
}

/// An ending performs no work and ends the session, which is exactly what a spent wall-clock budget
/// wants — so it is the one call the membrane still services after the budget is gone.
#[test]
fn a_finish_after_the_wall_clock_budget_is_spent_still_takes_the_ending() {
    let (outcome, _log) = sdk_as_past_the_budget(
        "require \"gg\"\nGG::Session.finish(\"scaffolded the page\")\n",
        EndingRole::Standard,
    );
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::Finished {
            summary: "scaffolded the page".to_string()
        })
    );
}

/// "The work is complete" is not a verdict a reviewer is asked for, so the call it would be made
/// with is refused — naming the two endings this session *does* have, in this arm's own spelling.
#[test]
fn a_finish_from_a_review_session_is_unavailable() {
    let (outcome, _log) = sdk_as(
        &caught(r#"GG::Session.finish("looks good")"#),
        EndingRole::Review,
    );
    assert_caught(
        &outcome,
        "finish",
        "unavailable",
        "`GG::Session.finish` is not available. Use `GG::Session.approve` or \
         `GG::Session.request_changes` instead.",
    );
}

#[test]
fn an_approve_records_the_review_ending() {
    let (outcome, _log) = sdk_as("require \"gg\"\nGG::Session.approve\n", EndingRole::Review);
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::Approved)
    );
}

/// And the mirror of it: an approval is a reviewer's verdict, so a standard session is refused one —
/// and the refusal is on the turn's roster, because it is a call this run withheld.
#[test]
fn an_approve_from_a_standard_session_is_unavailable() {
    let (outcome, _log) = sdk_as(&caught_code("GG::Session.approve"), EndingRole::Standard);
    assert_caught_code(&outcome, "approve", "unavailable");
    let refused: Vec<&str> = outcome
        .refusals
        .iter()
        .map(|refusal| refusal.name.as_str())
        .collect();
    assert_eq!(refused, ["session.approve"]);
}

#[test]
fn a_request_for_changes_records_its_items() {
    let (outcome, _log) = sdk_as(
        "require \"gg\"\nGG::Session.request_changes(\"tighten the parser\", \"name the error\")\n",
        EndingRole::Review,
    );
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::ChangesRequested {
            items: vec![
                "tighten the parser".to_string(),
                "name the error".to_string()
            ]
        })
    );
}

/// An empty list would give the agent that has to fix the work nothing to do, and it is dispatched
/// verbatim — so it is refused here rather than papered over downstream.
#[test]
fn a_request_for_changes_with_an_empty_list_is_an_argument_error() {
    let (outcome, _log) = sdk_as(
        &caught_code("GG::Session.request_changes"),
        EndingRole::Review,
    );
    assert_caught_code(&outcome, "request_changes", "invalid_argument");
}

/// A list of blanks is an empty list said at greater length, and it is a **distinct cause**: the
/// entries really crossed, were trimmed, and left nothing actionable behind.
#[test]
fn a_request_for_changes_whose_entries_are_all_blank_is_an_argument_error() {
    let (outcome, _log) = sdk_as(
        &caught_code(r#"GG::Session.request_changes("", "   ")"#),
        EndingRole::Review,
    );
    assert_caught_code(&outcome, "request_changes", "invalid_argument");
    assert!(outcome.completion.is_none(), "the session is still live");
}

#[test]
fn a_request_for_changes_from_a_standard_session_is_unavailable() {
    let (outcome, _log) = sdk_as(
        &caught_code(r#"GG::Session.request_changes("tighten the parser")"#),
        EndingRole::Standard,
    );
    assert_caught_code(&outcome, "request_changes", "unavailable");
}

// -------------------------------------------------------------------------------------------------
// the feedback channel
//
// The two contracts this guest keeps by having nothing to report, pinned rather than left as a gap.
// The other rows — what the capture keeps past its caps, and what the model is told about a code
// module that failed to load — are driven by
// [`ruby.feedback.test.rs`](super::super::language::ruby_feedback_tests).
// -------------------------------------------------------------------------------------------------

/// A Ruby program is a **script**, and a script's final value is discarded by Ruby itself — so there
/// is nothing left for gg to note, and the note stays false rather than reporting a return nobody
/// made.
#[test]
fn a_programs_last_expression_is_not_a_returned_value() {
    let (outcome, _log) = sdk("require \"gg\"\nputs \"working\"\n1 + 1\n");
    assert_eq!(logs(&outcome), ["working"]);
    assert!(
        !outcome.returned_value,
        "a script has no return value to discard"
    );
}

/// **Work deferred into a microtask runs inside the turn.** `queueMicrotask` is one of the globals
/// this guest refuses by name, so the microtask a program can really reach is a resolved promise's
/// continuation — and the shared guest drains its job queue before it returns, which is the same
/// mechanism a top-level `await` finishes on. The gg call the continuation makes is therefore an
/// ordinary recorded call, with no continuation left over for the shim to note.
#[test]
fn work_deferred_into_a_microtask_leaves_no_deferred_note() {
    let (outcome, log) = sdk(r##"
require "gg"
later = proc { GG::Files.write_file("late.txt") { "x" } }
`Promise.resolve().then(function () { #{later}.$call(); })`
puts "first"
"##);
    assert_eq!(logs(&outcome), ["first"]);
    assert_eq!(
        log.names(),
        ["write_file"],
        "the deferred call ran inside the turn"
    );
    assert!(
        outcome.deferred_note.is_none(),
        "no continuation ran after the program: {:?}",
        outcome.deferred_note
    );
}
