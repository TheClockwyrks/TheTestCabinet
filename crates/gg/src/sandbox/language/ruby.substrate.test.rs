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
//! side is [`FakeToolApi`](super::super::super::fake::FakeToolApi), which is what every other
//! end-to-end sandbox test uses, and it records the exact JSON each call arrived as.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 20 MB component — around 1.2 s in the dev test profile — and materialise a 2.9 MB
//! compiler. So each function drives *many* programs against many stores rather than being one
//! behaviour per function, exactly as `sandbox.test.rs` does. Add a program to an existing function
//! rather than adding a function.

use std::time::Instant;

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;
use wasmtime::component::Component;

use super::COMPONENT;
use super::compile::{compile_module, compile_program};
use crate::ending::EndingRole;
use test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE;

use crate::sandbox::fake::{
    CallLog, FakeToolApi, all_capabilities, all_operations, all_operations_without, canned_outcome,
    granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, ProgramErrorKind, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, ProgramScope, SandboxLimits, bounded_store, engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// This arm's [registered language](crate::sandbox::ProgramLanguage), reached through the registry
/// rather than by naming its module — so every case below exercises the same lookup a run does.
fn ruby() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Ruby)
}

/// The embedded guest, compiled once per test process — through the **production** per-language
/// cache, now that this arm has a wire id to be cached under.
///
/// The same bargain a run strikes, and for the same reason: compiling 20 MB costs a second and
/// instantiating the result costs half a millisecond, so a function that drives ten programs must
/// not pay ten compiles.
fn component() -> &'static Component {
    engine::component(ruby())
        .expect("the embedded Ruby guest compiles")
        .0
}

/// Compile `ruby` with the production prepare step, or panic with what the compiler said.
fn prepare(ruby: &str) -> String {
    match compile_program(ruby, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the embedded Opal did not compile this Ruby: {failure}"),
    }
}

