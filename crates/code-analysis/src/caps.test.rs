//! Tests for the bounds every parse runs under.
//!
//! These are the tests the whole crate exists to make safe. A stack overflow in either
//! front end is `SIGABRT` — it cannot be caught, cannot be retried, and takes the driver
//! process with it — so the properties below are not "nice to have coverage": each one is a
//! mitigation that has to hold for a run to survive a degenerate file.

use super::*;

/// The derivation grows with the file and is clamped at both ends.
#[test]
fn the_derived_stack_grows_with_the_file_and_clamps_at_both_ends() {
    assert_eq!(parse_stack_bytes(0), MIN_PARSE_STACK_BYTES);
    assert_eq!(parse_stack_bytes(1), MIN_PARSE_STACK_BYTES);

    // Somewhere past the floor the derivation takes over and tracks the file.
    let small = parse_stack_bytes(32 * 1024);
    let large = parse_stack_bytes(128 * 1024);
    assert!(
        large > small,
        "the stack must grow with the file: {small} vs {large}"
    );
    assert_eq!(
        large,
        128 * 1024 * STACK_BYTES_PER_SOURCE_BYTE * STACK_SAFETY_FACTOR
    );

    assert_eq!(parse_stack_bytes(usize::MAX / 8), MAX_PARSE_STACK_BYTES);
}

/// **The byte cap and the stack ceiling are one decision, not two.**
///
/// [`MAX_PARSED_FILE_BYTES`] is chosen so the derived stack for the largest admissible file
/// still fits under [`MAX_PARSE_STACK_BYTES`]. Raising the byte cap without raising the
/// ceiling would silently clamp, and the derivation would stop covering the worst shape the
/// cap admits — the file would be parsed on a stack sized for a smaller one. That is exactly
/// the failure this test exists to make impossible to introduce quietly.
#[test]
fn the_byte_cap_never_derives_a_stack_the_ceiling_would_clamp() {
    let derived = derived_stack_bytes(MAX_PARSED_FILE_BYTES);
    assert!(
        derived <= MAX_PARSE_STACK_BYTES,
        "a file at the byte cap derives {derived} bytes of stack, over the {MAX_PARSE_STACK_BYTES} \
         ceiling — raise the ceiling with the cap, and bump the analyzer version"
    );
    // ...and the cap is not so far under the ceiling that it is doing nothing: this is the
    // "these two numbers were chosen together" half of the claim.
    assert!(
        derived * 2 > MAX_PARSE_STACK_BYTES,
        "the byte cap is far below what the ceiling admits ({derived} vs {MAX_PARSE_STACK_BYTES}); \
         one of the two has drifted"
    );
}

/// The safety factor is not slack: it is what covers the bracket shapes the prescan can be
/// fooled about. Three point four kilobytes per level is the worst measured bracket cost.
#[test]
fn the_safety_factor_covers_the_worst_bracket_shape() {
    const WORST_BRACKET_BYTES_PER_LEVEL: usize = 3_400;
    const {
        assert!(
            STACK_BYTES_PER_SOURCE_BYTE * STACK_SAFETY_FACTOR > WORST_BRACKET_BYTES_PER_LEVEL,
            "a file that is entirely the most expensive bracket shape would outrun its stack"
        );
    }
}

#[test]
fn the_prescan_reports_the_deepest_nesting() {
    assert_eq!(bracket_nesting_depth(""), 0);
    assert_eq!(bracket_nesting_depth("f(g(h(1)))"), 3);
    assert_eq!(bracket_nesting_depth("a(1) b(2) c(3)"), 1);
    assert_eq!(bracket_nesting_depth("{[()]}"), 3);
}

#[test]
fn a_file_over_the_byte_cap_is_refused_before_it_is_parsed() {
    let oversized = "a".repeat(MAX_PARSED_FILE_BYTES + 1);
    let refusal = parse_guarded(&oversized, |_| {
        unreachable!("the parser must not be entered")
    })
    .expect_err("an oversized file is refused");
    assert_eq!(refusal, ParseRefusal::OverByteCap);
    assert_eq!(refusal.as_str(), "over-parse-cap");
}

