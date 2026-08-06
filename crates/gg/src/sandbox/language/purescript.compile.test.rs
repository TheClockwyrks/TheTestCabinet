//! The host-side PureScript compile: the header rewrite it does before a compiler sees anything, the
//! two verdicts it tells apart, and the agreement between the committed library tree and the manifest
//! that describes it.
//!
//! These spawn a real `purs` and a real `esbuild`, so they are seconds rather than microseconds — but
//! they stop at the JavaScript. What that JavaScript *does* inside the guest is
//! [the substrate tests](super::super::substrate)' subject.

use super::*;
use crate::sandbox::PrepareContext;

/// Compile `source` as a program, or panic with what the toolchain said.
fn program(source: &str) -> String {
    match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("purs did not compile this PureScript: {failure}"),
    }
}

/// The failure compiling `source` as a program produced, or panic because it compiled.
fn refusal(source: &str) -> PrepareFailure {
    match compile_program(source, &PrepareContext::new()) {
        Ok(_) => panic!("expected this PureScript to be refused, and it compiled"),
        Err(failure) => failure,
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
fn a_module_header_is_retargeted_without_moving_a_line() {
    // The ordinary case: a model wrote a header, and the name is replaced where it stands. No line
    // moves, so no diagnostic coordinate has to be corrected.
    let (retargeted, shift) = retarget("module Solve where\nmain = 1\n");
    assert_eq!(retargeted, "module Main where\nmain = 1\n");
    assert_eq!(shift, 0);

    // A qualified name is one name, not a name and two dots.
    let (retargeted, shift) = retarget("module My.Deeply.Nested where\nx = 1\n");
    assert_eq!(retargeted, "module Main where\nx = 1\n");
    assert_eq!(shift, 0);

    // An export list survives untouched: what a program exports is the model's business, and the
    // bundler's complaint about a missing `main` is a better answer than gg quietly widening it.
    let (retargeted, _) = retarget("module Solve\n  ( main\n  ) where\nmain = 1\n");
    assert_eq!(retargeted, "module Main\n  ( main\n  ) where\nmain = 1\n");

    // Already called `Main`: the rewrite is a no-op rather than a special case.
    let (retargeted, shift) = retarget(HELLO);
    assert_eq!(retargeted, HELLO);
    assert_eq!(shift, 0);
}

#[test]
fn comments_before_the_header_are_skipped_rather_than_searched() {
    // A line comment, a block comment, and a NESTED block comment — PureScript's nest — each of
    // which may legally precede the header and each of which may contain the word `module`.
    let (retargeted, shift) = retarget("-- module NotThisOne where\nmodule Solve where\nx = 1\n");
    assert_eq!(
        retargeted,
        "-- module NotThisOne where\nmodule Main where\nx = 1\n"
    );
    assert_eq!(shift, 0);

    let (retargeted, _) = retarget("{- a note -}\nmodule Solve where\nx = 1\n");
    assert_eq!(retargeted, "{- a note -}\nmodule Main where\nx = 1\n");

    let (retargeted, _) =
        retarget("{- outer {- inner -} still outer -}\nmodule Solve where\nx = 1\n");
    assert_eq!(
        retargeted,
        "{- outer {- inner -} still outer -}\nmodule Main where\nx = 1\n"
    );
}

#[test]
fn a_reply_with_no_header_is_given_one_and_charged_a_line() {
    // What a model that thought it was writing a script produces. gg supplies the header rather than
    // refusing, and the one line it costs is what every diagnostic is moved back by.
    let (retargeted, shift) = retarget("import Prelude\nmain = 1\n");
    assert_eq!(retargeted, "module Main where\nimport Prelude\nmain = 1\n");
    assert_eq!(shift, 1);

    // `modulesomething` is an identifier, not a header keyword.
    let (retargeted, shift) = retarget("moduleName = 1\n");
    assert_eq!(retargeted, "module Main where\nmoduleName = 1\n");
    assert_eq!(shift, 1);
}

#[test]
fn a_real_program_compiles_to_a_bundle_that_defines_nothing_globally() {
    let bundled = program(HELLO);

    // An IIFE, because the guest evaluates a program as the body of a function whose parameters are
    // the API objects: module syntax would not parse there, and a top-level declaration would leak
    // into the scope a code module and the program share.
    assert!(
        bundled.starts_with("(() => {"),
        "the bundle is an IIFE: {}",
        &bundled[..bundled.len().min(120)]
    );
    assert!(
        !bundled.contains("import "),
        "the bundle carries no module syntax"
    );
    // The library code the program reached is IN the bundle — this is what "no runtime component"
    // means for this arm — and the code it did not reach is not.
    assert!(bundled.contains("console.log"), "the FFI came with it");
    assert!(
        !bundled.contains("Data.Map"),
        "esbuild tree-shook what the program never imported"
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
fn a_diagnostic_in_a_headerless_reply_names_the_line_the_model_wrote() {
    // Line 5 of what the model wrote; line 6 of what purs read. The model reads its own.
    let failure = refusal(
        "import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Class.Console as Console\n\
         \n\
         main = Console.log (1 + \"two\")\n",
    );
    let PrepareFailure::Program(PrepareError::Compile(message)) = &failure else {
        panic!("expected a compile error, got {failure:?}");
    };
    assert!(
        message.contains("program.purs:5:"),
        "moved back over the header gg supplied: {message}"
    );
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
        "module Main (helper) where\n\
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

#[test]
fn a_code_module_compiles_to_a_namespace() {
    let bundled = compile_module(
        "module Helpers (greet) where\n\
         import Prelude\n\
         \n\
         greet :: String -> String\n\
         greet who = \"hello, \" <> who\n",
        &PrepareContext::new(),
    )
    .expect("purs compiles a code module");

    // The last statement hands the namespace back, because that is the protocol `lib.<key>` needs:
    // the guest evaluates this as a function body and binds whatever it returns.
    assert!(
        bundled
            .trim_end()
            .ends_with(&format!("return {MODULE_GLOBAL};")),
        "the module hands its namespace back: {}",
        &bundled[bundled.len().saturating_sub(120)..]
    );
    assert!(
        bundled.contains("greet"),
        "and the namespace has the export"
    );
}

#[test]
fn the_manifest_describes_the_tree_that_actually_shipped() {
    // The library set is what a model may import, so it is a study parameter. Nothing regenerates
    // this tarball in CI — it needs `purs` and the registry — so what holds the two together is this:
    // the manifest's package list is compared with the tree's own directories, and a tree rebuilt
    // with a different set and committed without its manifest fails here.
    let libraries = libraries().expect("the committed library set unpacks");
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

#[test]
fn the_shared_tree_is_sealed_and_each_preparation_gets_its_own() {
    let libraries = libraries().expect("the committed library set unpacks");

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
    let first = PrepareContext::new();
    let second = PrepareContext::new();
    assert!(compile_program(HELLO, &first).is_ok());
    assert!(compile_program(HELLO, &second).is_ok());
    assert_ne!(
        first.opened_workspace().expect("the compile opened one"),
        second.opened_workspace().expect("the compile opened one"),
    );
}
