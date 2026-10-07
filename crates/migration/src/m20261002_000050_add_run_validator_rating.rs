//! Adds the `validator_rating` column to the `run` table.
//!
//! A ladder's gate reads the functional rating the validators decided for a run, with no
//! reviewer's checklist overrides folded in, which `run.rating` does fold in. The column holds
//! that figure as its lowercase rating token, written at push time and never touched by a
//! review. It is nullable: a legacy run, a run whose state is not scored, and a run pushed
//! while the backend did not hold its case version all carry none. The rows already stored
//! are filled at startup by the backend, since deciding the figure needs the case version's
//! checklist, which lives in the definition store rather than the database.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(ColumnDef::new(Run::ValidatorRating).string().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::ValidatorRating)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    ValidatorRating,
}
