//! Unit tests for the pieces of the [Roslyn compile](super) that are pure functions over text —
//! how a finished invocation is classified, and what counts as a diagnostic about the model's
//! program.
//!
//! The compile itself is driven end to end in
//! [`csharp.substrate.test.rs`](super::super::substrate), against a real `csc`. What is here is the
//! decision made *after* one, because that decision has a failure mode nothing end to end would
//! catch: a compiler that fell over is reported to the model as its own mistake.
//!
//! The other half of that is what an **operator** is told when the compiler that fell over was one
//! gg ran for itself, and it is tested here for the same reason and against the same kind of
//! fixture. A `csc` that cannot start is unreachable from an end-to-end test on a machine where the
//! toolchain works — it is by definition the machine where it does not — so the invocation is
//! spelled out as the [`report`] the crash really produced: `ok=false`, killed by a signal, an
//! empty stdout and everything the runtime had to say on stderr.
//!
//! Three claims here are asked of the real compiler, and have to be. What gg writes into a response
//! file is only correct if Roslyn's own lexer reads it back the way gg meant it, and the defect that
//! makes that worth asserting was gg guessing at that lexer. So
//! [`every_path_holding_a_space_really_compiles`] drives one real `csc` with every path in the
//! invocation — the workspace and the toolchain root both — under a directory whose name holds a
//! space, [`a_workspace_whose_path_holds_a_separator_really_compiles`] does the same for the two
//! characters `-pathmap` reads as its own, and
//! [`a_reference_gg_could_not_supply_is_really_reported_as_ggs_own`] drives one into an arrangement
//! diagnostic and reads the band back. Everything around them reads what gg wrote.

use super::*;

/// A finished invocation, spelled out, so a case reads as the thing it is testing.
fn report(ok: bool, status: &str, stdout: &str, stderr: &str) -> CompilerReport {
    CompilerReport {
        ok,
        code: ok.then_some(0),
        status: status.to_string(),
        stdout: stdout.to_string(),
        stderr: stderr.to_string(),
    }
}

#[test]
fn a_compiler_that_succeeded_is_not_a_failure_whatever_it_printed() {
    // Roslyn prints warnings on a successful compile, and a warning is not a verdict: a program that
    // built is a program that runs.
    let warned = report(
        true,
        "exited with status 0",
        "program.cs(3,9): warning CS0219: The variable 'unused' is assigned but its value is never used",
        "",
    );
    assert!(
        verdict(&warned).is_ok(),
        "a successful compile with warnings was treated as a failure"
    );
}

#[test]
fn a_rejected_program_is_the_models_and_carries_only_roslyns_own_errors() {
    // Two things are dropped and neither is a nicety. The banner and the blank line are not
    // diagnostics at all. The **warning** is: it is Roslyn's own format, it is located in the
    // model's own file, and it is still dropped — a model's program is not being reviewed, and this
    // arm compiles with `-nullable:enable` and no `-nowarn`, so a program refused for one reason can
    // otherwise arrive trailing a nullable-annotation tail as long as itself.
    let rejected = report(
        false,
        "exited with status 1",
        "Microsoft (R) Visual C# Compiler\n\
         program.cs(3,17): error CS0029: Cannot implicitly convert type 'string' to 'int'\n\
         program.cs(4,9): warning CS0168: The variable 'x' is declared but never used\n\
         \n",
        "",
    );
    match verdict(&rejected) {
        Err(PrepareFailure::Program(PrepareError::Compile(diagnostic))) => {
            assert_eq!(
                diagnostic,
                "program.cs(3,17): error CS0029: Cannot implicitly convert type 'string' to 'int'",
                "the banner, the blank line or a warning survived into what the model reads"
            );
        }
        other => panic!("a rejected program is the model's compile error, not {other:?}"),
    }
}

#[test]
fn a_compile_that_failed_while_only_warning_about_the_program_is_never_the_models() {
    // The band consequence of dropping warnings, and it is the safe direction. The compilation
    // failed and the only thing `csc` had to say about the model's file was an opinion about a
    // nullable annotation. Counting that opinion as "the model has diagnostics" would hand a model a
    // warning it cannot act on for a failure that was never its.
    let rejected = report(
        false,
        "exited with status 1",
        "program.cs(4,9): warning CS8600: Converting null literal or possible null value\n",
        "",
    );
    match verdict(&rejected) {
        Err(PrepareFailure::Toolchain(message)) => assert!(
            message.contains("without reporting a diagnostic"),
            "the failure does not say that nothing was reported: {message}"
        ),
        other => panic!("a failure nobody reported an error for is not the model's: {other:?}"),
    }
}

#[test]
fn fifty_call_sites_of_one_mistake_reach_the_model_as_eight_and_a_count() {
    // The measurement this bound exists for: one misremembered SDK name called at fifty call sites
    // is 4840 bytes across 50 lines of the same sentence, and a model pays for every one of them in
    // this turn's request and in every request after it.
    let mut stdout = String::new();
    for line in 1..=50 {
        stdout.push_str(&format!(
            "program.cs({line},9): error CS0117: 'Fs' does not contain a definition for 'ReadAll'\n"
        ));
    }
    let Err(PrepareFailure::Program(PrepareError::Compile(diagnostic))) =
        verdict(&report(false, "exited with status 1", &stdout, ""))
    else {
        panic!("fifty diagnostics about the model's own file are the model's compile error");
    };
    assert_eq!(
        diagnostic.matches("does not contain a definition").count(),
        SHOWN,
        "at most {SHOWN} diagnostics reach the model: {diagnostic}"
    );
    // Counted honestly, and counted AFTER de-duplication: these are fifty distinct renderings
    // because Roslyn located each at its own line, so eight are shown and forty-two are counted.
    assert!(
        diagnostic.ends_with("\n… and 42 more like these."),
        "the count is not what was dropped: {diagnostic}"
    );
    // And what it did show is the first eight, unaltered, in the order `csc` reported them.
    assert!(
        diagnostic.starts_with(
            "program.cs(1,9): error CS0117: 'Fs' does not contain a definition for 'ReadAll'\n\
             program.cs(2,9): error CS0117: 'Fs' does not contain a definition for 'ReadAll'\n"
        ),
        "the kept diagnostics are not the ones the compiler reported first: {diagnostic}"
    );
}

