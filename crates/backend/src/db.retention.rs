//! What the [artifact reclamation sweep](crate::artifacts)'s retention rules read
//! and write on a run: the facts a rule is decided from, the record that a tree
//! was reclaimed on purpose, and a published run's media confirmation.
//!
//! Every instant here is an RFC 3339 string the caller parses and compares in Rust.
//! No query compares two of them, so SQLite and PostgreSQL cannot decide a rule
//! differently.
//!
//! A reclaimed run is recorded as not stored **and** as reclaimed, in one
//! statement. The second half is what keeps it apart from a run whose tree was
//! lost: every writer of a run's [presence](super::artifacts) leaves a reclaimed
//! run alone, and every reader of "not stored" as "lost" reads the reclaim first.
//!
//! A media confirmation holds for the bucket it was made against, for the record
//! it was made from, and for the version of the definition it was made under
//! ([`MEDIA_CONFIRMATION_VERSION`]). Every read here that reports a confirmation
//! is told which bucket the backend is configured with and reports none for any
//! other, nor for any other version, and [`Db::push`] clears the confirmation of a
//! run whose record is stored again ([`clear_retention_records`]). One function
//! decides whether a row's confirmation holds: [`confirmation_holds`].
//!
//! A confirmed run carries its [`MediaManifest`], the list of its files in the
//! bucket, written by the statement that writes the confirmation. The manifest
//! does two jobs, and they end at different moments:
//!
//! - It is the **authority for deleting**: the sweeps remove a run's tree and its
//!   files in the backend store on it, and a refresh builds the run from it
//!   without reading either. It is that only while the confirmation it was
//!   written with [holds](confirmation_holds), which the strict reads enforce
//!   ([`Db::run_media_manifest`], [`Db::confirmed_media_manifests`]).
//! - It is the **record of where the run's files are**, which the run file routes
//!   answer from once the store no longer holds a file
//!   ([`Db::run_file_locations`]). It stays that after the confirmation is
//!   withdrawn, for as long as the row names the bucket it was made in, until a
//!   later confirmation replaces it. A run whose files were removed from the
//!   store has no other pointer to them, so withdrawing a confirmation must not
//!   make them unreachable.

use std::collections::HashSet;

use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, FromQueryResult, PaginatorTrait,
    QueryFilter, QuerySelect,
};
use serde::{Deserialize, Serialize};
use test_cabinet_entities::{job, publish_job, run};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::Db;
use crate::error::Result;

/// How many run ids one statement here names; see the constant of the same
/// purpose in [`super::artifacts`].
const CHUNK: usize = 500;

/// Why the sweep deleted a run's tree on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReclaimReason {
    /// The run is published and a snapshot refresh confirmed its media in the
    /// bucket.
    Published,
    /// The run ended in a state other than completed or canceled, and its
    /// retention ran out.
    Failed,
    /// The run was canceled, and its retention ran out.
    Canceled,
}

impl ReclaimReason {
    /// The reason as the column, the wire and the log line spell it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Published => "published",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }

    /// The reason a stored column value names, or `None` for a value this build
    /// does not know.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "published" => Some(Self::Published),
            "failed" => Some(Self::Failed),
            "canceled" => Some(Self::Canceled),
            _ => None,
        }
    }
}

/// The record that a run's tree was reclaimed on purpose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactsReclaimed {
    /// RFC 3339 of the reclaim.
    pub at: String,
    /// Which retention rule reclaimed the tree.
    pub reason: ReclaimReason,
}

impl ArtifactsReclaimed {
    /// The record a run row's two columns hold, or `None` for a run that was never
    /// reclaimed. A reason this build cannot name still reads as reclaimed, as
    /// [`ReclaimReason::Failed`]: the tree is gone on purpose either way, and the
    /// alternative is to report it lost.
    pub fn from_columns(at: Option<String>, reason: Option<&str>) -> Option<Self> {
        Some(Self {
            at: at?,
            reason: reason
                .and_then(ReclaimReason::parse)
                .unwrap_or(ReclaimReason::Failed),
        })
    }
}

/// The version of the definition of "confirmed" this backend implements.
///
/// `1`, which no row carries because the column was added with version `2`,
/// covered the media a run's document references: proofs, validation media,
/// generated assets, showcase files and the code-analysis document. `2` adds the
/// recorded webm of every transcoded video, every replay of an adversarial run,
/// a performance run's scenarios and engine module, and the controller module.
/// A gg run's session record is in neither: it is never published.
///
/// A confirmation recorded under any other version, a row with no version
/// included, confirms nothing: [`confirmation_holds`] refuses it, so the sweep
/// deletes no tree on it and the next refresh evaluates the run again. Raise this
/// whenever the set of files a confirmation vouches for grows.
pub const MEDIA_CONFIRMATION_VERSION: i32 = 2;

