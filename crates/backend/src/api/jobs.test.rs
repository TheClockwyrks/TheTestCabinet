use super::*;

// --- The auto-retry decision ------------------------------------------------

#[test]
fn retryable_for_infrastructure_catastrophic_and_harness_error() {
    // Our infra broke, or the build won't load (the model's fault, but a real
    // signal we re-run): both are retried.
    assert!(is_retryable(RunState::Infrastructure));
    assert!(is_retryable(RunState::Catastrophic));
    // A harness exiting non-zero is retried too — an auth-token refresh self-heals
    // on a retry; a genuine crash burns its bounded retries then settles.
    assert!(is_retryable(RunState::HarnessError));
    // A hang is retried for the same reason: a stalled provider request usually
    // gets further on a fresh attempt, and the retry costs less than the slot.
    assert!(is_retryable(RunState::Hung));
    // A timeout is the model never converging, and a completed run is a success —
    // neither is a fault to retry.
    assert!(!is_retryable(RunState::TimedOut));
    assert!(!is_retryable(RunState::Completed));
}

#[test]
fn retry_count_defaults_to_one_when_absent() {
    // A launch request that omits `retryCount` is treated as one retry.
    let json =
        r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m"}"#;
    assert_eq!(retry_count_of(json), DEFAULT_RETRY_COUNT);
    assert_eq!(retry_count_of(json), 1);
}

#[test]
fn retry_count_reads_the_request_and_clamps_to_max() {
    let zero = r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m","retryCount":0}"#;
    assert_eq!(retry_count_of(zero), 0);

    let three = r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m","retryCount":3}"#;
    assert_eq!(retry_count_of(three), 3);

    // An absurd value is clamped to the ceiling rather than honored verbatim.
    let huge = r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m","retryCount":1000000}"#;
    assert_eq!(retry_count_of(huge), MAX_RETRY_COUNT);
}

#[test]
fn retry_count_falls_back_to_default_on_unparseable_request() {
    // A stored request that cannot be parsed still yields a sane default rather than
    // panicking or disabling retries silently.
    assert_eq!(retry_count_of("not json"), DEFAULT_RETRY_COUNT);
}

#[test]
fn terminal_run_state_falls_back_when_no_record() {
    // With no record, the caller's fallback stands in (a `failed` report with no
    // record it could build is treated as our infrastructure).
    assert_eq!(
        terminal_run_state(None, RunState::Infrastructure),
        RunState::Infrastructure
    );
}

// --- The models a launch asks the catalog about -----------------------------

#[test]
fn launch_models_covers_the_run_model_and_every_bound_agent_model() {
    // A gg run's catalog set is the run's own model plus each model its capability
    // set binds to an agent, de-duplicated — so a subagent on a different model is
    // priced (and window-resolved) too, and a shared model is asked about once.
    let mut set = test_cabinet_core::gg::GgCapabilitySet::minimal("anthropic/claude-opus-4.8");
    set.agents.push(test_cabinet_core::gg::GgAgentConfig {
        name: "subagent".to_string(),
        model_id: "openai/gpt-5.4-mini".to_string(),
        ..test_cabinet_core::gg::GgAgentConfig::root()
    });
    let body = LaunchBody {
        test_case: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness: HarnessSlug::Gg,
        model: "anthropic/claude-opus-4.8".to_string(),
        orchestrator: None,
        max_runtime_seconds: None,
        auth_mode: None,
        retry_count: None,
        gg_capability_set: Some(set),
        gg_model_windows: Default::default(),
        gg_model_modalities: Default::default(),
    };

    assert_eq!(
        launch_models(&body),
        vec![
            ("anthropic/claude-opus-4.8".to_string(), HarnessSlug::Gg),
            ("openai/gpt-5.4-mini".to_string(), HarnessSlug::Gg),
        ]
    );
}

#[test]
fn launch_models_of_a_third_party_harness_run_is_its_one_model() {
    // No capability set: the run's single model, under the harness that will run it.
    let body = LaunchBody {
        test_case: "pong".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness: HarnessSlug::Claude,
        model: "claude-opus-4-8".to_string(),
        orchestrator: None,
        max_runtime_seconds: None,
        auth_mode: None,
        retry_count: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
        gg_model_modalities: Default::default(),
    };

    assert_eq!(
        launch_models(&body),
        vec![("claude-opus-4-8".to_string(), HarnessSlug::Claude)]
    );
}
