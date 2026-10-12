//! Tests for the driver's configuration: the setting that bounds its wait on the
//! artifact store, and the retry policy built from it.

use std::time::Duration;

use super::{ConfigError, upload_wait_from};
use crate::artifacts::UploadRetry;

#[test]
fn the_wait_defaults_to_six_hours() {
    assert_eq!(
        upload_wait_from(None).unwrap(),
        Duration::from_secs(6 * 60 * 60)
    );
    assert_eq!(upload_wait_from(None).unwrap(), Duration::from_secs(21_600));
}

#[test]
fn the_wait_is_the_number_of_seconds_set() {
    assert_eq!(
        upload_wait_from(Some("3600".to_string())).unwrap(),
        Duration::from_secs(3600)
    );
    // Surrounding whitespace, as a manifest's quoting can leave it.
    assert_eq!(
        upload_wait_from(Some(" 90 ".to_string())).unwrap(),
        Duration::from_secs(90)
    );
}

#[test]
fn a_wait_of_zero_is_a_single_attempt() {
    let wait = upload_wait_from(Some("0".to_string())).unwrap();

    assert_eq!(wait, Duration::ZERO);
    assert_eq!(
        UploadRetry::waiting_for(wait),
        UploadRetry::single_attempt()
    );
}

#[test]
fn a_wait_that_is_not_a_whole_number_of_seconds_is_refused_by_name() {
    for value in ["6h", "-1", "1.5", "forever"] {
        let err = upload_wait_from(Some(value.to_string())).unwrap_err();
        match err {
            ConfigError::Invalid {
                name,
                value: reported,
                ..
            } => {
                assert_eq!(name, "TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS");
                assert_eq!(reported, value);
            }
            other => panic!("expected an invalid value, got {other:?}"),
        }
    }
}

#[test]
fn the_variable_read_is_the_documented_one() {
    assert_eq!(super::UPLOAD_WAIT_VAR, "TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS");
}

#[test]
fn the_retry_policy_is_the_default_pacing_under_the_configured_wait() {
    let mut config = super::Config {
        backend_url: "http://backend".to_string(),
        job_id: "job-9".to_string(),
        job_token: "tok-1".to_string(),
        launch: serde_json::from_value(serde_json::json!({
            "testCase": "pong",
            "version": "v1.0.0",
            "variant": "base",
            "harness": "claude",
            "model": "m",
        }))
        .expect("a launch body"),
        runtime: super::DriverRuntime::Cli,
        work_dir: ".tcab-driver".into(),
        artifacts_url: None,
        upload_wait: Duration::from_secs(1800),
        subscription_dir: None,
        kubernetes: Default::default(),
    };

    let retry = config.upload_retry();
    assert_eq!(retry.give_up_after, Duration::from_secs(1800));
    assert_eq!(
        UploadRetry {
            give_up_after: UploadRetry::default().give_up_after,
            ..retry
        },
        UploadRetry::default(),
        "only the wait bound differs from the default policy"
    );

    config.upload_wait = Duration::ZERO;
    assert_eq!(config.upload_retry(), UploadRetry::single_attempt());
}
