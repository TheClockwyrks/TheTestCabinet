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

/// The reclamation sweep's timings. The interval is ten minutes unless a setting
/// says otherwise, the minutes setting decides when both are set, and the hours
/// setting that predates it still works on its own. A unit slip is not cosmetic
/// here: a deployment that means "every six hours" and gets six seconds sweeps a
/// tree the moment its run finishes.
///
/// One test, because it resolves the whole configuration: nextest runs each test in
/// its own process, so the environment it sets is its own.
#[test]
fn the_artifact_sweep_timings_are_read_in_their_units() {
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    // SAFETY: this process is this test's alone under nextest, the repo's runner.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::remove_var("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES");
        std::env::remove_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS");
        std::env::remove_var("TCAB_ARTIFACT_SWEEP_GRACE_HOURS");
    }
    let defaults = super::Config::from_env().unwrap();
    assert_eq!(
        defaults.artifact_sweep_interval,
        Duration::from_secs(10 * 60)
    );
    assert_eq!(
        defaults.artifact_sweep_grace,
        Duration::from_secs(super::DEFAULT_ARTIFACT_SWEEP_GRACE_HOURS * 3600)
    );

    // The hours setting alone is the interval a deployment that predates the
    // minutes setting asked for.
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

    // The minutes setting decides when both are set, in either direction.
    // SAFETY: as above.
    unsafe { std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES", "30") };
    assert_eq!(
        super::Config::from_env().unwrap().artifact_sweep_interval,
        Duration::from_secs(30 * 60)
    );
    // SAFETY: as above.
    unsafe {
        std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES", "0");
        std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS", "6");
    }
    assert_eq!(
        super::Config::from_env().unwrap().artifact_sweep_interval,
        Duration::ZERO
    );

    // A value that is not a whole number is refused by name, never read as the
    // default: the interval decides when trees are deleted.
    // SAFETY: as above.
    unsafe {
        std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES", "ten");
        std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS", "1");
    }
    let error = super::Config::from_env().unwrap_err().to_string();
    assert!(
        error.contains("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES"),
        "{error}"
    );
    // The hours setting is held to that while it decides the interval.
    // SAFETY: as above.
    unsafe {
        std::env::remove_var("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES");
        std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS", "1.5");
    }
    let error = super::Config::from_env().unwrap_err().to_string();
    assert!(
        error.contains("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS"),
        "{error}"
    );

    // With the minutes setting present the hours value is not used, so a value
    // there that a deployment has carried since before it was read strictly does
    // not stop the start.
    // SAFETY: as above.
    unsafe { std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES", "15") };
    assert_eq!(
        super::Config::from_env().unwrap().artifact_sweep_interval,
        Duration::from_secs(15 * 60)
    );

    // The grace window decides which run-less trees and folders are deleted, so
    // it is read as strictly: `0` is a zero window, which turns the orphan rule
    // off, and a value that is not whole hours stops the start.
    // SAFETY: as above.
    unsafe { std::env::set_var("TCAB_ARTIFACT_SWEEP_GRACE_HOURS", "0") };
    assert_eq!(
        super::Config::from_env().unwrap().artifact_sweep_grace,
        Duration::ZERO
    );
    for unreadable in ["1d", "24h", "-1", "0.5"] {
        // SAFETY: as above.
        unsafe { std::env::set_var("TCAB_ARTIFACT_SWEEP_GRACE_HOURS", unreadable) };
        let error = super::Config::from_env().unwrap_err().to_string();
        assert!(
            error.contains("TCAB_ARTIFACT_SWEEP_GRACE_HOURS"),
            "{unreadable}: {error}"
        );
    }
}

/// The retention settings: a failed run's tree for a day and a canceled run's for
/// an hour unless set, `0` for never, the published rule on unless turned off, and
/// a value that cannot be read refused instead of guessed at.
///
/// One test, because it resolves the whole configuration: nextest runs each test in
/// its own process, so the environment it sets is its own.
#[test]
fn the_artifact_retention_settings_resolve_into_the_policy() {
    use std::time::Duration;

    use crate::artifacts::RetentionPolicy;

    let dir = tempfile::tempdir().unwrap();
    // SAFETY: this process is this test's alone under nextest, the repo's runner.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::remove_var("TCAB_ARTIFACT_FAILED_RETENTION_HOURS");
        std::env::remove_var("TCAB_ARTIFACT_CANCELED_RETENTION_HOURS");
        std::env::remove_var("TCAB_ARTIFACT_RECLAIM_PUBLISHED");
        for name in R2_VARIABLES {
            std::env::remove_var(name);
        }
    }
    assert_eq!(
        super::Config::from_env().unwrap().artifact_retention,
        RetentionPolicy {
            failed: Duration::from_secs(24 * 3600),
            canceled: Duration::from_secs(3600),
            published: true,
            bucket: None,
        }
    );

    // The bucket a confirmation must name is the endpoint and the bucket name.
    // SAFETY: as above.
    unsafe { set_r2("https://acct.r2.example/", "gallery") };
    assert_eq!(
        super::Config::from_env().unwrap().artifact_retention.bucket,
        Some("https://acct.r2.example/gallery")
    );
    // SAFETY: as above.
    unsafe { set_r2("https://acct.r2.example", "staging-gallery") };
    assert_eq!(
        super::Config::from_env().unwrap().artifact_retention.bucket,
        Some("https://acct.r2.example/staging-gallery")
    );
    // SAFETY: as above.
    unsafe {
        for name in R2_VARIABLES {
            std::env::remove_var(name);
        }
    }

    // SAFETY: as above.
    unsafe {
        std::env::set_var("TCAB_ARTIFACT_FAILED_RETENTION_HOURS", "72");
        std::env::set_var("TCAB_ARTIFACT_CANCELED_RETENTION_HOURS", "0");
        std::env::set_var("TCAB_ARTIFACT_RECLAIM_PUBLISHED", "false");
    }
    assert_eq!(
        super::Config::from_env().unwrap().artifact_retention,
        RetentionPolicy {
            failed: Duration::from_secs(72 * 3600),
            canceled: Duration::ZERO,
            published: false,
            bucket: None,
        }
    );

    for (spelling, on) in [
        ("0", false),
        ("no", false),
        ("OFF", false),
        ("1", true),
        ("yes", true),
        ("On", true),
        ("", true),
    ] {
        // SAFETY: as above.
        unsafe { std::env::set_var("TCAB_ARTIFACT_RECLAIM_PUBLISHED", spelling) };
        assert_eq!(
            super::Config::from_env()
                .unwrap()
                .artifact_retention
                .published,
            on,
            "{spelling:?}"
        );
    }

    // A misspelled "off" must not leave the deletion on, and a retention that is
    // not a number must not become the default.
    for (name, value) in [
        ("TCAB_ARTIFACT_RECLAIM_PUBLISHED", "disabled"),
        ("TCAB_ARTIFACT_FAILED_RETENTION_HOURS", "a day"),
        ("TCAB_ARTIFACT_CANCELED_RETENTION_HOURS", "-1"),
    ] {
        // SAFETY: as above.
        unsafe {
            std::env::set_var("TCAB_ARTIFACT_RECLAIM_PUBLISHED", "true");
            std::env::set_var("TCAB_ARTIFACT_FAILED_RETENTION_HOURS", "24");
            std::env::set_var("TCAB_ARTIFACT_CANCELED_RETENTION_HOURS", "1");
            std::env::set_var(name, value);
        }
        let error = super::Config::from_env().unwrap_err().to_string();
        assert!(error.contains(name), "{error}");
    }
}

