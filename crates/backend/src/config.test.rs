use std::path::{Path, PathBuf};

use super::{base_url, gg_reference_dir, truthy};

/// A throwaway env var read by no other code, so setting it here cannot race with
/// another test's configuration read.
const PROBE: &str = "TCAB_TEST_TRUTHY_PROBE";

/// The equivalent throwaway var for the [`base_url`] test.
const URL_PROBE: &str = "TCAB_TEST_BASE_URL_PROBE";

#[test]
fn base_url_normalizes_a_service_url_and_maps_absence_to_none() {
    // One test, as with `truthy` above, so the shared probe var is mutated on one
    // thread.

    // A trailing slash is trimmed so a caller's `format!("{base}/runs")` never
    // produces a doubled separator.
    // SAFETY: URL_PROBE is read only by this test, so mutating it is isolated.
    unsafe { std::env::set_var(URL_PROBE, "http://tcab-artifacts:8790/") };
    assert_eq!(
        base_url(URL_PROBE).as_deref(),
        Some("http://tcab-artifacts:8790")
    );

    // A bare host is already normalized and survives untouched.
    // SAFETY: as above.
    unsafe { std::env::set_var(URL_PROBE, "http://tcab-artifacts:8790") };
    assert_eq!(
        base_url(URL_PROBE).as_deref(),
        Some("http://tcab-artifacts:8790")
    );

    // An empty value is the same as no value: a deployment that sets the variable to
    // nothing has not configured the service.
    // SAFETY: as above.
    unsafe { std::env::set_var(URL_PROBE, "") };
    assert_eq!(base_url(URL_PROBE), None);

    // SAFETY: as above.
    unsafe { std::env::remove_var(URL_PROBE) };
    assert_eq!(base_url(URL_PROBE), None);
}

#[test]
fn truthy_recognizes_accepted_spellings_and_rejects_everything_else() {
    // A single test (rather than two) so the shared probe var is mutated on one
    // thread — parallel tests writing the same var would race.
    for value in ["1", "true", "TRUE", "Yes", "on", "  true  "] {
        // SAFETY: PROBE is read only by this test, so mutating it is isolated.
        unsafe { std::env::set_var(PROBE, value) };
        assert!(truthy(PROBE), "`{value}` should be truthy");
    }
    for value in ["0", "false", "no", "off", "", "maybe", "2"] {
        // SAFETY: as above.
        unsafe { std::env::set_var(PROBE, value) };
        assert!(!truthy(PROBE), "`{value}` should not be truthy");
    }
    // SAFETY: as above.
    unsafe { std::env::remove_var(PROBE) };
    assert!(!truthy(PROBE), "an unset variable is not truthy");
}

/// The gg reference directory is *always* resolved to something, because the endpoint's
/// failure has to be "there is nothing in that directory" rather than "no directory was
/// configured" — the first names a fix, the second names a variable nobody sets in any
/// deployment shape but the image.
#[test]
fn the_gg_reference_directory_falls_back_to_the_checkout_when_unset() {
    let checkout = Path::new("/srv/test-cabinet/checkout");
    assert_eq!(
        gg_reference_dir(None, checkout),
        PathBuf::from("/srv/test-cabinet/checkout/target/gg-reference"),
        "an unset TCAB_GG_REFERENCE resolves under the checkout's target/"
    );
    assert_eq!(
        gg_reference_dir(Some("/opt/gg-reference".to_string()), checkout),
        PathBuf::from("/opt/gg-reference"),
        "an operator's directory — the backend image's — wins over the default"
    );
}

/// The artifact reclamation sweep is configured entirely from the environment, and
/// its two knobs are hours on the wire and [`Duration`]s in the struct. A
/// deployment that means "every six hours" and gets six seconds sweeps a tree the
/// moment its run finishes.
///
/// One test, because it resolves the whole configuration: nextest runs each test in
/// its own process, so the environment it sets is its own.
#[test]
fn the_artifact_sweep_timings_are_read_as_hours() {
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    // SAFETY: this process is this test's alone under nextest, the repo's runner.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::remove_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS");
        std::env::remove_var("TCAB_ARTIFACT_SWEEP_GRACE_HOURS");
    }
    let defaults = super::Config::from_env().unwrap();
    assert_eq!(
        defaults.artifact_sweep_interval,
        Duration::from_secs(super::DEFAULT_ARTIFACT_SWEEP_INTERVAL_HOURS * 3600)
    );
    assert_eq!(
        defaults.artifact_sweep_grace,
        Duration::from_secs(super::DEFAULT_ARTIFACT_SWEEP_GRACE_HOURS * 3600)
    );

    // SAFETY: as above.
    unsafe {
        std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS", "2");
        std::env::set_var("TCAB_ARTIFACT_SWEEP_GRACE_HOURS", "48");
    }
    let configured = super::Config::from_env().unwrap();
    assert_eq!(
        configured.artifact_sweep_interval,
        Duration::from_secs(2 * 3600)
    );
    assert_eq!(
        configured.artifact_sweep_grace,
        Duration::from_secs(48 * 3600)
    );

    // `0` is how an operator turns the sweep off, so it has to survive as a zero
    // duration rather than falling back to the default.
    // SAFETY: as above.
    unsafe { std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS", "0") };
    assert_eq!(
        super::Config::from_env().unwrap().artifact_sweep_interval,
        Duration::ZERO
    );
}

