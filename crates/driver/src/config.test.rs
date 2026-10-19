//! Tests for the driver's environment parsing helpers.

use std::time::Duration;

use super::*;

#[test]
fn an_unset_wait_takes_its_default() {
    let wait = parse_wait("TCAB_X", None, Duration::from_secs(21_600)).expect("default");
    assert_eq!(wait, Duration::from_secs(21_600));
}

#[test]
fn a_wait_is_whole_seconds_and_zero_is_allowed() {
    let wait = parse_wait("TCAB_X", Some("90".to_string()), Duration::ZERO).expect("parses");
    assert_eq!(wait, Duration::from_secs(90));
    let wait = parse_wait("TCAB_X", Some("0".to_string()), Duration::from_secs(5)).expect("zero");
    assert_eq!(wait, Duration::ZERO);
}

#[test]
fn a_wait_that_is_not_whole_seconds_is_a_configuration_error() {
    for bad in ["1.5", "-1", "6h", "forever"] {
        let err = parse_wait("TCAB_X", Some(bad.to_string()), Duration::ZERO).expect_err("refused");
        match err {
            ConfigError::Invalid { name, value, .. } => {
                assert_eq!(name, "TCAB_X");
                assert_eq!(value, bad);
            }
            other => panic!("unexpected error {other:?}"),
        }
    }
}

/// A lookup answering from `vars`, as `non_empty` answers from the environment.
fn lookup(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let vars: Vec<(String, String)> = vars
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |key| vars.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

#[test]
fn both_finishing_waits_default_to_six_hours() {
    let waits = FinishingWaits::from_lookup(lookup(&[])).expect("defaults");
    assert_eq!(waits.upload_wait, Duration::from_secs(21_600));
    assert_eq!(waits.report_wait, Duration::from_secs(21_600));
}

#[test]
fn the_report_wait_is_read_from_its_own_variable() {
    let waits = FinishingWaits::from_lookup(lookup(&[
        ("TCAB_DRIVER_REPORT_WAIT_SECONDS", "120"),
        ("TCAB_ARTIFACT_UPLOAD_WAIT_SECONDS", "30"),
    ]))
    .expect("parses");
    assert_eq!(waits.report_wait, Duration::from_secs(120));
    assert_eq!(waits.upload_wait, Duration::from_secs(30));

    let waits = FinishingWaits::from_lookup(lookup(&[("TCAB_DRIVER_REPORT_WAIT_SECONDS", "0")]))
        .expect("zero");
    assert_eq!(
        waits.report_wait,
        Duration::ZERO,
        "0 makes a single attempt"
    );
    assert_eq!(waits.upload_wait, Duration::from_secs(21_600));
}

#[test]
fn a_report_wait_that_is_not_whole_seconds_stops_the_driver() {
    let err = FinishingWaits::from_lookup(lookup(&[("TCAB_DRIVER_REPORT_WAIT_SECONDS", "6h")]))
        .expect_err("refused");
    match err {
        ConfigError::Invalid { name, value, .. } => {
            assert_eq!(name, "TCAB_DRIVER_REPORT_WAIT_SECONDS");
            assert_eq!(value, "6h");
        }
        other => panic!("unexpected error {other:?}"),
    }
}