/// Compile `ruby` as a code module, or panic with what the compiler said.
fn prepare_module(ruby: &str) -> String {
    match compile_module(ruby, &PrepareContext::new()) {
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
/// [`component`] is exactly that work: a `Component::new` of this arm's 21 MB embedded guest, paid
/// once per **process** — which under `cargo nextest` means once per `#[test]`. The same compile of
/// the 14 MB shared guest was measured on this repository's dev container at 1.35 s alone, a median
/// of 10.6 s and a worst of 34.0 s across the processes that paid it during one `cargo nextest run
/// --workspace`. Past thirty of those seconds the guest's first instruction traps and the arm
/// reports `Timeout { limit: 30s }` for a program that ran for microseconds, which is what was
/// observed happening on the JVM and PureScript arms, which had this same ordering.
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
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    // Both of these before the store exists, for the reason this function's documentation gives.
    let component = component();
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules,
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    let mut store = bounded_store(MembraneState::new(api, ruby(), scope, limits, None), limits);
    let bound = match Sandbox::instantiate(&mut store, component, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the embedded Ruby guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
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
fn run_with(
    ruby: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(ruby, operations, modules, RunEnding::None, false, responder)
}

/// Compile and run `ruby` with no gg tool offered — the shape most of these cases want.
fn run(ruby: &str) -> SandboxOutcome {
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
fn logs(outcome: &SandboxOutcome) -> &[String] {
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

    // A failure is a raised `ToolError` carrying a Symbol code, rescued by a name the prompt teaches
    // — and `rescue => failure` catches it too, because it is a `StandardError` like anything else a
    // Ruby library raises.
    let (outcome, _log) = run_with(
        r##"
require "gg"
begin
  GG::Files.read_file("missing.md")
rescue GG::Core::ToolError => failure
  puts "#{failure.tool} #{failure.code} #{failure.code == GG::Core::ToolErrorCode::NOT_FOUND}"
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
        "require \"gg\"\nbegin\n  GG::Files.read_file(\"notes.md\")\nrescue GG::Core::ToolError => failure\n           puts \"#{failure.tool} #{failure.code}\"\nend\n",
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
    // that says where the real ones came from.
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
        let failure = compile_module(source, &PrepareContext::new())
            .expect_err("the module does not compile");
        assert!(
            failure.to_string().contains(at),
            "the diagnostic names the author's own line: {failure}"
        );
    }
}

/// One tool, called through the Ruby spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The call, exactly as a model would write it. The [`require`](super::SURFACE_IMPORT) that
    /// reaches it is written by the loop below rather than thirty-five times here.
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
fn every_tool_crosses_the_membrane_from_its_ruby_spelling() {
    let crossings = crossings();
    let operations = all_operations();

    for crossing in &crossings {
        let program = format!("{}\n{}\n", super::SURFACE_IMPORT, crossing.program);
        let (outcome, log) = run_with(&program, &operations, &[], canned_outcome);
        assert!(
            matches!(&outcome.result, Ok(result) if result.error.is_none()),
            "`{}` did not run cleanly: {:?}",
            crossing.tool,
            outcome.result
        );
        assert_eq!(
            log.names(),
            [crossing.tool],
            "`{}` did not reach gg's dispatch under its own name",
            crossing.program
        );
        assert_eq!(
            log.args(crossing.tool),
            Some((crossing.expected)()),
            "`{}` carried the wrong arguments",
            crossing.program
        );
    }

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than
    // shipping as a typed method nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut expected = crate::sandbox::signatures::sandbox_tool_names();
    expected.sort_unstable();
    assert_eq!(
        covered, expected,
        "every bound tool needs a crossing, and only bound tools may have one"
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
open = GG::Views.current
puts "#{open.size} #{open.map(&:selector).join(",")} #{open.first.kind == GG::Views::ViewKind::TEXT} #{open.first.tokens}"
puts "#{GG::Views.close("scratch")} #{GG::Views.close("never opened")} #{GG::Views.current.size}"

# The documentation of a function, named with a Symbol, with a String, and with the method itself.
GG::Views.open_docs_view(:read_file)
GG::Views.open_docs_view("write_file")
GG::Views.open_docs_view(GG::Files.method(:read_file))

whole = GG::Views.open_file("notes.md")
puts "#{whole.class} #{GG::Views.current.select { |v| v.kind == GG::Views::ViewKind::FILE }.map(&:region).inspect}"
GG::Session.finish("done")
"##,
        &all_operations(),
        &[],
        RunEnding::Role(EndingRole::Standard),
        true,
        canned_outcome,
    );
    let lines = logs(&outcome);
    assert_eq!(lines[0], "2 summary,scratch true 6");
    assert_eq!(lines[1], "1 0 1");
    assert!(
        lines[2].starts_with("GG::Files::TextFile"),
        "{:?}",
        lines[2]
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
    // Symbol the kind filter lowers from, and the view the host opens on the way back.
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::new(&log);
    let component = component();
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
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
page = GG::Docs.search("read", in_module: "files", type: "FileRead",
                       kind: GG::Docs::DocKind::FUNCTION, limit: 5)
puts "#{page.class} #{page.total} #{page.offset} #{page.hits.inspect}"
puts "#{GG::Docs.close("GG::Files.read_file")} #{GG::Docs.close_all}"
"##,
    );
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
rescue GG::Core::ToolError => failure
  puts "#{failure.tool} #{failure.code == GG::Core::ToolErrorCode::UNAVAILABLE}"
end
"##,
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["close_all true"]);
}

#[test]
fn the_baked_runtime_makes_a_turn_affordable_and_requiring_gg_is_what_it_costs() {
    // The measurement this artifact exists for, held as a bound rather than as a number: evaluating
    // a Ruby program on this component must cost what a JavaScript program costs plus a little, not
    // the 45–51 ms that prepending Opal's 743 KB runtime to every program measured.
    //
    // It is a COMPARISON rather than a millisecond ceiling, and that is a correction rather than a
    // refinement. The sentence above was always phrased as a comparison — "what a JavaScript program
    // costs plus a little" — but what was asserted was `< 25 ms`, with JavaScript's 1.2–1.4 ms
    // quoted from a reading taken on another artifact in another process, where nothing could
    // re-take it. That makes the assertion a claim about the machine: measured on this dev container
    // it now reads 12.2–12.9 ms rather than the 4.8–7.7 ms the quote was chosen against, so the
    // margin the comment described as generous had quietly become a factor of two — and under
    // `cargo nextest run --workspace` it was measured **failing at 28.7 ms** with nothing whatever
    // wrong with the guest. A study that runs on a busier box than this one would have failed it
    // every time.
    //
    // The control is the same program's language, removed: plain JavaScript through the same
    // `evaluate`, on the same component, in the same process, with the same thirty-five tools
    // operations — so instantiating a 21 MB guest is paid by both readings and cancels, and what is
    // left is exactly the thing this artifact exists to have made free, the Opal runtime the
    // compiled program requires. The two are interleaved rather than measured in blocks, so a bad
    // scheduling window lands on both. This is the idiom the PureScript arm already uses for the
    // same question about its own compiler output.
    //
    // A THIRD READING is the same program with `require "gg"` above it, which is what a program that
    // calls gg writes. gg's SDK is registered in the guest and loaded by that line and by nothing
    // else, so its cost is a turn's cost rather than the artifact's — and it is measured here rather
    // than argued about.
    //
    // Compiled ONCE, outside the reading: what is being measured is a turn, and the compile is
    // measured — and recorded per program — in its own right.
    let program = prepare("puts (1..20).reduce(:+)\n");
    let with_gg = prepare("require \"gg\"\nputs (1..20).reduce(:+)\n");
    // Not a compiled Ruby program: a line of JavaScript that reaches the same `console.log` the
    // compiled one reaches, which is what makes it the same turn minus the runtime.
    let javascript = "console.log(210)";
    let operations = all_operations();
    // One run first, so the component compile and the first instantiation are not in the reading.
    assert_eq!(
        logs(
            &evaluate(
                &program,
                &operations,
                &[],
                RunEnding::None,
                false,
                canned_outcome
            )
            .0
        ),
        ["210"]
    );

    let mut ruby = std::time::Duration::MAX;
    let mut plain = std::time::Duration::MAX;
    let mut required = std::time::Duration::MAX;
    for _ in 0..5 {
        let started = Instant::now();
        let outcome = evaluate(
            &with_gg,
            &operations,
            &[],
            RunEnding::None,
            false,
            canned_outcome,
        )
        .0;
        required = required.min(started.elapsed());
        assert_eq!(logs(&outcome), ["210"]);

        let started = Instant::now();
        let outcome = evaluate(
            &program,
            &operations,
            &[],
            RunEnding::None,
            false,
            canned_outcome,
        )
        .0;
        ruby = ruby.min(started.elapsed());
        assert_eq!(logs(&outcome), ["210"]);

        let started = Instant::now();
        let outcome = evaluate(
            javascript,
            &operations,
            &[],
            RunEnding::None,
            false,
            canned_outcome,
        )
        .0;
        plain = plain.min(started.elapsed());
        assert_eq!(
            logs(&outcome),
            ["210"],
            "the control has to be the same turn, not a different one"
        );
    }
    // Twice, against a ratio measured at 1.02–1.04 in every condition it was taken in: 12.2 ms
    // against 11.8 ms on an idle dev container, 12.9 against 12.6 beside six arms' substrate and
    // surface tests, and 12.7 against 12.4 with twenty-four busy loops holding the machine down. The
    // regression it is set against is the one in the first paragraph — Opal's 743 KB runtime
    // prepended to every program, 45–51 ms against a 4.8–7.7 ms base, which is a ratio near seven.
    // Two sits an order of magnitude below that and comfortably above every reading of a healthy
    // artifact, and unlike a millisecond ceiling it does not move when the machine does.
    assert!(
        ruby < plain * 2,
        "a Ruby turn on this component took {ruby:?} against plain JavaScript's {plain:?} on the \
         same component and the same operations set; Opal's runtime is being built or prepended per \
         turn rather than coming out of the component's pre-initialised snapshot",
    );

    // The ratio above cannot see the cost the two readings SHARE, and that is most of what a turn
    // costs: instantiating the 20.1 MiB guest and building the SDK's surface is ~11 ms of an ~11.6 ms
    // reading, so it cancels. A regression that put the shared half at 500 ms would leave the ratio
    // at ~1.0 and this test green while a turn had got forty times dearer — and the test is named
    // for a turn being *affordable*, which is an absolute claim the ratio does not make.
    //
    // So the absolute bound is kept, deliberately loose, as a second assertion rather than as the
    // first. What made the old one flake was not that it was absolute but that it was TIGHT: 25 ms
    // chosen against a 4.8–7.7 ms reading had drifted to 2.15x margin as this container got slower,
    // and 28.7 ms beside a full workspace run was enough to fail it. 250 ms against the 11–12 ms
    // measured here is 23x, which no amount of machine weather reaches and which still catches the
    // shared-cost regression the ratio is blind to. It bounds the CONTROL, not the Ruby reading,
    // because the control is the shared cost with none of Opal's share in it.
    assert!(
        plain < std::time::Duration::from_millis(250),
        "a plain JavaScript turn on this component took {plain:?}; the cost this arm shares with it \
         — instantiating the guest and building the SDK surface — has regressed, which the Ruby/JS \
         ratio above cannot see because it cancels",
    );

    // WHAT THE INVARIANT COSTS, measured rather than estimated. `require "gg"` runs the SDK's whole
    // top level — thirteen modules, every type they declare, and `GG::Scope` reflecting the calling
    // shape of all thirty-five bound functions with `Method#parameters` twice each — and that used
    // to happen once, at bake time, inside the heap `wizer` snapshots. It cannot any more: a
    // constant carried in the snapshot is a constant a program reaches with no line it wrote, which
    // is the thing this arm was converted to stop doing.
    //
    // Measured on this repository's dev container, best of five, interleaved with the two readings
    // above: 2.1 ms plain JavaScript, 2.7 ms Ruby, 20.4 ms Ruby under `require "gg"`. So the line
    // costs about 17.7 ms of a turn — against the ~127 ms this arm spends in `node` compiling that
    // same program, which is where a Ruby turn's time actually goes.
    //
    // The bound is set on the RATIO to the same turn without the line, loose for the reason the
    // bound above is loose: what it has to catch is the SDK being loaded more than once per program
    // or the reflection growing without bound, not machine weather.
    assert!(
        required < ruby * 20,
        "`require \"gg\"` took {required:?} against {ruby:?} for the same program without it; \
         loading gg's SDK has got dramatically dearer, or it is being loaded more than once",
    );

    // And what that line buys, asserted from inside a program: the lifted table `GG::Scope` needs in
    // order to refuse a wrong argument count or an unknown keyword is built and closed. Two
    // requires do not build it twice — Ruby's `require` is idempotent and this arm relies on it.
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
    // arm measured, and worth pinning for the same reason.
    let limits = SandboxLimits {
        timeout: std::time::Duration::from_millis(400),
        ..SandboxLimits::default()
    };
    // Everything the host has to do is done BEFORE the reading and before the store. `bounded_store`
    // arms the 400 ms deadline the moment it builds the state, against a WALL clock that only credits
    // back time parked in bridged calls, so host work done after it is charged to a program that has
    // not started.
    //
    // What that costs *here* is the `prepare` alone, and the distinction is worth stating precisely
    // rather than borrowing the alarming version from the arms where this was a live defect. The
    // `prepare` is a real `opal` invocation and would genuinely have been inside the armed window.
    // The `component()` beside it would not: it is a `OnceLock::get_or_init`, and this test calls
    // `run(...)` three times before reaching this case, so the compile is long since paid and the
    // call returns in nanoseconds. The multi-second compile figures that justify this ordering in
    // `evaluate` — where the store is built once per process, before anything has warmed the lock —
    // are costs this particular case could never have paid. The ordering is right for both; only one
    // of them was ever at risk.
    let program = prepare("sleep 30\nputs 'never'\n");
    let component = component();
    let log = CallLog::default();
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let scope = ProgramScope {
        capabilities: &[],
        operations: &[],
        modules: &[],
        ending: RunEnding::None,
    };
    let started = Instant::now();
    let mut store = bounded_store(
        MembraneState::new(
            FakeToolApi::with(&log, canned_outcome),
            ruby(),
            scope,
            limits,
            None,
        ),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
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
        outcome.result.is_err(),
        "a sleeping Ruby program is stopped by the deadline: {:?}",
        outcome.result
    );
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "the deadline reached the sleep after {:?} rather than letting the 30 s run out",
        started.elapsed()
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
        15,
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
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let scope = ProgramScope {
        capabilities: &[],
        operations: &[],
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(
        MembraneState::new(FakeToolApi::new(&log), ruby(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    let mut answered = bound
        .call_bound_tools(&mut store)
        .expect("the guest answers");
    answered.sort();
    let mut expected = crate::sandbox::signatures::sandbox_tool_names();
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
    // only thing that would notice. It ran here before this arm was registered, wearing the seam's
    // fixture so it could be handed a catalogue whose id the wire enum did not carry yet; now that
    // `ruby` is a language an operator configures, it runs against the registry itself.
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
    // signature a model cannot act on: `4..19` is an argument, `GG::Core::ToolError` is what a
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
why { GG::Views.current(deep: true) }
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
                shape: Shape::ToolError,
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
                recorded: Some(TurnErrorType::ProgramToolError),
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
    for reach in ["GG::Core::ToolError", "GG::Tasks::TaskStatus::DONE"] {
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

    // And the other two lines, each reaching exactly what it names.
    let (outcome, _log) = run_with(
        "require \"lib\"\nputs lib.helpers.double(21)\n",
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
    let api = FakeToolApi::with(&log, canned_outcome);
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
        SandboxLimits::default(),
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
