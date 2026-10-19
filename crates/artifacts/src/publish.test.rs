//! Tests for publishing a run's media into the public store, ported from the
//! media cases of the backend's snapshot builder, and for the public key rule.
//!
//! Each test stores a run tree in memory, publishes it into a
//! [`MemoryPublicStore`], and asserts on the answered entries and on the
//! objects written: their keys, bytes and both labels.

use std::sync::Arc;

use serde_json::{Value, json};
use test_cabinet_contracts::run_record::{RunRecord, RunShowcase, ShowcaseMedia};
use test_cabinet_contracts::test_case::MediaKind;
use test_cabinet_contracts::validation::{
    AssetFrameResult, AssetGenResult, DebugScriptResult, ProofResult, ValidationSummary,
};

use super::testing::{FakeTranscoder, RUN, record};
use super::*;
use crate::public::MemoryPublicStore;
use crate::store::testing::{memory_store, seed};

/// A proof result.
fn proof(id: &str, dest: &str, kind: MediaKind, present: bool) -> ProofResult {
    ProofResult {
        id: id.to_string(),
        name: id.to_string(),
        kind,
        dest: dest.to_string(),
        present,
        detail: None,
    }
}

/// A debug script backing `item` (or its sub-item `sub`) with `outputs` of
/// `(id, kind, present)`.
fn script(item: &str, sub: Option<&str>, outputs: &[(&str, MediaKind, bool)]) -> DebugScriptResult {
    serde_json::from_value(json!({
        "itemId": item,
        "subItemId": sub,
        "title": item,
        "script": format!("validation/{item}.mjs"),
        "ran": true,
        "verdicts": [],
        "outputs": outputs
            .iter()
            .map(|(id, kind, present)| json!({
                "id": id,
                "name": id,
                "kind": kind,
                "actualPresent": present,
            }))
            .collect::<Vec<_>>(),
    }))
    .expect("a debug script result")
}

/// What one test publishes against: the tree's run, the public store, and the
/// transcoder.
struct Fixture {
    tree: RunTree,
    public: MemoryPublicStore,
    transcoder: Arc<FakeTranscoder>,
}

impl Fixture {
    /// Store `record` and `files` (paths relative to the run root) as the run's
    /// tree, publishing with `transcoder`.
    async fn new(record: &RunRecord, files: &[(&str, &[u8])], transcoder: FakeTranscoder) -> Self {
        let record = serde_json::to_vec(record).expect("serialize the record");
        let mut entries: Vec<(&str, &[u8])> = vec![("run-record.json", &record)];
        entries.extend_from_slice(files);
        Self::of_entries(&entries, transcoder).await
    }

    /// Store exactly `entries` as the run's tree.
    async fn of_entries(entries: &[(&str, &[u8])], transcoder: FakeTranscoder) -> Self {
        let (store, _objects) = memory_store();
        seed(&store, RUN, entries).await;
        Self {
            tree: store.run_tree(RUN).await.expect("the tree"),
            public: MemoryPublicStore::new(),
            transcoder: Arc::new(transcoder),
        }
    }

    /// Publish the run's media, answering the response body as JSON.
    async fn publish(&self) -> Value {
        let published = publish_run_media(&self.tree, &self.public, self.transcoder.as_ref())
            .await
            .expect("the publish");
        serde_json::to_value(&published).expect("serialize the answer")
    }

    /// The object at `key`: its bytes, content type and content encoding.
    fn object(&self, key: &str) -> (Vec<u8>, String, Option<String>) {
        let object = self
            .public
            .object(key)
            .unwrap_or_else(|| panic!("`{key}` was published"));
        (object.body, object.content_type, object.content_encoding)
    }
}

/// The `(name, key)` pairs of one list of the answer, named by `field`.
fn pairs(answer: &Value, list: &str, field: &str) -> Vec<(String, String)> {
    answer[list]
        .as_array()
        .unwrap_or_else(|| panic!("`{list}` is a list"))
        .iter()
        .map(|entry| {
            (
                entry[field].as_str().expect("a name").to_string(),
                entry["key"].as_str().expect("a key").to_string(),
            )
        })
        .collect()
}

