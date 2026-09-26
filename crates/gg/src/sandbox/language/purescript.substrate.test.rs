//! **The PureScript arm's execution substrate** — the real `purs`, the real `esbuild` and the real
//! guest, driven end to end: PureScript the way a model would write it, really compiled by the
//! toolchain in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as PureScript, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, spawning the
//! production compiler in a [`PrepareContext`](crate::sandbox::PrepareContext) the sandbox mints —
//! and the JavaScript that comes back is driven through
//! [`run_prepared_program`](crate::sandbox::run_prepared_program) — the production entry point for a
//! program whose preparation already happened, with the production linker, the production ceilings,
//! the real membrane and the real source-map reading.
//!
//! # How a call gets from PureScript to gg
//!
//! Through the SDK, and through nothing else. `packages/gg-sandbox-purescript/src/Gg/**` is compiled
//! into the same library tree a program is compiled against, so `import Gg.Files as Gg.Files` is an
//! ordinary import resolved by `purs`; its one foreign module writes `import * as gg from "gg"`,
//! which `esbuild` leaves external and the guest's loader resolves to the instance a TypeScript
//! program shares. That is what [`every_operation_crosses_the_membrane_from_its_purescript_spelling`]
//! drives: real PureScript, really compiled, whose calls arrive at gg's dispatch carrying the same
//! JSON every other arm's do.
//!
//! # How these tests are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, so each obtains the ECMAScript
//! guest once, and every program in it costs a real `purs` and `esbuild`. A function groups the
//! programs that exercise one behaviour, so they share that cost; one that grows into the slow
//! end of the suite is split rather than extended.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use serde_json::{Value, json};

use test_cabinet_core::gg::{CAPABILITY_DOCVIEW_CLOSE, GgProgramLanguage};

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;

use super::compile::{self, compile_module, compile_program};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, all_operations_without,
    canned_outcome, granted_operations,
};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::outcome::SandboxOutcome;
use crate::sandbox::{
    CodeModule, PrepareContext, PrepareError, PrepareFailure, PreparedProgram, ProgramScope,
    SandboxLimits, capability_operations, run_prepared_program,
};
use crate::tools::{ToolFailure, ToolOutcome};

/// This arm, resolved through the registry it is now in.
pub(super) fn purescript() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::PureScript)
}

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
pub(super) fn prepare(source: &str) -> String {
    prepare_with(source, &[])
}

/// The same, for a turn carrying code modules — which the entry module gg generates imports.
pub(super) fn prepare_with(source: &str, modules: &[CodeModule]) -> String {
    match compile_program(source, modules, &PrepareContext::detached()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
    }
}

/// Evaluate already-compiled JavaScript through the real membrane, granting `operations`,
/// `modules` bound at `lib.<name>`, and the ending group `ending`'s role produces.
///
/// [`run_prepared_program`](crate::sandbox::run_prepared_program) — the production entry point for a
/// program whose preparation already happened — so the component cache, the linker, the ceilings,
/// the membrane and the source-map reading are all the ones a turn gets.
fn evaluate(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let operations = granted_operations(operations, library);
    let (outcome, _api) = run_prepared_program(
        purescript(),
        PreparedProgram {
            source: program.to_string(),
            component: None,
        },
        ProgramScope {
            capabilities: &all_capabilities(),
            operations: &operations,
            modules,
            ending,
        },
        SandboxLimits::AMPLE,
        None,
        FakeOperationApi::with(&log, responder),
    );
    (outcome, log)
}

/// Evaluate already-compiled JavaScript with nothing else configured — a program the compiler has
/// already been through, or a line of JavaScript standing in for one.
pub(super) fn evaluate_js(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        program,
        operations,
        modules,
        RunEnding::None,
        false,
        responder,
    )
}

/// Compile and run one PureScript program, with everything about the run said explicitly.
pub(super) fn run_as(
    source: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate(
        &prepare_with(source, modules),
        operations,
        modules,
        ending,
        library,
        responder,
    )
}

/// Compile and run one PureScript program with `enabled`'s operations offered and no ending group.
pub(super) fn run_with(
    source: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(
        source,
        operations,
        modules,
        RunEnding::None,
        false,
        responder,
    )
}

