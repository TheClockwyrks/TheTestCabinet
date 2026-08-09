//! The parts of the Java compile that are decisions rather than compilers: the toolchain pin, the
//! diagnostic bands and the generated entry class.
//!
//! What TeaVM's own output is read with — the prelude, the source-map fold and its VLQ — is
//! [shared with the Kotlin arm](crate::sandbox::language::jvm) and asserted there.
//!
//! None of these starts a JVM. [The substrate's tests](super::super::substrate) do, and prove that
//! what is decided here matches what the real toolchain does.

use super::*;

/// The pins the shell side of this arm reads.
const VERSION_SH: &str = include_str!("../../../../../packages/gg-sandbox-java/java-version.sh");

#[test]
fn the_rust_and_shell_halves_of_the_toolchain_pin_agree() {
    // Two files name these versions because two worlds install them: `java-version.sh` is what
    // `scripts/ci/install-java.sh` and `containers/gg-toolchains/Dockerfile` read, and the manifest
    // is what gg's own messages and its shared-directory key read. A drift between them is a gg
    // reporting one TeaVM while running another, which is exactly the kind of thing nobody notices.
    assert!(
        VERSION_SH.contains(&format!("TEAVM_VERSION=\"{}\"", compiler_version())),
        "java-version.sh pins a different TeaVM from checkers/java.toolchain.json ({})",
        compiler_version(),
    );
    assert!(
        VERSION_SH.contains(&format!("JDK_VERSION=\"{}\"", manifest().jdk)),
        "java-version.sh pins a different JDK from checkers/java.toolchain.json ({})",
        manifest().jdk,
    );
    // And every jar the shell installs is the pinned TeaVM's, so a half-updated list is a failing
    // test rather than a classpath mixing two releases.
    let mixed: Vec<&str> = VERSION_SH
        .lines()
        .filter(|line| line.starts_with("org.teavm:"))
        .filter(|line| !line.ends_with(compiler_version()))
        .collect();
    assert!(mixed.is_empty(), "TeaVM jars at another version: {mixed:?}");
}

#[test]
fn the_driver_gg_carries_speaks_the_protocol_gg_expects() {
    // The driver is a single `.java` file gg assembles and runs with the JDK's source launcher, so
    // its protocol constant and the manifest's are the two ends of one number. They cannot be
    // derived from each other — one is Java and one is JSON — so they are compared.
    assert!(
        FRONT.contains(&format!("PROTOCOL = {}", manifest().protocol)),
        "checkers/java.compiler.java speaks a different protocol from java.toolchain.json ({})",
        manifest().protocol,
    );
    // The two settings the study named as mandatory and easy to miss now live in the half both JVM
    // arms run, which is where they are asserted (see `jvm.test.rs`). What is asserted here is that
    // this arm's driver really is assembled out of both halves: a front end run on its own would
    // reach no TeaVM at all.
    let assembled = jvm::driver(FRONT);
    assert!(
        assembled.contains("setStrict(true)")
            && assembled.contains("setJsModuleType(JSModuleType.NONE)"),
        "the Java arm's assembled driver carries the shared TeaVM build",
    );
}

#[test]
fn a_handshake_from_another_protocol_is_refused_by_number() {
    handshake(&format!("{{\"protocol\":{}}}", manifest().protocol)).expect("its own protocol");
    let refused = handshake("{\"protocol\":99}").expect_err("another protocol");
    assert!(refused.contains("99"), "{refused}");
    assert!(
        handshake("not json at all").is_err(),
        "a greeting gg cannot read is a failure rather than a guess"
    );
}

