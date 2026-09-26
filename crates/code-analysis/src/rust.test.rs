//! Tests for the Rust front end.

use super::*;
use crate::caps::{derived_stack_bytes, on_stack};

fn facts(source: &str) -> FileFacts {
    analyze("src/game.rs", source).expect("the fixture parses")
}

#[test]
fn a_file_that_does_not_parse_reports_nothing() {
    assert!(analyze("src/broken.rs", "pub fn f( {").is_none());
}

/// Free functions, inherent methods and defaulted trait methods are all scored; a trait
/// method with no body is not, because scoring a signature would report a stream of
/// complexity-1 functions nobody wrote.
#[test]
fn every_function_form_with_a_body_is_scored() {
    let facts = facts(
        "pub fn free(a: i32) -> i32 { a }\n\
         pub trait Tick { fn tick(&self); fn defaulted(&self) { let _ = 1; } }\n\
         struct Sprite;\n\
         impl Sprite { pub fn draw(&self) {} }\n",
    );
    let mut names: Vec<&str> = facts
        .functions
        .iter()
        .map(|function| function.name.as_str())
        .collect();
    names.sort_unstable();
    assert_eq!(names, vec!["defaulted", "draw", "free"]);
}

/// `?` is both a decision (the expression may stop early) and an exit.
#[test]
fn the_question_mark_is_both_a_decision_and_an_exit() {
    let facts = facts("pub fn f(a: Option<i32>) -> Option<i32> { let b = a?; Some(b) }\n");
    let function = &facts.functions[0];
    assert_eq!(function.cyclomatic, 2);
    assert_eq!(function.exits, 1);
}

/// A match arm with a guard is one more path than the arm alone.
#[test]
fn a_guarded_match_arm_costs_an_extra_decision() {
    let plain = facts("pub fn f(a: i32) -> i32 { match a { 1 => 1, _ => 0 } }\n");
    let guarded = facts("pub fn f(a: i32) -> i32 { match a { n if n > 1 => 1, _ => 0 } }\n");
    assert_eq!(
        guarded.functions[0].cyclomatic,
        plain.functions[0].cyclomatic + 1
    );
}

/// The discipline counters, chosen to mirror the TypeScript questions rather than to
/// enumerate Rust's features.
#[test]
fn the_discipline_counters_read_the_shapes_they_name() {
    let facts = facts(
        "#[allow(dead_code)]\n\
         pub fn f(a: Option<String>) -> String {\n\
             let b = a.clone().unwrap();\n\
             let c = a.expect(\"present\");\n\
             if b.is_empty() { panic!(\"empty\"); }\n\
             if c.is_empty() { todo!(); }\n\
             unsafe { }\n\
             b\n\
         }\n",
    );
    assert_eq!(facts.rust.unwrap_calls, 1);
    assert_eq!(facts.rust.expect_calls, 1);
    assert_eq!(facts.rust.clone_calls, 1);
    assert_eq!(facts.rust.panic_sites, 1);
    assert_eq!(facts.rust.todo_macros, 1);
    assert_eq!(facts.rust.suppressed_lints, 1);
    assert_eq!(facts.rust.unsafe_items, 1);
}

/// Visibility is counted so "was it narrowed at all, or is everything public?" is
/// answerable.
#[test]
fn visibility_is_counted_for_every_item() {
    let facts = facts(
        "pub struct Sprite;\n\
         struct Hidden;\n\
         pub const SPEED: i32 = 1;\n\
         pub trait Tick {}\n",
    );
    assert_eq!(facts.rust.items, 4);
    assert_eq!(facts.rust.public_items, 3);
    assert_eq!(facts.rust.traits, 1);
    let mut exports = facts.exports.clone();
    exports.sort();
    assert_eq!(exports, vec!["SPEED", "Sprite", "Tick"]);
}

/// A `use` tree is flattened into the module paths it names, and a glob is a barrel — the
/// Rust analogue of `export * from`.
#[test]
fn use_trees_flatten_and_globs_are_barrels() {
    let facts = facts("use crate::render::{sprite, tiles::atlas};\nuse crate::entities::*;\n");
    let specifiers: Vec<(&str, bool)> = facts
        .imports
        .iter()
        .map(|import| (import.specifier.as_str(), import.reexport))
        .collect();
    assert_eq!(
        specifiers,
        vec![
            ("crate::render::sprite", false),
            ("crate::render::tiles::atlas", false),
            ("crate::entities", true),
        ]
    );
}