/// Compile and run one PureScript program with no gg tool offered — the shape most cases here want.
pub(super) fn run(source: &str) -> SandboxOutcome {
    run_with(source, &[], &[], canned_outcome).0
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

/// **What the model reads when a program died**: the engine's own rendering of the failure, which
/// the guest reported over `feedback.report-error`.
///
/// Nothing catches a throw on this arm — capture rather than interception — but the guest observes
/// the uncaught value at its own entry point and reports it, so the failure is a `ProgramError`
/// carrying the language's words rather than a store-killing trap.
pub(super) fn trapped(outcome: &SandboxOutcome) -> String {
    match &outcome.result {
        Err(error) => panic!("the store died instead of the guest reporting: {error:?}"),
        Ok(result) => match &result.error {
            Some(error) => error.message.clone(),
            None => panic!(
                "the program did not fail; it logged {:?} and reported nothing",
                outcome.logs
            ),
        },
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

    // A reply whose comments and whose module name are not ASCII compiles and runs. `purs` reads a
    // proper name over the whole of Unicode and files the emitted JavaScript under it, and the entry
    // point gg generates names the module directory the compiler wrote rather than a name gg
    // scanned out of the reply.
    let outcome = run(r#"{- Snake — a naïve grid. Ship it 🚀 -}
module Ünicode where

import Prelude
import Effect (Effect)
import Effect.Class.Console as Console

label :: String
label = "café ☕"

main :: Effect Unit
main = Console.log label
"#);
    assert_eq!(logs(&outcome), ["café ☕"]);

    // Two responses of one agent under one module name — what a model that calls every program
    // `Main` produces. The compiler's output directory survives the reset between the two
    // preparations, so each turn has to run the build its own preparation made.
    let agent = crate::sandbox::AgentWorkspace::new();
    let turn = |line: &str| {
        let context = PrepareContext::for_agent(&agent, purescript().persistent_work());
        let source = format!(
            "module Solve where\n\
             \n\
             import Prelude\n\
             import Effect (Effect)\n\
             import Effect.Class.Console as Console\n\
             \n\
             main :: Effect Unit\n\
             main = Console.log \"{line}\"\n",
        );
        match compile_program(&source, &[], &context) {
            Ok(prepared) => prepared.source,
            Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
        }
    };
    let first = turn("first");
    let second = turn("second");
    let outcome = evaluate_js(&first, &[], &[], canned_outcome).0;
    assert_eq!(logs(&outcome), ["first"]);
    let outcome = evaluate_js(&second, &[], &[], canned_outcome).0;
    assert_eq!(logs(&outcome), ["second"]);
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
    let reported = trapped(&outcome);
    assert!(
        reported.contains("Error: the spec file was not where I expected")
            && reported.contains("program.purs:"),
        "the model reads what it threw, in its own file: {reported}"
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
        trapped(&outcome).contains("no branch matched"),
        "{}",
        trapped(&outcome)
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
fn a_located_failure_names_the_model_s_own_purescript() {
    // The headline of this arm's conversion. What the engine reports is a frame in the BUNDLE — one
    // flattened file made of the model's program, this arm's SDK and every library either reached —
    // and every one of those frames is read back through the map `purs` and `esbuild` composed, so a
    // frame in the model's own PureScript names the model's own file and line, and a frame in a
    // library names that library's own module.
    let outcome = run("module Solve where\n\
         \n\
         import Prelude\n\
         \n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         import Effect.Exception (throw)\n\
         \n\
         boom :: String -> Effect Unit\n\
         boom label = void (throw (\"bang: \" <> label))\n\
         \n\
         main :: Effect Unit\n\
         main = do\n\
         \x20 Console.log \"starting\"\n\
         \x20 boom \"here\"\n");
    let reported = trapped(&outcome);
    // The call site, exactly: line 15 is `  boom "here"` and column 3 is `boom`. The frame above it
    // is line 10, the throwing definition — at the innermost token the map has on that line rather
    // than at the `throw`, which is what a compiler's map resolves a compound expression to.
    assert!(
        reported.contains("at __do (program.purs:15:3)"),
        "the call site is the model's own file at the column it wrote the call in: {reported}"
    );
    assert!(
        reported.contains("at boom (program.purs:10:"),
        "and the frame above it is the line the throw is on: {reported}"
    );
    assert!(
        reported.contains("/src/Effect/Exception.purs:"),
        "and a frame in a library names that library's own module: {reported}"
    );
    // The two names a frame the model cannot open would carry, and the reason this assertion is
    // written against these two rather than against the bundle's own file name: the bundle is
    // `bundle.js` on the HOST, and the guest declares it under `ecmascript::PROGRAM`, so
    // `bundle.js` is a string no frame can ever contain and asserting its absence would assert
    // nothing. `program.js` is a position in the flattened bundle the composed map resolved
    // nothing for; `entry.js` is the module gg generates to point the bundler at `main`.
    for invented in [super::super::ecmascript::PROGRAM, compile::ENTRY_FILE] {
        assert!(
            !reported.contains(invented),
            "nothing the model reads names `{invented}`, which is a file it did not write: \
             {reported}"
        );
    }
    assert!(
        reported.contains("… and 1 more frame (external code)"),
        "and the one frame that was struck is counted rather than silently dropped: {reported}"
    );

    // A gg call the host fails, through the real membrane and through this arm's own SDK. The SDK is
    // compiled into the same bundle the program is, so the crossing's frame resolves to one of the
    // SDK's own sources and is struck; and the crossing costs ONE engine frame, which is what leaves
    // the model's own frame inside the guest's ten-frame capture. Both halves are asserted here,
    // because either one alone leaves the model reading a count and nothing else.
    let (outcome, _log) = run_with(
        "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         import Gg.Files as Gg.Files\n\
         \n\
         main :: Effect Unit\n\
         main = do\n\
         \x20 Console.log \"starting\"\n\
         \x20 _ <- Gg.Files.readFile \"missing.md\" {}\n\
         \x20 Console.log \"read it\"\n",
        &all_operations(),
        &[],
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "no such file: missing.md".to_string(),
            )
        },
    );
    let reported = trapped(&outcome);
    assert!(
        reported.contains("at __do (program.purs:12:"),
        "a failed gg call names the model's own line, on a call whose result the SDK converts: \
         {reported}"
    );
    for sdk in ["output/Gg.", "libs/gg-sdk/"] {
        assert!(
            !reported.contains(sdk),
            "and no frame in gg's own SDK is reported under `{sdk}`: {reported}"
        );
    }
    assert!(
        reported.contains("more frames (external code)"),
        "and what was struck is counted: {reported}"
    );
    // The crossing itself, measured rather than inferred. A conversion mapped over the effect
    // instead of carried across the bridge lands in `Effect`'s own foreign module: `map` for
    // `Effect` is `liftA1`, so one lift is two `bindE` applications and costs four of the ten frames
    // the engine captures, which is how the model's own frame came to be pushed off the end of a
    // report that was otherwise entirely correct.
    assert!(
        !reported.contains("output/Effect/foreign.js"),
        "and the crossing spends one engine frame rather than lifting over the effect: {reported}"
    );

    // The same, for a call whose answer is nothing worth having: it crosses the bridge by the same
    // one frame, and nothing else in the tree drives that half of it.
    let (outcome, _log) = run_with(
        "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         import Gg.Files as Gg.Files\n\
         \n\
         main :: Effect Unit\n\
         main = do\n\
         \x20 Console.log \"starting\"\n\
         \x20 Gg.Files.editFile \"notes.md\" \"before\" \"after\"\n\
         \x20 Console.log \"edited\"\n",
        &all_operations(),
        &[],
        |_name: &str, _args: &Value| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                "that text is not in notes.md".to_string(),
            )
        },
    );
    let reported = trapped(&outcome);
    assert!(
        reported.contains("at __do (program.purs:12:"),
        "a failed gg call that answers with nothing names the model's own line too: {reported}"
    );
    assert!(
        !reported.contains("output/Effect/foreign.js"),
        "and it spends one engine frame too: {reported}"
    );
    for sdk in ["output/Gg.", "libs/gg-sdk/"] {
        assert!(
            !reported.contains(sdk),
            "and no frame in gg's own SDK is reported under `{sdk}`: {reported}"
        );
    }
}

#[test]
fn a_code_module_is_a_purescript_module_the_program_imports() {
    // What a code skill or a code memory written in PureScript is: an ordinary module, compiled into
    // the same `purs` project as the program that uses it. Its functions are curried — that is what
    // a PureScript function IS — so a program reaches them the way PureScript reaches anything.
    const HELPERS: &str = "module Helpers (greet, add) where\n\
                           import Prelude\n\
                           \n\
                           greet :: String -> String\n\
                           greet who = \"hello, \" <> who\n\
                           \n\
                           add :: Int -> Int -> Int\n\
                           add left right = left + right\n";

    // The use that loaded it compiled it on its own, under the key it was bound at; what travels to
    // the program is the author's source.
    compile_module("Helpers", HELPERS, &PrepareContext::detached())
        .expect("purs compiles a code module");
    let modules = [CodeModule {
        name: "Helpers".to_string(),
        source: HELPERS.to_string(),
    }];

    // The program writes the import line, names the alias, and `purs` checks every call against the
    // author's own signature — no annotation, no lookup by string, nothing this arm invented.
    let outcome = run_with(
        &program_of(&[
            "Console.log (Helpers.greet \"gg\")",
            "Console.log (show (Helpers.add 40 2))",
        ])
        .replace(
            "import Effect (Effect)\n",
            "import Effect (Effect)\n\
             import Effect.Class.Console as Console\n\
             import Lib.Helpers as Helpers\n",
        ),
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["hello, gg", "42"]);

    // A program that does not write the import line does not compile, however loaded the module is:
    // the module is a library, and a library is reached through a line the program wrote.
    let failure = compile_program(
        &program_of(&["Console.log (Helpers.greet \"gg\")"]).replace(
            "import Effect (Effect)\n",
            "import Effect (Effect)\nimport Effect.Class.Console as Console\n",
        ),
        &modules,
        &PrepareContext::detached(),
    )
    .expect_err("a program that never imported the module");
    assert!(
        matches!(
            &failure,
            PrepareFailure::Program(PrepareError::Compile(message))
                if message.contains("UnknownName")
        ),
        "{failure:?}"
    );

    // A module whose PureScript does not compile is refused by the prepare step, with the author's
    // own coordinates — it never reaches a program at all.
    let failure = compile_module(
        "Helpers",
        "module Helpers where\ngreet = ((\n",
        &PrepareContext::detached(),
    )
    .expect_err("a broken module is refused");
    assert!(
        failure.to_string().contains("Lib.Helpers.purs:"),
        "located in the author's own file: {failure}"
    );
}

/// **The prepared program is the model's bytes**, module in scope or not.
///
/// The [authorship rule](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) is about the
/// program rather than only about the compile: a turn carrying a code module compiles the same text
/// it would have compiled without one, and what the module cost the program is the one `import` line
/// the model wrote for it.
#[test]
fn a_module_in_scope_changes_nothing_about_the_program_gg_compiles() {
    const HELPERS: &str = "module Helpers (greet) where\n\
                           import Prelude\n\
                           \n\
                           greet :: String -> String\n\
                           greet who = \"hello, \" <> who\n";
    let source = "module Main where\n\
                  \n\
                  import Prelude\n\
                  import Effect (Effect)\n\
                  import Effect.Class.Console as Console\n\
                  import Lib.Helpers as Helpers\n\
                  \n\
                  main :: Effect Unit\n\
                  main = Console.log (Helpers.greet \"gg\")\n";
    let modules = [CodeModule {
        name: "Helpers".to_string(),
        source: HELPERS.to_string(),
    }];

    // What the seam handed the arm is what the arm wrote into the file `purs` read: the source is
    // never edited, prefixed or appended to.
    let context = PrepareContext::detached();
    compile_program(source, &modules, &context).expect("it compiles");
    let compiled = std::fs::read_to_string(
        context
            .workspace()
            .expect("the preparation took a workspace")
            .work()
            .join(compile::PROGRAM_FILE),
    )
    .expect("the program gg compiled");
    assert_eq!(compiled, source, "gg compiled bytes the model did not send");
}

#[test]
fn what_a_compiled_program_weighs_and_what_a_turn_pays_for_it() {
    // The half of this arm's cost that is NOT the compiler. A compiled PureScript program is
    // self-contained JavaScript with no runtime to boot: `purs` compiles the program's own code and
    // the library code it actually used, and `esbuild` tree-shakes the rest away. That is the whole
    // argument for sharing the ECMAScript guest with the TypeScript and JavaScript arms, and the
    // regression it is set against is the one the Ruby arm names — Opal's 743 KB runtime prepended
    // to every program, paid again on every turn.
    //
    // It is asserted BY WEIGHT, and the stopwatch beside it is printed rather than asserted. An
    // earlier draft did the reverse: it timed a turn on each artifact and asserted their ratio
    // against a bound of 5, reasoning that dividing one reading by the other cancelled the machine
    // out. It flaked, for two reasons that compounded.
    //
    // The headroom was never there. The ~2.7 ms against ~2.1 ms that draft quoted — a ratio near
    // 1.3, which a bound of 5 clears four times over — are not this arm's figures at all: they are
    // the Ruby arm's, as `languages/ruby.md` still quotes them. Measured here, a turn on the
    // program below costs 9.2 ms against the control's 2.9 ms, because 164 KB of bundle has to be
    // parsed where the control has 88 bytes. The true ratio is ~3, so the bound stood at 1.5x a
    // healthy reading rather than 4x.
    //
    // And the ratio does not cancel the machine out. That would need both readings to inflate
    // proportionally, which needs them to be the same size, and they differ by 3x; a scheduler
    // stall is a fixed number of milliseconds wherever it lands, so it moves the quotient. Summing
    // the runs rather than taking the minimum then kept every stall rather than discarding it.
    // Reproduced by loading the machine the way a workspace run does — twenty-four busy loops and
    // eighteen concurrent copies of this test — and reading the ratio 54 times: it ran 2.53 to
    // 6.16 and crossed the bound of 5 in four of the 54, one run in thirteen. That is the MINIMUM,
    // which is the kinder of the two readings; the draft asserted the sum.
    //
    // The Rust arm already ruled on this in `what_a_program_costs_and_what_it_weighs` — a shared
    // machine is the wrong place to fail over a stopwatch — and the weight is the better witness
    // anyway, because it is hermetic. The bytes below came back identical from repeated compiles,
    // so what moves them is the toolchain or the SDK changing, which is the thing worth being told
    // about, and never the load average.
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
    // The same answer with `Data.Array` and `Data.Foldable` given up: what separates the two
    // bundles is exactly the library code the first one used and the second did not.
    let frugal = prepare(
        "module Main where\n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log \"5050\"\n",
    );
    let javascript = "let total = 0; for (let n = 1; n <= 100; n += 1) total += n; \
                      console.log(String(total));";

    // A band wide enough that only a change in KIND fails it, in the Rust arm's sense. Measured
    // here: 164,458 bytes for the program above and 37,564 for the frugal one, against a library
    // tree that is 1.4 MB unpacked — so a bundle that stopped being tree-shaken at all has nowhere
    // to land inside the ceiling.
    for (what, program) in [
        ("the program", &purescript),
        ("the frugal program", &frugal),
    ] {
        assert!(
            (8 * 1024..=1024 * 1024).contains(&program.len()),
            "{what} compiles to {} bytes, outside the documented 8 KiB-1 MiB band — esbuild \
             stopped tree-shaking, or a runtime is being prepended per program",
            program.len()
        );
    }
    // And the assertion the band cannot make on its own: that what a program imports really does
    // decide what it weighs. Prepend a fixed runtime to both and this collapses towards 1, however
    // the band lands. Measured at 4.4x; asserted at 2x.
    assert!(
        frugal.len() * 2 < purescript.len(),
        "a program using `Data.Array` and `Data.Foldable` weighs {} bytes against {} for one using \
         neither — too close for the difference to be the library code each used, which is what \
         tree-shaking having stopped looks like",
        purescript.len(),
        frugal.len(),
    );

    // Warm: the first evaluation in a process pays for the engine's lazy work, not for a program.
    for source in [purescript.as_str(), javascript] {
        assert_eq!(
            logs(&evaluate_js(source, &[], &[], canned_outcome).0),
            ["5050"]
        );
    }

    // Printed rather than asserted, because it is the arm's cost rather than its correctness, and a
    // timing is a reading of the machine as much as of the arm. Interleaved so the two share one
    // window of whatever else the machine is doing, and taken as the MINIMUM rather than the sum,
    // which is the least-contaminated sample rather than the one carrying every stall. `cargo
    // nextest run --no-capture` shows it.
    let mut compiled = std::time::Duration::MAX;
    let mut plain = std::time::Duration::MAX;
    for _ in 0..5 {
        let started = Instant::now();
        let outcome = evaluate_js(&purescript, &[], &[], canned_outcome).0;
        compiled = compiled.min(started.elapsed());
        assert_eq!(logs(&outcome), ["5050"]);

        let started = Instant::now();
        let outcome = evaluate_js(javascript, &[], &[], canned_outcome).0;
        plain = plain.min(started.elapsed());
        assert_eq!(
            logs(&outcome),
            ["5050"],
            "the control has to be the same turn, not a different one"
        );
    }
    println!(
        "a turn on {} bytes of compiled PureScript {compiled:?}; on plain JavaScript {plain:?}",
        purescript.len(),
    );
}

/// **A compiled PureScript program needs nothing of this guest that plain JavaScript does not.**
///
/// The property behind the arm's whole guest decision: `purs` compiles a program's own code and the
/// library code it used into the bundle, and `esbuild` tree-shakes the rest away, so what arrives is
/// self-contained JavaScript with no runtime to boot. Both halves below run on the SAME compiled
/// `Component`, which is what says it rather than two artifacts that happen to behave alike.
#[test]
fn a_compiled_program_needs_nothing_of_the_guest_plain_javascript_does_not() {
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

/// One operation, called through the PureScript spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The statement, exactly as a model would write it inside a `do` block.
    statement: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound operation, called through its idiomatic PureScript function.
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
            statement: "_ <- Gg.Shell.shell \"npm test\" { timeoutSecs: 30 }",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            statement: "_ <- Gg.Files.readFile \"src/a.purs\" { offset: 2, limit: 5 }",
            expected: || json!({ "path": "src/a.purs", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            statement: "_ <- Gg.Files.writeFile \"out.txt\" \"hello\"",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            statement: "_ <- Gg.Files.editFile \"src/a.purs\" \"alpha\" \"beta\"",
            expected: || json!({ "path": "src/a.purs", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            statement: "_ <- Gg.Files.listDir { path: \"src\" }",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            statement: "_ <- Gg.Files.tree { path: \"src\", depth: 3 }",
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            statement: "_ <- Gg.Files.search \"answer\" { path: \"src\", limit: 10 }",
            expected: || json!({ "query": "answer", "path": "src", "limit": 10 }),
        },
        Crossing {
            tool: "read_skill",
            statement: "_ <- Gg.Skills.readSkill \"testing\"",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            statement: "_ <- Gg.Memories.writeMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            expected: || json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "update_memory",
            statement: "_ <- Gg.Memories.updateMemory { name: \"layout\", description: \"d2\", body: \"b2\" }",
            expected: || json!({ "name": "layout", "description": "d2", "body": "b2", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "create_memory",
            statement: "_ <- Gg.Memories.createMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            expected: || json!({ "name": "layout", "description": "d", "contents": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "read_memory",
            statement: "_ <- Gg.Memories.readMemory \"layout\"",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            statement: "_ <- Gg.Memories.editMemory { name: \"layout\", search: \"old\", replace: \"new\" }",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            statement: "_ <- Gg.Memories.searchMemories [ \"cargo\", \"nextest\" ]",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            statement: "_ <- Gg.Memories.deleteMemory \"layout\"",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            statement: "_ <- Gg.Tasks.addTask { id: \"t1\", title: \"T\", description: \"D\", blockedBy: [ \"t0\" ] }",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            statement: "_ <- Gg.Tasks.updateTask \"t1\" { title: \"T2\", description: Nothing, status: Gg.Tasks.TaskInProgress }",
            expected: || {
                // `description: Nothing` is what CLEARS it — the field left out of the record is the
                // one that keeps it — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            statement: "_ <- Gg.Tasks.setBlockedBy \"t1\" []",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            statement: "_ <- Gg.Tasks.completeTask \"t1\"",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            statement: "_ <- Gg.Tasks.removeTask \"t1\"",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            statement: "_ <- Gg.Board.createEpic { prefix: \"epc\", title: \"E\", description: \"D\" }",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            statement: "_ <- Gg.Board.createIssue { title: \"I\", inScope: \"s\", outOfScope: \"o\", \
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
            statement: "_ <- Gg.Board.updateIssue \"i1\" { status: Gg.Board.IssueDone, epicId: Nothing }",
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
            statement: "_ <- Gg.Board.setIssueBlockedBy \"i1\" [ \"i0\" ]",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            statement: "_ <- Gg.Board.removeEpic \"e1\"",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            statement: "_ <- Gg.Board.removeIssue \"i1\"",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            statement: "_ <- Gg.Board.waitForIssue \"i1\"",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            statement: "_ <- Gg.Context.evictFileView { path: \"src/a.purs\" }",
            expected: || json!({ "path": "src/a.purs" }),
        },
        Crossing {
            tool: "archive_thread",
            // A span of turns is a record with the two fields the header of every result carries,
            // which is what a span of integers is in a language with no range literal.
            statement: "_ <- Gg.Context.archiveThread [ { from: 4, to: 19 }, { from: 30, to: 35 } ]",
            expected: || json!({ "ranges": [[4, 19], [30, 35]] }),
        },
        Crossing {
            tool: "search_archive",
            statement: "_ <- Gg.Context.searchArchive \"the parser\"",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            statement: "_ <- Gg.Context.compact \"scaffolded the page\" { files: [ \"src/Main.purs\" ] }",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/Main.purs"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            // The brief is a constructor rather than one of two optional fields, so "both" and
            // "neither" are programs that do not compile.
            statement: "_ <- Gg.Delegation.spawnSubagent \"subagent\" (Gg.Delegation.Prompt \"write the lexer\")",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            statement: "_ <- Gg.Delegation.waitForSubagents { ids: [ \"agent-1\" ] }",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            statement: "_ <- Gg.Delegation.sendMessage \"agent-1\" \"prefer the simpler parser\"",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            statement: "_ <- Gg.Delegation.transitionState \"verify\" { note: \"the build is green\" }",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            statement: "_ <- Gg.Delegation.exec \"Builder\" { prompt: \"pick it up from here\" }",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            statement: "_ <- Gg.Delegation.fork \"try the other fix\"",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

/// One program made of `statements`, written the way a model writes one.
///
/// Every capability module is imported under its own full name, which is the line the catalogue's
/// own `import` field states and the only import under which `Gg.Files.readFile` resolves. Importing
/// all twelve rather than the ones a given program uses costs an unused-import warning and keeps the
/// statement tables below readable as the one thing they are about.
pub(super) fn program_of(statements: &[&str]) -> String {
    let imports: String = crate::sandbox::catalogue_modules(purescript())
        .iter()
        .map(|module| format!("import {0} as {0}\n", module.path))
        .collect();
    format!(
        "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Data.Maybe (Maybe(..))\n\
         import Effect (Effect)\n\
         {imports}\
         \n\
         main :: Effect Unit\n\
         main = do\n  {}\n  pure unit\n",
        statements.join("\n  ")
    )
}

/// [`program_of`], with the two imports a program that catches and prints needs already in it:
/// `Data.Either`, whose constructors a caught result is matched on, and `Effect.Class.Console`.
pub(super) fn logging_program_of(statements: &[&str]) -> String {
    program_of(statements).replace(
        "import Effect (Effect)\n",
        "import Effect (Effect)\nimport Data.Either (Either(..))\n\
         import Effect.Class.Console as Console\n",
    )
}

/// The statements that run `call` under `Gg.Core.attempt` and log what came back: the caught
/// `ApiError` as its code, its operation and its message, or `returned` on success.
pub(super) fn caught(call: &str) -> String {
    format!(
        "outcome <- Gg.Core.attempt ({call})\n  \
         case outcome of\n    \
         Left failure -> Console.log (show failure.code <> \" \" <> failure.operation <> \" \" <> failure.message)\n    \
         Right _ -> Console.log \"returned\""
    )
}

/// Compile and run `call` under [`caught`] with every operation offered, answered by `failure` and
/// `message` whatever was called, and hand back what the program logged.
fn caught_failure(call: &str, failure: ToolFailure, message: &str) -> Vec<String> {
    let message = message.to_string();
    let (outcome, _log) = run_with(
        &logging_program_of(&[&caught(call)]),
        &all_operations(),
        &[],
        move |_name: &str, _args: &Value| ToolOutcome::failed(failure, message.clone()),
    );
    logs(&outcome).to_vec()
}

/// Compile and run `statements` against [`canned_outcome`] with every operation offered, and hand
/// back what the program logged.
fn canned_logs(statements: &[&str]) -> Vec<String> {
    let (outcome, _log) = run_with(
        &logging_program_of(statements),
        &all_operations(),
        &[],
        canned_outcome,
    );
    logs(&outcome).to_vec()
}

#[test]
fn every_operation_crosses_the_membrane_from_its_purescript_spelling() {
    let crossings = crossings();

    // One program rather than one per crossing: each program is a `purs` compile, so thirty-five of
    // them would be thirty-five compiles for a table that reads the same. What is checked is
    // stronger for being one program — the calls must arrive in the order the program made them, so
    // a call that reached gg's dispatch under a NEIGHBOUR's name fails here as well.
    let statements: Vec<&str> = crossings
        .iter()
        .map(|crossing| crossing.statement)
        .collect();
    let (outcome, log) = run_with(
        &program_of(&statements),
        &all_operations(),
        &[],
        canned_outcome,
    );
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

    // Exhaustive by construction: an operation added to gg with no row here fails now, rather than shipping
    // as a typed function nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut vocabulary = crate::sandbox::signatures::sandbox_operation_names();
    vocabulary.sort_unstable();
    assert_eq!(
        covered, vocabulary,
        "every bound operation needs a crossing, and only bound operations may have one"
    );
}

/// **Every convenience function reaches the operation it says it is an alias of, keyed on the field
/// its subject really carries.**
///
/// This arm's four second ways in — `Gg.Board.waitFor`, `Gg.Memories.readHit`,
/// `Gg.Delegation.send` and `Gg.Programs.sourceOf` — are one line of body
/// each: they take a field off the record they are given and call the module-level function with
/// it. They are **free functions over a value** rather than methods on it, because a PureScript
/// record carries fields and no behaviour, and that is the equivalent shape rather than a shortfall.
///
/// That one line is what no other gate can see. The catalogue records which operation each is an
/// alias of, the [coverage gate](super::super::agreement) reads that record rather than the body,
/// and the type checker only proves the field exists — `child.slot` where the call wants `child.id`
/// compiles, documents and catalogues perfectly, and delivers every message to a child that does
/// not exist. So each is driven here from the value the operation that produces it really handed
/// back, in one program for the reason the crossing table above is one program.
#[test]
fn a_convenience_function_reaches_the_operation_it_is_an_alias_of() {
    let log = CallLog::default();
    // A library with something in it, which is what `Gg.Programs.sourceOf` needs a summary of; the
    // plain double answers an empty history, and an alias driven over an empty array proves nothing.
    let api =
        FakeOperationApi::new(&log).with_program("p2", 2, "module Main where\nmain = pure unit");
    let operations = all_operations();
    let program = prepare(
        &program_of(&[
            "issue <- Gg.Board.createIssue { title: \"Parse the manifest\", \
             inScope: \"the parser\", outOfScope: \"the writer\", \
             completionCriteria: \"tests pass\", agent: \"Builder\" }",
            "ack <- Gg.Board.waitFor issue",
            "Console.log (issue.id <> \" \" <> ack)",
            "hits <- Gg.Memories.searchMemories [ \"build\" ]",
            "bodies <- traverse Gg.Memories.readHit hits",
            "Console.log (show (map _.name hits) <> \" \" <> show bodies)",
            "child <- Gg.Delegation.spawnSubagent \"Builder\" \
             (Gg.Delegation.Prompt \"take the writer\")",
            "Gg.Delegation.send child \"prefer the simpler parser\"",
            "Console.log child.id",
            "Gg.Views.openText \"summary\" \"eight files, two failing\"",
            "closed <- Gg.Views.close \"summary\"",
            "Console.log (show closed)",
            "history <- Gg.Programs.history",
            "sources <- traverse Gg.Programs.sourceOf history",
            "Console.log (show (map _.id history) <> \" \" <> show sources)",
        ])
        .replace(
            "import Effect (Effect)\n",
            "import Effect (Effect)\nimport Data.Traversable (traverse)\n\
             import Effect.Class.Console as Console\n",
        ),
    );
    let (outcome, _api) = run_prepared_program(
        purescript(),
        PreparedProgram {
            source: program,
            component: None,
        },
        ProgramScope {
            capabilities: &all_capabilities(),
            operations: &operations,
            modules: &[],
            ending: RunEnding::None,
        },
        SandboxLimits::AMPLE,
        None,
        api,
    );
    assert_eq!(
        logs(&outcome),
        [
            "EPIC-1 wait registered",
            "[\"build-commands\"] [\"the memory contents\"]",
            "agent-1",
            // The one view open was the one its label named, and closing it took that view alone.
            "1",
            // The summary's id is what `sourceOf` fetched by, and the source is the one it names.
            "[\"p2\"] [\"module Main where\\nmain = pure unit\"]",
        ]
    );
    // Each of the three that is a gg tool reached dispatch under the operation it aliases, in the
    // order the program made the calls — and carrying its subject's own key, which is the half a
    // wrong field would fail.
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
    );
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
}

#[test]
fn the_views_docs_program_library_helper_and_endings_modules_are_reached_in_purescript_too() {
    // The families that are NOT gg tools, so none of them appears in the crossing table above — two
    // of them are where a program puts something in front of the model and one is how it finds
    // anything at all, which makes them the ones a silent bridging mistake would cost the most.
    // Between this, the crossing table and the alias case above it, every function this arm's
    // catalogue describes has been driven through the real membrane.
    let (outcome, log) = run_as(
        &program_of(&[
            "read <- Gg.Views.openFile \"notes.md\" { offset: 1, limit: 2 }",
            "Gg.Views.openText \"summary\" \"eight files, two failing\"",
            "Gg.Views.openDocsView \"readFile\"",
            "closed <- Gg.Views.close \"summary\"",
            "missing <- Gg.Views.close \"never opened\"",
            "Console.log (show closed <> \" \" <> show missing)",
            "case read of\n                 Gg.Files.TextFile file -> Console.log file.contents\n                 Gg.Files.ImageFile picture -> Console.log picture.label",
            "Gg.Session.finish \"read the file and showed myself the result\"",
        ])
        .replace(
            "import Effect (Effect)\n",
            "import Effect (Effect)\nimport Effect.Class.Console as Console\n",
        ),
        &all_operations(),
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    let lines = logs(&outcome);
    // Closing something that is not open is `0` rather than a failure, so a program that tidies up
    // unconditionally does not have to guard every call.
    assert_eq!(lines[0], "1 0");
    assert!(
        lines[1].starts_with("contents of notes.md"),
        "{:?}",
        lines[1]
    );
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

    // One read reached gg's dispatch and arrived as `read_file`: the one `Gg.Views.openFile`
    // performs. It has no tool name of its own, which is exactly the point — a view is a read
    // gg also shows you.
    assert_eq!(log.names(), ["read_file"]);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "notes.md", "offset": 1, "limit": 2 }))
    );

    // The program library is bound from the capability rather than from a tool name, and a reviewer
    // gets the other ending group and no `Gg.Session.finish` at all.
    let (outcome, _log) = run_as(
        &logging_program_of(&[
            "history <- Gg.Programs.history",
            "outcome <- Gg.Core.attempt (Gg.Programs.get \"k3p9\")",
            "Gg.Programs.rerun \"module Main where\\nimport Prelude\\nmain = pure unit\"",
            "Gg.Session.requestChanges [ \"widen the test\", \"name the file\" ]",
            "Console.log (show (map _.id history))",
            "case outcome of\n                 Left failure -> Console.log (show failure.code)\n                 Right source -> Console.log source",
        ]),
        &[],
        &[],
        RunEnding::Role(EndingRole::Review),
        true,
        canned_outcome,
    );
    // A session that has run nothing has an empty history — never an error — and an id it never
    // issued a program under is a `NotFound` the program catches in PureScript's own idiom.
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
        &program_of(&["Gg.Session.approve"]),
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

    // The documentation module, which is the loop the prompt describes made of real calls. `search`
    // is bound in every program whatever a run enables — so it is driven with **no** tool offered at
    // all — and `close`/`closeAll` are bought by a capability, so this store grants it and the run
    // after it does not. The double answers an empty page, which is the whole of what a double can
    // honestly say about a real index; what is proven is the crossing, the optional-argument record
    // carrying the whole call (whose `type` label is a reserved word this arm writes as a label
    // anyway), the array the module filter is, the constructor the kind filter lowers from, and the
    // view the host opens on the way back.
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log);
    // Searching is bound to every program; closing is bought, so this store grants the capability
    // that buys it and the calls that capability offers.
    let capabilities = vec![CAPABILITY_DOCVIEW_CLOSE.to_string()];
    let operations = capability_operations([CAPABILITY_DOCVIEW_CLOSE]);
    let searching = prepare(
        &program_of(&[
            "page <- Gg.Docs.search \
             { query: \"read\", modules: [ \"files\" ], type: \"FileRead\", \
             kind: Gg.Docs.FunctionEntry, limit: 5 }",
            "closed <- Gg.Docs.close \"Gg.Files.readFile\"",
            "emptied <- Gg.Docs.closeAll",
            "Console.log (show page.total <> \" \" <> show page.offset <> \" \" \
             <> show (map _.key page.hits))",
            "Console.log (show closed <> \" \" <> show emptied)",
        ])
        .replace(
            "import Effect (Effect)\n",
            "import Effect (Effect)\nimport Effect.Class.Console as Console\n",
        ),
    );
    let (outcome, _api) = run_prepared_program(
        purescript(),
        PreparedProgram {
            source: searching,
            component: None,
        },
        ProgramScope {
            capabilities: &capabilities,
            operations: &operations,
            modules: &[],
            ending: RunEnding::None,
        },
        SandboxLimits::AMPLE,
        None,
        api,
    );
    assert_eq!(logs(&outcome), ["0 0 []", "0 0"]);
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
    // module — the same shape every other bought call refuses in, and a value `attempt` narrows.
    let (outcome, _log) = run_with(
        &logging_program_of(&[
            "outcome <- Gg.Core.attempt Gg.Docs.closeAll",
            "case outcome of\n                 \
             Left failure -> Console.log (failure.operation <> \" \" <> show failure.code)\n                 \
             Right count -> Console.log (show count)",
        ]),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["close_all Unavailable"]);
}

#[test]
fn a_capability_this_run_withheld_is_refused_as_unavailable() {
    // The SDK exposes the whole surface — it is compiled once and a run's operations set is decided per
    // run — so what stops a withheld capability from being reachable is a refusal rather than a
    // missing name. It carries the code the HOST refuses an out-of-set call with, because gg
    // classifies a turn's error from the code: a capability nobody granted must not be recorded as a
    // name the model got wrong.
    let (outcome, log) = run_with(
        &program_of(&["_ <- Gg.Files.readFile \"src/Main.purs\" {}"]),
        &[],
        &[],
        canned_outcome,
    );
    let reported = trapped(&outcome);
    assert!(
        reported.contains("`Gg.Files.readFile` is not available"),
        "the refusal names the call the model wrote: {reported}"
    );
    assert!(
        reported.contains("code: \"unavailable\""),
        "under the code the host refuses an out-of-set call with: {reported}"
    );
    assert!(log.names().is_empty(), "and nothing reached gg's dispatch");

    // A failure the model can expect is caught in PureScript's own idiom and branched on by its
    // code, which is what `attempt` is for.
    let (outcome, _log) = run_with(
        &logging_program_of(&[
            "outcome <- Gg.Core.attempt (Gg.Files.readFile \"gone.purs\" {})",
            "case outcome of",
            "  Left failure -> Console.log (show failure.code <> \" on \" <> failure.operation)",
            "  Right _ -> Console.log \"read it\"",
        ]),
        &all_operations(),
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

/// The catalogue this arm's build reflects, read as a document rather than through the language, because what
/// is asserted below is a property of the emitted JSON's *shape*.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/purescript.signatures.json"
));

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
        serde_json::from_str(SIGNATURES).expect("the generated PureScript catalogue is valid JSON");
    assert_eq!(
        document["language"],
        json!("purescript"),
        "the catalogue says whose spellings it carries"
    );

    let parameters = || {
        document["functions"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|entry| entry["signatures"].as_array().into_iter().flatten())
            .flat_map(|signature| signature["parameters"].as_array().into_iter().flatten())
    };

    let optional_arguments: usize = parameters()
        .filter(|parameter| parameter["optional"] == json!(true))
        .count();
    assert_eq!(
        optional_arguments, 0,
        "an optional argument here is a field of a record argument, never an argument"
    );

    let optional: usize = parameters()
        .flat_map(|parameter| parameter["fields"].as_array().into_iter().flatten())
        .filter(|field| field["optional"] == json!(true))
        .count();
    assert_eq!(
        optional, 44,
        "the optional record fields the surface declares"
    );
}

#[test]
fn every_type_and_function_the_catalogue_declares_is_a_name_a_program_can_write() {
    // The half of the catalogue's honesty no cross-language comparison can see: that the surface it
    // *describes* is the surface a program really has. A signature reflected out of a source file
    // that was never compiled into the shipped tree would read perfectly and name a call that is not
    // there — which for this arm is the failure mode that matters, since the tree a program compiles
    // against is a built artifact rather than the working directory.
    //
    // It is asked as an **explicit import list** per module, which is the one question a program can
    // put to `purs` about a name without also having to solve its type: importing a name a module
    // does not export is `Cannot import value … from module …`, while every function here is
    // row-constrained and mentioning one in a value position would ask the compiler to solve
    // constraints this test is not about. The import list also checks the half that is new — that
    // the module a fully-qualified name claims is the module that really declares it — because an
    // import names both.
    let catalogue: Value =
        serde_json::from_str(SIGNATURES).expect("the generated PureScript catalogue is valid JSON");

    let mut wanted: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut capability_modules: BTreeSet<String> = BTreeSet::new();
    let path_of = |id: &str| -> String {
        catalogue["modules"]
            .as_array()
            .expect("an array")
            .iter()
            .find(|module| module["id"] == json!(id))
            .and_then(|module| module["path"].as_str())
            .expect("every entry is filed under a declared module")
            .to_string()
    };
    for entry in catalogue["functions"].as_array().expect("an array") {
        let module = path_of(entry["module"].as_str().expect("a module"));
        let name = entry["name"].as_str().expect("a name").to_string();
        // The name and the module are checked against each other as well as against the SDK: a
        // fully-qualified name is its module's path and then the name, and nothing else.
        assert_eq!(
            entry["fqn"].as_str().expect("a name"),
            format!("{module}.{name}"),
            "a catalogued name is not its own module's path followed by its own name"
        );
        capability_modules.insert(module.clone());
        wanted.entry(module).or_default().insert(name);
    }
    for declaration in catalogue["types"].as_array().expect("an array") {
        let module = path_of(declaration["module"].as_str().expect("a module"));
        let name = declaration["name"].as_str().expect("a name").to_string();
        assert_eq!(
            declaration["fqn"].as_str().expect("a name"),
            format!("{module}.{name}"),
        );
        wanted.entry(module).or_default().insert(name);
    }
    let imports: String = wanted
        .iter()
        .map(|(module, names)| {
            format!(
                "import {module} ({})\n",
                names.iter().cloned().collect::<Vec<String>>().join(", ")
            )
        })
        .collect();
    let outcome = run(&format!(
        "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         {imports}\
         \n\
         main :: Effect Unit\n\
         main = pure unit\n"
    ));
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "{:?}",
        outcome.result
    );
}

/// **Gate [G8](super::super::g8) for PureScript** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::PureScript,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"module Main where

-- G8 (a): a gg call the host answers `not-found`, uncaught.

import Prelude

import Effect (Effect)
import Effect.Class.Console as Console
import Gg.Files as Gg.Files

main :: Effect Unit
main = do
  _ <- Gg.Files.readFile
    "missing.md"
    {}
  Console.log "read it"
"#,
                names: &["read_file", "not-found", "missing.md"],
                located: Located::At("program.purs:14:5"),
                answered: Answered::AtRuntime,
                // The SDK's `ApiError` carries the wire's code and the guest reports it, so the
                // turn is filed as the program fighting the API, never as a sandbox trap.
                recorded: Some(TurnErrorType::ProgramApiError),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"module Main where

-- G8 (b): a partial function that was not total after all.

import Prelude

import Data.Maybe (Maybe(..), fromJust)
import Effect (Effect)
import Effect.Class.Console as Console
import Partial.Unsafe (unsafePartial)

main :: Effect Unit
main = do
  let
    missing = unsafePartial (fromJust (Nothing :: Maybe Int))
  Console.log (show missing)
"#,
                names: &["Failed pattern match"],
                located: Located::At("program.purs:15:5"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"module Main where

-- G8 (c): ending by returning a failure value.

import Prelude

import Data.Either (Either(..))
import Effect (Effect)
import Effect.Class.Console as Console

main :: Effect (Either String Int)
main = do
  Console.log "starting the third step"
  pure (Left "the third step did not finish")
"#,
                names: &["the third step did not finish"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: None,
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"module Main where

-- G8 (d): unbounded recursion, deliberately not a tail call.

import Prelude

import Effect (Effect)
import Effect.Class.Console as Console

deeper :: Int -> Int
deeper n = 1 + deeper (n + 1)

main :: Effect Unit
main = Console.log (show (deeper 0))
"#,
                names: &["Maximum call stack size exceeded"],
                located: Located::At("program.purs:11:24"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::Abort,
                program: r#"module Main where

-- G8 (e): stopping the program outright.

import Prelude

import Effect (Effect)
import Effect.Class.Console as Console
import Partial.Unsafe (unsafeCrashWith)

main :: Effect Unit
main = do
  Console.log "before the crash"
  unsafeCrashWith
    "the third step did not finish"
"#,
                names: &["the third step did not finish"],
                located: Located::At("program.purs:15:5"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
        ],
    );
}

// ---------------------------------------------------------------------------------------------------
// What the workspace modules hand a program back.
//
// Each case below is one small program asserting one thing: a success case reads back the value the
// SDK built out of `canned_outcome`'s answer for that tool, and a failure case catches the `ApiError`
// the SDK lowered with `Gg.Core.attempt` and logs its code, the operation key and the message.
// ---------------------------------------------------------------------------------------------------

/// Logs a `Gg.Memories.MemoryUsage` bound as `usage`, the `Maybe` fields included.
const LOG_MEMORY_USAGE: &str = "Console.log (show usage.count <> \" \" <> show usage.maxCount <> \" \" \
     <> show usage.totalChars <> \" \" <> show usage.maxTotalChars <> \" \" <> show usage.indexChars)";

/// Logs a `Gg.Board.BoardUsage` bound as `board`.
const LOG_BOARD_USAGE: &str = "Console.log (show board.epics <> \" \" <> show board.maxEpics <> \" \" \
     <> show board.issues <> \" \" <> show board.maxIssues)";

/// A responder answering every call with `outcome`, for a success the canned double does not give.
fn answering(outcome: ToolOutcome) -> impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static {
    move |_name: &str, _args: &Value| outcome.clone()
}

// shell ---------------------------------------------------------------------------------------------

#[test]
fn a_shell_command_hands_the_program_its_exit_code_and_output() {
    assert_eq!(
        canned_logs(&[
            "result <- Gg.Shell.shell \"npm test\" {}",
            "Console.log (show result.exitCode <> \" \" <> result.output <> \" \" <> show result.truncated)",
        ]),
        ["(Just 0) ran `npm test` false"]
    );
}

#[test]
fn a_non_zero_exit_is_a_value_the_program_reads_rather_than_a_throw() {
    assert_eq!(
        canned_logs(&[
            "result <- Gg.Shell.shell \"npm run fail\" {}",
            "Console.log (show result.exitCode)",
            "Console.log \"carried on\"",
        ]),
        ["(Just 1)", "carried on"]
    );
}

#[test]
fn a_shell_timeout_reaches_a_purescript_program_as_limit_exceeded() {
    assert_eq!(
        caught_failure(
            "Gg.Shell.shell \"sleep 600\" { timeoutSecs: 1 }",
            ToolFailure::LimitExceeded,
            "command timed out after 1.000s and was killed.",
        ),
        ["LimitExceeded shell command timed out after 1.000s and was killed."]
    );
}

#[test]
fn a_shell_that_could_not_be_launched_reaches_a_program_as_an_io_error() {
    assert_eq!(
        caught_failure(
            "Gg.Shell.shell \"npm test\" {}",
            ToolFailure::IoError,
            "could not launch the shell: No such file or directory (os error 2)",
        ),
        ["IoError shell could not launch the shell: No such file or directory (os error 2)"]
    );
}

#[test]
fn a_negative_shell_timeout_reaches_a_program_as_an_argument_error() {
    // Refused before dispatch — by the guest's shared SDK instance first, with `clamp_timeout`
    // behind it as the host's backstop — so the double is never asked, and the message is the
    // refusal's own, naming the timeout the program wrote.
    assert_eq!(
        canned_logs(&[&caught("Gg.Shell.shell \"npm test\" { timeoutSecs: -1 }")]),
        ["InvalidArgument shell `timeoutSecs` must be a positive number, got -1"]
    );
}

// files ---------------------------------------------------------------------------------------------

#[test]
fn a_text_read_hands_a_purescript_program_the_text_file_arm() {
    assert_eq!(
        canned_logs(&[
            "read <- Gg.Files.readFile \"notes.md\" {}",
            "case read of\n    \
             Gg.Files.TextFile file -> Console.log (show file.contents <> \" \" <> show file.firstLine \
             <> \" \" <> show file.lastLine <> \" \" <> show file.totalLines <> \" \" <> show file.byteTruncated)\n    \
             Gg.Files.ImageFile _ -> Console.log \"an image\"",
        ]),
        ["\"contents of notes.md\\nline two\\n\" 1 2 2 false"]
    );
}

#[test]
fn an_image_read_hands_a_purescript_program_the_image_file_arm() {
    assert_eq!(
        canned_logs(&[
            "read <- Gg.Files.readFile \"shot.png\" {}",
            "case read of\n    \
             Gg.Files.TextFile _ -> Console.log \"text\"\n    \
             Gg.Files.ImageFile picture -> Console.log (picture.mediaType <> \" \" <> picture.label \
             <> \" \" <> show picture.bytes <> \" \" <> show picture.shown <> \" \" <> show picture.notShownReason)",
        ]),
        // A bare read describes the picture and does not show it; the reason names the call that
        // would.
        [
            "image/png PNG 1234 false (Just \"`Gg.Files.readFile` does not show images; open one with \
             `Gg.Views.openFile(path)`\")"
        ]
    );
}

#[test]
fn an_empty_read_path_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Files.readFile \"\" {}",
            ToolFailure::InvalidArgument,
            "path must not be empty",
        ),
        ["InvalidArgument read_file path must not be empty"]
    );
}

