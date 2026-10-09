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
