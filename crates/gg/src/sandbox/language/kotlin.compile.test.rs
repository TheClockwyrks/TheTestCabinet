//! The parts of the Kotlin compile that are decisions rather than compilers: the toolchain pin, the
//! diagnostic bands, the generated entry class — and the one thing here that *does* start a JVM,
//! because it is the seam's own isolation gate and this arm cannot be inside it yet.
//!
//! What TeaVM's own output is read with — the prelude, the source-map fold and its VLQ — is
//! [shared with the Java arm](crate::sandbox::language::jvm) and asserted there.

use crate::sandbox::language::isolation::{Preparation, breaches};

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
fn the_scripting_plugin_is_installed_under_the_names_the_compiler_looks_for() {
    // The compiler finds its scripting plugin by four UNVERSIONED file names under
    // `<kotlin home>/lib`, and a program is a script — so getting this wrong turns every compile
    // into `SCRIPTING_ERROR: Unable to evaluate script, no scripting plugin loaded`, which reads
    // like a diagnostic about the model's program and is a sentence about gg's packaging.
    for name in [
        "kotlin-scripting-compiler.jar",
        "kotlin-scripting-compiler-impl.jar",
        "kotlin-scripting-common.jar",
        "kotlin-scripting-jvm.jar",
    ] {
        assert!(
            VERSION_SH.contains(name),
            "the scripting plugin's {name} is not in kotlin-version.sh",
        );
    }
    // The `-embeddable` variants specifically: the plain jars reference `com.intellij.…`, which the
    // embeddable compiler has relocated, and the plugin then fails to load with a message about a
    // missing class rather than about a mismatched distribution.
    assert!(
        VERSION_SH.contains("kotlin-scripting-compiler-embeddable:")
            && VERSION_SH.contains("kotlin-scripting-compiler-impl-embeddable:"),
        "the embeddable variants are the ones that plug into an embeddable compiler",
    );
    // And the install script writes that directory rather than only the classpath one, because gg
    // names it and refuses to start a daemon without it.
    assert!(
        INSTALL_SH.contains(KOTLIN_HOME),
        "install-kotlin.sh writes the {KOTLIN_HOME} directory gg names",
    );
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
            && assembled.contains("setJsModuleType(JSModuleType.NONE)"),
        "the Kotlin arm's assembled driver carries the shared TeaVM build",
    );
    // The three flags that make a program a script rather than something the compiler runs. Each of
    // them was arrived at by measurement, and losing any one of them fails every compile on this arm
    // with a message about something else.
    assert!(
        FRONT.contains("-Xallow-any-scripts-in-source-roots"),
        "a script in the source roots is COMPILED; `-script` would compile it and then run it",
    );
    assert!(
        FRONT.contains("-kotlin-home"),
        "the scripting plugin is loaded out of a kotlin-home directory",
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
fn a_diagnostic_is_located_in_the_model_s_own_coordinates() {
    // A program with one hoisted import: the compiler saw the model's line 3 as line 4, and what the
    // model reads is 3.
    let located = diagnostic(
        "kotlinc",
        Some("UNRESOLVED_REFERENCE"),
        Some(PROGRAM_FILE),
        4,
    )
    .render(PROGRAM_FILE, 1);
    assert_eq!(located, "program.kts:3:5: something was wrong");

    // A TeaVM diagnostic has no column — its locations are per statement — so it prints one
    // coordinate rather than two.
    let mut teavm = diagnostic("teavm", None, Some(PROGRAM_FILE), 9);
    teavm.column = 0;
    assert_eq!(
        teavm.render(PROGRAM_FILE, 0),
        "program.kts:9: something was wrong"
    );

    // A line the shift would move above the file's first is clamped rather than wrapped: a
    // coordinate of 0 or a huge number is worse than a coordinate that is one line out.
    assert_eq!(
        diagnostic("kotlinc", None, Some(PROGRAM_FILE), 1).render(PROGRAM_FILE, 4),
        "program.kts:1:5: something was wrong",
    );

    // A module's diagnostics say `module.kt`, so an author of a code skill is not told the line is
    // in a program.
    assert_eq!(
        diagnostic("kotlinc", None, Some(MODULE_FILE), 2).render(MODULE_FILE, 0),
        "module.kt:2:5: something was wrong",
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
        0,
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
        0,
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
        0,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Syntax(_))),
        "{failure:?}",
    );

    // A warning is not a refusal.
    let mut warning = diagnostic("kotlinc", Some("UNUSED_VARIABLE"), Some(PROGRAM_FILE), 2);
    warning.error = false;
    verdict(&report(vec![warning]), PROGRAM_FILE, 0).expect("a warning is not a verdict");
}

