//! Publishing a run's media and writing the public dataset: the two service
//! writes into the public store.
//!
//! [`publish_run_media`] is `POST /runs/{id}/publish-media`. It copies a run's
//! publishable media — its proof, validation, asset and showcase files — from
//! the run's stored tree to the public store under `media/runs/<run-id>/`, and
//! answers with the key each file was published under, in the lists a per-run
//! document names them by (see [Run media]). The selection is the one the
//! backend's snapshot builder made when it uploaded the media itself:
//!
//! - **Proofs** come from the record's `validation.proofs`, each read from its
//!   recorded `dest` and published as `<proof-id>.<ext>`
//!   ([`proof_published_extension`]).
//! - **Validation media** is the record's declared debug-script outputs
//!   ([`validation_media_name`], [`validation_published_extension`]) plus the
//!   recordings' shared image store, which no record names and which is
//!   therefore enumerated off the tree ([`is_validation_image_name`]).
//! - **Asset media** is the served names an asset-generation (or adversarial)
//!   run's record implies, each resolved as the asset route resolves it.
//! - **Showcase media** is everything in the tree's `showcase/`, plus any
//!   carousel entry or image the description references, when the record
//!   carries a showcase at all.
//!
//! A published run's media never changes, so it is written once: the copy lists
//! what is already under the run's prefix and skips every key there. A `video`
//! is transcoded from webm to mp4 for iOS playback ([`Transcoder`]); its entry
//! keeps the recorded `.webm` name while its key ends `.mp4`. A transcode that
//! fails publishes the webm under its own name, so the media still appears. A
//! `replay` recorded as `.webm` is published as recorded. Each object is stored
//! with both of its labels, what the resource is and how its bytes are framed.
//!
//! [`check_public_key`] is the rule a `PUT /public/{key}` key is held to.
//!
//! [Run media]: https://docs.testcabinet.ai/components/backend/snapshot/#run-media

use std::collections::{BTreeSet, HashSet};
use std::path::Path;

use futures_util::{StreamExt as _, TryStreamExt as _};
use serde::Serialize;
use test_cabinet_contracts::RunRecord;
use test_cabinet_contracts::backend_api::snapshot::{
    RunAssetOut, RunProofOut, RunShowcaseOut, RunValidationMediaOut,
};
use test_cabinet_contracts::layout::{
    VALIDATION_MEDIA_DIR, is_validation_image_name, proof_labelled_name, proof_published_extension,
    proof_served_extension, validation_media_name, validation_published_extension,
};
use test_cabinet_contracts::test_case::{MediaKind, ReviewItem};
use test_cabinet_suites::content_labels::{self, ContentLabels};
use tokio::io::AsyncWriteExt as _;

use crate::object::{ObjectBody, ObjectStream};
use crate::playable::{LEGACY_VENDOR_DIR, asset_path, is_flat_name};
use crate::public::{PublicStore, PublicStoreError};
use crate::store::{RunTree, StoreError};

#[cfg(test)]
#[path = "publish.test.rs"]
mod tests;

/// Test support: a [`Transcoder`] that runs no program, and run records.
#[cfg(test)]
#[path = "publish.testing.rs"]
pub(crate) mod testing;

/// The public-store prefix a run's media is published under, keyed by the run
/// id rather than by any snapshot, because a published run's media never
/// changes.
pub const MEDIA_PREFIX: &str = "media/runs";

/// The longest key `PUT /public/{key}` accepts, in bytes: the S3 limit R2
/// enforces, and within Blob's.
pub const MAX_PUBLIC_KEY_BYTES: usize = 1024;

/// How many media files one publish copies at once. Each copy relays its object
/// through a bounded buffer, so this bounds the memory a publish holds.
const COPY_CONCURRENCY: usize = 8;

/// How many transcodes the service runs at once. A transcode is CPU and memory
/// heavy and the pod's ceiling is shared with every read it serves, so they
/// queue.
const TRANSCODE_PERMITS: usize = 1;

