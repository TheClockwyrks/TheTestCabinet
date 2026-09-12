//! The failure the driver builds from an engine error: its classified state, and the
//! one flag the driver's `main` reads ahead of every other disposition — that the run
//! was killed before its session was launched and is to be destroyed, not recorded.

use super::*;

#[test]
fn a_launch_refused_for_a_killed_run_is_flagged_and_classified_canceled() {
    let failure = RunFailure::from_engine(&Error::CanceledBeforeSession, None);

    assert!(
        failure.canceled_before_session,
        "the driver destroys this run instead of recording it, and the flag is how it knows",
    );
    assert_eq!(failure.state, RunState::Canceled);
    assert_eq!(
        failure.detail,
        "run failed: canceled before the harness session launched",
    );
}

#[test]
fn every_other_engine_error_is_an_ordinary_failure() {
    // The flag is exclusive to the refused launch: a run that errors for any other
    // reason is recorded, killed or not — a killed gg run that errored winding down is
    // recorded bare, and everything else is a failure against the model or the fleet.
    let errors = [
        Error::ContainerRuntime("the sandbox went away".to_string()),
        Error::RunTimedOut {
            slug: "gg".to_string(),
            seconds: 3600,
        },
        Error::HarnessHung {
            slug: "gg".to_string(),
            seconds: 1800,
        },
    ];
    for err in errors {
        let failure = RunFailure::from_engine(&err, None);
        assert!(
            !failure.canceled_before_session,
            "{err} is not a refused launch",
        );
        assert_ne!(failure.state, RunState::Canceled, "{err}");
    }
}