#[test]
fn a_write_hands_the_program_the_byte_count_it_wrote() {
    assert_eq!(
        canned_logs(&[
            "written <- Gg.Files.writeFile \"out.txt\" \"hello\"",
            "Console.log (show written)",
        ]),
        ["5"]
    );
}

#[test]
fn an_empty_write_path_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Files.writeFile \"\" \"hello\"",
            ToolFailure::InvalidArgument,
            "path must not be empty",
        ),
        ["InvalidArgument write_file path must not be empty"]
    );
}

#[test]
fn a_write_that_failed_reaches_a_program_as_an_io_error() {
    assert_eq!(
        caught_failure(
            "Gg.Files.writeFile \"locked/out.txt\" \"hello\"",
            ToolFailure::IoError,
            "`locked/out.txt`: Permission denied (os error 13)",
        ),
        ["IoError write_file `locked/out.txt`: Permission denied (os error 13)"]
    );
}

#[test]
fn an_edit_that_matched_lets_the_program_carry_on() {
    assert_eq!(
        canned_logs(&[
            "Gg.Files.editFile \"src/a.purs\" \"alpha\" \"beta\"",
            "Console.log \"carried on\"",
        ]),
        ["carried on"]
    );
}

#[test]
fn an_ambiguous_edit_reaches_a_program_as_a_conflict_carrying_the_count() {
    assert_eq!(
        caught_failure(
            "Gg.Files.editFile \"src/a.purs\" \"alpha\" \"beta\"",
            ToolFailure::Conflict,
            "`old_string` is not unique (3 occurrences)",
        ),
        ["Conflict edit_file `old_string` is not unique (3 occurrences)"]
    );
}

