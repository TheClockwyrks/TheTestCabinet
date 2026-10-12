//! Adds the `auto_publish_deferred` column to the `run` table.
//!
//! Automatic publishing passes over a run whose artifact tree it could not
//! confirm: the artifact service gave no answer, or said the run has no tree. The
//! triggers that offer a run to automatic publishing fire when the run finishes,
//! so a run passed over then is offered again only by the backend's periodic
//! retry, and this column is how the retry knows which runs those are. Without it
//! the retry would have to consider every unpublished run the rule admits, which
//! would publish runs nobody passed over.
//!
//! `false` for every existing row: no run stored before the column existed was
//! passed over by a gate that did not exist either.

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
                    .add_column(
                        ColumnDef::new(Run::AutoPublishDeferred)
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
                    .table(Run::Table)
                    .drop_column(Run::AutoPublishDeferred)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    AutoPublishDeferred,
}
