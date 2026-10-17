//! Adds the `tool_calls_counted` column to the `run` table.
//!
//! Codex and gg name no tools in their output, so a run of either has its
//! tool-call tally counted off its event stream. A run recorded before that
//! counting existed has no tally, and is counted the first time a comparison
//! holds it (docs/comparisons/diagnostics.md, "Counting an earlier run"). This
//! column is what tells a run with no tool calls from one that was never counted,
//! so an empty tally is counted once rather than on every load.
//!
//! `false` for every existing row: no run stored before the column existed was
//! counted by the code that sets it.

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
                        ColumnDef::new(Run::ToolCallsCounted)
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
                    .drop_column(Run::ToolCallsCounted)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    ToolCallsCounted,
}
