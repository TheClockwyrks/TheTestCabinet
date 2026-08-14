//! Tests for limit resolution and the memory limiter.
//!
//! The resolution half matters more than it looks: these params are what a study sets to measure
//! what starving (or over-feeding) a sandbox does, and a param that is silently ignored turns a
//! configured arm into a run of the default arm under another name. Each one is therefore asserted both
//! for being honoured and for **not disturbing the others**, since the failure that costs a study
//! its result is a sweep in which one configured knob quietly reset another.

use std::time::Duration;

use serde_json::json;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgCapabilityConfig};
use wasmtime::ResourceLimiter;

use super::*;
use crate::validate::{LaunchDefect, LaunchReport};

/// The limits `profile` resolves to, asserting gg honoured its configuration exactly as written.
fn limits_of(profile: &GgAgentConfig) -> SandboxLimits {
    let mut report = LaunchReport::collecting();
    let limits = resolve_sandbox_limits(profile, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    limits
}

/// Everything resolving `profile` reports, for the cases whose subject is the refusal.
fn reported(profile: &GgAgentConfig) -> (SandboxLimits, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let limits = resolve_sandbox_limits(profile, &mut report);
    (limits, report.into_defects())
}

/// An agent profile carrying `responses-as-code` with the given params.
fn set_with(params: serde_json::Value) -> GgAgentConfig {
    GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params,
            ..GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    }
}

/// A run that does not mention the capability at all runs at the default ceilings.
#[test]
fn an_absent_capability_resolves_to_the_defaults() {
    assert_eq!(limits_of(&GgAgentConfig::root()), SandboxLimits::default());
}

/// A capability with no params is the ordinary case, and is also the defaults.
#[test]
fn a_capability_with_no_params_resolves_to_the_defaults() {
    assert_eq!(limits_of(&set_with(json!({}))), SandboxLimits::default());

    // An explicit `null` is the same statement as leaving the key out.
    assert_eq!(
        limits_of(&set_with(
            json!({ "timeoutSecs": null, "maxMemoryBytes": null })
        )),
        SandboxLimits::default()
    );
}

/// A configured `timeoutSecs` is honoured — the whole point of the param.
#[test]
fn a_configured_timeout_is_honoured() {
    let limits = limits_of(&set_with(json!({ "timeoutSecs": 12 })));
    assert_eq!(limits.timeout, Duration::from_secs(12));
    assert_eq!(
        limits.max_memory_bytes,
        SandboxLimits::default().max_memory_bytes,
        "an unset param must not disturb the other one"
    );
}