/// The variables an R2 configuration is read from.
const R2_VARIABLES: [&str; 5] = [
    "TCAB_R2_ACCOUNT_ID",
    "TCAB_R2_BUCKET",
    "TCAB_R2_ACCESS_KEY_ID",
    "TCAB_R2_SECRET_ACCESS_KEY",
    "TCAB_R2_ENDPOINT",
];

/// Configure R2 with `endpoint` and `bucket`.
///
/// # Safety
///
/// Writes the process environment: only for a test that owns its process.
unsafe fn set_r2(endpoint: &str, bucket: &str) {
    // SAFETY: the caller's.
    unsafe {
        std::env::set_var("TCAB_R2_ACCOUNT_ID", "acct");
        std::env::set_var("TCAB_R2_BUCKET", bucket);
        std::env::set_var("TCAB_R2_ACCESS_KEY_ID", "key");
        std::env::set_var("TCAB_R2_SECRET_ACCESS_KEY", "secret");
        std::env::set_var("TCAB_R2_ENDPOINT", endpoint);
    }
}

/// Media confirmations are recorded only where one can lead to a deletion: the
/// published rule on, the sweep on, an artifact service to sweep and a bucket to
/// confirm against.
///
/// One test, because it resolves the whole configuration: nextest runs each test in
/// its own process, so the environment it sets is its own.
#[test]
fn media_is_confirmed_only_where_published_trees_are_reclaimed() {
    let dir = tempfile::tempdir().unwrap();
    // SAFETY: this process is this test's alone under nextest, the repo's runner.
    unsafe { set_r2("https://acct.r2.example", "gallery") };
    let set = |published: &str, minutes: &str, service: bool| {
        // SAFETY: this process is this test's alone under nextest, the repo's runner.
        unsafe {
            std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
            std::env::remove_var("TCAB_ARTIFACT_SWEEP_INTERVAL_HOURS");
            std::env::set_var("TCAB_ARTIFACT_RECLAIM_PUBLISHED", published);
            std::env::set_var("TCAB_ARTIFACT_SWEEP_INTERVAL_MINUTES", minutes);
            if service {
                std::env::set_var("TCAB_ARTIFACTS_URL", "http://artifacts:8080");
                std::env::set_var("TCAB_BACKEND_SERVICE_TOKEN", "secret");
            } else {
                std::env::remove_var("TCAB_ARTIFACTS_URL");
            }
        }
        super::Config::from_env()
            .unwrap()
            .publisher_timing()
            .confirm_media
    };
    assert_eq!(
        set("true", "10", true),
        Some("https://acct.r2.example/gallery")
    );
    assert_eq!(set("false", "10", true), None, "the published rule is off");
    assert_eq!(set("true", "0", true), None, "the sweep is off");
    assert_eq!(
        set("true", "10", false),
        None,
        "there is no artifact service"
    );
    // SAFETY: as above.
    unsafe { std::env::remove_var("TCAB_R2_BUCKET") };
    assert_eq!(set("true", "10", true), None, "there is no bucket");
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
            ..CapacitySettings::default()
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

/// The publish-failure hold's threshold: five runs when unset, the value given
/// otherwise, `0` for no hold, and a refusal to start on anything else.
#[test]
fn the_publish_failure_hold_threshold_resolves_and_is_validated() {
    use super::ConfigError;

    const NAME: &str = "TCAB_PUBLISH_FAILURE_HOLD_RUNS";
    let set = |value: Option<&str>| {
        // SAFETY: this process is this test's alone under nextest, the repo's
        // runner.
        unsafe {
            match value {
                Some(value) => std::env::set_var(NAME, value),
                None => std::env::remove_var(NAME),
            }
        }
    };
    let resolved = || super::Config::from_env().unwrap().publish_failure_hold_runs;
    let dir = tempfile::tempdir().unwrap();
    // SAFETY: as above.
    unsafe { std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path()) };

    set(None);
    assert_eq!(resolved(), 5);
    set(Some(""));
    assert_eq!(resolved(), 5, "empty is unset");
    set(Some("3"));
    assert_eq!(resolved(), 3);
    set(Some("0"));
    assert_eq!(resolved(), 0, "zero turns the hold off");

    for unreadable in ["five", "-1", "2.5", "99999999999"] {
        set(Some(unreadable));
        match super::Config::from_env() {
            Err(ConfigError::Invalid { name, .. }) => assert_eq!(name, NAME),
            other => panic!("`{unreadable}` should be refused, got {other:?}"),
        }
    }
}