#[test]
fn a_file_over_the_nesting_cap_is_refused_before_it_is_parsed() {
    let nested = "(".repeat(MAX_BRACKET_NESTING as usize + 1);
    let refusal = parse_guarded(&nested, |_| unreachable!("the parser must not be entered"))
        .expect_err("an over-nested file is refused");
    assert_eq!(refusal, ParseRefusal::OverNestingCap);
    assert_eq!(refusal.as_str(), "over-nesting-cap");
}

/// A panic inside a front end is contained on the parse thread and reported as a refusal.
///
/// The analysis is a diagnostic read of a run that has already finished; a defect in a
/// parser must cost one file's figures, never the run's whole analysis and certainly never
/// the process.
#[test]
fn a_panicking_parse_is_contained_and_reported_as_a_refusal() {
    // The panic message would otherwise be printed by the default hook and read as a test
    // failure to anyone watching the output.
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let outcome = parse_guarded("const a = 1;", |_| -> () {
        panic!("a front end fell over");
    });
    std::panic::set_hook(previous);

    let refusal = outcome.expect_err("a panicking parse is a refusal");
    assert_eq!(refusal, ParseRefusal::Panicked);
    assert_eq!(refusal.as_str(), "parse-failed");
}

/// A thread that cannot be started is a size-only file, never a panic.
///
/// `Builder::spawn_scoped` returning `Err` is the only reason it is used over
/// `thread::spawn`, which panics in the same situation — and this asserts the surviving
/// half of that choice: an unreservable stack degrades one file instead of unwinding.
#[test]
fn a_thread_that_cannot_be_started_is_a_refusal_not_a_panic() {
    // A stack larger than the address space cannot be reserved on any 64-bit host.
    let refusal = on_stack(usize::MAX, || unreachable!("the work must not run"))
        .expect_err("an unreservable stack is a refusal");
    assert_eq!(refusal, ParseRefusal::ThreadUnavailable);
}

/// **The stack-safety test.** Each front end is handed the hungriest shape it admits, at
/// exactly the byte cap, on exactly the stack the production derivation gives it.
///
/// Run in the **dev** profile deliberately: an unoptimised frame is several times fatter
/// than an optimised one, the suite runs unoptimised, and the margin has to hold for the
/// build a developer runs as well as the one a run container gets. A drift between the caps
/// and the measured per-byte figure fails the suite rather than a run.
///
/// Note what this test can and cannot do. It can prove a shape *parses*; it cannot search
/// for the shape that does not, because finding that shape means overflowing, and an
/// overflow aborts the test binary rather than failing a case.
#[test]
fn the_hungriest_files_the_caps_admit_still_parse() {
    // TypeScript: a chain of postfix non-null assertions, one byte per level — the shape the
    // 1,261 bytes-per-source-byte figure was measured against.
    let prelude = "const a = 1;\nexport const b = a";
    let assertions = "!".repeat(MAX_PARSED_FILE_BYTES - prelude.len() - 1);
    let program = format!("{prelude}{assertions};");
    assert_eq!(program.len(), MAX_PARSED_FILE_BYTES);
    let facts = parse_guarded(&program, |text| crate::typescript::analyze("a.ts", text))
        .expect("a TypeScript file at the byte cap is not refused");
    assert!(facts.is_some(), "the hungriest TypeScript shape must parse");

    // Rust: a chain of unary negations, two bytes per level. Spaced so the lexer cannot fold
    // a pair into an operator Rust does not have.
    let prelude = "pub fn f() -> i32 { ";
    let negations = "- ".repeat((MAX_PARSED_FILE_BYTES - prelude.len() - 3) / 2);
    let program = format!("{prelude}{negations}1 }}");
    assert!(program.len() <= MAX_PARSED_FILE_BYTES);
    let facts = parse_guarded(&program, |text| crate::rust::analyze("a.rs", text))
        .expect("a Rust file at the byte cap is not refused");
    assert!(facts.is_some(), "the hungriest Rust shape must parse");
}
