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
//! # Why nothing here calls a gg tool
//!
//! Because there is no PureScript SDK yet, and that is this arm's landing order rather than an
//! oversight. Where [Ruby](super::super::ruby)'s substrate could reach a JavaScript binding through
//! Opal's inline-JavaScript interop, PureScript has no such thing: its foreign function interface is
//! a `.js` file **beside the module**, and the file that will carry gg's bindings is the SDK's. So
//! what is provable now is everything up to that file — that a whole PureScript program compiles,
//! bundles, instantiates and runs; that what it says reaches the host through the real membrane's
//! `feedback` interface; that an uncaught failure is reported rather than trapping; that a code
//! module becomes a namespace at `lib.<key>`; and that all of it stays isolated at sixteen-way
//! concurrency. The crossing into [`ToolApi`](crate::sandbox::ToolApi) is the SDK commit's, and it is
//! one hand-written `foreign import` away.
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

use serde_json::Value;
use wasmtime::component::Component;

use super::super::typescript;
use super::compile::{compile_module, compile_program};
use crate::sandbox::fake::{
    CallLog, FakeToolApi, canned_outcome, typescript as typescript_language,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, SandboxError, SandboxOutcome};
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
/// A plain `OnceLock` rather than the production per-language cache because that cache is indexed by
/// the wire id this language does not have yet.
fn component() -> &'static Component {
    static COMPILED: OnceLock<Component> = OnceLock::new();
    COMPILED.get_or_init(|| {
        engine::compile_bytes(typescript::COMPONENT).expect("the shared ECMAScript guest compiles")
    })
}

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
fn prepare(source: &str) -> String {
    match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
    }
}

/// Evaluate already-compiled JavaScript through the real membrane, with `enabled`'s gg tools offered
/// and `modules` bound at `lib.<name>`.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the per-language component cache.
///
/// The [membrane state](MembraneState) is built with **TypeScript** as its language, and that is
/// sound rather than sloppy: a language is held there to spell a call's name back at the model
/// inside a refusal, and this arm's SDK — the thing that would give those names a PureScript
/// spelling — is the next commit's. Nothing below reads a spelling.
fn evaluate(
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
        MembraneState::new(api, typescript_language(), scope, limits, None),
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
            RunEnding::None.into(),
            false,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let (outcome, _api) = reclaim(store, returned, None, None, None);
    (outcome, log)
}

/// Compile and run one PureScript program with no gg tool offered — the shape every case here wants,
/// because this arm has no SDK to reach one with yet.
fn run(source: &str) -> SandboxOutcome {
    evaluate(&prepare(source), &[], &[], canned_outcome).0
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

    // The program reaches into it through the guest's `lib` object, which is JavaScript — so this is
    // the one place a PureScript program has to speak JavaScript until the SDK gives it a way not
    // to. It is a `foreign import` in the SDK's world; here it is the shape of the thing being
    // proven, which is that the namespace really is bound and really holds the module's exports.
    let outcome = evaluate(
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
            logs(&evaluate(source, &[], &[], canned_outcome).0),
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
            logs(&evaluate(&purescript, &[], &[], canned_outcome).0),
            ["5050"]
        );
        compiled += started.elapsed();

        let started = Instant::now();
        assert_eq!(
            logs(&evaluate(javascript, &[], &[], canned_outcome).0),
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
        logs(&evaluate(&program, &[], &[], canned_outcome).0),
        ["shared"]
    );
    assert_eq!(
        logs(&evaluate("console.log('shared');", &[], &[], canned_outcome).0),
        ["shared"]
    );
}

#[test]
fn sixteen_concurrent_preparations_each_get_their_own_program() {
    // The gate this arm exists to pass. `purs` is one of the two toolchains the feasibility study
    // measured SILENT corruption on: eight concurrent compiles into one shared output tree produced
    // a single `output/Main/index.js` holding two agents' programs interleaved, three times out of
    // three, with every process exiting zero.
    //
    // This drives the seam's own isolation harness — the same one every registered language is held
    // to, generic over a preparation precisely so an unregistered arm can be held to it too — at its
    // full sixteen-way width, over both halves. It is not a copy of that gate; it is that gate,
    // pointed here.
    for preparation in [
        &PureScriptPreparation::Program as &dyn super::super::isolation::Preparation,
        &PureScriptPreparation::Module,
    ] {
        let breaches = super::super::isolation::breaches(preparation);
        assert!(
            breaches.is_empty(),
            "{} is not isolated: {}",
            preparation.describe(),
            breaches
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        );
    }
}

/// One half of this arm's preparation, as the [isolation harness](super::super::isolation) drives it.
///
/// A local implementation rather than an entry in that harness's own list because this language is
/// not registered — `preparations()` is derived from the registry, so this arm joins it for free the
/// day it has a trait implementation, and until then it is held to the same standard from here.
enum PureScriptPreparation {
    /// A model's reply.
    Program,
    /// A code skill's or memory's module.
    Module,
}

impl super::super::isolation::Preparation for PureScriptPreparation {
    fn describe(&self) -> String {
        match self {
            Self::Program => "PureScript program".to_string(),
            Self::Module => "PureScript module".to_string(),
        }
    }

    /// A source carrying `marker` inside a **string literal that a call consumes**, so that neither
    /// `purs`'s own dead-code analysis nor `esbuild`'s tree shaking can drop it: it is an argument to
    /// the one effect the program performs, or the value the module's one export returns.
    fn source(&self, marker: &str) -> String {
        match self {
            Self::Program => format!(
                "module Main where\n\
                 import Prelude\n\
                 import Effect (Effect)\n\
                 import Effect.Class.Console as Console\n\
                 \n\
                 main :: Effect Unit\n\
                 main = Console.log \"/gg/isolation/{marker}.txt\"\n"
            ),
            Self::Module => format!(
                "module Helpers (marker) where\n\
                 \n\
                 marker :: String\n\
                 marker = \"/gg/isolation/{marker}.txt\"\n"
            ),
        }
    }

    fn prepare(&self, source: &str, context: &PrepareContext) -> Result<String, String> {
        match self {
            Self::Program => compile_program(source, context).map(|prepared| prepared.source),
            Self::Module => compile_module(source, context),
        }
        .map_err(|failure| failure.to_string())
    }
}
