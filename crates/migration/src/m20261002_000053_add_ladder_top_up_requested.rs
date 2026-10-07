//! Adds the `top_up_requested` column to the `ladder` table.
//!
//! A top-up that finds a ladder's claim held leaves a request for the holder
//! (`top_up_pending`), and the holder runs one more pass for it. The owner's own top-up
//! ("Top up now") relaunches a rung whose runs keep failing, which an automatic one does not,
//! so a pending request has to say which kind it was: this flag is set when the owner asked,
//! and the holder's pass for that request runs as the owner's. The column defaults to `FALSE`.

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
                        ColumnDef::new(Ladder::TopUpRequested)
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
                    .drop_column(Ladder::TopUpRequested)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Ladder {
    Table,
    TopUpRequested,
}
