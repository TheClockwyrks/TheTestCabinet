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
//! A media confirmation holds for the bucket it was made against and for the
//! record it was made from. Every read here that reports a confirmation is told
//! which bucket the backend is configured with and reports none for any other,
//! and [`Db::push`] clears the confirmation of a run whose record is stored again
//! ([`clear_retention_records`]).

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
    /// backend is configured with. `None` for a run confirmed against any other
    /// bucket, as for one never confirmed: the reads that fill this in are told
    /// the configured bucket and report no other's confirmation.
    pub media_confirmed_at: Option<String>,
    /// The run's recorded artifact presence.
    pub artifacts_stored: Option<bool>,
    /// RFC 3339 of an earlier reclaim of this run's tree.
    pub artifacts_reclaimed_at: Option<String>,
    /// The reason of that earlier reclaim.
    pub artifacts_reclaimed_reason: Option<String>,
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
    artifacts_stored: Option<bool>,
    artifacts_reclaimed_at: Option<String>,
    artifacts_reclaimed_reason: Option<String>,
}

impl RetentionRow {
    /// The run's facts for a backend configured with `bucket`: its confirmation
    /// is reported only when it was made against that bucket.
    fn for_bucket(self, bucket: Option<&str>) -> RetentionRun {
        let confirmed_here = bucket.is_some() && self.media_bucket.as_deref() == bucket;
        RetentionRun {
            id: self.id,
            run_state: self.run_state,
            finished_at: self.finished_at,
            published: self.published,
            media_confirmed_at: self.media_confirmed_at.filter(|_| confirmed_here),
            artifacts_stored: self.artifacts_stored,
            artifacts_reclaimed_at: self.artifacts_reclaimed_at,
            artifacts_reclaimed_reason: self.artifacts_reclaimed_reason,
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
    /// Whether the run is confirmed in the configured bucket.
    pub confirmed: bool,
    /// Whether the run's tree was reclaimed.
    pub reclaimed: bool,
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
        run::Column::ArtifactsStored,
        run::Column::ArtifactsReclaimedAt,
        run::Column::ArtifactsReclaimedReason,
    ])
}

/// The runs whose recorded media evaluation was not made against `bucket`: never
/// evaluated, or evaluated against another bucket.
fn not_evaluated_in(bucket: &str) -> Condition {
    Condition::any()
        .add(run::Column::MediaCheckedAt.is_null())
        .add(run::Column::MediaBucket.is_null())
        .add(run::Column::MediaBucket.ne(bucket))
}

/// Clear what the sweep and the refresh recorded about run `run_id`, because its
/// record is being stored again. [`Db::push`] calls this for a run that already
/// had a row, inside its transaction.
///
/// The media confirmation was made from the record the push replaces, so it says
/// nothing about the new one: cleared, the run must be confirmed again before its
/// tree qualifies for the `published` rule. Without this the sweep would delete
/// the tree a re-push uploaded on the strength of a confirmation of the old
/// record, before any refresh had read the new one.
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
        .col_expr(run::Column::MediaBucket, none());
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
            artifacts_reclaimed_at: Option<String>,
        }
        let rows = run::Entity::find()
            .select_only()
            .columns([
                run::Column::Id,
                run::Column::UpdatedAt,
                run::Column::MediaConfirmedAt,
                run::Column::MediaBucket,
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
                confirmed: row.media_confirmed_at.is_some()
                    && row.media_bucket.as_deref() == Some(bucket),
                reclaimed: row.artifacts_reclaimed_at.is_some(),
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
    /// A run found unconfirmed loses any confirmation it had, whichever bucket it
    /// named. Both lists are recorded as evaluated against `bucket`. Only
    /// published runs are written, and only rows the write changes, so a steady
    /// state writes nothing. No statement stamps a run's mutation timestamp:
    /// nothing a console shows has changed.
    pub async fn record_media_confirmation(
        &self,
        confirmed: &[PublishedMediaState],
        unconfirmed: &[String],
        at: &str,
        bucket: &str,
    ) -> Result<MediaConfirmation> {
        let mut outcome = MediaConfirmation::default();
        for run in confirmed {
            // Already confirmed here: nothing to write.
            if run.confirmed {
                continue;
            }
            let res = run::Entity::update_many()
                .col_expr(run::Column::MediaConfirmedAt, Expr::value(at))
                .col_expr(run::Column::MediaCheckedAt, Expr::value(at))
                .col_expr(run::Column::MediaBucket, Expr::value(bucket))
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
                .col_expr(run::Column::MediaCheckedAt, Expr::value(at))
                .col_expr(run::Column::MediaBucket, Expr::value(bucket))
                .filter(run::Column::Id.is_in(ids()))
                .filter(run::Column::Published.eq(true))
                .filter(not_evaluated_in(bucket))
                .exec(&self.conn())
                .await?;
        }
        Ok(outcome)
    }

    /// How many published runs no snapshot refresh has evaluated the media of
    /// against `bucket`.
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

/// Parse an RFC 3339 instant that must lie at or before `now` to count.
///
/// `None` for a value that is absent, does not parse, or lies in the future. A
/// retention rule measures from such an instant, and each of the three is a value
/// it cannot measure from, so none of them ever qualifies a tree for deletion.
pub fn past_instant(value: Option<&str>, now: OffsetDateTime) -> Option<OffsetDateTime> {
    let at = OffsetDateTime::parse(value?, &Rfc3339).ok()?;
    (at <= now).then_some(at)
}