#[test]
fn a_rejection_the_bound_does_not_reach_is_byte_for_byte_what_it_always_was() {
    // The ordinary turn — a handful of errors — must be unchanged by the existence of a cap, down
    // to the separator. A bound that quietly reformats the common case would be paid on every turn
    // to save bytes on the rare one.
    let stdout = "program.cs(3,17): error CS0029: Cannot implicitly convert type 'string' to 'int'\n\
                  program.cs(9,5): error CS0103: The name 'gg' does not exist in the current context\n";
    let Err(PrepareFailure::Program(PrepareError::Compile(diagnostic))) =
        verdict(&report(false, "exited with status 1", stdout, ""))
    else {
        panic!("two diagnostics about the model's own file are the model's compile error");
    };
    assert_eq!(diagnostic, stdout.trim_end());
}

#[test]
fn a_programs_compile_reads_the_models_file_and_nothing_else() {
    // Why no diagnostic a program's compile produces can be located anywhere but the model's own
    // file: nothing else is in the invocation. gg's SDK and every code module in scope are `-r:`
    // references, which is availability and puts no name in the program's scope, so a defect in
    // gg's own C# earns its diagnostic where the SDK is built rather than in front of a model.
    let root = tempfile::tempdir().expect("a temporary directory");
    let path = root.path();
    let references = path.join("ref");
    std::fs::create_dir_all(&references).expect("a reference directory");
    std::fs::write(references.join("System.Runtime.dll"), "").expect("a reference assembly");

    let libraries = [
        path.join(SDK_ASSEMBLY),
        path.join(module_assembly("CsvTools")),
    ];
    let rendered = response_file(
        path,
        Target::Exe,
        path,
        &libraries,
        &[path.join(PROGRAM_FILE)],
        &path.join(PROGRAM_ASSEMBLY),
    )
    .expect("the response file renders");
    let lines: Vec<&str> = rendered.lines().collect();

    // Every path a line carries is quoted, so a source line is the file inside a pair of them.
    let sources: Vec<&&str> = lines
        .iter()
        .filter(|line| line.ends_with(".cs\""))
        .collect();
    assert_eq!(
        sources,
        [&format!("\"{}\"", path.join(PROGRAM_FILE).display()).as_str()],
        "a program's compile was given a source that is not the model's own file"
    );
    for library in libraries {
        assert!(
            lines.contains(&format!("-r:\"{}\"", library.display()).as_str()),
            "gg's own library is not a reference: {rendered}"
        );
    }
    // The module library is named for the binding, so the reference the compiler is given, the
    // resource the guest registers and the namespace a program writes are one string.
    assert_eq!(module_assembly("CsvTools"), "lib.CsvTools.dll");
    assert_eq!(response_name(PROGRAM_ASSEMBLY), "GgProgram.rsp");
}

#[test]
fn a_diagnostic_with_no_location_is_still_the_models() {
    // `CS1729` and its like are reported without a `file(line,col)` prefix. They are still Roslyn
    // telling gg what it thought of the **program** rather than a compiler falling over, so they
    // reach the model. A location is not what decides that: the codes that describe gg's own
    // arrangement are unlocated too, and the case below asserts that those go the other way.
    let rejected = report(
        false,
        "exited with status 1",
        "error CS1729: 'Program' does not contain a constructor that takes 1 arguments\n",
        "",
    );
    assert!(
        matches!(
            verdict(&rejected),
            Err(PrepareFailure::Program(PrepareError::Compile(ref diagnostic)))
                if diagnostic.starts_with("error CS1729")
        ),
        "an unlocated diagnostic did not reach the model"
    );
}

/// **A diagnostic about gg's own arrangement is never the model's**, whatever else the invocation
/// said.
///
/// The four codes are one fact each about who supplied what, and gg supplied all of it. A model
/// handed one of them reads a sentence about a file it did not write, a reference it did not name,
/// or a path it does not know, and there is nothing in its program to change.
#[test]
fn a_diagnostic_about_ggs_own_arrangement_is_a_toolchain_failure() {
    for (code, sentence) in [
        (
            "CS0006",
            "Metadata file '/tmp/gg/Gg.dll' could not be found",
        ),
        (
            "CS1504",
            "Source file '/tmp/gg/program.cs' could not be opened (Permission denied)",
        ),
        (
            "CS2001",
            "Source file '/tmp/gg/program.cs' could not be found.",
        ),
        (
            "CS2012",
            "Cannot open '/tmp/gg/output/GgProgram.dll' for writing",
        ),
    ] {
        let arranged = report(
            false,
            "exited with status 1",
            &format!("error {code}: {sentence}\n"),
            "",
        );
        match verdict(&arranged) {
            Err(PrepareFailure::Toolchain(message)) => {
                assert!(
                    message.contains("exited with status 1") && message.contains(sentence),
                    "{code}'s report does not carry what an operator needs: {message}"
                );
            }
            other => {
                panic!("{code} describes gg's arrangement and is not the model's, not {other:?}")
            }
        }
    }

    // Every code the table names is one this arm really acts on, so a code added to it without a
    // reader would be caught here rather than looking implemented.
    for code in ARRANGEMENT_CODES {
        assert!(
            is_arrangement(&format!("error {code}: something")),
            "{code} is listed as gg's arrangement and is not recognised as one"
        );
    }
    assert!(!is_arrangement(
        "program.cs(3,17): error CS0029: Cannot implicitly convert type 'string' to 'int'"
    ));
    assert!(!is_arrangement(
        "error CS1729: 'Program' does not contain a constructor that takes 1 arguments"
    ));
    // A location does not change what a code means. Roslyn locates `CS2012` at the output file when
    // it has one to name, and it is still gg's path.
    assert!(is_arrangement(
        "GgProgram.dll(1,1): error CS2012: Cannot open 'GgProgram.dll' for writing"
    ));
}

