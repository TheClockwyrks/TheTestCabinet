//! The host-side PureScript compile: the module it derives the bundler's entry point from, the two
//! verdicts it tells apart, and the agreement between the compiled library tree this build cut and
//! the manifest that describes it.
//!
//! These spawn a real `purs` and a real `esbuild`, so they are seconds rather than microseconds — but
//! they stop at the JavaScript. What that JavaScript *does* inside the guest is
//! [the substrate tests](super::super::substrate)' subject.

use super::*;
use crate::sandbox::PrepareContext;

/// Compile `source` as a program, or panic with what the toolchain said.
fn program(source: &str) -> String {
    match compile_program(source, &[], &PrepareContext::detached()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
    }
}

/// The same, for a turn carrying code modules — which are compiled into the program's own project.
fn program_with(source: &str, modules: &[CodeModule]) -> String {
    match compile_program(source, modules, &PrepareContext::detached()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
    }
}

/// The failure compiling `source` as a program produced, or panic because it compiled.
fn refusal(source: &str) -> PrepareFailure {
    refusal_with(source, &[])
}

/// The same, for a turn carrying code modules.
fn refusal_with(source: &str, modules: &[CodeModule]) -> PrepareFailure {
    match compile_program(source, modules, &PrepareContext::detached()) {
        Ok(_) => panic!("expected this PureScript to be refused, and it compiled"),
        Err(failure) => failure,
    }
}

/// One loaded code module, as a turn carries it: the key it was bound at and the author's own
/// source, unchanged.
fn module(key: &str, source: &str) -> CodeModule {
    CodeModule {
        name: key.to_string(),
        source: source.to_string(),
    }
}

/// A program that logs one line — the smallest thing this arm can compile end to end.
const HELLO: &str = "module Main where\n\
                     \n\
                     import Prelude\n\
                     import Effect (Effect)\n\
                     import Effect.Class.Console as Console\n\
                     \n\
                     main :: Effect Unit\n\
                     main = Console.log \"hello\"\n";

#[test]
fn a_reply_with_no_header_is_the_compiler_s_own_refusal() {
    // What a model that thought it was writing a script produces. gg supplies nothing: `purs` cannot
    // read it, says so at line 1, and that is what the model reads.
    let failure = refusal("import Prelude\nmain :: Int\nmain = 1\n");
    let PrepareFailure::Program(PrepareError::Syntax(message)) = &failure else {
        panic!("expected a syntax error, got {failure:?}");
    };
    assert!(
        message.contains("program.purs:1:1: ErrorParsingModule"),
        "the compiler's own words at the compiler's own line: {message}"
    );
}

#[test]
fn a_program_names_its_own_module_and_runs_from_it() {
    // The name is the model's, and the bundle really is built from the module it named: `esbuild`
    // resolves `./output/Solve/index.js`, and a name gg read wrongly would not resolve at all.
    let bundled = program(
        "module Solve where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log \"solved\"\n",
    );
    assert!(bundled.contains("console.log"), "the FFI came with it");
}

/// One preparation of `agent`, on the ground a turn is given: a context of this agent's, keeping
/// this arm's own project directories across the reset. Hands back the bundle and the `purs` output
/// directory the compile wrote into.
fn turn(agent: &crate::sandbox::AgentWorkspace, source: &str) -> (String, PathBuf) {
    let context = crate::sandbox::PrepareContext::for_agent(agent, PROJECT_DIRS);
    let bundled = match compile_program(source, &[], &context) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
    };
    let output = context
        .opened_workspace()
        .expect("the compile opened this agent's tree")
        .join("work")
        .join(OUTPUT_DIR);
    (bundled, output)
}

/// A program logging `line`, under the module header `header`.
fn logging(header: &str, line: &str) -> String {
    format!(
        "{header}\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log \"{line}\"\n",
    )
}

#[test]
fn a_response_may_reuse_the_module_name_an_earlier_response_used() {
    // The same name, twice, in one agent's tree — which is what a model that calls every program
    // `Main` produces. The output directory is persistent work and survives the reset between the
    // two, so the first response's `output/Solve` is still there when the second compiles; the sweep
    // is what stops the bundler picking it up.
    let agent = crate::sandbox::AgentWorkspace::new();
    let (first, _) = turn(&agent, &logging("module Solve where", "first"));
    assert!(first.contains("first"), "the first response's own bundle");

    let (second, _) = turn(&agent, &logging("module Solve where", "second"));
    assert!(
        second.contains("second") && !second.contains("\"first\""),
        "the second response's bundle carries the second response: {second}"
    );
}

