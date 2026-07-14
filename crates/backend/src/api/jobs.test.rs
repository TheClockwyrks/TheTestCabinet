use super::*;

// --- The auto-retry decision ------------------------------------------------

#[test]
fn retryable_only_for_infrastructure_and_catastrophic() {
    // Our infra broke, or the build won't load (the model's fault, but a real
    // signal we re-run): both are retried.
    assert!(is_retryable(RunState::Infrastructure));
    assert!(is_retryable(RunState::Catastrophic));
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