#[test]
fn test_attributes_mark_a_file_as_test_code() {
    let facts = facts("#[test]\nfn spawns() {}\n#[test]\nfn ticks() {}\n");
    assert_eq!(facts.test_functions, 2);
    assert!(facts.is_test);
}

/// Line numbers are real, which they are only because `proc-macro2`'s `span-locations`
/// feature is enabled. Without it every span reports line 0 and the symbol table collapses.
#[test]
fn functions_carry_their_real_line_numbers() {
    let facts = facts("pub fn first() {}\n\npub fn second() {\n    let _ = 1;\n}\n");
    assert_eq!(facts.functions[0].line, 1);
    assert_eq!(facts.functions[1].line, 3);
    assert_eq!(facts.functions[1].lines, 3);
}

/// **The Rust calibration.** The hungriest bracket-free shape `syn` admits parses on the
/// stack the shared per-byte derivation gives it, unclamped.
///
/// Done per front end deliberately: `oxc` and `syn` have different frame sizes, so one
/// measured figure cannot speak for both, and the shared constant has to be sized against
/// the hungrier of the two — which is this one. If `syn` ever grows past it, this fails
/// rather than a run aborting a driver pod.
///
/// The shape matters as much as the size. A calibration is only as good as its **source
/// bytes per recursion level**: the version this replaced used a spaced `- ` chain at two
/// bytes a level with frames four times cheaper than the worst, so it certified the shared
/// constant against roughly a quarter of the demand the caps admit — and passed while a
/// plain deref chain in a 17 KB file aborted the process. Both shapes below cost one or two
/// bytes per level, and both are given the stack the *production* derivation computes for
/// their own size.
#[test]
fn rust_stack_per_byte_calibration() {
    // One source byte per level: the shape that packs the most frames into a file.
    const DEREF_BYTES: usize = 32 * 1024;
    let derived = derived_stack_bytes(DEREF_BYTES);
    let prelude = "pub fn g(x: i32) -> i32 { ";
    let derefs = "*".repeat(DEREF_BYTES - prelude.len() - 4);
    let program = format!("{prelude}{derefs} x }}");
    assert_eq!(program.len(), DEREF_BYTES);
    let parsed = on_stack(derived, || analyze("deep.rs", &program))
        .expect("the parse thread starts and does not panic");
    assert!(
        parsed.is_some(),
        "the derived {derived}-byte stack must carry a {DEREF_BYTES}-byte deref chain"
    );

    // Two source bytes per level, but the fattest frame either front end was measured at
    // (~17.2 KiB), which makes it the hungriest shape **per source byte** and therefore the
    // one `STACK_BYTES_PER_SOURCE_BYTE` is sized against. The prescan refuses this shape
    // outright now, so it reaches a parser only when the prescan was fooled — a comment
    // between two `|` breaks the run it counts — which is exactly the case the derived stack
    // has to carry alone. Exercised at a sixteenth of the byte cap because parsing a closure
    // nest costs time quadratic in its depth, so a cap-sized one would not finish; eight
    // kilobytes still puts the demand at half the derived stack, which is precisely
    // `STACK_SAFETY_FACTOR`.
    const CLOSURE_BYTES: usize = 8 * 1024;
    let derived = derived_stack_bytes(CLOSURE_BYTES);
    let prelude = "pub fn f() { let _x = ";
    let closures = "||".repeat((CLOSURE_BYTES - prelude.len() - 4) / 2);
    let program = format!("{prelude}{closures}1; }}");
    assert!(program.len() <= CLOSURE_BYTES);
    let parsed = on_stack(derived, || analyze("hungry.rs", &program))
        .expect("the parse thread starts and does not panic");
    assert!(
        parsed.is_some(),
        "the derived {derived}-byte stack must carry a {CLOSURE_BYTES}-byte closure chain"
    );
}