#[tokio::test]
async fn proofs_publish_from_their_recorded_dest_under_the_proof_id() {
    let record = record(
        ValidationSummary {
            proofs: vec![
                proof("title", "shots/title.png", MediaKind::Image, true),
                proof("recording", "rec/draw.json.gz", MediaKind::Replay, true),
                // Declared but not produced: contributes nothing.
                proof("absent", "shots/absent.png", MediaKind::Image, false),
                // Present on the record, but its bytes are not in the tree.
                proof("lost", "shots/lost.png", MediaKind::Image, true),
            ],
            ..Default::default()
        },
        None,
    );
    let fixture = Fixture::new(
        &record,
        &[
            ("implementation/shots/title.png", b"png:title"),
            ("implementation/rec/draw.json.gz", b"\x1f\x8bgz"),
            ("implementation/shots/absent.png", b"png:absent"),
        ],
        FakeTranscoder::working(),
    )
    .await;
    let answer = fixture.publish().await;

    let proofs = answer["proofMedia"].as_array().expect("proofMedia");
    assert_eq!(proofs.len(), 2);
    assert_eq!(proofs[0]["id"], "title");
    assert_eq!(proofs[0]["kind"], "image");
    assert_eq!(proofs[0]["key"], "media/runs/run-1/proof/title.png");
    assert_eq!(proofs[1]["id"], "recording");
    assert_eq!(proofs[1]["key"], "media/runs/run-1/proof/recording.gz");

    assert_eq!(
        fixture.object("media/runs/run-1/proof/title.png"),
        (b"png:title".to_vec(), "image/png".to_string(), None)
    );
    // The dest's compound `.json.gz` suffix labels a recording as JSON
    // travelling gzipped, though its published name ends only `.gz`.
    assert_eq!(
        fixture.object("media/runs/run-1/proof/recording.gz"),
        (
            b"\x1f\x8bgz".to_vec(),
            "application/json".to_string(),
            Some("gzip".to_string())
        )
    );
    assert_eq!(fixture.public.keys().len(), 2);
    assert_eq!(fixture.transcoder.runs(), 0);
}

#[tokio::test]
async fn a_webm_video_proof_is_transcoded_to_mp4() {
    let record = record(
        ValidationSummary {
            proofs: vec![proof("clip", "clips/play.webm", MediaKind::Video, true)],
            ..Default::default()
        },
        None,
    );
    let fixture = Fixture::new(
        &record,
        &[("implementation/clips/play.webm", b"webm")],
        FakeTranscoder::working(),
    )
    .await;
    let answer = fixture.publish().await;

    assert_eq!(answer["proofMedia"][0]["kind"], "video");
    assert_eq!(
        answer["proofMedia"][0]["key"],
        "media/runs/run-1/proof/clip.mp4"
    );
    assert_eq!(
        fixture.object("media/runs/run-1/proof/clip.mp4"),
        (b"mp4:webm".to_vec(), "video/mp4".to_string(), None)
    );
    assert_eq!(
        fixture.public.keys(),
        vec!["media/runs/run-1/proof/clip.mp4"]
    );
    assert_eq!(fixture.transcoder.runs(), 1);
}

#[tokio::test]
async fn an_mp4_video_proof_is_copied_without_a_transcode() {
    let record = record(
        ValidationSummary {
            proofs: vec![proof("clip", "clips/play.mp4", MediaKind::Video, true)],
            ..Default::default()
        },
        None,
    );
    let fixture = Fixture::new(
        &record,
        &[("implementation/clips/play.mp4", b"already mp4")],
        FakeTranscoder::working(),
    )
    .await;
    fixture.publish().await;

    assert_eq!(
        fixture.object("media/runs/run-1/proof/clip.mp4"),
        (b"already mp4".to_vec(), "video/mp4".to_string(), None)
    );
    assert_eq!(fixture.transcoder.runs(), 0);
}

