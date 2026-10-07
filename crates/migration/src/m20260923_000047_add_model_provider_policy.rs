//! Adds the provider policy columns to the `model` table.
//!
//! A gg run of a model runs on the providers of its candidate list, which the backend builds at
//! enqueue from the model's endpoints listing. The catalog entry has a say over that list: the
//! native quantization set by hand, the price ceiling used when OpenRouter lists no developer
//! endpoint, the providers banned for good and the providers accepted despite declaring `unknown`
//! quantization. Every column is nullable and defaults to `NULL`, which leaves the list to the
//! listing: a model curated before these existed builds the list it would have built without them.
//!
//! The two provider lists are text holding a JSON array of provider names, `NULL` being empty.
//! Each column is added on its own statement because SQLite alters one column at a time.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [
            ColumnDef::new(Model::NativeQuantization)
                .string()
                .null()
                .to_owned(),
            ColumnDef::new(Model::MaxInputPrice)
                .double()
                .null()
                .to_owned(),
            ColumnDef::new(Model::MaxOutputPrice)
                .double()
                .null()
                .to_owned(),
            ColumnDef::new(Model::BannedProviders)
                .text()
                .null()
                .to_owned(),
            ColumnDef::new(Model::UnknownQuantizationProviders)
                .text()
                .null()
                .to_owned(),
        ] {
            let mut column = column;
            manager
                .alter_table(
                    Table::alter()
                        .table(Model::Table)
                        .add_column(&mut column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [
            Model::UnknownQuantizationProviders,
            Model::BannedProviders,
            Model::MaxOutputPrice,
            Model::MaxInputPrice,
            Model::NativeQuantization,
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
    NativeQuantization,
    MaxInputPrice,
    MaxOutputPrice,
    BannedProviders,
    UnknownQuantizationProviders,
}