#[test]
fn a_response_that_renames_its_module_leaves_the_old_one_behind() {
    // The sweep, asserted on disk rather than through the bundle: a name a response used and the
    // next one did not is not still in the compiler's output afterwards. Without this the test above
    // would pass for the wrong reason — two directories, and the right one chosen by luck.
    let agent = crate::sandbox::AgentWorkspace::new();
    turn(&agent, &logging("module Solve where", "first"));
    let (bundled, output) = turn(&agent, &logging("module Main where", "second"));
    assert!(bundled.contains("second"), "the renamed module compiled");

    assert!(output.join("Main").is_dir(), "this response's module");
    assert!(
        !output.join("Solve").exists(),
        "the previous response's module went with the previous response"
    );
}

#[test]
fn a_leading_block_comment_may_hold_text_outside_ascii() {
    // A model writing about the game it is building writes an em-dash, an accent and an emoji. The
    // reply is UTF-8 and `purs` reads all of it, so nothing here may read less.
    let bundled = program(&format!(
        "{}{}",
        "{- Snake — a naïve grid. Ship it 🚀 -}\n",
        logging("module Solve where", "solved"),
    ));
    assert!(bundled.contains("solved"), "it compiled and bundled");
}

#[test]
fn a_module_name_outside_ascii_is_the_name_purs_filed_it_under() {
    // `purs` accepts a Unicode proper name and files the emitted JavaScript under it, so the entry
    // point resolves it too — which it can, because the name comes back from the output tree rather
    // than from a scan that only knew about ASCII.
    let bundled = program(&logging("module Ünicode where", "solved"));
    assert!(bundled.contains("solved"), "it compiled and bundled");
}

#[test]
fn a_real_program_compiles_to_a_module_carrying_its_own_map() {
    let bundled = program(HELLO);

    // The library code the program reached is IN the bundle — this is what "no runtime component"
    // means for this arm — and the code it did not reach is not. This program calls nothing of
    // gg's, so it carries none of gg's SDK either.
    assert!(bundled.contains("console.log"), "the FFI came with it");
    assert!(
        !bundled.contains("Data.Map"),
        "esbuild tree-shook what the program never imported"
    );

    // And the map that reads a frame in it back into PureScript, inline, composed by `esbuild` out
    // of its own and `purs`'s. It names the model's own file, and it names it as the file `purs`
    // read rather than through a path.
    let map = crate::sandbox::locate::embedded(&bundled).expect("the bundle carries its own map");
    let sources: Vec<&str> = (0..map.get_source_count())
        .filter_map(|index| map.get_source(index))
        .collect();
    assert!(
        sources.contains(&PROGRAM_FILE),
        "the map names the model's own file: {sources:?}"
    );
    assert!(
        sources
            .iter()
            .any(|source| source.ends_with("Console.purs")),
        "and the library modules it was bundled with: {sources:?}"
    );

    // A program that DOES call gg reaches it through the `import` line the SDK's own bridge wrote,
    // left external so the guest's loader resolves it to the instance a TypeScript program shares.
    let calling = program(
        "module Solve where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Gg.Views as Gg.Views\n\
         \n\
         main :: Effect Unit\n\
         main = void (Gg.Views.openText \"note\" \"hi\")\n",
    );
    assert!(
        calling.contains("import * as gg from \"gg\";"),
        "the bundle reaches gg through the line the SDK wrote"
    );
}

#[test]
fn a_syntax_error_and_a_type_error_are_different_bands() {
    // The parser could not read it: the model's answer is different text.
    let failure = refusal("module Main where\nmain = ((\n");
    let PrepareFailure::Program(PrepareError::Syntax(message)) = &failure else {
        panic!("expected a syntax error, got {failure:?}");
    };
    assert!(
        message.contains("program.purs:") && message.contains("ErrorParsingModule"),
        "located and named: {message}"
    );

    // It parsed and the compiler disagreed: the band a typed arm exists to produce, and the one a
    // study reads to ask what a model gets wrong about the surface it was handed.
    let failure = refusal(
        "module Main where\n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log (1 + \"two\")\n",
    );
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert!(
        message.contains("program.purs:7:") && message.contains("TypesDoNotUnify"),
        "the model's own line and the compiler's own code: {message}"
    );

    // A name that does not resolve is the same band, and it is the one every SDK mistake will land
    // in once there is an SDK to get wrong.
    let failure = refusal(
        "module Main where\n\
         import Prelude\n\
         import Effect (Effect)\n\
         \n\
         main :: Effect Unit\n\
         main = noSuchThing 1\n",
    );
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert!(message.contains("UnknownName"), "{message}");
}