/// Whether a run row's recorded confirmation holds for a backend configured with
/// `bucket`: the row is confirmed, against that bucket, under
/// [`MEDIA_CONFIRMATION_VERSION`]. With no bucket nothing holds.
///
/// This is the one definition of "confirmed". Every read that reports a
/// confirmation or a manifest goes through it.
pub fn confirmation_holds(
    confirmed_at: Option<&str>,
    recorded_bucket: Option<&str>,
    version: Option<i32>,
    bucket: Option<&str>,
) -> bool {
    confirmed_at.is_some()
        && bucket.is_some()
        && recorded_bucket == bucket
        && version == Some(MEDIA_CONFIRMATION_VERSION)
}

/// What kind of file a [`MediaManifestFile`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaFileKind {
    /// Proof-of-implementation media, `proof/<file>` in the store.
    Proof,
    /// Synthesized validation media and the recordings' image store,
    /// `validation/<file>`.
    Validation,
    /// Generated assets, adversarial replays, and a performance run's scenarios
    /// and engine module, `asset/<file>`.
    Asset,
    /// Showcase files, `showcase/<file>`.
    Showcase,
    /// The code-analysis document, `code-analysis.json`.
    CodeAnalysis,
    /// An adversarial run's controller module, `controller.wasm`.
    Controller,
}

/// One file of a confirmed run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaManifestFile {
    /// What kind of file this is.
    pub kind: MediaFileKind,
    /// The file's path under the run's folder in the backend store, which is also
    /// how the backend's routes name it: `proof/<file>`, `validation/<file>`,
    /// `asset/<file>`, `showcase/<file>`, `code-analysis.json` or
    /// `controller.wasm`.
    pub name: String,
    /// The object holding this file's bytes. For a transcoded video this is the
    /// verbatim recorded webm. For the code-analysis document the object is the
    /// scrubbed, uncompressed form of the stored file.
    /// `None` exactly when the file is [`unrecoverable`](Self::unrecoverable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// The mp4 a video was transcoded to, when it was. It can be present on an
    /// unrecoverable file: the recorded webm is gone and the mp4 made from it is
    /// in the bucket.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcoded_key: Option<String>,
    /// Whether the file's bytes exist nowhere: the bucket, the backend store and
    /// the artifact service each answered that they do not hold it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unrecoverable: bool,
}

impl MediaManifestFile {
    /// A file whose bytes are at `key`.
    pub fn stored(kind: MediaFileKind, name: impl Into<String>, key: impl Into<String>) -> Self {
        Self {
            kind,
            name: name.into(),
            key: Some(key.into()),
            transcoded_key: None,
            unrecoverable: false,
        }
    }

    /// A video whose recorded bytes are at `key` and whose mp4 is at
    /// `transcoded_key`.
    pub fn transcoded(
        kind: MediaFileKind,
        name: impl Into<String>,
        key: impl Into<String>,
        transcoded_key: impl Into<String>,
    ) -> Self {
        Self {
            transcoded_key: Some(transcoded_key.into()),
            ..Self::stored(kind, name, key)
        }
    }

    /// A file whose bytes exist nowhere. `transcoded_key` is the mp4 made from
    /// it, when the bucket holds one.
    pub fn unrecoverable(
        kind: MediaFileKind,
        name: impl Into<String>,
        transcoded_key: Option<String>,
    ) -> Self {
        Self {
            kind,
            name: name.into(),
            key: None,
            transcoded_key,
            unrecoverable: true,
        }
    }

    /// Every object key this file names.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.key
            .as_deref()
            .into_iter()
            .chain(self.transcoded_key.as_deref())
    }
}

/// A confirmed run's file manifest: every file of the run that is in the bucket,
/// and every file of it that exists nowhere.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaManifest {
    /// The run's files, in the order the refresh that confirmed it found them.
    pub files: Vec<MediaManifestFile>,
}

impl MediaManifest {
    /// The entry for the file the store names `name`, or `None` for a name the
    /// run has no file under.
    pub fn file(&self, name: &str) -> Option<&MediaManifestFile> {
        self.files.iter().find(|file| file.name == name)
    }

    /// The names of the files recorded as unrecoverable.
    pub fn unrecoverable(&self) -> impl Iterator<Item = &str> {
        self.files
            .iter()
            .filter(|file| file.unrecoverable)
            .map(|file| file.name.as_str())
    }

    /// Every object key the manifest names.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.files.iter().flat_map(MediaManifestFile::keys)
    }

    /// Parse the column value of run `run_id`.
    fn from_column(run_id: &str, json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|err| {
            crate::error::BackendError::Internal(format!(
                "run `{run_id}`'s media manifest does not parse: {err}"
            ))
        })
    }
}

/// A run a refresh found confirmed, with the manifest to record for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmedMedia {
    /// The run as the refresh read it before it built.
    pub state: PublishedMediaState,
    /// Every file of the run the refresh accounted for.
    pub manifest: MediaManifest,
}