#[tokio::test]
async fn a_failed_transcode_publishes_the_webm_as_recorded() {
    let record = record(
        ValidationSummary {
            proofs: vec![proof("clip", "clips/play.webm", MediaKind::Video, true)],
            ..Default::default()
        },
        None,
    );
    let fixture = Fixture::new(
        &record,
        &[("implementation/clips/play.webm", b"webm")],
        FakeTranscoder::failing(),
    )
    .await;
    let answer = fixture.publish().await;

    // The media still appears, under its served webm name, and the mp4 key is
    // left free for a later publish that can transcode.
    assert_eq!(
        answer["proofMedia"][0]["key"],
        "media/runs/run-1/proof/clip.webm"
    );
    assert_eq!(
        fixture.object("media/runs/run-1/proof/clip.webm"),
        (b"webm".to_vec(), "video/webm".to_string(), None)
    );
    assert!(
        fixture
            .public
            .object("media/runs/run-1/proof/clip.mp4")
            .is_none()
    );
}

#[tokio::test]
async fn validation_media_publishes_the_declared_outputs_and_the_image_store() {
    let record = record(
        ValidationSummary {
            debug_scripts: vec![
                script(
                    "spin",
                    None,
                    &[
                        ("still", MediaKind::Image, true),
                        ("rally", MediaKind::Video, true),
                        ("draw", MediaKind::Replay, true),
                        ("missing", MediaKind::Image, false),
                    ],
                ),
                // A per-sub-item driver keys its media by the composite verdict id.
                script(
                    "paddles",
                    Some("left"),
                    &[("still", MediaKind::Image, true)],
                ),
            ],
            ..Default::default()
        },
        None,
    );
    let fixture = Fixture::new(
        &record,
        &[
            (
                "implementation/.vendor/validation/spin__still.png",
                b"png:still",
            ),
            (
                "implementation/.vendor/validation/spin__rally.webm",
                b"webm",
            ),
            (
                "implementation/.vendor/validation/spin__draw.json.gz",
                b"\x1f\x8bdraw",
            ),
            (
                "implementation/.vendor/validation/spin__missing.png",
                b"png:missing",
            ),
            // Collected under the host namespace's previous name.
            (
                "implementation/.tcab/validation/paddles.left__still.png",
                b"png:left",
            ),
            // The recordings' shared image store, on no record.
            (
                "implementation/.vendor/validation/img.ab12.png",
                b"png:store",
            ),
            ("implementation/.vendor/validation/img.cd34.bin", b"rgba"),
            // Neither declared nor a store file: not published.
            ("implementation/.vendor/validation/stray.png", b"png:stray"),
            // A baseline sibling is not the run's own media.
            (
                "implementation/.vendor/validation/spin__still.baseline.png",
                b"png:baseline",
            ),
        ],
        FakeTranscoder::working(),
    )
    .await;
    let answer = fixture.publish().await;

    let prefix = "media/runs/run-1/validation";
    assert_eq!(
        pairs(&answer, "validationMedia", "file"),
        vec![
            (
                "spin__still.png".into(),
                format!("{prefix}/spin__still.png")
            ),
            // The entry keeps the requested webm name; the key ends mp4.
            (
                "spin__rally.webm".into(),
                format!("{prefix}/spin__rally.mp4")
            ),
            (
                "spin__draw.json.gz".into(),
                format!("{prefix}/spin__draw.json.gz")
            ),
            (
                "paddles.left__still.png".into(),
                format!("{prefix}/paddles.left__still.png")
            ),
            ("img.ab12.png".into(), format!("{prefix}/img.ab12.png")),
            ("img.cd34.bin".into(), format!("{prefix}/img.cd34.bin")),
        ]
    );
    assert_eq!(
        fixture.object(&format!("{prefix}/spin__rally.mp4")),
        (b"mp4:webm".to_vec(), "video/mp4".to_string(), None)
    );
    assert_eq!(
        fixture.object(&format!("{prefix}/spin__draw.json.gz")),
        (
            b"\x1f\x8bdraw".to_vec(),
            "application/json".to_string(),
            Some("gzip".to_string())
        )
    );
    assert_eq!(
        fixture
            .object(&format!("{prefix}/paddles.left__still.png"))
            .0,
        b"png:left"
    );
    assert_eq!(
        fixture.object(&format!("{prefix}/img.cd34.bin")),
        (
            b"rgba".to_vec(),
            "application/octet-stream".to_string(),
            None
        )
    );
    assert_eq!(fixture.public.keys().len(), 6);
}

