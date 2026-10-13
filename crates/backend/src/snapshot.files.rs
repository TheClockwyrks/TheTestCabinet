//! How a snapshot build accounts for each file of a published run: the object it
//! is in, or the finding that its bytes exist nowhere, and the two files of a
//! run that no document names: its controller module and its session record.
//!
//! Every collector of [`SnapshotBuilder`] publishes through the two functions
//! here, so one place decides what a file's [manifest
//! entry](crate::db::MediaManifestFile) says and when a missing file leaves its
//! run unconfirmed.

use test_cabinet_core::redact::SecretScrubber;
use test_cabinet_core::run_record::RunRecord;

use super::{
    MEDIA_PREFIX, Missing, SnapshotBuilder, SnapshotObject, TreeMedia, decode_maybe_gzip,
    transcode_webm_to_mp4,
};
use crate::db::{MediaFileKind, MediaManifestFile};
use crate::error::{BackendError, Result};

/// The directory under a run's prefix that holds the recorded bytes of each
/// transcoded video: `media/runs/<id>/original/<kind>/<file>`.
///
/// Its own directory, so that the key can meet neither the mp4 under
/// `<kind>/<file>.mp4` nor the recorded webm a failed transcode publishes under
/// `<kind>/<file>`, which the next build replaces with the mp4.
pub(super) const ORIGINAL_DIR: &str = "original";

/// The name of a gg run's session record under its run's prefix:
/// `media/runs/<id>/session-record.json`.
///
/// At the prefix's root, where the only other object is the controller module,
/// so the key can meet no file of a media directory. An adversarial run's
/// replays are `asset/replay.json` and its siblings.
pub(super) const SESSION_RECORD_OBJECT: &str = "session-record.json";

/// What one build finds about the files of one run.
#[derive(Debug, Default)]
pub(super) struct RunAccount {
    /// The files this build could not account for, each as the name it is
    /// reported under; see [`Snapshot::unconfirmed_media`](super::Snapshot::unconfirmed_media).
    pub(super) unconfirmed: Vec<String>,
    /// The run's manifest entries; see
    /// [`Snapshot::media_manifests`](super::Snapshot::media_manifests).
    pub(super) files: Vec<MediaManifestFile>,
}

/// One file a collector publishes.
#[derive(Debug, Clone, Copy)]
pub(super) struct Published<'a> {
    /// Which of the run's media directories the file is in.
    pub(super) kind: MediaFileKind,
    /// The file's name in that directory, as the store holds it.
    pub(super) file: &'a str,
    /// Whether a directory listing named the file. Such a file exists, so a read
    /// that finds nothing always leaves the run unconfirmed. A name only the
    /// record gave may be of a file that was never written.
    pub(super) listed: bool,
}

/// The directory of the store, the tree's routes and the bucket prefix that
/// holds files of `kind`.
fn media_dir(kind: MediaFileKind) -> &'static str {
    match kind {
        MediaFileKind::Proof => "proof",
        MediaFileKind::Validation => "validation",
        MediaFileKind::Showcase => "showcase",
        MediaFileKind::Asset
        | MediaFileKind::CodeAnalysis
        | MediaFileKind::Controller
        | MediaFileKind::SessionRecord => "asset",
    }
}

/// The names of `names` a media route can serve, each once and in order: a name
/// that is a single path segment. A record names its files by run-relative path,
/// and the store, the tree's routes and the bucket all hold them flat.
pub(super) fn flat_names<'a>(names: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut flat: Vec<String> = Vec::new();
    for name in names {
        let is_flat = !name.is_empty()
            && name != "."
            && name != ".."
            && !name.contains('/')
            && !name.contains('\\');
        if is_flat && !flat.iter().any(|seen| seen == name) {
            flat.push(name.to_string());
        }
    }
    flat
}

/// The files of `kind` a manifest records, as the names the store holds them by
/// in that kind's directory, each once and in the order recorded.
///
/// This is what a build of a run from its manifest takes in place of a directory
/// listing. A video recorded under its mp4's name has that name here, which is
/// the name the store held it under.
pub(super) fn recorded_names(
    manifest: &crate::db::MediaManifest,
    kind: MediaFileKind,
) -> Vec<String> {
    let prefix = format!("{}/", media_dir(kind));
    let mut names: Vec<String> = Vec::new();
    for file in manifest.files.iter().filter(|file| file.kind == kind) {
        if let Some(name) = file.name.strip_prefix(&prefix)
            && !names.iter().any(|seen| seen == name)
        {
            names.push(name.to_string());
        }
    }
    names
}

