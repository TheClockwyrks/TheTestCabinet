//! What the retry of failed publishes (`crate::api::publish_retry`) and the
//! [publish-failure hold](crate::publish_health) read and write: the publish jobs
//! of the unpublished runs, and the end of a publish job whose publisher never
//! reported.
//!
//! Every instant is an RFC 3339 string parsed and compared in Rust, as in
//! [`super::retention`], so SQLite and PostgreSQL order the jobs alike. The one
//! ordering a query does here only narrows a read whose rows are then ordered in
//! Rust.

use std::collections::HashSet;

use sea_orm::sea_query::{Expr, Query};
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use test_cabinet_entities::{publish_job, review, run};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::Db;
use crate::error::Result;
use crate::publish_health::PublishFacts;

/// How many of the most recently updated succeeded publish jobs are read to find
/// the latest one. The column orders as text, which can misplace two instants
/// within one second of each other, so a handful are read and compared as
/// instants.
const LATEST_SUCCESS_SAMPLE: u64 = 16;

/// The reason recorded on a publish job whose publisher never reported.
pub const PUBLISHER_NEVER_REPORTED: &str =
    "the publisher did not report a result within an hour of being dispatched";

impl Db {
    /// The publish job table as the [publish rules](crate::publish_health::assess)
    /// read it: every publish job of every unpublished run, which of those runs can
    /// still be released, and when a publish last succeeded.
    ///
    /// A published run's jobs are left out. Its failures are behind it, and its
    /// success is what [`PublishFacts::last_success`] carries.
    pub async fn publish_facts(&self) -> Result<PublishFacts> {
        let unpublished = Query::select()
            .column(run::Column::Id)
            .from(run::Entity)
            .and_where(run::Column::Published.eq(false))
            .to_owned();
        let jobs = publish_job::Entity::find()
            .filter(publish_job::Column::RunId.in_subquery(unpublished))
            .all(&self.conn())
            .await?;

        let releasable = self.releasable_runs().await?;

        let successes: Vec<String> = publish_job::Entity::find()
            .select_only()
            .column(publish_job::Column::UpdatedAt)
            .filter(publish_job::Column::State.eq("succeeded"))
            .order_by_desc(publish_job::Column::UpdatedAt)
            .limit(LATEST_SUCCESS_SAMPLE)
            .into_tuple()
            .all(&self.conn())
            .await?;
        let last_success = successes
            .iter()
            .filter_map(|at| OffsetDateTime::parse(at, &Rfc3339).ok())
            .max();

        Ok(PublishFacts {
            jobs,
            releasable,
            last_success,
        })
    }

    /// The unpublished runs with a publish job that can still be released, which
    /// are the runs the retry takes up and the hold counts.
    ///
    /// A run is one while it exists, its tree is neither reclaimed nor recorded as
    /// not stored, it is not an attempt an automatic retry replaced, and it passes
    /// the publish gate as the run stands now: a publishable state, and for a
    /// completed run its validators' rating, a review, or the automated verdicts
    /// a comparison's run is published on. The gate is the widest one a publish
    /// job can have been enqueued through, since the table does not say which of
    /// them a job came through.
    ///
    /// Applying the gate here, and not only where a job is enqueued, is what keeps
    /// a run that stopped being publishable after its publish failed from being
    /// released by the backend, and from holding a queue that no probe could then
    /// release.
    async fn releasable_runs(&self) -> Result<HashSet<String>> {
        let with_jobs = Query::select()
            .column(publish_job::Column::RunId)
            .from(publish_job::Entity)
            .to_owned();
        let rows: Vec<(String, String, bool)> = run::Entity::find()
            .select_only()
            .column(run::Column::Id)
            .column(run::Column::RunState)
            .column(run::Column::ValidatorRated)
            .filter(run::Column::Published.eq(false))
            .filter(run::Column::ArtifactsReclaimedAt.is_null())
            .filter(
                Condition::any()
                    .add(run::Column::ArtifactsStored.is_null())
                    .add(run::Column::ArtifactsStored.eq(true)),
            )
            .filter(run::Column::Id.in_subquery(with_jobs))
            .filter(super::not_a_retried_attempt())
            .into_tuple()
            .all(&self.conn())
            .await?;

        let never = super::never_publishable_states();
        let failures = super::publishable_failure_states();
        let mut releasable = HashSet::new();
        // The completed runs no validator rated, which need a review or automated
        // verdicts to stand in for one.
        let mut unrated: Vec<String> = Vec::new();
        for (id, run_state, validator_rated) in rows {
            if never.contains(&run_state.as_str()) {
                continue;
            }
            if validator_rated || failures.contains(&run_state.as_str()) {
                releasable.insert(id);
            } else {
                unrated.push(id);
            }
        }
        for chunk in unrated.chunks(500) {
            let reviewed: HashSet<String> = review::Entity::find()
                .select_only()
                .column(review::Column::RunId)
                .filter(review::Column::RunId.is_in(chunk.iter().map(String::as_str)))
                .into_tuple::<String>()
                .all(&self.conn())
                .await?
                .into_iter()
                .collect();
            for id in chunk {
                if reviewed.contains(id) || super::run_has_auto_verdicts(&self.conn(), id).await? {
                    releasable.insert(id.clone());
                }
            }
        }
        Ok(releasable)
    }

