use super::*;

use tempfile::TempDir;

use crate::suite_store::tests::sample_suite;

/// A store in its own temporary directory.
fn temp_store() -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().expect("a temporary directory");
    let store = DefinitionStore::open(dir.path()).expect("the store opens");
    (dir, store)
}

/// A gzipped tar holding `entries` as regular files, the shape a build upload
/// takes.
pub(crate) fn gzipped_tar(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    for (path, bytes) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        builder
            .append_data(&mut header, path, *bytes)
            .expect("the entry appends");
    }
    builder
        .into_inner()
        .expect("the tar finishes")
        .finish()
        .expect("the gzip finishes")
}

/// Gzip a raw tar the builder above would refuse to write.
fn gzip(tar_bytes: Vec<u8>) -> Vec<u8> {
    use std::io::Write;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(&tar_bytes).expect("the tar gzips");
    encoder.finish().expect("the gzip finishes")
}

fn read(store: &DefinitionStore, engine: &str, file: &str) -> Option<String> {
    std::fs::read_to_string(
        store
            .suite_reference_build_dir("carom", "v1.0.0", engine)
            .join(file),
    )
    .ok()
}

#[test]
fn a_build_is_stored_and_listed_and_a_second_upload_replaces_it() {
    let (_dir, store) = temp_store();
    let first = gzipped_tar(&[
        ("index.html", b"<html><head></head>first</html>"),
        ("assets/app.js", b"console.log(1)"),
    ]);
    store
        .store_suite_reference_build("carom", "v1.0.0", "none", first.as_slice())
        .expect("the build stores");

    assert_eq!(
        store
            .list_suite_reference_builds("carom", "v1.0.0")
            .expect("the builds list"),
        vec!["none".to_string()]
    );
    assert_eq!(
        read(&store, "none", "assets/app.js").as_deref(),
        Some("console.log(1)")
    );

    let second = gzipped_tar(&[("index.html", b"second"), ("assets/next.js", b"2")]);
    store
        .store_suite_reference_build("carom", "v1.0.0", "none", second.as_slice())
        .expect("the replacement stores");

    assert_eq!(
        read(&store, "none", "index.html").as_deref(),
        Some("second")
    );
    assert_eq!(
        read(&store, "none", "assets/app.js"),
        None,
        "a replacement is the new build, not a merge with the old one"
    );
    assert_eq!(read(&store, "none", "assets/next.js").as_deref(), Some("2"));
}

#[test]
fn an_archive_of_the_build_folder_itself_is_unpacked_from_its_dot_root() {
    // `tar -czf build.tar.gz -C dist .` names every entry under `./`, beginning
    // with the `./` directory itself.
    let mut builder = tar::Builder::new(Vec::new());
    let mut dir = tar::Header::new_gnu();
    dir.set_entry_type(tar::EntryType::Directory);
    dir.set_size(0);
    dir.set_mode(0o755);
    builder
        .append_data(&mut dir, "./", std::io::empty())
        .expect("the root appends");
    let mut file = tar::Header::new_gnu();
    file.set_size(5);
    file.set_mode(0o644);
    builder
        .append_data(&mut file, "./index.html", b"hello".as_slice())
        .expect("the index appends");
    let archive = gzip(builder.into_inner().expect("the tar finishes"));

    let (_dir, store) = temp_store();
    store
        .store_suite_reference_build("carom", "v1.0.0", "simple-2d", archive.as_slice())
        .expect("the build stores");
    assert_eq!(
        read(&store, "simple-2d", "index.html").as_deref(),
        Some("hello")
    );
}

#[test]
fn an_archive_with_no_root_index_is_refused_and_the_previous_build_is_kept() {
    let (_dir, store) = temp_store();
    let good = gzipped_tar(&[("index.html", b"good")]);
    store
        .store_suite_reference_build("carom", "v1.0.0", "none", good.as_slice())
        .expect("the build stores");

    let nested = gzipped_tar(&[("dist/index.html", b"nested")]);
    let err = store
        .store_suite_reference_build("carom", "v1.0.0", "none", nested.as_slice())
        .expect_err("a build nested in a folder is refused");
    assert!(matches!(&err, BackendError::BadRequest(msg) if msg.contains("index.html")));
    assert_eq!(read(&store, "none", "index.html").as_deref(), Some("good"));
    // Nothing of the refused upload is left behind in the staging area.
    let leftovers = crate::store::raw_dir_names(&store.staging_root()).expect("staging lists");
    assert!(leftovers.is_empty(), "staging holds {leftovers:?}");
}

