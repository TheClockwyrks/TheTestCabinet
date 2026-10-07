//! Adds the `engine_slug` column to the `run` table: the slug of the
//! [engine](https://docs.testcabinet.ai/components/core/engines/) the produced build
//! was written against (for example `simple-2d`), or `none` for a build that supplied
//! its own frame loop, input, audio, assets, and diagnostics.
//!
//! The column exists because the engine is part of what makes a result comparable. As
//! the run record's own `SubjectOut.engineSlug` doc puts it: the engine is a **run
//! dimension**, not a property of the case — the same case version can be run on
//! several engines, and a result is only comparable with another result on the same
//! engine. The case-detail Runs tab therefore filters by the anchored engine, and
//! lifting the slug out of the record blob is what lets that filter run in SQL
//! instead of by deserializing every record on every page.
//!
//! Nullable, defaulting to `NULL`: rows written before the column existed have not
//! had the slug lifted yet. Every record — including every pre-engine-era one, which
//! deserializes to the default `none` — carries a value, so the startup backfill
//! (`Db::backfill_engine_slug`) settles every readable row to a concrete slug; the
//! only rows left `NULL` are those whose record no longer deserializes. Every write
//! after this sets the column directly from the record on the ordinary insert path.
//!
//! No index. Like the other lifted equality filters (`variant`, `model_id`), this
//! narrows a listing that is already sliced by `test_case_slug`, and it joins the
//! other lifted non-sort columns in being unindexed.

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
                    .add_column(ColumnDef::new(Run::EngineSlug).text().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::EngineSlug)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    EngineSlug,
}
