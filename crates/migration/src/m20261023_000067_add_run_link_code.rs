//! Adds the `code` and `public_media` columns to the `run_link` table.
//!
//! `code` is a published run's short code: the shortest prefix of its run id, at
//! least eight characters long, that no published run already holds (the backend
//! overview's "Short codes"). It is minted the first time the run publishes and
//! never reassigned, so a unique index holds it: two runs can never share one.
//! `NULL` until the run's first publish, and on every row already present when the
//! column was added, which the next snapshot refresh assigns in publication order.
//!
//! `public_media` is the JSON body the artifacts service answered the run's
//! `POST /runs/{id}/publish-media` with: the public keys of the run's proof,
//! validation, asset and showcase media, which the run's public document names. A
//! published run's media never changes, so the answer is stored once and the copy
//! is not asked for again. `NULL` until the copy first succeeds.

use sea_orm_migration::prelude::*;

/// The unique index over `run_link.code`. A nullable column, so every run that has
/// not published yet holds `NULL` beside every other.
const CODE_INDEX: &str = "idx_run_link_code";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One column per statement: SQLite's `ALTER TABLE` adds one at a time.
        manager
            .alter_table(
                Table::alter()
                    .table(RunLink::Table)
                    .add_column(ColumnDef::new(RunLink::Code).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(RunLink::Table)
                    .add_column(ColumnDef::new(RunLink::PublicMedia).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(CODE_INDEX)
                    .table(RunLink::Table)
                    .col(RunLink::Code)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(CODE_INDEX)
                    .table(RunLink::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(RunLink::Table)
                    .drop_column(RunLink::PublicMedia)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(RunLink::Table)
                    .drop_column(RunLink::Code)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RunLink {
    Table,
    Code,
    PublicMedia,
}
