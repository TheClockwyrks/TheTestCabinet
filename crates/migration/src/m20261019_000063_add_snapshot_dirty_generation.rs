//! Adds the `dirty_generation` column to the `snapshot_state` table.
//!
//! Every mark of the snapshot as dirty increments the generation. A refresh reads the
//! generation before it regenerates the dataset and clears `dirty` only when the
//! generation is still the one it read, so a mark that lands while a refresh runs is
//! not lost: the flag stays set and the next refresh, or the next start, picks it up.
//!
//! The column is `BIGINT NOT NULL DEFAULT 0`, so the existing row (if any) starts at
//! generation 0 and keeps its `dirty` flag as it was.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SnapshotState::Table)
                    .add_column(
                        ColumnDef::new(SnapshotState::DirtyGeneration)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SnapshotState::Table)
                    .drop_column(SnapshotState::DirtyGeneration)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SnapshotState {
    Table,
    DirtyGeneration,
}