#[tokio::test]
async fn asset_media_publishes_the_names_the_record_implies() {
    let record = record(
        ValidationSummary {
            asset: Some(AssetGenResult {
                frames: vec![AssetFrameResult {
                    index: 0,
                    regenerated_image: "out/regenerated.png".to_string(),
                    preview_image: "out/preview.png".to_string(),
                    actions_log: "out/actions.json".to_string(),
                    operation_count: 3,
                    cheat_divergence: None,
                    detail: None,
                }],
                sheet: None,
                detail: None,
            }),
            ..Default::default()
        },
        None,
    );
    // The preview is deliberately absent: a missing file is skipped, not fatal.
    let fixture = Fixture::new(
        &record,
        &[
            ("implementation/out/regenerated.png", b"png:regen"),
            ("implementation/out/actions.json", b"[]"),
        ],
        FakeTranscoder::working(),
    )
    .await;
    let answer = fixture.publish().await;

    assert_eq!(
        pairs(&answer, "assetMedia", "file"),
        vec![
            (
                "regenerated.png".into(),
                "media/runs/run-1/asset/regenerated.png".into()
            ),
            (
                "actions.json".into(),
                "media/runs/run-1/asset/actions.json".into()
            ),
        ]
    );
    assert_eq!(
        fixture.object("media/runs/run-1/asset/regenerated.png"),
        (b"png:regen".to_vec(), "image/png".to_string(), None)
    );
    assert_eq!(
        fixture.object("media/runs/run-1/asset/actions.json").1,
        "application/json"
    );
}

#[tokio::test]
async fn a_run_of_no_asset_family_publishes_no_asset_media() {
    let fixture = Fixture::new(
        &record(ValidationSummary::default(), None),
        &[("implementation/regenerated.png", b"png")],
        FakeTranscoder::working(),
    )
    .await;
    let answer = fixture.publish().await;
    assert_eq!(answer["assetMedia"], json!([]));
    assert_eq!(answer["proofMedia"], json!([]));
    assert_eq!(answer["validationMedia"], json!([]));
    assert_eq!(answer["showcaseMedia"], json!([]));
    assert!(fixture.public.keys().is_empty());
}

/// A showcase whose carousel lists `media` and whose description is
/// `description`.
fn showcase(description: &str, media: &[(&str, MediaKind)]) -> RunShowcase {
    RunShowcase {
        description: description.to_string(),
        media: media
            .iter()
            .map(|(file, kind)| ShowcaseMedia {
                file: file.to_string(),
                name: file.to_string(),
                kind: *kind,
            })
            .collect(),
    }
}

#[tokio::test]
async fn showcase_media_publishes_the_whole_directory_and_transcodes_a_clip() {
    let record = record(
        ValidationSummary::default(),
        Some(showcase(
            "# My Game\n![B](banner.png)",
            &[
                ("title.png", MediaKind::Image),
                ("clip.webm", MediaKind::Video),
            ],
        )),
    );
    let fixture = Fixture::new(
        &record,
        &[
            ("implementation/showcase/title.png", b"png:title"),
            ("implementation/showcase/showcase.md", b"# My Game"),
            // Referenced by the description, not listed in the carousel.
            ("implementation/showcase/banner.png", b"png:banner"),
            ("implementation/showcase/clip.webm", b"webm"),
            // Capture-side input: never published.
            ("implementation/showcase/showcase.toml", b"title = 1"),
        ],
        FakeTranscoder::working(),
    )
    .await;
    let answer = fixture.publish().await;

    let prefix = "media/runs/run-1/showcase";
    assert_eq!(
        pairs(&answer, "showcaseMedia", "file"),
        vec![
            ("banner.png".into(), format!("{prefix}/banner.png")),
            ("clip.webm".into(), format!("{prefix}/clip.mp4")),
            ("showcase.md".into(), format!("{prefix}/showcase.md")),
            ("title.png".into(), format!("{prefix}/title.png")),
        ]
    );
    assert_eq!(
        fixture.object(&format!("{prefix}/clip.mp4")),
        (b"mp4:webm".to_vec(), "video/mp4".to_string(), None)
    );
    assert_eq!(
        fixture.object(&format!("{prefix}/showcase.md")).1,
        "text/markdown; charset=utf-8"
    );
    assert!(
        fixture
            .public
            .object(&format!("{prefix}/clip.webm"))
            .is_none()
    );
    assert!(
        fixture
            .public
            .object(&format!("{prefix}/showcase.toml"))
            .is_none()
    );
}