#[test]
fn a_listing_hands_the_program_its_entries_with_their_kinds() {
    assert_eq!(
        canned_logs(&[
            "entries <- Gg.Files.listDir { path: \"src\" }",
            "Console.log (show (map (\\entry -> entry.name <> \" \" <> show entry.kind) entries))",
        ]),
        ["[\"a.ts FileEntry\",\"b.test.ts FileEntry\",\"sub DirectoryEntry\"]"]
    );
}

#[test]
fn an_omitted_listing_path_lists_the_workspace_root() {
    let (outcome, log) = run_with(
        &logging_program_of(&[
            "entries <- Gg.Files.listDir {}",
            "Console.log (show (map _.name entries))",
        ]),
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["[\"a.ts\",\"b.test.ts\",\"sub\"]"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

#[test]
fn an_empty_listing_is_an_empty_array_rather_than_a_failure() {
    let (outcome, _log) = run_with(
        &logging_program_of(&[
            "entries <- Gg.Files.listDir { path: \"empty\" }",
            "Console.log (show (map _.name entries))",
        ]),
        &all_operations(),
        &[],
        answering(
            ToolOutcome::ok("(empty)", "0 entries")
                .with_data(crate::tools::ApiData::DirEntries(Vec::new())),
        ),
    );
    assert_eq!(logs(&outcome), ["[]"]);
}

#[test]
fn an_empty_listing_path_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Files.listDir { path: \"\" }",
            ToolFailure::InvalidArgument,
            "path must not be empty",
        ),
        ["InvalidArgument list_dir path must not be empty"]
    );
}

#[test]
fn a_listing_of_a_missing_directory_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Files.listDir { path: \"gone\" }",
            ToolFailure::NotFound,
            "list_dir: No such file or directory (os error 2)",
        ),
        ["NotFound list_dir list_dir: No such file or directory (os error 2)"]
    );
}

