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

    let sources: Vec<&&str> = lines.iter().filter(|line| line.ends_with(".cs")).collect();
    assert_eq!(
        sources,
        [&path.join(PROGRAM_FILE).display().to_string().as_str()],
        "a program's compile was given a source that is not the model's own file"
    );
    for library in libraries {
        assert!(
            lines.contains(&format!("-r:{}", library.display()).as_str()),
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
        format!("-r:{}", path.join(SDK_ASSEMBLY).display()).as_str(),
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
    let message = arrangement_failure(
        "gg's own C# SDK did not compile, which is a defect in gg rather than in the program",
        &aborted,
    );
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
    let message = arrangement_failure(
        "csc could not build gg's own C# parse classifier, which is gg's arrangement failing \
         rather than any program's",
        &aborted,
    );
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