/// **One arrangement diagnostic makes the whole invocation gg's**, beside real diagnostics in the
/// model's own file.
///
/// This is the assertion a partial fix fails. `csc` reads a response file whose paths
/// [arrived in pieces](super::quoted) and reports both at once: the source it could not find, and
/// every name in the program that did not resolve because a reference went with it. Handing back the
/// located half sends a model rewriting a program that compiles.
#[test]
fn an_arrangement_diagnostic_decides_the_whole_invocation() {
    let mixed = report(
        false,
        "exited with status 1",
        "program.cs(3,17): error CS0246: The type or namespace name 'Gg' could not be found\n\
         error CS0006: Metadata file '/tmp/gg dir/Gg.dll' could not be found\n\
         program.cs(4,1): error CS0103: The name 'Views' does not exist in the current context\n",
        "",
    );
    match verdict(&mixed) {
        Err(PrepareFailure::Toolchain(message)) => assert!(
            message.contains("Metadata file"),
            "the report drops what actually failed: {message}"
        ),
        other => panic!(
            "a compile whose references gg failed to supply is gg's, not {other:?}. Everything else \
             the compiler said follows from the reference it never read."
        ),
    }
}

#[test]
fn a_compiler_that_said_nothing_is_never_reported_as_the_models_mistake() {
    // The failure this whole split exists for. A segfault, a kill, a missing runtime: the compiler
    // never read the program, so the model has nothing to fix and must not be told it does.
    let crashed = report(false, "was killed by signal 11", "", "Segmentation fault\n");
    match verdict(&crashed) {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(
                message.contains("was killed by signal 11") && message.contains("Segmentation"),
                "the toolchain failure does not carry what an operator needs: {message}"
            );
        }
        other => panic!("a crashed compiler is a toolchain failure, not {other:?}"),
    }

    // And a non-zero exit whose output is only prose is the same case: something went wrong that
    // Roslyn did not describe in its own diagnostic format.
    let confused = report(
        false,
        "exited with status 1",
        "The specified framework 'Microsoft.NETCore.App', version '10.0.0' was not found.\n",
        "",
    );
    assert!(
        matches!(verdict(&confused), Err(PrepareFailure::Toolchain(_))),
        "a launcher that could not find its runtime was reported as the model's mistake"
    );
}

#[test]
fn what_counts_as_a_diagnostic_is_roslyns_own_error_format_and_nothing_else() {
    assert!(is_error(
        "program.cs(3,17): error CS0029: Cannot implicitly convert type 'string' to 'int'"
    ));
    // An arrangement code is Roslyn's error format, so it is one of these. Whose failure it is gets
    // decided in `verdict`, over the code, and the cases above assert that separately.
    assert!(is_error("error CS2001: Source file could not be found"));
    assert!(!is_error(""));
    assert!(!is_error("Microsoft (R) Visual C# Compiler version 5.0.0"));
    assert!(!is_error("Copyright (C) Microsoft Corporation."));
    // A warning is Roslyn's own format and is deliberately not a diagnostic this arm acts on: it is
    // neither shown to the model nor counted when deciding whose failure the compilation was.
    assert!(!is_error("program.cs(1,1): warning CS8321: unused"));
    assert!(!is_error(
        "program.cs(4,9): warning CS8600: Converting null literal or possible null value"
    ));
    // A model's own source quoted back at it must not be mistaken for a diagnostic — a program
    // whose string literal happens to read like one would otherwise put its own text in front of
    // itself.
    assert!(!is_error("Console.WriteLine(\"error CS0029: no\");"));
}

#[test]
fn the_toolchain_is_only_accepted_when_all_four_of_its_parts_are_there() {
    // The failure a partial tree produces is the worst kind: `dotnet` starts, `csc` is missing, and
    // what a model would be told is that its program did not compile.
    let root = tempfile::tempdir().expect("a temporary directory");
    let path = root.path();
    assert!(!usable(path), "an empty directory is not a .NET toolchain");

    std::fs::create_dir_all(path.join("dotnet")).expect("the launcher's directory");
    std::fs::write(path.join(LAUNCHER), "").expect("the launcher");
    assert!(!usable(path), "a launcher alone is not a .NET toolchain");

    std::fs::create_dir_all(path.join("roslyn/bincore")).expect("the compiler's directory");
    std::fs::write(path.join("roslyn/bincore/csc.dll"), "").expect("the compiler");
    assert!(
        !usable(path),
        "a compiler with no reference assemblies is not a .NET toolchain"
    );

    std::fs::create_dir_all(path.join("ref")).expect("the reference directory");
    // Everything a link check can see is now in place, and this tree still cannot compile anything:
    // .NET `dlopen`s ICU as it starts, the run image supplies none, and what the toolchain has not
    // vendored nothing will supply. A tree accepted here is a `csc` that SIGABRTs before it reads
    // the model's program, reported to the model as its own mistake — the exact failure the three
    // checks above exist to prevent, one layer further down.
    assert!(
        !usable(path),
        "a tree carrying none of the libraries the run image lacks was accepted as a toolchain"
    );

    // The directory alone is not the thing that makes `csc` start, and the two really do come apart:
    // the installer creates `lib/` before it fills it, so an install that fell over in between — no
    // `ar` on the machine, a fetch that failed — leaves this exact shape. Measured on an image with
    // no `binutils`, where the empty directory was accepted and the arm aborted anyway.
    std::fs::create_dir_all(path.join(LIBRARY_DIRECTORY)).expect("the vendored library directory");
    assert!(
        !usable(path),
        "an empty library directory was accepted as the libraries the run image lacks"
    );

    // Two of the three, which is what a tree that borrowed the Swift arm's closure would hold:
    // that arm vendors `libicuuc` and `libicudata` for `libxml2` and not the `libicui18n` .NET also
    // opens, so the near miss has to fail as loudly as the empty directory.
    for soname in ["libicuuc", "libicudata"] {
        std::fs::write(
            path.join(LIBRARY_DIRECTORY).join(format!("{soname}.so.72")),
            "",
        )
        .expect("a vendored library");
    }
    assert!(
        !usable(path),
        "a tree carrying two of the three libraries .NET opens was accepted"
    );

    // The version is deliberately not gg's to know — the installer resolves it from the
    // distribution's own index — so the match is by soname prefix and any version completes the
    // tree.
    std::fs::write(path.join(LIBRARY_DIRECTORY).join("libicui18n.so.72"), "")
        .expect("the last vendored library");
    assert!(usable(path), "a complete tree was not accepted");
}

