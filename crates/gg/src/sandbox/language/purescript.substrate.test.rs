//! **The PureScript arm's execution substrate** — the real `purs`, the real `esbuild` and the real
//! guest, driven end to end: PureScript the way a model would write it, really compiled by the
//! toolchain in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as PureScript, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, spawning the
//! production compiler in a [`PrepareContext`](crate::sandbox::PrepareContext) the sandbox mints —
//! and the JavaScript that comes back is compiled with
//! [`compile_bytes`](super::super::super::engine::compile_bytes), linked with
//! [`linker`](super::super::super::linker) (the production linker: the whole membrane plus the whole
//! ambient WASI surface), put in a [`bounded_store`](super::super::super::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](super::super::super::membrane::Sandbox) and driven through its `run` export.
//!
//! # How a call gets from PureScript to gg
//!
//! Through the SDK, and through nothing else. `packages/gg-sandbox-purescript/src/Gg/**` is compiled
//! into the same library tree a program is compiled against, so `import Gg` is an ordinary import
//! resolved by `purs`; its one foreign module names the API objects the guest binds, which are free
//! identifiers in the bundle and are resolved at call time against the scope the guest built. That is
//! what [`every_tool_crosses_the_membrane_from_its_purescript_spelling`] drives: real PureScript,
//! really compiled, whose calls arrive at gg's dispatch carrying the same JSON every other arm's do.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 20 MB component — around 1.2 s in the dev test profile — and unpack a 1.2 MB library
//! tree. So each function drives *many* programs against many stores rather than being one behaviour
//! per function, exactly as `sandbox.test.rs` does. Add a program to an existing function rather than
//! adding a function.

use std::sync::OnceLock;
use std::time::Instant;

use serde_json::{Value, json};
use wasmtime::component::Component;

use test_cabinet_core::gg::GgProgramLanguage;

use super::super::typescript;
use super::compile::{compile_module, compile_program};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{CallLog, FakeToolApi, all_tools, canned_outcome};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, ProgramErrorKind, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, ProgramScope, SandboxLimits, bounded_store, engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// The guest this arm is evaluated by, compiled once per test process.
///
/// It is [TypeScript](super::super::typescript)'s component, byte for byte, and that is the whole of
/// this arm's guest decision: a compiled PureScript program is self-contained JavaScript, so there is
/// nothing for a component of its own to carry. See [the arm's own documentation](super) for the
/// comparison with Ruby, which needed one.
///
/// A plain `OnceLock` rather than the production per-language cache, because that cache belongs to a
/// running sandbox and these tests drive the pieces underneath one.
fn component() -> &'static Component {
    static COMPILED: OnceLock<Component> = OnceLock::new();
    COMPILED.get_or_init(|| {
        engine::compile_bytes(typescript::COMPONENT).expect("the shared ECMAScript guest compiles")
    })
}

/// This arm, resolved through the registry it is now in.
fn purescript() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::PureScript)
}

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
fn prepare(source: &str) -> String {
    match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
    }
}

/// Evaluate already-compiled JavaScript through the real membrane, with `enabled`'s gg tools offered,
/// `modules` bound at `lib.<name>`, and the ending group `ending`'s role produces.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the per-language component cache.
///
/// The [membrane state](MembraneState) is built with **this** language, which is what a refusal
/// naming a call resolves its spelling from.
fn evaluate(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let scope = ProgramScope {
        enabled,
        modules,
        ending,
        library,
    };
    let mut store = bounded_store(
        MembraneState::new(api, purescript(), scope, limits, None),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component(), &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the shared ECMAScript guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(
            &mut store,
            program,
            modules,
            enabled,
            ending.into(),
            library,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let (outcome, _api) = reclaim(store, returned, None, None, None);
    (outcome, log)
}

/// Evaluate already-compiled JavaScript with nothing else configured — a program the compiler has
/// already been through, or a line of JavaScript standing in for one.
fn evaluate_js(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(program, enabled, modules, RunEnding::None, false, responder)
}

/// Compile and run one PureScript program, with everything about the run said explicitly.
fn run_as(
    source: &str,
    enabled: &[String],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare(source),
        enabled,
        modules,
        ending,
        library,
        responder,
    )
}

/// Compile and run one PureScript program with `enabled`'s tools offered and no ending group.
fn run_with(
    source: &str,
    enabled: &[String],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(source, enabled, modules, RunEnding::None, false, responder)
}

/// Compile and run one PureScript program with no gg tool offered — the shape most cases here want.
fn run(source: &str) -> SandboxOutcome {
    run_with(source, &[], &[], canned_outcome).0
}

/// What a program logged, insisting that the sandbox ran it and that it did not fail.
fn logs(outcome: &SandboxOutcome) -> &[String] {
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

/// The failure a program did not handle, insisting that the sandbox itself did not fail.
fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .unwrap_or_else(|| panic!("the program did not fail; it logged {:?}", outcome.logs)),
        Err(error) => panic!("expected a program fault, but the sandbox failed: {error}"),
    }
}