/// The state volume's settings: the reclaim switch, on unless turned off and
/// refused when misspelled, and the two free-space thresholds, each read strictly
/// with `0` turning it off.
#[test]
fn the_state_volume_settings_resolve_and_are_validated() {
    use super::ConfigError;
    use crate::capacity::MIB;

    const NAMES: [&str; 3] = [
        "TCAB_STATE_RECLAIM",
        "TCAB_STATE_FREE_WARN_MB",
        "TCAB_STATE_FREE_STOP_MB",
    ];
    let set = |values: [Option<&str>; 3]| {
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

    // Unset: the sweep is on, warn under 3 GiB, stop under 1.5 GiB.
    set([None; 3]);
    let config = super::Config::from_env().unwrap();
    assert!(config.state_reclaim);
    assert_eq!(config.artifact_capacity.state_warn_bytes, 3072 * MIB);
    assert_eq!(config.artifact_capacity.state_stop_bytes, 1536 * MIB);
    assert!(config.artifact_capacity.watches_state_volume());

    for (spelling, on) in [
        ("0", false),
        ("false", false),
        ("OFF", false),
        ("no", false),
        ("1", true),
        ("true", true),
        ("", true),
    ] {
        set([Some(spelling), None, None]);
        let config = super::Config::from_env().unwrap();
        assert_eq!(config.state_reclaim, on, "{spelling:?}");
        // Off, the sweep has no timing and is never spawned.
        assert_eq!(config.state_sweep_timing().is_some(), on, "{spelling:?}");
    }
    // A misspelled "off" must not leave the deletion on.
    set([Some("disabled"), None, None]);
    assert_eq!(invalid(), "TCAB_STATE_RECLAIM");

    set([None, Some("4096"), Some("1024")]);
    let capacity = super::Config::from_env().unwrap().artifact_capacity;
    assert_eq!(capacity.state_warn_bytes, 4096 * MIB);
    assert_eq!(capacity.state_stop_bytes, 1024 * MIB);

    // `0` turns each off, and both off leaves the volume unread.
    set([None, Some("0"), None]);
    let capacity = super::Config::from_env().unwrap().artifact_capacity;
    assert_eq!(capacity.state_warn_bytes, 0);
    assert_eq!(capacity.state_stop_bytes, 1536 * MIB);
    set([None, None, Some("0")]);
    let capacity = super::Config::from_env().unwrap().artifact_capacity;
    assert_eq!(capacity.state_stop_bytes, 0);
    assert!(capacity.watches_state_volume());
    set([None, Some("0"), Some("0")]);
    let capacity = super::Config::from_env().unwrap().artifact_capacity;
    assert!(!capacity.watches_state_volume());

    // Equal thresholds are allowed, and a warning under the hold is not.
    set([None, Some("2048"), Some("2048")]);
    assert!(super::Config::from_env().is_ok());
    set([None, Some("1024"), Some("2048")]);
    assert_eq!(invalid(), "TCAB_STATE_FREE_WARN_MB");
    set([None, None, Some("4096")]);
    assert_eq!(invalid(), "TCAB_STATE_FREE_WARN_MB");

    // A value that is not a whole number is refused rather than defaulted.
    set([None, None, Some("1.5GiB")]);
    assert_eq!(invalid(), "TCAB_STATE_FREE_STOP_MB");
    set([None, Some("-1"), None]);
    assert_eq!(invalid(), "TCAB_STATE_FREE_WARN_MB");
}

/// The state sweep runs by the artifact sweep's clocks, and removes a published
/// run's files only on a backend that records media confirmations.
#[test]
fn the_state_sweep_takes_the_artifact_sweep_s_timing() {
    let dir = tempfile::tempdir().unwrap();
    // SAFETY: this process is this test's alone under nextest, the repo's runner.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::remove_var("TCAB_STATE_RECLAIM");
        std::env::remove_var("TCAB_ARTIFACT_RECLAIM_PUBLISHED");
        for name in R2_VARIABLES {
            std::env::remove_var(name);
        }
    }
    let config = super::Config::from_env().unwrap();
    let timing = config.state_sweep_timing().expect("on unless turned off");
    assert_eq!(timing.interval, config.artifact_sweep_interval);
    assert_eq!(timing.rules.grace, config.artifact_sweep_grace);
    assert_eq!(
        timing.rules.retention.failed,
        config.artifact_retention.failed
    );
    assert_eq!(
        timing.rules.retention.canceled,
        config.artifact_retention.canceled
    );
    // No bucket: nothing confirms a published run's files, so none is removed.
    assert_eq!(timing.rules.retention.bucket, None);
    assert!(!timing.rules.retention.published);
    assert_eq!(
        timing.rules.retention.published,
        config.publisher_timing().confirm_media.is_some()
    );
}
