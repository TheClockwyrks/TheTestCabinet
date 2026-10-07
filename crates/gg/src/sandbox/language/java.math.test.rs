//! **`java.lang.Math` driven from real compiled Java programs** — the model-facing half of
//! `test-cabinet:gg/math`.
//!
//! The [membrane's own tests](crate::sandbox::membrane::math) assert the *arithmetic*, host-side and
//! without a JVM. What is asserted here is the **wiring**: that the `@Import(module = "teavmMath")`
//! the classlib declares, rewritten to `test-cabinet:gg/math` by the SDK jar's
//! `ClassHolderTransformer`, really resolves against gg's world — for every one of the fourteen
//! functions, from a program the real JDK and the real TeaVM compiled seconds earlier.
//!
//! # Why a case here is a function
//!
//! The consolidation rule [next door](super::substrate) is about that file's own tests, each of
//! which drives a whole behaviour of the substrate. **A case here is a function**: one short program
//! and one assertion, so a failing row names the function that broke rather than leaving a reader to
//! find which of fourteen imports stopped resolving. Every program logs through a fixed-decimal
//! format, so what is under test is the host's answer rather than this arm's default rendering of a
//! double.

use super::substrate::{evaluate, logs, prepare, run, whole};
use crate::sandbox::fake::{all_operations, canned_outcome};
use crate::sandbox::outcome::SandboxOutcome;

/// A program whose only statement logs `expression` to three decimal places.
///
/// The rendering is fixed here rather than in each case so that a case reads as the call it makes,
/// and so that no case is quietly asserting what `Double.toString` does.
fn fixed(expression: &str) -> String {
    whole(
        &["Gg"],
        &format!("        Gg.log(String.format(\"%.3f\", {expression}));\n"),
    )
}

/// What one program logged, insisting it neither failed nor was refused.
fn logged(source: &str) -> Vec<String> {
    let outcome = run(source);
    logs(&outcome).to_vec()
}

/// `sin` is answered for a program.
#[test]
fn sin_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.sin(0.0)")), ["0.000"]);
}

/// `cos` is answered for a program.
#[test]
fn cos_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.cos(0.0)")), ["1.000"]);
}

/// `tan` is answered for a program.
#[test]
fn tan_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.tan(0.0)")), ["0.000"]);
}

/// `asin` is answered for a program.
#[test]
fn asin_is_answered_for_a_program() {
    // Half of pi, to three places.
    assert_eq!(logged(&fixed("Math.asin(1.0)")), ["1.571"]);
}

/// `acos` is answered for a program.
#[test]
fn acos_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.acos(1.0)")), ["0.000"]);
}

/// `atan` is answered for a program.
#[test]
fn atan_is_answered_for_a_program() {
    // A quarter of pi, to three places.
    assert_eq!(logged(&fixed("Math.atan(1.0)")), ["0.785"]);
}

/// **`atan2` takes its arguments in Java's own order — `y` first.**
///
/// This is the one function on the interface whose failure is silent: a host that transposed them
/// would answer every program with a reflected angle rather than an error, and no other case here
/// would notice. The two calls below are each other's transposition, so a swap turns one assertion
/// into the other's value.
#[test]
fn atan2_takes_its_arguments_in_javas_own_order() {
    let logs = logged(&whole(
        &["Gg"],
        "        Gg.log(String.format(\"%.3f\", Math.atan2(1.0, 0.0)));\n\
         \x20       Gg.log(String.format(\"%.3f\", Math.atan2(0.0, 1.0)));\n",
    ));
    assert_eq!(logs, ["1.571", "0.000"]);
}

/// `exp` is answered for a program.
#[test]
fn exp_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.exp(1.0)")), ["2.718"]);
}

/// `log` is answered for a program.
#[test]
fn log_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.log(Math.E)")), ["1.000"]);
}