#[test]
fn a_program_with_no_entry_point_is_told_so_in_a_sentence() {
    // It compiles: there is nothing wrong with the PureScript. There is just nothing to run, and the
    // model is told that rather than being shown a bundler's error about a file it never wrote.
    let failure = refusal("module Main where\n\nnotMain :: Int\nnotMain = 1\n");
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert!(
        message.contains("main :: Effect Unit"),
        "it says what to write: {message}"
    );

    // An export list that leaves `main` out is the same failure, and the message says so.
    let failure = refusal(
        "module Solve (helper) where\n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         helper :: Int\n\
         helper = 1\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log \"hi\"\n",
    );
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Compile(_))),
        "{failure:?}"
    );
}

/// A finished `purs --json-errors`, spelled out — the shape [`classify`](super::classify) reads,
/// with no compiler run. The cap below is about *fifty* diagnostics, and provoking fifty out of a
/// real `purs` would be a test about writing bad PureScript rather than about the bound.
fn json_report(errors: &[String]) -> CompilerReport {
    CompilerReport {
        ok: false,
        code: Some(1),
        status: "exited with status 1".to_string(),
        stdout: format!("{{\"warnings\":[],\"errors\":[{}]}}", errors.join(",")),
        stderr: String::new(),
    }
}

/// One `purs` error at `line`, in the JSON the compiler prints it as.
fn json_error(code: &str, line: usize, file: &str) -> String {
    format!(
        "{{\"errorCode\":\"{code}\",\"message\":\"  Unknown value ggReadAll\\n\",\
         \"filename\":\"/w/{file}\",\
         \"position\":{{\"startLine\":{line},\"startColumn\":8,\"endLine\":{line},\"endColumn\":18}}}}"
    )
}

#[test]
fn fifty_call_sites_of_one_mistake_reach_the_model_as_eight_and_a_count() {
    // `purs` reports one error per SITE, so a name the SDK does not have arrives once for every
    // place the program used it — each carrying the compiler's own paragraph of prose, which is why
    // the measured ~63 bytes a diagnostic is a floor for this arm rather than a typical case.
    let errors: Vec<String> = (1..=50)
        .map(|line| json_error("UnknownName", line, PROGRAM_FILE))
        .collect();
    let failure = classify(&json_report(&errors), PROGRAM_FILE, &[]).expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("fifty diagnostics in the model's own file are its compile error, got {failure:?}");
    };
    assert_eq!(
        message.matches("UnknownName").count(),
        SHOWN,
        "at most {SHOWN} diagnostics reach the model: {message}"
    );
    // Counted honestly, and counted AFTER de-duplication: `purs` located each of these at its own
    // line, so these are fifty distinct renderings rather than one repeated.
    assert!(
        message.ends_with("\n… and 42 more like these."),
        "the count is not what was dropped: {message}"
    );
    assert!(
        message.starts_with("program.purs:1:8: UnknownName\n  Unknown value ggReadAll"),
        "the kept diagnostics are not the ones the compiler reported first: {message}"
    );
}

#[test]
fn a_rejection_the_bound_does_not_reach_is_byte_for_byte_what_it_always_was() {
    // The ordinary turn — two errors — is untouched by the existence of a cap, blank line between
    // them and all. A bound that quietly reformatted the common case would be paid on every turn to
    // save bytes on the rare one.
    let errors = [
        json_error("UnknownName", 7, PROGRAM_FILE),
        json_error("TypesDoNotUnify", 9, PROGRAM_FILE),
    ];
    let failure = classify(&json_report(&errors), PROGRAM_FILE, &[]).expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert_eq!(
        message,
        "program.purs:7:8: UnknownName\n  Unknown value ggReadAll\n\n\
         program.purs:9:8: TypesDoNotUnify\n  Unknown value ggReadAll"
    );
}

