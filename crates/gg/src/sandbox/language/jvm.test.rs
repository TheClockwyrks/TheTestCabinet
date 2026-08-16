//! What the two JVM arms share, asserted where it is cheap: the assembly of the driver, the three
//! TeaVM settings that fail silently rather than loudly when they go missing, and the generated
//! entry class both arms' compiles write beside a model's own file.
//!
//! None of this starts a JVM. Each arm's substrate tests do, and prove that what is decided here
//! matches what the real toolchain does.

use super::*;

#[test]
fn the_assembled_driver_is_one_class_with_both_halves_in_it() {
    let assembled = driver("public final class GgCompiler {\n    static final int PROTOCOL = 1;\n");
    assert!(
        assembled.starts_with("public final class GgCompiler {"),
        "the front end opens the class",
    );
    assert!(
        assembled.contains("static boolean javac("),
        "the backend's javac is in the assembled driver",
    );
    assert!(
        assembled.ends_with("}\n"),
        "gg closes the class the front end opened, since neither half may: {:?}",
        &assembled[assembled.len().saturating_sub(40)..],
    );
    // Braces balanced is the cheapest possible statement of "this is a compilation unit", and it is
    // the one thing a splice can get wrong without any compiler being involved. javac says the rest,
    // at every daemon start.
    let opened = assembled.matches('{').count();
    let closed = assembled.matches('}').count();
    assert_eq!(
        opened, closed,
        "the assembled driver's braces balance ({opened} open, {closed} closed)",
    );
}

#[test]
fn the_three_teavm_settings_that_fail_silently_are_in_the_shared_half() {
    // `setStrict(true)` is the one that matters most and the reason this half is shared rather than
    // copied: without it TeaVM omits the null checks that make a `NullPointerException` an exception
    // at all and a program that FAILED is recorded as one that succeeded. A gate that only read one
    // arm's driver would not notice the other losing it — so it is asserted here, over the text both
    // arms run.
    assert!(
        BACKEND.contains("build.setStrict(true);"),
        "TeaVM is asked for the null and bounds checks",
    );
    // Without this the entry class is dead-stripped, the encode succeeds at exit code 0, and the
    // component gg instantiates has no exports at all.
    assert!(
        BACKEND.contains("build.setClassesToPreserve(PRESERVED);"),
        "TeaVM keeps the classes nothing in the program's own graph reaches",
    );
    // Equal, because the minimum is what a program actually GETS: a generous maximum beside a small
    // minimum reads as an allowance and is not one.
    assert!(
        BACKEND.contains("build.setMinHeapSize(HEAP);")
            && BACKEND.contains("build.setMaxHeapSize(HEAP);"),
        "the heap a program gets is one number",
    );
}

#[test]
fn there_is_no_javascript_road_left_in_the_shared_half() {
    // Both arms compile to a WebAssembly component of their own. A JavaScript branch kept "just in
    // case" would be a road nothing tests and a hedge against a ruling that is closed.
    for name in [
        "JSModuleType",
        "setJsModuleType",
        "setSourceMapsFileGenerated",
        "TeaVMSourceFilePolicy",
        "JAVASCRIPT",
    ] {
        assert!(
            !BACKEND.contains(name),
            "the shared half still names {name}, which belongs to the JavaScript target",
        );
    }
}

#[test]
fn the_shared_half_declares_no_class_of_its_own() {
    // It is a class-body tail rather than a compilation unit. A `package`, an `import` or a
    // top-level `class` in it would compile on its own and fail once appended, which is a confusing
    // way to find out.
    for line in BACKEND.lines() {
        let start = line.trim_start();
        assert!(
            !start.starts_with("package ") && !start.starts_with("import "),
            "the shared half is appended inside a class, so it can carry no {line:?}",
        );
    }
}

#[test]
fn the_entry_class_catches_nothing_and_calls_what_it_was_told_to() {
    let entry = entry_class("ProgramKt.main();");
    // `contains("try {")` would be a bug rather than a check: `class GgEntry {` ends in one.
    assert!(
        !entry.contains("catch (") && !entry.lines().any(|line| line.trim() == "try {"),
        "gg catches nothing: a failure is the runtime's own to report\n{entry}",
    );
    assert!(
        entry.contains("ProgramKt.main();"),
        "it calls the model's own entry point:\n{entry}"
    );
    assert!(
        entry.contains("@Export(name = \"run\")")
            && entry.contains("@Export(name = \"bound-tools\")"),
        "the two exports the world declares are both here:\n{entry}",
    );
    // AND NOTHING ELSE. The list of exception classes this used to carry — so that TeaVM's
    // dependency analysis would emit their name strings — is gone with the loop that walked it and
    // the property lookup that hid it from the constant folder. What names a failure now is
    // `gg.internal.ThrowableNames`, which derives the set from the program being compiled and
    // therefore covers the exception classes a model declares itself.
    for gone in ["SPELLABLE", "System.getProperty", "System.err"] {
        assert!(
            !entry.contains(gone),
            "the entry class carries nothing but the two exports; it still names {gone}:\n{entry}",
        );
    }
}

#[test]
fn the_two_arms_entry_classes_differ_by_one_line() {
    // EACH ARM'S OWN, rather than this test's idea of what each arm passes: the claim is about the
    // two files gg writes beside a model's program, and a test that called `entry_class` twice with
    // arguments of its own would be asserting a property of the formatting function instead.
    let java = super::super::java::compile::entry_class();
    let kotlin = super::super::kotlin::compile::entry_class();
    let differing: Vec<(&str, &str)> = java
        .lines()
        .zip(kotlin.lines())
        .filter(|(one, other)| one != other)
        .collect();
    assert_eq!(
        differing.len(),
        1,
        "the two arms' entry classes differ by exactly one line: {differing:?}",
    );
    assert_eq!(java.lines().count(), kotlin.lines().count());
    assert_eq!(
        differing[0],
        (
            "        Program.main(new String[0]);",
            "        ProgramKt.main();"
        ),
        "and the one line is the call to the model's own entry point",
    );
}