#[test]
fn a_real_purescript_program_runs_through_the_real_membrane() {
    // Ordinary PureScript, exercising what a model actually writes: a data type with a type class
    // instance, a record, pattern matching, a fold over a `Map`, a `where` clause, function
    // composition and `$`. The point is not that any one of them is doubtful — it is that a whole
    // PureScript program survives the compile, the bundle and the crossing rather than a subset.
    let outcome = run(r#"module Main where

import Prelude

import Data.Array (filter, range)
import Data.Foldable (foldl)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Class.Console as Console

data Entry = Entry { amount :: Int, note :: Maybe String }

instance Show Entry where
  show (Entry entry) = show entry.amount <> " (" <> fromMaybe "-" entry.note <> ")"

total :: Array Entry -> Int
total = foldl step 0
  where
  step running (Entry entry) = running + entry.amount

tally :: Array Int -> Map.Map Int Int
tally = foldl (\counts value -> Map.insertWith (+) (mod value 3) 1 counts) Map.empty

main :: Effect Unit
main = do
  let entries = [ Entry { amount: 3, note: Nothing }, Entry { amount: 14, note: Just "second" } ]
  Console.log $ show (total entries)
  Console.log $ show entries
  Console.log $ show (Map.toUnfoldable (tally (range 1 10)) :: Array (Tuple Int Int))
  Console.log $ show (filter (_ > 2) [ 1, 2, 3, 4 ])
"#);
    assert_eq!(
        logs(&outcome),
        [
            "17",
            "[3 (-),14 (second)]",
            "[(Tuple 0 3),(Tuple 1 4),(Tuple 2 3)]",
            "[3,4]",
        ]
    );

    // The three ways a PureScript program says something all reach the operator's stream, because
    // `Effect.Console`'s own foreign module calls `console.log`/`warn`/`error` — which the guest
    // rebinds to `feedback.log` on every run. Nothing in this arm had to arrange that: it is what
    // sharing the ECMAScript guest buys.
    let outcome = run(r#"module Main where

import Prelude
import Effect (Effect)
import Effect.Class.Console as Console

main :: Effect Unit
main = do
  Console.log "to the log"
  Console.warn "to the warning"
  Console.error "to the error"
"#);
    assert_eq!(
        logs(&outcome),
        ["to the log", "to the warning", "to the error"]
    );

    // The libraries the arm ships are really there, and really compiled in: the monad transformers
    // and the profunctor lenses the owner named specifically, driven rather than described.
    let outcome = run(r#"module Main where

import Prelude

import Control.Monad.State (execState, modify_)
import Data.Foldable (for_)
import Data.Lens (over, view)
import Data.Lens.Record (prop)
import Effect (Effect)
import Effect.Class.Console as Console
import Type.Proxy (Proxy(..))

counted :: Int
counted = execState (for_ [ 1, 2, 3, 4, 5 ] \_ -> modify_ (_ + 2)) 0

main :: Effect Unit
main = do
  Console.log (show counted)
  let record = { count: 1, name: "gg" }
  Console.log (show (view (prop (Proxy :: Proxy "count")) (over (prop (Proxy :: Proxy "count")) (_ + 41) record)))
"#);
    assert_eq!(logs(&outcome), ["10", "42"]);
}

#[test]
fn the_ambient_wasi_surface_reaches_a_purescript_program() {
    // A clock and an entropy source are ambient in this sandbox, and the two PureScript packages
    // that expose them are in the shipped set. Neither is asserted on its *value* — a clock that
    // returned a constant would be a determinism guarantee nobody wants here — only that the call
    // completes and produces something in range, which is what "the guest really has WASI" means for
    // a language whose libraries reach it through JavaScript's own globals.
    let outcome = run(r#"module Main where

import Prelude
import Data.DateTime.Instant (unInstant)
import Data.Time.Duration (Milliseconds(..))
import Effect (Effect)
import Effect.Class.Console as Console
import Effect.Now (now)
import Effect.Random (random)

main :: Effect Unit
main = do
  Milliseconds millis <- unInstant <$> now
  value <- random
  Console.log (show (millis > 1.0e12))
  Console.log (show (value >= 0.0 && value < 1.0))
"#);
    assert_eq!(logs(&outcome), ["true", "true"]);
}

#[test]
fn an_unhandled_failure_is_reported_rather_than_taking_the_store_down() {
    // The way effectful PureScript fails: an exception thrown in `Effect` and never caught. It must
    // arrive as a reportable program error the model can read and act on, not as an opaque wasm trap
    // that ends the session.
    let outcome = run(r#"module Main where

import Prelude
import Effect (Effect)
import Effect.Class.Console as Console
import Effect.Exception (throw)

main :: Effect Unit
main = do
  Console.log "before"
  _ <- throw "the spec file was not where I expected"
  Console.log "after"
"#);
    let error = program_error(&outcome);
    assert!(
        error
            .message
            .contains("the spec file was not where I expected"),
        "the model reads what it threw: {}",
        error.message
    );
    // What ran before the failure is still reported: the program is not discarded for having ended
    // badly.
    assert_eq!(outcome.logs, ["before"]);

    // A partial function that was not total after all — the other way PureScript code fails at run
    // time — is the same band, with the compiler's own message.
    let outcome = run("module Main where\n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Partial.Unsafe (unsafeCrashWith)\n\
         \n\
         main :: Effect Unit\n\
         main = unsafeCrashWith \"no branch matched\"\n");
    assert!(
        program_error(&outcome)
            .message
            .contains("no branch matched"),
        "{:?}",
        program_error(&outcome)
    );

    // And an error CAUGHT in PureScript's own idiom does not reach gg at all: the program handles it
    // and carries on, which is the behaviour every SDK failure will rely on once there is an SDK to
    // fail.
    let outcome = run(r#"module Main where

import Prelude
import Data.Either (Either(..))
import Effect (Effect)
import Effect.Class.Console as Console
import Effect.Exception (message, throw, try)

main :: Effect Unit
main = do
  outcome <- try (throw "expected")
  case outcome of
    Left err -> Console.log ("caught: " <> message err)
    Right (_ :: Unit) -> Console.log "no failure"
"#);
    assert_eq!(logs(&outcome), ["caught: expected"]);
}

#[test]
fn a_located_failure_names_the_bundle_rather_than_the_model_s_purescript() {
    // The one thing this arm does NOT yet get right, asserted rather than described, so that the day
    // it is fixed the assertion changes rather than a paragraph.
    //
    // The guest reports the innermost frame of the function it evaluated, in that function's own
    // coordinates — which for this arm is the BUNDLE, not the model's PureScript. The mapping is not
    // lost: `purs` and `esbuild` both emit source maps and the host that produced the bundle is the
    // one that holds them. What is missing is somewhere to put the answer — `program-error` carries
    // one `location`, and the frame the guest picks is the innermost, which once the SDK is linked
    // into the bundle is inside the SDK. The fix is a frame list on the wire, shared with the Java
    // arm.
    let outcome = run("module Main where\n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Exception (throw)\n\
         \n\
         main :: Effect Unit\n\
         main = void (throw \"located somewhere\")\n");
    let error = program_error(&outcome);
    assert!(
        error.location.is_some(),
        "there IS a location; it is simply the wrong file's"
    );
}

#[test]
fn a_code_module_is_a_purescript_module_bound_at_lib() {
    // What a code skill or a code memory written in PureScript is: an ordinary module, compiled the
    // way a program is, whose exports become the namespace at `lib.<key>`. Its functions are curried
    // — that is what a PureScript function IS — so a program reaches them the way PureScript reaches
    // anything.
    let module = compile_module(
        "module Helpers (greet, add) where\n\
         import Prelude\n\
         \n\
         greet :: String -> String\n\
         greet who = \"hello, \" <> who\n\
         \n\
         add :: Int -> Int -> Int\n\
         add left right = left + right\n",
        &PrepareContext::new(),
    )
    .expect("purs compiles a code module");
    let modules = [CodeModule {
        name: "helpers".to_string(),
        source: module,
    }];

    // A program reaches into it through the SDK's `lib`, which is the one place in this arm's surface
    // where the program says what type it expects: a code module is compiled separately, so there is
    // no `import` for `purs` to check the two against. What the exports really are is ordinary
    // PureScript — `add` is curried, because that is what a PureScript function IS.
    let outcome = run_with(
        &program_of(&[
            "case lib \"helpers\" \"greet\" of",
            "  Just greet -> Console.log (greet \"gg\" :: String)",
            "  Nothing -> Console.log \"no greet\"",
            "case lib \"helpers\" \"add\" of",
            "  Just add -> Console.log (show (add 40 2 :: Int))",
            "  Nothing -> Console.log \"no add\"",
            "case lib \"helpers\" \"missing\" :: Maybe String of",
            "  Just _ -> Console.log \"found something that is not there\"",
            "  Nothing -> Console.log \"nothing under that name\"",
        ])
        .replace(
            "import Gg\n",
            "import Gg\nimport Effect.Class.Console as Console\n",
        ),
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(
        logs(&outcome),
        ["hello, gg", "42", "nothing under that name"]
    );

    // And the namespace really is the guest's own object, which is what the SDK's one foreign
    // function reaches: the same three answers, read from JavaScript rather than from PureScript.
    let outcome = evaluate_js(
        r#"console.log(lib.helpers.greet("gg"));
console.log(String(lib.helpers.add(40)(2)));
console.log(Object.keys(lib.helpers).sort().join(","));"#,
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["hello, gg", "42", "add,greet"]);

    // A module whose PureScript does not compile is refused by the prepare step, with the author's
    // own coordinates — it never reaches the guest at all.
    let failure = compile_module("module Helpers where\ngreet = ((\n", &PrepareContext::new())
        .expect_err("a broken module is refused");
    assert!(
        failure.to_string().contains("module.purs:"),
        "located in the author's own file: {failure}"
    );
}

#[test]
fn evaluating_a_compiled_program_costs_a_turn_almost_nothing() {
    // The half of this arm's cost that is NOT the compiler. A compiled PureScript program is
    // self-contained JavaScript with no runtime to boot, so what a turn pays inside the guest is an
    // instantiate and an evaluate — the same thing a JavaScript program pays, which is the whole
    // argument for sharing the component. Measured on this repository's dev container, idle, as a
    // whole turn (a store, an instantiate, an evaluate and the reclaim): ~2.7 ms for the PureScript
    // below, against ~2.1 ms for the JavaScript beside it.
    //
    // It is asserted as a RATIO rather than as a bound in milliseconds, and that is not timidity.
    // An absolute bound here measures the machine: the same 2.7 ms reads as 53 ms beside the rest of
    // this package's tests, which is a load average rather than a regression, and an earlier draft
    // of this test failed on exactly that. Both figures inflate together under load, so dividing one
    // by the other cancels the machine out and leaves the only thing worth asserting — that this arm
    // pays what the JavaScript arm pays, because it evaluates the same kind of artifact on the same
    // component. What that catches is a regression of a different order: a runtime that stopped
    // being tree-shaken out, a library that started initialising at load.
    let purescript = prepare(
        "module Main where\n\
         import Prelude\n\
         import Data.Array (range)\n\
         import Data.Foldable (sum)\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log (show (sum (range 1 100)))\n",
    );
    let javascript = "let total = 0; for (let n = 1; n <= 100; n += 1) total += n; \
                      console.log(String(total));";

    // Warm: the first evaluation in a process pays for the engine's lazy work, not for a program.
    for source in [purescript.as_str(), javascript] {
        assert_eq!(
            logs(&evaluate_js(source, &[], &[], canned_outcome).0),
            ["5050"]
        );
    }

    // Interleaved, so the two measurements share one window of whatever else the machine is doing.
    let runs = 5;
    let mut compiled = std::time::Duration::ZERO;
    let mut plain = std::time::Duration::ZERO;
    for _ in 0..runs {
        let started = Instant::now();
        assert_eq!(
            logs(&evaluate_js(&purescript, &[], &[], canned_outcome).0),
            ["5050"]
        );
        compiled += started.elapsed();

        let started = Instant::now();
        assert_eq!(
            logs(&evaluate_js(javascript, &[], &[], canned_outcome).0),
            ["5050"]
        );
        plain += started.elapsed();
    }
    assert!(
        compiled < plain * 5,
        "a compiled PureScript program costs a turn {:?} against JavaScript's {:?} on the same \
         component — which is a runtime that stopped being compiled away, not a busy machine",
        compiled / runs,
        plain / runs,
    );
}

#[test]
fn the_arm_shares_the_ecmascript_guest_rather_than_carrying_its_own() {
    // Declared rather than inferred. This arm's guest IS TypeScript's artifact, and the reason is
    // that a compiled PureScript program is self-contained JavaScript: there is no runtime for a
    // component of its own to carry, so a second 20 MB artifact would differ from this one in
    // nothing at all.
    //
    // What says so is that both halves below run on the SAME compiled `Component` — the one
    // [`component`] built out of `typescript::COMPONENT` — rather than on two that happen to behave
    // alike. When this arm is registered, the seam's "no language is served another's artifacts"
    // gate is where the sharing gets named; this is what says it is already true.
    let program = prepare(
        "module Main where\n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log \"shared\"\n",
    );
    // And a plain JavaScript program runs on the very same store shape, unchanged — which is the
    // property that would break if this arm had needed the component to carry something.
    assert_eq!(
        logs(&evaluate_js(&program, &[], &[], canned_outcome).0),
        ["shared"]
    );
    assert_eq!(
        logs(&evaluate_js("console.log('shared');", &[], &[], canned_outcome).0),
        ["shared"]
    );
}

/// One tool, called through the PureScript spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it inside a `do` block.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic PureScript function.
///
/// Deliberately the same table `sandbox.membrane.test.rs` drives the TypeScript arm with and
/// `python.substrate.test.rs` and `ruby.substrate.test.rs` drive theirs with, down to the arguments
/// and the expected JSON — because the expected JSON is the point. gg's dispatch is
/// language-independent: four arms writing the same call in their own idioms must produce **byte
/// identical** arguments, or they are not running the same experiment. An optional record field that
/// lowered onto the wrong wire field, a `Nothing` read as "leave it alone" instead of "clear it", a
/// constructor whose arm did not translate — none of them is a compile error in any of the four, and
/// all of them are visible here.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            statement: "_ <- system.shell \"npm test\" { timeoutSecs: 30 }",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: "_ <- fs.readFile \"src/a.purs\" { offset: 2, limit: 5 }",
            expected: || json!({ "path": "src/a.purs", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: "_ <- fs.writeFile \"out.txt\" \"hello\"",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: "_ <- fs.editFile \"src/a.purs\" \"alpha\" \"beta\"",
            expected: || json!({ "path": "src/a.purs", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: "_ <- fs.listDir { path: \"src\" }",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            statement: "_ <- skills.readSkill \"testing\"",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: "_ <- memory.writeMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            expected: || json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "update_memory",
            statement: "_ <- memory.updateMemory { name: \"layout\", description: \"d2\", body: \"b2\" }",
            expected: || json!({ "name": "layout", "description": "d2", "body": "b2", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "create_memory",
            statement: "_ <- memory.createMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            expected: || json!({ "name": "layout", "description": "d", "contents": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "read_memory",
            statement: "_ <- memory.readMemory \"layout\"",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: "_ <- memory.editMemory { name: \"layout\", search: \"old\", replace: \"new\" }",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: "_ <- memory.searchMemories [ \"cargo\", \"nextest\" ]",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: "_ <- memory.deleteMemory \"layout\"",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: "_ <- tasks.addTask { id: \"t1\", title: \"T\", description: \"D\", blockedBy: [ \"t0\" ] }",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: "_ <- tasks.updateTask \"t1\" { title: \"T2\", description: Nothing, status: TaskInProgress }",
            expected: || {
                // `description: Nothing` is what CLEARS it — the field left out of the record is the
                // one that keeps it — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: "_ <- tasks.setBlockedBy \"t1\" []",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: "_ <- tasks.completeTask \"t1\"",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: "_ <- tasks.removeTask \"t1\"",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: "_ <- project.createEpic { prefix: \"epc\", title: \"E\", description: \"D\" }",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: "_ <- project.createIssue { title: \"I\", inScope: \"s\", outOfScope: \"o\", \
                        completionCriteria: \"c\", agent: \"worker\", reviewers: [ \"critic\" ] }",
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
            statement: "_ <- project.updateIssue \"i1\" { status: IssueDone, epicId: Nothing }",
            expected: || {
                // `epicId: Nothing` ungroups the issue, which gg's schema spells as the empty string;
                // a `description` left out of the record keeps the one it has, so its key is absent.
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
            statement: "_ <- project.setIssueBlockedBy \"i1\" [ \"i0\" ]",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: "_ <- project.removeEpic \"e1\"",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: "_ <- project.removeIssue \"i1\"",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: "_ <- project.waitForIssue \"i1\"",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: "_ <- context.evictFileView { path: \"src/a.purs\" }",
            expected: || json!({ "path": "src/a.purs" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a record with the two fields the header of every result carries,
            // which is what a span of integers is in a language with no range literal.
            statement: "_ <- context.archiveThread [ { from: 4, to: 19 }, { from: 30, to: 35 } ]",
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: "_ <- context.searchArchive \"the parser\"",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: "_ <- context.compact \"scaffolded the page\" { files: [ \"src/Main.purs\" ] }",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.purs"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a constructor rather than one of two optional fields, so "both" and
            // "neither" are programs that do not compile.
            statement: "_ <- agents.spawnSubagent \"subagent\" (Prompt \"write the lexer\")",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: "_ <- agents.waitForSubagents { ids: [ \"agent-1\" ] }",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: "_ <- agents.sendMessage \"agent-1\" \"prefer the simpler parser\"",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: "_ <- agents.transitionState \"verify\" { note: \"the build is green\" }",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: "_ <- agents.exec \"Builder\" { prompt: \"pick it up from here\" }",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: "_ <- agents.fork \"try the other fix\"",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

/// One program made of `statements`, written the way a model writes one.
fn program_of(statements: &[&str]) -> String {
    format!(
        "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Data.Maybe (Maybe(..))\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = do\n  {}\n  pure unit\n",
        statements.join("\n  ")
    )
}

#[test]
fn every_tool_crosses_the_membrane_from_its_purescript_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing, which is a difference from the other arms and a
    // deliberate one: a `purs` compile costs ~290 ms where Opal's costs ~180 ms and CPython's costs
    // nothing, so thirty-five of them would be half a minute of compiler for a table that reads the
    // same. What is checked is stronger for being one program — the calls must arrive in the order
    // the program made them, so a call that reached gg's dispatch under a NEIGHBOUR's name fails
    // here as well.
    let statements: Vec<&str> = crossings
        .iter()
        .map(|crossing| crossing.statement)
        .collect();
    let (outcome, log) = run_with(&program_of(&statements), &all_tools(), &[], canned_outcome);
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

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than shipping
    // as a typed function nobody ever called.
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
fn the_view_object_the_program_library_the_helper_and_the_endings_are_reached_in_purescript_too() {
    // The four families that are NOT gg tools, so none of them appears in the crossing table above —
    // and two of them are where a program puts something in front of the model, which makes them the
    // ones a silent bridging mistake would cost the most. Between this and the table, every function
    // this arm's catalogue describes has been driven through the real membrane.
    let (outcome, log) = run_as(
        &program_of(&[
            "text <- fs.readTextFile \"notes.md\" { limit: 2 }",
            "read <- view.openFile \"notes.md\" { offset: 1, limit: 2 }",
            "view.openText \"summary\" text",
            "view.openDocsView \"readFile\"",
            "closed <- view.close \"summary\"",
            "missing <- view.close \"never opened\"",
            "open <- view.current",
            "directory <- fs.list",
            "Console.log (show (map _.selector open) <> \" \" <> show (map _.kind open))",
            "Console.log (show closed <> \" \" <> show missing)",
            "case read of\n                 TextFile file -> Console.log file.contents\n                 ImageFile picture -> Console.log picture.label",
            "Console.log (show (map _.name directory))",
            "harness.finish \"read the file and showed myself the result\"",
        ])
        .replace("import Gg\n", "import Gg\nimport Effect.Class.Console as Console\n"),
        &all_tools(),
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // What is still open is the file view, carrying the kind its constructor names rather than the
    // word the wire used; the text view the program closed is gone, and a documentation view is
    // gg's to deliver on the next turn rather than something `current` reports.
    assert_eq!(lines[0], "[\"notes.md\"] [FileView]");
    // Closing something that is not open is `0` rather than a failure, so a program that tidies up
    // unconditionally does not have to guard every call.
    assert_eq!(lines[1], "1 0");
    assert!(
        lines[2].starts_with("contents of notes.md"),
        "{:?}",
        lines[2]
    );
    assert_eq!(lines[3], "[\"fsFunction\"]");
    // Every view the program opened is recorded, the documentation one included.
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes.md", "summary", "readFile"]
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
    // `view.openFile` performs. Neither has a tool name of its own, which is exactly the point —
    // a helper is a spelling of the tool it is built on, and a view is a read gg also shows you.
    assert_eq!(log.names(), ["read_file", "read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": null, "limit": 2 }))
    );

    // The program library is bound from the capability rather than from a tool name, and a reviewer
    // gets the other ending group and no `harness.finish` at all.
    let (outcome, _log) = run_as(
        &program_of(&[
            "history <- programs.history",
            "outcome <- attempt (programs.get { turn: 2 })",
            "programs.rerun \"module Main where\\nimport Prelude\\nmain = pure unit\"",
            "review.requestChanges [ \"widen the test\", \"name the file\" ]",
            "Console.log (show (map _.turn history))",
            "case outcome of\n                 Left failure -> Console.log (show failure.code)\n                 Right source -> Console.log source",
        ])
        .replace(
            "import Gg\n",
            "import Gg\nimport Data.Either (Either(..))\nimport Effect.Class.Console as Console\n",
        ),
        &[],
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never an error — and a turn it never
    // kept a program for is a `NotFound` the program catches in PureScript's own idiom.
    assert_eq!(logs(&outcome), ["[]", "NotFound"]);
    assert!(outcome.rerun.is_some(), "the hand-over is recorded");
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::ChangesRequested { items }) if items.len() == 2
        ),
        "the reviewer's verdict, with both items: {:?}",
        outcome.completion
    );

    // The other verdict, which is the same role's other ending.
    let (outcome, _log) = run_as(
        &program_of(&["review.approve"]),
        &[],
        &[],
        RunEnding::Role(EndingRole::Review),
        false,
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "{:?}",
        outcome.result
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
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // The SDK exposes the whole surface — it is compiled once and a run's enabled set is decided per
    // run — so what stops a withheld capability from being reachable is a refusal rather than a
    // missing name. It carries the code the HOST refuses an out-of-set call with, because gg
    // classifies a turn's error from the code: a capability nobody granted must not be recorded as a
    // name the model got wrong.
    let (outcome, log) = run_with(
        &program_of(&["_ <- fs.readFile \"src/Main.purs\" {}"]),
        &[],
        &[],
        canned_outcome,
    );
    let error = program_error(&outcome);
    // `UnknownName` is what gg makes of an `unavailable` code, whichever side raised it: the two are
    // one fact and one recovery — this run does not offer that call — and the classification is read
    // from the code rather than from what the guest made of the throw.
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
    assert!(
        error.message.contains("fs.readFile"),
        "the refusal names the call the model wrote: {}",
        error.message
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");

    // A failure the model can expect is caught in PureScript's own idiom and branched on by its
    // code, which is what `attempt` is for.
    let (outcome, _log) = run_with(
        &program_of(&[
            "outcome <- attempt (fs.readFile \"gone.purs\" {})",
            "case outcome of",
            "  Left failure -> Console.log (show failure.code <> \" on \" <> failure.tool)",
            "  Right _ -> Console.log \"read it\"",
        ])
        .replace(
            "import Gg\n",
            "import Gg\nimport Data.Either (Either(..))\nimport Effect.Class.Console as Console\n",
        ),
        &all_tools(),
        &[],
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: gone.purs".to_string(),
            )
        },
    );
    assert_eq!(logs(&outcome), ["NotFound on read_file"]);
}

/// The catalogue this arm commits, read as a document rather than through the language, because what
/// is asserted below is a property of the emitted JSON's *shape*.
const SIGNATURES: &str = include_str!("../guests/purescript.signatures.json");

/// **Every optional argument this arm has is a record FIELD**, which is the shape it brought to the
/// catalogue schema and which nothing had produced at this scale.
///
/// The cross-language half of this claim is now the [agreement gate](super::super::agreement)'s, run
/// over the registry with this arm inside it — a stronger check than the one that stood here before
/// registration, which had to lend the catalogue the fixture's wire id in order to be run at all.
/// What is left here is the part no comparison can make: that PureScript's answer to "how does an
/// optional argument arrive?" really is a row rather than an argument, in every one of its tools.
#[test]
fn every_optional_argument_is_a_field_of_a_record() {
    let document: Value =
        serde_json::from_str(SIGNATURES).expect("the committed PureScript catalogue is valid JSON");
    assert_eq!(
        document["language"],
        json!("purescript"),
        "the catalogue says whose spellings it carries"
    );

    let optional_arguments: usize = document["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|entry| entry["signatures"].as_array().into_iter().flatten())
        .flat_map(|signature| signature["parameters"].as_array().into_iter().flatten())
        .filter(|parameter| parameter["optional"] == json!(true))
        .count();
    assert_eq!(
        optional_arguments, 0,
        "an optional argument here is a field of a record argument, never an argument"
    );

    let optional: usize = document["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|entry| entry["signatures"].as_array().into_iter().flatten())
        .flat_map(|signature| signature["parameters"].as_array().into_iter().flatten())
        .flat_map(|parameter| parameter["fields"].as_array().into_iter().flatten())
        .filter(|field| field["optional"] == json!(true))
        .count();
    assert_eq!(optional, 31, "the optional record fields the tools declare");
}

#[test]
fn every_type_and_function_the_catalogue_declares_is_a_name_a_program_can_write() {
    // The half of the catalogue's honesty no cross-language comparison can see: that the surface it
    // *describes* is the surface a program really has. A signature reflected out of a source file
    // that was never compiled into the shipped tree would read perfectly and name a call that is not
    // there — which for this arm is the failure mode that matters, since the tree a program compiles
    // against is a committed artifact rather than the working directory.
    let catalogue: Value =
        serde_json::from_str(SIGNATURES).expect("the committed PureScript catalogue is valid JSON");

    // Every TYPE it declares, as a type synonym a program writes: a name `import Gg` does not bring
    // into scope is a compile error rather than a sentence a model acts on and cannot.
    let aliases: String = catalogue["types"]
        .as_array()
        .expect("an array")
        .iter()
        .enumerate()
        .map(|(index, declaration)| {
            format!(
                "type Check{index} = {}\n",
                declaration["name"].as_str().expect("a name")
            )
        })
        .collect();
    let outcome = run(&format!(
        "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         {aliases}\n\
         main :: Effect Unit\n\
         main = pure unit\n"
    ));
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "{:?}",
        outcome.result
    );

    // And every FUNCTION it describes is a field of the object it claims, checked at the type level
    // so that nothing has to be called: `{ readFile :: t | r }` accepts any record that has the
    // field, whatever its type, which is how a row-typed language asks "is this name there?".
    let functions: Vec<(String, String)> = ["session", "views", "programs", "tools", "helpers"]
        .iter()
        .flat_map(|section| catalogue[section].as_array().expect("an array"))
        .map(|entry| {
            (
                entry["object"].as_str().expect("an object").to_string(),
                entry["name"].as_str().expect("a name").to_string(),
            )
        })
        .chain(
            // The meta function is bound on every object rather than declared on one, so it is
            // checked against each object the catalogue describes.
            catalogue["objects"]
                .as_array()
                .expect("an array")
                .iter()
                .flat_map(|object| {
                    catalogue["meta"]
                        .as_array()
                        .expect("an array")
                        .iter()
                        .map(|entry| {
                            (
                                object["object"].as_str().expect("a name").to_string(),
                                entry["name"].as_str().expect("a name").to_string(),
                            )
                        })
                }),
        )
        .collect();
    let checks: String = functions
        .iter()
        .enumerate()
        .map(|(index, (_object, name))| {
            format!(
                "has{index} :: forall t r. {{ {name} :: t | r }} -> Unit\n\
                 has{index} _ = unit\n\
                 \n"
            )
        })
        .collect();
    let uses: String = functions
        .iter()
        .enumerate()
        .map(|(index, (object, _))| format!("  let _ = has{index} {object}\n"))
        .collect();
    let outcome = run(&format!(
        "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         {checks}main :: Effect Unit\n\
         main = do\n{uses}  pure unit\n"
    ));
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "{:?}",
        outcome.result
    );
}