#[test]
fn a_diagnostic_is_located_in_the_model_s_own_coordinates() {
    let diagnostic = Diagnostic {
        stage: "javac".to_string(),
        error: true,
        code: Some("compiler.err.cant.resolve.location".to_string()),
        file: Some(PROGRAM_FILE.to_string()),
        line: 14,
        column: 9,
        message: "cannot find symbol".to_string(),
    };
    // Line 14 of a file whose first 11 lines are gg's wrapper is line 3 of the reply.
    assert_eq!(
        diagnostic.render(PROGRAM_FILE, 11),
        "program.java:3:9: cannot find symbol"
    );
    // A shift that would take a line to zero or below clamps at 1 rather than underflowing: a
    // coordinate inside gg's own header is a diagnostic gg's wrapper caused, and pointing at the
    // model's first line is the least misleading thing to say about it.
    assert_eq!(
        diagnostic.render(PROGRAM_FILE, 40),
        "program.java:1:9: cannot find symbol"
    );

    // TeaVM locates per statement rather than per token, so it prints one coordinate.
    let teavm = Diagnostic {
        stage: "teavm".to_string(),
        error: true,
        code: None,
        file: Some(PROGRAM_FILE.to_string()),
        line: 12,
        column: 0,
        message: "Class java.nio.file.Paths was not found".to_string(),
    };
    assert_eq!(
        teavm.render(PROGRAM_FILE, 11),
        "program.java:1: Class java.nio.file.Paths was not found"
    );
}

#[test]
fn javac_s_own_codes_decide_which_band_a_refusal_is() {
    let of = |code: &str| Diagnostic {
        stage: "javac".to_string(),
        error: true,
        code: Some(code.to_string()),
        file: Some(PROGRAM_FILE.to_string()),
        line: 1,
        column: 1,
        message: String::new(),
    };
    assert!(of("compiler.err.expected").is_parse_error(), "a typo");
    assert!(of("compiler.err.premature.eof").is_parse_error());
    assert!(of("compiler.err.illegal.start.of.expr").is_parse_error());
    // A name that does not resolve is a program written whole against the wrong surface, which is
    // the band a checked arm exists to produce.
    assert!(!of("compiler.err.cant.resolve.location").is_parse_error());
    assert!(!of("compiler.err.prob.found.req").is_parse_error());
    // TeaVM never produces a parse failure: javac already read the program.
    let teavm = Diagnostic {
        stage: "teavm".to_string(),
        error: true,
        code: Some("compiler.err.expected".to_string()),
        file: None,
        line: 0,
        column: 0,
        message: String::new(),
    };
    assert!(!teavm.is_parse_error());
}

#[test]
fn a_refusal_about_gg_s_own_generated_file_is_not_the_model_s_to_fix() {
    let report = Report {
        ok: false,
        internal: None,
        diagnostics: vec![Diagnostic {
            stage: "javac".to_string(),
            error: true,
            code: Some("compiler.err.cant.resolve.location".to_string()),
            file: Some("GgEntry.java".to_string()),
            line: 7,
            column: 1,
            message: "cannot find symbol: class Program".to_string(),
        }],
    };
    let failure = verdict(&report, PROGRAM_FILE, 11).expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Toolchain(_)),
        "gg's own generated code failing is gg's bug, not the model's: {failure:?}"
    );

    // A warning is not a refusal, whatever file it names.
    let report = Report {
        ok: true,
        internal: None,
        diagnostics: vec![Diagnostic {
            stage: "teavm".to_string(),
            error: false,
            code: None,
            file: Some(PROGRAM_FILE.to_string()),
            line: 12,
            column: 0,
            message: "something worth mentioning".to_string(),
        }],
    };
    verdict(&report, PROGRAM_FILE, 11).expect("a warning is not a verdict");
}

#[test]
fn the_entry_class_names_every_exception_it_catches() {
    let entry = entry_for_program();
    for name in CAUGHT {
        assert!(entry.contains(&format!("catch ({name} failure)")), "{name}");
    }
    // The order is what makes the specific name reach the model: a supertype clause first would
    // swallow it, and Java takes the first clause that matches.
    let at = |name: &str| entry.find(name).expect("present");
    assert!(at("ArrayIndexOutOfBoundsException") < at("java.lang.IndexOutOfBoundsException"));
    assert!(at("NumberFormatException") < at("IllegalArgumentException"));
    // A class the list does not name still gets a name, and a runtime that cannot answer gets a
    // sentence rather than the word `null`.
    assert!(entry.contains("catch (Throwable failure)"));
    assert!(entry.contains("a failure whose class this runtime cannot name"));
    // A failure raised by a BINDING is rethrown untouched: the guest classifies a tool failure from
    // what the host said, and re-describing one would hide it behind a Java class nobody wrote.
    assert!(entry.contains(&format!("{FOREIGN_MARKER:?}")));
    // And the entry rethrows rather than swallowing — a program that failed must not be recorded as
    // one that finished, which is what the study measured an earlier draft of this doing.
    assert!(entry.contains("throw seen("));
}

