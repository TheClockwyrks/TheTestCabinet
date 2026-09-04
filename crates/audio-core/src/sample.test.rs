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
                root_note: 60,
                pitched: true,
            },
            SampleEntry {
                name: "debris_metal_impact".into(),
                tags: vec!["metal".into(), "impact".into()],
                duration_ms: 500.0,
                description: "Metal debris impact.".into(),
                file: None,
                root_note: 60,
                pitched: true,
            },
        ],
        None,
        44100,
    )
}

/// A mono PCM WAV of `frames` samples at `rate`, enough for the loader to decode.
#[cfg(feature = "cli")]
fn wav_bytes_at(frames: usize, rate: u32) -> Vec<u8> {
    crate::wav::encode_pcm16(&vec![0.25f32; frames], rate, 1)
}

/// A mono PCM WAV of `frames` samples at the default 44100 Hz.
#[cfg(feature = "cli")]
fn wav_bytes(frames: usize) -> Vec<u8> {
    wav_bytes_at(frames, 44100)
}

#[test]
fn an_empty_library_lists_nothing() {
    let lib = SampleLibrary::empty();
    assert!(lib.is_empty());
    assert!(lib.list(None).is_empty());
    assert!(lib.info("anything").is_none());
    assert!(lib.samples("anything").is_none());
}

#[test]
fn list_filters_by_tag() {
    let lib = library();
    assert!(!lib.is_empty());
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
fn an_entry_without_a_file_defaults_to_its_name() {
    let lib = library();
    assert_eq!(lib.list(None)[0].file_name(), "cannon_blast_deep.wav");
}

#[test]
fn samples_none_without_pack_dir() {
    // Metadata present but no audio directory -> no audio to read.
    let lib = library();
    assert!(lib.samples("cannon_blast_deep").is_none());
    assert!(lib.audio_path("cannon_blast_deep").is_none());
}

#[cfg(feature = "cli")]
mod load {
    use super::*;
    use std::path::Path;

    /// Write a pack directory holding `pack.toml` plus one `<name>.wav` per entry.
    fn write_pack(dir: &Path, manifest: &str, audio: &[(&str, Vec<u8>)]) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("pack.toml"), manifest).unwrap();
        for (name, bytes) in audio {
            std::fs::write(dir.join(format!("{name}.wav")), bytes).unwrap();
        }
    }

    const ONE_ENTRY: &str = r#"
sample_rate = 22050