#[test]
fn an_entry_leaving_the_build_is_refused() {
    let mut header = tar::Header::new_old();
    let name = b"../escape.html";
    header.as_old_mut().name[..name.len()].copy_from_slice(name);
    header.set_size(4);
    header.set_mode(0o644);
    header.set_entry_type(tar::EntryType::Regular);
    header.set_cksum();
    let mut builder = tar::Builder::new(Vec::new());
    builder
        .append(&header, b"evil".as_slice())
        .expect("the raw entry appends");
    let archive = gzip(builder.into_inner().expect("the tar finishes"));

    let (dir, store) = temp_store();
    let err = store
        .store_suite_reference_build("carom", "v1.0.0", "none", archive.as_slice())
        .expect_err("a traversal is refused");
    assert!(matches!(&err, BackendError::BadRequest(msg) if msg.contains("leaves the build")));
    assert!(!dir.path().join(SUITE_BUILDS_DIR).join("carom").exists());
}

#[test]
fn a_link_entry_is_refused() {
    let mut builder = tar::Builder::new(Vec::new());
    let mut index = tar::Header::new_gnu();
    index.set_size(2);
    index.set_mode(0o644);
    builder
        .append_data(&mut index, "index.html", b"ok".as_slice())
        .expect("the index appends");
    let mut link = tar::Header::new_gnu();
    link.set_entry_type(tar::EntryType::Symlink);
    link.set_size(0);
    builder
        .append_link(&mut link, "secrets", "/etc")
        .expect("the link appends");
    let archive = gzip(builder.into_inner().expect("the tar finishes"));

    let (_dir, store) = temp_store();
    let err = store
        .store_suite_reference_build("carom", "v1.0.0", "none", archive.as_slice())
        .expect_err("a link is refused");
    assert!(matches!(&err, BackendError::BadRequest(msg) if msg.contains("`secrets`")));
    assert!(
        store
            .list_suite_reference_builds("carom", "v1.0.0")
            .expect("the builds list")
            .is_empty()
    );
}

#[test]
fn bytes_that_are_not_a_gzipped_tar_are_refused() {
    let (_dir, store) = temp_store();
    let err = store
        .store_suite_reference_build("carom", "v1.0.0", "none", b"not an archive".as_slice())
        .expect_err("garbage is refused");
    assert!(matches!(&err, BackendError::BadRequest(msg) if msg.contains("gzipped tar")));
}

#[test]
fn an_archive_expanding_past_the_cap_is_refused() {
    let archive = gzipped_tar(&[("index.html", &[b'x'; 64 * 1024])]);
    let dir = TempDir::new().expect("a temporary directory");
    let err = unpack_build(dir.path(), archive.as_slice(), 4096)
        .expect_err("an archive past the cap is refused");
    assert!(matches!(&err, BackendError::BadRequest(msg) if msg.contains("more than 4096 bytes")));
}

#[test]
fn an_address_segment_that_is_not_a_plain_name_is_refused() {
    let (_dir, store) = temp_store();
    let archive = gzipped_tar(&[("index.html", b"x")]);
    for (slug, version, engine) in [
        ("..", "v1.0.0", "none"),
        ("carom", "a/b", "none"),
        ("carom", "v1.0.0", ".tcab"),
        ("carom", "v1.0.0", ""),
    ] {
        let err = store
            .store_suite_reference_build(slug, version, engine, archive.as_slice())
            .expect_err("the segment is refused");
        assert!(matches!(err, BackendError::BadRequest(_)));
    }
    // A prerelease version is a plain name.
    store
        .store_suite_reference_build("carom", "v0.0.0-preview.main", "none", archive.as_slice())
        .expect("a preview version stores");
}

#[test]
fn removing_a_suite_version_removes_its_builds() {
    let (dir, store) = temp_store();
    for version in ["v1.0.0", "v1.1.0"] {
        let record = sample_suite("carom", version);
        store
            .write_suite_in(&store.suite_version_dir("carom", version), &record)
            .expect("the record writes");
        store
            .store_suite_reference_build(
                "carom",
                version,
                "none",
                gzipped_tar(&[("index.html", b"x")]).as_slice(),
            )
            .expect("the build stores");
    }

    store
        .remove_suite_version("carom", "v1.0.0")
        .expect("the version is removed");
    assert!(
        store
            .list_suite_reference_builds("carom", "v1.0.0")
            .expect("the builds list")
            .is_empty()
    );
    assert_eq!(
        store
            .list_suite_reference_builds("carom", "v1.1.0")
            .expect("the builds list"),
        vec!["none".to_string()],
        "another version's builds are kept"
    );

    store
        .remove_suite_version("carom", "v1.1.0")
        .expect("the version is removed");
    assert!(!dir.path().join(SUITE_BUILDS_DIR).join("carom").exists());
}