/// The facts of one run the retention rules are decided from.
#[derive(Debug, Clone, PartialEq, Eq, FromQueryResult)]
pub struct RetentionRun {
    /// The run's id, which is the id its tree is stored under.
    pub id: String,
    /// The run's terminal state as its wire string.
    pub run_state: String,
    /// RFC 3339 of when the run ended.
    pub finished_at: String,
    /// Whether the run is published.
    pub published: bool,
    /// RFC 3339 of the refresh that confirmed the run's media in the bucket this
    /// backend is configured with, under [`MEDIA_CONFIRMATION_VERSION`]. `None`
    /// for a run confirmed against any other bucket or under any other version,
    /// as for one never confirmed: the reads that fill this in go through
    /// [`confirmation_holds`].
    pub media_confirmed_at: Option<String>,
    /// The run's recorded artifact presence.
    pub artifacts_stored: Option<bool>,
    /// RFC 3339 of an earlier reclaim of this run's tree.
    pub artifacts_reclaimed_at: Option<String>,
    /// The reason of that earlier reclaim.
    pub artifacts_reclaimed_reason: Option<String>,
    /// RFC 3339 of an earlier reclaim of this run's files in the backend's own
    /// store ([`crate::state_reclaim`]).
    pub state_reclaimed_at: Option<String>,
    /// The reason of that earlier reclaim.
    pub state_reclaimed_reason: Option<String>,
}

impl RetentionRun {
    /// Whether the backend's record says the artifact service holds no tree for
    /// the run: the sweep reclaimed it, or the run's presence is recorded as not
    /// stored. An unknown presence is not this.
    pub fn tree_recorded_absent(&self) -> bool {
        self.artifacts_reclaimed_at.is_some() || self.artifacts_stored == Some(false)
    }
}

/// A [`RetentionRun`] as stored, with the bucket its confirmation names.
#[derive(Debug, FromQueryResult)]
struct RetentionRow {
    id: String,
    run_state: String,
    finished_at: String,
    published: bool,
    media_confirmed_at: Option<String>,
    media_bucket: Option<String>,
    media_confirmation_version: Option<i32>,
    artifacts_stored: Option<bool>,
    artifacts_reclaimed_at: Option<String>,
    artifacts_reclaimed_reason: Option<String>,
    state_reclaimed_at: Option<String>,
    state_reclaimed_reason: Option<String>,
}

impl RetentionRow {
    /// The run's facts for a backend configured with `bucket`: its confirmation
    /// is reported only when it [holds](confirmation_holds) there.
    fn for_bucket(self, bucket: Option<&str>) -> RetentionRun {
        let confirmed_here = confirmation_holds(
            self.media_confirmed_at.as_deref(),
            self.media_bucket.as_deref(),
            self.media_confirmation_version,
            bucket,
        );
        RetentionRun {
            id: self.id,
            run_state: self.run_state,
            finished_at: self.finished_at,
            published: self.published,
            media_confirmed_at: self.media_confirmed_at.filter(|_| confirmed_here),
            artifacts_stored: self.artifacts_stored,
            artifacts_reclaimed_at: self.artifacts_reclaimed_at,
            artifacts_reclaimed_reason: self.artifacts_reclaimed_reason,
            state_reclaimed_at: self.state_reclaimed_at,
            state_reclaimed_reason: self.state_reclaimed_reason,
        }
    }
}

/// What a snapshot refresh reads about one published run before it builds: the
/// state its confirmation is recorded against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedMediaState {
    /// The run's id.
    pub id: String,
    /// The run's mutation timestamp as read. A confirmation is written only while
    /// the row still carries it, which is a run nothing has changed since.
    pub updated_at: String,
    /// Whether the run's confirmation [holds](confirmation_holds) in the
    /// configured bucket.
    pub confirmed: bool,
    /// Whether the run's tree was reclaimed.
    pub reclaimed: bool,
    /// Whether the backend's own record says the artifact service holds no tree
    /// for the run: the tree was reclaimed, or the run's presence is recorded as
    /// not stored. A refresh takes the service's answer that it holds no tree as
    /// an answer about the run's files only when this agrees with it.
    pub tree_recorded_absent: bool,
}

impl PublishedMediaState {
    /// Whether nothing about the run's media is left to decide: it is confirmed in
    /// the configured bucket and its tree is reclaimed. A refresh neither asks the
    /// artifact service about such a run nor changes its confirmation.
    pub fn settled(&self) -> bool {
        self.confirmed && self.reclaimed
    }
}

/// What one [`Db::record_media_confirmation`] changed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct MediaConfirmation {
    /// Runs newly recorded as confirmed.
    pub confirmed: u64,
    /// Runs whose earlier confirmation was withdrawn.
    pub withdrawn: u64,
    /// Runs found confirmed that were not recorded, because the run changed
    /// between the refresh reading it and this write. The next refresh evaluates
    /// them.
    pub changed: u64,
}