/// Zero seconds names no ceiling — a run at zero could not execute even the guest's own setup, so
/// every turn would fail identically — and taking gg's 30 seconds instead would run the ordinary arm
/// under the starved arm's name. **Refused.**
#[test]
fn a_zero_timeout_is_refused() {
    let (limits, defects) = reported(&set_with(json!({ "timeoutSecs": 0 })));
    assert_eq!(
        limits.timeout,
        SandboxLimits::default().timeout,
        "the resolver stays total"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.timeoutSecs");
}

/// A `timeoutSecs` gg cannot read as a number at all is refused on the same terms.
#[test]
fn a_non_numeric_timeout_is_refused() {
    for value in [json!("ages"), json!(true), json!([30])] {
        let (limits, defects) = reported(&set_with(json!({ "timeoutSecs": value.clone() })));
        assert_eq!(limits.timeout, SandboxLimits::default().timeout);
        assert_eq!(defects.len(), 1, "{value} -> {defects:?}");
        assert_eq!(defects[0].locus, "responses-as-code.params.timeoutSecs");
    }
}

/// **A fraction is a time.** The timeout is a wall-clock duration, so `0.5` is half a second — a
/// study measuring a very short ceiling has every reason to ask for one, and it must not fall back
/// the way a fractional *count* would.
#[test]
fn a_fractional_timeout_is_honoured() {
    let limits = limits_of(&set_with(json!({ "timeoutSecs": 0.5 })));
    assert_eq!(limits.timeout, Duration::from_millis(500));

    // Zero and a negative name no ceiling, and are refused rather than becoming something
    // arbitrary. (JSON has no infinity and no NaN — `serde_json` writes both as `null`, which is
    // the absent case and takes the default.)
    for nonsense in [0.0, -1.0] {
        let (limits, defects) = reported(&set_with(json!({ "timeoutSecs": nonsense })));
        assert_eq!(
            limits.timeout,
            SandboxLimits::default().timeout,
            "{nonsense}: the resolver stays total"
        );
        assert_eq!(defects.len(), 1, "{nonsense} -> {defects:?}");
        assert_eq!(defects[0].locus, "responses-as-code.params.timeoutSecs");
    }
}

/// **An integral float is a byte count**, and a fractional one is not. JSON has no integer type, so
/// a sweep generated from JavaScript writes `5e8` as readily as `500000000` and both name the same
/// half-gigabyte cap; `1_048_576.5` names no whole number of bytes, and rounding it would be gg
/// choosing a cap nobody wrote.
#[test]
fn a_memory_cap_is_a_whole_number_of_bytes() {
    assert_eq!(
        limits_of(&set_with(json!({ "maxMemoryBytes": 5e8 }))).max_memory_bytes,
        500_000_000
    );
    let (limits, defects) = reported(&set_with(json!({ "maxMemoryBytes": 1_048_576.5 })));
    assert_eq!(
        limits.max_memory_bytes,
        SandboxLimits::default().max_memory_bytes,
        "the resolver stays total"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.maxMemoryBytes");
}

/// A configured memory cap is honoured, including one deliberately below the guest's floor — a
/// study may starve the sandbox on purpose, and what protects the operator is the error message,
/// not a clamp.
#[test]
fn a_configured_memory_cap_is_honoured_even_below_the_guest_floor() {
    let limits = limits_of(&set_with(json!({ "maxMemoryBytes": 4_194_304 })));
    assert_eq!(limits.max_memory_bytes, 4_194_304);
    assert_eq!(limits.timeout, SandboxLimits::default().timeout);
}

/// Zero memory is refused for the same reason a zero timeout is.
#[test]
fn a_zero_memory_cap_is_refused() {
    let (limits, defects) = reported(&set_with(json!({ "maxMemoryBytes": 0 })));
    assert_eq!(
        limits.max_memory_bytes,
        SandboxLimits::default().max_memory_bytes,
        "the resolver stays total"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.maxMemoryBytes");
}

/// **Both unusable ceilings are named in one refusal.** An operator fixing a sweep's one shared
/// configuration wants every knob they got wrong, not the first one.
#[test]
fn every_unusable_ceiling_is_named_at_once() {
    let (_, defects) = reported(&set_with(
        json!({ "timeoutSecs": "ages", "maxMemoryBytes": -1 }),
    ));
    let loci: Vec<&str> = defects.iter().map(|defect| defect.locus.as_str()).collect();
    assert_eq!(
        loci,
        vec![
            "responses-as-code.params.timeoutSecs",
            "responses-as-code.params.maxMemoryBytes",
        ]
    );
}

/// Both params together, which is how a sweep configures an arm.
#[test]
fn every_param_resolves_together() {
    let limits = limits_of(&set_with(
        json!({ "timeoutSecs": 5, "maxMemoryBytes": 65_536 }),
    ));
    assert_eq!(limits.timeout, Duration::from_secs(5));
    assert_eq!(limits.max_memory_bytes, 65_536);
}

/// The defaults themselves, asserted as values: the timeout is a pure infinite-loop guard (see the
/// type's own docs) and a change to any of them should be a deliberate edit here as well.
#[test]
fn the_defaults_are_the_expected_ceilings() {
    let limits = SandboxLimits::default();
    assert_eq!(limits.timeout, Duration::from_secs(30));
    assert_eq!(limits.max_memory_bytes, 268_435_456);
}

/// The limiter denies growth past the cap and — the part the classifier depends on — remembers that
/// it did, because a component has no single named memory to measure afterwards.
#[test]
fn the_memory_limiter_records_a_denial() {
    let mut limiter = MemoryLimiter::new(1_024);
    assert!(!limiter.denied(), "nothing has been denied yet");

    assert_eq!(
        limiter.memory_growing(0, 512, None).ok(),
        Some(true),
        "growth within the cap is allowed"
    );
    assert!(!limiter.denied(), "an allowed growth is not a denial");

    assert_eq!(
        limiter.memory_growing(512, 2_048, None).ok(),
        Some(false),
        "growth past the cap is denied"
    );
    assert!(limiter.denied(), "the denial must be remembered");
}

/// **A denial the guest recovered from is not what ended the run.**
///
/// Returning `Ok(false)` does not trap — wasmtime turns it into a `-1` from `memory.grow`, and a
/// JavaScript engine that gets one typically collects garbage and retries with a smaller request.
/// If the flag stayed set, a program that was squeezed once, recovered, and later failed for some
/// unrelated reason would be reported as an out-of-memory naming a cap that had nothing to do with
/// it.
#[test]
fn a_denial_the_guest_recovered_from_is_forgotten() {
    let mut limiter = MemoryLimiter::new(1_024);

    assert_eq!(limiter.memory_growing(0, 2_048, None).ok(), Some(false));
    assert!(limiter.denied());

    assert_eq!(
        limiter.memory_growing(0, 512, None).ok(),
        Some(true),
        "the retry fits"
    );
    assert!(
        !limiter.denied(),
        "a guest that recovered must not be blamed on the memory cap"
    );
}

/// Tables hold function references a program cannot grow, so the limiter has no opinion about them.
#[test]
fn the_memory_limiter_does_not_cap_tables() {
    let mut limiter = MemoryLimiter::new(1_024);
    assert_eq!(limiter.table_growing(0, 1_000_000, None).ok(), Some(true));
    assert!(!limiter.denied());
}
