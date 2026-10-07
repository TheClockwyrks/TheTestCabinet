//! Adds the engine to the two places a coverage cell's case pin is stored:
//! `ladder_rung.engine` (the pin a rung declares) and `job.engine_slug` (the pin a queued
//! run was launched on).
//!
//! A coverage cell is identified by its case pin, and the pin names an engine — one case
//! at one version and variant on two engines is two cells, because a model handed a
//! runtime is doing different work from the same model starting from nothing. The run
//! side of that identity already exists (`run.engine_slug`, added by
//! `m20260822_000033_add_run_engine_slug`); these are the declaration side and the queue
//! side of it.
//!
//! A plan's pins need no column at all: they are stored as JSON blobs on `coverage_plan`
//! and `coverage_group`, and a serde default on the new field is what keeps an existing
//! blob readable.
//!
//! `job.engine_slug` is a column rather than a read of `request_json` for the reason
//! `harness_slug`, `model_id`, and the two gg cell columns already are: a plan counts a
//! cell's in-flight runs with one grouped query over `job`, and deserializing a launch
//! request per row cannot be part of a `GROUP BY`.
//!
//! Both are nullable, so the migration stamps nothing. An absent engine *is* the `none`
//! engine — a launch omitting the key asks for the engineless run — so every grouped
//! coverage query coalesces `NULL` to `none`, and a rung or job written before the
//! columns existed keeps counting exactly where it always did. The jobs still in flight
//! across the deploy are nonetheless filled from their own `request_json` by a startup
//! backfill (`Db::backfill_in_flight_engine_slugs`) rather than in SQL here, because the
//! value lives inside each row's JSON blob.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(LadderRung::Table)
                    .add_column(ColumnDef::new(LadderRung::Engine).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .add_column(ColumnDef::new(Job::EngineSlug).text().null())
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
                    .drop_column(Job::EngineSlug)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LadderRung::Table)
                    .drop_column(LadderRung::Engine)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum LadderRung {
    Table,
    Engine,
}

#[derive(DeriveIden)]
enum Job {
    Table,
    EngineSlug,
}