#[test]
fn the_band_is_decided_before_anything_is_dropped_for_length() {
    // The invariant a bound must not be able to break: which band a rejection is in comes off the
    // WHOLE set of diagnostics. A parse failure fiftieth in the list — long past anything the model
    // will be shown — still makes this a typo rather than a program written against the wrong
    // surface, because the compiler never got as far as meaning.
    let mut errors: Vec<String> = (1..=49)
        .map(|line| json_error("UnknownName", line, PROGRAM_FILE))
        .collect();
    errors.push(json_error("ErrorParsingModule", 50, PROGRAM_FILE));
    let failure = classify(&json_report(&errors), PROGRAM_FILE, &[]).expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Syntax(_))),
        "a parse failure the cap dropped stopped being one: {failure:?}"
    );

    // And the other direction: fifty diagnostics, none of them in the model's file, are gg's own
    // library tree failing however few of them would have been shown.
    let ours: Vec<String> = (1..=50)
        .map(|line| json_error("UnknownName", line, "Gg/Internal.purs"))
        .collect();
    assert!(
        matches!(
            classify(&json_report(&ours), PROGRAM_FILE, &[]),
            Err(PrepareFailure::Toolchain(_))
        ),
        "a tree that did not compile is gg's artifact failing, not the model's program"
    );
}

#[test]
fn a_code_module_is_checked_on_its_own_and_compiled_with_the_program_that_imports_it() {
    const HELPERS: &str = "module Helpers (greet) where\n\
                           import Prelude\n\
                           \n\
                           greet :: String -> String\n\
                           greet who = \"hello, \" <> who\n";

    // The use that loads it compiles it alone, under the name a program will import it by.
    compile_module("helpers", HELPERS, &PrepareContext::detached())
        .expect("purs compiles a code module");

    // The program then reaches it the way it reaches any other module — an `import` line the model
    // wrote, checked by `purs` against the author's own signature.
    let bundled = program_with(
        "module Solve where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         import Lib.CsvTools as CsvTools\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log (CsvTools.greet \"gg\")\n",
        &[module("CsvTools", HELPERS)],
    );
    assert!(
        bundled.contains("hello, "),
        "the module's own code is in the program's bundle: {bundled}"
    );

    // A program that does not write the line does not compile, however loaded the module is.
    let failure = refusal_with(
        "module Solve where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log (CsvTools.greet \"gg\")\n",
        &[module("CsvTools", HELPERS)],
    );
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert!(
        message.contains("program.purs:8:") && message.contains("UnknownName"),
        "the compiler's own answer to a name nothing brought into scope: {message}"
    );

    // And the call is type-checked, which is the whole of what compiling the module beside the
    // program buys: a wrong argument is a diagnostic rather than a turn.
    let failure = refusal_with(
        "module Solve where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         import Lib.CsvTools as CsvTools\n\
         \n\
         main :: Effect Unit\n\
         main = Console.log (CsvTools.greet 7)\n",
        &[module("CsvTools", HELPERS)],
    );
    assert!(
        matches!(
            &failure,
            PrepareFailure::Program(PrepareError::Compile(message))
                if message.contains("TypesDoNotUnify")
        ),
        "{failure:?}"
    );
}

#[test]
fn a_modules_header_is_rewritten_in_place_and_a_diagnostic_stays_on_the_authors_line() {
    // gg supplies the name and nothing else: the author's export list, their imports and their
    // declarations are the module, and the name they wrote is replaced inside the line they wrote
    // it on.
    assert_eq!(
        headed("module Helpers (greet) where\ngreet = 1\n", "Lib.CsvTools"),
        "module Lib.CsvTools (greet) where\ngreet = 1\n"
    );
    // A source with no header is handed over as it stands, for `purs` to answer.
    assert_eq!(headed("greet = 1\n", "Lib.CsvTools"), "greet = 1\n");

    // The header is found through the arm's code mask, so a `module` an author wrote inside a
    // comment above it is comment, and a comment holding text outside ASCII is read past rather than
    // stumbled over.
    assert_eq!(
        headed(
            "{- Helpers — see `module Prelude` 🚀 -}\nmodule Helpers where\ngreet = 1\n",
            "Lib.CsvTools",
        ),
        "{- Helpers — see `module Prelude` 🚀 -}\nmodule Lib.CsvTools where\ngreet = 1\n"
    );

    // Which is what the check really reports — at line 1, in the author's own file.
    let failure = compile_module("helpers", "greet = ((\n", &PrepareContext::detached())
        .expect_err("a broken module");
    assert!(
        failure.to_string().contains("Lib.Helpers.purs:1:"),
        "located in the author's own file: {failure}"
    );

    // And a mistake four lines down is at line four, because the rewrite added no line.
    let failure = compile_module(
        "helpers",
        "module Helpers where\n\
         import Prelude\n\
         \n\
         greet :: String -> String\n\
         greet who = who + 1\n",
        &PrepareContext::detached(),
    )
    .expect_err("a broken module");
    assert!(
        failure.to_string().contains("Lib.Helpers.purs:5:"),
        "at the line the author wrote it on: {failure}"
    );
}

