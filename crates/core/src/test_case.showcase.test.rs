//! Tests for the **variant showcase**: the optional `showcase` key a variant
//! declares, naming a directory of authored presentation media (a description
//! plus a small carousel captured from the reference implementation).
//!
//! Split out of `test_case.test.rs` because these drive a distinct axis — the
//! case-side showcase contract and its hard-fail validation — and that file is
//! already long.

use std::fs;

use super::tests::{catalog_with_files, manifest_with};
use super::*;

/// A `variants/base.toml` declaring a showcase at `showcase/base`.
const BASE_VARIANT_WITH_SHOWCASE: &str = "slug = \"base\"\nshowcase = \"showcase/base\"\n";

/// A well-formed description.
const SHOWCASE_MD: &str = "A demo game. Media captured from the reference implementation.\n";

/// A well-formed two-entry carousel: a still and a replay recording.
const SHOWCASE_TOML: &str = "[[media]]\nfile = \"title.png\"\nname = \"The title screen\"\n\n\
     [[media]]\nfile = \"rally.json.gz\"\nname = \"A rally through the obstacles\"\n";

/// Build a catalog whose single `base` variant declares a showcase assembled from
/// the given `showcase.md` text, `showcase.toml` text, and media files (paths
/// relative to the showcase directory).
fn showcase_catalog(
    md: &str,
    manifest: &str,
    media: &[(&str, &str)],
) -> (tempfile::TempDir, TestCaseCatalog) {
    let mut files: Vec<(String, &str)> = vec![
        ("variants/base.toml".to_string(), BASE_VARIANT_WITH_SHOWCASE),
        ("showcase/base/showcase.md".to_string(), md),
        ("showcase/base/showcase.toml".to_string(), manifest),
    ];
    for (path, contents) in media {
        files.push((format!("showcase/base/{path}"), contents));
    }
    let files: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, contents)| (path.as_str(), *contents))
        .collect();
    catalog_with_files(&manifest_with("", ""), &files)
}

/// Resolve the showcase catalog, expecting it to be refused, and return the
/// rendered failure.
fn reject(md: &str, manifest: &str, media: &[(&str, &str)]) -> String {
    let (_dir, catalog) = showcase_catalog(md, manifest, media);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("the showcase should be refused");
    format!("{err}")
}

#[test]
fn a_showcase_resolves_with_description_media_kinds_and_source_paths() {
    let (dir, catalog) = showcase_catalog(
        SHOWCASE_MD,
        SHOWCASE_TOML,
        &[("title.png", "png"), ("rally.json.gz", "gz")],
    );
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let showcase = version
        .variant("base")
        .expect("base")
        .showcase
        .as_ref()
        .expect("the declared showcase resolves");

    assert_eq!(showcase.description, SHOWCASE_MD);
    // The carousel keeps its declared order, each entry with its inferred kind
    // and its absolute source path inside the version folder.
    assert_eq!(showcase.media.len(), 2);
    assert_eq!(showcase.media[0].file, "title.png");
    assert_eq!(showcase.media[0].name, "The title screen");
    assert_eq!(showcase.media[0].kind, MediaKind::Image);
    assert_eq!(showcase.media[1].file, "rally.json.gz");
    assert_eq!(showcase.media[1].kind, MediaKind::Replay);
    let expected = dir
        .path()
        .join("end-to-end/easy/demo/v1.0.0/showcase/base/title.png");
    assert_eq!(showcase.media[0].source_path, expected);
}

#[test]
fn a_video_entry_resolves_as_video() {
    let manifest = "[[media]]\nfile = \"play.webm\"\nname = \"A round of play\"\n";
    let (_dir, catalog) = showcase_catalog(SHOWCASE_MD, manifest, &[("play.webm", "webm")]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    let showcase = version.variant("base").unwrap().showcase.clone().unwrap();
    assert_eq!(showcase.media[0].kind, MediaKind::Video);
}

#[test]
fn a_variant_without_a_showcase_resolves_none() {
    // The default `base` variant declares no `showcase`, so the resolved variant
    // carries none.
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), &[]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert_eq!(version.variant("base").unwrap().showcase, None);
}