/// The select every [`RetentionRun`] read uses.
fn retention_select() -> sea_orm::Select<run::Entity> {
    run::Entity::find().select_only().columns([
        run::Column::Id,
        run::Column::RunState,
        run::Column::FinishedAt,
        run::Column::Published,
        run::Column::MediaConfirmedAt,
        run::Column::MediaBucket,
        run::Column::MediaConfirmationVersion,
        run::Column::ArtifactsStored,
        run::Column::ArtifactsReclaimedAt,
        run::Column::ArtifactsReclaimedReason,
        run::Column::StateReclaimedAt,
        run::Column::StateReclaimedReason,
    ])
}

/// The runs whose recorded media evaluation was not made against `bucket` under
/// [`MEDIA_CONFIRMATION_VERSION`]: never evaluated, evaluated against another
/// bucket, or evaluated under another version of the definition.
fn not_evaluated_in(bucket: &str) -> Condition {
    Condition::any()
        .add(run::Column::MediaCheckedAt.is_null())
        .add(run::Column::MediaBucket.is_null())
        .add(run::Column::MediaBucket.ne(bucket))
        .add(run::Column::MediaConfirmationVersion.is_null())
        .add(run::Column::MediaConfirmationVersion.ne(MEDIA_CONFIRMATION_VERSION))
}

/// Clear what the sweep and the refresh recorded about run `run_id`, because its
/// record is being stored again. [`Db::push`] calls this for a run that already
/// had a row, inside its transaction.
///
/// The media confirmation was made from the record the push replaces, so it says
/// nothing about the new one: cleared, the run must be confirmed again before
/// its tree qualifies for the `published` rule. Without this the sweep would
/// delete the tree a re-push uploaded on the strength of a confirmation of the
/// old record, before any refresh had read the new one.
///
/// The manifest and the bucket it names are kept. They no longer authorize
/// anything, since no confirmation holds, and they are still where the files of
/// the run's earlier record are: a run whose files the state sweep removed is
/// served from them until a refresh has confirmed the new record and written a
/// new manifest. A file the push's driver mirrored again is in the store, which
/// the routes read first.
///
/// A reclaim record (`was_reclaimed`) is cleared too. A push follows a driver
/// that ran the run again and uploaded its tree again, so the run is no longer
/// one with no tree on purpose. Its presence goes back to unknown, and the
/// driver's report or the sweep's next reconciliation records what is there.
pub(super) async fn clear_retention_records<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
    was_reclaimed: bool,
) -> Result<()> {
    let none = || Expr::value(Option::<String>::None);
    let mut update = run::Entity::update_many()
        .col_expr(run::Column::MediaConfirmedAt, none())
        .col_expr(run::Column::MediaCheckedAt, none())
        .col_expr(
            run::Column::MediaConfirmationVersion,
            Expr::value(Option::<i32>::None),
        )
        // The push follows a driver that mirrored the run's files into the
        // backend store again, so the run is no longer one whose files there
        // were removed on purpose.
        .col_expr(run::Column::StateReclaimedAt, none())
        .col_expr(run::Column::StateReclaimedReason, none());
    if was_reclaimed {
        update = update
            .col_expr(run::Column::ArtifactsReclaimedAt, none())
            .col_expr(run::Column::ArtifactsReclaimedReason, none())
            .col_expr(
                run::Column::ArtifactsStored,
                Expr::value(Option::<bool>::None),
            );
    }
    update.filter(run::Column::Id.eq(run_id)).exec(conn).await?;
    Ok(())
}

impl Db {
    /// Every stored run's retention facts, published and pending alike.
    ///
    /// The ids of this set are the live set the sweep's orphan rule protects a
    /// tree with, so one read serves both the orphan rule and the retention rules.
    ///
    /// `bucket` is the bucket this backend is configured with, as
    /// [`media_bucket_identity`](crate::artifacts::media_bucket_identity) names it. A
    /// confirmation made against any other is not reported, and with no bucket
    /// none is.
    pub async fn retention_runs(&self, bucket: Option<&str>) -> Result<Vec<RetentionRun>> {
        Ok(retention_select()
            .into_model::<RetentionRow>()
            .all(&self.conn())
            .await?
            .into_iter()
            .map(|row| row.for_bucket(bucket))
            .collect())
    }

    /// Run `run_id`'s retention facts as they are now, or `None` for a run that no
    /// longer exists. The sweep reads this immediately before it deletes a tree.
    /// `bucket` is as for [`retention_runs`](Self::retention_runs).
    pub async fn retention_run(
        &self,
        run_id: &str,
        bucket: Option<&str>,
    ) -> Result<Option<RetentionRun>> {
        Ok(retention_select()
            .filter(run::Column::Id.eq(run_id))
            .into_model::<RetentionRow>()
            .one(&self.conn())
            .await?
            .map(|row| row.for_bucket(bucket)))
    }