#[test]
fn a_refusal_about_gg_s_own_generated_file_is_not_the_model_s_to_fix() {
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
        0,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Toolchain(_)),
        "gg's own generated code failing is gg's bug, not the model's: {failure:?}",
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
        0,
    )
    .expect_err("refused");
    assert!(
        matches!(failure, PrepareFailure::Program(PrepareError::Compile(_))),
        "{failure:?}",
    );
    let rendered = failure.to_string();
    assert!(
        rendered.contains("program.kts, inside kotlin/concurrent/Thread.kt:40"),
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
        0,
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
fn the_entry_class_names_every_exception_it_catches() {
    let entry = entry_for_program();
    for name in CAUGHT {
        assert!(entry.contains(&format!("catch ({name} failure)")), "{name}");
    }
    // Kotlin's own failures are named, which is the half of this list that is not Java's: `!!` on a
    // null, a `lateinit` read too early. A model that reads `java.lang.RuntimeException` where its
    // language would have said `UninitializedPropertyAccessException` has been told less than the
    // language knows.
    assert!(entry.contains("kotlin.UninitializedPropertyAccessException"));
    // The order is what makes the specific name reach the model: a supertype clause first would
    // swallow it, and Java takes the first clause that matches.
    let at = |name: &str| entry.find(name).expect("present");
    assert!(at("kotlin.KotlinNullPointerException") < at("java.lang.NullPointerException"));
    assert!(at("ArrayIndexOutOfBoundsException") < at("java.lang.IndexOutOfBoundsException"));
    assert!(at("NumberFormatException") < at("IllegalArgumentException"));
    // A class the list does not name still gets a name, and a runtime that cannot answer gets a
    // sentence rather than the word `null`.
    assert!(entry.contains("catch (Throwable failure)"));
    assert!(entry.contains("a failure whose class this runtime cannot name"));
    // A failure raised by a BINDING is rethrown untouched: the guest classifies a tool failure from
    // what the host said, and re-describing one would hide it behind a class nobody wrote.
    assert!(entry.contains(&format!("{FOREIGN_MARKER:?}")));
    // And the entry rethrows rather than swallowing — a program that failed must not be recorded as
    // one that finished.
    assert!(entry.contains("throw seen("));
    // It starts the script by constructing it, which is what a compiled Kotlin script is.
    assert!(entry.contains(&format!("new {}(new String[0])", source::PROGRAM_CLASS)));
}

#[test]
fn a_module_bundle_hands_its_namespace_back_and_a_program_does_not() {
    // A plain object, copied off the class TeaVM exported onto: the guest takes what a module
    // evaluated to only if it is an `object`, and a class is a `function` — so handing the export
    // back directly would bind an empty namespace and no error, which is the quiet kind of wrong.
    let tail = Entry::Module.tail();
    assert!(tail.contains("var $ggNamespace = {}"));
    assert!(tail.contains(&format!("Object.keys({})", source::MODULE_GLOBAL)));
    assert!(tail.contains("return $ggNamespace"));
    // A program's tail hands nothing back: what a program is worth is what it logged and what it
    // did, and a namespace is a module's answer alone.
    assert!(!Entry::Program.tail().contains("$ggNamespace"));
    // Both start the same way, because both are TeaVM's own entry point and both report a failure
    // through the callback rather than through a field nothing reads.
    assert!(Entry::Program.tail().starts_with("main([], function"));
}

/// One of the two things this arm compiles, driven by the
/// [isolation gate](crate::sandbox::language::isolation).
///
/// The gate walks the *registered* languages, and this arm has no wire id yet — so it is pointed at
/// this arm by hand until it is registered. Both halves are driven, and on this arm they are not the
/// same shape: a program is a script and a module is a file, compiled against different classpaths
/// through different generated entry classes.
struct KotlinPreparation {
    /// Whether this is the program half.
    program: bool,
}

impl Preparation for KotlinPreparation {
    fn describe(&self) -> String {
        match self.program {
            true => "Kotlin program".to_string(),
            false => "Kotlin module".to_string(),
        }
    }

    /// A source whose marker rides inside a **call**, so no compiler that eliminates dead code can
    /// drop it and leave two preparations looking identical.
    fn source(&self, marker: &str) -> String {
        match self.program {
            true => format!("println({marker:?})\n"),
            false => format!("fun announce(): String = {marker:?}\n"),
        }
    }

    fn prepare(&self, source: &str, context: &PrepareContext) -> Result<String, String> {
        match self.program {
            true => compile_program(source, context)
                .map(|prepared| prepared.source)
                .map_err(|failure| failure.to_string()),
            false => compile_module(source, context)
                .map(|(compiled, _exports)| compiled)
                .map_err(|failure| failure.to_string()),
        }
    }
}

#[test]
fn every_kotlin_compile_stands_on_ground_no_other_agent_can_reach() {
    // Sixteen at once — `limits.maxParallel`'s ceiling, which is how many agents may be compiling
    // simultaneously in one process, through a pool of four warm JVMs. The gate requires every
    // artifact to carry its own marker, to carry nobody else's, to equal what the same input
    // produced alone, and no two preparations to have been handed the same workspace.
    //
    // This is the arm where that matters most and the reason the pool is processes rather than a
    // shared builder: one `InProcessBuildStrategy` driven from four threads was measured producing
    // no output at all for three of them while throwing nothing.
    warm();
    for program in [true, false] {
        let breaches = breaches(&KotlinPreparation { program });
        assert!(
            breaches.is_empty(),
            "compiling a Kotlin {} is not isolated per preparation: {}",
            match program {
                true => "program",
                false => "module",
            },
            breaches
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        );
    }
}