#[test]
fn unknown_keys_in_showcase_toml_are_tolerated() {
    // The shared showcase manifest parser is deliberately lenient about unknown
    // keys (the run-side manifest is model-written); the case side inherits that.
    let manifest = "note = \"extra\"\n\n[[media]]\nfile = \"title.png\"\nname = \"Title\"\n\
         caption_style = \"bold\"\n";
    let (_dir, catalog) = showcase_catalog(SHOWCASE_MD, manifest, &[("title.png", "png")]);
    let version = catalog.resolve("demo", "v1.0.0").expect("resolve");
    assert!(version.variant("base").unwrap().showcase.is_some());
}

#[test]
fn a_missing_showcase_directory_is_rejected() {
    // The variant names a showcase directory that does not exist.
    let variant = "slug = \"base\"\nshowcase = \"showcase/missing\"\n";
    let (_dir, catalog) =
        catalog_with_files(&manifest_with("", ""), &[("variants/base.toml", variant)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a missing showcase directory is rejected");
    assert!(
        format!("{err}").contains("the directory does not exist"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_showcase_directory_escaping_the_version_folder_is_rejected() {
    let variant = "slug = \"base\"\nshowcase = \"../showcase\"\n";
    let (_dir, catalog) =
        catalog_with_files(&manifest_with("", ""), &[("variants/base.toml", variant)]);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an escaping showcase directory is rejected");
    assert!(
        format!("{err}").contains("escapes the version folder"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_missing_showcase_md_is_rejected() {
    // The directory exists (the manifest and media are there) but has no
    // showcase.md. `showcase_catalog` always writes one, so assemble by hand.
    let files = &[
        ("variants/base.toml", BASE_VARIANT_WITH_SHOWCASE),
        ("showcase/base/showcase.toml", SHOWCASE_TOML),
        ("showcase/base/title.png", "png"),
        ("showcase/base/rally.json.gz", "gz"),
    ];
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), files);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a showcase without a showcase.md is rejected");
    assert!(
        format!("{err}").contains("showcase.md could not be read"),
        "unexpected error: {err}"
    );
}

#[test]
fn a_blank_showcase_md_is_rejected() {
    let err = reject(
        "  \n\t\n",
        SHOWCASE_TOML,
        &[("title.png", "png"), ("rally.json.gz", "gz")],
    );
    assert!(err.contains("showcase.md is empty"), "unexpected: {err}");
}

#[test]
fn an_oversized_description_is_rejected() {
    // One byte over the cap hard-fails — the case-side showcase is authored, so
    // nothing is truncated.
    let oversized = "a".repeat(crate::MAX_SHOWCASE_DESCRIPTION_BYTES + 1);
    let err = reject(
        &oversized,
        SHOWCASE_TOML,
        &[("title.png", "png"), ("rally.json.gz", "gz")],
    );
    assert!(err.contains("over the"), "unexpected: {err}");
    assert!(err.contains("byte cap"), "unexpected: {err}");
}

#[test]
fn a_missing_showcase_toml_is_rejected() {
    let files = &[
        ("variants/base.toml", BASE_VARIANT_WITH_SHOWCASE),
        ("showcase/base/showcase.md", SHOWCASE_MD),
        ("showcase/base/title.png", "png"),
    ];
    let (_dir, catalog) = catalog_with_files(&manifest_with("", ""), files);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("a showcase without a showcase.toml is rejected");
    assert!(
        format!("{err}").contains("showcase.toml could not be read"),
        "unexpected error: {err}"
    );
}

#[test]
fn an_unparsable_showcase_toml_is_rejected() {
    let err = reject(SHOWCASE_MD, "[[media]\nnot toml", &[("title.png", "png")]);
    assert!(
        err.contains("showcase.toml could not be parsed"),
        "unexpected: {err}"
    );
}

#[test]
fn an_empty_carousel_is_rejected() {
    let err = reject(SHOWCASE_MD, "", &[]);
    assert!(
        err.contains("declares no [[media]] entries"),
        "unexpected: {err}"
    );
}

#[test]
fn more_media_entries_than_the_cap_are_rejected() {
    let mut manifest = String::new();
    let mut media: Vec<(String, &str)> = Vec::new();
    for index in 0..=crate::MAX_SHOWCASE_MEDIA_ENTRIES {
        manifest.push_str(&format!(
            "[[media]]\nfile = \"shot-{index}.png\"\nname = \"Shot {index}\"\n\n"
        ));
        media.push((format!("shot-{index}.png"), "png"));
    }
    let media: Vec<(&str, &str)> = media
        .iter()
        .map(|(path, contents)| (path.as_str(), *contents))
        .collect();
    let err = reject(SHOWCASE_MD, &manifest, &media);
    assert!(err.contains("over the cap of"), "unexpected: {err}");
}

#[test]
fn a_media_name_that_is_not_a_plain_file_name_is_rejected() {
    // A subdirectory (either separator) or any name containing `..` is refused:
    // the carousel is a flat namespace, matching the run showcase's rule.
    for file in ["clips/shot.png", "clips\\shot.png", "shot..png", ""] {
        let manifest = format!(
            "[[media]]\nfile = \"{}\"\nname = \"Shot\"\n",
            file.escape_default()
        );
        let err = reject(SHOWCASE_MD, &manifest, &[]);
        assert!(
            err.contains("does not name a plain file"),
            "`{file}` should be refused as not a plain file name: {err}"
        );
    }
}

#[test]
fn a_duplicate_media_file_is_rejected() {
    // Two [[media]] entries naming the same file are refused: the carousel is
    // addressed by file name everywhere downstream, so a duplicate could only
    // shadow or double an entry.
    let manifest = "[[media]]\nfile = \"title.png\"\nname = \"The title screen\"\n\n\
         [[media]]\nfile = \"title.png\"\nname = \"The title screen, again\"\n";
    let err = reject(SHOWCASE_MD, manifest, &[("title.png", "png")]);
    assert!(
        err.contains("declares media file `title.png` more than once"),
        "unexpected: {err}"
    );
}

#[test]
fn a_media_entry_naming_a_missing_file_is_rejected() {
    let manifest = "[[media]]\nfile = \"missing.png\"\nname = \"Missing\"\n";
    let err = reject(SHOWCASE_MD, manifest, &[]);
    assert!(
        err.contains("media file `missing.png` does not exist"),
        "unexpected: {err}"
    );
}

#[test]
fn a_media_file_of_no_known_kind_is_rejected() {
    let manifest = "[[media]]\nfile = \"notes.txt\"\nname = \"Notes\"\n";
    let err = reject(SHOWCASE_MD, manifest, &[("notes.txt", "text")]);
    assert!(err.contains("no known media kind"), "unexpected: {err}");
}

#[test]
fn an_oversized_media_file_is_rejected() {
    let (dir, catalog) = showcase_catalog(
        SHOWCASE_MD,
        "[[media]]\nfile = \"title.png\"\nname = \"Title\"\n",
        &[("title.png", "png")],
    );
    // Grow the file one byte past the cap. `set_len` produces a sparse file on
    // every platform the suite runs on, so no 25 MiB is actually written.
    let media = dir
        .path()
        .join("end-to-end/easy/demo/v1.0.0/showcase/base/title.png");
    let file = fs::OpenOptions::new()
        .write(true)
        .open(media)
        .expect("open media file");
    file.set_len(crate::MAX_SHOWCASE_MEDIA_FILE_BYTES + 1)
        .expect("grow media file");
    drop(file);
    let err = catalog
        .resolve("demo", "v1.0.0")
        .expect_err("an oversized media file is rejected");
    assert!(
        format!("{err}").contains("over the") && format!("{err}").contains("byte cap"),
        "unexpected error: {err}"
    );
}