#[test]
fn a_module_bundle_hands_its_namespace_back_and_a_program_does_not() {
    // A plain object, copied off the class TeaVM exported onto: the guest takes what a module
    // evaluates to only if it is an `object`, and a class is a `function` — so handing the export
    // back directly binds an empty namespace and raises nothing.
    let module = Entry::Module.tail();
    assert!(
        module.contains(&format!("Object.keys({})", source::MODULE_GLOBAL)),
        "{module}"
    );
    assert!(module.contains("return $ggNamespace;"), "{module}");
    assert!(!Entry::Program.tail().contains("return $gg"));
    // TeaVM's callback delivers the failure DIRECTLY as its argument. A tail that read
    // `result.exception` instead would report a failed program as a complete success, which the
    // study measured on the Kotlin spike.
    for tail in [Entry::Program.tail(), Entry::Module.tail()] {
        assert!(tail.contains("if (!$ggThrown) return;"), "{tail}");
        assert!(tail.contains("throw $ggThrown;"), "{tail}");
    }
}

/// One TeaVM refusal naming a class it does not carry, at line `12 + index` of the entry file.
///
/// TeaVM's own shape, which is what makes this arm's volume: it reports the missing class once per
/// **call site**, so the same sentence arrives at as many lines as the model wrote calls.
fn unsupported(index: usize) -> Diagnostic {
    Diagnostic {
        stage: "teavm".to_string(),
        error: true,
        code: None,
        file: Some(PROGRAM_FILE.to_string()),
        line: 12 + index,
        column: 0,
        message: "Class java.nio.file.Paths was not found".to_string(),
    }
}

/// A refused build carrying `count` of them.
fn unsupported_report(count: usize) -> Report {
    Report {
        ok: false,
        internal: None,
        diagnostics: (0..count).map(unsupported).collect(),
    }
}

/// What `verdict` shows a model for such a build.
fn compile_text(count: usize) -> String {
    let failure = verdict(&unsupported_report(count), PROGRAM_FILE, 11).expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = failure else {
        panic!("an unsupported class is a compile error");
    };
    rendered
}

/// **A refusal the model can read whole is unchanged.**
///
/// Below the bound the model reads exactly what this arm has always rendered: every diagnostic it is
/// answerable for, in the compiler's order, joined by a blank line, and nothing about what was not
/// shown — because nothing was not shown.
#[test]
fn a_refusal_under_the_bound_is_rendered_exactly_as_it_always_was() {
    let rendered = compile_text(SHOWN);

    let expected: Vec<String> = (0..SHOWN)
        .map(|index| {
            format!(
                "program.java:{}: Class java.nio.file.Paths was not found",
                index + 1
            )
        })
        .collect();
    assert_eq!(rendered, expected.join("\n\n"));
    assert!(
        !rendered.contains("more like these"),
        "a refusal that fitted was told it had been cut: {rendered}"
    );
}

/// **Past the bound the model reads the first few and an honest count of the rest.**
///
/// The count is of what survived de-duplication rather than of what TeaVM said, which is the only
/// count worth printing here: fifty call sites naming one missing class are fifty *distinct*
/// renderings only because they carry fifty different lines, and each of those lines is somewhere
/// the model has to go and delete the same call.
#[test]
fn a_refusal_past_the_bound_keeps_the_first_few_and_counts_the_rest() {
    let rendered = compile_text(50);

    assert!(rendered.starts_with("program.java:1: Class"), "{rendered}");
    assert!(
        rendered.contains(&format!("program.java:{}: Class", SHOWN)),
        "the first {SHOWN} are what the model reads: {rendered}"
    );
    assert!(
        !rendered.contains(&format!("program.java:{}: Class", SHOWN + 1)),
        "a diagnostic past the bound was shown: {rendered}"
    );
    assert!(
        rendered.ends_with(&format!("\n\n… and {} more like these.", 50 - SHOWN)),
        "the count is the honest one, on the arm's own separator: {rendered}"
    );
    // Fifty of these is 5139 bytes uncapped on this arm.
    assert!(
        rendered.len() < 800,
        "the bound did not bound anything: {} bytes",
        rendered.len()
    );
}

