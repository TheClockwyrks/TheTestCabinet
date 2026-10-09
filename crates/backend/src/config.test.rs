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