    /// The ids of the runs something is still working on: a job that names the run
    /// is queued, running or storing, or a publish job for it is queued or
    /// dispatched. `now` is the RFC 3339 instant a dispatched publish job's
    /// staleness is measured against, by the rule the publish gate uses.
    pub async fn busy_run_ids(&self, now: &str) -> Result<HashSet<String>> {
        let mut busy: HashSet<String> = job::Entity::find()
            .select_only()
            .column(job::Column::RecordId)
            .filter(job::Column::State.is_in(super::IN_FLIGHT_STATES))
            .filter(job::Column::RecordId.is_not_null())
            .into_tuple::<Option<String>>()
            .all(&self.conn())
            .await?
            .into_iter()
            .flatten()
            .collect();
        let publishing = publish_job::Entity::find()
            .filter(publish_job::Column::State.is_in(super::ACTIVE_PUBLISH_STATES))
            .all(&self.conn())
            .await?;
        busy.extend(
            publishing
                .into_iter()
                .filter(|job| !super::is_abandoned_publish_job(job, now))
                .map(|job| job.run_id),
        );
        Ok(busy)
    }

    /// Whether something is still working on run `run_id`, by the rule of
    /// [`busy_run_ids`](Self::busy_run_ids), read now.
    pub async fn run_is_busy(&self, run_id: &str, now: &str) -> Result<bool> {
        let in_flight = job::Entity::find()
            .filter(job::Column::RecordId.eq(run_id))
            .filter(job::Column::State.is_in(super::IN_FLIGHT_STATES))
            .count(&self.conn())
            .await?;
        if in_flight > 0 {
            return Ok(true);
        }
        Ok(self
            .active_publish_job_for_run(run_id, now)
            .await?
            .is_some())
    }

    /// Record that run `seen.id`'s tree is being reclaimed for `reason` at `at`,
    /// which also records the tree as not stored. Returns whether the row was
    /// written.
    ///
    /// The statement names the published flag and the state `seen` was decided
    /// from, so a run that was published, or re-pushed in another state, between
    /// the read and this write is left alone and reports `false`.
    ///
    /// The run's mutation timestamp is stamped for a failed or canceled run, whose
    /// page and listing row change with the reclaim. A published run reads the same
    /// to every console before and after, so its timestamp is left alone and a
    /// first pass over a cabinet of published runs does not tell every follower of
    /// the timestamp that all of them changed.
    pub async fn mark_artifacts_reclaimed(
        &self,
        seen: &RetentionRun,
        reason: ReclaimReason,
        at: &str,
    ) -> Result<bool> {
        let mut update = run::Entity::update_many()
            .col_expr(run::Column::ArtifactsReclaimedAt, Expr::value(at))
            .col_expr(
                run::Column::ArtifactsReclaimedReason,
                Expr::value(reason.as_str()),
            )
            .col_expr(run::Column::ArtifactsStored, Expr::value(false));
        if reason != ReclaimReason::Published {
            update = update.col_expr(run::Column::UpdatedAt, Expr::value(at));
        }
        let res = update
            .filter(run::Column::Id.eq(seen.id.as_str()))
            .filter(run::Column::Published.eq(seen.published))
            .filter(run::Column::RunState.eq(seen.run_state.as_str()))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Put run `seen.id`'s presence and reclaim record back to what `seen` held,
    /// after the artifact service refused the delete that the mark written at `at`
    /// announced. Only a row still carrying that mark is written.
    pub async fn restore_artifact_record(&self, seen: &RetentionRun, at: &str) -> Result<bool> {
        let res = run::Entity::update_many()
            .col_expr(
                run::Column::ArtifactsReclaimedAt,
                Expr::value(seen.artifacts_reclaimed_at.clone()),
            )
            .col_expr(
                run::Column::ArtifactsReclaimedReason,
                Expr::value(seen.artifacts_reclaimed_reason.clone()),
            )
            .col_expr(
                run::Column::ArtifactsStored,
                Expr::value(seen.artifacts_stored),
            )
            .filter(run::Column::Id.eq(seen.id.as_str()))
            .filter(run::Column::ArtifactsReclaimedAt.eq(at))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Run `run_id`'s reclaim record: `None` for a run whose tree was never
    /// reclaimed, and for a run that does not exist.
    pub async fn run_artifacts_reclaimed(
        &self,
        run_id: &str,
    ) -> Result<Option<ArtifactsReclaimed>> {
        let columns: Option<(Option<String>, Option<String>)> =
            run::Entity::find_by_id(run_id.to_string())
                .select_only()
                .column(run::Column::ArtifactsReclaimedAt)
                .column(run::Column::ArtifactsReclaimedReason)
                .into_tuple()
                .one(&self.conn())
                .await?;
        Ok(
            columns
                .and_then(|(at, reason)| ArtifactsReclaimed::from_columns(at, reason.as_deref())),
        )
    }

    /// What a refresh reads about every published run before it builds, for a
    /// backend configured with `bucket`. Read **before** the runs' records, so each
    /// mutation timestamp here is no newer than the record the refresh evaluates.
    pub async fn published_media_states(&self, bucket: &str) -> Result<Vec<PublishedMediaState>> {
        /// One published run's columns, as selected below.
        #[derive(FromQueryResult)]
        struct Row {
            id: String,
            updated_at: String,
            media_confirmed_at: Option<String>,
            media_bucket: Option<String>,
            media_confirmation_version: Option<i32>,
            artifacts_stored: Option<bool>,
            artifacts_reclaimed_at: Option<String>,
        }
        let rows = run::Entity::find()
            .select_only()
            .columns([
                run::Column::Id,
                run::Column::UpdatedAt,
                run::Column::MediaConfirmedAt,
                run::Column::MediaBucket,
                run::Column::MediaConfirmationVersion,
                run::Column::ArtifactsStored,
                run::Column::ArtifactsReclaimedAt,
            ])
            .filter(run::Column::Published.eq(true))
            .into_model::<Row>()
            .all(&self.conn())
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| PublishedMediaState {
                id: row.id,
                updated_at: row.updated_at,
                confirmed: confirmation_holds(
                    row.media_confirmed_at.as_deref(),
                    row.media_bucket.as_deref(),
                    row.media_confirmation_version,
                    Some(bucket),
                ),
                reclaimed: row.artifacts_reclaimed_at.is_some(),
                tree_recorded_absent: row.artifacts_reclaimed_at.is_some()
                    || row.artifacts_stored == Some(false),
            })
            .collect())
    }