/// What [`publish_run_media`] answers: each kind's entries, pairing the recorded
/// name with the key the file was published under, in the shapes a per-run
/// document names them by.
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedMedia {
    /// The proof media, by proof id and kind.
    pub proof_media: Vec<RunProofOut>,
    /// The synthesized validation outputs and the recordings' image store.
    pub validation_media: Vec<RunValidationMediaOut>,
    /// An asset-generation run's produced media.
    pub asset_media: Vec<RunAssetOut>,
    /// The showcase's files.
    pub showcase_media: Vec<RunShowcaseOut>,
}

impl std::fmt::Debug for PublishedMedia {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PublishedMedia")
            .field("proof_media", &self.proof_media.len())
            .field("validation_media", &self.validation_media.len())
            .field("asset_media", &self.asset_media.len())
            .field("showcase_media", &self.showcase_media.len())
            .finish()
    }
}

impl std::fmt::Debug for RunMediaEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Proof { id, .. } => write!(f, "proof `{id}`"),
            Self::Validation(file) => write!(f, "validation `{file}`"),
            Self::Asset(file) => write!(f, "asset `{file}`"),
            Self::Showcase(file) => write!(f, "showcase `{file}`"),
        }
    }
}

/// A publish failed.
#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    /// The run's tree holds no run record, so nothing says what it published.
    #[error("run `{0}` stores no run record")]
    NoRecord(String),
    /// The run's record does not parse.
    #[error("run `{id}`'s run record does not parse: {message}")]
    BadRecord {
        /// The run.
        id: String,
        /// Why it does not parse.
        message: String,
    },
    /// The run-tree store failed a read.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// The public store failed a listing or a write.
    #[error("the public store: {0}")]
    Public(#[from] PublicStoreError),
    /// A video could not be staged on disk for its transcode.
    #[error("staging a video for its transcode: {0}")]
    Staging(#[source] std::io::Error),
}

/// Transcodes a webm clip to an mp4 the iOS browsers play.
#[async_trait::async_trait]
pub trait Transcoder: Send + Sync {
    /// Transcode the clip at `input` into an mp4 at `output`. `false` on any
    /// failure, after which the caller publishes the clip as recorded.
    async fn webm_to_mp4(&self, input: &Path, output: &Path) -> bool;
}

/// The [`Transcoder`] the service runs: `ffmpeg`, carried in its image, to
/// H.264 with 4:2:0 chroma and the index at the front for progressive playback.
#[derive(Debug)]
pub struct Ffmpeg {
    program: String,
    permits: tokio::sync::Semaphore,
}

impl Ffmpeg {
    /// The `ffmpeg` on the `PATH`.
    pub fn new() -> Self {
        Self::with_program("ffmpeg")
    }

    /// The `ffmpeg` at `program`.
    pub fn with_program(program: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            permits: tokio::sync::Semaphore::new(TRANSCODE_PERMITS),
        }
    }
}

