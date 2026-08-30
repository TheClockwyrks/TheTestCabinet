//! Adds the **record readability marker** to the `run` table: whether the running
//! build can decode a stored run's `record_json` into the current `RunRecord`, and
//! the record-format generation that decision was made under.
//!
//! - `run.record_readable` (boolean, `true` for every existing row): whether the
//!   record decoded when readability was last decided. Every run listing filters on
//!   this column, so a listing's `COUNT(*)` and the page it serves run the same
//!   predicate and the reported total equals the number of rows returned.
//! - `run.record_format` (integer, `0` for every existing row): the
//!   `test_cabinet_backend::db::RUN_RECORD_FORMAT` generation the marker was decided
//!   under. `RUN_RECORD_FORMAT` starts at `1`, so every pre-existing row is stale on
//!   the first boot after this migration and the startup sweep
//!   (`Db::revalidate_run_records`) decides its readability once.
//!
//! The marker is a column rather than a Rust-side skip because the count and the
//! selection have to be one SQL predicate. Deciding readability by deserializing
//! each selected row leaves the count answering a question the page cannot, which
//! is what makes a pager offer pages that hold nothing.

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
                        ColumnDef::new(Run::RecordReadable)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .add_column(
                        ColumnDef::new(Run::RecordFormat)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::RecordReadable)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Run::Table)
                    .drop_column(Run::RecordFormat)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Run {
    Table,
    RecordReadable,
    RecordFormat,
}
