use std::path::{Path, PathBuf};

use super::{gg_reference_dir, truthy};

/// A throwaway env var read by no other code, so setting it here cannot race with
/// another test's configuration read.
const PROBE: &str = "TCAB_TEST_TRUTHY_PROBE";

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
