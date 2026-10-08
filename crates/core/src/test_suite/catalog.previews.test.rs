//! Tests for the catalog's previews: the trees The Spec Cabinet writes to
//! `.previews/<slug>/v0.0.0-preview.<draft>/` beside a copy of the suite manifest.
//!
//! Each test builds a checkout from the committed fixture suite and turns its
//! exported `v1.0.0` into a preview of the draft `main`, so a preview is exactly an
//! exported tree carrying the preview version and `experimental = true`.

use super::*;

/// The version a preview of the draft `main` carries.
const PREVIEW: &str = "v0.0.0-preview.main";

/// The committed fixture checkout — the directory holding the `carom/` suite.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/testdata/test-suite")
}

/// Copy a directory tree, so a test never writes into the committed fixture.
fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("the destination is created");
    for entry in std::fs::read_dir(from).expect("the source is readable") {
        let entry = entry.expect("the entry is readable");
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("the file is copied");
        }
    }
}

/// Write `.previews/carom/` into `suites` from the fixture's exported version: the
/// suite manifest copy, and the tree with its `version.toml` declaring the preview.
fn write_preview(suites: &Path, experimental: bool) {
    let dir = suites.join(PREVIEWS_DIR).join("carom");
    copy_tree(&fixture().join("carom/versions/v1.0.0"), &dir.join(PREVIEW));
    std::fs::copy(fixture().join("carom/suite.toml"), dir.join("suite.toml"))
        .expect("the suite manifest copies");
    let manifest = dir.join(PREVIEW).join("version.toml");
    let text = std::fs::read_to_string(&manifest).expect("the version manifest reads");
    let mut text = text.replace("version = \"1.0.0\"", "version = \"0.0.0-preview.main\"");
    if experimental {
        text.push_str("experimental = true\n");
    }
    std::fs::write(&manifest, text).expect("the version manifest writes");
}

/// A suites checkout holding the fixture suite and a preview of it.
fn checkout() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temporary directory");
    copy_tree(&fixture(), dir.path());
    write_preview(dir.path(), true);
    dir
}

/// A catalog over `suites` reading its previews.
fn previewing(suites: &Path, materials: &Path) -> TestSuiteCatalog {
    TestSuiteCatalog::with_materials(suites, materials).with_previews(suites.join(PREVIEWS_DIR))
}

#[test]
fn a_preview_version_is_named_by_the_preview_prerelease() {
    assert!(is_preview_version("v0.0.0-preview.main"));
    assert!(!is_preview_version("v0.0.0-preview."));
    assert!(!is_preview_version("v1.0.0"));
    assert!(!is_preview_version("v0.0.0"));
}

#[test]
fn a_catalog_without_a_previews_root_lists_and_holds_no_preview() {
    let dir = checkout();
    let catalog = TestSuiteCatalog::new(dir.path());

    assert_eq!(catalog.previews_root(), None);
    assert_eq!(
        catalog.list().expect("the checkout lists"),
        vec![TestSuite {
            slug: "carom".to_string(),
            versions: vec!["v1.0.0".to_string()],
        }]
    );
    assert!(!catalog.has_version("carom", PREVIEW));
    assert_eq!(
        catalog.version_tree("carom", PREVIEW),
        dir.path().join("carom/versions").join(PREVIEW),
        "a catalog reading no previews never composes a path into `.previews/`"
    );
}

#[test]
fn a_catalog_reading_previews_lists_each_after_its_suites_exported_versions() {
    let dir = checkout();
    let materials = tempfile::tempdir().expect("a temporary directory");
    let catalog = previewing(dir.path(), materials.path());

    assert_eq!(
        catalog.list().expect("the checkout lists"),
        vec![TestSuite {
            slug: "carom".to_string(),
            versions: vec!["v1.0.0".to_string(), PREVIEW.to_string()],
        }]
    );
    assert!(catalog.has_version("carom", PREVIEW));
    assert_eq!(
        catalog.version_tree("carom", PREVIEW),
        dir.path().join(".previews/carom").join(PREVIEW)
    );
    assert_eq!(
        catalog.suite_manifest_path("carom", PREVIEW),
        dir.path().join(".previews/carom/suite.toml")
    );
    assert_eq!(
        catalog.suite_manifest_path("carom", "v1.0.0"),
        dir.path().join("carom/suite.toml")
    );
}

#[test]
fn a_suite_only_a_preview_holds_is_listed_with_that_preview() {
    let dir = checkout();
    std::fs::remove_dir_all(dir.path().join("carom")).expect("the suite folder is removed");
    let materials = tempfile::tempdir().expect("a temporary directory");
    let catalog = previewing(dir.path(), materials.path());

    assert_eq!(
        catalog.list().expect("the checkout lists"),
        vec![TestSuite {
            slug: "carom".to_string(),
            versions: vec![PREVIEW.to_string()],
        }]
    );
    assert_eq!(
        catalog.versions("carom").expect("the suite is known"),
        vec![PREVIEW.to_string()]
    );
    catalog
        .identity("carom", PREVIEW)
        .expect("the identity reads against the suite manifest copy");
}

#[test]
fn a_preview_resolves_under_the_suite_slug_at_its_prerelease_version() {
    let dir = checkout();
    let materials = tempfile::tempdir().expect("a temporary directory");
    let catalog = previewing(dir.path(), materials.path());

    let identity = catalog
        .identity("carom", PREVIEW)
        .expect("the identity reads");
    assert_eq!(
        identity.manifest.version.as_deref(),
        Some("0.0.0-preview.main")
    );
    assert!(identity.manifest.experimental);

    let resolved = catalog
        .resolve("carom", PREVIEW, "end-to-end")
        .expect("the preview's definition resolves");
    assert_eq!(resolved.slug, "carom-end-to-end");
    assert_eq!(resolved.version, PREVIEW);
    assert!(
        resolved.experimental,
        "a preview definition is experimental"
    );
    assert!(resolved.root.starts_with(dir.path().join(PREVIEWS_DIR)));
}

#[test]
fn a_preview_that_does_not_declare_itself_experimental_is_refused() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    copy_tree(&fixture(), dir.path());
    write_preview(dir.path(), false);
    let materials = tempfile::tempdir().expect("a temporary directory");

    let error = previewing(dir.path(), materials.path())
        .identity("carom", PREVIEW)
        .expect_err("a preview must be experimental");
    assert!(error.to_string().contains("experimental"), "{error}");
}

#[test]
fn a_preview_named_folder_under_versions_is_not_an_exported_version() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    copy_tree(&fixture(), dir.path());
    copy_tree(
        &dir.path().join("carom/versions/v1.0.0"),
        &dir.path().join("carom/versions").join(PREVIEW),
    );

    let catalog = TestSuiteCatalog::new(dir.path());
    assert_eq!(
        catalog.versions("carom").expect("the suite is known"),
        vec!["v1.0.0".to_string()]
    );
    assert!(!catalog.has_version("carom", PREVIEW));
}