/// The object keys of `files`, one run's manifest entries, that two files are
/// published under: a key that holds one file's own bytes and is also another
/// entry's, as its bytes or as its transcode. Each once, sorted.
///
/// An entry repeated for one name is not a contest, and neither is a key two
/// entries name only as a transcode.
pub(super) fn contested_keys(files: &[MediaManifestFile]) -> Vec<String> {
    let mut contested = std::collections::BTreeSet::new();
    for (index, file) in files.iter().enumerate() {
        let Some(key) = file.key.as_deref() else {
            continue;
        };
        let contest = files.iter().enumerate().any(|(other_index, other)| {
            other_index != index
                && other.name != file.name
                && other.keys().any(|other_key| other_key == key)
        });
        if contest {
            contested.insert(key.to_string());
        }
    }
    contested.into_iter().collect()
}

/// The scrubbed, uncompressed JSON of a stored document, and whether the scrub
/// redacted anything. `stored` is gzip or plain JSON, as the store holds either.
/// An `Err` names why the bytes are not a document.
pub(super) fn scrubbed_json(
    stored: &[u8],
    scrubber: &SecretScrubber,
) -> std::result::Result<(Vec<u8>, bool), &'static str> {
    let plain = decode_maybe_gzip(stored).ok_or("the stored bytes do not decompress")?;
    let mut document: serde_json::Value =
        serde_json::from_slice(&plain).map_err(|_| "the stored bytes are not JSON")?;
    let redacted = scrubber.scrub_json(&mut document);
    let bytes = serde_json::to_vec(&document).map_err(|_| "the document does not serialize")?;
    Ok((bytes, redacted))
}

impl SnapshotBuilder {
    /// Publish one file under the name the store holds it by, and return the key
    /// the run's document references it under, or `None` when it is left out.
    ///
    /// An object already in the bucket is referenced without reading the source
    /// bytes. Otherwise the file is read from the store or the run's tree
    /// ([`Self::read_media`]) and added to `objects`, labelled as `labelled`.
    /// Either way the file is entered in the run's manifest.
    ///
    /// A file that could not be read is left out. It is entered in the manifest as
    /// unrecoverable when every source answered that it does not hold it and no
    /// listing named it, and reported unconfirmed as `<dir>/<file>` otherwise.
    pub(super) async fn publish_plain(
        &self,
        run_id: &str,
        published: Published<'_>,
        labelled: &str,
        tree: &TreeMedia,
        account: &mut RunAccount,
        objects: &mut Vec<SnapshotObject>,
    ) -> Option<String> {
        let Published { kind, file, listed } = published;
        let dir = media_dir(kind);
        let name = format!("{dir}/{file}");
        // A run built from its manifest references the object recorded for the
        // file. A file the manifest does not name, or records as unrecoverable,
        // is left out, as it was by the refresh that confirmed the run.
        if let Some(manifest) = tree.recorded() {
            let entry = manifest.file(&name)?;
            account.files.push(entry.clone());
            return entry.key.clone();
        }
        let key = format!("{MEDIA_PREFIX}/{run_id}/{name}");
        if self.existing_media.contains(&key) {
            account
                .files
                .push(MediaManifestFile::stored(kind, name, key.clone()));
            return Some(key);
        }
        match self.read_media(run_id, dir, file, tree).await {
            Ok(bytes) => {
                objects.push(SnapshotObject::media(key.clone(), bytes, labelled));
                account
                    .files
                    .push(MediaManifestFile::stored(kind, name, key.clone()));
                Some(key)
            }
            Err(Missing::Unrecoverable) if !listed => {
                account
                    .files
                    .push(MediaManifestFile::unrecoverable(kind, name, None));
                None
            }
            Err(Missing::Settled) if !listed => None,
            Err(_) => {
                account.unconfirmed.push(name);
                None
            }
        }
    }

