//! What gg answers for `java.lang.Math`, asserted without a JVM.
//!
//! The math cases on the two JVM arms — `crates/gg/src/sandbox/language/java.math.test.rs` and
//! `crates/gg/src/sandbox/language/kotlin.math.test.rs` — drive every one of these through a real
//! compiled program, which is what proves the *wiring*: that the rewritten `teavmMath` import really
//! resolves against gg's world, for each function, on each arm. What is proved here is the
//! arithmetic itself, which that route asserts to three decimal places rather than exactly.

use super::*;

use crate::sandbox::fake::{FakeOperationApi, canned_outcome};

/// A membrane state to call the interface's own methods on. Nothing here reads it — every function
/// is a pure function of its arguments — but the trait takes `&mut self`, so one has to exist.
fn state() -> MembraneState<FakeOperationApi> {
    let log = crate::sandbox::fake::CallLog::default();
    MembraneState::new(
        FakeOperationApi::with(&log, canned_outcome),
        crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::Kotlin),
        crate::sandbox::ProgramScope {
            capabilities: &[],
            operations: &[],
            modules: &[],
            ending: crate::sandbox::membrane::RunEnding::None,
        },
        crate::sandbox::SandboxLimits::AMPLE,
        None,
    )
}

#[test]
fn every_function_this_interface_declares_is_the_one_java_names() {
    let mut host = state();
    // The three a wasm instruction could have answered, kept on this interface with the other eleven
    // rather than special-cased: one rule about where `java.lang.Math` goes is worth more than three
    // instructions saved on a call a program makes once.
    assert_eq!(host.sqrt(16.0), 4.0);
    assert_eq!(host.ceil(1.2), 2.0);
    assert_eq!(host.floor(1.8), 1.0);

    assert_eq!(host.sin(0.0), 0.0);
    assert_eq!(host.cos(0.0), 1.0);
    assert_eq!(host.tan(0.0), 0.0);
    assert_eq!(host.asin(0.0), 0.0);
    assert_eq!(host.acos(1.0), 0.0);
    assert_eq!(host.atan(0.0), 0.0);
    assert_eq!(host.exp(0.0), 1.0);
    assert_eq!(host.log(1.0), 0.0);
    assert_eq!(host.pow(2.0, 10.0), 1024.0);

    // `atan2` takes its arguments in Java's own order — y first — and getting that backwards is a
    // program whose angles are reflected rather than one that fails.
    assert!((host.atan2(1.0, 0.0) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    assert!((host.atan2(0.0, 1.0)).abs() < 1e-12);
}

#[test]
fn a_domain_error_is_not_a_failure() {
    // `java.lang.Math` has no failure mode: `log(-1)` is `NaN` and `1/0.0` is infinity, and a host
    // that turned either into an `api-error` would be inventing a refusal the language does not
    // have. This interface therefore returns no `result` at all, and this is what that means.
    let mut host = state();
    assert!(host.log(-1.0).is_nan());
    assert!(host.sqrt(-1.0).is_nan());
    assert!(host.asin(2.0).is_nan());
    assert!(host.log(0.0).is_infinite());
}

#[test]
fn a_random_number_is_in_range_and_is_not_a_constant() {
    let mut host = state();
    let drawn: Vec<f64> = (0..64).map(|_| host.random()).collect();
    assert!(
        drawn.iter().all(|value| (0.0..1.0).contains(value)),
        "`Math.random` is specified as [0, 1): {drawn:?}"
    );
    assert!(
        drawn
            .iter()
            .map(|value| value.to_bits())
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            > 60,
        "a generator answering the same number is a generator nothing seeded: {drawn:?}"
    );
}
