//! Adds the scheduling columns to `coverage_plan`: emission order, the review
//! buffer, and the top-up serialization marker.
//!
//! A plan used to be a pure declaration — a set of cells and a target — that the
//! console expanded and fired *whole*. That works only while a plan is small. At
//! any real size, "trigger the missing runs" queues hundreds of runs the reviewer
//! cannot keep up with, and the order they come back in is whatever the queue
//! happened to produce. These columns turn the plan into something that can be fed
//! gradually, in an order the reviewer chose:
//!
//! - `outer_axis` flips the nesting of the case × combination loop that builds the
//!   matrix. `case` (the default, today's behaviour) finishes one case across every
//!   combination before moving on; `combination` finishes one combination across
//!   every case. Because `job.queue_seq` is monotonic and the dispatcher claims in
//!   ascending order, emission order *is* execution order — nothing in the
//!   dispatcher changes.
//! - `buffer_target` overrides the account-wide default in `coverage_settings` for
//!   this one plan. Nullable, because "no override" must be distinguishable from
//!   an explicit `0`; the account default applies when it is `NULL`.
//! - `auto_top_up` decides whether submitting a review re-runs the top-up for this
//!   plan, and `paused` suspends topping up entirely without touching the queue
//!   (the milder of the three halting controls — `halt` additionally cancels).
//! - `topping_up_at` serializes top-up. Top-up is a server endpoint the console
//!   calls, not a daemon, so two console tabs — or one fast double review-submit —
//!   can both observe the same shortfall and both enqueue for it. A caller takes
//!   the plan by conditionally updating this column (claim only when it is `NULL`
//!   or older than the lease) and clears it when done. It holds the RFC 3339 claim
//!   time rather than a bare boolean precisely so a request that dies mid-top-up
//!   expires instead of wedging the plan forever.
//!
//! The three non-nullable columns carry portable defaults matching today's
//! behaviour, so existing plans keep working untouched: ordered by case, never
//! paused, no automatic top-up.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite only allows one column change per `ALTER TABLE`, so each column is
        // added in its own statement (this applies identically to PostgreSQL).
        for column in [
            // `"case"` is today's loop nesting, so an existing plan is unchanged.
            ColumnDef::new(CoveragePlan::OuterAxis)
                .string()
                .not_null()
                .default("case")
                .to_owned(),
            ColumnDef::new(CoveragePlan::Paused)
                .boolean()
                .not_null()
                .default(false)
                .to_owned(),
            // Off by default: a plan that silently enqueues work every time a review
            // is submitted must be opted into, never inherited by an existing plan.
            ColumnDef::new(CoveragePlan::AutoTopUp)
                .boolean()
                .not_null()
                .default(false)
                .to_owned(),
            // Nullable: `NULL` means "use the account's `coverage_settings` default",
            // which is a different statement from an explicit buffer of `0`.
            ColumnDef::new(CoveragePlan::BufferTarget)
                .integer()
                .to_owned(),
            // Nullable: `NULL` is the unclaimed state. Set to the RFC 3339 claim time
            // for the duration of one top-up.
            ColumnDef::new(CoveragePlan::ToppingUpAt)
                .string()
                .to_owned(),
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(CoveragePlan::Table)
                        .add_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [
            CoveragePlan::ToppingUpAt,
            CoveragePlan::BufferTarget,
            CoveragePlan::AutoTopUp,
            CoveragePlan::Paused,
            CoveragePlan::OuterAxis,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(CoveragePlan::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum CoveragePlan {
    Table,
    OuterAxis,
    Paused,
    AutoTopUp,
    BufferTarget,
    ToppingUpAt,
}