#[test]
fn the_sentence_an_operator_is_shown_names_every_part_a_tree_must_hold() {
    // `usable` refuses silently — an operator who pointed the variable at a tree gg then declined to
    // use reads this sentence and nothing else, so a part it does not enumerate is a part they
    // cannot know is missing. The two lists have to move together.
    let message = missing_toolchain();
    for part in [LAUNCHER, "roslyn/bincore/csc.dll", "ref/", "lib/"] {
        assert!(
            message.contains(part),
            "an operator is not told that {part} is one of the things a tree must hold: {message}"
        );
    }
    assert!(
        message.contains(DOTNET_HOME_ENV),
        "the sentence does not say which variable points at a tree: {message}"
    );
}

#[test]
fn the_response_file_pins_everything_a_compile_must_not_inherit() {
    let root = tempfile::tempdir().expect("a temporary directory");
    let path = root.path();
    let references = path.join("ref/net10.0");
    std::fs::create_dir_all(&references).expect("the reference directory");
    // Written out of alphabetical order, so the sort below is asserting something.
    for name in ["System.Runtime.dll", "System.Linq.dll", "netstandard.dll"] {
        std::fs::write(references.join(name), "").expect("a reference assembly");
    }
    // A file that is not an assembly, which a reference pack really does carry.
    std::fs::write(references.join("System.Linq.xml"), "").expect("a documentation file");

    let rendered = response_file(
        path,
        Target::Exe,
        path,
        &[path.join(SDK_ASSEMBLY)],
        &[path.join("program.cs")],
        &path.join("out.dll"),
    )
    .expect("the response file renders");
    let lines: Vec<&str> = rendered.lines().collect();

    for flag in ["-nostdlib+", "-deterministic", "-nullable:enable"] {
        assert!(
            lines.contains(&flag),
            "{flag} is missing, so a compile would inherit something it must not"
        );
    }
    // `-noconfig` is deliberately NOT here: Roslyn ignores it inside a response file and warns
    // `CS2023`, so it is passed on the command line by `invoke`. A future edit that moves it back
    // here would look correct and would silently let every compile inherit the toolchain's own
    // default reference set.
    assert!(
        !lines.contains(&"-noconfig"),
        "-noconfig is in the response file, where Roslyn ignores it"
    );
    assert!(
        lines.contains(&format!("-langversion:{LANGUAGE_VERSION}").as_str()),
        "the language version is not pinned"
    );

    let named: Vec<&&str> = lines
        .iter()
        .filter(|line| line.starts_with("-r:"))
        .collect();
    assert_eq!(
        named.len(),
        4,
        "the documentation file was passed as a reference: {named:?}"
    );
    // The reference pack is sorted, so a compile is a function of the directory's contents rather
    // than of the order a filesystem listed them in. gg's own libraries follow it, in the order
    // they are supplied.
    let mut sorted = named[..3].to_vec();
    sorted.sort();
    assert_eq!(
        named[..3],
        sorted[..],
        "the reference set is not sorted, so a compile depends on directory order"
    );
    assert_eq!(
        *named[3],
        format!("-r:\"{}\"", path.join(SDK_ASSEMBLY).display()).as_str(),
        "gg's own SDK is not the last library named"
    );
}

#[test]
fn a_module_is_compiled_as_a_library_because_a_class_body_has_no_entry_point() {
    let root = tempfile::tempdir().expect("a temporary directory");
    let path = root.path();
    let references = path.join("ref");
    std::fs::create_dir_all(&references).expect("a reference directory");
    std::fs::write(references.join("System.Runtime.dll"), "").expect("a reference assembly");

    let rendered = response_file(
        path,
        Target::Library,
        path,
        &[path.join(SDK_ASSEMBLY)],
        &[path.join("module_Kit.cs")],
        &path.join(module_assembly("Kit")),
    )
    .expect("the response file renders");
    let lines: Vec<&str> = rendered.lines().collect();
    assert!(
        lines.contains(&"-target:library") && !lines.contains(&"-target:exe"),
        "a module's library demands an entry point it has no reason to have"
    );
}

#[test]
fn a_toolchain_with_no_reference_assemblies_is_a_toolchain_failure() {
    let root = tempfile::tempdir().expect("a temporary directory");
    std::fs::create_dir_all(root.path().join("ref")).expect("an empty reference directory");
    match references(root.path()) {
        Err(PrepareFailure::Toolchain(message)) => assert!(
            message.contains("no C# reference assemblies"),
            "the failure does not say what is missing: {message}"
        ),
        other => panic!("an empty reference pack is a toolchain failure, not {other:?}"),
    }
}

