//! **The Ruby arm's execution substrate** — the committed Opal compiler and the committed guest,
//! driven end to end: real Ruby, really compiled by a real `node`, really evaluated against gg's
//! real membrane.
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
//! # Why the crossing is spelled in inline JavaScript
//!
//! Because there is no Ruby SDK yet, and that is this arm's landing order rather than an oversight.
//! What has to be provable *now* is that a Ruby program reaches the host at all — that a value a
//! model wrote in Ruby arrives at gg's real `ToolApi` as the right JSON — and Opal's
//! inline-JavaScript interop is how Ruby reaches a JavaScript binding. The next commit wraps exactly
//! these bindings in a hand-written, idiomatic Ruby SDK; nothing below is what a model will be shown.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile an 18.6 MB component — around 1.1 s in the dev test profile — and materialise a 2.9 MB
//! compiler. So each function drives *many* programs against many stores rather than being one
//! behaviour per function, exactly as `sandbox.test.rs` does. Add a program to an existing function
//! rather than adding a function.

use std::sync::OnceLock;
use std::time::Instant;

use serde_json::{Value, json};
use wasmtime::component::Component;

use super::COMPONENT;
use super::compile::compile_program;
use crate::sandbox::fake::{CallLog, FakeToolApi, canned_outcome, typescript};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, ProgramScope, SandboxLimits, bounded_store, engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// The committed guest, compiled once per test process.
///
/// The same bargain [`engine::component`](super::super::super::engine::component) strikes for a run,
/// and for the same reason: compiling 18.6 MB costs a second and instantiating the result costs half
/// a millisecond, so a function that drives ten programs must not pay ten compiles. A plain
/// `OnceLock` rather than the production cache because that cache is indexed by the wire id this
/// language does not have yet.
fn component() -> &'static Component {
    static COMPILED: OnceLock<Component> = OnceLock::new();
    COMPILED.get_or_init(|| {
        engine::compile_bytes(COMPONENT).expect("the committed Ruby guest compiles")
    })
}

/// Compile `ruby` with the production prepare step, or panic with what the compiler said.
fn prepare(ruby: &str) -> String {
    match compile_program(ruby, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the committed Opal did not compile this Ruby: {failure}"),
    }
}