impl Default for Ffmpeg {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl Transcoder for Ffmpeg {
    async fn webm_to_mp4(&self, input: &Path, output: &Path) -> bool {
        let Ok(_permit) = self.permits.acquire().await else {
            return false;
        };
        let status = tokio::process::Command::new(&self.program)
            .args(["-nostdin", "-loglevel", "error", "-y", "-i"])
            .arg(input)
            .args([
                "-c:v",
                "libx264",
                // 4:2:0 chroma is what QuickTime/iOS decodes; libx264 would
                // otherwise keep the webm's 4:4:4 or 4:2:2 and Safari refuses it.
                "-pix_fmt",
                "yuv420p",
                "-preset",
                "veryfast",
                // Any audio becomes AAC; a recorded clip carries none.
                "-c:a",
                "aac",
                // The index at the front, which needs a seekable output, so the
                // clip is staged through files rather than pipes.
                "-movflags",
                "+faststart",
            ])
            .arg(output)
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .status()
            .await;
        match status {
            Ok(status) if status.success() => true,
            Ok(status) => {
                tracing::warn!(%status, "ffmpeg failed to transcode a webm clip");
                false
            }
            Err(err) => {
                tracing::warn!(error = %err, program = %self.program, "ffmpeg could not be run");
                false
            }
        }
    }
}

/// Whether `key` may be written by `PUT /public/{key}`: a relative key of at
/// most [`MAX_PUBLIC_KEY_BYTES`], whose every `/`-separated segment is
/// non-empty and neither `.` nor `..`, with no backslash and no control
/// character. A key is stored as given, so one a reader would resolve
/// differently from how it was written is refused rather than normalized.
pub fn check_public_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("the key is empty".to_string());
    }
    if key.len() > MAX_PUBLIC_KEY_BYTES {
        return Err(format!(
            "the key is {} bytes, over the {MAX_PUBLIC_KEY_BYTES}-byte limit",
            key.len()
        ));
    }
    if key.starts_with('/') {
        return Err("the key starts with `/`".to_string());
    }
    if key.contains('\\') || key.chars().any(char::is_control) {
        return Err("the key carries a backslash or a control character".to_string());
    }
    if key
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("the key has an empty, `.` or `..` segment".to_string());
    }
    Ok(())
}

/// Which list of [`PublishedMedia`] an entry lands in, with what it is named
/// by there.
enum RunMediaEntry {
    Proof { id: String, kind: MediaKind },
    Validation(String),
    Asset(String),
    Showcase(String),
}

/// Where one media file's bytes come from.
enum Source {
    /// The first of `paths` the tree holds, copied verbatim and labelled as
    /// `labelled` names.
    Copy {
        paths: Vec<String>,
        labelled: String,
    },
    /// A video published as mp4 under the item's key. The first of `mp4_paths`
    /// the tree holds is copied as it is; otherwise the first of `raw_paths` is
    /// transcoded, and when that fails it is published as recorded at
    /// `fallback_key`, labelled as `fallback_name`.
    Video {
        mp4_paths: Vec<String>,
        mp4_name: String,
        raw_paths: Vec<String>,
        fallback_key: String,
        fallback_name: String,
    },
}

/// One media file to publish: the key it is published under, the entry that
/// names it, and where its bytes come from.
struct Item {
    key: String,
    entry: RunMediaEntry,
    source: Source,
}

/// Copy run `tree`'s publishable media into `public` under
/// `media/runs/<run-id>/`, skipping every key already there, and answer with
/// the key each file was published under.
///
/// A file the record names but the tree does not hold contributes nothing. A
/// store that fails, on either side, fails the publish, which is safe to
/// repeat: what was written stays written and is skipped the next time.
pub async fn publish_run_media(
    tree: &RunTree,
    public: &dyn PublicStore,
    transcoder: &dyn Transcoder,
) -> Result<PublishedMedia, PublishError> {
    let id = tree.id();
    let bytes = tree
        .read("run-record.json")
        .await?
        .ok_or_else(|| PublishError::NoRecord(id.to_string()))?;
    let record: RunRecord =
        serde_json::from_slice(&bytes).map_err(|err| PublishError::BadRecord {
            id: id.to_string(),
            message: err.to_string(),
        })?;

    let prefix = format!("{MEDIA_PREFIX}/{id}/");
    let existing: HashSet<String> = public.list_keys(&prefix).await?.into_iter().collect();

    let mut items = proof_items(&record, &prefix);
    items.extend(validation_items(tree, &record, &prefix).await?);
    items.extend(asset_items(&record, &prefix));
    items.extend(showcase_items(tree, &record, &prefix).await?);

    let context = Context {
        tree,
        public,
        transcoder,
        existing: &existing,
    };
    let published: Vec<Option<(RunMediaEntry, String)>> = futures_util::stream::iter(items)
        .map(|item| context.publish(item))
        .buffered(COPY_CONCURRENCY)
        .try_collect()
        .await?;

    let mut media = PublishedMedia::default();
    let mut written = 0usize;
    for (entry, key) in published.into_iter().flatten() {
        written += 1;
        match entry {
            RunMediaEntry::Proof { id, kind } => {
                media.proof_media.push(RunProofOut { id, kind, key });
            }
            RunMediaEntry::Validation(file) => {
                media
                    .validation_media
                    .push(RunValidationMediaOut { file, key });
            }
            RunMediaEntry::Asset(file) => media.asset_media.push(RunAssetOut { file, key }),
            RunMediaEntry::Showcase(file) => {
                media.showcase_media.push(RunShowcaseOut { file, key });
            }
        }
    }
    tracing::info!(run.id = %id, media = written, "published run media");
    Ok(media)
}

