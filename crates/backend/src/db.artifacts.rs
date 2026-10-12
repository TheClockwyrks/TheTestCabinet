//! A run's **artifact presence**: whether the artifact service holds the tree its
//! driver uploaded, kept in the `run.artifacts_stored` column.
//!
//! A release is built from that tree, so a run without one can never be published.
//! The column has three readings and the third matters: `Some(true)` stored,
//! `Some(false)` not stored, and `None` unknown. Unknown is a run nothing has
//! reported on, which is every run of a backend with no artifact service, and it is
//! never treated as "not stored".
//!
//! Three writers, all through this module: the driver's terminal status report and
//! the publish gate ([`Db::set_run_artifacts_stored`], one run at a time), and the
//! reclamation sweep's reconciliation against the artifact service's listing
//! ([`Db::reconcile_artifacts_stored`]). [`Db::push`] leaves the column alone
//! when it stores a record again, with the one exception below.
//!
//! A run whose tree the reclamation sweep [reclaimed](super::retention) is
//! recorded as not stored by the reclaim itself, and none of the three writers
//! moves it afterwards: a tree that lands late for such a run is the sweep's to
//! delete again, and the run was never one whose tree was lost. Storing such a
//! run's record again ends that: the push follows a driver that ran the run and
//! uploaded its tree again, so [`Db::push`] clears the reclaim record and puts
//! the presence back to unknown, for the three writers to record afresh.

use std::collections::HashSet;

use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use test_cabinet_entities::{publish_job, run};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::Db;
use crate::error::Result;

/// How many run ids one reconciliation statement names. Well under the bound-
/// parameter limit of both stores, so a cabinet of any size reconciles in a
/// handful of statements.
const RECONCILE_CHUNK: usize = 500;

/// What one [`Db::reconcile_artifacts_stored`] changed, for the sweep's log line.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactReconciliation {
    /// Runs newly recorded as stored: they were unknown or recorded not stored,
    /// and the listing holds their tree.
    pub marked_stored: u64,
    /// Runs newly recorded as not stored: they were unknown or recorded stored,
    /// and the listing holds no tree for them.
    pub marked_not_stored: u64,
}

/// The rows whose recorded presence differs from `stored`: unknown, or the
/// opposite. Restricting every write to these keeps a write that changes nothing
/// from stamping the run as mutated.
fn presence_differs(stored: bool) -> Condition {
    Condition::any()
        .add(run::Column::ArtifactsStored.is_null())
        .add(run::Column::ArtifactsStored.eq(!stored))
}