#[tokio::test]
async fn showcase_files_are_not_published_when_the_record_carries_none() {
    let fixture = Fixture::new(
        &record(ValidationSummary::default(), None),
        &[("implementation/showcase/title.png", b"png:title")],
        FakeTranscoder::working(),
    )
    .await;
    let answer = fixture.publish().await;
    assert_eq!(answer["showcaseMedia"], json!([]));
    assert!(fixture.public.keys().is_empty());
}

#[tokio::test]
async fn media_already_published_is_named_without_being_written_or_transcoded() {
    let record = record(
        ValidationSummary {
            proofs: vec![
                proof("clip", "clips/play.webm", MediaKind::Video, true),
                proof("title", "shots/title.png", MediaKind::Image, true),
            ],
            ..Default::default()
        },
        // An image only the description names, whose bytes the tree no longer
        // holds: the key already published is still named.
        Some(showcase("![B](banner.png)", &[])),
    );
    let fixture = Fixture::new(
        &record,
        &[
            ("implementation/clips/play.webm", b"webm"),
            ("implementation/shots/title.png", b"png:new"),
        ],
        FakeTranscoder::working(),
    )
    .await;
    fixture
        .public
        .insert("media/runs/run-1/proof/clip.mp4", b"old mp4", "video/mp4");
    fixture.public.insert(
        "media/runs/run-1/showcase/banner.png",
        b"old png",
        "image/png",
    );

    let first = fixture.publish().await;
    assert_eq!(
        pairs(&first, "showcaseMedia", "file"),
        vec![(
            "banner.png".into(),
            "media/runs/run-1/showcase/banner.png".into()
        )]
    );
    assert_eq!(fixture.transcoder.runs(), 0);
    assert_eq!(
        fixture.public.writes(),
        vec!["media/runs/run-1/proof/title.png"]
    );
    assert_eq!(
        fixture.object("media/runs/run-1/proof/clip.mp4").0,
        b"old mp4"
    );

    // A second publish answers the same keys and writes nothing.
    let second = fixture.publish().await;
    assert_eq!(first, second);
    assert_eq!(fixture.public.writes().len(), 1);
}

#[tokio::test]
async fn media_of_another_run_does_not_count_as_published() {
    let record = record(
        ValidationSummary {
            proofs: vec![proof("title", "shots/title.png", MediaKind::Image, true)],
            ..Default::default()
        },
        None,
    );
    let fixture = Fixture::new(
        &record,
        &[("implementation/shots/title.png", b"png")],
        FakeTranscoder::working(),
    )
    .await;
    fixture
        .public
        .insert("media/runs/run-10/proof/title.png", b"other", "image/png");
    fixture.publish().await;
    assert_eq!(
        fixture.public.writes(),
        vec!["media/runs/run-1/proof/title.png"]
    );
}