/// **`pow` takes its base before its power**, which a transposition of the two makes visible.
#[test]
fn pow_takes_its_base_before_its_power() {
    let logs = logged(&whole(
        &["Gg"],
        "        Gg.log(String.format(\"%.3f\", Math.pow(2.0, 10.0)));\n\
         \x20       Gg.log(String.format(\"%.3f\", Math.pow(10.0, 2.0)));\n",
    ));
    assert_eq!(logs, ["1024.000", "100.000"]);
}

/// `sqrt` is answered for a program.
#[test]
fn sqrt_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.sqrt(16.0)")), ["4.000"]);
}

/// `ceil` is answered for a program.
#[test]
fn ceil_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.ceil(1.2)")), ["2.000"]);
}

/// `floor` is answered for a program.
#[test]
fn floor_is_answered_for_a_program() {
    assert_eq!(logged(&fixed("Math.floor(1.8)")), ["1.000"]);
}

/// **`random` answers a program with a number in range**, and not with the same number every time.
///
/// No fixed value can be asserted, which is the whole point of the function: what is asserted is the
/// range the contract states and that the draws are not one constant wearing eight hats.
#[test]
fn random_answers_a_program_with_a_number_in_range() {
    let logs = logged(&whole(
        &["Gg"],
        "        for (int draw = 0; draw < 8; draw++) {\n\
         \x20           Gg.log(String.valueOf(Math.random()));\n\
         \x20       }\n",
    ));
    assert_eq!(logs.len(), 8, "{logs:?}");
    let draws: Vec<f64> = logs
        .iter()
        .map(|line| {
            line.parse::<f64>()
                .unwrap_or_else(|_| panic!("a draw is a number: {line}"))
        })
        .collect();
    for draw in &draws {
        assert!(
            (0.0..1.0).contains(draw),
            "a draw is at least zero and under one: {draws:?}"
        );
    }
    assert!(
        draws.iter().any(|draw| *draw != draws[0]),
        "eight draws are not all the same value: {draws:?}"
    );
}

/// **A domain result is a number rather than a failure.**
///
/// `java.lang.Math` has no failure mode, and this interface therefore returns no `result` at all:
/// `log(-1)` is not-a-number here for the same reason it is not-a-number in Java. The program runs
/// past all three and reaches its end.
#[test]
fn a_domain_result_is_a_number_rather_than_a_failure() {
    let outcome = run(&whole(
        &["Gg"],
        "        Gg.log(String.valueOf(Math.log(-1.0)));\n\
         \x20       Gg.log(String.valueOf(Math.sqrt(-1.0)));\n\
         \x20       Gg.log(String.valueOf(Math.asin(2.0)));\n\
         \x20       Gg.log(\"reached the end\");\n",
    ));
    assert_eq!(logs(&outcome), ["NaN", "NaN", "NaN", "reached the end"]);
    assert!(
        no_program_error(&outcome),
        "a domain result carries no program error: {:?}",
        outcome.result
    );
}

/// Whether the run carries no program error at all — what "not a failure" means on this arm.
fn no_program_error(outcome: &SandboxOutcome) -> bool {
    matches!(&outcome.result, Ok(result) if result.error.is_none())
}

/// **A program mixing math with a gg call reaches both**: the rewritten import and the wire are not
/// alternatives.
///
/// Every other case here runs with no operation offered, so none of them could have noticed a
/// rewrite that displaced the membrane. This one logs a `pow` and makes one gg call in the same
/// program, and asserts both the value and the tool name gg recorded.
#[test]
fn a_program_mixing_math_with_a_gg_call_reaches_both() {
    let source = whole(
        &["Gg"],
        "        double power = Math.pow(2.0, 10.0);\n\
         \x20       gg.files.Files.readFile(\"a.md\");\n\
         \x20       Gg.log(String.format(\"%.3f\", power));\n",
    );
    let (outcome, log) = evaluate(&prepare(&source), &all_operations(), &[], canned_outcome);
    assert_eq!(logs(&outcome), ["1024.000"]);
    assert_eq!(log.names(), ["read_file"]);
}
