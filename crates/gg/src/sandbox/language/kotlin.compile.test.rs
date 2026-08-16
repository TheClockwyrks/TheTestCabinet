//! The parts of the Kotlin compile that are **decisions rather than compilers**: the toolchain pin,
//! the diagnostic bands and the generated entry class. Nothing here starts a JVM, which is why every
//! case in this file runs in microseconds.
//!
//! Two things it deliberately no longer holds. The sixteen-way isolation gate lived here while this
//! arm had no wire id for [the seam's own gate](crate::sandbox::language::isolation) to reach it by;
//! now that it is registered, that gate drives both halves of this arm along with every other
//! language's, and a second copy would be 32 real builds asserting a property already asserted. And
//! the generated entry class is [shared with the Java arm](crate::sandbox::language::jvm) and
//! asserted there — what is left here is the one line this arm adds to it.

use super::*;

/// The pins the shell side of this arm reads.
const VERSION_SH: &str =
    include_str!("../../../../../packages/gg-sandbox-kotlin/kotlin-version.sh");

/// The script this arm's jars are installed by, on a developer's or CI machine.
const INSTALL_SH: &str = include_str!("../../../../../scripts/ci/install-kotlin.sh");

#[test]
fn the_rust_and_shell_halves_of_the_toolchain_pin_agree() {
    // Two files name this version because two worlds install it: `kotlin-version.sh` is what
    // `scripts/ci/install-kotlin.sh` and `containers/gg-toolchains/Dockerfile` read, and the
    // manifest is what gg's own messages, its shared-directory key and its handshake read. A drift
    // between them is a gg refusing every daemon it starts, on a machine that installed exactly what
    // it was told to.
    assert!(
        VERSION_SH.contains(&format!("KOTLIN_VERSION=\"{}\"", compiler_version())),
        "kotlin-version.sh pins a different Kotlin from checkers/kotlin.toolchain.json ({})",
        compiler_version(),
    );
    // And every Kotlin jar the shell installs is that release's, so a half-updated list is a failing
    // test rather than a classpath mixing two of them. `kotlin-reflect` is deliberately outside the
    // rule: the compiler's own POM pins it at an older release than the compiler, and following the
    // compiler's version there would install a jar that does not exist.
    let mixed: Vec<&str> = VERSION_SH
        .lines()
        .filter(|line| line.starts_with("org.jetbrains.kotlin:"))
        .filter(|line| !line.starts_with("org.jetbrains.kotlin:kotlin-reflect:"))
        .filter(|line| {
            !line
                .split_whitespace()
                .next()
                .is_some_and(|coordinate| coordinate.ends_with(compiler_version()))
        })
        .collect();
    assert!(
        mixed.is_empty(),
        "Kotlin jars at another version: {mixed:?}"
    );
}

#[test]
fn the_scripting_plugin_is_gone_from_every_place_that_installed_it() {
    // A program on this arm is an ordinary `.kt` file with its own `fun main()`, so the reason the
    // scripting plugin existed — Kotlin refusing `object`, `interface`, `enum class`, `typealias`
    // and `private fun` as LOCAL declarations inside a wrapper gg wrote — is gone with the wrapper.
    // Four jars, a `kotlin-home` directory and a compiler flag went with it, and this is the gate
    // that keeps any one of them from drifting back in unnoticed.
    for name in [
        "kotlin-scripting-compiler",
        "kotlin-scripting-common",
        "kotlin-scripting-jvm",
        "KOTLIN_SCRIPTING_JARS",
        "kotlin-home",
    ] {
        assert!(
            !VERSION_SH.contains(name),
            "kotlin-version.sh still names {name}, which belonged to the retired script road",
        );
        assert!(
            !INSTALL_SH.contains(name),
            "install-kotlin.sh still installs {name}, which belonged to the retired script road",
        );
    }
    assert!(
        !FRONT.contains("-Xallow-any-scripts-in-source-roots") && !FRONT.contains("-kotlin-home"),
        "the driver still asks the compiler for a script",
    );
    // And the pinned jars stay, because the compiler's own POM declares them: what went is the
    // PLUGIN, not the compiler.
    assert!(VERSION_SH.contains("kotlin-compiler-embeddable:"));
}

#[test]
fn the_driver_gg_carries_speaks_the_protocol_gg_expects() {
    assert!(
        FRONT.contains(&format!("PROTOCOL = {}", manifest().protocol)),
        "checkers/kotlin.compiler.java speaks a different protocol from kotlin.toolchain.json ({})",
        manifest().protocol,
    );
    // This arm's driver is assembled out of its own front end and the shared JVM backend; a front
    // end run on its own would reach no TeaVM at all.
    let assembled = jvm::driver(FRONT);
    assert!(
        assembled.contains("setStrict(true)")
            && assembled.contains("setTargetType(TeaVMTargetType.WEBASSEMBLY_WASI)"),
        "the Kotlin arm's assembled driver carries the shared TeaVM build",
    );
    assert!(
        FRONT.contains("idea.") && FRONT.contains("setProperty"),
        "the compiler's IntelliJ core is given somewhere of its own to keep its configuration",
    );
    // And the flag that makes a diagnostic carry a stable name, which is what the band split reads.
    assert!(
        FRONT.contains("-Xrender-internal-diagnostic-names"),
        "a diagnostic's own name is what gg bands on, rather than its English",
    );
}