#[test]
fn a_tree_hands_the_program_its_rendering() {
    assert_eq!(
        canned_logs(&[
            "rendering <- Gg.Files.tree { path: \"src\" }",
            "Console.log (show rendering)",
        ]),
        ["\"a.ts\\nb.test.ts\\nsub/\\n  c.ts\""]
    );
}

#[test]
fn a_tree_of_a_missing_path_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Files.tree { path: \"gone\" }",
            ToolFailure::NotFound,
            "tree: `gone` does not exist",
        ),
        ["NotFound tree tree: `gone` does not exist"]
    );
}

#[test]
fn a_tree_rooted_at_a_file_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Files.tree { path: \"README.md\" }",
            ToolFailure::InvalidArgument,
            "tree: `README.md` is not a directory",
        ),
        ["InvalidArgument tree tree: `README.md` is not a directory"]
    );
}

#[test]
fn a_tree_depth_of_zero_reaches_a_program_as_an_argument_error() {
    // Refused before dispatch, so the double is never asked and the message is the refusal's own.
    assert_eq!(
        canned_logs(&[&caught("Gg.Files.tree { depth: 0 }")]),
        ["InvalidArgument tree `depth` must be at least 1, got 0"]
    );
}

#[test]
fn a_search_hands_the_program_its_matches() {
    assert_eq!(
        canned_logs(&[
            "matches <- Gg.Files.search \"answer\" {}",
            "Console.log (show (map (\\match -> match.path <> \" \" <> show match.line <> \" \" <> match.text) matches))",
        ]),
        ["[\"src/a.ts 3 const answer = 42;\"]"]
    );
}

