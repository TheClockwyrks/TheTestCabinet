//! Adds the `provider_pin` column to the `model_price` table.
//!
//! A gg run is pinned to the model developer's own OpenRouter provider, and the catalog
//! is the single store of that fact. It rides along on a price observation exactly as
//! `context_length` and `input_modalities` do. The column is nullable and defaults to
//! `NULL`: every row already recorded reads as "not observed", and a launch that needs
//! the pin resolves it live rather than inventing one.

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
                    .add_column(ColumnDef::new(ModelPrice::ProviderPin).string().null())
                    .to_owned(),
            )
            .await?;
        // The hand-set override, for a listing whose provider name does not match the author
        // segment of the model id. Null means "take the observed slug".
        manager
            .alter_table(
                Table::alter()
                    .table(Model::Table)
                    .add_column(ColumnDef::new(Model::ProviderPin).string().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Model::Table)
                    .drop_column(Model::ProviderPin)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPrice::Table)
                    .drop_column(ModelPrice::ProviderPin)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ModelPrice {
    Table,
    ProviderPin,
}

#[derive(DeriveIden)]
enum Model {
    Table,
    ProviderPin,
}