    /// Publish one video recorded as `published.file` (a `.webm`) as the mp4
    /// `mp4_file`, with its recording beside it, and return the key the run's
    /// document references: the mp4's, or the recording's when the transcode
    /// failed. `None` when the video is left out.
    ///
    /// Two objects make a published video. The mp4 under `<dir>/<mp4_file>` is
    /// what the site plays. The recording, verbatim under
    /// [`ORIGINAL_DIR`]`/<dir>/<file>`, is what keeps the bucket a copy of the
    /// run's own bytes. Each is written once: one already in the bucket is
    /// neither read nor transcoded again, so a video whose mp4 an earlier build
    /// published only has its recording read and uploaded, with no transcode.
    ///
    /// `probe_published` first looks for a copy the store or the tree already
    /// holds under the mp4's name, which is then the stored file itself and is
    /// published as it is, with no recording to keep.
    ///
    /// A transcode that fails publishes the recording under `<dir>/<file>` so the
    /// media still appears, and reports the run unconfirmed as `<dir>/<mp4_file>`:
    /// the next build finds no mp4 and reads the source again. A recording that
    /// could not be read is entered in the manifest as unrecoverable, keeping the
    /// mp4's key when the bucket holds one, or reported unconfirmed as
    /// `<dir>/<file>`, by the rule of [`Self::publish_plain`].
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn publish_video(
        &self,
        run_id: &str,
        published: Published<'_>,
        mp4_file: &str,
        probe_published: bool,
        tree: &TreeMedia,
        account: &mut RunAccount,
        objects: &mut Vec<SnapshotObject>,
    ) -> Option<String> {
        let Published { kind, file, listed } = published;
        let dir = media_dir(kind);
        let name = format!("{dir}/{file}");
        let mp4_name = format!("{dir}/{mp4_file}");
        // A run built from its manifest references what was recorded for the
        // video: the mp4 of a recording, which is what a document names even
        // when the recording itself is unrecoverable, or the stored file of a
        // video that was held under the mp4's name.
        if let Some(manifest) = tree.recorded() {
            let entry = manifest.file(&name).or_else(|| manifest.file(&mp4_name))?;
            account.files.push(entry.clone());
            return entry.transcoded_key.clone().or_else(|| entry.key.clone());
        }
        let mp4_key = format!("{MEDIA_PREFIX}/{run_id}/{mp4_name}");
        let original_key = format!("{MEDIA_PREFIX}/{run_id}/{ORIGINAL_DIR}/{name}");
        let has_mp4 = self.existing_media.contains(&mp4_key);
        let has_original = self.existing_media.contains(&original_key);
        if has_mp4 && has_original {
            account.files.push(MediaManifestFile::transcoded(
                kind,
                name,
                original_key,
                mp4_key.clone(),
            ));
            return Some(mp4_key);
        }
        if probe_published
            && !has_mp4
            && let Ok(bytes) = self.read_media(run_id, dir, mp4_file, tree).await
        {
            objects.push(SnapshotObject::media(mp4_key.clone(), bytes, mp4_file));
            account
                .files
                .push(MediaManifestFile::stored(kind, mp4_name, mp4_key.clone()));
            return Some(mp4_key);
        }
        let raw = match self.read_media(run_id, dir, file, tree).await {
            Ok(raw) => raw,
            Err(missing) => {
                // Positively there, not merely "not found absent": a lookup that
                // failed says nothing, and the recording may yet be readable.
                let stored_as_mp4 = self
                    .store
                    .run_file_size(run_id, &mp4_name)
                    .is_some_and(|bytes| bytes > 0);
                if has_mp4 && probe_published && stored_as_mp4 {
                    // The store holds the mp4 itself and no recording, so the mp4
                    // in the bucket is the stored file.
                    account
                        .files
                        .push(MediaManifestFile::stored(kind, mp4_name, mp4_key.clone()));
                    return Some(mp4_key);
                }
                match missing {
                    Missing::Unrecoverable if !listed => {
                        account.files.push(MediaManifestFile::unrecoverable(
                            kind,
                            name,
                            has_mp4.then(|| mp4_key.clone()),
                        ));
                    }
                    Missing::Settled if !listed => {}
                    _ => account.unconfirmed.push(name),
                }
                return has_mp4.then_some(mp4_key);
            }
        };
        if !has_original {
            objects.push(SnapshotObject::media(
                original_key.clone(),
                raw.clone(),
                file,
            ));
        }
        if !has_mp4 {
            let Some(mp4) = transcode_webm_to_mp4(&raw).await else {
                tracing::warn!(
                    run_id = %run_id,
                    file = %name,
                    "webm→mp4 transcode unavailable; publishing raw webm (not iOS-playable)"
                );
                // The next build looks for the mp4 key, finds none, and reads the
                // source again to transcode it.
                account.unconfirmed.push(mp4_name);
                let key = format!("{MEDIA_PREFIX}/{run_id}/{name}");
                objects.push(SnapshotObject::media(key.clone(), raw, file));
                return Some(key);
            };
            objects.push(SnapshotObject::media(mp4_key.clone(), mp4, mp4_file));
        }
        account.files.push(MediaManifestFile::transcoded(
            kind,
            name,
            original_key,
            mp4_key.clone(),
        ));
        Some(mp4_key)
    }

