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