/// The proofs the record declares present, each published as
/// `<proof-id>.<ext>`: a video as mp4, anything else under its recorded
/// extension.
fn proof_items(record: &RunRecord, prefix: &str) -> Vec<Item> {
    let mut items = Vec::new();
    for proof in record
        .validation
        .proofs
        .iter()
        .filter(|proof| proof.present)
    {
        let published_ext = proof_published_extension(proof.kind, &proof.dest);
        let published_file = format!("{}.{published_ext}", proof.id);
        if !is_flat_name(&published_file) {
            continue;
        }
        let key = format!("{prefix}proof/{published_file}");
        let dest = format!("implementation/{}", proof.dest);
        let served_ext = proof_served_extension(&proof.dest);
        let source = if proof.kind == MediaKind::Video && served_ext != published_ext {
            let served_file = format!("{}.{served_ext}", proof.id);
            Source::Video {
                mp4_paths: Vec::new(),
                mp4_name: published_file,
                raw_paths: vec![dest],
                fallback_key: format!("{prefix}proof/{served_file}"),
                fallback_name: served_file,
            }
        } else {
            // A video publishes under the name its key carries; anything else
            // under its recorded dest's, since only the dest carries a compound
            // `.json.gz` suffix whole.
            let labelled = if proof.kind == MediaKind::Video {
                published_file
            } else {
                proof_labelled_name(&proof.dest, &published_file).to_string()
            };
            Source::Copy {
                paths: vec![dest],
                labelled,
            }
        };
        items.push(Item {
            key,
            entry: RunMediaEntry::Proof {
                id: proof.id.clone(),
                kind: proof.kind,
            },
            source,
        });
    }
    items
}

/// The tree paths a validation media file named `file` is read from: the
/// current host namespace, then the one trees were collected under before it
/// was renamed.
fn validation_paths(file: &str) -> Vec<String> {
    vec![
        format!("implementation/{VALIDATION_MEDIA_DIR}/{file}"),
        format!("implementation/{LEGACY_VENDOR_DIR}/validation/{file}"),
    ]
}