    /// Publish an adversarial run's controller module as
    /// `media/runs/<id>/controller.wasm`, the object to upload when the bucket
    /// does not hold it yet.
    ///
    /// The record decides: a run whose record names no module (a forfeit before
    /// any controller loaded) has none. The arena loads this file for every match
    /// the run's controller plays, and nothing but the backend store and the
    /// run's tree holds it, so it is read from either ([`Self::read_root`]) and
    /// entered in the run's manifest. No document names it.
    pub(super) async fn run_controller(
        &self,
        record: &RunRecord,
        tree: &TreeMedia,
        account: &mut RunAccount,
    ) -> Option<SnapshotObject> {
        let adversarial = record.validation.adversarial.as_ref()?;
        if adversarial.controller_module.is_empty() {
            return None;
        }
        let run_id = &record.id;
        let kind = MediaFileKind::Controller;
        let name = test_cabinet_core::TREE_ROOT_CONTROLLER;
        // A run built from its manifest keeps the entry recorded for the
        // module. The object is in the bucket or exists nowhere, so there is
        // nothing to upload either way.
        if let Some(manifest) = tree.recorded() {
            account.files.extend(manifest.file(name).cloned());
            return None;
        }
        let key = format!("{MEDIA_PREFIX}/{run_id}/{name}");
        if self.existing_media.contains(&key) {
            account
                .files
                .push(MediaManifestFile::stored(kind, name, key));
            return None;
        }
        match self.read_root(run_id, name, tree).await {
            Ok(bytes) => {
                account
                    .files
                    .push(MediaManifestFile::stored(kind, name, key.clone()));
                Some(SnapshotObject::media(key, bytes, name))
            }
            Err(Missing::Unrecoverable) => {
                account
                    .files
                    .push(MediaManifestFile::unrecoverable(kind, name, None));
                None
            }
            Err(Missing::Settled) => None,
            Err(Missing::Unavailable) => {
                account.unconfirmed.push(name.to_string());
                None
            }
        }
    }

