//! What the two JVM arms share, asserted where it is cheap: the assembly of the driver, and the two
//! TeaVM settings that fail silently rather than loudly when they go missing.

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
fn the_two_teavm_settings_that_fail_silently_are_in_the_shared_half() {
    // `setStrict(true)` is the one that matters most and the reason this half is shared rather than
    // copied: without it TeaVM omits the null checks that make a `NullPointerException` an exception
    // at all, `catch (NullPointerException)` never fires, and a program that FAILED is recorded as
    // one that succeeded. A gate that only read one arm's driver would not notice the other losing
    // it — so it is asserted here, over the text both arms run.
    assert!(
        BACKEND.contains("build.setStrict(true);"),
        "TeaVM is asked for the null and bounds checks",
    );
    assert!(
        BACKEND.contains("build.setJsModuleType(JSModuleType.NONE);"),
        "TeaVM names the entry point as a bare identifier the guest's scope can reach",
    );
    assert!(
        BACKEND.contains("build.setSourceMapsFileGenerated(true);"),
        "TeaVM writes the source map a located failure is read out of",
    );
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