#[test]
fn a_runtime_that_could_not_start_is_reported_with_what_it_actually_said() {
    // The live failure this rendering was rewritten for. Run iip2fot2vcy2paazu0rbsve9 died on its
    // first turn because the run image ships no ICU, .NET `dlopen`s it, and the runtime `FailFast`s
    // before any managed code runs. Everything it wrote went to stderr and stdout was empty, so the
    // report — which formatted `stdout` alone — reached the operator as the lead sentence, a colon,
    // a full stop and nothing. Both halves of what the process left behind were in hand and both
    // were discarded.
    let aborted = report(
        false,
        "was killed by signal 6",
        "",
        "Process terminated. Couldn't find a valid ICU package installed on the system. \
         Please install libicu using your package manager and try again. Alternatively you can set \
         the configuration flag System.Globalization.Invariant to true.\n",
    );
    let message = arrangement_failure("gg's own C# SDK did not compile", &aborted);
    assert!(
        message.contains("was killed by signal 6"),
        "the report does not say how the process ended: {message}"
    );
    assert!(
        message.contains("Couldn't find a valid ICU package"),
        "the report does not carry what the runtime said it could not find: {message}"
    );
    // The regression itself, stated as the shape rather than as a string: nothing after the colon.
    let (_, after) = message
        .split_once(':')
        .expect("the lead sentence ends in a colon");
    assert!(
        after.trim().len() > 1,
        "the report is empty after the colon, which is the whole defect: {message}"
    );
}

#[test]
fn the_parse_classifiers_own_failure_carries_the_same_evidence() {
    // The second of the two paths, and it failed the same way for a different reason: it kept the
    // status and dropped the stderr. A half-fixed contract is one an operator cannot rely on, so
    // both paths render through one function and this asserts the second really does.
    let aborted = report(
        false,
        "was killed by signal 6",
        "",
        "Process terminated. Couldn't find a valid ICU package installed on the system.\n",
    );
    let message = arrangement_failure("csc could not build gg's own C# parse classifier", &aborted);
    assert!(
        message.contains("was killed by signal 6") && message.contains("valid ICU package"),
        "the classifier's failure does not carry the status and the stderr: {message}"
    );
}

/// A `dotnet` that dies exactly the way the run image's did: nothing on stdout, the runtime's own
/// account on stderr, and SIGABRT.
///
/// Two lines and then `kill -ABRT $$`, because that is the whole of what `libSystem.Globalization
/// .Native.so` leaves behind when neither ICU it `dlopen`s resolves. A test that stubbed a non-zero
/// *exit* instead would pass against a report that dropped the signal.
#[cfg(unix)]
const ABORTING_LAUNCHER: &str = "#!/bin/sh\n\
     echo 'Process terminated.' >&2\n\
     echo \"Couldn't find a valid ICU package installed on the system.\" >&2\n\
     kill -ABRT $$\n";

/// A tree shaped enough like a .NET toolchain for [`sdk_assembly`] and [`parser`] to get as far as
/// spawning it, whose launcher then cannot start.
///
/// Everything in it is a stub except the launcher, because everything else on the path to the spawn
/// is a *file* to these two functions: `csc.dll` is an argument and a stamp, the two Roslyn
/// assemblies and `csc.runtimeconfig.json` are files [`parser`] copies, and `ref/` needs one `.dll`
/// so [`references`] does not refuse the tree first.
#[cfg(unix)]
fn toolchain_whose_runtime_cannot_start() -> tempfile::TempDir {
    use std::os::unix::fs::PermissionsExt;

    let root = tempfile::tempdir().expect("a temporary directory");
    let path = root.path();
    for directory in ["dotnet", "roslyn/bincore", "ref/stub", LIBRARY_DIRECTORY] {
        std::fs::create_dir_all(path.join(directory)).expect("the tree is created");
    }

    let launcher = path.join(LAUNCHER);
    std::fs::write(&launcher, ABORTING_LAUNCHER).expect("the launcher is written");
    std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755))
        .expect("the launcher is executable");

    for file in [
        "csc.dll",
        "Microsoft.CodeAnalysis.dll",
        "Microsoft.CodeAnalysis.CSharp.dll",
    ] {
        std::fs::write(path.join("roslyn/bincore").join(file), b"stub")
            .expect("a Roslyn assembly is stubbed");
    }
    std::fs::write(path.join("roslyn/bincore/csc.runtimeconfig.json"), "{}")
        .expect("Roslyn's runtime configuration is stubbed");
    std::fs::write(path.join("ref/stub/System.Runtime.dll"), b"stub")
        .expect("a reference assembly is stubbed");
    root
}

/// The SDK build's OWN reporting, driven through the function that does it rather than through the
/// helper it calls.
///
/// The two cases above assert what [`arrangement_failure`] renders. That is not where the defect
/// was: both of these call sites once formatted `report.stdout` inline and never reached the helper
/// at all, so a revert of either leaves those two green. This drives the real `sdk_assembly` against
/// a launcher that aborts, which is the shape of the live failure, and it fails if the call site
/// stops asking for the status and the stderr however good the helper is.
#[cfg(unix)]
#[test]
fn the_sdk_build_reports_a_runtime_that_could_not_start() {
    let toolchain = toolchain_whose_runtime_cannot_start();
    let context = PrepareContext::detached();
    let failure = sdk_assembly(toolchain.path(), &context)
        .expect_err("a launcher that aborts cannot have built gg's SDK");
    assert!(
        failure.contains("gg's own C# SDK did not compile"),
        "the failure is not the one this path reports: {failure}"
    );
    assert!(
        failure.contains("was killed by signal 6"),
        "the call site dropped how the process ended: {failure}"
    );
    assert!(
        failure.contains("Couldn't find a valid ICU package"),
        "the call site dropped what the runtime said it could not find: {failure}"
    );
}

/// The same, for the parse classifier — the second of the two call sites, which kept the status and
/// dropped the stderr.
#[cfg(unix)]
#[test]
fn the_parse_classifiers_build_reports_a_runtime_that_could_not_start() {
    let toolchain = toolchain_whose_runtime_cannot_start();
    let context = PrepareContext::detached();
    let failure = parser(toolchain.path(), &context)
        .expect_err("a launcher that aborts cannot have built the parse classifier");
    assert!(
        failure.contains("gg's own C# parse classifier"),
        "the failure is not the one this path reports: {failure}"
    );
    assert!(
        failure.contains("was killed by signal 6"),
        "the call site dropped how the process ended: {failure}"
    );
    assert!(
        failure.contains("Couldn't find a valid ICU package"),
        "the call site dropped what the runtime said it could not find: {failure}"
    );
}

