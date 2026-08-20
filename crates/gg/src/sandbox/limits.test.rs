//! Tests for limit resolution and the memory limiter.
//!
//! The resolution half matters more than it looks: these params are what a study sets to measure
//! what starving (or over-feeding) a sandbox does, and a ceiling gg supplied would turn a
//! configured arm into a run at figures nobody wrote under the configured arm's name. So each param
//! is asserted three ways — that it is honoured as written, that it does **not disturb the other**,
//! since the failure that costs a study its result is a sweep in which one configured knob quietly
//! reset another, and that its absence refuses the launch rather than resolving to anything at all.

use std::time::Duration;

use serde_json::json;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgCapabilityConfig};
use wasmtime::ResourceLimiter;

use super::*;
use crate::validate::{LaunchDefect, LaunchReport};

/// A `responses-as-code` params object stating **both** ceilings, which is what an enabled
/// capability writes — the base the cases that vary one of them start from.
///
/// Written out per case rather than resolved from anywhere, because there is nowhere to resolve it
/// from: gg holds no figure for either param, and a profile that leaves one out is refused.
fn both(timeout_secs: serde_json::Value, max_memory_bytes: serde_json::Value) -> serde_json::Value {
    json!({ "timeoutSecs": timeout_secs, "maxMemoryBytes": max_memory_bytes })
}

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

/// An agent whose profile does not mention the capability runs no program, so there is nothing for
/// a ceiling to bound and nothing for its profile to have written.
#[test]
fn an_absent_capability_bounds_no_program() {
    assert_eq!(limits_of(&GgAgentConfig::root()), SandboxLimits::NO_PROGRAM);
}

/// **An enabled capability that writes neither ceiling is refused, at both loci.** gg holds no
/// figure for either, so an absence is a hole rather than a setting — and a run conducted at
/// ceilings gg picked, under a record naming the profile's, is the wrong-arm failure the refusal
/// exists to prevent.
#[test]
fn an_enabled_capability_short_of_a_ceiling_is_refused() {
    for params in [
        json!({}),
        json!({ "timeoutSecs": null, "maxMemoryBytes": null }),
    ] {
        let (limits, defects) = reported(&set_with(params.clone()));
        assert_eq!(
            limits,
            SandboxLimits::LAUNCH_REFUSED,
            "{params}: the resolver stays total, on a named placeholder"
        );
        let loci: Vec<&str> = defects.iter().map(|defect| defect.locus.as_str()).collect();
        assert_eq!(
            loci,
            vec![
                "responses-as-code.params.timeoutSecs",
                "responses-as-code.params.maxMemoryBytes",
            ],
            "{params}"
        );
        assert!(
            defects.iter().all(|defect| defect.found.is_empty()),
            "{params}: an absence has no value as written -> {defects:?}"
        );
    }
}

/// Each ceiling is required on its own, so a profile that writes one and not the other is refused
/// at exactly the locus it is short of.
#[test]
fn each_ceiling_is_required_on_its_own() {
    for (params, locus) in [
        (
            json!({ "timeoutSecs": 12 }),
            "responses-as-code.params.maxMemoryBytes",
        ),
        (
            json!({ "maxMemoryBytes": 65_536 }),
            "responses-as-code.params.timeoutSecs",
        ),
    ] {
        let (limits, defects) = reported(&set_with(params.clone()));
        assert_eq!(limits, SandboxLimits::LAUNCH_REFUSED, "{params}");
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(defects[0].locus, locus, "{params}");
    }
}

/// **A disabled capability is short of nothing.** It bounds no program, so there is no ceiling for
/// it to have stated — while a ceiling it *does* write is still read, and still refused.
#[test]
fn a_disabled_capability_requires_no_ceiling() {
    let disabled = |params: serde_json::Value| GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            params,
            ..GgCapabilityConfig::disabled(CAPABILITY_RESPONSES_AS_CODE)
        }],
        ..GgAgentConfig::root()
    };
    assert_eq!(limits_of(&disabled(json!({}))), SandboxLimits::NO_PROGRAM);

    let (_, defects) = reported(&disabled(json!({ "timeoutSecs": 0 })));
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.timeoutSecs");
}

/// A configured `timeoutSecs` is honoured — the whole point of the param — and does not disturb the
/// cap written beside it.
#[test]
fn a_configured_timeout_is_honoured() {
    let limits = limits_of(&set_with(both(json!(12), json!(65_536))));
    assert_eq!(limits.timeout, Duration::from_secs(12));
    assert_eq!(
        limits.max_memory_bytes, 65_536,
        "one configured knob must not disturb the other"
    );
}

