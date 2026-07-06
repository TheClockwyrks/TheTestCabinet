use super::*;

fn library() -> SampleLibrary {
    SampleLibrary::from_entries(
        vec![
            SampleEntry {
                name: "cannon_blast_deep".into(),
                tags: vec!["explosion".into(), "naval".into()],
                duration_ms: 900.0,
                description: "A deep naval cannon blast.".into(),
                file: None,
            },
            SampleEntry {
                name: "debris_metal_impact".into(),
                tags: vec!["metal".into(), "impact".into()],
                duration_ms: 500.0,
                description: "Metal debris impact.".into(),
                file: None,
            },
        ],
        None,
        44100,
    )
}

#[test]
fn empty_library_degrades_gracefully() {
    let lib = SampleLibrary::empty();
    assert!(lib.list(None).is_empty());
    assert!(lib.info("anything").is_none());
    assert!(lib.samples("anything").is_none());
}

#[test]
fn list_filters_by_tag() {
    let lib = library();
    assert_eq!(lib.list(None).len(), 2);
    let explosions = lib.list(Some("explosion"));
    assert_eq!(explosions.len(), 1);
    assert_eq!(explosions[0].name, "cannon_blast_deep");
    assert!(lib.list(Some("nonexistent")).is_empty());
}

#[test]
fn info_finds_by_name() {
    let lib = library();
    let e = lib.info("debris_metal_impact").expect("found");
    assert_eq!(e.duration_ms, 500.0);
    assert!(lib.info("missing").is_none());
}

#[test]
fn samples_none_without_pack_dir() {
    // Metadata present but no audio directory -> no audio (graceful).
    let lib = library();
    assert!(lib.samples("cannon_blast_deep").is_none());
}

#[cfg(feature = "cli")]
#[test]
fn load_pack_absent_dir_is_empty() {
    let lib = load_pack(Some(std::path::Path::new("/nonexistent/pack/dir")));
    assert!(lib.list(None).is_empty());
}
