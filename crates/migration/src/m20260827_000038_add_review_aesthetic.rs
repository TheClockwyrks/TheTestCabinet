//! Adds the `aesthetic` column to the `review` table: the reviewer's **run-wide**
//! aesthetic tier (`legendary`…`slop`), carried only by a review of a
//! validator-rated run.
//!
//! The column exists because the aesthetic rating stopped being per-domain. A
//! review used to rate the aesthetic channel once per scoring domain (the
//! `aesthetics` JSON column), but the visuals of one variant's domains are nearly
//! identical, so the channel is now one judgement about the whole build. New
//! writes set this column and leave `aesthetics` as `[]`; old rows keep their
//! per-domain JSON, and every read resolves a row's run-wide tier as the
//! `aesthetic` column when set, else the worst tier across its legacy
//! `aesthetics` entries (which equals the old aggregation, so displayed values
//! for old reviews do not change).
//!
//! Nullable, defaulting to `NULL`: a legacy run's review has no aesthetic channel
//! at all, and a pre-migration validator-rated review keeps its tier in the
//! legacy JSON. No backfill — the read-side collapse makes one unnecessary.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Review::Table)
                    .add_column(ColumnDef::new(Review::Aesthetic).text().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Review::Table)
                    .drop_column(Review::Aesthetic)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Review {
    Table,
    Aesthetic,
}
