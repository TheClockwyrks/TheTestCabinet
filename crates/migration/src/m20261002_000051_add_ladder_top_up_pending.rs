//! Adds the `top_up_pending` column to the `ladder` table.
//!
//! The backend tops a ladder up whenever a run of one of its cells finishes. A run that
//! finishes while another top-up of the same ladder holds its claim cannot run its own pass,
//! so it sets this flag instead, and the holder runs one more pass before it lets go. Without
//! it a run that lands mid-top-up could leave its rung undecided until something else
//! happened to feed the ladder. The column defaults to `FALSE`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .add_column(
                        ColumnDef::new(Ladder::TopUpPending)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Ladder::Table)
                    .drop_column(Ladder::TopUpPending)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Ladder {
    Table,
    TopUpPending,
}
