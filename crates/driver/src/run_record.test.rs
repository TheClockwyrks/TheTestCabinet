//! The failure classification over this crate's errors; the run record's own
//! tests live beside its shapes in `test_cabinet_contracts`.

use super::*;

#[test]
fn classify_failure_only_runtime_cap_is_a_timeout() {
    assert_eq!(
        RunState::classify_failure(&crate::Error::RunTimedOut {
            slug: "claude".to_string(),
            seconds: 1800,
        }),
        RunState::TimedOut
    );
    // The harness (or its orchestrator runner) exiting non-zero is a harness
    // error — the model drove it to exit early — not an infrastructure fault.
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessInvocation {
            slug: "claude".to_string(),
            detail: "harness exited with code 1".to_string(),
        }),
        RunState::HarnessError
    );
    // A harness that stopped the run on one of its own configured execution
    // ceilings is held apart from the non-zero exit above, because that outcome is
    // a property of the configuration and must never be retried.
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessLimitExceeded {
            slug: "gg".to_string(),
            detail: "5 consecutive turns failed".to_string(),
        }),
        RunState::LimitExceeded
    );
    // A harness killed by the idle watchdog neither finished nor failed: it is a
    // hang, distinct from both the non-zero exit above and the runtime cap.
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessHung {
            slug: "opencode".to_string(),
            seconds: 1800,
        }),
        RunState::Hung
    );
    // A harness install timeout is the Test Cabinet's plumbing, not the model.
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessInstallTimedOut {
            slug: "claude".to_string(),
            seconds: 60,
        }),
        RunState::Infrastructure
    );
    assert_eq!(
        RunState::classify_failure(&crate::Error::ContainerRuntime("boom".to_string())),
        RunState::Infrastructure
    );
}

/// A session the container session log leaves open is the platform's end, not the
/// model's: whatever the harness managed before the connection dropped is not its
/// result, so the run is the Test Cabinet's infrastructure failure.
#[test]
fn a_lost_session_is_an_infrastructure_failure() {
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessSessionLost {
            slug: "claude".to_string(),
            unfinished: 1,
            total: 1,
            exit_code: 0,
        }),
        RunState::Infrastructure
    );
}

/// Every other end the platform caused — a gone or disrupted sandbox, a signal exit,
/// a lost exec stream, a gg exit `0` with no `session_ended` — is infrastructure too.
#[test]
fn a_session_the_platform_ended_is_an_infrastructure_failure() {
    assert_eq!(
        RunState::classify_failure(&crate::Error::HarnessEndedByPlatform {
            slug: "gg".to_string(),
            detail: "exit code 137".to_string(),
        }),
        RunState::Infrastructure
    );
}