#[test]
fn a_blank_search_query_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Files.search \"   \" {}",
            ToolFailure::InvalidArgument,
            "`query` must not be blank",
        ),
        ["InvalidArgument search `query` must not be blank"]
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Files.search \"(unclosed\" {}",
            ToolFailure::InvalidArgument,
            "`query` is not a valid regular expression: unclosed group",
        ),
        ["InvalidArgument search `query` is not a valid regular expression: unclosed group"]
    );
}

#[test]
fn a_search_limit_of_zero_reaches_a_program_as_an_argument_error() {
    // Refused before dispatch, so the double is never asked and the message is the refusal's own.
    assert_eq!(
        canned_logs(&[&caught("Gg.Files.search \"answer\" { limit: 0 }")]),
        ["InvalidArgument search `limit` must be at least 1, got 0"]
    );
}

#[test]
fn a_search_under_a_missing_path_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Files.search \"answer\" { path: \"gone\" }",
            ToolFailure::NotFound,
            "search: `gone` does not exist",
        ),
        ["NotFound search search: `gone` does not exist"]
    );
}

// skills --------------------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_the_program_the_skill_body() {
    assert_eq!(
        canned_logs(&[
            "body <- Gg.Skills.readSkill \"testing\"",
            "Console.log body",
        ]),
        ["the skill body"]
    );
}

#[test]
fn an_unknown_skill_reaches_a_program_as_not_found_listing_the_skills_that_exist() {
    assert_eq!(
        caught_failure(
            "Gg.Skills.readSkill \"deploy\"",
            ToolFailure::NotFound,
            "no skill named `deploy`; available skills: testing, review",
        ),
        ["NotFound read_skill no skill named `deploy`; available skills: testing, review"]
    );
}

// memories ------------------------------------------------------------------------------------------

#[test]
fn a_memory_write_hands_the_program_the_budget_it_left() {
    assert_eq!(
        canned_logs(&[
            "usage <- Gg.Memories.writeMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            LOG_MEMORY_USAGE,
        ]),
        ["1 (Just 8) 12 (Just 4000) Nothing"]
    );
}

#[test]
fn a_duplicate_memory_name_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.writeMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            ToolFailure::Conflict,
            "memory `layout` already exists; revise it with `Gg.Memories.updateMemory`",
        ),
        [
            "Conflict write_memory memory `layout` already exists; revise it with \
             `Gg.Memories.updateMemory`"
        ]
    );
}