/// The declared debug-script outputs the record says the build produced, then
/// the recordings' shared image store the tree holds.
async fn validation_items(
    tree: &RunTree,
    record: &RunRecord,
    prefix: &str,
) -> Result<Vec<Item>, StoreError> {
    let mut items = Vec::new();
    for script in &record.validation.debug_scripts {
        // The verdict id keys the script's media: the item's own id, or the
        // composite `<item>.<sub>` of a per-sub-item driver.
        let verdict_id = match &script.sub_item_id {
            Some(sub) => ReviewItem::sub_item_verdict_id(&script.item_id, sub),
            None => script.item_id.clone(),
        };
        for output in script.outputs.iter().filter(|output| output.actual_present) {
            // The flat name a console requests, which the entry keeps.
            let requested = validation_media_name(&verdict_id, &output.id, output.kind);
            let published_ext = validation_published_extension(output.kind);
            let published_file = format!("{verdict_id}__{}.{published_ext}", output.id);
            if !is_flat_name(&requested) || !is_flat_name(&published_file) {
                continue;
            }
            let key = format!("{prefix}validation/{published_file}");
            let source = if output.kind == MediaKind::Video {
                Source::Video {
                    mp4_paths: validation_paths(&published_file),
                    mp4_name: published_file,
                    raw_paths: validation_paths(&requested),
                    fallback_key: format!("{prefix}validation/{requested}"),
                    fallback_name: requested.clone(),
                }
            } else {
                Source::Copy {
                    paths: validation_paths(&published_file),
                    labelled: published_file,
                }
            };
            items.push(Item {
                key,
                entry: RunMediaEntry::Validation(requested),
                source,
            });
        }
    }

    // The image store backs no verdict and is on no record, so it is enumerated
    // off the tree. A store file is never a video, and is published under the
    // very name it is served under, so a recording's entry resolves it through
    // the lookup the recording itself came from.
    let mut store_files = BTreeSet::new();
    for dir in [
        format!("implementation/{VALIDATION_MEDIA_DIR}"),
        format!("implementation/{LEGACY_VENDOR_DIR}/validation"),
    ] {
        let dir_prefix = format!("{dir}/");
        for object in tree.list(&dir).await? {
            if let Some(file) = object.path.strip_prefix(&dir_prefix)
                && is_flat_name(file)
                && is_validation_image_name(file)
            {
                store_files.insert(file.to_string());
            }
        }
    }
    for file in store_files {
        items.push(Item {
            key: format!("{prefix}validation/{file}"),
            entry: RunMediaEntry::Validation(file.clone()),
            source: Source::Copy {
                paths: validation_paths(&file),
                labelled: file,
            },
        });
    }
    Ok(items)
}

/// The served names an asset-generation run's media is published under, as its
/// record implies them. A run of no asset family publishes none.
fn asset_files(record: &RunRecord) -> Vec<String> {
    let validation = &record.validation;
    // A sheet, an animated model and a kit suffix each member with `-<index>`;
    // a single member serves under bare names.
    let suffix = |indexed: bool, index: usize| {
        if indexed {
            format!("-{index}")
        } else {
            String::new()
        }
    };
    if let Some(asset) = validation.asset.as_ref() {
        let is_sheet = asset.sheet.is_some();
        asset
            .frames
            .iter()
            .flat_map(|frame| {
                let suffix = suffix(is_sheet, frame.index as usize);
                [
                    format!("regenerated{suffix}.png"),
                    format!("preview{suffix}.png"),
                    format!("actions{suffix}.json"),
                ]
            })
            .collect()
    } else if let Some(voxel) = validation.voxel.as_ref() {
        // Cheat detection is retired for voxel, so there is no regenerated PNG;
        // the rig itself travels inline in the run record.
        let animated = voxel.model.is_some() || voxel.rig.is_some();
        (0..voxel.parts.len())
            .flat_map(|index| {
                let suffix = suffix(animated, index);
                [
                    format!("preview{suffix}.png"),
                    format!("actions{suffix}.json"),
                    format!("mesh{suffix}.glb"),
                ]
            })
            .collect()
    } else if let Some(ui) = validation.ui.as_ref() {
        let is_kit = ui.elements.len() > 1;
        std::iter::once("ui.json".to_string())
            .chain(
                (0..ui.elements.len()).map(|index| format!("element{}.png", suffix(is_kit, index))),
            )
            .collect()
    } else if let Some(material) = validation.material.as_ref() {
        std::iter::once("material.json".to_string())
            .chain((0..material.maps.len()).map(|index| format!("map-{index}.png")))
            .collect()
    } else if let Some(particle) = validation.particle.as_ref() {
        let mut files = vec!["system.json".to_string()];
        if particle.preview.is_some() {
            files.push("preview.gif".to_string());
        }
        files
    } else if let Some(audio) = validation.audio.as_ref() {
        let mut files = vec!["clip.wav".to_string()];
        if audio.midi.is_some() {
            files.push("score.mid".to_string());
        }
        if audio.preview.is_some() {
            files.push("preview.png".to_string());
        }
        files
    } else if validation.adversarial.is_some() {
        vec!["replay.json".to_string()]
    } else {
        Vec::new()
    }
}