#[tokio::test]
async fn a_tree_without_a_record_publishes_nothing() {
    let fixture = Fixture::of_entries(
        &[("implementation/shots/title.png", b"png")],
        FakeTranscoder::working(),
    )
    .await;
    let err = publish_run_media(&fixture.tree, &fixture.public, fixture.transcoder.as_ref())
        .await
        .expect_err("no record");
    assert!(matches!(err, PublishError::NoRecord(id) if id == RUN));

    let fixture = Fixture::of_entries(
        &[("run-record.json", b"{not json")],
        FakeTranscoder::working(),
    )
    .await;
    let err = publish_run_media(&fixture.tree, &fixture.public, fixture.transcoder.as_ref())
        .await
        .expect_err("an unparseable record");
    assert!(matches!(err, PublishError::BadRecord { .. }));
}

/// A tiny real webm clip made with ffmpeg, or `None` when ffmpeg or its VP8
/// encoder is unavailable.
fn make_test_webm(dir: &Path) -> Option<std::path::PathBuf> {
    let out = dir.join("in.webm");
    let made = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=64x64:rate=10",
            "-c:v",
            "libvpx",
            "-b:v",
            "50k",
        ])
        .arg(&out)
        .status()
        .is_ok_and(|status| status.success());
    made.then_some(out)
}

#[tokio::test]
async fn ffmpeg_transcodes_a_webm_clip_to_an_mp4() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let Some(input) = make_test_webm(dir.path()) else {
        eprintln!("skipping: ffmpeg/libvpx unavailable");
        return;
    };
    let output = dir.path().join("out.mp4");
    assert!(Ffmpeg::new().webm_to_mp4(&input, &output).await);
    let mp4 = std::fs::read(&output).expect("the mp4");
    // An ISO base media file opens with its `ftyp` box.
    assert_eq!(&mp4[4..8], b"ftyp");
}

#[tokio::test]
async fn ffmpeg_reports_a_clip_it_cannot_read() {
    let dir = tempfile::tempdir().expect("a temp dir");
    let input = dir.path().join("in.webm");
    std::fs::write(&input, b"not a webm").expect("write the input");
    let output = dir.path().join("out.mp4");
    assert!(!Ffmpeg::new().webm_to_mp4(&input, &output).await);
    assert!(
        !Ffmpeg::with_program("/nonexistent/ffmpeg")
            .webm_to_mp4(&input, &output)
            .await
    );
}

#[test]
fn a_public_key_names_one_object_plainly() {
    for key in [
        "index.json",
        "snapshots/2026-06-17T2140Z-abcd1234/runs/r1.json",
        "media/runs/r1/proof/title.png",
        "media/cases/pong/v1.0.0/references/a b.png",
    ] {
        assert_eq!(check_public_key(key), Ok(()), "{key}");
    }
    for key in [
        "",
        "/index.json",
        "media/../index.json",
        "media/./index.json",
        "..",
        "media//runs",
        "media/runs/",
        "media\\runs",
        "media/runs\u{0}/x",
        "media/\nruns",
    ] {
        assert!(check_public_key(key).is_err(), "{key:?}");
    }
    let longest = "k".repeat(MAX_PUBLIC_KEY_BYTES);
    assert_eq!(check_public_key(&longest), Ok(()));
    assert!(check_public_key(&format!("{longest}k")).is_err());
}

#[test]
fn media_is_labelled_by_its_whole_name() {
    let cases = [
        ("a.png", "image/png", None),
        ("a.JPG", "image/jpeg", None),
        ("a.webm", "video/webm", None),
        ("a.mp4", "video/mp4", None),
        ("a.json", "application/json", None),
        ("a.json.gz", "application/json", Some("gzip")),
        ("a.tar.gz", "application/gzip", None),
        ("a.md", "text/markdown; charset=utf-8", None),
        ("a.glb", "model/gltf-binary", None),
        ("a.wav", "audio/wav", None),
        ("a.mid", "audio/midi", None),
        ("img.ab.bin", "application/octet-stream", None),
        ("noext", "application/octet-stream", None),
    ];
    for (file, content_type, encoding) in cases {
        let labels = media_labels(file);
        assert_eq!(labels.content_type, content_type, "{file}");
        assert_eq!(labels.content_encoding, encoding, "{file}");
    }
}