/// **Byte-identical renderings are one thing to fix, and are folded before they are counted.**
///
/// TeaVM reports per call site, so two calls on one line of the model's program render identically.
/// Counting those separately would make the closing line an inventory of repetitions rather than of
/// diagnostics.
#[test]
fn identical_renderings_are_folded_before_the_count_is_taken() {
    let report = Report {
        ok: false,
        internal: None,
        diagnostics: (0..50).map(|_| unsupported(0)).collect(),
    };
    let failure = verdict(&report, PROGRAM_FILE, 11).expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = failure else {
        panic!("an unsupported class is a compile error");
    };
    assert_eq!(
        rendered, "program.java:1: Class java.nio.file.Paths was not found",
        "fifty copies of one sentence are one sentence, with nothing left to count: {rendered}"
    );
}

/// **The bound cannot move a verdict from one band to the other.**
///
/// Two decisions are made on the **whole** set before anything is rendered, and each is one the
/// bound must not be able to reach:
///
/// * whether any diagnostic is the model's at all — if none is, the build failed on gg's own
///   generated entry class and is a [`Toolchain`](PrepareFailure::Toolchain) failure the model never
///   sees;
/// * whether any of the model's own is a **parse** failure — which makes the whole verdict
///   [`Syntax`](PrepareError::Syntax), because javac never got as far as meaning.
///
/// The second is the one a cap could plausibly break: a parse error is not required to arrive first,
/// so asking the kept eight instead of all of them would report a program with an unclosed brace as
/// one javac read and disagreed with.
#[test]
fn the_bound_does_not_decide_whose_failure_it_is() {
    // A parse error past the bound still makes the whole verdict a syntax failure.
    let mut diagnostics: Vec<Diagnostic> = (0..50).map(unsupported).collect();
    diagnostics.push(Diagnostic {
        stage: "javac".to_string(),
        error: true,
        code: Some("compiler.err.premature.eof".to_string()),
        file: Some(PROGRAM_FILE.to_string()),
        line: 99,
        column: 1,
        message: "reached end of file while parsing".to_string(),
    });
    let failure = verdict(
        &Report {
            ok: false,
            internal: None,
            diagnostics,
        },
        PROGRAM_FILE,
        11,
    )
    .expect_err("refused");
    let PrepareFailure::Program(PrepareError::Syntax(rendered)) = failure else {
        panic!("a parse failure the bound did not show is still a parse failure");
    };
    // Shown or not, the band is the parser's. Here it is not shown, and the count says so.
    assert!(
        !rendered.contains("reached end of file"),
        "the fifty-first diagnostic was shown: {rendered}"
    );
    assert!(rendered.contains("… and 43 more like these."), "{rendered}");

    // And a build whose diagnostics are all about gg's own generated class is gg's failure however
    // many of them there are.
    let failure = verdict(
        &Report {
            ok: false,
            internal: None,
            diagnostics: (0..50)
                .map(|index| Diagnostic {
                    stage: "javac".to_string(),
                    error: true,
                    code: Some("compiler.err.cant.resolve.location".to_string()),
                    file: Some("GgEntry.java".to_string()),
                    line: 7 + index,
                    column: 1,
                    message: "cannot find symbol: class Program".to_string(),
                })
                .collect(),
        },
        PROGRAM_FILE,
        11,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Toolchain(_)),
        "gg's own generated code failing is gg's bug however loudly it fails: {failure:?}"
    );
}