/// Every `dotnet` this arm spawns is pointed at the libraries the toolchain carries.
///
/// This is the whole of the runtime repair, and it is one line that no other test in this crate can
/// see. Deleting it leaves all eighty-odd C# tests green on any machine that has an ICU of its own —
/// which is every machine `cargo` runs on, by construction, since `.devcontainer/system/apt.sh`
/// declares one. The arm would be exactly as dead in the run images as it was, and the suite exactly
/// as green as it was. So the variable is asserted at the one place it is set, where a third spawn
/// site added later inherits it rather than remembering it.
#[test]
fn every_dotnet_this_arm_runs_is_pointed_at_the_libraries_the_toolchain_carries() {
    let root = std::path::Path::new("/opt/gg/toolchains/dotnet");
    let context = PrepareContext::detached();
    let command = dotnet(root, &context).expect("a dotnet command is built");
    let environment = command.environment();

    assert_eq!(
        environment.get("LD_LIBRARY_PATH").map(String::as_str),
        Some("/opt/gg/toolchains/dotnet/lib"),
        "a dotnet spawned without the toolchain's own lib/ aborts at CLR start-up in the run image",
    );
    assert_eq!(
        environment.get("DOTNET_ROOT").map(String::as_str),
        Some("/opt/gg/toolchains/dotnet/dotnet"),
        "the runtime is resolved inside this tree and not from the machine",
    );
    for (variable, value) in [("DOTNET_CLI_TELEMETRY_OPTOUT", "1"), ("DOTNET_NOLOGO", "1")] {
        assert_eq!(
            environment.get(variable).map(String::as_str),
            Some(value),
            "a first-run banner would be read as part of a compiler's diagnostics",
        );
    }
}

#[test]
fn a_compiler_that_disagreed_with_ggs_own_c_sharp_still_reads_as_its_diagnostics() {
    // The ordinary case these two paths were written for — Roslyn refusing gg's own SDK sources —
    // must be unchanged by carrying the crash evidence. The diagnostics are still there, whole and
    // unbounded, because the reader is an operator reading a defect in gg and wants all of them;
    // what is new is one line above them saying how the process ended.
    let rejected = report(
        false,
        "exited with status 1",
        "Gg/Files.cs(12,20): error CS0246: The type or namespace name 'Strem' could not be found\n",
        "",
    );
    let message = arrangement_failure("gg's own C# SDK did not compile", &rejected);
    assert_eq!(
        message,
        "gg's own C# SDK did not compile: exited with status 1\n\
         Gg/Files.cs(12,20): error CS0246: The type or namespace name 'Strem' could not be found",
        "a compile Roslyn simply refused no longer reads as its own diagnostics"
    );
    // And a compiler that said nothing at all on either stream leaves no dangling separator behind:
    // the status is the whole report, because the status is all there was.
    assert_eq!(
        arrangement_failure(
            "gg's own C# SDK did not compile",
            &report(false, "timed out after 60s", "", "")
        ),
        "gg's own C# SDK did not compile: timed out after 60s",
    );
}

/// How many arguments Roslyn reads one response-file line as.
///
/// Its lexer is the one a shell has: a `"` toggles quoting rather than being a character, and
/// whitespace outside a quoted run ends the token. A line gg means as one argument and this counts as
/// two is a line the compiler will act on as two.
fn arguments(line: &str) -> usize {
    let mut counted = 0;
    let mut quoted = false;
    let mut inside = false;
    for character in line.chars() {
        match character {
            '"' => quoted = !quoted,
            character if character.is_whitespace() && !quoted => {
                inside = false;
                continue;
            }
            _ => {}
        }
        if !inside {
            inside = true;
            counted += 1;
        }
    }
    counted
}

/// **Every path a response file carries is one token**, measured the way Roslyn measures it.
///
/// Roslyn splits a response file on whitespace, and every path this arm writes into one is rooted
/// somewhere gg does not choose the spelling of: the compile workspace under `TMPDIR`, the toolchain
/// under `$HOME`. A developer whose either holds a space had every line of every compile arrive as
/// two arguments, and the compile reported gg's own arrangement as the model's failure on every
/// turn.
#[test]
fn every_path_in_a_response_file_survives_a_space() {
    let root = tempfile::tempdir().expect("a temporary directory");
    let spaced = root.path().join("gg toolchains").join("dotnet home");
    let references = spaced.join("ref/net10.0");
    std::fs::create_dir_all(&references).expect("the reference directory");
    std::fs::write(references.join("System.Runtime.dll"), "").expect("a reference assembly");

    let work = spaced.join("work space");
    let rendered = response_file(
        &spaced,
        Target::Exe,
        &work,
        &[
            spaced.join(SDK_ASSEMBLY),
            spaced.join(module_assembly("Kit")),
        ],
        &[work.join(PROGRAM_FILE)],
        &work.join(PROGRAM_ASSEMBLY),
    )
    .expect("the response file renders");

    for line in rendered.lines() {
        assert!(
            arguments(line) <= 1,
            "this line reaches csc as {} arguments rather than one: {line}",
            arguments(line)
        );
    }

    // And the quotes are around the paths rather than anywhere that made the count come out right:
    // what each line means has to survive too.
    let lines: Vec<&str> = rendered.lines().collect();
    assert!(
        lines.contains(&format!("-out:\"{}\"", work.join(PROGRAM_ASSEMBLY).display()).as_str()),
        "the output path is not quoted whole: {rendered}"
    );
    assert!(
        lines.contains(&format!("-r:\"{}\"", spaced.join(SDK_ASSEMBLY).display()).as_str()),
        "gg's own SDK is not quoted whole: {rendered}"
    );
    assert!(
        lines.contains(&format!("\"{}\"", work.join(PROGRAM_FILE).display()).as_str()),
        "the model's own source is not quoted whole: {rendered}"
    );
    assert!(
        lines.contains(
            &format!(
                "-pathmap:\"{}{sep}\"=\".{sep}\"",
                work.display(),
                sep = std::path::MAIN_SEPARATOR
            )
            .as_str()
        ),
        "the path map is not quoted, so a stack frame would name a path the model cannot open: \
         {rendered}"
    );
}