#[test]
fn a_memory_body_over_the_cap_reaches_a_program_as_limit_exceeded() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.writeMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            ToolFailure::LimitExceeded,
            "memory `layout` is 5000 characters (max 4000)",
        ),
        ["LimitExceeded write_memory memory `layout` is 5000 characters (max 4000)"]
    );
}

#[test]
fn a_memory_update_hands_the_program_the_budget_it_left() {
    assert_eq!(
        canned_logs(&[
            "usage <- Gg.Memories.updateMemory { name: \"layout\", description: \"d2\", body: \"b2\" }",
            LOG_MEMORY_USAGE,
        ]),
        ["1 (Just 8) 12 (Just 4000) Nothing"]
    );
}

#[test]
fn an_update_of_an_unknown_memory_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.updateMemory { name: \"layout\", description: \"d2\", body: \"b2\" }",
            ToolFailure::NotFound,
            "no memory named `layout`; create it with `Gg.Memories.writeMemory`",
        ),
        [
            "NotFound update_memory no memory named `layout`; create it with \
             `Gg.Memories.writeMemory`"
        ]
    );
}

#[test]
fn a_replacement_body_over_the_cap_reaches_a_program_as_limit_exceeded() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.updateMemory { name: \"layout\", description: \"d2\", body: \"b2\" }",
            ToolFailure::LimitExceeded,
            "memory `layout` is 5000 characters (max 4000)",
        ),
        ["LimitExceeded update_memory memory `layout` is 5000 characters (max 4000)"]
    );
}

#[test]
fn a_memory_creation_hands_the_program_the_budget_it_left() {
    assert_eq!(
        canned_logs(&[
            "usage <- Gg.Memories.createMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            LOG_MEMORY_USAGE,
        ]),
        ["1 (Just 8) 12 (Just 4000) Nothing"]
    );
}

#[test]
fn a_duplicate_memory_slug_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.createMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            ToolFailure::Conflict,
            "memory `layout` already exists; revise it with `Gg.Memories.editMemory`",
        ),
        [
            "Conflict create_memory memory `layout` already exists; revise it with \
             `Gg.Memories.editMemory`"
        ]
    );
}

#[test]
fn memory_contents_over_the_cap_reach_a_program_as_limit_exceeded() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.createMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            ToolFailure::LimitExceeded,
            "memory `layout` is 5000 characters (max 4000)",
        ),
        ["LimitExceeded create_memory memory `layout` is 5000 characters (max 4000)"]
    );
}

#[test]
fn a_memory_index_entry_over_the_cap_reaches_a_program_as_limit_exceeded() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.createMemory { name: \"layout\", description: \"d\", body: \"b\" }",
            ToolFailure::LimitExceeded,
            "the memory index would be 2100 characters (max 2000)",
        ),
        ["LimitExceeded create_memory the memory index would be 2100 characters (max 2000)"]
    );
}

#[test]
fn a_memory_read_hands_the_program_its_body() {
    assert_eq!(
        canned_logs(&[
            "body <- Gg.Memories.readMemory \"layout\"",
            "Console.log body",
        ]),
        ["the memory contents"]
    );
}

#[test]
fn a_read_of_an_unknown_memory_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.readMemory \"layout\"",
            ToolFailure::NotFound,
            "no memory named `layout`; create it with `Gg.Memories.createMemory`",
        ),
        [
            "NotFound read_memory no memory named `layout`; create it with \
             `Gg.Memories.createMemory`"
        ]
    );
}

#[test]
fn a_memory_edit_hands_the_program_the_budget_it_left() {
    assert_eq!(
        canned_logs(&[
            "usage <- Gg.Memories.editMemory { name: \"layout\", search: \"old\", replace: \"new\" }",
            LOG_MEMORY_USAGE,
        ]),
        ["1 (Just 8) 12 (Just 4000) Nothing"]
    );
}

#[test]
fn a_memory_edit_that_matched_nothing_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.editMemory { name: \"layout\", search: \"old\", replace: \"new\" }",
            ToolFailure::NotFound,
            "the search text does not appear in memory `layout`",
        ),
        ["NotFound edit_memory the search text does not appear in memory `layout`"]
    );
}

#[test]
fn an_ambiguous_memory_edit_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.editMemory { name: \"layout\", search: \"old\", replace: \"new\" }",
            ToolFailure::Conflict,
            "the search text appears 2 times in memory `layout`",
        ),
        ["Conflict edit_memory the search text appears 2 times in memory `layout`"]
    );
}

#[test]
fn a_memory_edit_over_the_cap_reaches_a_program_as_limit_exceeded() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.editMemory { name: \"layout\", search: \"old\", replace: \"new\" }",
            ToolFailure::LimitExceeded,
            "memory `layout` is 5000 characters (max 4000)",
        ),
        ["LimitExceeded edit_memory memory `layout` is 5000 characters (max 4000)"]
    );
}

#[test]
fn an_edit_that_would_empty_a_memory_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.editMemory { name: \"layout\", search: \"everything\", replace: \"\" }",
            ToolFailure::InvalidArgument,
            "the edit would leave memory `layout` empty; delete it instead",
        ),
        [
            "InvalidArgument edit_memory the edit would leave memory `layout` empty; delete it \
             instead"
        ]
    );
}

#[test]
fn a_memory_hit_carries_its_counts_and_excerpt_into_the_program() {
    assert_eq!(
        canned_logs(&[
            "hits <- Gg.Memories.searchMemories [ \"cargo\" ]",
            "Console.log (show (map (\\hit -> hit.description <> \" \" <> show hit.matched <> \" \" \
             <> show hit.occurrences <> \" \" <> hit.excerpt) hits))",
        ]),
        ["[\"How to build 2 3 …cargo nextest run --workspace…\"]"]
    );
}

#[test]
fn a_memory_search_that_matched_nothing_is_an_empty_array() {
    let (outcome, _log) = run_with(
        &logging_program_of(&[
            "hits <- Gg.Memories.searchMemories [ \"nothing\" ]",
            "Console.log (show (map _.name hits))",
        ]),
        &all_operations(),
        &[],
        answering(
            ToolOutcome::ok("0 memories match", "searched memories")
                .with_data(crate::tools::ApiData::MemoryHits(Vec::new())),
        ),
    );
    assert_eq!(logs(&outcome), ["[]"]);
}

#[test]
fn a_memory_search_of_empty_keywords_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.searchMemories [ \"\" ]",
            ToolFailure::InvalidArgument,
            "`keywords` needs at least one non-empty keyword",
        ),
        ["InvalidArgument search_memories `keywords` needs at least one non-empty keyword"]
    );
}

#[test]
fn a_memory_deletion_hands_the_program_the_budget_it_left() {
    assert_eq!(
        canned_logs(&[
            "usage <- Gg.Memories.deleteMemory \"layout\"",
            LOG_MEMORY_USAGE,
        ]),
        ["1 (Just 8) 12 (Just 4000) Nothing"]
    );
}

#[test]
fn a_deletion_of_an_unknown_memory_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Memories.deleteMemory \"layout\"",
            ToolFailure::NotFound,
            "no memory named `layout`; create it with `Gg.Memories.createMemory`",
        ),
        [
            "NotFound delete_memory no memory named `layout`; create it with \
             `Gg.Memories.createMemory`"
        ]
    );
}

// tasks ---------------------------------------------------------------------------------------------

#[test]
fn a_task_addition_hands_the_program_the_task_budget() {
    assert_eq!(
        canned_logs(&[
            "usage <- Gg.Tasks.addTask { id: \"t1\", title: \"T\" }",
            "Console.log (show usage.count <> \" \" <> show usage.maxTasks)",
        ]),
        ["2 20"]
    );
}

#[test]
fn a_duplicate_task_id_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Tasks.addTask { id: \"t1\", title: \"T\" }",
            ToolFailure::Conflict,
            "a task with id `t1` already exists",
        ),
        ["Conflict add_task a task with id `t1` already exists"]
    );
}

#[test]
fn an_added_task_blocked_into_a_cycle_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Tasks.addTask { id: \"t1\", title: \"T\", blockedBy: [ \"t1\" ] }",
            ToolFailure::Conflict,
            "task `t1` cannot be blocked by itself",
        ),
        ["Conflict add_task task `t1` cannot be blocked by itself"]
    );
}

#[test]
fn a_task_update_lets_the_program_carry_on() {
    assert_eq!(
        canned_logs(&[
            "Gg.Tasks.updateTask \"t1\" { status: Gg.Tasks.TaskInProgress }",
            "Console.log \"carried on\"",
        ]),
        ["carried on"]
    );
}

#[test]
fn an_update_of_an_unknown_task_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Tasks.updateTask \"t9\" { status: Gg.Tasks.TaskDone }",
            ToolFailure::NotFound,
            "no task with id `t9`",
        ),
        ["NotFound update_task no task with id `t9`"]
    );
}

#[test]
fn setting_a_tasks_blockers_lets_the_program_carry_on() {
    assert_eq!(
        canned_logs(&[
            "Gg.Tasks.setBlockedBy \"t1\" [ \"t0\" ]",
            "Console.log \"carried on\"",
        ]),
        ["carried on"]
    );
}

#[test]
fn setting_blockers_on_an_unknown_task_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Tasks.setBlockedBy \"t9\" [ \"t0\" ]",
            ToolFailure::NotFound,
            "no task with id `t9`",
        ),
        ["NotFound set_blocked_by no task with id `t9`"]
    );
}

#[test]
fn setting_task_blockers_into_a_cycle_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Tasks.setBlockedBy \"t1\" [ \"t2\" ]",
            ToolFailure::Conflict,
            "blocking `t1` on `t2` would create a cycle: `t2` already depends on `t1`",
        ),
        [
            "Conflict set_blocked_by blocking `t1` on `t2` would create a cycle: `t2` already \
             depends on `t1`"
        ]
    );
}