/// Zero seconds names no ceiling — a run at zero could not execute even the guest's own setup, so
/// every turn would fail identically — and gg arms none of its own in its place. **Refused.**
#[test]
fn a_zero_timeout_is_refused() {
    let (limits, defects) = reported(&set_with(both(json!(0), json!(65_536))));
    assert_eq!(
        limits,
        SandboxLimits::LAUNCH_REFUSED,
        "the resolver stays total"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.timeoutSecs");
}

/// A `timeoutSecs` gg cannot read as a number at all is refused on the same terms.
#[test]
fn a_non_numeric_timeout_is_refused() {
    for value in [json!("ages"), json!(true), json!([30])] {
        let (limits, defects) = reported(&set_with(both(value.clone(), json!(65_536))));
        assert_eq!(limits, SandboxLimits::LAUNCH_REFUSED);
        assert_eq!(defects.len(), 1, "{value} -> {defects:?}");
        assert_eq!(defects[0].locus, "responses-as-code.params.timeoutSecs");
    }
}

/// **A fraction is a time.** The timeout is a wall-clock duration, so `0.5` is half a second — a
/// study measuring a very short ceiling has every reason to ask for one, and it must not be read
/// the way a fractional *count* is.
#[test]
fn a_fractional_timeout_is_honoured() {
    let limits = limits_of(&set_with(both(json!(0.5), json!(65_536))));
    assert_eq!(limits.timeout, Duration::from_millis(500));

    // Zero and a negative name no ceiling, and are refused rather than becoming something
    // arbitrary. (JSON has no infinity and no NaN — `serde_json` writes both as `null`, which is
    // the absent case and is refused too.)
    for nonsense in [0.0, -1.0] {
        let (limits, defects) = reported(&set_with(both(json!(nonsense), json!(65_536))));
        assert_eq!(
            limits,
            SandboxLimits::LAUNCH_REFUSED,
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
        limits_of(&set_with(both(json!(30), json!(5e8)))).max_memory_bytes,
        500_000_000
    );
    let (limits, defects) = reported(&set_with(both(json!(30), json!(1_048_576.5))));
    assert_eq!(
        limits,
        SandboxLimits::LAUNCH_REFUSED,
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
    let limits = limits_of(&set_with(both(json!(30), json!(4_194_304))));
    assert_eq!(limits.max_memory_bytes, 4_194_304);
    assert_eq!(limits.timeout, Duration::from_secs(30));
}

/// Zero memory is refused for the same reason a zero timeout is.
#[test]
fn a_zero_memory_cap_is_refused() {
    let (limits, defects) = reported(&set_with(both(json!(30), json!(0))));
    assert_eq!(
        limits,
        SandboxLimits::LAUNCH_REFUSED,
        "the resolver stays total"
    );
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert_eq!(defects[0].locus, "responses-as-code.params.maxMemoryBytes");
}

/// **Both unusable ceilings are named in one refusal.** An operator fixing a sweep's one shared
/// configuration wants every knob they got wrong, not the first one.
#[test]
fn every_unusable_ceiling_is_named_at_once() {
    let (_, defects) = reported(&set_with(both(json!("ages"), json!(-1))));
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
    let limits = limits_of(&set_with(both(json!(5), json!(65_536))));
    assert_eq!(limits.timeout, Duration::from_secs(5));
    assert_eq!(limits.max_memory_bytes, 65_536);
}

/// The two ceilings a refused launch and a program-free agent carry are the same statement, and
/// neither is a figure: nothing runs under either.
#[test]
fn the_placeholder_ceilings_bound_nothing() {
    assert_eq!(SandboxLimits::LAUNCH_REFUSED, SandboxLimits::NO_PROGRAM);
    assert_eq!(SandboxLimits::NO_PROGRAM.timeout, Duration::ZERO);
    assert_eq!(SandboxLimits::NO_PROGRAM.max_memory_bytes, 0);
}

/// The ceilings gg's own tests state for themselves are an ordinary configuration — a profile that
/// writes them resolves to exactly them — which is what keeps the fixture a document rather than a
/// figure gg holds on anyone's behalf.
#[test]
fn the_test_fixture_is_a_configuration_a_profile_could_write() {
    assert_eq!(
        limits_of(&set_with(both(json!(30), json!(268_435_456)))),
        SandboxLimits::AMPLE
    );
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