    /// Publish a run's session record as
    /// `media/runs/<id>/`[`SESSION_RECORD_OBJECT`], the object to upload when the
    /// bucket does not hold it yet.
    ///
    /// The store decides: no field of a run record says whether its run captured
    /// a session, so a run has a record exactly when its folder holds one. Only
    /// the driver of a gg run writes one. The store is also the only source: the
    /// artifact service serves no session record, so nothing is read from the
    /// run's tree. A run whose folder holds none, or an empty one, and whose
    /// object the bucket lacks is entered in the manifest with no record.
    ///
    /// The one run of those that is not left at that is a run a manifest
    /// [recorded a session record for](SnapshotBuilder::with_recorded_session_records).
    /// Its record was published, the state sweep removed the stored copy, and
    /// the object was deleted from the bucket. The record is entered as
    /// unrecoverable, like any other file that exists nowhere, once the store
    /// [answers](Self::store_answers); the run is left unconfirmed while it
    /// does not.
    ///
    /// The record carries its run's whole model conversation, so like the
    /// code-analysis document it is scrubbed before it becomes an object, and is
    /// published uncompressed: the state sweep compares a stored record with its
    /// object by scrubbing it again, which a compressed form would not survive
    /// byte for byte. Unlike that document it is never parsed whole: see
    /// [`session_record`](super::session_record). The read runs on a blocking
    /// thread, and what it returns is bounded by
    /// [`MAX_PUBLISHED_RECORD_BYTES`](super::session_record::MAX_PUBLISHED_RECORD_BYTES).
    ///
    /// A record that is there and cannot be read, one that is not a JSON
    /// document and one over that bound leave the run unconfirmed as
    /// [`SESSION_RECORD_OBJECT`], so the stored file is kept.
    ///
    /// Only a published run is built, so the record of any other run reaches
    /// this function never. No document names the object.
    pub(super) async fn run_session_record(
        &self,
        run_id: &str,
        scrubber: &SecretScrubber,
        tree: &TreeMedia,
        account: &mut RunAccount,
    ) -> Option<SnapshotObject> {
        use super::session_record::{MAX_PUBLISHED_RECORD_BYTES, export_record};

        let kind = MediaFileKind::SessionRecord;
        let name = crate::store::SESSION_RECORD_FILE;
        // A run built from its manifest keeps the entry recorded for the
        // record. The object is in the bucket, so there is nothing to upload.
        if let Some(manifest) = tree.recorded() {
            account.files.extend(manifest.file(name).cloned());
            return None;
        }
        let key = format!("{MEDIA_PREFIX}/{run_id}/{SESSION_RECORD_OBJECT}");
        if self.existing_media.contains(&key) {
            account
                .files
                .push(MediaManifestFile::stored(kind, name, key));
            return None;
        }
        let store = self.store.clone();
        let scrubber = scrubber.clone();
        let id = run_id.to_string();
        let exported = tokio::task::spawn_blocking(move || {
            Ok(store
                .open_run_file(&id, name)?
                .map(|stored| export_record(stored, &scrubber, MAX_PUBLISHED_RECORD_BYTES)))
        })
        .await
        .map_err(|err| BackendError::Internal(format!("store task failed: {err}")))
        .and_then(|read: Result<_>| read);
        let unconfirmed = |account: &mut RunAccount| {
            account.unconfirmed.push(SESSION_RECORD_OBJECT.to_string());
            None
        };
        match exported {
            Ok(Some(Ok((bytes, redacted)))) => {
                if redacted {
                    tracing::warn!(
                        run.id = %run_id,
                        "redacted leaked API key(s) from a published session record"
                    );
                }
                account
                    .files
                    .push(MediaManifestFile::stored(kind, name, key.clone()));
                Some(SnapshotObject {
                    key,
                    bytes,
                    content_type: "application/json".to_string(),
                    content_encoding: None,
                })
            }
            Ok(Some(Err(failure))) => {
                tracing::warn!(
                    run.id = %run_id,
                    reason = failure.reason(),
                    "a published run's stored session record could not be published; \
                     the run is left unconfirmed"
                );
                unconfirmed(account)
            }
            Ok(None) => {
                // A manifest of the run has an entry for a record, so the run
                // had one: it was published, and the bucket no longer lists
                // its object.
                if !self.recorded_session_records.contains(run_id) {
                    return None;
                }
                if !self.store_answers() {
                    tracing::warn!(
                        run.id = %run_id,
                        r2.key = %key,
                        "the bucket no longer lists a published run's session record and \
                         the backend store holds no run folder to say whether it holds \
                         one; the run is left unconfirmed"
                    );
                    return unconfirmed(account);
                }
                tracing::error!(
                    run.id = %run_id,
                    r2.key = %key,
                    "a published run's session record exists nowhere: the bucket no \
                     longer lists the object its manifest named and the backend store \
                     holds no copy; recorded as unrecoverable"
                );
                account
                    .files
                    .push(MediaManifestFile::unrecoverable(kind, name, None));
                None
            }
            Err(error) => {
                tracing::warn!(
                    run.id = %run_id,
                    %error,
                    "a published run's session record is in the backend store and could \
                     not be read; the run is left unconfirmed"
                );
                unconfirmed(account)
            }
        }
    }
}
