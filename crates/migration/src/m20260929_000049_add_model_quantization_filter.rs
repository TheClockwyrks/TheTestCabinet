//! Adds the `quantization_filter` column to the `model` table.
//!
//! The candidate list a gg run of a model runs on keeps the endpoints serving the model at its
//! native quantization, a level no endpoint of a closed model declares, since its precision is
//! undisclosed. The catalog entry can switch that one filter off, and every endpoint then passes
//! it at whatever level it declares. The column defaults to `TRUE`: a model curated before it
//! existed builds the list it built before.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Model::Table)
                    .add_column(
                        ColumnDef::new(Model::QuantizationFilter)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Model::Table)
                    .drop_column(Model::QuantizationFilter)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Model {
    Table,
    QuantizationFilter,
}
