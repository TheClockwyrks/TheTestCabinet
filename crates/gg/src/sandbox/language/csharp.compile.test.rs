//! Unit tests for the pieces of the [Roslyn compile](super) that are pure functions over text —
//! how a finished invocation is classified, and what counts as a diagnostic about the model's
//! program.
//!
//! The compile itself is driven end to end in
//! [`csharp.substrate.test.rs`](super::super::substrate), against a real `csc`. What is here is the
//! decision made *after* one, because that decision has a failure mode nothing end to end would
//! catch: a compiler that fell over is reported to the model as its own mistake.

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
fn a_compile_that_failed_in_ggs_sdk_and_only_warned_about_the_program_is_ggs() {
    // The band consequence of dropping warnings, and it is the safe direction. The compilation
    // failed inside gg's own SDK; the only thing `csc` had to say about the model's file was an
    // opinion about a nullable annotation. Counting that opinion as "the model has diagnostics"
    // would hand a model a warning it cannot act on for a failure that was never its.
    let rejected = report(
        false,
        "exited with status 1",
        &format!(
            "{SDK_DIRECTORY}/Files/Files.cs(12,5): error CS0246: The type or namespace name 'Nope' \
             could not be found\n\
             program.cs(4,9): warning CS8600: Converting null literal or possible null value\n"
        ),
        "",
    );
    match verdict(&rejected) {
        Err(PrepareFailure::Toolchain(message)) => assert!(
            message.contains("gg's own C# SDK did not compile") && message.contains("CS0246"),
            "the failure does not name gg's own defect: {message}"
        ),
        other => panic!("a failure in gg's own SDK is not the model's, and got {other:?}"),
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
fn the_band_is_decided_before_anything_is_dropped_for_length() {
    // The invariant a bound must not be able to break: whose failure it is comes off the WHOLE set
    // of diagnostics. Here gg's own SDK is named once, at the very end, past the point any cap
    // reaches — and the model still gets its own errors rather than gg's, because the partition ran
    // before the truncation did.
    let mut stdout = String::new();
    for line in 1..=40 {
        stdout.push_str(&format!(
            "program.cs({line},9): error CS0103: no such name\n"
        ));
    }
    stdout.push_str(&format!(
        "{SDK_DIRECTORY}/Files/Files.cs(12,5): error CS0246: gg's own file\n"
    ));
    let Err(PrepareFailure::Program(PrepareError::Compile(diagnostic))) =
        verdict(&report(false, "exited with status 1", &stdout, ""))
    else {
        panic!("a program with its own diagnostics is the model's, however deep gg's own are");
    };
    assert!(
        !diagnostic.contains(SDK_DIRECTORY),
        "gg's own file reached the model: {diagnostic}"
    );

    // And the other direction: every one of forty errors is in gg's SDK, so it is gg's defect no
    // matter that only eight of them would ever have been shown.
    let ours: String = (1..=40)
        .map(|line| {
            format!("{SDK_DIRECTORY}/Files/Files.cs({line},5): error CS0246: gg's own file\n")
        })
        .collect();
    assert!(
        matches!(
            verdict(&report(false, "exited with status 1", &ours, "")),
            Err(PrepareFailure::Toolchain(_))
        ),
        "forty diagnostics in gg's own SDK are gg's defect whatever the cap would show"
    );
}

#[test]
fn a_diagnostic_with_no_location_is_still_the_models() {
    // `CS2001` and friends are reported without a `file(line,col)` prefix. They are still Roslyn
    // telling gg what it thought of the compilation rather than a compiler falling over, so they
    // reach the model — which is the difference between "gg could not find your source" and a
    // silence the model cannot act on.
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
fn the_toolchain_is_only_accepted_when_all_three_of_its_parts_are_there() {
    // The failure a partial tree produces is the worst kind: `dotnet` starts, `csc` is missing, and
    // what a model would be told is that its program did not compile.
    let root = tempfile::tempdir().expect("a temporary directory");
    let path = root.path();
    assert!(!usable(path), "an empty directory is not a .NET toolchain");

    std::fs::create_dir_all(path.join("dotnet")).expect("the launcher's directory");
    std::fs::write(path.join("dotnet/dotnet"), "").expect("the launcher");
    assert!(!usable(path), "a launcher alone is not a .NET toolchain");

    std::fs::create_dir_all(path.join("roslyn/bincore")).expect("the compiler's directory");
    std::fs::write(path.join("roslyn/bincore/csc.dll"), "").expect("the compiler");
    assert!(
        !usable(path),
        "a compiler with no reference assemblies is not a .NET toolchain"
    );

    std::fs::create_dir_all(path.join("ref")).expect("the reference directory");
    assert!(usable(path), "a complete tree was not accepted");
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

    let sdk = [
        path.join("sdk/Files/Files.cs"),
        path.join("sdk/ToolException.cs"),
    ];
    let rendered = response_file(
        path,
        Target::Exe,
        &sdk,
        &[path.join("module_Kit.cs"), path.join("program.cs")],
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
        3,
        "the documentation file was passed as a reference: {named:?}"
    );
    let mut sorted = named.clone();
    sorted.sort();
    assert_eq!(
        named, sorted,
        "the reference set is not sorted, so a compile depends on directory order"
    );

    // The SDK's sources are compiled with the program, and BEFORE it: they are what makes gg's
    // surface reachable without an assembly the guest would have to carry. A compile that lost
    // them would fail on the model's first `Files.ReadFile` with a diagnostic about the model. The
    // code modules in scope sit between the two, so one may reach another's class and neither can
    // move a line of the model's own file.
    let sources: Vec<String> = lines
        .iter()
        .filter(|line| line.ends_with(".cs"))
        .map(|line| {
            std::path::Path::new(line)
                .strip_prefix(path)
                .expect("every source is inside the workspace")
                .display()
                .to_string()
        })
        .collect();
    assert_eq!(
        sources,
        [
            "sdk/Files/Files.cs",
            "sdk/ToolException.cs",
            "module_Kit.cs",
            "program.cs",
        ],
        "the SDK and the modules are not compiled with the program, in front of it"
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
        &[path.join("sdk/ToolException.cs")],
        &[path.join("module_Kit.cs")],
        &path.join("out.dll"),
    )
    .expect("the response file renders");
    let lines: Vec<&str> = rendered.lines().collect();
    assert!(
        lines.contains(&"-target:library") && !lines.contains(&"-target:exe"),
        "a module's own check demands an entry point it has no reason to have"
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
