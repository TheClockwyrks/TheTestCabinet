//! Reshapes the model-probe tables for the forced `submit_program` protocol.
//!
//! A probe now replays gg's turn-1 request with the one `submit_program` tool
//! offered and `tool_choice` forced to it, and classifies the program string
//! each reply submitted. The prompt-condition matrix is gone, so the item's
//! `condition` column goes with it; the probe's single clean rate replaces the
//! base/best-variation pair; and the item records the submitted program beside
//! the reply's own text. Built from the portable schema builder so it applies
//! identically to SQLite and PostgreSQL.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One operation per ALTER, for SQLite compatibility.
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .rename_column(ModelProbe::BaseCleanRate, ModelProbe::CleanRate)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .drop_column(ModelProbe::BestVariationCleanRate)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbeItem::Table)
                    .drop_column(ModelProbeItem::Condition)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbeItem::Table)
                    .add_column(ColumnDef::new(ModelProbeItem::ProgramText).text().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbeItem::Table)
                    .drop_column(ModelProbeItem::ProgramText)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbeItem::Table)
                    .add_column(
                        ColumnDef::new(ModelProbeItem::Condition)
                            .string()
                            .not_null()
                            .default("base"),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .add_column(
                        ColumnDef::new(ModelProbe::BestVariationCleanRate)
                            .double()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelProbe::Table)
                    .rename_column(ModelProbe::CleanRate, ModelProbe::BaseCleanRate)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ModelProbe {
    Table,
    BaseCleanRate,
    CleanRate,
    BestVariationCleanRate,
}

#[derive(DeriveIden)]
enum ModelProbeItem {
    Table,
    Condition,
    ProgramText,
}
