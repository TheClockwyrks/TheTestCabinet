//! Adds the column that names **which gg configuration** a run came from, to the `run`
//! and `job` tables: `run.gg_config_id` and `job.gg_config_id`.
//!
//! A gg [coverage cell](https://docs.testcabinet.ai/components/backend/coverage/) is
//! identified by the configuration a run was launched from and by the models its bound
//! capability set runs on. This is the first of those two segments, and it is the
//! configuration's **id** rather than the name (`m20260901_000040_add_gg_cell_identity`
//! carries the second segment, and the name):
//!
//! - a name is display text an operator rewrites freely, so keying a cell on it would
//!   empty the cell every time a configuration is renamed — the plan would read 0/N and
//!   the next top-up would re-buy every run behind it;
//! - nothing makes a name unique within an account, so two configurations that happen to
//!   agree on one would count as a single cell;
//! - a ladder's climber is already keyed on the configuration's id
//!   (`Db::combination_key`), so keying the counts on the id is what makes a rung's
//!   verdicts and the runs underneath them describe the same thing.
//!
//! Both columns are nullable, so the migration itself stamps nothing: a
//! third-party-harness row carries no configuration, a gg run assembled by hand carries
//! none either, and every grouped coverage query coalesces the column to the empty string
//! — which is exactly the harness form of the cell key.
//!
//! The **gg** rows that predate the column are filled by a startup backfill
//! (`Db::backfill_gg_config_id` for runs, `Db::backfill_in_flight_gg_config_ids` for the
//! jobs still queued across the deploy) rather than in SQL here, because the id is in
//! neither the row nor the record it stores: an older run records only the configuration's
//! name, and resolving that to an id means going through the `job` that produced the run to
//! the account that launched it and matching the name against that account's
//! configurations. The backfill leaves the column `NULL` wherever that is unresolvable or
//! ambiguous, which under-counts a cell rather than merging two, and it runs once —
//! recorded in `backfill_state` (`m20260901_000042_create_backfill_state`) — so a
//! configuration created later cannot take a name back and adopt the history behind it.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(ColumnDef::new(Run::GgConfigId).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .add_column(ColumnDef::new(Job::GgConfigId).text().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .drop_column(Job::GgConfigId)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::GgConfigId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    GgConfigId,
}

#[derive(DeriveIden)]
enum Job {
    Table,
    GgConfigId,
}