    /// Record what one snapshot refresh, uploaded at `at` to `bucket`, found about
    /// the media of the published runs it evaluated: each of `confirmed` has every
    /// one of its files in the bucket, and each of `unconfirmed` does not.
    ///
    /// A run is confirmed only while its row still carries the mutation timestamp
    /// the refresh read before it built ([`PublishedMediaState::updated_at`]). A
    /// run stored again, reviewed or otherwise changed in between is left as it
    /// was and counted in [`MediaConfirmation::changed`]: the refresh evaluated a
    /// record that may no longer be the run's, and the caller asks for another.
    ///
    /// A confirmation is written in one statement with the run's
    /// [manifest](ConfirmedMedia::manifest) and [`MEDIA_CONFIRMATION_VERSION`].
    ///
    /// A run found unconfirmed loses any confirmation it had, whichever bucket or
    /// version it named. Its manifest stays as the record of where its files are
    /// when it was made in `bucket`, and is cleared when it was made in another:
    /// the row is about to name `bucket`, and a manifest must never be read
    /// against a bucket other than its own. Both lists are recorded as
    /// evaluated against `bucket` under the current version. Only published runs
    /// are written, and only rows the write changes, so a steady state writes
    /// nothing. No statement stamps a run's mutation timestamp: nothing a console
    /// shows has changed.
    pub async fn record_media_confirmation(
        &self,
        confirmed: &[ConfirmedMedia],
        unconfirmed: &[String],
        at: &str,
        bucket: &str,
    ) -> Result<MediaConfirmation> {
        let mut outcome = MediaConfirmation::default();
        for ConfirmedMedia {
            state: run,
            manifest,
        } in confirmed
        {
            // Already confirmed here: nothing to write.
            if run.confirmed {
                continue;
            }
            let manifest = serde_json::to_string(manifest)?;
            let res = run::Entity::update_many()
                .col_expr(run::Column::MediaConfirmedAt, Expr::value(at))
                .col_expr(run::Column::MediaCheckedAt, Expr::value(at))
                .col_expr(run::Column::MediaBucket, Expr::value(bucket))
                .col_expr(
                    run::Column::MediaConfirmationVersion,
                    Expr::value(MEDIA_CONFIRMATION_VERSION),
                )
                .col_expr(run::Column::MediaManifest, Expr::value(manifest))
                .filter(run::Column::Id.eq(run.id.as_str()))
                .filter(run::Column::Published.eq(true))
                .filter(run::Column::UpdatedAt.eq(run.updated_at.as_str()))
                .exec(&self.conn())
                .await?;
            if res.rows_affected > 0 {
                outcome.confirmed += 1;
            } else {
                outcome.changed += 1;
            }
        }
        for chunk in unconfirmed.chunks(CHUNK) {
            let ids = || chunk.iter().map(String::as_str);
            let res = run::Entity::update_many()
                .col_expr(
                    run::Column::MediaConfirmedAt,
                    Expr::value(Option::<String>::None),
                )
                .filter(run::Column::Id.is_in(ids()))
                .filter(run::Column::Published.eq(true))
                .filter(run::Column::MediaConfirmedAt.is_not_null())
                .exec(&self.conn())
                .await?;
            outcome.withdrawn += res.rows_affected;
            run::Entity::update_many()
                .col_expr(
                    run::Column::MediaManifest,
                    Expr::value(Option::<String>::None),
                )
                .filter(run::Column::Id.is_in(ids()))
                .filter(run::Column::Published.eq(true))
                .filter(run::Column::MediaManifest.is_not_null())
                .filter(
                    Condition::any()
                        .add(run::Column::MediaBucket.is_null())
                        .add(run::Column::MediaBucket.ne(bucket)),
                )
                .exec(&self.conn())
                .await?;
            run::Entity::update_many()
                .col_expr(run::Column::MediaCheckedAt, Expr::value(at))
                .col_expr(run::Column::MediaBucket, Expr::value(bucket))
                .col_expr(
                    run::Column::MediaConfirmationVersion,
                    Expr::value(MEDIA_CONFIRMATION_VERSION),
                )
                .filter(run::Column::Id.is_in(ids()))
                .filter(run::Column::Published.eq(true))
                .filter(not_evaluated_in(bucket))
                .exec(&self.conn())
                .await?;
        }
        Ok(outcome)
    }