#[test]
fn a_handshake_from_another_protocol_or_another_release_is_refused_by_name() {
    let greeting = |protocol: u32, kotlin: &str| {
        format!("{{\"protocol\":{protocol},\"kotlin\":\"{kotlin}\",\"release\":\"21\"}}")
    };
    handshake(&greeting(manifest().protocol, compiler_version())).expect("the pinned toolchain");

    let refused = handshake(&greeting(manifest().protocol + 1, compiler_version()))
        .expect_err("another protocol");
    assert!(refused.contains("protocol"), "{refused}");

    // The version half is what the Java arm's handshake cannot ask, because this arm's compiler
    // comes out of a directory a script filled: a drifted one would word its diagnostics
    // differently, which is the hardest kind of difference to attribute when two runs disagree.
    let refused =
        handshake(&greeting(manifest().protocol, "1.9.24")).expect_err("another Kotlin release");
    assert!(
        refused.contains("1.9.24") && refused.contains("install-kotlin.sh"),
        "the operator is told what is installed and what to run: {refused}",
    );

    // A version that could not be read at all is deliberately not a mismatch: that is a strange
    // machine rather than a wrong one, and the compile that follows has far more to say about it.
    handshake(&format!(
        "{{\"protocol\":{},\"kotlin\":null}}",
        manifest().protocol
    ))
    .expect("an unreadable version is not a refusal");
}

/// One diagnostic, with everything but the interesting fields filled in.
fn diagnostic(stage: &str, code: Option<&str>, file: Option<&str>, line: usize) -> Diagnostic {
    Diagnostic {
        stage: stage.to_string(),
        error: true,
        code: code.map(ToString::to_string),
        file: file.map(ToString::to_string),
        line,
        column: 5,
        message: "something was wrong".to_string(),
    }
}

#[test]
fn a_diagnostic_is_the_compiler_s_own_uncorrected_coordinate() {
    // NO ARITHMETIC. gg writes nothing in front of a program, so the line the compiler reports is
    // the line the model wrote and there is nothing to subtract — which is what ruling D11 asks of a
    // location and what this arm's `shift` parameter used to violate.
    let located = diagnostic(
        "kotlinc",
        Some("UNRESOLVED_REFERENCE"),
        Some(PROGRAM_FILE),
        4,
    )
    .render(PROGRAM_FILE);
    assert_eq!(located, "Program.kt:4:5: something was wrong");

    // A TeaVM diagnostic has no column — its locations are per statement — so it prints one
    // coordinate rather than two.
    let mut teavm = diagnostic("teavm", None, Some(PROGRAM_FILE), 9);
    teavm.column = 0;
    assert_eq!(
        teavm.render(PROGRAM_FILE),
        "Program.kt:9: something was wrong"
    );

    // A module's diagnostics say `Module.kt`, so an author of a code skill is not told the line is
    // in a program.
    assert_eq!(
        diagnostic("kotlinc", None, Some(MODULE_FILE), 2).render(MODULE_FILE),
        "Module.kt:2:5: something was wrong",
    );
}

#[test]
fn the_compilers_own_diagnostic_names_decide_which_band_a_refusal_is() {
    let report = |diagnostics: Vec<Diagnostic>| Report {
        internal: None,
        diagnostics,
    };

    // The parser could not read it.
    let failure = verdict(
        &report(vec![diagnostic(
            "kotlinc",
            Some("SYNTAX"),
            Some(PROGRAM_FILE),
            2,
        )]),
        PROGRAM_FILE,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Syntax(_))),
        "{failure:?}",
    );

    // It was read whole and rejected, which is the other band.
    let failure = verdict(
        &report(vec![diagnostic(
            "kotlinc",
            Some("UNRESOLVED_REFERENCE"),
            Some(PROGRAM_FILE),
            2,
        )]),
        PROGRAM_FILE,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Compile(_))),
        "{failure:?}",
    );

    // A parse failure anywhere is the whole verdict: the compiler never got as far as meaning, so
    // whatever else it said is downstream of text it could not read.
    let failure = verdict(
        &report(vec![
            diagnostic(
                "kotlinc",
                Some("MUST_BE_INITIALIZED"),
                Some(PROGRAM_FILE),
                2,
            ),
            diagnostic("kotlinc", Some("SYNTAX"), Some(PROGRAM_FILE), 3),
        ]),
        PROGRAM_FILE,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Syntax(_))),
        "{failure:?}",
    );

    // A warning is not a refusal.
    let mut warning = diagnostic("kotlinc", Some("UNUSED_VARIABLE"), Some(PROGRAM_FILE), 2);
    warning.error = false;
    verdict(&report(vec![warning]), PROGRAM_FILE).expect("a warning is not a verdict");
}