#[test]
fn completing_a_task_lets_the_program_carry_on() {
    assert_eq!(
        canned_logs(&["Gg.Tasks.completeTask \"t1\"", "Console.log \"carried on\"",]),
        ["carried on"]
    );
}

#[test]
fn completing_an_unknown_task_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Tasks.completeTask \"t9\"",
            ToolFailure::NotFound,
            "no task with id `t9`",
        ),
        ["NotFound complete_task no task with id `t9`"]
    );
}

#[test]
fn a_task_removal_hands_the_program_the_task_budget() {
    assert_eq!(
        canned_logs(&[
            "usage <- Gg.Tasks.removeTask \"t1\"",
            "Console.log (show usage.count <> \" \" <> show usage.maxTasks)",
        ]),
        ["2 20"]
    );
}

#[test]
fn removing_an_unknown_task_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Tasks.removeTask \"t9\"",
            ToolFailure::NotFound,
            "no task with id `t9`",
        ),
        ["NotFound remove_task no task with id `t9`"]
    );
}

// board ---------------------------------------------------------------------------------------------

#[test]
fn an_epic_creation_hands_the_program_its_id_and_the_board_budget() {
    assert_eq!(
        canned_logs(&[
            "epic <- Gg.Board.createEpic { prefix: \"epc\", title: \"E\", description: \"D\" }",
            "let board = epic.board",
            "Console.log epic.id",
            LOG_BOARD_USAGE,
        ]),
        ["EPIC", "1 4 3 20"]
    );
}

#[test]
fn an_epic_prefix_under_three_letters_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Board.createEpic { prefix: \"ab\", title: \"E\", description: \"D\" }",
            ToolFailure::InvalidArgument,
            "`prefix`: `ab` is not 3 to 6 letters (a-z)",
        ),
        ["InvalidArgument create_epic `prefix`: `ab` is not 3 to 6 letters (a-z)"]
    );
}

#[test]
fn an_epic_prefix_over_six_letters_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Board.createEpic { prefix: \"toolong\", title: \"E\", description: \"D\" }",
            ToolFailure::InvalidArgument,
            "`prefix`: `toolong` is not 3 to 6 letters (a-z)",
        ),
        ["InvalidArgument create_epic `prefix`: `toolong` is not 3 to 6 letters (a-z)"]
    );
}

#[test]
fn an_epic_prefix_that_is_not_letters_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Board.createEpic { prefix: \"ep1\", title: \"E\", description: \"D\" }",
            ToolFailure::InvalidArgument,
            "`prefix`: `ep1` is not 3 to 6 letters (a-z)",
        ),
        ["InvalidArgument create_epic `prefix`: `ep1` is not 3 to 6 letters (a-z)"]
    );
}

#[test]
fn a_prefix_another_epic_holds_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Board.createEpic { prefix: \"epc\", title: \"E\", description: \"D\" }",
            ToolFailure::Conflict,
            "an epic with the prefix `EPC` already exists",
        ),
        ["Conflict create_epic an epic with the prefix `EPC` already exists"]
    );
}

/// The smallest issue a program can file, as a `Gg.Board.createIssue` call.
const CREATE_ISSUE: &str = "Gg.Board.createIssue { title: \"I\", inScope: \"s\", outOfScope: \"o\", \
     completionCriteria: \"c\", agent: \"worker\" }";

#[test]
fn an_issue_creation_hands_the_program_its_id_and_the_board_budget() {
    assert_eq!(
        canned_logs(&[
            &format!("issue <- {CREATE_ISSUE}"),
            "let board = issue.board",
            "Console.log issue.id",
            LOG_BOARD_USAGE,
        ]),
        ["EPIC-1", "1 4 3 20"]
    );
}

#[test]
fn an_agent_this_session_may_not_assign_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            CREATE_ISSUE,
            ToolFailure::InvalidArgument,
            "`agent`: unknown agent `worker`; expected one of: builder",
        ),
        ["InvalidArgument create_issue `agent`: unknown agent `worker`; expected one of: builder"]
    );
}

#[test]
fn a_reviewer_this_session_may_not_assign_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Board.createIssue { title: \"I\", inScope: \"s\", outOfScope: \"o\", \
             completionCriteria: \"c\", agent: \"worker\", reviewers: [ \"stranger\" ] }",
            ToolFailure::InvalidArgument,
            "`reviewers`: unknown agent `stranger`; expected one of: critic",
        ),
        [
            "InvalidArgument create_issue `reviewers`: unknown agent `stranger`; expected one of: \
             critic"
        ]
    );
}

#[test]
fn an_issue_blocked_into_a_cycle_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Board.createIssue { title: \"I\", inScope: \"s\", outOfScope: \"o\", \
             completionCriteria: \"c\", agent: \"worker\", blockedBy: [ \"EPIC-2\" ] }",
            ToolFailure::Conflict,
            "blocking `EPIC-3` on `EPIC-2` would create a cycle: `EPIC-2` already depends on `EPIC-3`",
        ),
        [
            "Conflict create_issue blocking `EPIC-3` on `EPIC-2` would create a cycle: `EPIC-2` \
             already depends on `EPIC-3`"
        ]
    );
}

#[test]
fn an_issue_update_lets_the_program_carry_on() {
    assert_eq!(
        canned_logs(&[
            "Gg.Board.updateIssue \"EPIC-1\" { status: Gg.Board.IssueInProgress }",
            "Console.log \"carried on\"",
        ]),
        ["carried on"]
    );
}

#[test]
fn an_update_of_an_unknown_issue_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Board.updateIssue \"EPIC-9\" { status: Gg.Board.IssueDone }",
            ToolFailure::NotFound,
            "no issue with id `EPIC-9`",
        ),
        ["NotFound update_issue no issue with id `EPIC-9`"]
    );
}

#[test]
fn setting_an_issues_blockers_lets_the_program_carry_on() {
    assert_eq!(
        canned_logs(&[
            "Gg.Board.setIssueBlockedBy \"EPIC-2\" [ \"EPIC-1\" ]",
            "Console.log \"carried on\"",
        ]),
        ["carried on"]
    );
}

#[test]
fn setting_blockers_on_an_unknown_issue_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Board.setIssueBlockedBy \"EPIC-9\" [ \"EPIC-1\" ]",
            ToolFailure::NotFound,
            "no issue with id `EPIC-9`",
        ),
        ["NotFound set_issue_blocked_by no issue with id `EPIC-9`"]
    );
}

#[test]
fn setting_issue_blockers_into_a_cycle_reaches_a_program_as_a_conflict() {
    assert_eq!(
        caught_failure(
            "Gg.Board.setIssueBlockedBy \"EPIC-1\" [ \"EPIC-2\" ]",
            ToolFailure::Conflict,
            "blocking `EPIC-1` on `EPIC-2` would create a cycle: `EPIC-2` already depends on `EPIC-1`",
        ),
        [
            "Conflict set_issue_blocked_by blocking `EPIC-1` on `EPIC-2` would create a cycle: \
             `EPIC-2` already depends on `EPIC-1`"
        ]
    );
}

#[test]
fn an_epic_removal_hands_the_program_the_board_budget() {
    assert_eq!(
        canned_logs(&["board <- Gg.Board.removeEpic \"EPIC\"", LOG_BOARD_USAGE]),
        ["1 4 3 20"]
    );
}

#[test]
fn removing_an_epic_that_still_holds_issues_hands_back_the_ungrouped_board() {
    // The epic goes and its three issues stay, ungrouped: the budget the removal hands back is the
    // whole of what says so.
    let (outcome, _log) = run_with(
        &logging_program_of(&["board <- Gg.Board.removeEpic \"EPIC\"", LOG_BOARD_USAGE]),
        &all_operations(),
        &[],
        answering(ToolOutcome::ok("removed epic `EPIC`", "board").with_data(
            crate::tools::ApiData::BoardUsage(crate::tools::BoardUsageData {
                epics: 0,
                max_epics: 4,
                issues: 3,
                max_issues: 20,
            }),
        )),
    );
    assert_eq!(logs(&outcome), ["0 4 3 20"]);
}

#[test]
fn removing_an_unknown_epic_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Board.removeEpic \"NOPE\"",
            ToolFailure::NotFound,
            "no epic with id `NOPE`",
        ),
        ["NotFound remove_epic no epic with id `NOPE`"]
    );
}

#[test]
fn an_issue_removal_hands_the_program_the_board_budget() {
    assert_eq!(
        canned_logs(&["board <- Gg.Board.removeIssue \"EPIC-1\"", LOG_BOARD_USAGE]),
        ["1 4 3 20"]
    );
}

#[test]
fn removing_an_unknown_issue_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Board.removeIssue \"EPIC-9\"",
            ToolFailure::NotFound,
            "no issue with id `EPIC-9`",
        ),
        ["NotFound remove_issue no issue with id `EPIC-9`"]
    );
}

#[test]
fn a_registered_wait_hands_the_program_its_acknowledgement_and_runs_on() {
    assert_eq!(
        canned_logs(&[
            "ack <- Gg.Board.waitForIssue \"EPIC-1\"",
            "Console.log ack",
            "Console.log \"ran on\"",
        ]),
        ["wait registered", "ran on"]
    );
}

#[test]
fn waiting_on_an_unknown_issue_reaches_a_program_as_not_found() {
    assert_eq!(
        caught_failure(
            "Gg.Board.waitForIssue \"EPIC-9\"",
            ToolFailure::NotFound,
            "no issue with id `EPIC-9`",
        ),
        ["NotFound wait_for_issue no issue with id `EPIC-9`"]
    );
}

#[test]
fn waiting_on_this_sessions_own_issue_reaches_a_program_as_an_argument_error() {
    assert_eq!(
        caught_failure(
            "Gg.Board.waitForIssue \"EPIC-1\"",
            ToolFailure::InvalidArgument,
            "cannot wait on issue `EPIC-1`: it is this agent's own assigned issue",
        ),
        [
            "InvalidArgument wait_for_issue cannot wait on issue `EPIC-1`: it is this agent's own \
             assigned issue"
        ]
    );
}
