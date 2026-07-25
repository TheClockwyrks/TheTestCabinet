//! Adds the `input_modalities` column to the `model_price` table.
//!
//! OpenRouter reports, per model, which input modalities it accepts (`text`,
//! `image`, `file`, …). That fact belongs in the catalog for the same reason the
//! context window does: the catalog is the single store of model facts, and a
//! [gg](test_cabinet_core::gg) run is *told* what it needs about its models at
//! launch rather than querying for it from inside the run container. Knowing a
//! model is text-only is what keeps gg from putting a reference image in a prompt
//! that model cannot accept.
//!
//! It rides along on a price observation exactly as `context_length` and
//! `released_at` do — stored as a comma-separated, lowercased list. The column is
//! nullable and defaults to `NULL`: every row already recorded reads as "not
//! observed", which callers treat as unknown rather than as "text only".

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPrice::Table)
                    .add_column(ColumnDef::new(ModelPrice::InputModalities).text().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPrice::Table)
                    .drop_column(ModelPrice::InputModalities)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ModelPrice {
    Table,
    InputModalities,
}