impl Db {
    /// Record whether the artifact service holds run `run_id`'s tree. Returns
    /// whether the row changed; an unknown run, a run already recorded with this
    /// value, and a run whose tree was reclaimed change nothing.
    ///
    /// The run's mutation timestamp is stamped in the same statement, so a console
    /// following the run sees its presence change.
    pub async fn set_run_artifacts_stored(&self, run_id: &str, stored: bool) -> Result<bool> {
        let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
        let res = run::Entity::update_many()
            .col_expr(run::Column::ArtifactsStored, Expr::value(stored))
            .col_expr(run::Column::UpdatedAt, Expr::value(now))
            .filter(run::Column::Id.eq(run_id))
            .filter(run::Column::ArtifactsReclaimedAt.is_null())
            .filter(presence_differs(stored))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Run `run_id`'s recorded artifact presence: `None` while unknown, and `None`
    /// for a run that does not exist.
    pub async fn run_artifacts_stored(&self, run_id: &str) -> Result<Option<bool>> {
        let stored: Option<Option<bool>> = run::Entity::find_by_id(run_id.to_string())
            .select_only()
            .column(run::Column::ArtifactsStored)
            .into_tuple()
            .one(&self.conn())
            .await?;
        Ok(stored.flatten())
    }

    /// Bring the recorded presence of `runs` into line with `listed`, the ids the
    /// artifact service reported a tree for: every run in `listed` is recorded as
    /// stored and every other run of `runs` as not stored.
    ///
    /// `runs` is the caller's own read of the run ids and bounds what is written: a
    /// run that is not in it is left exactly as it is, whatever the listing says,
    /// and so is a run whose tree was reclaimed.
    /// The caller reads `runs` **before** it lists the trees, which is what makes
    /// "not stored" safe to conclude. A driver uploads its tree before it reports
    /// the run, so a run that already had a row when `runs` was read had finished
    /// uploading by then, and a tree absent from a listing taken afterwards is
    /// absent. A run that lands in between is simply not in `runs`.
    ///
    /// Only rows whose value changes are written, so a steady state costs the
    /// reads and writes nothing.
    pub async fn reconcile_artifacts_stored(
        &self,
        runs: &HashSet<String>,
        listed: &HashSet<String>,
    ) -> Result<ArtifactReconciliation> {
        let (stored, not_stored): (Vec<&String>, Vec<&String>) =
            runs.iter().partition(|id| listed.contains(*id));
        Ok(ArtifactReconciliation {
            marked_stored: self.mark_artifacts_stored(&stored, true).await?,
            marked_not_stored: self.mark_artifacts_stored(&not_stored, false).await?,
        })
    }

    /// Record `stored` for each of `run_ids` whose recorded presence differs,
    /// returning how many rows changed.
    ///
    /// A run that goes from unknown to stored keeps its mutation timestamp. Unknown
    /// already reads as publishable everywhere a console shows a run, so nothing a
    /// reader sees has changed, and the first pass over an existing cabinet moves
    /// every one of its runs this way: stamping them would tell every follower of
    /// the timestamp that the whole cabinet had changed. Every other change is one
    /// a console shows, and is stamped.
    async fn mark_artifacts_stored(&self, run_ids: &[&String], stored: bool) -> Result<u64> {
        let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
        let mut changed = 0;
        for chunk in run_ids.chunks(RECONCILE_CHUNK) {
            let ids = || chunk.iter().map(|id| id.as_str());
            if stored {
                let res = run::Entity::update_many()
                    .col_expr(run::Column::ArtifactsStored, Expr::value(true))
                    .filter(run::Column::Id.is_in(ids()))
                    .filter(run::Column::ArtifactsReclaimedAt.is_null())
                    .filter(run::Column::ArtifactsStored.is_null())
                    .exec(&self.conn())
                    .await?;
                changed += res.rows_affected;
            }
            let res = run::Entity::update_many()
                .col_expr(run::Column::ArtifactsStored, Expr::value(stored))
                .col_expr(run::Column::UpdatedAt, Expr::value(now.clone()))
                .filter(run::Column::Id.is_in(ids()))
                .filter(run::Column::ArtifactsReclaimedAt.is_null())
                .filter(presence_differs(stored))
                .exec(&self.conn())
                .await?;
            changed += res.rows_affected;
        }
        Ok(changed)
    }
}

impl Db {
    /// Mark each of `run_ids` as passed over by automatic publishing, which hands
    /// it to the periodic retry. The mutation timestamp is left alone: the mark is
    /// the backend's own bookkeeping and changes nothing a console shows.
    pub async fn defer_auto_publish(&self, run_ids: &[String]) -> Result<()> {
        for chunk in run_ids.chunks(RECONCILE_CHUNK) {
            run::Entity::update_many()
                .col_expr(run::Column::AutoPublishDeferred, Expr::value(true))
                .filter(run::Column::Id.is_in(chunk.iter().map(String::as_str)))
                .filter(run::Column::AutoPublishDeferred.eq(false))
                .exec(&self.conn())
                .await?;
        }
        Ok(())
    }

    /// The runs automatic publishing passed over and has not settled since, oldest
    /// first.
    pub async fn auto_publish_deferred_runs(&self) -> Result<Vec<String>> {
        Ok(run::Entity::find()
            .select_only()
            .column(run::Column::Id)
            .filter(run::Column::AutoPublishDeferred.eq(true))
            .order_by_asc(run::Column::FinishedAt)
            .order_by_asc(run::Column::Id)
            .into_tuple()
            .all(&self.conn())
            .await?)
    }

    /// Clear the mark on each of `run_ids` that no longer waits on automatic
    /// publishing: the run is published, a publish job has been written for it, by
    /// the retry or by a person, or its tree was reclaimed and there is nothing
    /// left to release. Returns how many marks were cleared.
    pub async fn settle_auto_publish_deferred(&self, run_ids: &[String]) -> Result<u64> {
        let mut settled = 0;
        for chunk in run_ids.chunks(RECONCILE_CHUNK) {
            let with_job: Vec<String> = publish_job::Entity::find()
                .select_only()
                .column(publish_job::Column::RunId)
                .filter(publish_job::Column::RunId.is_in(chunk.iter().map(String::as_str)))
                .into_tuple()
                .all(&self.conn())
                .await?;
            let res = run::Entity::update_many()
                .col_expr(run::Column::AutoPublishDeferred, Expr::value(false))
                .filter(run::Column::Id.is_in(chunk.iter().map(String::as_str)))
                .filter(run::Column::AutoPublishDeferred.eq(true))
                .filter(
                    Condition::any()
                        .add(run::Column::Published.eq(true))
                        .add(run::Column::ArtifactsReclaimedAt.is_not_null())
                        .add(run::Column::Id.is_in(with_job)),
                )
                .exec(&self.conn())
                .await?;
            settled += res.rows_affected;
        }
        Ok(settled)
    }
}

#[cfg(test)]
#[path = "db.artifacts.test.rs"]
mod tests;