/// Compile and run one Ruby `program` through the real membrane, with `enabled`'s gg tools offered.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the per-language component cache,
/// which is indexed by the wire id this language does not have yet. [`component`] stands in for it,
/// so the compile is still paid once.
///
/// The [membrane state](MembraneState) is built with **TypeScript** as its language, and that is
/// sound rather than sloppy: a language is held there to spell a call's name back at the model
/// inside a refusal, and this arm's SDK — the thing that would give those names a Ruby spelling — is
/// the next commit's. No assertion below reads a spelling; the one that reads a refusal reads its
/// [code](test_cabinet_core::gg::GgToolFailure).
fn run_with(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let scope = ProgramScope {
        enabled,
        modules,
        ending: RunEnding::None,
        library: false,
    };
    let mut store = bounded_store(
        MembraneState::new(api, typescript(), scope, limits, None),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component(), &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the committed Ruby guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(
            &mut store,
            program,
            modules,
            enabled,
            RunEnding::None.into(),
            false,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let (outcome, _api) = reclaim(store, returned, None, None, None);
    (outcome, log)
}

/// Compile and run `ruby` with no gg tool offered — the shape most of these cases want.
fn run(ruby: &str) -> SandboxOutcome {
    run_with(&prepare(ruby), &[], &[], canned_outcome).0
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

/// What a program logged, insisting that the sandbox ran it and that it did not throw.
fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program threw: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// The throw a program did not catch, insisting that the sandbox itself did not fail.
fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .unwrap_or_else(|| panic!("the program did not throw; it logged {:?}", outcome.logs)),
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

    // Opal is not CRuby and this arm's study has to say so: integer division is JavaScript's, so
    // `1 / 0` is `Infinity` where CRuby raises `ZeroDivisionError`, and there is no bignum. Asserted
    // rather than described, so the claim is checkable against the artifact.
    let outcome = run("puts (1 / 0).to_s\nputs (2 ** 64).to_s\n");
    assert_eq!(logs(&outcome), ["Infinity", "18446744073709552000"]);
}

#[test]
fn a_ruby_program_crosses_the_membrane_and_is_gated_by_the_host() {
    // The substrate's own proof, and the reason it is spelled in inline JavaScript: there is no Ruby
    // SDK yet, so the program reaches the guest's bindings the way Ruby reaches any JavaScript
    // object. What is being shown is that a value a program computed in Ruby arrives at gg's real
    // `ToolApi` as the right JSON.
    let read = r#"
name = "notes" + ".md"
text = `fs.readTextFile(name)`
puts text.lines.first.strip
"#;
    let (outcome, log) = run_with(
        &prepare(read),
        &["read_file".to_string()],
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["contents of notes.md"]);
    let calls = log.calls();
    assert_eq!(calls.len(), 1, "one call, from one Ruby statement");
    assert_eq!(calls[0].name, "read_file");
    assert_eq!(
        calls[0].args,
        json!({ "path": "notes.md", "offset": null, "limit": null }),
        "the same JSON the ECMAScript arms produce for this call, because it is the same SDK"
    );

    // A Ruby value that is not a string crosses as itself: the numbers below are Ruby integers on
    // one side of the membrane and JSON numbers on the other, with nothing in the program
    // assembling a document.
    let windowed = r#"
`fs.readTextFile("notes.md", { offset: 10, limit: 5 })`
"#;
    let (_outcome, log) = run_with(
        &prepare(windowed),
        &["read_file".to_string()],
        &[],
        canned_outcome,
    );
    assert_eq!(
        log.calls()[0].args,
        json!({ "path": "notes.md", "offset": 10, "limit": 5 })
    );

    // A tool this run does not offer is not a name in the program's scope, so reaching for it is a
    // `ReferenceError` — the same refusal a JavaScript program gets, because it is the same guest.
    let outcome = run("`system.shell(\"ls\")`\n");
    let error = program_error(&outcome);
    assert!(
        error.message.contains("system"),
        "the refusal names what was reached for: {}",
        error.message
    );
    assert!(
        matches!(
            error.kind,
            crate::sandbox::outcome::ProgramErrorKind::UnknownName
        ),
        "a withheld capability is an unknown name, not a tool failure: {error:?}"
    );
}

#[test]
fn an_uncaught_ruby_exception_is_reported_rather_than_taking_the_store_down() {
    // A raise has to come back as a `ProgramError` carrying Ruby's own class and message, not as an
    // opaque wasm trap. This is the guest's single `catch`, reached through Opal's exception
    // hierarchy — a Ruby `ArgumentError` is a JavaScript error object by the time the shim sees it,
    // and it must not be described as `{}`.
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
        outcome.logs,
        ["before"],
        "what ran before the raise is still reported"
    );

    // A program that catches its own raise runs to completion, which is what says the exception is a
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
}

#[test]
fn code_modules_become_a_namespace_the_program_reaches_at_lib() {
    // A code skill's or code memory's module is evaluated BEFORE the program and against the same
    // scope, which is the half of this arm that a runtime living inside the program's own source
    // could not have satisfied — and the reason this guest bakes Opal in rather than prepending it.
    // The host's module *preparation* (which names a Ruby module's exports) is the registration
    // commit's; what is proven here is that the guest binds what it is handed.
    let module = format!(
        "{}\nreturn {{ double: Opal.top.$double, greeting: Opal.top.$greeting }};",
        prepare("def double(n) = n * 2\ndef greeting = 'from a skill'\n")
    );
    let (outcome, _log) = run_with(
        &prepare("puts `lib.helpers.double(21)`\nputs `lib.helpers.greeting()`\n"),
        &[],
        &[CodeModule {
            name: "helpers".to_string(),
            source: module,
        }],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["42", "from a skill"]);

    // A module that throws while loading does not take the turn down with it: its author is whoever
    // wrote the skill, not the model whose program merely has it in scope.
    let broken = format!(
        "{}\nreturn {{}};",
        prepare("raise 'this skill is broken'\n")
    );
    let (outcome, _log) = run_with(
        &prepare("puts 'the program still ran'\n"),
        &[],
        &[CodeModule {
            name: "broken".to_string(),
            source: broken,
        }],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["the program still ran"]);
}

#[test]
fn the_baked_opal_runtime_is_what_makes_a_turn_affordable() {
    // The measurement this artifact exists for, held as a bound rather than as a number: evaluating
    // a Ruby program on this component must cost what a JavaScript program costs plus a little, not
    // the 45–51 ms that prepending Opal's 743 KB runtime to every program measured. The threshold is
    // deliberately far above the measured 2.1–2.6 ms and far below the prepended figure, so only a
    // real regression — the runtime falling out of the snapshot — can move it.
    let program = prepare("puts (1..20).reduce(:+)\n");
    // One run first, so the component compile and the first instantiation are not in the reading.
    assert_eq!(
        logs(&run_with(&program, &[], &[], canned_outcome).0),
        ["210"]
    );

    let mut best = std::time::Duration::MAX;
    for _ in 0..5 {
        let started = Instant::now();
        let (outcome, _log) = run_with(&program, &[], &[], canned_outcome);
        best = best.min(started.elapsed());
        assert_eq!(logs(&outcome), ["210"]);
    }
    assert!(
        best.as_millis() < 25,
        "instantiating and evaluating a Ruby program took {best:?}; Opal's runtime is being built \
         per turn rather than coming out of the component's pre-initialised snapshot",
    );
}

#[test]
fn the_committed_guest_imports_the_membrane_and_the_wasi_it_was_baked_with() {
    // This guest is the ECMAScript guest plus a runtime, so its imports must be that guest's
    // exactly: a capability enabled here and not there would be a difference between two arms of a
    // study that nobody chose. `wasi:filesystem` and `wasi:sockets` are absent because the component
    // is baked without them, not because the host withholds them — gg's linker defines the whole
    // surface for every guest.
    let mut imports = interface_imports(component());
    let (ecmascript, _) = engine::component(typescript()).expect("the ECMAScript guest compiles");
    let expected = interface_imports(ecmascript);
    imports.sort_unstable();
    assert_eq!(
        imports, expected,
        "the committed Ruby guest reaches something the ECMAScript guest does not, or the other \
         way round; the two are one guest plus a runtime, and a capability on one side only is a \
         difference between arms of a study that nobody chose"
    );

    // Every gg interface the world declares is present, because the shared SDK imports every one of
    // them — which is what puts them in the artifact. A binding that was not baked in is a
    // capability a program could not reach however well the host implements it.
    assert_eq!(
        imports
            .iter()
            .filter(|name| name.starts_with("test-cabinet:gg/"))
            .count(),
        15,
        "the whole gg half of the membrane, the shim's own feedback channel included"
    );

    // ~18.6 MiB: a whole JavaScript engine, plus Opal's corelib as it stands after the runtime's
    // top level has run. A band rather than a number because the build snapshots a running engine's
    // heap. Far smaller would mean the runtime never got baked — the failure this artifact exists to
    // prevent — and far larger, that the build picked up something it should not have.
    assert!(
        (16 * 1024 * 1024..=22 * 1024 * 1024).contains(&COMPONENT.len()),
        "the committed Ruby guest is {} bytes, outside the documented 16–22 MiB band",
        COMPONENT.len()
    );

    // The bijection the committed artifact is held to: this guest binds gg's whole tool vocabulary
    // and nothing else. It is the ECMAScript guest's SDK doing the binding, which is precisely why
    // it has to be re-asserted here — a stale Ruby artifact built against an older gg would pass
    // every check that reads the TypeScript one.
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let scope = ProgramScope {
        enabled: &[],
        modules: &[],
        ending: RunEnding::None,
        library: false,
    };
    let mut store = bounded_store(
        MembraneState::new(FakeToolApi::new(&log), typescript(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component(), &linker).expect("instantiates");
    let mut answered = bound
        .call_bound_tools(&mut store)
        .expect("the guest answers");
    answered.sort();
    let mut expected = crate::sandbox::signatures::sandbox_tool_names();
    expected.sort_unstable();
    assert_eq!(answered, expected);
}
