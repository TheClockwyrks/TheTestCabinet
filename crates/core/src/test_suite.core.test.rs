//! The suite catalog against core's authored catalog.
//!
//! The suite runtime is `test_cabinet_suites::test_suite`, and its tests are there.
//! The authored catalog a definition's identity collides with is core's
//! [`TestCaseCatalog`], which answers the suite catalog through
//! [`AuthoredLookup`](super::AuthoredLookup), so the check that needs both is here.

use std::path::PathBuf;

use super::TestSuiteCatalog;
use crate::test_case::TestCaseCatalog;

/// The committed fixture checkout — the directory holding the `carom/` suite.
fn checkout() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

#[test]
fn an_identity_an_authored_case_already_claims_is_refused() {
    let dir = tempfile::tempdir().expect("a scratch tree");
    // An authored catalog whose one case claims `carom-end-to-end`.
    let authored = dir
        .path()
        .join("test-cases/end-to-end/easy/carom-end-to-end/v1.0.0");
    std::fs::create_dir_all(&authored).expect("the authored folder");
    std::fs::write(
        authored.join("test-case.toml"),
        "slug = \"carom-end-to-end\"\n",
    )
    .expect("the authored manifest");
    let authored = TestCaseCatalog::new(dir.path().join("test-cases"));

    let materials = dir.path().join("materials");
    let suites = TestSuiteCatalog::with_materials(checkout(), &materials);
    assert!(TestSuiteCatalog::collides_with_authored(
        "carom-end-to-end",
        &authored
    ));
    let err = suites
        .resolve_beside("carom", "v1.0.0", "end-to-end", &authored)
        .expect_err("a colliding identity is refused");
    assert!(err.to_string().contains("already claimed"), "{err}");

    // A definition whose identity nothing claims still resolves.
    assert!(
        suites
            .resolve_beside("carom", "v1.0.0", "ball", &authored)
            .is_ok()
    );
}
