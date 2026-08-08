//! Adds the `test_type` column to the `job` table.
//!
//! Like the other identity columns on `job` (`test_case_slug`,
//! `test_case_version`, `variant`, `harness_slug`, `model_id`), the test type is
//! lifted out of the resolved test case at enqueue. The queue itself needs it: a
//! **game-jam** job may only be claimed while no other run of the same jam and
//! model is in flight, because a repeated jam run is briefed with the gameplay
//! READMEs of that model's earlier entries — which exist only once those runs have
//! finished. It carries a `""` default so any rows already queued when this
//! migration runs stay valid (they are treated as non-jam, exactly as before);
//! every enqueue after this sets the real type.
//!
//! Numbered `000023` rather than the next ordinal on this branch: `000018`–`000022`
//! are already taken by migrations on the v0.7.0 line, and a duplicate ordinal
//! across the two would be far more confusing after they merge than a gap here.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Job::Table)
                    .add_column(
                        ColumnDef::new(Job::TestType)
                            .string()
                            .not_null()
                            .default(""),
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
                    .table(Job::Table)
                    .drop_column(Job::TestType)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Job {
    Table,
    TestType,
}
