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
    assert_eq!(
        resolve_sandbox_limits(&GgAgentConfig::root()),
        SandboxLimits::default()
    );
}

/// A capability with no params is the ordinary case, and is also the defaults.
#[test]
fn a_capability_with_no_params_resolves_to_the_defaults() {
    assert_eq!(
        resolve_sandbox_limits(&set_with(json!({}))),
        SandboxLimits::default()
    );
}

/// A configured `timeoutSecs` is honoured — the whole point of the param.
#[test]
fn a_configured_timeout_is_honoured() {
    let limits = resolve_sandbox_limits(&set_with(json!({ "timeoutSecs": 12 })));
    assert_eq!(limits.timeout, Duration::from_secs(12));
    assert_eq!(
        limits.max_memory_bytes,
        SandboxLimits::default().max_memory_bytes,
        "an unset param must not disturb the other one"
    );
}

/// Zero seconds is "not configured", not "no time at all": a run at zero could not execute even the
/// guest's own setup, so every turn would fail identically — never what a study asked for.
#[test]
fn a_zero_timeout_falls_back_to_the_default() {
    let limits = resolve_sandbox_limits(&set_with(json!({ "timeoutSecs": 0 })));
    assert_eq!(limits.timeout, SandboxLimits::default().timeout);
}

/// A non-numeric param is a misconfiguration that must not take the run down with it.
#[test]
fn a_non_numeric_timeout_falls_back_to_the_default() {
    let limits = resolve_sandbox_limits(&set_with(json!({ "timeoutSecs": "ages" })));
    assert_eq!(limits.timeout, SandboxLimits::default().timeout);
}

/// **A fraction is a time.** The timeout is a wall-clock duration, so `0.5` is half a second — a
/// study measuring a very short ceiling has every reason to ask for one, and it must not fall back
/// the way a fractional *count* would.
#[test]
fn a_fractional_timeout_is_honoured() {
    let limits = resolve_sandbox_limits(&set_with(json!({ "timeoutSecs": 0.5 })));
    assert_eq!(limits.timeout, Duration::from_millis(500));

    // A memory fraction still truncates: it is a count, not a duration.
    let limits = resolve_sandbox_limits(&set_with(json!({ "maxMemoryBytes": 1_048_576.5 })));
    assert_eq!(limits.max_memory_bytes, 1_048_576);

    // Zero, a negative, and anything not finite fall back rather than becoming something arbitrary.
    for nonsense in [0.0, f64::NAN, f64::INFINITY, -1.0] {
        let limits = resolve_sandbox_limits(&set_with(json!({ "timeoutSecs": nonsense })));
        assert_eq!(
            limits.timeout,
            SandboxLimits::default().timeout,
            "{nonsense} must not configure a timeout"
        );
    }
}

/// A configured memory cap is honoured, including one deliberately below the guest's floor — a
/// study may starve the sandbox on purpose, and what protects the operator is the error message,
/// not a clamp.
#[test]
fn a_configured_memory_cap_is_honoured_even_below_the_guest_floor() {
    let limits = resolve_sandbox_limits(&set_with(json!({ "maxMemoryBytes": 4_194_304 })));
    assert_eq!(limits.max_memory_bytes, 4_194_304);
    assert_eq!(limits.timeout, SandboxLimits::default().timeout);
}

/// Zero memory falls back for the same reason a zero timeout does.
#[test]
fn a_zero_memory_cap_falls_back_to_the_default() {
    let limits = resolve_sandbox_limits(&set_with(json!({ "maxMemoryBytes": 0 })));
    assert_eq!(
        limits.max_memory_bytes,
        SandboxLimits::default().max_memory_bytes
    );
}

/// Both params together, which is how a sweep configures an arm.
#[test]
fn every_param_resolves_together() {
    let limits = resolve_sandbox_limits(&set_with(
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