    /// Remove publish job `job_id` while it is still `queued`, returning whether
    /// it was removed. For the [publish gate](crate::api), which enqueues a job and
    /// then finds the run's tree was reclaimed in the same instant: the job never
    /// started, so it leaves no failure behind and counts toward no hold. A job the
    /// dispatcher has claimed is left alone.
    pub async fn withdraw_queued_publish_job(&self, job_id: &str) -> Result<bool> {
        let res = publish_job::Entity::delete_many()
            .filter(publish_job::Column::Id.eq(job_id))
            .filter(publish_job::Column::State.eq("queued"))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Record every `dispatched` publish job that has gone quiet for an hour as
    /// failed, with [`PUBLISHER_NEVER_REPORTED`] as its reason, and return the jobs
    /// as they now stand. `now` is the instant the hour is measured against.
    ///
    /// Such a job's publisher died before reporting, and nothing else ends it. As a
    /// failed job it is retried and counted like any other failure. The write names
    /// the state and instant it was decided from, so a result that lands between
    /// the read and the write is left as the publisher reported it.
    ///
    /// The job is recorded as having failed when the hour ran out, an hour after
    /// its last update, not at `now`. The retry schedule and the publish hold order
    /// jobs by that instant, and a job abandoned long before this pass first saw it
    /// (every such job of a database older than this rule) belongs where it
    /// happened: before a publish that has succeeded since, and outside the
    /// retries of a run whose publisher died more than a day ago.
    pub async fn fail_abandoned_publish_jobs(&self, now: &str) -> Result<Vec<publish_job::Model>> {
        let dispatched = publish_job::Entity::find()
            .filter(publish_job::Column::State.eq("dispatched"))
            .all(&self.conn())
            .await?;
        let mut failed = Vec::new();
        for job in dispatched {
            if !super::is_abandoned_publish_job(&job, now) {
                continue;
            }
            // Parsed by the check above, so the fallback is never taken.
            let failed_at = OffsetDateTime::parse(&job.updated_at, &Rfc3339)
                .ok()
                .and_then(|updated| {
                    (updated + super::PUBLISH_JOB_STALE_AFTER)
                        .format(&Rfc3339)
                        .ok()
                })
                .unwrap_or_else(|| now.to_string());
            let written = publish_job::Entity::update_many()
                .col_expr(publish_job::Column::State, Expr::value("failed"))
                .col_expr(
                    publish_job::Column::UpdatedAt,
                    Expr::value(failed_at.as_str()),
                )
                .col_expr(
                    publish_job::Column::Detail,
                    Expr::value(PUBLISHER_NEVER_REPORTED),
                )
                .filter(publish_job::Column::Id.eq(job.id.as_str()))
                .filter(publish_job::Column::State.eq("dispatched"))
                .filter(publish_job::Column::UpdatedAt.eq(job.updated_at.as_str()))
                .exec(&self.conn())
                .await?;
            if written.rows_affected == 1 {
                failed.push(publish_job::Model {
                    state: "failed".to_string(),
                    updated_at: failed_at,
                    detail: Some(PUBLISHER_NEVER_REPORTED.to_string()),
                    ..job
                });
            }
        }
        Ok(failed)
    }
}
