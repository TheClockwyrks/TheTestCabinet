//! Adds the `backfill_state` table: one row per startup backfill that must run exactly
//! once over the rows a migration left behind.
//!
//! Most backfills need no such record. They re-derive a column from the row that already
//! holds the answer, so a row they fill stops being a candidate and the candidate set
//! settles to empty on its own. `run.gg_config_id` is the exception: an older gg run
//! records only the configuration's **name**, and the id it stands for is resolved through
//! the launching account's configuration library, which the operator keeps editing. A pass
//! that re-examined its unresolved residue on every boot would keep asking a question whose
//! answer drifts, and a configuration created long after those runs — a rename freeing the
//! old name, then a new configuration taking it — would adopt another configuration's
//! history.
//!
//! One row, written after a pass completes without error, is what bounds that: the residue
//! a pass could not resolve stays `NULL` for good, which under-counts a cell the next
//! top-up fills rather than merging two configurations. A pass that fails part way writes
//! no row and is retried on the next boot.
//!
//! Keyed by the backfill's own name so the table serves every pass that needs the same
//! guarantee, and carrying the completion time so an operator reading the store can tell
//! when a pass last ran.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(BackfillState::Table)
                    .if_not_exists()
                    // The backfill's name is the key: one row per pass, present only once
                    // that pass has completed.
                    .col(
                        ColumnDef::new(BackfillState::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    // RFC 3339 of the completing pass.
                    .col(
                        ColumnDef::new(BackfillState::CompletedAt)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(BackfillState::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum BackfillState {
    Table,
    Id,
    CompletedAt,
}