/// **The `-pathmap` line escapes the two characters that option reads as its own.**
///
/// Roslyn's option parser splits `-pathmap` into `key=value` pairs on `,` and each pair on `=`, and
/// reads a doubled separator as one literal character. Quoting does not reach that parser: the
/// response-file lexer has already stripped the quotes by the time it runs.
#[test]
fn a_path_map_escapes_the_separators_its_own_parser_reads() {
    let root = tempfile::tempdir().expect("a temporary directory");
    let references = root.path().join("ref");
    std::fs::create_dir_all(&references).expect("the reference directory");
    std::fs::write(references.join("System.Runtime.dll"), "").expect("a reference assembly");

    let sep = std::path::MAIN_SEPARATOR;
    let work = root.path().join("gg=prepare, staged").join("work space");
    let rendered = response_file(
        root.path(),
        Target::Exe,
        &work,
        &[],
        &[work.join(PROGRAM_FILE)],
        &work.join(PROGRAM_ASSEMBLY),
    )
    .expect("the response file renders");

    let mapped = rendered
        .lines()
        .find(|line| line.starts_with("-pathmap:"))
        .expect("the response file carries a path map");
    assert_eq!(
        mapped,
        format!(
            "-pathmap:\"{}{sep}\"=\".{sep}\"",
            work.display()
                .to_string()
                .replace(',', ",,")
                .replace('=', "==")
        ),
        "the path map hands its own parser a separator to re-lex on"
    );

    // The source line beside it carries the same path unescaped, because the response-file lexer is
    // the only reader of that one and neither character means anything to it.
    assert!(
        rendered
            .lines()
            .any(|line| line == format!("\"{}\"", work.join(PROGRAM_FILE).display())),
        "the model's own source was escaped for a parser that never reads it: {rendered}"
    );
}

/// A path holding a quote character has no spelling in Roslyn's response-file format, so gg refuses
/// to write one rather than emit a line the compiler will re-lex into something else.
#[test]
fn a_path_that_cannot_be_written_into_a_response_file_is_refused() {
    let root = tempfile::tempdir().expect("a temporary directory");
    let awkward = root.path().join("gg\"s tree");
    let references = awkward.join("ref");
    std::fs::create_dir_all(&references).expect("the reference directory");
    std::fs::write(references.join("System.Runtime.dll"), "").expect("a reference assembly");

    match response_file(
        &awkward,
        Target::Exe,
        &awkward,
        &[],
        &[awkward.join(PROGRAM_FILE)],
        &awkward.join(PROGRAM_ASSEMBLY),
    ) {
        Err(PrepareFailure::Toolchain(message)) => assert!(
            message.contains("quote character") && message.contains(DOTNET_HOME_ENV),
            "an operator is not told which path gg cannot pass, or where to put it instead: \
             {message}"
        ),
        other => panic!("a path gg cannot spell is a toolchain failure, not {other:?}"),
    }
}

/// The **second** producer of a response file on this arm, asserted directly.
///
/// [`parser`] builds its own argument list, and a fix that quoted only [`response_file`] would leave
/// the classifier that runs on every rejection broken on a spaced path. What that costs is silent:
/// the classifier cannot answer, so every typo is reported as a compile error rather than a syntax
/// error and nothing anywhere says why.
#[test]
fn the_parse_classifiers_own_response_file_is_quoted_too() {
    let root = tempfile::tempdir().expect("a temporary directory");
    let spaced = root.path().join("dotnet home");
    let bincore = spaced.join("roslyn/bincore");
    let references = spaced.join("ref");
    std::fs::create_dir_all(&bincore).expect("the compiler directory");
    std::fs::create_dir_all(&references).expect("the reference directory");
    std::fs::write(references.join("System.Runtime.dll"), "").expect("a reference assembly");

    let into = spaced.join("parser tree");
    let rendered = parser_response(&spaced, &bincore, &into, &into.join("Parse.cs"))
        .expect("the classifier's response file renders");
    for line in rendered.lines().filter(|line| line.contains(' ')) {
        assert!(
            line.contains('"'),
            "a path holding a space reaches csc as two arguments: {line}"
        );
    }
    assert!(
        rendered
            .lines()
            .any(|line| line == format!("-out:\"{}\"", into.join(PARSER_ASSEMBLY).display())),
        "the classifier's own output path is not quoted whole: {rendered}"
    );
    assert!(
        rendered
            .lines()
            .any(|line| line == format!("\"{}\"", into.join("Parse.cs").display())),
        "the classifier's own source is not quoted whole: {rendered}"
    );
}

/// A view of the machine's real .NET toolchain under a directory whose name holds a space.
///
/// One symbolic link per top-level entry rather than a copy, because the tree is hundreds of
/// megabytes and every path gg reads out of it — the [launcher](super::LAUNCHER), `roslyn/bincore`,
/// the reference pack, the [vendored libraries](super::LIBRARY_DIRECTORY) — resolves through one.
/// What the compile is then handed is a `-r:` per reference and a launcher path, every one of them
/// holding the space.
///
/// It builds that directory rather than moving `$HOME` or [`DOTNET_HOME_ENV`], because a
/// process-wide environment change is not something a test may make.
fn awkward_toolchain(inside: &std::path::Path, named: &str) -> PathBuf {
    let root = dotnet_home().unwrap_or_else(|| panic!("{}", missing_toolchain()));
    let view = inside.join(named);
    std::fs::create_dir_all(&view).expect("a toolchain root whose path holds a space");
    for entry in std::fs::read_dir(&root).expect("the toolchain tree is readable") {
        let entry = entry.expect("a toolchain entry");
        std::os::unix::fs::symlink(entry.path(), view.join(entry.file_name()))
            .expect("the toolchain entry is linked into the view");
    }
    view
}

