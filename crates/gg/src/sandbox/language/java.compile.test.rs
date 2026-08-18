//! The parts of the Java compile that are decisions rather than compilers: the toolchain pin, the
//! diagnostic bands and the generated entry class.
//!
//! One of these starts a JVM and the rest do not; [the substrate's tests](super::super::substrate)
//! are where the real toolchain is driven, and prove that what is decided here matches what it does.
//! The exception is [`a_vm_that_warns_about_its_machine_is_not_read_as_a_greeting`], because what it
//! measures is which of a real VM's two pipes a line comes out of, and there is no way to ask that
//! of anything but a VM.

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
            && assembled.contains("setClassesToPreserve(PRESERVED)")
            && assembled.contains("TeaVMTargetType.WEBASSEMBLY_WASI"),
        "the Java arm's assembled driver carries the shared TeaVM build",
    );
}

#[test]
fn a_handshake_from_another_protocol_is_refused_by_number() {
    handshake(&format!("{{\"protocol\":{}}}", manifest().protocol)).expect("its own protocol");
    let refused = handshake("{\"protocol\":99}").expect_err("another protocol");
    assert!(refused.contains("99"), "{refused}");
    let unreadable = handshake("not json at all").expect_err("a greeting gg cannot read");
    // The line itself, quoted: a parse error alone says a JVM answered wrongly and never what it
    // answered, and the answer that mattered came from somewhere gg did not expect. See
    // `a_vm_that_warns_about_its_machine_is_not_read_as_a_greeting`.
    assert!(
        unreadable.contains("\"not json at all\""),
        "the greeting gg could not read is in the message it reports: {unreadable}"
    );
}

/// **The VM's own logging is not on the pipe the protocol is spoken on** — measured, by provoking a
/// line out of a real JVM and reading which end it came out of.
///
/// This starts JVMs, which nothing else in this file does. It is here rather than next door because
/// the consequence being asserted is [`handshake`]'s, and it is measured on this arm alone because
/// [the launch is shared](jvm::daemon): the Kotlin arm's JVM is started by the same function with a
/// different heap.
#[test]
fn a_vm_that_warns_about_its_machine_is_not_read_as_a_greeting() {
    use crate::sandbox::language::compile::{self, DaemonCommand};

    let toolchain = jvm::toolchain().expect("the JDK and TeaVM jars this arm compiles with");
    let placed = placed().expect("gg's own driver and SDK, unpacked");
    let classpath = format!("{}:{}", placed.sdk.display(), toolchain.classpath);
    // Something to make the VM speak. What this was found by is a *resource* warning — a loaded
    // machine, sixteen preparations compiling at once, a VM with something to say about threads or
    // memory — and that cannot be provoked to order, so a class-data archive stands in for it: gg's
    // own SDK jar is a file that certainly exists and is certainly not one, which every JDK 21 and
    // 25 measured here answers with `[…][warning][cds] The shared archive file has a bad magic
    // number` and then carries on without (`-Xshare` defaults to `auto`). What matters is the class
    // and not the message: every line a VM writes about its own machine goes to the same pipe.
    let bad_archive = format!("-XX:SharedArchiveFile={}", placed.sdk.display());
    // The rest of the arm's own launch: the classpath the driver is run on, the driver, and the
    // classpath it compiles programs against.
    let launch = |mut command: DaemonCommand| {
        command
            .arg(&bad_archive)
            .arg("-cp")
            .arg(&toolchain.classpath)
            .arg(&placed.driver)
            .arg(&classpath);
        let mut daemon = command.start().expect("a JVM starts");
        let first = daemon.reply(START_TIMEOUT).expect("it says something");
        (first, daemon.stderr_tail())
    };

    // 1. Left at the VM's default logging configuration — `all=warning:stdout` — the warning is the
    //    first thing on the reply pipe, gg reads it as the greeting, and refuses a JVM that is
    //    working perfectly. This is the flake, reproduced on demand.
    let (noisy, _) = launch(compile::daemon(&toolchain.java).expect("a daemon of its own"));
    let refused = handshake(&noisy).expect_err("a VM log line is not a greeting");
    assert!(
        noisy.starts_with('[') && noisy.contains("]["),
        "the first line on stdout is the VM's own log line: {noisy:?}"
    );
    assert!(
        refused.contains(&format!("{noisy:?}")),
        "and gg's diagnostic quotes it rather than describing it: {refused}"
    );

    // 2. Started the way the arm really starts one, the greeting is the greeting — and the warning
    //    is not lost, it is on the daemon's stderr, which gg puts on the end of every failure it
    //    reports about that daemon.
    let (quiet, stderr) = launch(jvm::daemon(&toolchain.java, HEAP).expect("a daemon of its own"));
    handshake(&quiet).unwrap_or_else(|error| panic!("a quiet VM's greeting is read: {error}"));
    assert!(
        stderr.contains("archive"),
        "the VM still said it, on the pipe an operator reads: {stderr:?}"
    );
}