[[sample]]
name = "cannon"
tags = ["explosion"]
duration_ms = 900
description = "A cannon."
"#;

    /// Frames of 22050 Hz mono audio in the 900ms `ONE_ENTRY` declares.
    const CANNON_FRAMES: usize = 19845;

    /// The audio `ONE_ENTRY` describes: 900ms of mono at its declared 22050 Hz.
    fn cannon_wav() -> Vec<u8> {
        wav_bytes_at(CANNON_FRAMES, 22050)
    }

    #[test]
    fn loads_a_pack_and_its_audio() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(&dir, ONE_ENTRY, &[("cannon", cannon_wav())]);

        let lib = load_pack(&dir).expect("loads");
        assert_eq!(lib.sample_rate(), 22050);
        assert_eq!(lib.list(None).len(), 1);
        assert_eq!(lib.samples("cannon").expect("audio").len(), CANNON_FRAMES);
    }

    #[test]
    fn resolves_a_relative_file_into_a_shared_clip_directory() {
        // The staged layout: `clips/<clip>.<profile>.wav` beside
        // `packs/<pack>/pack.toml`, with entries pointing up and across.
        let root = tempfile::tempdir().unwrap();
        let clips = root.path().join("clips");
        std::fs::create_dir_all(&clips).unwrap();
        std::fs::write(clips.join("abc123.deadbeef.wav"), wav_bytes(96)).unwrap();

        let dir = root.path().join("packs").join("gm-lite");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("pack.toml"),
            r#"
[[sample]]
name = "trombone"
file = "../../clips/abc123.deadbeef.wav"
root_note = 68
"#,
        )
        .unwrap();

        let lib = load_pack(&dir).expect("loads");
        let entry = lib.info("trombone").expect("entry");
        assert_eq!(
            entry.file.as_deref(),
            Some("../../clips/abc123.deadbeef.wav")
        );
        assert_eq!(entry.root_note, 68);
        assert_eq!(
            lib.audio_path("trombone").unwrap(),
            dir.join("../../clips/abc123.deadbeef.wav")
        );
        assert_eq!(lib.samples("trombone").expect("audio").len(), 96);
    }

    #[test]
    fn a_missing_directory_is_an_error() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("absent");
        assert_eq!(load_pack(&dir), Err(PackError::MissingDir(dir)));
    }

    #[test]
    fn a_file_in_place_of_a_directory_is_an_error() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("combat-core");
        std::fs::write(&path, b"not a directory").unwrap();
        assert_eq!(load_pack(&path), Err(PackError::NotADirectory(path)));
    }

    #[test]
    fn a_directory_without_a_manifest_is_an_error() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("cannon.wav"), wav_bytes(8)).unwrap();
        assert_eq!(load_pack(&dir), Err(PackError::NoManifest(dir)));
    }

    #[test]
    fn an_unparseable_manifest_is_an_error() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("pack.toml"), "[[sample]\nname =").unwrap();
        let err = load_pack(&dir).expect_err("rejects");
        assert!(
            matches!(&err, PackError::InvalidManifest(path, _) if path == &dir.join("pack.toml")),
            "{err}"
        );
    }

    #[test]
    fn a_directory_named_like_a_manifest_is_not_one() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(dir.join("manifest.toml")).unwrap();
        assert_eq!(load_pack(&dir), Err(PackError::NoManifest(dir)));
    }

    #[test]
    fn a_declared_entry_with_no_audio_file_is_an_error() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(&dir, ONE_ENTRY, &[]);
        assert_eq!(
            load_pack(&dir),
            Err(PackError::MissingAudio {
                entry: "cannon".into(),
                path: dir.join("cannon.wav"),
            })
        );
    }

    #[test]
    fn a_declared_entry_whose_audio_does_not_decode_is_an_error() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(&dir, ONE_ENTRY, &[]);
        std::fs::write(
            dir.join("cannon.wav"),
            b"this is not a RIFF/WAVE file at all",
        )
        .unwrap();
        let err = load_pack(&dir).expect_err("rejects");
        assert!(
            matches!(&err, PackError::UndecodableAudio { entry, .. } if entry == "cannon"),
            "{err}"
        );
    }

    #[test]
    fn a_manifest_declaring_no_entries_loads_as_an_empty_library() {
        // The loader reports the pack as declared; `runner::load_library` decides
        // whether an empty pack is acceptable for the run.
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(&dir, "sample_rate = 44100\n", &[]);
        let lib = load_pack(&dir).expect("loads");
        assert!(lib.is_empty());
    }

    #[test]
    fn an_alternately_named_manifest_still_loads() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("combat-core.toml"), ONE_ENTRY).unwrap();
        std::fs::write(dir.join("cannon.wav"), cannon_wav()).unwrap();
        assert_eq!(load_pack(&dir).expect("loads").list(None).len(), 1);
    }

    #[test]
    fn errors_name_the_path_they_involve() {
        let dir = std::path::PathBuf::from("/nonexistent/pack/dir");
        let err = load_pack(&dir).expect_err("rejects");
        assert!(err.to_string().contains("/nonexistent/pack/dir"), "{err}");
    }

    #[test]
    fn audio_at_another_rate_than_the_manifest_declares_is_an_error() {
        // Every consumer resamples from the pack's declared rate, so audio recorded at
        // a different one plays back at the wrong pitch and length.
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(&dir, ONE_ENTRY, &[("cannon", wav_bytes_at(39690, 44100))]);
        assert_eq!(
            load_pack(&dir),
            Err(PackError::SampleRateMismatch {
                entry: "cannon".into(),
                path: dir.join("cannon.wav"),
                declared: 22050,
                actual: 44100,
            })
        );
    }

    #[test]
    fn audio_of_another_length_than_the_manifest_declares_is_an_error() {
        // `duration_ms` is what the model browses and times its composition against.
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(&dir, ONE_ENTRY, &[("cannon", wav_bytes_at(11025, 22050))]);
        assert_eq!(
            load_pack(&dir),
            Err(PackError::DurationMismatch {
                entry: "cannon".into(),
                path: dir.join("cannon.wav"),
                declared: 900.0,
                actual: 500.0,
            })
        );
    }

    #[test]
    fn a_mismatch_names_the_entry_and_both_values() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(&dir, ONE_ENTRY, &[("cannon", wav_bytes_at(11025, 22050))]);
        let message = load_pack(&dir).expect_err("rejects").to_string();
        assert!(message.contains("cannon"), "{message}");
        assert!(message.contains("900.0"), "{message}");
        assert!(message.contains("500.0"), "{message}");

        write_pack(&dir, ONE_ENTRY, &[("cannon", wav_bytes_at(39690, 44100))]);
        let message = load_pack(&dir).expect_err("rejects").to_string();
        assert!(message.contains("cannon"), "{message}");
        assert!(message.contains("22050"), "{message}");
        assert!(message.contains("44100"), "{message}");
    }

    #[test]
    fn a_duration_within_rounding_of_the_audio_loads() {
        // The publisher writes `duration_ms` rounded to whole milliseconds from the
        // same bytes, so a sub-millisecond disagreement is the encoding, not a defect.
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(
            &dir,
            ONE_ENTRY,
            &[("cannon", wav_bytes_at(CANNON_FRAMES - 22, 22050))],
        );
        load_pack(&dir).expect("a millisecond of rounding is not a mismatch");
    }

    #[test]
    fn a_manifest_declaring_neither_rate_nor_duration_takes_the_audio_as_it_is() {
        // Both fields are optional; an entry that declares nothing states nothing to
        // check, and the audio's own rate and length stand.
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("combat-core");
        write_pack(
            &dir,
            "\n[[sample]]\nname = \"cannon\"\n",
            &[("cannon", wav_bytes_at(1234, 8000))],
        );
        let lib = load_pack(&dir).expect("loads");
        assert_eq!(lib.list(None).len(), 1);
    }
}
