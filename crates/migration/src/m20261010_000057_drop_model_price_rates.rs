//! Drops the three rate columns of `model_price`, and forgets the one-time list
//! price rewrite.
//!
//! The table recorded a second price series beside a model's list price: what the
//! developer's endpoint charged at each observation. The list price is now the only
//! price a model has, so the three rate columns (`uncached_input`, `cached_input`,
//! `output`) are dropped. What is left of a row is the catalog facts observed with
//! it (the context window, the release date, the input modalities and the developer
//! provider), which the catalog and a launch still read. The table keeps its name
//! and its index, and every row is kept with its facts as they were.
//!
//! The `backfill_state` row of the one-time list price rewrite is deleted: the
//! rewrite is gone, since every list price is now refreshed from OpenRouter on a
//! schedule.
//!
//! Rolling back restores the three columns, empty: the rates themselves are not
//! recoverable. The `backfill_state` row is not put back, so the build this rolls
//! back to runs its rewrite once more.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// The `backfill_state` key the removed one-time list price rewrite recorded itself
/// under.
const LIST_PRICE_REWRITE_BACKFILL: &str = "model.list_price_standard_rate";

/// The three rate columns, in the order the table was created with them.
const RATE_COLUMNS: [ModelPrice; 3] = [
    ModelPrice::UncachedInput,
    ModelPrice::CachedInput,
    ModelPrice::Output,
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One column per statement: SQLite's `ALTER TABLE` takes a single action.
        for column in RATE_COLUMNS {
            manager
                .alter_table(
                    Table::alter()
                        .table(ModelPrice::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .exec_stmt(
                Query::delete()
                    .from_table(BackfillState::Table)
                    .and_where(Expr::col(BackfillState::Id).eq(LIST_PRICE_REWRITE_BACKFILL))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in RATE_COLUMNS {
            manager
                .alter_table(
                    Table::alter()
                        .table(ModelPrice::Table)
                        .add_column(ColumnDef::new(column).double().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum ModelPrice {
    Table,
    UncachedInput,
    CachedInput,
    Output,
}

#[derive(DeriveIden)]
enum BackfillState {
    Table,
    Id,
}