/// **A diagnostic is the compiler's own coordinate, uncorrected**, because the file javac read is
/// the file the model wrote and there is nothing in front of it.
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
    assert_eq!(
        diagnostic.render(PROGRAM_FILE),
        "Program.java:14:9: cannot find symbol"
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
        teavm.render(PROGRAM_FILE),
        "Program.java:12: Class java.nio.file.Paths was not found"
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

/// **A refusal about gg's own entry class is the model's shape refusal**, in the words of the
/// convention it broke — because that file names the model's own class and can fail for no other
/// reason. A refusal about anything else gg generated is gg's own and the model never sees it, and
/// one about a code module names the key that module is bound at.
#[test]
fn a_refusal_about_gg_s_own_entry_class_quotes_the_convention_back() {
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
    let failure = verdict(&report, PROGRAM_FILE).expect_err("refused");
    let PrepareFailure::Program(PrepareError::Unsupported(rendered)) = &failure else {
        panic!("a program that did not declare what gg calls is a shape refusal: {failure:?}");
    };
    assert!(
        rendered.contains("public final class Program")
            && rendered.contains("public static void main(String[] args)"),
        "{rendered}"
    );

    // A code module's own compile is where its diagnostics are read, and the refusal names the key
    // the module is bound at: the module is the thing to fix or to stop loading, and a session told
    // nothing would meet it again on every turn.
    let report = Report {
        ok: false,
        internal: None,
        diagnostics: vec![Diagnostic {
            stage: "javac".to_string(),
            error: true,
            code: Some("compiler.err.cant.resolve.location".to_string()),
            file: Some("helpers.java".to_string()),
            line: 4,
            column: 9,
            message: "cannot find symbol".to_string(),
        }],
    };
    let refused = about(
        "helpers",
        verdict(&report, "helpers.java").expect_err("refused"),
    );
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &refused else {
        panic!("a code module that does not compile is the model's to act on: {refused:?}");
    };
    assert!(
        rendered.contains("`helpers`") && rendered.contains("helpers.java:4:9"),
        "{rendered}"
    );
    // A toolchain failure of that same compile stays the operator's: a JVM that would not start is
    // nothing a skill did.
    assert!(
        matches!(
            about("helpers", PrepareFailure::Toolchain("no JVM".to_string())),
            PrepareFailure::Toolchain(_)
        ),
        "a toolchain failure was blamed on a skill"
    );

    // A file nobody named is drift rather than a shape the model can fix, and stays the operator's.
    let report = Report {
        ok: false,
        internal: None,
        diagnostics: vec![Diagnostic {
            stage: "javac".to_string(),
            error: true,
            code: Some("compiler.err.cant.resolve.location".to_string()),
            file: Some("Whatever.java".to_string()),
            line: 1,
            column: 1,
            message: "cannot find symbol".to_string(),
        }],
    };
    let failure = verdict(&report, PROGRAM_FILE).expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Toolchain(_)),
        "a file gg does not write is drift: {failure:?}"
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
    verdict(&report, PROGRAM_FILE).expect("a warning is not a verdict");
}

/// **The generated entry class catches nothing**, which is what ruling D8a asks of every arm: a
/// failure reaches the model as its own runtime's dying words rather than as gg's description of
/// them. It is the world's two exports and a call, and nothing else.
#[test]
fn the_entry_class_catches_nothing_and_names_the_model_s_own_class() {
    let entry = entry_class();
    assert!(
        !entry.contains("catch (") && !entry.contains(" try {"),
        "the entry class intercepts a failure: {entry}"
    );
    assert!(
        entry.contains(&format!("{}.main(new String[0]);", source::PROGRAM_CLASS)),
        "{entry}"
    );
    assert!(entry.contains("@Export(name = \"run\")"), "{entry}");
    assert!(
        entry.contains("@Export(name = \"bound-operations\")"),
        "{entry}"
    );
    // `main` may declare a checked exception — a Java author writes `throws Exception` on one every
    // day — so the export that calls it declares one too.
    assert!(entry.contains("throws Throwable"), "{entry}");
    // It declares no `main` of its own: TeaVM is rooted at the MODEL's class, which is what makes
    // `setClassesToPreserve` load-bearing rather than incidental.
    assert!(
        !entry.contains("static void main("),
        "gg's entry class declares a `main` and would be reachable without the preserve list: \
         {entry}"
    );
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
    let failure = verdict(&unsupported_report(count), PROGRAM_FILE).expect_err("refused");
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
                "Program.java:{}: Class java.nio.file.Paths was not found",
                index + 12
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

    assert!(rendered.starts_with("Program.java:12: Class"), "{rendered}");
    assert!(
        rendered.contains(&format!("Program.java:{}: Class", SHOWN + 11)),
        "the first {SHOWN} are what the model reads: {rendered}"
    );
    assert!(
        !rendered.contains(&format!("Program.java:{}: Class", SHOWN + 12)),
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
    let failure = verdict(&report, PROGRAM_FILE).expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = failure else {
        panic!("an unsupported class is a compile error");
    };
    assert_eq!(
        rendered, "Program.java:12: Class java.nio.file.Paths was not found",
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

    // And a code module's own compile is bounded the same way, because a module that stopped
    // compiling names one problem per call site exactly as a program does. Its own file is what that
    // build's verdict is read against, and the key rides in front of the whole bounded report rather
    // than in front of each diagnostic.
    let failure = about(
        "helpers",
        verdict(
            &Report {
                ok: false,
                internal: None,
                diagnostics: (0..50)
                    .map(|index| Diagnostic {
                        stage: "javac".to_string(),
                        error: true,
                        code: Some("compiler.err.cant.resolve.location".to_string()),
                        file: Some("helpers.java".to_string()),
                        line: 7 + index,
                        column: 1,
                        message: format!("cannot find symbol {index}"),
                    })
                    .collect(),
            },
            "helpers.java",
        )
        .expect_err("refused"),
    );
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a code module that does not compile is the model's to act on: {failure:?}");
    };
    assert!(rendered.contains("`helpers`"), "{rendered}");
    assert!(rendered.contains("… and 42 more like these."), "{rendered}");
}