/// An asset-generation run's media, each read from the path its record names
/// for it, as the asset route resolves it.
fn asset_items(record: &RunRecord, prefix: &str) -> Vec<Item> {
    asset_files(record)
        .into_iter()
        .filter_map(|file| {
            let rel = asset_path(record, &file)?;
            Some(Item {
                key: format!("{prefix}asset/{file}"),
                source: Source::Copy {
                    paths: vec![format!("implementation/{rel}")],
                    labelled: file.clone(),
                },
                entry: RunMediaEntry::Asset(file),
            })
        })
        .collect()
}

/// The showcase's files, when the record carries a showcase: everything the
/// tree's `showcase/` holds, then any carousel entry or description-referenced
/// image the listing missed, each once.
async fn showcase_items(
    tree: &RunTree,
    record: &RunRecord,
    prefix: &str,
) -> Result<Vec<Item>, StoreError> {
    let Some(showcase) = record.showcase.as_ref() else {
        return Ok(Vec::new());
    };
    let mut files: Vec<String> = tree
        .list("implementation/showcase")
        .await?
        .into_iter()
        .filter_map(|object| {
            object
                .path
                .strip_prefix("implementation/showcase/")
                .map(str::to_string)
        })
        .collect();
    files.extend(showcase.media.iter().map(|media| media.file.clone()));
    files.extend(
        test_cabinet_contracts::showcase::description_image_references(&showcase.description),
    );
    let mut seen = HashSet::new();
    files.retain(|file| {
        // The manifest is capture-side input, already folded into the record.
        is_flat_name(file) && file != "showcase.toml" && seen.insert(file.clone())
    });

    Ok(files
        .into_iter()
        .map(|file| {
            let path = format!("implementation/showcase/{file}");
            let is_video = file.to_ascii_lowercase().ends_with(".webm");
            let (key, source) = if is_video {
                let mp4_name = format!("{}.mp4", file.strip_suffix(".webm").unwrap_or(&file));
                (
                    format!("{prefix}showcase/{mp4_name}"),
                    Source::Video {
                        mp4_paths: Vec::new(),
                        mp4_name,
                        raw_paths: vec![path],
                        fallback_key: format!("{prefix}showcase/{file}"),
                        fallback_name: file.clone(),
                    },
                )
            } else {
                (
                    format!("{prefix}showcase/{file}"),
                    Source::Copy {
                        paths: vec![path],
                        labelled: file.clone(),
                    },
                )
            };
            Item {
                key,
                entry: RunMediaEntry::Showcase(file),
                source,
            }
        })
        .collect())
}

/// What one publish reads from and writes to.
struct Context<'a> {
    tree: &'a RunTree,
    public: &'a dyn PublicStore,
    transcoder: &'a dyn Transcoder,
    existing: &'a HashSet<String>,
}