    /// Run `run_id`'s file manifest, for a backend configured with `bucket`.
    ///
    /// `Ok(None)` for a run whose confirmation does not
    /// [hold](confirmation_holds) there, and for a run that does not exist: a
    /// manifest is the authority for deleting a run's files, and for building
    /// the run without reading them, only while the confirmation it was
    /// recorded with holds. An error for a confirmed run whose manifest is
    /// missing or does not parse, which a caller must not take for a run with no
    /// files.
    ///
    /// A route that only needs to know where a file is reads
    /// [`run_file_locations`](Self::run_file_locations).
    pub async fn run_media_manifest(
        &self,
        run_id: &str,
        bucket: Option<&str>,
    ) -> Result<Option<MediaManifest>> {
        let row = manifest_select()
            .filter(run::Column::Id.eq(run_id))
            .into_model::<ManifestRow>()
            .one(&self.conn())
            .await?;
        row.map_or(Ok(None), |row| row.for_bucket(bucket))
            .map(|found| found.map(|(_, manifest)| manifest))
    }

    /// The file manifest of every run whose confirmation
    /// [holds](confirmation_holds) for a backend configured with `bucket`, by run
    /// id. Runs confirmed elsewhere or under another version are left out. An
    /// error when any confirmed run's manifest is missing or does not parse.
    pub async fn confirmed_media_manifests(
        &self,
        bucket: Option<&str>,
    ) -> Result<Vec<(String, MediaManifest)>> {
        let rows = manifest_select()
            .filter(run::Column::MediaConfirmedAt.is_not_null())
            .into_model::<ManifestRow>()
            .all(&self.conn())
            .await?;
        let mut manifests = Vec::new();
        for row in rows {
            if let Some(found) = row.for_bucket(bucket)? {
                manifests.push(found);
            }
        }
        Ok(manifests)
    }

    /// Where run `run_id`'s files are in `bucket`: the manifest the run's last
    /// confirmation there recorded, whether or not that confirmation still holds.
    ///
    /// `Ok(None)` with no bucket, for a run with no manifest, for one whose
    /// manifest was made in another bucket, and for a run that does not exist. An
    /// error for a manifest that does not parse.
    ///
    /// This is what a route serves a file from when the store does not hold it.
    /// It decides no deletion: a manifest read here may be older than the run's
    /// record, and may lack a file uploaded since.
    pub async fn run_file_locations(
        &self,
        run_id: &str,
        bucket: Option<&str>,
    ) -> Result<Option<MediaManifest>> {
        let row = manifest_select()
            .filter(run::Column::Id.eq(run_id))
            .into_model::<ManifestRow>()
            .one(&self.conn())
            .await?;
        row.map_or(Ok(None), |row| row.located_in(bucket))
            .map(|found| found.map(|(_, manifest)| manifest))
    }

