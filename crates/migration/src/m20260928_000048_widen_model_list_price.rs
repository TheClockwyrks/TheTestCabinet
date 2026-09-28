//! Widens the `model` table's three list-price rate columns to double precision.
//!
//! The migration that added them declared the rates `float`, which PostgreSQL
//! creates as the four-byte `real`. The entity reads every price column as an
//! `f64`, and sqlx refuses to decode a `real` into one, so on PostgreSQL every
//! read of the catalog failed once the columns existed: `GET /models` answered
//! `500` and no model could be listed, added or edited. Every other price
//! column is `double precision`, and these three become the same.
//!
//! SQLite is left alone. Its `float` and `double` are the same `REAL` affinity,
//! stored as eight-byte floats, and the column type was never the problem there;
//! it also takes no `ALTER COLUMN`, so there is nothing to run and no way to run it.

use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::DbBackend;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// The three rate columns, in the order the migration that added them did.
const RATE_COLUMNS: [Model; 3] = [
    Model::ListPriceInput,
    Model::ListPriceCachedInput,
    Model::ListPriceOutput,
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == DbBackend::Sqlite {
            return Ok(());
        }
        for column in RATE_COLUMNS {
            manager
                .alter_table(
                    Table::alter()
                        .table(Model::Table)
                        .modify_column(ColumnDef::new(column).double().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.get_database_backend() == DbBackend::Sqlite {
            return Ok(());
        }
        for column in RATE_COLUMNS {
            manager
                .alter_table(
                    Table::alter()
                        .table(Model::Table)
                        .modify_column(ColumnDef::new(column).float().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum Model {
    Table,
    ListPriceInput,
    ListPriceCachedInput,
    ListPriceOutput,
}