/// The three snapshot batching settings resolve into the publisher's timing: the
/// quiet window and the minimum interval are milliseconds on the wire, and the
/// threshold is a count.
///
/// One test, because it resolves the whole configuration: nextest runs each test in
/// its own process, so the environment it sets is its own.
#[test]
fn the_snapshot_batching_settings_resolve_into_the_publisher_timing() {
    use std::time::Duration;

    use crate::publisher::BatchTiming;

    let dir = tempfile::tempdir().unwrap();
    // SAFETY: this process is this test's alone under nextest, the repo's runner.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::remove_var("TCAB_SNAPSHOT_COALESCE_MS");
        std::env::remove_var("TCAB_SNAPSHOT_BATCH_SIZE");
        std::env::remove_var("TCAB_SNAPSHOT_MIN_INTERVAL_MS");
        std::env::remove_var("TCAB_SNAPSHOT_REFRESH_TIMEOUT_MS");
    }
    let defaults = super::Config::from_env().unwrap();
    assert_eq!(
        defaults.publisher_timing().batch,
        BatchTiming {
            threshold: 20,
            quiet_window: Duration::from_secs(2 * 60),
            min_interval: Duration::from_secs(10 * 60),
            refresh_timeout: Duration::from_secs(30 * 60),
        }
    );

    // SAFETY: as above.
    unsafe {
        std::env::set_var("TCAB_SNAPSHOT_COALESCE_MS", "5000");
        std::env::set_var("TCAB_SNAPSHOT_BATCH_SIZE", "50");
        // `0` is how an operator removes the hold, so it has to survive as a zero
        // duration rather than falling back to the default.
        std::env::set_var("TCAB_SNAPSHOT_MIN_INTERVAL_MS", "0");
        std::env::set_var("TCAB_SNAPSHOT_REFRESH_TIMEOUT_MS", "90000");
    }
    let configured = super::Config::from_env().unwrap();
    assert_eq!(
        configured.publisher_timing().batch,
        BatchTiming {
            threshold: 50,
            quiet_window: Duration::from_secs(5),
            min_interval: Duration::ZERO,
            refresh_timeout: Duration::from_secs(90),
        }
    );
}

/// The artifact capacity settings: megabytes and seconds on the wire, the shipped
/// defaults when unset, and a refusal to start on a value the backend cannot run
/// with.
///
/// One test, because it resolves the whole configuration: nextest runs each test in
/// its own process, so the environment it sets is its own.
#[test]
fn the_artifact_capacity_settings_resolve_and_are_validated() {
    use std::time::Duration;

    use super::ConfigError;
    use crate::capacity::{CapacitySettings, MIB};

    const NAMES: [&str; 4] = [
        "TCAB_ARTIFACT_FREE_WARN_MB",
        "TCAB_ARTIFACT_FREE_STOP_MB",
        "TCAB_ARTIFACT_FREE_RECOVER_MB",
        "TCAB_ARTIFACT_CAPACITY_POLL_SECONDS",
    ];
    let set = |values: [Option<&str>; 4]| {
        for (name, value) in NAMES.iter().zip(values) {
            // SAFETY: this process is this test's alone under nextest, the repo's
            // runner.
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    };
    let invalid = || match super::Config::from_env() {
        Err(ConfigError::Invalid { name, .. }) => name,
        other => panic!("expected an invalid setting, got {other:?}"),
    };

    let dir = tempfile::tempdir().unwrap();
    // SAFETY: as above.
    unsafe { std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path()) };

    // Unset: warn under 3 GiB, stop under 2 GiB.
    set([None; 4]);
    let defaults = super::Config::from_env().unwrap().artifact_capacity;
    assert_eq!(defaults, CapacitySettings::default());
    assert_eq!(defaults.warn_bytes, 3072 * MIB);
    assert_eq!(defaults.stop_bytes, 2048 * MIB);

    set([Some("8192"), Some("4096"), Some("0"), Some("5")]);
    assert_eq!(
        super::Config::from_env().unwrap().artifact_capacity,
        CapacitySettings {
            warn_bytes: 8192 * MIB,
            stop_bytes: 4096 * MIB,
            // `0` is how an operator removes the margin.
            recover_bytes: 0,
            poll_interval: Duration::from_secs(5),
        }
    );

    // Equal thresholds are allowed: the warning and the hold then coincide.
    set([Some("2048"), Some("2048"), None, None]);
    assert!(super::Config::from_env().is_ok());

    // A warn threshold under the stop threshold would warn only after the queue
    // had already stopped.
    set([Some("1024"), Some("2048"), None, None]);
    assert_eq!(invalid(), "TCAB_ARTIFACT_FREE_WARN_MB");
    // The same mistake made by raising only the stop threshold past the default
    // warn threshold.
    set([None, Some("4096"), None, None]);
    assert_eq!(invalid(), "TCAB_ARTIFACT_FREE_WARN_MB");

    // A value that is not a whole number is refused rather than defaulted.
    set([None, Some("2GiB"), None, None]);
    assert_eq!(invalid(), "TCAB_ARTIFACT_FREE_STOP_MB");

    // A zero poll interval would poll in a busy loop.
    set([None, None, None, Some("0")]);
    assert_eq!(invalid(), "TCAB_ARTIFACT_CAPACITY_POLL_SECONDS");
}
