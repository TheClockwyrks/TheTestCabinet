use super::*;

use crate::suite_store::reference_builds::tests::gzipped_tar;
use crate::suite_store::tests::sample_suite;

/// A store holding the sample `carom@v1.0.0` record.
fn store_with_carom() -> (tempfile::TempDir, DefinitionStore) {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = DefinitionStore::open(dir.path()).expect("the store opens");
    let record = sample_suite("carom", "v1.0.0");
    store
        .write_suite_in(&store.suite_version_dir("carom", "v1.0.0"), &record)
        .expect("the record writes");
    (dir, store)
}

fn upload(store: &DefinitionStore, engine: &str, entries: &[(&str, &[u8])]) {
    store
        .store_suite_reference_build("carom", "v1.0.0", engine, gzipped_tar(entries).as_slice())
        .expect("the build stores");
}

fn content_type(response: &Response) -> &str {
    response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}

#[test]
fn the_play_url_is_the_builds_base() {
    assert_eq!(
        reference_build_url("carom", "v0.0.0-preview.main", "simple-2d"),
        "/suites/carom/versions/v0.0.0-preview.main/reference-builds/simple-2d/"
    );
}

#[test]
fn only_the_builds_among_the_given_engines_are_listed() {
    let (_dir, store) = store_with_carom();
    upload(&store, "none", &[("index.html", b"x")]);
    upload(&store, "simple-2d", &[("index.html", b"x")]);

    let builds = reference_builds_among(&store, "carom", "v1.0.0", ["none", "simple-3d"])
        .expect("the builds list");
    assert_eq!(
        builds,
        BTreeMap::from([(
            "none".to_string(),
            "/suites/carom/versions/v1.0.0/reference-builds/none/".to_string()
        )])
    );
}

#[test]
fn a_build_is_served_with_its_content_types_and_index_fallback() {
    let (_dir, store) = store_with_carom();
    upload(
        &store,
        "none",
        &[
            (
                "index.html",
                b"<html><head></head><script src=\"/assets/app.js\"></script></html>",
            ),
            ("assets/app.js", b"console.log(1)"),
            ("assets/style.css", b"body{}"),
            ("assets/sprite.png", b"\x89PNG"),
            ("levels/index.html", b"<html><head></head>levels</html>"),
        ],
    );

    let root = serve(&store, "carom", "v1.0.0", "none", "").expect("the root serves");
    assert_eq!(content_type(&root), "text/html; charset=utf-8");
    for (path, expected) in [
        ("assets/app.js", "text/javascript; charset=utf-8"),
        ("assets/style.css", "text/css; charset=utf-8"),
        ("assets/sprite.png", "image/png"),
        ("levels/", "text/html; charset=utf-8"),
    ] {
        let response = serve(&store, "carom", "v1.0.0", "none", path).expect("the file serves");
        assert_eq!(content_type(&response), expected, "{path}");
    }
}

#[test]
fn a_missing_build_version_or_file_is_not_found_by_name() {
    let (_dir, store) = store_with_carom();
    upload(&store, "none", &[("index.html", b"x")]);

    let no_version = serve(&store, "carom", "v9.9.9", "none", "").expect_err("absent");
    assert_eq!(no_version.status, StatusCode::NOT_FOUND);
    assert!(no_version.message.contains("is not ingested"));

    let no_build = serve(&store, "carom", "v1.0.0", "simple-2d", "").expect_err("absent");
    assert_eq!(no_build.status, StatusCode::NOT_FOUND);
    assert!(no_build.message.contains("no reference build is uploaded"));

    let no_file = serve(&store, "carom", "v1.0.0", "none", "missing.js").expect_err("absent");
    assert_eq!(no_file.status, StatusCode::NOT_FOUND);

    let escape = serve(
        &store,
        "carom",
        "v1.0.0",
        "none",
        "../../../.tcab/suite.json",
    )
    .expect_err("a path leaving the build is refused");
    assert_eq!(escape.status, StatusCode::NOT_FOUND);
}
