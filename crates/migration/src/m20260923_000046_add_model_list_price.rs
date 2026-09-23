//! Adds the curated **list price** columns to the `model` table.
//!
//! A run's comparable cost is priced at the model developer's published list
//! price — input, cached input, and output per token in USD — curated on the
//! model's catalog entry together with the date the figures were taken
//! (`list_price_as_of`) and where they came from (`list_price_source`). The
//! OpenRouter-derived observations in `model_price` become the billed rate; the
//! list price is the stable figure a run is scored at. All five columns are
//! nullable and default to `NULL`: every row already recorded reads as "not yet
//! priced", and a model without a full price set is refused at enqueue.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite takes one ALTER TABLE action per statement.
        for column in [
            ColumnDef::new(Model::ListPriceInput)
                .float()
                .null()
                .to_owned(),
            ColumnDef::new(Model::ListPriceCachedInput)
                .float()
                .null()
                .to_owned(),
            ColumnDef::new(Model::ListPriceOutput)
                .float()
                .null()
                .to_owned(),
            ColumnDef::new(Model::ListPriceAsOf)
                .string()
                .null()
                .to_owned(),
            ColumnDef::new(Model::ListPriceSource)
                .string()
                .null()
                .to_owned(),
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Model::Table)
                        .add_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [
            Model::ListPriceInput,
            Model::ListPriceCachedInput,
            Model::ListPriceOutput,
            Model::ListPriceAsOf,
            Model::ListPriceSource,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Model::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Model {
    Table,
    ListPriceInput,
    ListPriceCachedInput,
    ListPriceOutput,
    ListPriceAsOf,
    ListPriceSource,
}