impl Context<'_> {
    /// Publish `item`, answering its entry and the key it is published under,
    /// or `None` when the tree does not hold it.
    async fn publish(&self, item: Item) -> Result<Option<(RunMediaEntry, String)>, PublishError> {
        let Item { key, entry, source } = item;
        // Already published: the key is named without reading the source, and a
        // video is not transcoded again.
        if self.existing.contains(&key) {
            return Ok(Some((entry, key)));
        }
        match source {
            Source::Copy { paths, labelled } => {
                let Some(object) = self.first_present(&paths).await? else {
                    return Ok(None);
                };
                self.put(&key, object.body, &labelled).await?;
                Ok(Some((entry, key)))
            }
            Source::Video {
                mp4_paths,
                mp4_name,
                raw_paths,
                fallback_key,
                fallback_name,
            } => {
                if let Some(object) = self.first_present(&mp4_paths).await? {
                    self.put(&key, object.body, &mp4_name).await?;
                    return Ok(Some((entry, key)));
                }
                let Some(raw) = self.first_present(&raw_paths).await? else {
                    return Ok(None);
                };
                let staging = tempfile::tempdir().map_err(PublishError::Staging)?;
                let input = staging.path().join("in.webm");
                let output = staging.path().join("out.mp4");
                stage(raw.body, &input).await?;
                if self.transcoder.webm_to_mp4(&input, &output).await {
                    self.put(&key, file_body(&output).await?, &mp4_name).await?;
                    return Ok(Some((entry, key)));
                }
                tracing::warn!(
                    run.id = %self.tree.id(),
                    media = ?entry,
                    "webm to mp4 transcode unavailable; publishing the webm as recorded (not iOS-playable)"
                );
                if !self.existing.contains(&fallback_key) {
                    self.put(&fallback_key, file_body(&input).await?, &fallback_name)
                        .await?;
                }
                Ok(Some((entry, fallback_key)))
            }
        }
    }

    /// The first of `paths` the tree holds.
    async fn first_present(&self, paths: &[String]) -> Result<Option<ObjectStream>, StoreError> {
        for path in paths {
            if let Some(object) = self.tree.get(path).await? {
                return Ok(Some(object));
            }
        }
        Ok(None)
    }

    /// Write `body` at `key`, labelled as the file `labelled` names.
    async fn put(&self, key: &str, body: ObjectBody, labelled: &str) -> Result<u64, PublishError> {
        let labels = media_labels(labelled);
        Ok(self
            .public
            .put(key, body, labels.content_type, labels.content_encoding)
            .await?)
    }
}

/// Write `body` to the file at `path`.
async fn stage(mut body: ObjectBody, path: &Path) -> Result<(), PublishError> {
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(PublishError::Staging)?;
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|err| PublishError::Store(StoreError::Body(err)))?;
        file.write_all(&chunk)
            .await
            .map_err(PublishError::Staging)?;
    }
    file.flush().await.map_err(PublishError::Staging)?;
    Ok(())
}

/// The file at `path` as a body, read as it is sent.
async fn file_body(path: &Path) -> Result<ObjectBody, PublishError> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(PublishError::Staging)?;
    Ok(Box::pin(tokio_util::io::ReaderStream::new(file)))
}

/// The labels published media is stored under, from its file name.
///
/// The whole name is needed, not just the extension: a validator's
/// draw-command recording is published gzipped as it is stored, and only the
/// compound `.json.gz` suffix says the gzip is framing over a JSON document
/// rather than the resource itself.
pub fn media_labels(file: &str) -> ContentLabels {
    let extension = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match extension.to_ascii_lowercase().as_str() {
        "png" => ContentLabels::plain("image/png"),
        "jpg" | "jpeg" => ContentLabels::plain("image/jpeg"),
        "webp" => ContentLabels::plain("image/webp"),
        "gif" => ContentLabels::plain("image/gif"),
        "webm" => ContentLabels::plain("video/webm"),
        "mp4" => ContentLabels::plain("video/mp4"),
        "json" => ContentLabels::plain("application/json"),
        "gz" => content_labels::for_gz(file),
        // A showcase's description file, markdown a page renders.
        "md" => ContentLabels::plain("text/markdown; charset=utf-8"),
        "glb" => ContentLabels::plain("model/gltf-binary"),
        "wav" => ContentLabels::plain("audio/wav"),
        "mid" | "midi" => ContentLabels::plain("audio/midi"),
        _ => ContentLabels::plain("application/octet-stream"),
    }
}