/// Compile one program out of `work`, against the toolchain at `root`, and hand back what `csc`
/// said.
fn really_compile(root: &std::path::Path, work: &std::path::Path) -> CompilerReport {
    std::fs::create_dir_all(work).expect("the workspace");
    let program = work.join(PROGRAM_FILE);
    std::fs::write(&program, "System.Console.WriteLine(\"hello\");\n")
        .expect("the program is written");
    let output = work.join(PROGRAM_ASSEMBLY);
    let response = work.join(response_name(PROGRAM_ASSEMBLY));
    std::fs::write(
        &response,
        response_file(root, Target::Exe, work, &[], &[program], &output)
            .expect("the response file renders"),
    )
    .expect("the response file is written");
    invoke(root, &response, &PrepareContext::detached()).expect("csc runs")
}

/// **The claim, asked of the real compiler**: a compile whose every path holds a space produces an
/// assembly.
///
/// Every assertion above reads what gg wrote. This one asks Roslyn, which is the only reader whose
/// answer settles it — the defect was gg guessing at another program's lexer, and a fixture written
/// by the author of the guess proves nothing on its own.
///
/// **Every** path, which is what makes it the whole claim rather than half of it: the workspace gg
/// writes the program and the response file into, and the [toolchain root](awkward_toolchain) every
/// `-r:` and the launcher itself are rooted at. A machine whose `TMPDIR` holds a space and a machine
/// whose `$HOME` does are two different exposures, and the second is the one a developer really has.
#[test]
fn every_path_holding_a_space_really_compiles() {
    let tree = tempfile::tempdir().expect("a temporary directory");
    let root = awkward_toolchain(tree.path(), "dotnet home");
    let work = tree.path().join("gg prepare").join("work space");

    let report = really_compile(&root, &work);
    assert!(
        report.ok,
        "csc could not compile with every path in the invocation holding a space: {}\n{}",
        report.status, report.stdout
    );
    assert!(
        work.join(PROGRAM_ASSEMBLY).exists(),
        "csc reported success and wrote no assembly out of a directory holding a space"
    );
    // And the verdict agrees, which is the half that decides what a model is told.
    assert!(
        verdict(&report).is_ok(),
        "a compile out of a directory holding a space was read as a failure"
    );
}

/// **A workspace path holding `=` or `,` compiles**, asked of the real compiler.
///
/// The two characters `-pathmap` reads as its own, and quoting does not save either: the
/// response-file lexer strips the quotes and hands the option parser a path it then re-lexes into an
/// extra pair or an extra field. Measured before [`path_map`](super::path_map) doubled them, a
/// workspace at `…/gg=prepare/work space` failed the whole invocation with `CS8101` over a program
/// `csc` never read.
#[test]
fn a_workspace_whose_path_holds_a_separator_really_compiles() {
    let tree = tempfile::tempdir().expect("a temporary directory");
    let root = awkward_toolchain(tree.path(), "dotnet home");

    for awkward in ["gg=prepare", "gg,prepare"] {
        let work = tree.path().join(awkward).join("work space");
        let report = really_compile(&root, &work);
        assert!(
            report.ok,
            "csc could not compile out of a workspace named `{awkward}`: {}\n{}",
            report.status, report.stdout
        );
        assert!(
            verdict(&report).is_ok(),
            "a compile out of a workspace named `{awkward}` was read as a failure"
        );
    }
}

/// **A reference gg named and could not supply is really reported as gg's own**, asked of the real
/// compiler.
///
/// The [table](super::ARRANGEMENT_CODES) is a list of codes, and what settles that the list is the
/// right one is Roslyn emitting one of them for a compilation gg arranged wrongly. gg supplies every
/// reference in the invocation — the toolchain's own pack, its SDK, one library per code module in
/// scope — so a library that is not on disk is the miss a swept workspace really produces, and the
/// model's program is faultless throughout.
#[test]
fn a_reference_gg_could_not_supply_is_really_reported_as_ggs_own() {
    let root = dotnet_home().unwrap_or_else(|| panic!("{}", missing_toolchain()));
    let tree = tempfile::tempdir().expect("a temporary directory");
    let work = tree.path().join("work");
    std::fs::create_dir_all(&work).expect("the workspace");

    let program = work.join(PROGRAM_FILE);
    std::fs::write(&program, "System.Console.WriteLine(\"hello\");\n")
        .expect("the program is written");
    let response = work.join(response_name(PROGRAM_ASSEMBLY));
    std::fs::write(
        &response,
        response_file(
            &root,
            Target::Exe,
            &work,
            &[work.join(module_assembly("Swept"))],
            &[program],
            &work.join(PROGRAM_ASSEMBLY),
        )
        .expect("the response file renders"),
    )
    .expect("the response file is written");

    let report = invoke(&root, &response, &PrepareContext::detached()).expect("csc runs");
    assert!(
        report.stdout.contains("CS0006"),
        "csc did not report the missing reference the way this arm's table expects: {}",
        report.stdout
    );
    match verdict(&report) {
        Err(PrepareFailure::Toolchain(message)) => assert!(
            message.contains("CS0006"),
            "the report drops what actually failed: {message}"
        ),
        other => panic!(
            "a reference gg named and did not supply is gg's own, not {other:?}. The program in \
             that invocation compiles."
        ),
    }
}

/// **A code module gg rebuilt beside a program is gg's own failure and never the model's.**
///
/// The one cell of the [cross-arm gate](crate::sandbox::language::rebuilds) that needs Roslyn: it
/// hands this arm's program step a module this workspace holds no build of and that Roslyn refuses,
/// and reads the band of what comes back. What it catches is a rebuild's diagnostic reaching a model
/// under `Compiler error`, over a program that compiles and a file the model never wrote.
#[test]
fn a_code_module_refused_beside_a_program_is_ggs_failure() {
    crate::sandbox::language::rebuilds::gate(test_cabinet_core::gg::GgProgramLanguage::CSharp);
}