    /// Where the files of the runs in `run_ids` are in `bucket`, by run id, by the
    /// rule of [`run_file_locations`](Self::run_file_locations). A run with no
    /// manifest there has no entry.
    ///
    /// For a listing that offers what the bucket can supply, so one damaged row
    /// costs its own run and not the listing: a run whose manifest does not parse
    /// is logged at `error` and left out, where
    /// [`run_file_locations`](Self::run_file_locations) reports the error.
    pub async fn file_locations_of(
        &self,
        run_ids: &[String],
        bucket: Option<&str>,
    ) -> Result<std::collections::HashMap<String, MediaManifest>> {
        let mut manifests = std::collections::HashMap::new();
        if bucket.is_none() {
            return Ok(manifests);
        }
        for chunk in run_ids.chunks(CHUNK) {
            let rows = manifest_select()
                .filter(run::Column::Id.is_in(chunk.iter().map(String::as_str)))
                .filter(run::Column::MediaManifest.is_not_null())
                .into_model::<ManifestRow>()
                .all(&self.conn())
                .await?;
            for row in rows {
                match row.located_in(bucket) {
                    Ok(Some((id, manifest))) => {
                        manifests.insert(id, manifest);
                    }
                    Ok(None) => {}
                    Err(err) => tracing::error!("{err}; leaving the run out"),
                }
            }
        }
        Ok(manifests)
    }

    /// How many published runs a refresh evaluated against `bucket` under
    /// [`MEDIA_CONFIRMATION_VERSION`] and left unconfirmed. Counted over the
    /// readable runs, as [`published_runs_unchecked`](Self::published_runs_unchecked)
    /// is.
    ///
    /// A run is left unconfirmed for a reason that may pass (the artifact
    /// service was restarting, a transcode failed) or may not. Nothing else
    /// evaluates such a run again until some unrelated change requests a
    /// refresh, so the publisher asks for one while this is not zero.
    pub async fn published_runs_unconfirmed(&self, bucket: &str) -> Result<u64> {
        Ok(super::readable_runs()
            .filter(run::Column::Published.eq(true))
            .filter(run::Column::MediaConfirmedAt.is_null())
            .filter(run::Column::MediaCheckedAt.is_not_null())
            .filter(run::Column::MediaBucket.eq(bucket))
            .filter(run::Column::MediaConfirmationVersion.eq(MEDIA_CONFIRMATION_VERSION))
            .count(&self.conn())
            .await?)
    }

    /// How many published runs no snapshot refresh has evaluated the media of
    /// against `bucket` under [`MEDIA_CONFIRMATION_VERSION`].
    ///
    /// Counted over the runs a refresh includes, which are the readable ones: a
    /// published run whose record no longer reads is in no snapshot, so no refresh
    /// would ever evaluate it and counting it would ask for one at every start.
    pub async fn published_runs_unchecked(&self, bucket: &str) -> Result<u64> {
        Ok(super::readable_runs()
            .filter(run::Column::Published.eq(true))
            .filter(not_evaluated_in(bucket))
            .count(&self.conn())
            .await?)
    }
}

/// The select the manifest reads use.
fn manifest_select() -> sea_orm::Select<run::Entity> {
    run::Entity::find().select_only().columns([
        run::Column::Id,
        run::Column::MediaConfirmedAt,
        run::Column::MediaBucket,
        run::Column::MediaConfirmationVersion,
        run::Column::MediaManifest,
    ])
}

/// One run's confirmation and manifest columns.
#[derive(Debug, FromQueryResult)]
struct ManifestRow {
    id: String,
    media_confirmed_at: Option<String>,
    media_bucket: Option<String>,
    media_confirmation_version: Option<i32>,
    media_manifest: Option<String>,
}

impl ManifestRow {
    /// The run's id and manifest when its confirmation holds for `bucket`.
    fn for_bucket(self, bucket: Option<&str>) -> Result<Option<(String, MediaManifest)>> {
        if !confirmation_holds(
            self.media_confirmed_at.as_deref(),
            self.media_bucket.as_deref(),
            self.media_confirmation_version,
            bucket,
        ) {
            return Ok(None);
        }
        let Some(json) = self.media_manifest.as_deref() else {
            return Err(crate::error::BackendError::Internal(format!(
                "run `{}` is confirmed and has no media manifest",
                self.id
            )));
        };
        let manifest = MediaManifest::from_column(&self.id, json)?;
        Ok(Some((self.id, manifest)))
    }

    /// The run's id and manifest when the manifest was made in `bucket`,
    /// whatever became of the confirmation it was made with.
    fn located_in(self, bucket: Option<&str>) -> Result<Option<(String, MediaManifest)>> {
        let Some(json) = self.media_manifest.as_deref() else {
            return Ok(None);
        };
        if bucket.is_none() || self.media_bucket.as_deref() != bucket {
            return Ok(None);
        }
        let manifest = MediaManifest::from_column(&self.id, json)?;
        Ok(Some((self.id, manifest)))
    }
}

/// Parse an RFC 3339 instant that must lie at or before `now` to count.
///
/// `None` for a value that is absent, does not parse, or lies in the future. A
/// retention rule measures from such an instant, and each of the three is a value
/// it cannot measure from, so none of them ever qualifies a tree for deletion.
pub fn past_instant(value: Option<&str>, now: OffsetDateTime) -> Option<OffsetDateTime> {
    let at = OffsetDateTime::parse(value?, &Rfc3339).ok()?;
    (at <= now).then_some(at)
}