#[test]
fn a_module_name_two_files_share_is_the_compilers_own_diagnostic() {
    // Nothing refuses a name before the compiler runs. `purs` is given the program first and reports
    // `DuplicateModule` against the first file it was given, so the collision arrives located at
    // line 1 of the model's own file and in the compiler's own words.
    let failure = refusal_with(
        "module Lib.CsvTools where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         \n\
         main :: Effect Unit\n\
         main = pure unit\n",
        &[module(
            "CsvTools",
            "module Helpers where\ngreet :: Int\ngreet = 1\n",
        )],
    );
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert!(
        message.contains("program.purs:1:1: DuplicateModule"),
        "located at line 1 of the model's own file: {message}"
    );

    // A name the shipped library set publishes is the same answer, and it is the case nothing ever
    // guarded: the program is still the first file `purs` was given.
    let failure = refusal(
        "module Data.Maybe where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         \n\
         main :: Effect Unit\n\
         main = pure unit\n",
    );
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert!(
        message.contains("program.purs:1:1: DuplicateModule"),
        "located at line 1 of the model's own file: {message}"
    );
}

#[test]
fn the_manifest_describes_the_tree_that_actually_shipped() {
    // The library set is what a model may import, so it is a study parameter, and this is what holds
    // the manifest to the tree: the package list against the tree's own directories, the module
    // count against `output/`, and the registry the versions were resolved from against the
    // committed lockfile.
    //
    // One run of `build.sh` writes both sides, so this is an AGREEMENT check between two readings of
    // one staging tree rather than a claim about a committed file — a build that staged one package
    // set and described another still fails it. The lockfile half is the interesting one, because it
    // is the only assertion here with a side that is not generated: `spago.lock` is committed, it is
    // what `build.sh` resolved through, and a manifest naming a package set the lockfile does not is
    // a tree resolved against something nobody reviewed.
    let libraries = libraries().expect("the library set this build cut unpacks");
    let mut staged: Vec<String> = std::fs::read_dir(libraries.tree.join("libs"))
        .expect("the unpacked tree has a libs directory")
        .map(|entry| {
            entry
                .expect("readable")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    staged.sort();

    // The SDK is in the tree and is not a package: it is this arm's own PureScript, compiled into the
    // same tarball so that the surface a model is shown in its prompt and the surface its program is
    // compiled against cannot be two vintages.
    assert!(
        staged.contains(&manifest().sdk),
        "the tree carries this arm's SDK at libs/{}",
        manifest().sdk
    );
    staged.retain(|directory| directory != &manifest().sdk);

    let mut declared: Vec<String> = manifest().packages.iter().map(Package::directory).collect();
    declared.sort();
    assert_eq!(staged, declared, "the manifest names what shipped");

    // The compiled half is described too: a tree missing its externs would be a tree every compile
    // rebuilt from scratch, which is 16 s a turn rather than 200 ms.
    let modules = std::fs::read_dir(libraries.tree.join("output"))
        .expect("the unpacked tree has an output directory")
        .filter(|entry| {
            entry
                .as_ref()
                .is_ok_and(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        })
        .count();
    assert_eq!(
        modules,
        manifest().modules,
        "the manifest counts the modules"
    );

    // And the provenance: the registry package set these versions were resolved against, which is
    // the one thing in the manifest that is not observable in the tree.
    let lock = include_str!("../../../../../packages/gg-sandbox-purescript/spago.lock");
    assert!(
        lock.contains(&format!("\"registry\": \"{}\"", manifest().registry)),
        "the manifest names package set {} and the committed lockfile does not",
        manifest().registry
    );

    // The set the owner named specifically, asserted rather than described.
    for package in ["ordered-collections", "transformers", "profunctor-lenses"] {
        assert!(
            manifest()
                .packages
                .iter()
                .any(|entry| entry.name == package),
            "the library set carries {package}"
        );
    }
}

/// A `purs` that is not the release the tree was compiled by is refused by name.
///
/// Externs are a compiler-version-private format, so a drifted toolchain does not degrade — it fails
/// every compile, with diagnostics in gg's own library files. That was already routed to
/// `Toolchain` rather than blamed on the model, which is the right band; what an operator would have
/// read is *purs reported no diagnostic in the program*, which names neither the cause nor the fix.
///
/// Both directions are asserted, and the third is the interesting one: a `--version` this parse did
/// not understand is **not** a mismatch, because `--version` failing while `compile` would have
/// worked is a strange machine rather than a wrong one, and refusing there would ground the arm over
/// a reading rather than over a compiler.
#[test]
fn a_purs_that_did_not_compile_the_tree_is_refused_by_name() {
    let failure = version_verdict("0.15.15", "purs").expect_err("a different release is refused");
    assert!(
        failure.contains("0.15.15") && failure.contains(manifest().purs.as_str()),
        "the message names both releases: {failure}"
    );
    assert!(
        failure.contains(PURS_ENV),
        "and how to point gg at the right one: {failure}"
    );

    assert!(version_verdict(&manifest().purs, "purs").is_ok());
    assert!(
        version_verdict("", "purs").is_ok(),
        "an unread version is not a mismatch"
    );

    // And the compiler this suite is actually running against is the pinned one — which is the same
    // check the first compile of a run makes, made here against the developer's or CI's toolchain.
    check_purs_version(&PrepareContext::detached())
        .expect("the `purs` on PATH is the pinned release");
}

// WHAT USED TO BE HERE: `the_shipped_sdk_is_the_sdk_in_the_working_tree`, and the `sdk_sources`
// walker it needed. It unpacked the tarball and compared `libs/gg-sdk/src` with
// `packages/gg-sandbox-purescript/src` file for file, the `.js` foreign modules included, naming the
// one that had drifted.
//
// It was the gate under this arm's central claim — *the surface a model is shown and the surface it
// is compiled against are one artifact* — and it was the most load-bearing drift check in the whole
// sandbox, because this is the arm where the two halves were most easily separated. The catalogue is
// reflected out of `src/` on every build; a compile resolves `Gg` against the SDK inside the
// TARBALL. While the tarball was committed, an SDK edit reached the prompt immediately and the
// compile only when somebody remembered to re-cut it, and every other gate stayed green: the
// manifest check above compares directory NAMES and counts module directories, neither of which
// moves when a function's body, its lowering, or an added export inside an existing module changes.
//
// The claim is now true by construction rather than by assertion. `crates/gg-sandbox-artifacts/
// purescript` runs `build.sh` whenever `src/` moves, `build.sh` stages that same `src/` into a wiped
// tree with `cp -aL` and compiles it, and `crates/gg` embeds the result — all in the `cargo build`
// that also reflects the catalogue, which reads the tarball this crate just produced. Two vintages
// is not a state this arm can be in, so the comparison had no way left to fail.
//
// That is also why this arm was the reason the artifact crates are ORDINARY `[dependencies]` of
// `crates/gg` rather than a step of its build script: the reflection needs the tarball, so the
// tarball has to be built first, and a dependency edge is how cargo is told that.

#[test]
fn the_shared_tree_is_sealed_and_each_preparation_gets_its_own() {
    let libraries = libraries().expect("the library set this build cut unpacks");

    // Nothing may write to the shared tree: that is what turns the measured `purs` corruption — two
    // agents' programs interleaved into one artifact, every process exiting zero — into a refusal at
    // the moment a compiler reaches for it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let externs = libraries
            .tree
            .join("output")
            .join("Prelude")
            .join("externs.cbor");
        let mode = std::fs::metadata(&externs)
            .expect("the tree carries Prelude's externs")
            .permissions()
            .mode();
        assert_eq!(mode & 0o222, 0, "{} is sealed", externs.display());
    }

    // And two preparations compiling the same source get two trees, which is the property the
    // isolation gate drives at sixteen.
    let first = PrepareContext::detached();
    let second = PrepareContext::detached();
    assert!(compile_program(HELLO, &[], &first).is_ok());
    assert!(compile_program(HELLO, &[], &second).is_ok());
    assert_ne!(
        first.opened_workspace().expect("the compile opened one"),
        second.opened_workspace().expect("the compile opened one"),
    );
}
