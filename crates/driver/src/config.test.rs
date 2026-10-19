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
