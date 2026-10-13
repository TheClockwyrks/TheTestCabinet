//! What the [state reclamation sweep](crate::state_reclaim) writes on a run: the
//! record that the run's files were removed from the backend's own store on
//! purpose, and what an upload of a file for the run does to that record and to
//! the run's media confirmation.
//!
//! The record is written before any file is removed and names the facts the
//! removal was decided from, so a run that changed between the decision and the
//! write is left alone.

use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect, TransactionTrait};
use test_cabinet_entities::run;

use super::Db;
use super::retention::{ReclaimReason, RetentionRun};
use crate::error::Result;

/// What an upload of a file for a run changed on the run's row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadedOver {
    /// The run has no row, or it is unpublished and its row carried no state
    /// reclaim. Nothing was written.
    Nothing,
    /// The run's state reclaim record was cleared. It is unpublished.
    Reclaim,
    /// The run is published and carried no media confirmation. Its mutation
    /// timestamp was stamped, so a refresh that read the run before the upload
    /// records no confirmation of what it saw, and any state reclaim record was
    /// cleared.
    Published,
    /// The run's media confirmation was cleared, with its manifest and any state
    /// reclaim record. The run is unevaluated again, and the next refresh
    /// evaluates it.
    Confirmation,
}

/// What an upload reads of its run: whether it is published, its confirmation
/// time, its manifest and its state reclaim time.
type UploadFacts = (bool, Option<String>, Option<String>, Option<String>);

impl Db {
    /// Record that the files of run `seen.id` in the backend's own store are being
    /// removed for `reason` at `at`. Returns whether the row was written.
    ///
    /// The statement names the facts `seen` was decided from: the published flag
    /// and the state, and for the `published` reason the confirmation `seen`
    /// carried. A run that was published, stored again, or whose confirmation was
    /// withdrawn or replaced between the read and this write is left alone and
    /// reports `false`.
    ///
    /// The run's mutation timestamp is left alone. Nothing a console shows changes
    /// with the removal: a published run's files are read from the bucket, and an
    /// unpublished one's from its tree.
    pub async fn mark_state_reclaimed(
        &self,
        seen: &RetentionRun,
        reason: ReclaimReason,
        at: &str,
    ) -> Result<bool> {
        let mut update = run::Entity::update_many()
            .col_expr(run::Column::StateReclaimedAt, Expr::value(at))
            .col_expr(
                run::Column::StateReclaimedReason,
                Expr::value(reason.as_str()),
            )
            .filter(run::Column::Id.eq(seen.id.as_str()))
            .filter(run::Column::Published.eq(seen.published))
            .filter(run::Column::RunState.eq(seen.run_state.as_str()));
        if reason == ReclaimReason::Published {
            // `seen` carries a confirmation only when it holds for the configured
            // bucket under the current version, and every write that withdraws or
            // replaces a confirmation changes this instant.
            let Some(confirmed_at) = seen.media_confirmed_at.as_deref() else {
                return Ok(false);
            };
            update = update
                .filter(run::Column::MediaConfirmedAt.eq(confirmed_at))
                .filter(run::Column::MediaManifest.is_not_null());
        }
        let res = update.exec(&self.conn()).await?;
        Ok(res.rows_affected > 0)
    }

    /// Put run `seen.id`'s state reclaim record back to what `seen` held, after a
    /// removal that the mark written at `at` announced removed nothing. Only a
    /// row still carrying that mark is written.
    pub async fn restore_state_record(&self, seen: &RetentionRun, at: &str) -> Result<bool> {
        let res = run::Entity::update_many()
            .col_expr(
                run::Column::StateReclaimedAt,
                Expr::value(seen.state_reclaimed_at.clone()),
            )
            .col_expr(
                run::Column::StateReclaimedReason,
                Expr::value(seen.state_reclaimed_reason.clone()),
            )
            .filter(run::Column::Id.eq(seen.id.as_str()))
            .filter(run::Column::StateReclaimedAt.eq(at))
            .exec(&self.conn())
            .await?;
        Ok(res.rows_affected > 0)
    }

    /// Record that a file was uploaded into the backend's own store for run
    /// `run_id`, after the file was written.
    ///
    /// A confirmation vouches for the files the run had when a refresh evaluated
    /// it, and a state reclaim says the store holds none of them. An upload makes
    /// both untrue, so both are cleared: the run reads as one no refresh has
    /// evaluated, the next refresh exports whatever of the upload the bucket
    /// lacks and confirms the run again, and until then the sweep removes nothing
    /// of it. The run's mutation timestamp is stamped, so a refresh that read the
    /// run before the upload does not record a confirmation of what it saw.
    ///
    /// A published run with no confirmation is stamped as well: a refresh may be
    /// evaluating it at this moment from a listing of its files made before the
    /// upload, and the stamp is what stops that refresh confirming the run with a
    /// manifest the new file is missing from.
    ///
    /// An unpublished run with no state reclaim is not written, which is every
    /// run whose driver is mirroring it for the first time.
    pub async fn note_run_file_uploaded(&self, run_id: &str) -> Result<UploadedOver> {
        let txn = self.conn().begin().await?;
        let row: Option<UploadFacts> = run::Entity::find_by_id(run_id.to_string())
            .select_only()
            .column(run::Column::Published)
            .column(run::Column::MediaConfirmedAt)
            .column(run::Column::MediaManifest)
            .column(run::Column::StateReclaimedAt)
            .into_tuple()
            .one(&txn)
            .await?;
        let over = match row {
            None | Some((false, None, None, None)) => UploadedOver::Nothing,
            Some((false, None, None, Some(_))) => UploadedOver::Reclaim,
            Some((true, None, None, _)) => UploadedOver::Published,
            Some(_) => UploadedOver::Confirmation,
        };
        if over == UploadedOver::Nothing {
            return Ok(over);
        }
        let none = || Expr::value(Option::<String>::None);
        let mut update = run::Entity::update_many()
            .col_expr(run::Column::StateReclaimedAt, none())
            .col_expr(run::Column::StateReclaimedReason, none());
        if over == UploadedOver::Confirmation {
            update = update
                .col_expr(run::Column::MediaConfirmedAt, none())
                .col_expr(run::Column::MediaCheckedAt, none())
                .col_expr(run::Column::MediaBucket, none())
                .col_expr(
                    run::Column::MediaConfirmationVersion,
                    Expr::value(Option::<i32>::None),
                )
                .col_expr(run::Column::MediaManifest, none());
        }
        update.filter(run::Column::Id.eq(run_id)).exec(&txn).await?;
        super::touch_run(&txn, run_id).await?;
        txn.commit().await?;
        Ok(over)
    }
}