#[test]
fn a_refusal_about_gg_s_own_entry_class_quotes_the_convention_back() {
    // gg's entry class names the model's own `main`, so the one thing that can go wrong in it is
    // that the model declared a different shape. That is a SHAPE REFUSAL shown to the model — ruling
    // D4 — rather than a toolchain failure nobody is told about.
    let failure = verdict(
        &Report {
            internal: None,
            diagnostics: vec![diagnostic(
                "javac",
                Some("compiler.err.cant.resolve.location"),
                Some(ENTRY_FILE),
                7,
            )],
        },
        PROGRAM_FILE,
    )
    .expect_err("refused");
    assert!(
        matches!(
            failure,
            PrepareFailure::Program(PrepareError::Unsupported(_))
        ),
        "{failure:?}",
    );
    let rendered = failure.to_string();
    assert!(rendered.contains("ProgramKt.main()"), "{rendered}");
    assert!(rendered.contains("fun main()"), "{rendered}");
    // The trap worth naming, because it is legal Kotlin: `fun main(args: Array<String>)` compiles to
    // a method gg's call cannot resolve, and a model told only "declare a main" would write it.
    assert!(rendered.contains("Array<String>"), "{rendered}");
}

#[test]
fn a_refusal_about_a_code_module_names_the_key_and_one_about_nobody_s_file_does_not() {
    // A code module's own file names the code this session loaded, which is compiled into the
    // program. The model is told which key to fix or to stop loading, because reporting it to the
    // operator alone would take every turn from then on with nothing said.
    let failure = verdict(
        &Report {
            internal: None,
            diagnostics: vec![diagnostic("kotlinc", None, Some("GgModule_helpers.kt"), 3)],
        },
        PROGRAM_FILE,
    )
    .expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a code module that does not compile is the model's to act on: {failure:?}");
    };
    assert!(rendered.contains("`helpers`"), "{rendered}");

    let failure = verdict(
        &Report {
            internal: None,
            diagnostics: vec![diagnostic("kotlinc", None, Some("Whatever.kt"), 3)],
        },
        PROGRAM_FILE,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Toolchain(_)),
        "a file gg does not write is drift: {failure:?}",
    );
}

#[test]
fn a_refusal_inside_the_standard_library_is_the_model_s_and_says_what_it_reached_through() {
    // The place this arm parts company with the Java one, and the reason is the language rather than
    // a preference: a Java program reaches TeaVM's classlib directly, so a diagnostic in a file the
    // model did not write is gg's own code; a Kotlin program reaches it THROUGH a standard library
    // written in Kotlin, so the same shape is a fact about the program the model wrote.
    let failure = verdict(
        &Report {
            internal: None,
            diagnostics: vec![diagnostic(
                "teavm",
                None,
                Some("kotlin/concurrent/Thread.kt"),
                40,
            )],
        },
        PROGRAM_FILE,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Compile(_))),
        "{failure:?}",
    );
    let rendered = failure.to_string();
    assert!(
        rendered.contains("Program.kt, inside kotlin/concurrent/Thread.kt:40"),
        "the model is told what its own program reached through: {rendered}",
    );

    // TeaVM reports one problem per CALL SITE, so a single unsupported call can arrive dozens of
    // times saying the same thing. What a model can act on is the first few, and it pays tokens for
    // every one of them — so identical renderings are folded and the rest is counted.
    let many: Vec<Diagnostic> = (0..30)
        .map(|line| diagnostic("teavm", None, Some("kotlin/concurrent/Thread.kt"), line))
        .collect();
    let rendered = verdict(
        &Report {
            internal: None,
            diagnostics: many,
        },
        PROGRAM_FILE,
    )
    .expect_err("refused")
    .to_string();
    assert_eq!(
        rendered.matches("something was wrong").count(),
        SHOWN,
        "at most {SHOWN} distinct diagnostics reach the model: {rendered}",
    );
    assert!(rendered.contains("and 22 more"), "{rendered}");
}

#[test]
fn the_entry_class_calls_the_model_s_own_main_and_carries_nothing_else() {
    let entry = entry_class();
    // THE ONE LINE the two JVM arms differ by. `ProgramKt` is the facade the Kotlin compiler emits
    // `Program.kt`'s top-level declarations into, and `main()` with no arguments is the form
    // `fun main()` produces — the `main(String[])` beside it is synthetic and javac ignores it.
    assert!(
        entry.contains(&format!("{}.main();", source::PROGRAM_CLASS)),
        "{entry}",
    );
    // gg catches nothing: what a model reads is what TeaVM's own runtime printed.
    assert!(!entry.contains("catch"), "{entry}");
    // And it names no exception class of its own. This arm used to add three to a shared list of
    // fifteen, so that TeaVM's dependency analysis would emit their name strings — including the two
    // `kotlin-stdlib` declares, which a list that was only Java's printed a blank header for. What
    // answers that now is `gg.internal.ThrowableNames`, which derives the set from the program being
    // compiled; `kotlin.substrate.test.rs` drives both of those failures through the real toolchain
    // and reads the names off the model-facing body.
    for name in ["SPELLABLE", "KotlinNullPointerException", ".class,"] {
        assert!(
            !entry.contains(name),
            "{name} is still in the entry class:\n{entry}"
        );
    }
}
