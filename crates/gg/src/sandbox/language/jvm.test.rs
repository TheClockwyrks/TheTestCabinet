//! What the two JVM arms share, asserted where it is cheap: the assembly of the driver, the two
//! TeaVM settings that fail silently rather than loudly when they go missing, and the reading of
//! TeaVM's own output that turns a generated line back into the line a model wrote.
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

#[test]
fn the_prelude_accounts_for_its_own_length() {
    let filled = prelude(&[(500, 3), (501, 4)], "program.java");
    assert!(filled.contains("[[500,3],[501,4]]"));
    // `$ggBase` starts at the prelude's own line count, because the stack reports a line in the
    // whole evaluated body and the table is keyed by TeaVM's own. A prelude that grew by a line and
    // a constant that did not would report every location one line out, so the number is derived.
    let lines = filled.lines().count();
    assert!(
        filled.contains(&format!("var $ggBase = {lines};")),
        "the prelude is {lines} lines: {}",
        filled.lines().take(3).collect::<Vec<_>>().join(" / ")
    );
    assert!(!filled.contains("__GG_"), "every placeholder is filled");
}

#[test]
fn the_source_map_is_folded_down_to_the_model_s_own_lines() {
    // A map with two sources, one of them the model's file. `AAAA` is (column 0, source +0,
    // line +0, column +0); the `;` are generated lines.
    let map = r#"{"version":3,"sources":["Other.java","Program.java"],"names":[],
      "mappings":"AAAA;;ACWA;AACA"}"#;
    // Generated line 1 is somebody else's code, which is recorded as `0` rather than dropped — a
    // frame that lands there must not fall back to whichever of the model's lines came before it.
    // Generated line 3 maps to source 1 (`Program.java`) line 12, which with an 11-line wrapper is
    // the model's line 1; generated line 4 is its line 2.
    assert_eq!(
        model_lines(map, "Program.java", 11),
        [(1, 0), (3, 1), (4, 2)],
        "the change points of whose code a generated line is, already shifted"
    );
    // A map naming only the classlib folds to one run of `0`, and a program error then carries no
    // located line rather than a wrong one.
    assert_eq!(model_lines(map, "Nothing.java", 11), [(1, 0)]);
    // A map gg cannot read costs a located message and nothing else — never a refused program.
    assert!(model_lines("not json", "Program.java", 0).is_empty());
    assert!(
        model_lines(
            r#"{"version":3,"sources":["Program.java"],"names":[],"mappings":"!!!!"}"#,
            "Program.java",
            0
        )
        .is_empty()
    );
}

#[test]
fn the_vlq_alphabet_round_trips_the_values_a_map_uses() {
    assert_eq!(vlq("AAAA"), Some(vec![0, 0, 0, 0]));
    assert_eq!(vlq("ACWA"), Some(vec![0, 1, 11, 0]));
    // A negative delta, which a map uses whenever a generated line goes back up its source.
    assert_eq!(vlq("D"), Some(vec![-1]));
    // Multi-digit continuation: four base-64 digits, five bits each, sign in the low bit.
    assert_eq!(vlq("qxmBA"), Some(vec![19_733, 0]));
    assert_eq!(vlq("*"), None, "a character the alphabet does not have");
}
