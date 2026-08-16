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

// --- Attribution ------------------------------------------------------------

/// A signed-in account to attribute a launch to.
fn account(id: &str) -> AuthUser {
    AuthUser(test_cabinet_core::Account {
        id: id.to_string(),
        username: "reviewer".to_string(),
        display_name: "Reviewer".to_string(),
        picture_updated_at: None,
    })
}

/// The launch request the attribution tests enqueue; the body itself is irrelevant
/// to them, only the columns lifted alongside it.
fn launch_body() -> LaunchBody {
    serde_json::from_str(
        r#"{"testCase":"pong","version":"v1.0.0","variant":"base","harness":"claude","model":"m"}"#,
    )
    .expect("the fixture launch body parses")
}

#[test]
fn a_manual_launch_records_the_account_but_no_origin() {
    let attribution = attribution(&account("acct-1"), &LaunchQuery::default())
        .expect("no origin is not an error");
    let job = build_new_job(
        &launch_body(),
        TestType::EndToEnd,
        "2026-08-15T00:00:00Z",
        &attribution,
    )
    .expect("the fixture body is valid");

    // The account is recorded — it used to be discarded — while the absent origin is
    // what keeps a hand-launched run out of every plan's and ladder's scoped halt.
    assert_eq!(job.user_id.as_deref(), Some("acct-1"));
    assert_eq!(job.origin, None);
}

#[test]
fn a_top_up_launch_records_the_plan_or_ladder_that_asked_for_it() {
    for (token, expected) in [
        ("plan:p-1", JobOrigin::Plan("p-1".to_string())),
        ("ladder:l-1", JobOrigin::Ladder("l-1".to_string())),
    ] {
        let query = LaunchQuery {
            origin: Some(token.to_string()),
        };
        let attribution = attribution(&account("acct-1"), &query).expect("a valid origin parses");
        let job = build_new_job(
            &launch_body(),
            TestType::EndToEnd,
            "2026-08-15T00:00:00Z",
            &attribution,
        )
        .expect("the fixture body is valid");
        assert_eq!(job.origin, Some(expected));
    }
}

#[test]
fn an_unparseable_origin_is_rejected_rather_than_dropped() {
    // Silently dropping it would enqueue runs the plan can never halt, and the fault
    // would only surface much later as a plan that will not stop.
    for token in ["", "plan:", "sweep:1", "p-1"] {
        let query = LaunchQuery {
            origin: Some(token.to_string()),
        };
        let error = attribution(&account("acct-1"), &query)
            .expect_err("an origin that is present must be understood");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }
}
